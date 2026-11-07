from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints

from app.schemas.common import StrictModel

# Marks: a map element ("category:x:z"), a known recipe ("recipe:<guid>"), a found note
# ("lore:<id>"), a found page of a note ("lore:<id>:<page>", shaped like a map element),
# a finished quest ("quest:<id>").
MarkId = Annotated[
    str,
    StringConstraints(
        pattern=r"^([A-Za-z]+:-?\d+:-?\d+|recipe:[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}|lore:[0-9]{1,10}|quest:[0-9]{1,10})$",
        max_length=64,
    ),
]


class ProgressIn(StrictModel):
    ids: list[MarkId] = Field(max_length=50_000)
    done: bool = True


class ProgressOut(BaseModel):
    marks: list[str]
