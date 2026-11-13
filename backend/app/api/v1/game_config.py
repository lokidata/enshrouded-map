import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DbSession
from app.core.config import get_settings
from app.db.models import GameConfig, Team, TeamMember
from app.schemas.settings import SettingsIn

router = APIRouter(prefix="/game-config", tags=["game-config"])


class ConfigOut(BaseModel):
    config: dict[str, object] | None
    can_edit: bool
    scope: str  # "team" or "user"


def _scope(db: DbSession, user: CurrentUser) -> tuple[str, int, bool]:
    """The configuration the player sees (team, else own) and whether they may edit it."""
    member = db.get(TeamMember, user.id)
    team = db.get(Team, member.team_id) if member else None
    if team is None:
        return "user", user.id, True
    return "team", team.id, team.owner_id == user.id


def _row(db: DbSession, scope: str, key: int) -> GameConfig | None:
    col = GameConfig.team_id if scope == "team" else GameConfig.user_id
    return db.scalar(select(GameConfig).where(col == key))


@router.get("", response_model=ConfigOut)
def get_config(user: CurrentUser, db: DbSession) -> ConfigOut:
    scope, key, can_edit = _scope(db, user)
    row = _row(db, scope, key)
    return ConfigOut(config=row.data if row else None, can_edit=can_edit, scope=scope)


@router.put("", response_model=ConfigOut)
def put_config(body: SettingsIn, user: CurrentUser, db: DbSession) -> ConfigOut:
    scope, key, can_edit = _scope(db, user)
    if not can_edit:
        raise HTTPException(403, "forbidden")
    size = len(json.dumps(body.settings, ensure_ascii=False, separators=(",", ":")).encode())
    if size > get_settings().max_settings_bytes:
        raise HTTPException(400, "settings_too_large")
    row = _row(db, scope, key)
    if row is None:
        db.add(GameConfig(**{"team_id" if scope == "team" else "user_id": key}, data=body.settings))
    else:
        row.data = body.settings
    try:
        db.commit()
    except (
        IntegrityError
    ):  # two first saves at once: the other one made the row, this one updates it
        db.rollback()
        found = _row(db, scope, key)
        if found is None:
            raise HTTPException(409, "conflict") from None
        found.data = body.settings
        db.commit()
    return ConfigOut(config=body.settings, can_edit=True, scope=scope)
