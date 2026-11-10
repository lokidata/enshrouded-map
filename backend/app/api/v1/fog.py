import base64
import binascii

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import delete

from app.api.deps import CurrentUser, DbSession
from app.db.models import Fog
from app.db.queries import active_character
from app.schemas.common import StrictModel

router = APIRouter(prefix="/fog", tags=["fog"])

FOG_CELLS = 1280 * 1280  # the game's grid: 8 m per cell over the 10,240 m world
FOG_BYTES = FOG_CELLS // 8


class FogIn(StrictModel):
    bits: str = Field(max_length=FOG_BYTES * 4 // 3 + 8)  # base64 of FOG_BYTES bytes
    shared: bool = False


class SharedIn(StrictModel):
    shared: bool


class FogOut(BaseModel):
    """What the profile followed has stored: its area (a bit per cell), and if the team sees it."""

    bits: str | None
    shared: bool
    updated_at: str | None  # tells another browser that its cached copy is old


def _out(row: Fog | None) -> FogOut:
    if row is None:
        return FogOut(bits=None, shared=False, updated_at=None)
    return FogOut(
        bits=base64.b64encode(row.bits).decode(),
        shared=row.shared,
        updated_at=row.updated_at.isoformat(),
    )


@router.get("", response_model=FogOut)
def get_fog(user: CurrentUser, db: DbSession) -> FogOut:
    return _out(db.get(Fog, active_character(db, user).id))


@router.put("", response_model=FogOut)
def store_fog(body: FogIn, user: CurrentUser, db: DbSession) -> FogOut:
    """Keeps the explored area of the profile followed; private unless shared."""
    try:
        bits = base64.b64decode(body.bits, validate=True)
    except binascii.Error:
        raise HTTPException(422, "invalid_request") from None
    if len(bits) != FOG_BYTES:
        raise HTTPException(422, "invalid_request")
    cid = active_character(db, user).id
    row = db.get(Fog, cid)
    if row is None:
        row = Fog(character_id=cid, bits=bits, shared=body.shared)
        db.add(row)
    else:
        row.bits = bits
        row.shared = body.shared
    db.commit()
    return _out(row)


@router.patch("", response_model=FogOut)
def share_fog(body: SharedIn, user: CurrentUser, db: DbSession) -> FogOut:
    """Shows the stored area to the team, or hides it again."""
    row = db.get(Fog, active_character(db, user).id)
    if row is None:
        raise HTTPException(404, "no_fog")
    row.shared = body.shared
    db.commit()
    return _out(row)


@router.delete("", response_model=FogOut)
def delete_fog(user: CurrentUser, db: DbSession) -> FogOut:
    db.execute(delete(Fog).where(Fog.character_id == active_character(db, user).id))
    db.commit()
    return _out(None)
