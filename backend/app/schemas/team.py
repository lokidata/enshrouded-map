from typing import Annotated

from pydantic import BaseModel, StringConstraints

from app.schemas.common import StrictModel

TeamName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]


class NameIn(StrictModel):
    name: TeamName


class MemberIn(StrictModel):
    user_id: int


class Member(BaseModel):
    id: int
    username: str


class TeamOut(BaseModel):
    id: int
    name: str
    owner_id: int
    is_owner: bool
    members: list[Member]


class TeamMarks(BaseModel):
    """Mark id -> ids of the other team members who marked it."""

    marks: dict[str, list[int]]
