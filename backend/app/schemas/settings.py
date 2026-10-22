from typing import Any

from pydantic import BaseModel

from app.schemas.common import StrictModel


class SettingsIn(StrictModel):
    settings: dict[str, Any]


class SettingsOut(BaseModel):
    settings: dict[str, Any] | None
