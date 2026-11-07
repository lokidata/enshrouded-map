from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints, field_validator

from app.schemas.common import StrictModel

MAX_LEVEL = 3  # the most levels a skill node has in the game
MAX_NODES = 400  # the tree has 243


class BuildIn(StrictModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    nodes: dict[str, int] = Field(max_length=MAX_NODES)

    @field_validator("nodes")
    @classmethod
    def _levels(cls, nodes: dict[str, int]) -> dict[str, int]:
        for key, level in nodes.items():
            if not (key.isascii() and key.isdigit() and len(key) <= 10):
                raise ValueError("node ids are numbers")
            if not 1 <= level <= MAX_LEVEL:
                raise ValueError(f"a level is 1 to {MAX_LEVEL}")
        return nodes


class BuildOut(BaseModel):
    id: int
    name: str
    nodes: dict[str, int]
    updated_at: datetime
