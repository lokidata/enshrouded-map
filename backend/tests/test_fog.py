import base64

from conftest import ApiClient

from app.api.v1.fog import FOG_BYTES

F = "/api/v1/fog"
TF = "/api/v1/team/fog"
C = "/api/v1/characters"


def bits(*cells: int) -> str:
    """A grid with these cells set (bit i of the byte i // 8)."""
    raw = bytearray(FOG_BYTES)
    for c in cells:
        raw[c // 8] |= 1 << (c % 8)
    return base64.b64encode(bytes(raw)).decode()


def put(c: ApiClient, *cells: int, shared: bool = False) -> None:
    assert c.put(F, json={"bits": bits(*cells), "shared": shared}).status_code == 200


def team_of_two(user: ApiClient, bob: ApiClient) -> None:
    user.post("/api/v1/team", json={"name": "T"})
    user.post("/api/v1/team/members", json={"user_id": 2})


def test_requires_login(client: ApiClient) -> None:
    assert client.get(F).status_code == 401
    assert client.get(TF).status_code == 401


def test_a_player_alone_keeps_their_area_and_gets_it_back(user: ApiClient) -> None:
    assert user.get(F).json() == {"bits": None, "shared": False, "updated_at": None}
    put(user, 1, 9)
    stored = user.get(F).json()
    assert stored["bits"] == bits(1, 9) and stored["shared"] is False
    assert stored["updated_at"]  # a stamp for the browsers that cache it
    put(user, 2)  # an import again replaces it
    assert user.get(F).json()["bits"] == bits(2)


def test_what_is_stored_is_private_until_shared(user: ApiClient, bob: ApiClient) -> None:
    team_of_two(user, bob)
    put(user, 1, 9)
    assert bob.get(TF).json() == {"members": []}
    assert bob.get(f"{TF}/1").status_code == 404
    assert bob.get(F).json()["bits"] is None  # nor is it bob's


def test_each_member_who_shares_is_listed_and_asked_for_one_by_one(
    user: ApiClient, bob: ApiClient
) -> None:
    team_of_two(user, bob)
    put(user, 1, 9, shared=True)
    listed = bob.get(TF).json()["members"]
    assert [(m["user_id"], m["username"]) for m in listed] == [(1, "alice")]
    assert listed[0]["updated_at"]
    assert bob.get(f"{TF}/1").json() == {"bits": bits(1, 9)}
    assert user.get(TF).json() == {"members": []}  # your own area is not echoed
    put(bob, 9, 20, shared=True)
    assert [m["username"] for m in user.get(TF).json()["members"]] == ["bob"]
    assert user.get(f"{TF}/2").json() == {"bits": bits(9, 20)}
    assert bob.get(f"{TF}/2").status_code == 404  # nor can you ask for your own here


def test_sharing_can_be_switched_without_sending_the_area_again(
    user: ApiClient, bob: ApiClient
) -> None:
    team_of_two(user, bob)
    assert user.patch(F, json={"shared": True}).status_code == 404  # nothing stored yet
    put(user, 1)
    assert user.patch(F, json={"shared": True}).json()["shared"] is True
    assert bob.get(f"{TF}/1").json() == {"bits": bits(1)}
    off = user.patch(F, json={"shared": False}).json()
    assert off["bits"] == bits(1) and off["shared"] is False
    assert bob.get(TF).json() == {"members": []}
    assert user.get(F).json()["bits"] == bits(1)  # still stored for its owner


def test_deleting_removes_it_everywhere(user: ApiClient, bob: ApiClient) -> None:
    team_of_two(user, bob)
    put(user, 1, shared=True)
    assert user.delete(F).json()["bits"] is None
    assert bob.get(TF).json() == {"members": []}


def test_validation(user: ApiClient) -> None:
    assert user.put(F, json={"bits": "not base64!"}).status_code == 422
    short = base64.b64encode(b"\x00" * (FOG_BYTES - 1)).decode()
    assert user.put(F, json={"bits": short}).status_code == 422
    assert user.put(F, json={"bits": bits(), "extra": 1}).status_code == 422
    assert user.get(F).json()["bits"] is None


def test_a_player_without_a_team_has_no_team_area(user: ApiClient) -> None:
    assert user.get(TF).status_code == 404
    assert user.get(f"{TF}/2").status_code == 404


def test_a_member_who_leaves_is_no_longer_merged(user: ApiClient, bob: ApiClient) -> None:
    team_of_two(user, bob)
    put(bob, 5, shared=True)
    assert len(user.get(TF).json()["members"]) == 1
    assert bob.post("/api/v1/team/leave").status_code == 200
    assert user.get(TF).json() == {"members": []}
    assert user.get(f"{TF}/2").status_code == 404


def test_each_profile_has_its_own_area_and_the_team_sees_the_followed_one(
    user: ApiClient, bob: ApiClient
) -> None:
    team_of_two(user, bob)
    put(bob, 5, shared=True)
    bob.post(C, json={"name": "Autre"})  # a fresh profile, followed now: nothing stored
    assert bob.get(F).json()["bits"] is None
    assert user.get(TF).json() == {"members": []}
    first = bob.get(C).json()[0]["id"]
    bob.post(f"{C}/{first}/activate")
    mine = bob.get(F).json()
    assert mine["bits"] == bits(5) and mine["shared"] is True
    assert user.get(f"{TF}/2").json() == {"bits": bits(5)}


def test_deleting_a_profile_deletes_its_area(user: ApiClient, bob: ApiClient) -> None:
    team_of_two(user, bob)
    second = bob.post(C, json={"name": "Autre"}).json()[1]["id"]
    put(bob, 5, shared=True)
    assert len(user.get(TF).json()["members"]) == 1
    bob.delete(f"{C}/{second}")
    assert user.get(TF).json() == {"members": []}
