from datetime import datetime
from typing import Annotated, Any

from fastapi import APIRouter, Cookie, HTTPException, Request, Response
from pydantic import BaseModel, StringConstraints
from sqlalchemy import delete, select
from webauthn import (
    generate_authentication_options,
    generate_registration_options,
    verify_authentication_response,
    verify_registration_response,
)
from webauthn.helpers import base64url_to_bytes, bytes_to_base64url, options_to_json_dict
from webauthn.helpers.exceptions import (
    InvalidAuthenticationResponse,
    InvalidJSONStructure,
    InvalidRegistrationResponse,
)
from webauthn.helpers.structs import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.api.deps import CurrentUser, DbSession, start_session
from app.api.limiter import limiter
from app.core import passkeys as challenges
from app.core.config import get_settings
from app.core.logging import audit
from app.db.base import utcnow
from app.db.models import Passkey, User
from app.schemas.auth import UserOut
from app.schemas.common import StrictModel

router = APIRouter(prefix="/auth/passkeys", tags=["passkeys"])

COOKIE = "webauthn"
PasskeyName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]


class RegisterIn(StrictModel):
    name: PasskeyName
    credential: dict[str, Any]


class LoginIn(StrictModel):
    credential: dict[str, Any]


class PasskeyOut(BaseModel):
    id: int
    name: str
    created_at: datetime
    last_used_at: datetime | None


def _ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _send_challenge(response: Response, challenge: bytes, purpose: str) -> None:
    response.set_cookie(
        COOKIE,
        challenges.remember(challenge, purpose),
        max_age=challenges.CHALLENGE_SECONDS,
        httponly=True,
        samesite="strict",
        secure=get_settings().cookie_secure,
        path="/api/v1/auth/passkeys",
    )


@router.get("", response_model=list[PasskeyOut])
def list_passkeys(user: CurrentUser, db: DbSession) -> list[Passkey]:
    challenges.require_enabled()
    return list(db.scalars(select(Passkey).where(Passkey.user_id == user.id).order_by(Passkey.id)))


@router.delete("/{passkey_id}")
def delete_passkey(passkey_id: int, user: CurrentUser, db: DbSession) -> dict[str, str]:
    challenges.require_enabled()
    removed = db.execute(
        delete(Passkey).where(Passkey.id == passkey_id, Passkey.user_id == user.id)
    )
    if removed.rowcount != 1:  # type: ignore[attr-defined]
        raise HTTPException(404, "no_passkey")
    db.commit()
    return {}


@router.post("/register/options")
@limiter.limit(lambda: get_settings().login_rate_limit)
def register_options(
    request: Request, response: Response, user: CurrentUser, db: DbSession
) -> dict[str, Any]:
    challenges.require_enabled()
    settings = get_settings()
    known = db.scalars(select(Passkey.credential_id).where(Passkey.user_id == user.id))
    options = generate_registration_options(
        rp_id=settings.webauthn_rp_id,
        rp_name=settings.webauthn_rp_name,
        user_id=str(user.id).encode(),
        user_name=user.username,
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.REQUIRED,  # discoverable: no user name to type
            user_verification=UserVerificationRequirement.REQUIRED,
        ),
        exclude_credentials=[
            PublicKeyCredentialDescriptor(id=base64url_to_bytes(c)) for c in known
        ],  # the same device is not registered twice
    )
    _send_challenge(response, options.challenge, "register")
    return options_to_json_dict(options)


@router.post("/register/verify", response_model=PasskeyOut)
@limiter.limit(lambda: get_settings().login_rate_limit)
def register_verify(
    request: Request,
    response: Response,
    body: RegisterIn,
    user: CurrentUser,
    db: DbSession,
    webauthn: Annotated[str | None, Cookie()] = None,
) -> Passkey:
    challenges.require_enabled()
    settings = get_settings()
    challenge = challenges.take(webauthn, "register")
    response.delete_cookie(COOKIE, path="/api/v1/auth/passkeys")
    try:
        verified = verify_registration_response(
            credential=body.credential,
            expected_challenge=challenge,
            expected_rp_id=settings.webauthn_rp_id,
            expected_origin=settings.webauthn_origin,
            require_user_verification=True,
        )
    except (InvalidRegistrationResponse, InvalidJSONStructure):
        audit.warning("passkey_register_refused", extra={"user_id": user.id, "ip": _ip(request)})
        raise HTTPException(400, "passkey") from None
    credential_id = bytes_to_base64url(verified.credential_id)
    if db.scalar(select(Passkey.id).where(Passkey.credential_id == credential_id)):
        raise HTTPException(409, "passkey_known")
    passkey = Passkey(
        user_id=user.id,
        credential_id=credential_id,
        public_key=verified.credential_public_key,
        sign_count=verified.sign_count,
        name=body.name,
    )
    db.add(passkey)
    db.commit()
    audit.info("passkey_added", extra={"user_id": user.id, "ip": _ip(request)})
    return passkey


@router.post("/login/options")
@limiter.limit(lambda: get_settings().login_rate_limit)
def login_options(request: Request, response: Response) -> dict[str, Any]:
    challenges.require_enabled()
    options = generate_authentication_options(
        rp_id=get_settings().webauthn_rp_id,
        user_verification=UserVerificationRequirement.REQUIRED,
    )  # no allowed credentials: the device offers the passkeys it holds for this site
    _send_challenge(response, options.challenge, "login")
    return options_to_json_dict(options)


@router.post("/login/verify", response_model=UserOut)
@limiter.limit(lambda: get_settings().login_rate_limit)
def login_verify(
    request: Request,
    response: Response,
    body: LoginIn,
    db: DbSession,
    webauthn: Annotated[str | None, Cookie()] = None,
    session: Annotated[str | None, Cookie()] = None,
) -> UserOut:
    challenges.require_enabled()
    settings = get_settings()
    challenge = challenges.take(webauthn, "login")
    response.delete_cookie(COOKIE, path="/api/v1/auth/passkeys")
    credential_id = body.credential.get("id")
    passkey = (
        db.scalar(select(Passkey).where(Passkey.credential_id == credential_id))
        if isinstance(credential_id, str)
        else None
    )
    refused = HTTPException(401, "credentials")
    if passkey is None:
        audit.warning("passkey_login_failed", extra={"ip": _ip(request)})
        raise refused
    try:
        verified = verify_authentication_response(
            credential=body.credential,
            expected_challenge=challenge,
            expected_rp_id=settings.webauthn_rp_id,
            expected_origin=settings.webauthn_origin,
            credential_public_key=passkey.public_key,
            credential_current_sign_count=passkey.sign_count,
            require_user_verification=True,
        )
    except (InvalidAuthenticationResponse, InvalidJSONStructure):
        audit.warning(
            "passkey_login_failed", extra={"user_id": passkey.user_id, "ip": _ip(request)}
        )
        raise refused from None
    user = db.get(User, passkey.user_id)
    if user is None:  # cannot happen: the passkey goes with its account
        raise refused
    passkey.sign_count = verified.new_sign_count
    passkey.last_used_at = utcnow()
    start_session(db, response, user, session)
    audit.info("passkey_login", extra={"user_id": user.id, "ip": _ip(request)})
    return UserOut(username=user.username, is_admin=bool(user.first_account))
