from datetime import datetime
from pathlib import Path
from typing import TYPE_CHECKING, Annotated, Any

from pydantic import BaseModel, Field, StringConstraints, model_serializer

from app.core.addons import KEY_RE, configured_origins
from app.core.config import get_settings
from app.schemas.common import StrictModel

if TYPE_CHECKING:
    from app.db.models import User

Username = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_.-]{3,32}$")]


class Credentials(StrictModel):
    username: Username
    password: str = Field(max_length=128)


class SetupIn(Credentials):
    setup_token: str = Field(max_length=128)


class TokenIn(StrictModel):
    token: str = Field(max_length=128)


class AcceptIn(Credentials):
    token: str = Field(max_length=128)


class UserOut(BaseModel):
    username: str | None  # None when logged out: a normal state for the page
    setup_required: bool = False  # no account exists yet: the first one must be created
    is_admin: bool = False  # the first account: can generate password reset links
    passkeys_enabled: bool = False  # the server is configured for passkeys (sent by /me only)
    # Sent by /me when logged in. Add-ons no longer need them (they use /addons/{id}/me).
    id: int | None = None
    created_at: datetime | None = None
    addon: bool = False  # any add-on is configured (ADDONS, ADDON_URL or a static folder)

    @model_serializer(mode="wrap")
    def _omit_empty_identity(self, handler: Any) -> dict[str, Any]:
        out: dict[str, Any] = handler(self)
        if self.id is None:
            out.pop("id", None)
            out.pop("created_at", None)
        return out


def _has_addons() -> bool:
    """A container is configured or the static folder holds a `<key>/addon.json`."""
    settings = get_settings()
    try:
        if configured_origins(settings):
            return True
    except ValueError:  # a bad ADDONS value must not break login
        pass
    return any(
        KEY_RE.fullmatch(p.parent.name) for p in Path(settings.addons_dir).glob("*/addon.json")
    )


def logged_in_user(user: "User", passkeys_enabled: bool = False) -> UserOut:
    """The answer for a logged-in user, the same for /me, login, setup, accept and passkey login."""
    return UserOut(
        username=user.username,
        is_admin=bool(user.first_account),
        passkeys_enabled=passkeys_enabled,
        id=user.id,
        created_at=user.created_at,
        addon=_has_addons(),
    )


class InvitationOut(BaseModel):
    token: str
    expires_at: datetime


class InvitationCheck(BaseModel):
    valid: bool


class DeleteAccountIn(StrictModel):
    password: str = Field(max_length=128)


class ChangePasswordIn(StrictModel):
    current_password: str = Field(max_length=128)
    new_password: str = Field(max_length=128)


class UserItem(BaseModel):
    id: int
    username: str
    created_at: datetime  # with id, the stable key of an account (ids can be reused)


class ResetCreateIn(StrictModel):
    user_id: int


class ResetOut(BaseModel):
    token: str
    expires_at: datetime


class ResetCheck(BaseModel):
    valid: bool
    username: str | None = None


class ResetAcceptIn(StrictModel):
    token: str = Field(max_length=128)
    password: str = Field(max_length=128)
