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
        {"name": "ok", "nodes": {}, "extra": 1},
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


G1 = "0123abcd-0123-4abc-8def-0123456789ab"


def test_character_and_gear(user: ApiClient, bob: ApiClient) -> None:
    old = user.post(URL, json=BUILD).json()  # old payload: defaults
    assert (old["level"], old["flame"], old["gear"]) == (1, 0, {})
    full = {
        "name": "Tank",
        "nodes": {},
        "level": 200,
        "flame": 50,
        "gear": {"head": G1, "ring2": G1, "weapon3": G1},
    }
    made = user.post(URL, json=full).json()
    assert (made["level"], made["flame"], made["gear"]) == (200, 50, full["gear"])
    upd = {"name": "Tank", "nodes": {}, "level": 7, "flame": 3, "gear": {"shield": G1}}
    assert user.put(f"{URL}/{made['id']}", json=upd).status_code == 200
    mine = next(b for b in user.get(URL).json() if b["id"] == made["id"])
    assert (mine["level"], mine["flame"], mine["gear"]) == (7, 3, {"shield": G1})
    assert user.put(f"{URL}/{made['id']}", json=BUILD).json()["gear"] == {}  # omitted: reset
    assert bob.put(f"{URL}/{made['id']}", json=full).status_code == 404


def test_character_validation(user: ApiClient) -> None:
    base: dict[str, object] = {"name": "ok", "nodes": {}}
    bads: list[dict[str, object]] = [
        {"level": 0},
        {"level": 201},
        {"flame": 51},
        {"flame": -1},
        {"gear": {"belt": G1}},
        {"gear": {"head": G1.upper()}},
        {"gear": {"head": "abc"}},
        {"gear": {"head": G1 + "\n"}},
        {"gear": {"head": 1}},
        {"gear": {"weapon4": G1}},
        {"upgrades": {"weapon4": [0]}},
    ]
    for bad in bads:
        assert user.post(URL, json=base | bad).status_code == 422, bad
    assert user.get(URL).json() == []


def test_upgrades(user: ApiClient, bob: ApiClient) -> None:
    assert user.post(URL, json=BUILD).json()["upgrades"] == {}  # old payload: default
    body = {**BUILD, "gear": {"head": G1}, "upgrades": {"head": [0, 1], "weapon3": [0]}}
    made = user.post(URL, json=body).json()
    assert made["upgrades"] == body["upgrades"]
    assert any(b["upgrades"] == body["upgrades"] for b in user.get(URL).json())
    put = user.put(
        f"{URL}/{made['id']}", json={**BUILD, "gear": {"head": G1}, "upgrades": {"head": [2]}}
    )
    assert put.json()["upgrades"] == {"head": [2]}
    assert user.put(f"{URL}/{made['id']}", json=BUILD).json()["upgrades"] == {}  # omitted: reset
    assert bob.put(f"{URL}/{made['id']}", json=body).status_code == 404


def test_upgrades_validation(user: ApiClient) -> None:
    bads: list[object] = [
        {"belt": [0]},
        {"head": [64]},
        {"head": [-1]},
        {"head": list(range(9))},
        {"head": ["a"]},
        {"head": 1},
    ]
    for bad in bads:
        assert user.post(URL, json={**BUILD, "upgrades": bad}).status_code == 422, bad
