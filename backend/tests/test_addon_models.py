import os
import subprocess
import sys
from pathlib import Path

from conftest import PW, ApiClient
from sqlalchemy import create_engine, inspect, select

from app.db.models import AddonAccess, AddonEntryRow, User
from app.db.session import SessionLocal, engine

BACKEND = Path(__file__).resolve().parent.parent


def _user_id(username: str) -> int | None:
    with SessionLocal() as db:
        return db.scalar(select(User.id).where(User.username == username))


def test_access_rows_die_with_the_user(user: ApiClient, bob: ApiClient) -> None:
    bob_id = _user_id("bob")
    assert bob_id is not None
    with SessionLocal() as db:
        db.add(AddonEntryRow(entry_id="main", enabled=True))
        db.add(AddonAccess(entry_id="main", user_id=bob_id, level="action"))
        db.commit()

    r = bob.post("/api/v1/auth/delete-account", json={"password": PW})
    assert r.status_code == 200
    with SessionLocal() as db:
        assert db.scalars(select(AddonAccess)).all() == []
        assert db.get(AddonEntryRow, "main") is not None  # the entry itself stays

    # SQLite reuses the freed id (no AUTOINCREMENT): the newcomer must not inherit access.
    token = user.post("/api/v1/auth/invitations").json()["token"]
    with ApiClient(user.app) as c:
        body = {"token": token, "username": "carol", "password": PW}
        assert c.post("/api/v1/auth/invitations/accept", json=body).status_code == 200
    if engine.dialect.name == "sqlite":  # only SQLite reuses freed ids
        assert _user_id("carol") == bob_id
    with SessionLocal() as db:
        assert db.scalars(select(AddonAccess).where(AddonAccess.user_id == bob_id)).all() == []


def test_migration_0018_upgrades_and_downgrades(tmp_path: Path) -> None:
    db_file = tmp_path / "scratch.db"
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{db_file}"}

    def alembic(*args: str) -> None:
        subprocess.run([sys.executable, "-m", "alembic", *args], cwd=BACKEND, env=env, check=True)

    alembic("upgrade", "head")
    insp = inspect(create_engine(f"sqlite:///{db_file}"))
    assert {"addon_entries", "addon_access"} <= set(insp.get_table_names())
    assert [i["column_names"] for i in insp.get_indexes("addon_access")] == [["user_id"]]
    alembic("downgrade", "-1")
    insp = inspect(create_engine(f"sqlite:///{db_file}"))
    assert not {"addon_entries", "addon_access"} & set(insp.get_table_names())
