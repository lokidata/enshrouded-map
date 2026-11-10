import pytest
from conftest import ApiClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

C = "/api/v1/characters"
P = "/api/v1/progress"
B = "/api/v1/builds"
BUILD = {
    "name": "b",
    "nodes": {"1": 1},
    "level": 5,
    "flame": 2,
    "gear": {},
    "upgrades": {},
    "gems": {},
}


def names(r: object) -> list[tuple[str, bool]]:
    return [(c["name"], c["active"]) for c in r.json()]  # type: ignore[attr-defined]


def test_requires_login(client: ApiClient) -> None:
    assert client.get(C).status_code == 401


def test_a_first_profile_exists_for_everyone(user: ApiClient) -> None:
    assert names(user.get(C)) == [("Principal", True)]


def test_marks_and_builds_follow_the_active_profile(user: ApiClient) -> None:
    user.put(P, json={"ids": ["chest:1:2"]})
    user.post(B, json=BUILD)
    r = user.post(C, json={"name": "Alice 2"})
    assert names(r) == [("Principal", False), ("Alice 2", True)]
    assert user.get(P).json() == {"marks": []}  # the new profile starts empty
    assert user.get(B).json() == []
    user.put(P, json={"ids": ["boss:3:4"]})
    first = r.json()[0]["id"]
    assert names(user.post(f"{C}/{first}/activate")) == [("Principal", True), ("Alice 2", False)]
    assert user.get(P).json() == {"marks": ["chest:1:2"]}
    assert len(user.get(B).json()) == 1


def test_names_are_unique_and_the_last_profile_stays(user: ApiClient) -> None:
    assert user.post(C, json={"name": "Principal"}).status_code == 409
    only = user.get(C).json()[0]["id"]
    assert user.delete(f"{C}/{only}").status_code == 409
    second = user.post(C, json={"name": "Deux"}).json()[1]["id"]
    assert user.patch(f"{C}/{second}", json={"name": "Principal"}).status_code == 409
    assert names(user.patch(f"{C}/{second}", json={"name": "Trois"}))[1] == ("Trois", True)


def test_deleting_the_active_profile_activates_another_and_erases_its_data(
    user: ApiClient,
) -> None:
    user.put(P, json={"ids": ["chest:1:2"]})
    second = user.post(C, json={"name": "Deux"}).json()[1]["id"]
    user.put(P, json={"ids": ["boss:3:4"]})
    assert names(user.delete(f"{C}/{second}")) == [("Principal", True)]
    assert user.get(P).json() == {"marks": ["chest:1:2"]}


def test_a_profile_is_private(user: ApiClient, bob: ApiClient) -> None:
    mine = user.get(C).json()[0]["id"]
    assert bob.post(f"{C}/{mine}/activate").status_code == 404
    assert bob.patch(f"{C}/{mine}", json={"name": "x"}).status_code == 404
    assert bob.delete(f"{C}/{mine}").status_code == 404


def test_limit(user: ApiClient, settings: object) -> None:
    settings.max_characters = 2  # type: ignore[attr-defined]
    assert user.post(C, json={"name": "Deux"}).status_code == 200
    assert user.post(C, json={"name": "Trois"}).status_code == 409


def test_the_team_sees_the_active_profile(user: ApiClient, bob: ApiClient) -> None:
    user.post("/api/v1/team", json={"name": "T"})
    user.post("/api/v1/team/members", json={"user_id": 2})
    bob.put(P, json={"ids": ["chest:1:2"]})
    assert user.get("/api/v1/team/marks").json()["marks"] == {"chest:1:2": [2]}
    bob.post(C, json={"name": "Autre"})  # a fresh profile: nothing marked
    assert user.get("/api/v1/team/marks").json()["marks"] == {}
    first = bob.get(C).json()[0]["id"]
    bob.post(f"{C}/{first}/activate")
    assert user.get("/api/v1/team/marks").json()["marks"] == {"chest:1:2": [2]}


def test_the_first_profile_survives_a_race(
    user: ApiClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Requests that arrive together right after a login all try to make the first profile."""
    real_commit = Session.commit
    calls = {"n": 0}

    def flaky(self: Session) -> None:
        calls["n"] += 1
        if calls["n"] == 1:
            raise IntegrityError("INSERT", {}, Exception("unique"))
        real_commit(self)

    monkeypatch.setattr(Session, "commit", flaky)
    assert names(user.get(C)) == [("Principal", True)]
