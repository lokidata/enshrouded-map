from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

from app.schemas.common import StrictModel

Username = Annotated[str, StringConstraints(pattern=r"^[A-Za-z0-9_.-]{3,32}$")]


class Credentials(StrictModel):
    username: Username
    password: str = Field(max_length=128)


class TokenIn(StrictModel):
    token: str = Field(max_length=128)


class AcceptIn(Credentials):
    token: str = Field(max_length=128)


class UserOut(BaseModel):
    username: str | None  # None when logged out: a normal state for the page
    setup_required: bool = False  # no account exists yet: the first one must be created


class InvitationOut(BaseModel):
    token: str
    expires_at: datetime


class InvitationCheck(BaseModel):
    valid: bool
