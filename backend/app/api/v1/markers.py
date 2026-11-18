from fastapi import APIRouter, HTTPException, Response
from sqlalchemy import func, select

from app.api.deps import CurrentUser, DbSession
from app.core.config import get_settings
from app.db.models import CustomMarker, TeamMember, User
from app.db.queries import active_character
from app.schemas.markers import MarkerIn, MarkerOut

router = APIRouter(prefix="/markers", tags=["markers"])


def out(m: CustomMarker) -> MarkerOut:
    return MarkerOut(
        id=m.id,
        x=m.x,
        z=m.z,
        name=m.name,
        note=m.note,
        kind=m.kind,
        level=m.level,
        icon=m.icon,
        color=m.color,
        shared=m.shared,
    )


def _check_share(db: DbSession, user_id: int, body: MarkerIn) -> None:
    """Sharing is for a team: with none a marker stays private."""
    if body.shared and db.get(TeamMember, user_id) is None:
        raise HTTPException(409, "no_team")


def _mine(db: DbSession, user: User, marker_id: int) -> CustomMarker:
    cid = active_character(db, user).id
    row = db.get(CustomMarker, marker_id)
    if row is None or row.character_id != cid:
        raise HTTPException(404, "no_marker")
    return row


@router.get("", response_model=list[MarkerOut])
def list_markers(user: CurrentUser, db: DbSession) -> list[MarkerOut]:
    cid = active_character(db, user).id
    rows = db.scalars(
        select(CustomMarker).where(CustomMarker.character_id == cid).order_by(CustomMarker.id)
    )
    return [out(m) for m in rows]


@router.post("", response_model=MarkerOut, status_code=201)
def add_marker(body: MarkerIn, user: CurrentUser, db: DbSession) -> MarkerOut:
    cid = active_character(db, user).id
    count = db.scalar(select(func.count()).where(CustomMarker.character_id == cid))
    if (count or 0) >= get_settings().max_markers:
        raise HTTPException(409, "too_many_markers")
    _check_share(db, user.id, body)
    row = CustomMarker(character_id=cid, **body.model_dump())
    db.add(row)
    db.commit()
    return out(row)


@router.patch("/{marker_id}", response_model=MarkerOut)
def change_marker(marker_id: int, body: MarkerIn, user: CurrentUser, db: DbSession) -> MarkerOut:
    """Replaces every field of one of my markers (the position moves with it)."""
    row = _mine(db, user, marker_id)
    _check_share(db, user.id, body)
    for field, value in body.model_dump().items():
        setattr(row, field, value)
    db.commit()
    return out(row)


@router.delete("/{marker_id}", status_code=204)
def delete_marker(marker_id: int, user: CurrentUser, db: DbSession) -> Response:
    db.delete(_mine(db, user, marker_id))
    db.commit()
    return Response(status_code=204)
