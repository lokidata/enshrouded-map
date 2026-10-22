from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

from app.schemas.common import StrictModel

MarkId = Annotated[str, StringConstraints(pattern=r"^[A-Za-z]+:-?\d+:-?\d+$", max_length=64)]


class ProgressIn(StrictModel):
    ids: list[MarkId] = Field(max_length=50_000)
    done: bool = True


class ProgressOut(BaseModel):
    marks: list[str]
