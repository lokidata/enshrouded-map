from conftest import ApiClient
from sqlalchemy import update

from app.db.models import CustomMarker
from app.db.session import SessionLocal

M = "/api/v1/markers"
TM = "/api/v1/team/markers"
T = "/api/v1/team"
PIN = {"x": 100, "z": 200, "name": "Base", "kind": "pin"}
ALTAR = {"x": 5000, "z": 6000, "name": "Altar", "kind": "altar", "level": 2}


def team_of_two(user: ApiClient) -> None:
    user.post(T, json={"name": "T"})
    user.post(f"{T}/members", json={"user_id": 2})


def share(c: ApiClient, marker_id: int, body: dict = PIN) -> None:  # type: ignore[type-arg]
    assert c.patch(f"{M}/{marker_id}", json={**body, "shared": True}).status_code == 200


def second_profile(c: ApiClient) -> None:
    """Makes another profile and follows it."""
    made = c.post("/api/v1/characters", json={"name": "Second"}).json()
    c.post(f"/api/v1/characters/{[p for p in made if p['name'] == 'Second'][0]['id']}/activate")


def test_requires_login(client: ApiClient) -> None:
    assert client.get(M).status_code == 401
    assert client.get(TM).status_code == 401


def test_crud(user: ApiClient) -> None:
    assert user.get(M).json() == []
    pin = user.post(M, json=PIN)
    assert pin.status_code == 201
    assert pin.json() == {
        **PIN,
        "id": pin.json()["id"],
        "note": "",
        "level": None,
        "icon": None,
        "color": None,
        "shared": False,
    }
    pin_id = pin.json()["id"]
    assert user.patch(f"{M}/{pin_id}", json={**PIN, "icon": "camp"}).json()["icon"] == "camp"
    both = user.patch(f"{M}/{pin_id}", json={**PIN, "color": "teal"}).json()
    assert both["color"] == "teal" and both["icon"] is None
    altar = user.post(M, json={**ALTAR, "note": "<b>x</b>"}).json()
    assert altar["level"] == 2 and altar["note"] == "<b>x</b>"  # stored as is, shown as text
    assert [m["name"] for m in user.get(M).json()] == ["Base", "Altar"]
    moved = user.patch(f"{M}/{altar['id']}", json={**ALTAR, "x": 1, "level": 4, "name": " A "})
    assert moved.json()["x"] == 1 and moved.json()["level"] == 4 and moved.json()["name"] == "A"
    assert user.delete(f"{M}/{altar['id']}").status_code == 204
    assert user.delete(f"{M}/{altar['id']}").status_code == 404
    assert len(user.get(M).json()) == 1


def test_validation(user: ApiClient) -> None:
    bad = [
        {**PIN, "x": -1},
        {**PIN, "z": 10_241},
        {**PIN, "name": "  "},
        {**PIN, "name": "x" * 41},
        {**PIN, "note": "x" * 501},
        {**PIN, "kind": "base"},
        {**PIN, "level": 1},  # a pin has no level
        {k: v for k, v in ALTAR.items() if k != "level"},
        {**ALTAR, "level": 5},
        {**ALTAR, "level": 0},
        {**ALTAR, "icon": "camp"},  # an altar has its own icon and colour
        {**ALTAR, "color": "green"},
        {**PIN, "icon": "<img>"},
        {**PIN, "icon": "x" * 33},
        {**PIN, "color": "#fff"},
        {**PIN, "color": "x" * 17},
        {**PIN, "extra": 1},
        {**PIN, "x": "1"},
    ]
    for body in bad:
        assert user.post(M, json=body).status_code == 422, body


def test_limit_per_profile(user: ApiClient, settings) -> None:  # type: ignore[no-untyped-def]
    settings.max_markers = 2
    assert user.post(M, json=PIN).status_code == 201
    assert user.post(M, json=PIN).status_code == 201
    assert user.post(M, json=PIN).status_code == 409
    second_profile(user)
    assert user.post(M, json=PIN).status_code == 201  # each profile has its own


def test_markers_belong_to_the_profile_followed(user: ApiClient, bob: ApiClient) -> None:
    mid = user.post(M, json=PIN).json()["id"]
    assert bob.get(M).json() == []
    assert bob.patch(f"{M}/{mid}", json=PIN).status_code == 404
    assert bob.delete(f"{M}/{mid}").status_code == 404
    second_profile(user)
    assert user.get(M).json() == []
    assert user.delete(f"{M}/{mid}").status_code == 404  # not the profile followed now


def test_sharing_needs_a_team(user: ApiClient) -> None:
    assert user.post(M, json={**PIN, "shared": True}).status_code == 409
    mid = user.post(M, json=PIN).json()["id"]
    assert user.patch(f"{M}/{mid}", json={**PIN, "shared": True}).status_code == 409
    assert user.get(M).json()[0]["shared"] is False


def test_team_sees_only_shared_ones_read_only(user: ApiClient, bob: ApiClient) -> None:
    team_of_two(user)
    private = user.post(M, json=PIN).json()["id"]
    shared = user.post(M, json={**ALTAR, "shared": True}).json()["id"]
    got = bob.get(TM).json()["members"]
    assert [(m["user_id"], m["username"]) for m in got] == [(1, "alice")]
    assert [m["id"] for m in got[0]["markers"]] == [shared]
    assert user.get(TM).json() == {"members": []}  # my own come from /markers
    assert bob.patch(f"{M}/{shared}", json=PIN).status_code == 404
    assert bob.delete(f"{M}/{shared}").status_code == 404
    assert private != shared


def test_a_non_member_sees_nothing(user: ApiClient, bob: ApiClient) -> None:
    mid = user.post(M, json=PIN).json()["id"]
    assert bob.get(TM).json() == {"members": []}
    team_of_two(user)
    share(user, mid)
    assert bob.post(f"{T}/leave").status_code == 200
    assert bob.get(TM).json() == {"members": []}


def test_etag_changes_with_the_content(user: ApiClient, bob: ApiClient) -> None:
    team_of_two(user)
    mid = user.post(M, json=PIN).json()["id"]
    first = bob.get(TM)
    tag = first.headers["etag"]
    assert bob.get(TM, headers={"If-None-Match": tag}).status_code == 304
    share(user, mid)
    changed = bob.get(TM, headers={"If-None-Match": tag})
    assert changed.status_code == 200 and changed.headers["etag"] != tag
    share(user, mid, {**PIN, "name": "Renamed"})
    assert bob.get(TM, headers={"If-None-Match": changed.headers["etag"]}).status_code == 200


def test_the_team_sees_the_profile_followed(user: ApiClient, bob: ApiClient) -> None:
    team_of_two(user)
    mid = user.post(M, json=PIN).json()["id"]
    share(user, mid)
    second_profile(user)
    assert bob.get(TM).json() == {"members": []}


def _flags() -> list[bool]:
    with SessionLocal() as db:
        return [m.shared for m in db.query(CustomMarker).order_by(CustomMarker.id)]


def test_leaving_stops_sharing_in_every_profile(user: ApiClient, bob: ApiClient) -> None:
    team_of_two(user)
    share(bob, bob.post(M, json=PIN).json()["id"])
    second_profile(bob)
    share(bob, bob.post(M, json=PIN).json()["id"])
    assert _flags() == [True, True]
    assert bob.post(f"{T}/leave").status_code == 200
    assert _flags() == [False, False]


def test_a_removed_member_stops_sharing(user: ApiClient, bob: ApiClient) -> None:
    team_of_two(user)
    share(bob, bob.post(M, json=PIN).json()["id"])
    assert user.delete(f"{T}/members/2").status_code == 200
    assert _flags() == [False]


def test_a_dissolved_team_stops_sharing_for_everyone(user: ApiClient, bob: ApiClient) -> None:
    team_of_two(user)
    share(bob, bob.post(M, json=PIN).json()["id"])
    share(user, user.post(M, json=PIN).json()["id"])
    assert user.delete(T).status_code == 200
    assert _flags() == [False, False]


def test_added_by_someone_else_starts_private(user: ApiClient, bob: ApiClient) -> None:
    bob.post(M, json=PIN)
    with SessionLocal() as db:  # a flag left on by an older version: the API refuses to set it
        db.execute(update(CustomMarker).values(shared=True))
        db.commit()
    user.post(T, json={"name": "T"})
    assert user.post(f"{T}/members", json={"user_id": 2}).status_code == 200
    assert _flags() == [False]
    assert user.get(TM).json() == {"members": []}


def test_moving_keeps_everything_else_and_stays_shared(user: ApiClient, bob: ApiClient) -> None:
    team_of_two(user)
    mid = user.post(M, json={**ALTAR, "note": "n", "shared": True}).json()["id"]
    moved = user.patch(f"{M}/{mid}", json={**ALTAR, "note": "n", "shared": True, "x": 10, "z": 20})
    assert moved.status_code == 200
    got = moved.json()
    assert (got["x"], got["z"]) == (10, 20)
    assert (got["name"], got["note"], got["kind"], got["level"], got["shared"]) == (
        "Altar",
        "n",
        "altar",
        2,
        True,
    )
    seen = bob.get(TM).json()["members"][0]["markers"][0]
    assert (seen["x"], seen["z"]) == (10, 20)  # the team sees the new point at once
    for bad in ({"x": -1}, {"x": 10_241}, {"z": -1}, {"z": 10_241}):
        assert user.patch(f"{M}/{mid}", json={**ALTAR, "shared": True, **bad}).status_code == 422
    # a teammate cannot move it, even though they see it
    assert bob.patch(f"{M}/{mid}", json={**ALTAR, "x": 1, "z": 1}).status_code == 404
    assert user.get(M).json()[0]["x"] == 10
