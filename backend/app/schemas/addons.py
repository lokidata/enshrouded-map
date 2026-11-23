from typing import Literal

from app.schemas.common import StrictModel

Level = Literal["read", "action"]


class AddonOut(StrictModel):
    id: str
    key: str
    name: dict[str, str]
    element: str
    capabilities: list[str]
    script: str
    styles: str
    level: Level


class AddonAdminOut(StrictModel):
    id: str
    key: str
    name: dict[str, str]
    description: dict[str, str]
    capabilities: list[str]
    version: str
    enabled: bool


class EnabledIn(StrictModel):
    enabled: bool


class AccessOut(StrictModel):
    user_id: int
    username: str
    level: Level | None


class AccessIn(StrictModel):
    level: Level | None


class MeOut(StrictModel):
    user_key: str
    username: str
    is_admin: bool
    level: Level
