from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import User


def no_users(db: Session) -> bool:
    """True on a fresh database: the first account has still to be created."""
    return db.scalar(select(User.id).limit(1)) is None
