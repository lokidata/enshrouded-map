from itertools import batched

from fastapi import APIRouter, HTTPException
from sqlalchemy import delete, func, insert, select
from sqlalchemy.exc import IntegrityError

from app.api.deps import CurrentUser, DbSession
from app.core.config import get_settings
from app.db.base import utcnow
from app.db.models import Mark
from app.schemas.progress import ProgressIn, ProgressOut

router = APIRouter(prefix="/progress", tags=["progress"])

CHUNK = 500  # keeps IN (...) lists well under every dialect's parameter limit


@router.get("", response_model=ProgressOut)
def get_progress(user: CurrentUser, db: DbSession) -> ProgressOut:
    rows = db.scalars(select(Mark.mark_id).where(Mark.user_id == user.id).order_by(Mark.created_at))
    return ProgressOut(marks=list(rows))


@router.put("")
def put_progress(body: ProgressIn, user: CurrentUser, db: DbSession) -> dict[str, str]:
    ids = list(dict.fromkeys(body.ids))
    if body.done:
        existing: set[str] = set()
        for chunk in batched(ids, CHUNK):
            existing.update(
                db.scalars(
                    select(Mark.mark_id).where(Mark.user_id == user.id, Mark.mark_id.in_(chunk))
                )
            )
        new = [i for i in ids if i not in existing]
        count = db.scalar(select(func.count()).select_from(Mark).where(Mark.user_id == user.id))
        if (count or 0) + len(new) > get_settings().max_marks:
            raise HTTPException(413, "too_many_marks")
        if new:
            now = utcnow()
            db.execute(
                insert(Mark), [{"user_id": user.id, "mark_id": i, "created_at": now} for i in new]
            )
    else:
        for chunk in batched(ids, CHUNK):
            db.execute(delete(Mark).where(Mark.user_id == user.id, Mark.mark_id.in_(chunk)))
    try:
        db.commit()
    except IntegrityError:  # concurrent identical request
        db.rollback()
        raise HTTPException(409, "conflict") from None
    return {}
