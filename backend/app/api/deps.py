from datetime import timedelta
from typing import Annotated

from fastapi import Cookie, Depends, HTTPException, Request, Response
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.security import new_token, token_digest, tokens_equal
from app.db.base import utcnow
from app.db.models import AuthSession, User
from app.db.session import get_db

SESSION_COOKIE = "session"
CSRF_COOKIE = "XSRF-TOKEN"
CSRF_HEADER = "X-XSRF-TOKEN"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}
SLIDE_AFTER = timedelta(hours=1)  # expiry is pushed forward at most once per hour

DbSession = Annotated[Session, Depends(get_db)]


def csrf_protect(request: Request, response: Response) -> None:
    """Double-submit cookie: unsafe requests must echo the XSRF-TOKEN cookie in a header."""
    cookie = request.cookies.get(CSRF_COOKIE)
    if request.method in SAFE_METHODS:
        if not cookie:
            response.set_cookie(
                CSRF_COOKIE,
                new_token(),
                samesite="strict",
                secure=get_settings().cookie_secure,
                path="/",
            )  # readable by the page's JavaScript on purpose
        return
    header = request.headers.get(CSRF_HEADER)
    if not cookie or not header or not tokens_equal(cookie, header):
        raise HTTPException(403, "csrf")


def set_session_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.session_days * 86400,
        httponly=True,
        samesite="strict",
        secure=settings.cookie_secure,
        path="/",
    )


def start_session(db: Session, response: Response, user: User, old_token: str | None) -> None:
    """New session for the user; the presented one (if any) is revoked (rotation)."""
    now = utcnow()
    if old_token:
        db.execute(delete(AuthSession).where(AuthSession.token_hash == token_digest(old_token)))
    db.execute(delete(AuthSession).where(AuthSession.expires_at < now))
    token = new_token()
    db.add(
        AuthSession(
            token_hash=token_digest(token),
            user_id=user.id,
            expires_at=now + timedelta(days=get_settings().session_days),
        )
    )
    db.commit()
    set_session_cookie(response, token)


def current_user(
    response: Response,
    db: DbSession,
    session: Annotated[str | None, Cookie()] = None,
) -> User | None:
    if not session:
        return None
    now = utcnow()
    row = db.scalar(
        select(AuthSession).where(
            AuthSession.token_hash == token_digest(session), AuthSession.expires_at > now
        )
    )
    if row is None:
        return None
    lifetime = timedelta(days=get_settings().session_days)
    if row.expires_at - now < lifetime - SLIDE_AFTER:
        row.expires_at = now + lifetime
        db.commit()
        set_session_cookie(response, session)
    return db.get(User, row.user_id)


def require_user(user: Annotated[User | None, Depends(current_user)]) -> User:
    if user is None:
        raise HTTPException(401, "login")
    return user


CurrentUser = Annotated[User, Depends(require_user)]
