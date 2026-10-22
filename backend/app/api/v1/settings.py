import json

from fastapi import APIRouter, HTTPException

from app.api.deps import CurrentUser, DbSession
from app.core.config import get_settings
from app.db.models import UserSettings
from app.schemas.settings import SettingsIn, SettingsOut

router = APIRouter(prefix="/settings", tags=["settings"])


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
        row.data = body.settings
    db.commit()
    return {}
