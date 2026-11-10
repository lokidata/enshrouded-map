import pytest
from conftest import ApiClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

URL = "/api/v1/progress"


def test_requires_login(client: ApiClient) -> None:
    assert client.get(URL).status_code == 401
    assert client.put(URL, json={"ids": ["chest:1:2"]}).status_code == 401


def test_mark_and_unmark(user: ApiClient) -> None:
    assert user.get(URL).json() == {"marks": []}
    assert user.put(URL, json={"ids": ["chest:1:2", "boss:-3:4", "chest:1:2"]}).status_code == 200
    assert user.put(URL, json={"ids": ["chest:1:2"], "done": True}).status_code == 200
    assert sorted(user.get(URL).json()["marks"]) == ["boss:-3:4", "chest:1:2"]
    user.put(URL, json={"ids": ["chest:1:2"], "done": False})
    assert user.get(URL).json() == {"marks": ["boss:-3:4"]}


def test_marks_are_per_user(user: ApiClient) -> None:
    user.put(URL, json={"ids": ["chest:1:2"]})
    token = user.post("/api/v1/auth/invitations").json()["token"]
    body = {"token": token, "username": "bob", "password": "correct horse battery"}
    user.post("/api/v1/auth/invitations/accept", json=body)
    assert user.get(URL).json() == {"marks": []}


def test_invalid_ids(user: ApiClient) -> None:
    for bad in ["chest", "chest:1", "ch est:1:2", "chest:a:2", "chest:1:2\n", "x" * 70 + ":1:2"]:
        assert user.put(URL, json={"ids": [bad]}).status_code == 422, bad
    assert user.put(URL, json={"ids": ["chest:1:2"], "done": "yes"}).status_code == 422


def test_recipe_ids(user: ApiClient) -> None:
    good = "recipe:f3bedfba-bea3-45d4-9ca1-a4019f93c4a7"
    assert user.put(URL, json={"ids": [good]}).status_code == 200
    assert user.get(URL).json() == {"marks": [good]}
    for bad in [
        "recipe:1:2x",
        "recipe:F3BEDFBA-bea3-45d4-9ca1-a4019f93c4a7",
        "recipe:abc",
        good + "0",
    ]:
        assert user.put(URL, json={"ids": [bad]}).status_code == 422, bad


def test_lore_ids(user: ApiClient) -> None:
    assert user.put(URL, json={"ids": ["lore:2913625784", "lore:0"]}).status_code == 200
    assert sorted(user.get(URL).json()["marks"]) == ["lore:0", "lore:2913625784"]
    for bad in ["lore:", "lore:12345678901", "lore:-1", "lore:abc", "lore:1x"]:
        assert user.put(URL, json={"ids": [bad]}).status_code == 422, bad


def test_page_and_quest_ids(user: ApiClient) -> None:
    good = ["lore:2913625784:0", "lore:2913625784:12", "quest:4029693112"]
    assert user.put(URL, json={"ids": good}).status_code == 200
    assert sorted(user.get(URL).json()["marks"]) == sorted(good)
    for bad in ["quest:", "quest:12345678901", "quest:-1", "quest:1:2x", "quest:abc", "Quest:1x"]:
        assert user.put(URL, json={"ids": [bad]}).status_code == 422, bad
    assert user.put(URL, json={"ids": ["quest:4029693112"], "done": False}).status_code == 200


def test_mark_limit(user: ApiClient, settings) -> None:  # type: ignore[no-untyped-def]
    settings.max_marks = 2
    assert user.put(URL, json={"ids": ["a:1:1", "a:1:2"]}).status_code == 200
    assert user.put(URL, json={"ids": ["a:1:1"]}).status_code == 200  # already marked
    assert user.put(URL, json={"ids": ["a:1:3"]}).status_code == 413


def test_bulk(user: ApiClient) -> None:
    ids = [f"plant:{i}:{i}" for i in range(2000)]
    assert user.put(URL, json={"ids": ids}).status_code == 200
    assert len(user.get(URL).json()["marks"]) == 2000
    assert user.put(URL, json={"ids": ids, "done": False}).status_code == 200
    assert user.get(URL).json() == {"marks": []}


def test_concurrent_identical_put_is_not_a_conflict(
    user: ApiClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A commit that loses the race (unique violation) is retried once instead of answering 409."""
    user.get(URL)  # the first profile is made now, not by the patched commit
    real_commit = Session.commit
    calls = {"n": 0}

    def flaky(self: Session) -> None:
        calls["n"] += 1
        if calls["n"] == 1:
            raise IntegrityError("INSERT", {}, Exception("unique"))
        real_commit(self)

    monkeypatch.setattr(Session, "commit", flaky)
    assert user.put(URL, json={"ids": ["chest:1:2", "boss:3:4"]}).status_code == 200
    monkeypatch.undo()
    assert sorted(user.get(URL).json()["marks"]) == ["boss:3:4", "chest:1:2"]


def test_persistent_integrity_error_stays_a_conflict(
    user: ApiClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    user.get(URL)  # the first profile is made now, not by the patched commit

    def always(self: Session) -> None:
        raise IntegrityError("INSERT", {}, Exception("unique"))

    monkeypatch.setattr(Session, "commit", always)
    assert user.put(URL, json={"ids": ["chest:1:2"]}).status_code == 409
