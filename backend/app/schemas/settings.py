from typing import Any

from pydantic import BaseModel, field_validator

from app.schemas.common import StrictModel

# The site's languages: keep in step with LANGUAGES in frontend/src/app/core/lang.ts.
LANGUAGES = ("fr", "en", "de")


class SettingsIn(StrictModel):
    settings: dict[str, Any]

    @field_validator("settings")
    @classmethod
    def known_language(cls, value: dict[str, Any]) -> dict[str, Any]:
        if "lang" in value and value["lang"] not in LANGUAGES:
            raise ValueError("unsupported language")
        return value


class SettingsOut(BaseModel):
    settings: dict[str, Any] | None
