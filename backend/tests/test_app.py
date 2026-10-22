import json
import subprocess
import sys
from pathlib import Path

from conftest import ApiClient

from app.core.config import Settings

BACKEND = Path(__file__).resolve().parent.parent


def test_health(client: ApiClient) -> None:
    assert client.get("/api/v1/health").json() == {"status": "ok"}


def test_docs_disabled_outside_development(client: ApiClient) -> None:
    assert client.get("/api/docs").status_code == 404
    assert client.get("/api/openapi.json").status_code == 404


def test_body_too_large(user: ApiClient, settings: Settings) -> None:
    settings.max_body_bytes = 100
    r = user.put("/api/v1/progress", content=json.dumps({"ids": ["a:1:1"] * 50}))
    assert r.status_code == 413


def test_errors_are_generic(user: ApiClient) -> None:
    assert user.get("/api/v1/nope").json() == {"detail": "Not Found"}


def test_migrations_up_and_down(tmp_path: Path) -> None:
    import os

    env = {**os.environ, "DATABASE_URL": f"sqlite:///{tmp_path}/mig.db"}
    for target in ("head", "base"):
        cmd = ["upgrade", "head"] if target == "head" else ["downgrade", "base"]
        run = subprocess.run(
            [sys.executable, "-m", "alembic", *cmd],
            cwd=BACKEND,
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        assert run.returncode == 0, run.stderr
