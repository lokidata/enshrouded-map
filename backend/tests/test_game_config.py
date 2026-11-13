import pytest
from conftest import ApiClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

URL = "/api/v1/game-config"
CFG = {"preset": "Custom", "diff": {"playerHealthFactor": 2}, "name": "N", "slotCount": 4}


def test_requires_login(client: ApiClient) -> None:
    assert client.get(URL).status_code == 401


def test_solo_player_reads_and_saves(user: ApiClient) -> None:
    assert user.get(URL).json() == {"config": None, "can_edit": True, "scope": "user"}
    assert user.put(URL, json={"settings": CFG}).status_code == 200
    assert user.get(URL).json() == {"config": CFG, "can_edit": True, "scope": "user"}


def test_only_team_owner_edits(user: ApiClient, bob: ApiClient) -> None:
    user.post("/api/v1/team", json={"name": "T"})
    user.post("/api/v1/team/members", json={"user_id": 2})
    assert user.put(URL, json={"settings": CFG}).status_code == 200
    seen = bob.get(URL).json()
    assert seen == {"config": CFG, "can_edit": False, "scope": "team"}
    assert bob.put(URL, json={"settings": {}}).status_code == 403
    assert user.get(URL).json()["config"] == CFG


def test_two_first_saves_at_once_do_not_fail(
    user: ApiClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    user.put(URL, json={"settings": CFG})
    real_commit = Session.commit
    calls = {"n": 0}

    def flaky(self: Session) -> None:
        calls["n"] += 1
        if calls["n"] == 1:
            raise IntegrityError("INSERT", {}, Exception("unique"))
        real_commit(self)

    monkeypatch.setattr(Session, "commit", flaky)
    assert user.put(URL, json={"settings": {**CFG, "name": "Other"}}).status_code == 200
    assert user.get(URL).json()["config"]["name"] == "Other"
