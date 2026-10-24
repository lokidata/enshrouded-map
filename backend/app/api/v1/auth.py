from datetime import datetime, timedelta
from typing import Annotated, Any

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from sqlalchemy import Select, delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import (
    SESSION_COOKIE,
    CurrentUser,
    DbSession,
    current_user,
    start_session,
)
from app.api.limiter import limiter
from app.core.config import get_settings
from app.core.logging import audit
from app.core.passkeys import passkeys_enabled
from app.core.security import (
    hash_password,
    needs_rehash,
    new_token,
    password_is_acceptable,
    token_digest,
    tokens_equal,
    verify_password,
)
from app.core.setup_token import setup_token
from app.db.base import utcnow
from app.db.models import AuthSession, Invitation, PasswordReset, TeamMember, User
from app.db.queries import leave_team, no_users
from app.schemas.auth import (
    AcceptIn,
    ChangePasswordIn,
    Credentials,
    DeleteAccountIn,
    InvitationCheck,
    InvitationOut,
    ResetAcceptIn,
    ResetCheck,
    ResetCreateIn,
    ResetOut,
    SetupIn,
    TokenIn,
    UserItem,
    UserOut,
)

router = APIRouter(prefix="/auth", tags=["auth"])

MAX_LOCK = timedelta(minutes=15)


def _ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _new_user(db: Session, username: str, password: str, *, first: bool = False) -> User:
    """Adds the account (not committed). 400 for a weak password, 409 when the insert conflicts:
    "taken" for a used name, "setup_done" when another request just created the first account.

    The first account carries first_account=True, which is unique: two simultaneous setups
    cannot both succeed, on any database (other accounts keep NULL, which is never a duplicate).
    """
    if not password_is_acceptable(password, username):
        raise HTTPException(400, "password")
    user = User(
        username=username,
        username_key=username.lower(),
        password_hash=hash_password(password),
        first_account=True if first else None,
    )
    db.add(user)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "setup_done" if first else "taken") from None
    return user


@router.post("/setup", response_model=UserOut)
@limiter.limit(lambda: get_settings().register_rate_limit)
def setup(
    request: Request,
    response: Response,
    body: SetupIn,
    db: DbSession,
    session: Annotated[str | None, Cookie()] = None,
) -> UserOut:
    """First start: the very first account. Refused as soon as any account exists, and
    unless the caller knows the setup token (so that not just anyone who reaches the
    port first becomes the owner)."""
    if not no_users(db):
        raise HTTPException(409, "setup_done")
    if not tokens_equal(body.setup_token, setup_token()[0]):
        audit.warning("setup_refused", extra={"ip": _ip(request)})
        raise HTTPException(403, "setup_token")
    user = _new_user(db, body.username, body.password, first=True)
    db.commit()
    start_session(db, response, user, session)
    audit.info("setup", extra={"user_id": user.id, "ip": _ip(request)})
    return UserOut(username=user.username, is_admin=bool(user.first_account))


@router.post("/invitations", response_model=InvitationOut)
@limiter.limit(lambda: get_settings().register_rate_limit)
def create_invitation(request: Request, user: CurrentUser, db: DbSession) -> InvitationOut:
    """A registered user gets a single-use link token, valid for a few minutes."""
    now = utcnow()
    db.execute(delete(Invitation).where(Invitation.used_at.is_(None), Invitation.expires_at < now))
    token = new_token()
    expires = now + timedelta(minutes=get_settings().invitation_minutes)
    db.add(Invitation(token_hash=token_digest(token), created_by=user.id, expires_at=expires))
    db.commit()
    audit.info("invitation_created", extra={"user_id": user.id, "ip": _ip(request)})
    return InvitationOut(token=token, expires_at=expires)


def _usable(token: str, now: datetime) -> Select[Any]:
    return select(Invitation).where(
        Invitation.token_hash == token_digest(token),
        Invitation.used_at.is_(None),
        Invitation.expires_at > now,
    )


@router.post("/invitations/check", response_model=InvitationCheck)
@limiter.limit(lambda: get_settings().register_rate_limit)
def check_invitation(request: Request, body: TokenIn, db: DbSession) -> InvitationCheck:
    return InvitationCheck(valid=db.scalar(_usable(body.token, utcnow())) is not None)


@router.post("/invitations/accept", response_model=UserOut)
@limiter.limit(lambda: get_settings().register_rate_limit)
def accept_invitation(
    request: Request,
    response: Response,
    body: AcceptIn,
    db: DbSession,
    session: Annotated[str | None, Cookie()] = None,
) -> UserOut:
    now = utcnow()
    # Checked first: otherwise "taken" would tell anyone, with a made-up token, which names exist.
    invitation = db.scalar(_usable(body.token, now))
    if invitation is None:
        audit.warning("invitation_refused", extra={"ip": _ip(request)})
        raise HTTPException(410, "invitation_invalid")
    user = _new_user(db, body.username, body.password)
    # Claimed atomically: of two simultaneous uses of one link, only one gets rowcount 1.
    claimed = db.execute(
        update(Invitation)
        .where(
            Invitation.token_hash == token_digest(body.token),
            Invitation.used_at.is_(None),
            Invitation.expires_at > now,
        )
        .values(used_at=now, used_by=user.id)
    )
    if claimed.rowcount != 1:  # type: ignore[attr-defined]
        db.rollback()
        audit.warning("invitation_refused", extra={"ip": _ip(request)})
        raise HTTPException(410, "invitation_invalid")
    if invitation.team_id:  # sent from the team screen: the new player joins that team
        db.add(TeamMember(user_id=user.id, team_id=invitation.team_id))
    db.commit()
    start_session(db, response, user, session)
    audit.info("register", extra={"user_id": user.id, "ip": _ip(request)})
    return UserOut(username=user.username, is_admin=bool(user.first_account))


@router.post("/login", response_model=UserOut)
@limiter.limit(lambda: get_settings().login_rate_limit)
def login(
    request: Request,
    response: Response,
    body: Credentials,
    db: DbSession,
    session: Annotated[str | None, Cookie()] = None,
) -> UserOut:
    settings = get_settings()
    user = db.scalar(select(User).where(User.username_key == body.username.lower()))
    now = utcnow()
    locked = user is not None and user.locked_until is not None and user.locked_until > now
    # A missing or locked account is verified against a dummy hash: same cost, same answer.
    ok = verify_password(None if user is None or locked else user.password_hash, body.password)
    if not ok or user is None:
        if user is not None and not locked:
            user.failed_logins += 1
            excess = user.failed_logins - settings.lockout_threshold
            if excess >= 0:
                user.locked_until = now + min(timedelta(seconds=30 * 2**excess), MAX_LOCK)
            db.commit()
        audit.warning(
            "login_failed",
            extra={"user_id": user.id if user else None, "locked": locked, "ip": _ip(request)},
        )
        raise HTTPException(401, "credentials")
    user.failed_logins = 0
    user.locked_until = None
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    start_session(db, response, user, session)
    audit.info("login", extra={"user_id": user.id, "ip": _ip(request)})
    return UserOut(username=user.username, is_admin=bool(user.first_account))


@router.post("/logout")
def logout(
    request: Request,
    response: Response,
    db: DbSession,
    session: Annotated[str | None, Cookie()] = None,
) -> dict[str, str]:
    if session:
        db.execute(delete(AuthSession).where(AuthSession.token_hash == token_digest(session)))
        db.commit()
        audit.info("logout", extra={"ip": _ip(request)})
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {}


@router.get("/check", status_code=204)
def check(_: CurrentUser) -> None:
    """Asked by nginx (auth_request) before a map file: 204 with a session, 401 without."""


@router.get("/me", response_model=UserOut)
def me(user: Annotated[User | None, Depends(current_user)], db: DbSession) -> UserOut:
    # 200 either way: not being logged in is a normal state for the page
    enabled = passkeys_enabled()
    if user:
        return UserOut(
            username=user.username, is_admin=bool(user.first_account), passkeys_enabled=enabled
        )
    return UserOut(username=None, setup_required=no_users(db), passkeys_enabled=enabled)


# ---- password: change it, or reset it with a link from the first account ----


def _require_admin(user: CurrentUser) -> User:
    if not user.first_account:
        raise HTTPException(403, "forbidden")
    return user


Admin = Annotated[User, Depends(_require_admin)]


def _set_password(db: Session, user: User, password: str) -> None:
    """New hash, lockout cleared, every session of the account revoked (not committed)."""
    user.password_hash = hash_password(password)
    user.failed_logins = 0
    user.locked_until = None
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))


@router.post("/password", response_model=UserOut)
@limiter.limit(lambda: get_settings().login_rate_limit)
def change_password(
    request: Request,
    response: Response,
    body: ChangePasswordIn,
    user: CurrentUser,
    db: DbSession,
    session: Annotated[str | None, Cookie()] = None,
) -> UserOut:
    # 403, not 401: the front end treats a 401 as "session ended".
    # shortcut: no per-account lockout here (needs a live session first), only the per-IP limit.
    if not verify_password(user.password_hash, body.current_password):
        audit.warning("password_change_refused", extra={"user_id": user.id, "ip": _ip(request)})
        raise HTTPException(403, "current_password")
    if not password_is_acceptable(body.new_password, user.username):
        raise HTTPException(400, "password")
    _set_password(db, user, body.new_password)
    db.commit()
    start_session(db, response, user, session)
    audit.info("password_changed", extra={"user_id": user.id, "ip": _ip(request)})
    return UserOut(username=user.username, is_admin=bool(user.first_account))


@router.post("/delete-account")
@limiter.limit(lambda: get_settings().login_rate_limit)
def delete_account(
    request: Request, response: Response, body: DeleteAccountIn, user: CurrentUser, db: DbSession
) -> dict[str, str]:
    """The player erases their own account and all its progress, after typing their password.
    Not the first account: only it can reset passwords, and nobody could replace it."""
    if user.first_account:
        raise HTTPException(403, "admin_cannot_delete")
    if not verify_password(user.password_hash, body.password):
        audit.warning("account_delete_refused", extra={"user_id": user.id, "ip": _ip(request)})
        raise HTTPException(403, "current_password")
    leave_team(db, user.id)  # the team survives without them
    db.execute(delete(User).where(User.id == user.id))  # marks, settings and sessions cascade
    db.commit()
    response.delete_cookie(SESSION_COOKIE, path="/")
    audit.info("account_deleted", extra={"user_id": user.id, "ip": _ip(request)})
    return {}


@router.get("/users", response_model=list[UserItem])
def list_users(admin: Admin, db: DbSession) -> list[UserItem]:
    rows = db.scalars(select(User).where(User.id != admin.id).order_by(User.username_key))
    return [UserItem(id=u.id, username=u.username) for u in rows]


@router.post("/password-resets", response_model=ResetOut)
@limiter.limit(lambda: get_settings().register_rate_limit)
def create_password_reset(
    request: Request, body: ResetCreateIn, admin: Admin, db: DbSession
) -> ResetOut:
    target = db.get(User, body.user_id)
    if target is None or target.id == admin.id:
        raise HTTPException(404, "user")
    now = utcnow()
    # One live link per account: a new one replaces the previous.
    db.execute(
        delete(PasswordReset).where(
            PasswordReset.user_id == target.id, PasswordReset.used_at.is_(None)
        )
    )
    token = new_token()
    expires = now + timedelta(minutes=get_settings().invitation_minutes)
    db.add(PasswordReset(token_hash=token_digest(token), user_id=target.id, expires_at=expires))
    db.commit()
    audit.info(
        "password_reset_created",
        extra={"user_id": admin.id, "target_id": target.id, "ip": _ip(request)},
    )
    return ResetOut(token=token, expires_at=expires)


def _usable_reset(token: str, now: datetime) -> Select[Any]:
    return select(PasswordReset).where(
        PasswordReset.token_hash == token_digest(token),
        PasswordReset.used_at.is_(None),
        PasswordReset.expires_at > now,
    )


@router.post("/password-resets/check", response_model=ResetCheck)
@limiter.limit(lambda: get_settings().register_rate_limit)
def check_password_reset(request: Request, body: TokenIn, db: DbSession) -> ResetCheck:
    row = db.scalar(_usable_reset(body.token, utcnow()))
    user = db.get(User, row.user_id) if row else None
    return ResetCheck(valid=user is not None, username=user.username if user else None)


@router.post("/password-resets/accept", response_model=UserOut)
@limiter.limit(lambda: get_settings().register_rate_limit)
def accept_password_reset(
    request: Request,
    response: Response,
    body: ResetAcceptIn,
    db: DbSession,
    session: Annotated[str | None, Cookie()] = None,
) -> UserOut:
    now = utcnow()
    row = db.scalar(_usable_reset(body.token, now))
    user = db.get(User, row.user_id) if row else None
    if row is None or user is None:
        audit.warning("password_reset_refused", extra={"ip": _ip(request)})
        raise HTTPException(410, "reset_invalid")
    if not password_is_acceptable(body.password, user.username):
        raise HTTPException(400, "password")
    # Claimed atomically: of two simultaneous uses of one link, only one gets rowcount 1.
    claimed = db.execute(
        update(PasswordReset)
        .where(
            PasswordReset.token_hash == row.token_hash,
            PasswordReset.used_at.is_(None),
            PasswordReset.expires_at > now,
        )
        .values(used_at=now)
    )
    if claimed.rowcount != 1:  # type: ignore[attr-defined]
        db.rollback()
        raise HTTPException(410, "reset_invalid")
    _set_password(db, user, body.password)
    db.commit()
    start_session(db, response, user, session)
    audit.info("password_reset", extra={"user_id": user.id, "ip": _ip(request)})
    return UserOut(username=user.username, is_admin=bool(user.first_account))
