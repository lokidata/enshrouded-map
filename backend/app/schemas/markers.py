from typing import Annotated, Literal, Self

from pydantic import BaseModel, Field, StringConstraints, model_validator

from app.schemas.common import StrictModel

WORLD = 10_240  # metres, the same integers as the mark ids

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]


class MarkerIn(StrictModel):
    """Plain text only: the front end shows `name` and `note` as text, never as HTML."""

    x: int = Field(ge=0, le=WORLD)
    z: int = Field(ge=0, le=WORLD)
    name: Name
    note: str = Field(default="", max_length=500)
    kind: Literal["pin", "altar"]
    level: int | None = Field(default=None, ge=1, le=4)
    icon: str | None = Field(
        default=None, pattern=r"^[A-Za-z0-9_]{1,32}$"
    )  # a pin's map icon (category key)
    color: str | None = Field(default=None, pattern=r"^[a-z]{1,16}$")  # one of the game's 8 colours
    shared: bool = False

    @model_validator(mode="after")
    def _level_goes_with_altar(self) -> Self:
        if (self.kind == "altar") != (self.level is not None):
            raise ValueError("level is for altars only")
        if self.kind == "altar" and (self.icon is not None or self.color is not None):
            raise ValueError("an altar has its own icon and colour")
        return self


class MarkerOut(BaseModel):
    id: int
    x: int
    z: int
    name: str
    note: str
    kind: str
    level: int | None
    icon: str | None
    color: str | None
    shared: bool


class MemberMarkers(BaseModel):
    user_id: int
    username: str
    markers: list[MarkerOut]


class TeamMarkers(BaseModel):
    """The other members' shared markers, one entry per member who shares at least one."""

    members: list[MemberMarkers]
