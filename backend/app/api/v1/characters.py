from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DbSession
from app.core.config import get_settings
from app.core.logging import audit
from app.db.models import ActiveCharacter, Character
from app.db.queries import active_character
from app.schemas.team import NameIn

router = APIRouter(prefix="/characters", tags=["characters"])


class CharacterOut(BaseModel):
    id: int
    name: str
    active: bool


def _list(db: DbSession, user: CurrentUser) -> list[CharacterOut]:
    active = active_character(db, user).id
    rows = db.scalars(select(Character).where(Character.user_id == user.id).order_by(Character.id))
    return [CharacterOut(id=c.id, name=c.name, active=c.id == active) for c in rows]


def _own(db: DbSession, user: CurrentUser, character_id: int) -> Character:
    character = db.scalar(
        select(Character).where(Character.id == character_id, Character.user_id == user.id)
    )
    if character is None:
        raise HTTPException(404, "character_not_found")  # also for someone else's profile
    return character


@router.get("", response_model=list[CharacterOut])
def list_characters(user: CurrentUser, db: DbSession) -> list[CharacterOut]:
    return _list(db, user)


@router.post("", response_model=list[CharacterOut])
def create_character(body: NameIn, user: CurrentUser, db: DbSession) -> list[CharacterOut]:
    """A new profile, which becomes the one followed."""
    active_character(db, user)  # the first one exists before a second is added
    count = db.scalar(
        select(func.count()).select_from(Character).where(Character.user_id == user.id)
    )
    if (count or 0) >= get_settings().max_characters:
        raise HTTPException(409, "too_many_characters")
    character = Character(user_id=user.id, name=body.name)
    db.add(character)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "name_taken") from None
    db.merge(ActiveCharacter(user_id=user.id, character_id=character.id))
    db.commit()
    return _list(db, user)


@router.post("/{character_id}/activate", response_model=list[CharacterOut])
def activate_character(character_id: int, user: CurrentUser, db: DbSession) -> list[CharacterOut]:
    character = _own(db, user, character_id)
    db.merge(ActiveCharacter(user_id=user.id, character_id=character.id))
    db.commit()
    return _list(db, user)


@router.patch("/{character_id}", response_model=list[CharacterOut])
def rename_character(
    character_id: int, body: NameIn, user: CurrentUser, db: DbSession
) -> list[CharacterOut]:
    character = _own(db, user, character_id)
    character.name = body.name
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "name_taken") from None
    return _list(db, user)


@router.delete("/{character_id}", response_model=list[CharacterOut])
def delete_character(character_id: int, user: CurrentUser, db: DbSession) -> list[CharacterOut]:
    """Deletes a profile with its marks and builds; the last one cannot go."""
    character = _own(db, user, character_id)
    others = db.scalars(
        select(Character.id)
        .where(Character.user_id == user.id, Character.id != character.id)
        .order_by(Character.id)
    ).all()
    if not others:
        raise HTTPException(409, "last_character")
    if active_character(db, user).id == character.id:
        db.merge(ActiveCharacter(user_id=user.id, character_id=others[0]))
        db.flush()
    db.delete(character)
    db.commit()
    audit.info("character_deleted", extra={"user_id": user.id, "character_id": character_id})
    return _list(db, user)
