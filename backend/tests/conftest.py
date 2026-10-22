import os
import tempfile
from collections.abc import Iterator
from typing import Any

_tmp = tempfile.mkdtemp()
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmp}/test.db")
os.environ["ENVIRONMENT"] = "test"
os.environ["COOKIE_SECURE"] = "false"  # the test client talks plain http

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.api.limiter import limiter  # noqa: E402
from app.core.config import Settings, get_settings  # noqa: E402
from app.db.base import Base  # noqa: E402
from app.db.session import engine  # noqa: E402
from app.main import app  # noqa: E402

PW = "correct horse battery"


class ApiClient(TestClient):
    """TestClient that echoes the XSRF-TOKEN cookie on unsafe requests, like Angular does."""

    def request(self, method: str, url: Any, *, csrf: bool = True, **kwargs: Any) -> Any:
        if csrf and method.upper() not in ("GET", "HEAD", "OPTIONS"):
            if "XSRF-TOKEN" not in self.cookies:
                super().request("GET", "/api/v1/health")
            headers = dict(kwargs.get("headers") or {})
            headers["X-XSRF-TOKEN"] = self.cookies.get("XSRF-TOKEN") or ""
            kwargs["headers"] = headers
        return super().request(method, url, **kwargs)


@pytest.fixture(autouse=True)
def _database() -> Iterator[None]:
    Base.metadata.create_all(engine)
    limiter.reset()
    yield
    Base.metadata.drop_all(engine)


@pytest.fixture
def settings() -> Iterator[Settings]:
    s = get_settings()
    saved = s.model_copy()
    yield s
    for name in Settings.model_fields:
        setattr(s, name, getattr(saved, name))


@pytest.fixture
def client() -> Iterator[ApiClient]:
    with ApiClient(app) as c:
        yield c


@pytest.fixture
def user(client: ApiClient) -> ApiClient:
    """A client logged in as 'alice'."""
    r = client.post("/api/v1/auth/setup", json={"username": "alice", "password": PW})
    assert r.status_code == 200
    return client
