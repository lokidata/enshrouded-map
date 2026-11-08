import re
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, Field, StringConstraints, field_validator

from app.schemas.common import StrictModel

MAX_LEVEL = 3  # the most levels a skill node has in the game
MAX_NODES = 400  # the tree has 243
SLOTS = frozenset(
    [
        "head",
        "chest",
        "legs",
        "hands",
        "feet",
        "ring1",
        "ring2",
        "weapon1",
        "weapon2",
        "weapon3",
        "shield",
        "ranged",
    ]
)  # equipment slots
MAX_UPGRADES = 8  # per piece (the data has 5 at most)
MAX_UPGRADE_INDEX = 64
GUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def _gear(gear: dict[str, str]) -> dict[str, str]:
    for slot, guid in gear.items():
        if slot not in SLOTS:
            raise ValueError("unknown slot")
        if not GUID.fullmatch(guid):
            raise ValueError("item ids are lowercase guids")
    return gear


def _upgrades(upgrades: dict[str, list[int]]) -> dict[str, list[int]]:
    for slot, picks in upgrades.items():
        if slot not in SLOTS:
            raise ValueError("unknown slot")
        if len(picks) > MAX_UPGRADES or not all(0 <= i < MAX_UPGRADE_INDEX for i in picks):
            raise ValueError("bad upgrades")
    return upgrades


class BuildIn(StrictModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
    nodes: dict[str, int] = Field(max_length=MAX_NODES)
    level: int = Field(default=1, ge=1, le=200)
    flame: int = Field(default=0, ge=0, le=50)
    gear: dict[str, str] = Field(default_factory=dict, max_length=len(SLOTS))
    upgrades: dict[str, list[int]] = Field(default_factory=dict, max_length=len(SLOTS))

    @field_validator("nodes")
    @classmethod
    def _levels(cls, nodes: dict[str, int]) -> dict[str, int]:
        for key, level in nodes.items():
            if not (key.isascii() and key.isdigit() and len(key) <= 10):
                raise ValueError("node ids are numbers")
            if not 1 <= level <= MAX_LEVEL:
                raise ValueError(f"a level is 1 to {MAX_LEVEL}")
        return nodes

    _slots = field_validator("gear")(_gear)
    _picks = field_validator("upgrades")(_upgrades)


class BuildOut(BaseModel):
    id: int
    name: str
    nodes: dict[str, int]
    level: int = 1
    flame: int = 0
    gear: dict[str, str] = Field(default_factory=dict)
    upgrades: dict[str, list[int]] = Field(default_factory=dict)
    updated_at: datetime
