from datetime import datetime
from typing import Annotated, Any

from pydantic import BaseModel, Field, StringConstraints, model_serializer

from app.schemas.common import StrictModel

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
    # Sent by /me for a logged-in user (the optional server add-on identifies accounts with them).
    id: int | None = None
    created_at: datetime | None = None
    addon: bool = False  # ADDON_URL is set: the page shows the add-on's menu entry

    @model_serializer(mode="wrap")
    def _omit_empty_identity(self, handler: Any) -> dict[str, Any]:
        out: dict[str, Any] = handler(self)
        if self.id is None:
            out.pop("id", None)
            out.pop("created_at", None)
        return out


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
