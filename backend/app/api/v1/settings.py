import json
from typing import Any

from fastapi import APIRouter, HTTPException
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DbSession
from app.core.config import get_settings
from app.db.models import UserSettings
from app.schemas.settings import SettingsIn, SettingsOut

router = APIRouter(prefix="/settings", tags=["settings"])


def _keep_language(new: dict[str, Any], old: dict[str, Any] | None) -> dict[str, Any]:
    """The blob is replaced as a whole, but a client that sends no language (a stale tab, an older
    front end) must not erase the one the account already has."""
    if old and "lang" in old and "lang" not in new:
        return {**new, "lang": old["lang"]}
    return new


@router.get("", response_model=SettingsOut)
def get_user_settings(user: CurrentUser, db: DbSession) -> SettingsOut:
    row = db.get(UserSettings, user.id)
    return SettingsOut(settings=row.data if row else None)


@router.put("")
def put_user_settings(body: SettingsIn, user: CurrentUser, db: DbSession) -> dict[str, str]:
    size = len(json.dumps(body.settings, ensure_ascii=False, separators=(",", ":")).encode())
    if size > get_settings().max_settings_bytes:
        raise HTTPException(400, "settings_too_large")
    row = db.get(UserSettings, user.id)
    if row is None:
        db.add(UserSettings(user_id=user.id, data=body.settings))
    else:
        row.data = _keep_language(body.settings, row.data)
    try:
        db.commit()
    except (
        IntegrityError
    ):  # two first saves at once: the other one made the row, this one updates it
        db.rollback()
        row = db.get_one(UserSettings, user.id)
        row.data = _keep_language(body.settings, row.data)
        db.commit()
    return {}
