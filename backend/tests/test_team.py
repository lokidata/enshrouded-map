from collections.abc import Iterator

import pytest
from conftest import PW, ApiClient

from app.main import app

T = "/api/v1/team"


@pytest.fixture
def bob(user: ApiClient) -> Iterator[ApiClient]:
    """A second client logged in as 'bob' (alice, on `user`, is the first account)."""
    token = user.post("/api/v1/auth/invitations").json()["token"]
    with ApiClient(app) as c:
        body = {"token": token, "username": "bob", "password": PW}
        assert c.post("/api/v1/auth/invitations/accept", json=body).status_code == 200
        yield c


def add(owner: ApiClient, user_id: int) -> None:
    assert owner.post(f"{T}/members", json={"user_id": user_id}).status_code == 200


def test_requires_login(client: ApiClient) -> None:
    assert client.get(T).status_code == 401
    assert client.get(f"{T}/marks").status_code == 401


def test_create_and_rename(user: ApiClient) -> None:
    assert user.get(T).json() is None
    r = user.post(T, json={"name": " Les Braves "})
    assert r.json() == {
        "id": r.json()["id"],
        "name": "Les Braves",
        "owner_id": 1,
        "is_owner": True,
        "members": [{"id": 1, "username": "alice"}],
    }
    assert user.post(T, json={"name": "Autre"}).status_code == 409
    assert user.patch(T, json={"name": "Neuf"}).json()["name"] == "Neuf"
    assert user.post(T, json={"name": ""}).status_code == 422


def test_add_existing_player(user: ApiClient, bob: ApiClient) -> None:
    assert user.get(f"{T}/available").status_code == 404  # no team yet
    user.post(T, json={"name": "Braves"})
    assert user.get(f"{T}/available").json() == [{"id": 2, "username": "bob"}]
    assert bob.post(f"{T}/members", json={"user_id": 1}).status_code == 404  # bob has no team
    add(user, 2)
    assert user.get(f"{T}/available").json() == []
    assert user.post(f"{T}/members", json={"user_id": 2}).status_code == 409
    assert user.post(f"{T}/members", json={"user_id": 99}).status_code == 404
    assert bob.get(T).json()["is_owner"] is False
    assert bob.get(f"{T}/available").status_code == 200  # any member adds and invites
    assert bob.patch(T, json={"name": "X"}).status_code == 403  # only the owner renames


def test_invitation_creates_a_member(user: ApiClient) -> None:
    user.post(T, json={"name": "Braves"})
    token = user.post(f"{T}/invitations").json()["token"]
    with ApiClient(app) as guest:
        body = {"token": token, "username": "carl", "password": PW}
        assert guest.post("/api/v1/auth/invitations/accept", json=body).status_code == 200
        assert [m["username"] for m in guest.get(T).json()["members"]] == ["alice", "carl"]
        body["username"] = "dave"
        assert guest.post("/api/v1/auth/invitations/accept", json=body).status_code == 410
    # a plain invitation (account bar) creates no membership
    plain = user.post("/api/v1/auth/invitations").json()["token"]
    with ApiClient(app) as guest:
        body = {"token": plain, "username": "erin", "password": PW}
        assert guest.post("/api/v1/auth/invitations/accept", json=body).status_code == 200
        assert guest.get(T).json() is None
    # the team goes, its pending invitations with it
    late = user.post(f"{T}/invitations").json()["token"]
    user.delete(T)
    with ApiClient(app) as guest:
        body = {"token": late, "username": "fred", "password": PW}
        assert guest.post("/api/v1/auth/invitations/accept", json=body).status_code == 410


def test_team_marks_show_the_others_only(user: ApiClient, bob: ApiClient) -> None:
    user.put("/api/v1/progress", json={"ids": ["chest:1:2", "boss:3:4"]})
    bob.put(
        "/api/v1/progress",
        json={"ids": ["chest:1:2", f"recipe:{'a' * 8}-aaaa-aaaa-aaaa-{'a' * 12}"]},
    )
    assert bob.get(f"{T}/marks").json() == {"marks": {}}  # no team: nothing shared
    user.post(T, json={"name": "Braves"})
    add(user, 2)  # joining takes effect on the existing marks
    # known recipes are personal: they never reach the team
    assert user.get(f"{T}/marks").json() == {"marks": {"chest:1:2": [2]}}
    assert bob.get(f"{T}/marks").json() == {"marks": {"chest:1:2": [1], "boss:3:4": [1]}}


def test_remove_leave_dissolve(user: ApiClient, bob: ApiClient) -> None:
    user.post(T, json={"name": "Braves"})
    add(user, 2)
    assert bob.delete(f"{T}/members/1").status_code == 403  # nobody removes the owner
    assert user.delete(f"{T}/members/1").status_code == 400  # not yourself
    assert user.delete(f"{T}/members/99").status_code == 404
    assert bob.delete(T).status_code == 403  # only the owner dissolves
    assert user.delete(f"{T}/members/2").status_code == 200
    assert bob.get(T).json() is None
    add(user, 2)
    assert user.post(f"{T}/leave").status_code == 200  # the owner leaves: bob takes over
    assert bob.get(T).json()["is_owner"] is True
    assert bob.delete(T).status_code == 200
    assert bob.get(T).json() is None and user.get(T).json() is None
    assert user.post(f"{T}/leave").status_code == 404


def test_member_adds_and_removes(user: ApiClient, bob: ApiClient) -> None:
    user.post(T, json={"name": "Braves"})
    add(user, 2)
    with ApiClient(app) as carl:
        token = bob.post(f"{T}/invitations").json()["token"]  # a plain member invites
        body = {"token": token, "username": "carl", "password": PW}
        assert carl.post("/api/v1/auth/invitations/accept", json=body).status_code == 200
        assert len(carl.get(T).json()["members"]) == 3
        assert bob.delete(f"{T}/members/3").status_code == 200  # and removes
        assert carl.get(T).json() is None


def test_owner_hands_the_team_over(user: ApiClient, bob: ApiClient) -> None:
    user.post(T, json={"name": "Braves"})
    assert user.post(f"{T}/owner", json={"user_id": 2}).status_code == 404  # not a member yet
    add(user, 2)
    assert bob.post(f"{T}/owner", json={"user_id": 2}).status_code == 403  # only the owner
    assert user.post(f"{T}/owner", json={"user_id": 1}).status_code == 404  # not themself
    assert user.post(f"{T}/owner", json={"user_id": 2}).status_code == 200
    assert bob.get(T).json()["is_owner"] is True
    assert user.get(T).json()["is_owner"] is False
    assert bob.delete(f"{T}/members/1").status_code == 200  # the new owner removes the old one


def test_delete_account(user: ApiClient, bob: ApiClient) -> None:
    D = "/api/v1/auth/delete-account"
    bob.put("/api/v1/progress", json={"ids": ["chest:1:2"]})
    user.post(T, json={"name": "Braves"})
    add(user, 2)
    assert user.post(D, json={"password": PW}).status_code == 403  # the first account stays
    assert bob.post(D, json={"password": "wrong password"}).status_code == 403
    assert bob.post(D, json={"password": PW}).status_code == 200
    assert bob.get("/api/v1/progress").status_code == 401  # session gone
    assert [m["username"] for m in user.get(T).json()["members"]] == ["alice"]
    assert user.get(f"{T}/marks").json() == {"marks": {}}
    r = bob.post("/api/v1/auth/login", json={"username": "bob", "password": PW})
    assert r.status_code == 401


def test_admin_deletes_another_account(user: ApiClient, bob: ApiClient) -> None:
    U = "/api/v1/auth/users"
    user.post(T, json={"name": "Braves"})
    add(user, 2)
    bob.put("/api/v1/progress", json={"ids": ["chest:1:2"]})
    assert bob.delete(f"{U}/1").status_code == 403  # only the administrator
    assert user.delete(f"{U}/1").status_code == 403  # not themself
    assert user.delete(f"{U}/99").status_code == 404
    assert user.delete(f"{U}/2").status_code == 200
    assert bob.get("/api/v1/progress").status_code == 401  # session gone
    assert (
        bob.post("/api/v1/auth/login", json={"username": "bob", "password": PW}).status_code == 401
    )
    assert [m["username"] for m in user.get(T).json()["members"]] == ["alice"]
    assert user.get(U).json() == []
