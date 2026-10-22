from conftest import ApiClient

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
