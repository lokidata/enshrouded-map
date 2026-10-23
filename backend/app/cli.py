"""Maintenance from inside the container: `python -m app.cli reset-password USERNAME`.

The way back in when the first account (the one that can generate reset links) loses its password.
"""

import getpass
import sys

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.core.security import hash_password, password_is_acceptable
from app.db.models import AuthSession, User
from app.db.session import SessionLocal


def reset_password(db: Session, username: str, password: str) -> None:
    user = db.scalar(select(User).where(User.username_key == username.lower()))
    if user is None:
        raise SystemExit(f"No account named {username!r}")
    if not password_is_acceptable(password, user.username):
        raise SystemExit("Password too short (10 characters minimum) or too common")
    user.password_hash = hash_password(password)
    user.failed_logins, user.locked_until = 0, None
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))  # sign out everywhere
    db.commit()


def main(argv: list[str]) -> None:
    if len(argv) != 2 or argv[0] != "reset-password":
        raise SystemExit("usage: python -m app.cli reset-password USERNAME")
    password = getpass.getpass("New password: ")
    with SessionLocal() as db:
        reset_password(db, argv[1], password)
    print("Password changed; the account is signed out everywhere.")


if __name__ == "__main__":
    main(sys.argv[1:])
