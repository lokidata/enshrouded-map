from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

from app.schemas.common import StrictModel

# A map element ("category:x:z") or a workshop recipe ("recipe:<guid>").
MarkId = Annotated[
    str,
    StringConstraints(
        pattern=r"^([A-Za-z]+:-?\d+:-?\d+|recipe:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12})$",
        max_length=64,
    ),
]


class ProgressIn(StrictModel):
    ids: list[MarkId] = Field(max_length=50_000)
    done: bool = True


class ProgressOut(BaseModel):
    marks: list[str]
