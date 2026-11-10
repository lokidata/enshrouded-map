from itertools import batched

from fastapi import APIRouter, HTTPException
from sqlalchemy import delete, func, insert, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DbSession
from app.core.config import get_settings
from app.db.base import utcnow
from app.db.models import Mark
from app.db.queries import active_character
from app.schemas.progress import ProgressIn, ProgressOut

router = APIRouter(prefix="/progress", tags=["progress"])

CHUNK = 500  # keeps IN (...) lists well under every dialect's parameter limit


@router.get("", response_model=ProgressOut)
def get_progress(user: CurrentUser, db: DbSession) -> ProgressOut:
    cid = active_character(db, user).id
    rows = db.scalars(
        select(Mark.mark_id).where(Mark.character_id == cid).order_by(Mark.created_at)
    )
    return ProgressOut(marks=list(rows))


@router.put("")
def put_progress(body: ProgressIn, user: CurrentUser, db: DbSession) -> dict[str, str]:
    cid = active_character(db, user).id
    ids = list(dict.fromkeys(body.ids))
    try:
        _apply(db, cid, ids, body.done)
    except IntegrityError:
        # A concurrent request inserted the same marks between our read and our write: the
        # second pass sees them and inserts only what is left (the request is idempotent).
        db.rollback()
        try:
            _apply(db, cid, ids, body.done)
        except IntegrityError:
            db.rollback()
            raise HTTPException(409, "conflict") from None
    return {}


def _apply(db: DbSession, character_id: int, ids: list[str], done: bool) -> None:
    if done:
        existing: set[str] = set()
        for chunk in batched(ids, CHUNK):
            existing.update(
                db.scalars(
                    select(Mark.mark_id).where(
                        Mark.character_id == character_id, Mark.mark_id.in_(chunk)
                    )
                )
            )
        new = [i for i in ids if i not in existing]
        count = db.scalar(
            select(func.count()).select_from(Mark).where(Mark.character_id == character_id)
        )
        if (count or 0) + len(new) > get_settings().max_marks:
            raise HTTPException(413, "too_many_marks")
        if new:
            now = utcnow()
            db.execute(
                insert(Mark),
                [{"character_id": character_id, "mark_id": i, "created_at": now} for i in new],
            )
    else:
        for chunk in batched(ids, CHUNK):
            db.execute(
                delete(Mark).where(Mark.character_id == character_id, Mark.mark_id.in_(chunk))
            )
    db.commit()
