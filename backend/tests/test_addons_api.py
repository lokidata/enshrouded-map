from collections.abc import Iterator

import pytest
from conftest import ApiClient
from sqlalchemy import select

from app.core.addons import Entry
from app.db.models import User
from app.db.session import SessionLocal
from app.main import app


def _entry(eid: str, key: str = "main") -> Entry:
    return Entry(
        key=key,
        id=eid,
        version="1.0",
        name={"fr": eid, "en": eid},
        description={"fr": "d", "en": "d"},
        element=f"addon-{eid}",
        capabilities=("tab",),
        script=f"/addon/{key}/main.js",
        styles=f"/addon/{key}/main.css",
    )


class FakeRegistry:
    def __init__(self, entries: list[Entry]) -> None:
        self._e = entries

    def entries(self) -> list[Entry]:
        return list(self._e)

    def entry(self, entry_id: str) -> Entry | None:
        return next((e for e in self._e if e.id == entry_id), None)


@pytest.fixture(autouse=True)
def registry() -> Iterator[None]:
    saved = app.state.addons
    app.state.addons = FakeRegistry([_entry("chests"), _entry("stats")])
    yield
    app.state.addons = saved


def _bob_id(user: ApiClient) -> int:
    return next(
        int(u["id"]) for u in user.get("/api/v1/auth/users").json() if u["username"] == "bob"
    )


def _grant(user: ApiClient, bob: ApiClient, level: str | None = "read") -> int:
    bid = _bob_id(user)
    assert user.put("/api/v1/addons/chests", json={"enabled": True}).status_code == 200
    r = user.put(f"/api/v1/addons/chests/access/{bid}", json={"level": level})
    assert r.status_code == 204
    return bid


def test_list_hides_disabled_and_unauthorised(user: ApiClient, bob: ApiClient) -> None:
    assert user.get("/api/v1/addons").json() == []
    assert bob.get("/api/v1/addons").json() == []
    user.put("/api/v1/addons/chests", json={"enabled": True})
    assert [a["id"] for a in user.get("/api/v1/addons").json()] == ["chests"]
    assert bob.get("/api/v1/addons").json() == []


def test_admin_enables_and_grants(user: ApiClient, bob: ApiClient) -> None:
    user.put("/api/v1/addons/chests", json={"enabled": True})
    assert bob.get("/api/v1/addons").json() == []
    _grant(user, bob)
    assert bob.get("/api/v1/addons").json() == [
        {
            "id": "chests",
            "key": "main",
            "name": {"fr": "chests", "en": "chests"},
            "element": "addon-chests",
            "capabilities": ["tab"],
            "script": "/addon/main/main.js",
            "styles": "/addon/main/main.css",
            "level": "read",
        }
    ]
    assert user.get("/api/v1/addons").json()[0]["level"] == "action"


def test_me_levels(user: ApiClient, bob: ApiClient) -> None:
    bid = _grant(user, bob)
    r = bob.get("/api/v1/addons/chests/me")
    with SessionLocal() as db:
        created = db.scalars(select(User.created_at).where(User.id == bid)).one()
    assert r.json() == {
        "user_key": f"{bid}:{created.isoformat()}",
        "username": "bob",
        "is_admin": False,
        "level": "read",
    }
    a = user.get("/api/v1/addons/chests/me").json()
    assert (a["level"], a["is_admin"]) == ("action", True)
    r = bob.get("/api/v1/addons/stats/me")  # enabled=False, no access
    assert (r.status_code, r.json()) == (403, {"detail": "forbidden"})


def test_disable_revokes_at_once(user: ApiClient, bob: ApiClient) -> None:
    _grant(user, bob)
    assert bob.get("/api/v1/addons/chests/me").status_code == 200
    user.put("/api/v1/addons/chests", json={"enabled": False})
    assert bob.get("/api/v1/addons/chests/me").status_code == 403
    assert bob.get("/api/v1/addons").json() == []


def test_access_admin_only(user: ApiClient, bob: ApiClient) -> None:
    bid = _bob_id(user)
    for method, url, body in [
        ("GET", "/api/v1/addons/admin", None),
        ("PUT", "/api/v1/addons/chests", {"enabled": True}),
        ("GET", "/api/v1/addons/chests/access", None),
        ("PUT", f"/api/v1/addons/chests/access/{bid}", {"level": "action"}),
    ]:
        assert bob.request(method, url, json=body).status_code == 403, url
    assert user.get("/api/v1/addons/admin").status_code == 200


def test_unauthenticated(client: ApiClient) -> None:
    assert client.get("/api/v1/addons").status_code == 401
    assert client.get("/api/v1/addons/chests/me").status_code == 401


def test_admin_is_implicit(user: ApiClient) -> None:
    r = user.put("/api/v1/addons/chests/access/1", json={"level": "read"})  # alice is user 1
    assert (r.status_code, r.json()) == (400, {"detail": "administrator_is_implicit"})


def test_unknown_codes(user: ApiClient, bob: ApiClient) -> None:
    bid = _bob_id(user)
    for method, url, body in [
        ("PUT", "/api/v1/addons/nope", {"enabled": True}),
        ("GET", "/api/v1/addons/nope/access", None),
        ("PUT", f"/api/v1/addons/nope/access/{bid}", {"level": "read"}),
    ]:
        r = user.request(method, url, json=body)
        assert (r.status_code, r.json()) == (404, {"detail": "unknown_addon"}), url
    r = user.put("/api/v1/addons/chests/access/9999", json={"level": "read"})
    assert (r.status_code, r.json()) == (404, {"detail": "unknown_user"})
    assert user.get("/api/v1/addons/nope/me").status_code == 403


def test_access_list_excludes_admin_and_null_removes(user: ApiClient, bob: ApiClient) -> None:
    bid = _grant(user, bob, "action")
    assert user.get("/api/v1/addons/chests/access").json() == [
        {"user_id": bid, "username": "bob", "level": "action"}
    ]
    user.put(f"/api/v1/addons/chests/access/{bid}", json={"level": None})
    assert user.get("/api/v1/addons/chests/access").json()[0]["level"] is None
    assert bob.get("/api/v1/addons/chests/me").status_code == 403


def test_admin_list(user: ApiClient) -> None:
    user.put("/api/v1/addons/stats", json={"enabled": True})
    got = {a["id"]: a["enabled"] for a in user.get("/api/v1/addons/admin").json()}
    assert got == {"chests": False, "stats": True}


def test_csrf_required(user: ApiClient) -> None:
    r = user.request("PUT", "/api/v1/addons/chests", json={"enabled": True}, csrf=False)
    assert r.status_code == 403
