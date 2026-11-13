from conftest import ApiClient

from app.core.config import Settings

URL = "/api/v1/builds"
BUILD = {"name": "Archer", "nodes": {"2398930034": 1, "2985850560": 3}}


def test_requires_login(client: ApiClient) -> None:
    assert client.get(URL).status_code == 401
    assert client.post(URL, json=BUILD).status_code == 401


def test_create_list_update_delete(user: ApiClient) -> None:
    assert user.get(URL).json() == []
    made = user.post(URL, json=BUILD).json()
    assert made["name"] == "Archer" and made["nodes"] == BUILD["nodes"]
    other = user.post(URL, json={"name": "  Mage  ", "nodes": {}}).json()
    assert other["name"] == "Mage"  # trimmed
    assert [b["name"] for b in user.get(URL).json()] == ["Mage", "Archer"]  # newest first

    changed = {"name": "Archer v2", "nodes": {"2985850560": 2}}
    assert user.put(f"{URL}/{made['id']}", json=changed).json()["name"] == "Archer v2"
    assert [b["name"] for b in user.get(URL).json()] == ["Archer v2", "Mage"]  # touched: first
    assert user.get(URL).json()[0]["nodes"] == {"2985850560": 2}

    assert user.delete(f"{URL}/{made['id']}").status_code == 200
    assert [b["name"] for b in user.get(URL).json()] == ["Mage"]
    assert user.delete(f"{URL}/{made['id']}").status_code == 404
    assert user.put(f"{URL}/{made['id']}", json=changed).status_code == 404


def test_builds_are_private(user: ApiClient, bob: ApiClient) -> None:
    mine = user.post(URL, json=BUILD).json()
    assert bob.get(URL).json() == []
    assert bob.put(f"{URL}/{mine['id']}", json=BUILD).status_code == 404
    assert bob.delete(f"{URL}/{mine['id']}").status_code == 404
    assert len(user.get(URL).json()) == 1  # still there, unchanged


def test_validation(user: ApiClient) -> None:
    for bad in [
        {"name": "", "nodes": {}},
        {"name": "   ", "nodes": {}},
        {"name": "x" * 61, "nodes": {}},
        {"name": "ok", "nodes": {"abc": 1}},
        {"name": "ok", "nodes": {"12345678901": 1}},
        {"name": "ok", "nodes": {"-1": 1}},
        {"name": "ok", "nodes": {"1": 0}},
        {"name": "ok", "nodes": {"1": 4}},
        {"name": "ok", "nodes": {"1": "2"}},
        {"name": "ok", "nodes": [1]},
        {"name": "ok", "nodes": {str(i): 1 for i in range(401)}},
        {"nodes": {}},
    ]:
        assert user.post(URL, json=bad).status_code == 422, bad
    assert user.get(URL).json() == []


def test_limit_per_player(user: ApiClient, bob: ApiClient, settings: Settings) -> None:
    settings.max_builds = 2
    assert user.post(URL, json=BUILD).status_code == 200
    assert user.post(URL, json=BUILD).status_code == 200
    assert user.post(URL, json=BUILD).status_code == 409
    assert bob.post(URL, json=BUILD).status_code == 200  # the limit is per player


def test_deleting_an_account_deletes_its_builds(user: ApiClient, bob: ApiClient) -> None:
    bob.post(URL, json=BUILD)
    user.post(URL, json=BUILD)
    r = bob.post("/api/v1/auth/delete-account", json={"password": "correct horse battery"})
    assert r.status_code == 200
    assert len(user.get(URL).json()) == 1


def test_only_skills_are_saved(user: ApiClient) -> None:
    """The character's level and gear belong to the profile: an old client's extra fields are ignored."""
    old = {
        **BUILD,
        "level": 200,
        "flame": 50,
        "gear": {"head": "0123abcd-0123-4abc-8def-0123456789ab"},
    }
    made = user.post(URL, json=old).json()
    assert set(made) == {"id", "name", "nodes", "updated_at"}
    assert user.put(f"{URL}/{made['id']}", json=old).status_code == 200
    assert set(user.get(URL).json()[0]) == {"id", "name", "nodes", "updated_at"}


def test_a_build_belongs_to_its_profile(user: ApiClient) -> None:
    c = "/api/v1/characters"
    first = user.get(c).json()[0]["id"]
    made = user.post(URL, json=BUILD).json()
    user.post(c, json={"name": "Autre"})  # now following the new profile
    assert user.get(URL).json() == []
    assert user.put(f"{URL}/{made['id']}", json=BUILD).status_code == 404
    assert user.delete(f"{URL}/{made['id']}").status_code == 404
    user.post(f"{c}/{first}/activate")
    assert user.put(f"{URL}/{made['id']}", json=BUILD).status_code == 200
