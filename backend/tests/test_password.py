from datetime import timedelta

import pytest
from conftest import PW, ApiClient
from sqlalchemy import update

from app.db.base import utcnow
from app.db.models import PasswordReset, User
from app.db.session import SessionLocal

AUTH = "/api/v1/auth"
NEW = "another long passphrase"


def add_user(admin: ApiClient, name: str = "bob") -> ApiClient:
    """An account created through an invitation, in its own browser."""
    token = admin.post(f"{AUTH}/invitations").json()["token"]
    guest = ApiClient(admin.app)
    body = {"token": token, "username": name, "password": PW}
    assert guest.post(f"{AUTH}/invitations/accept", json=body).status_code == 200
    return guest


def login(client: ApiClient, name: str, password: str) -> int:
    return int(
        client.post(f"{AUTH}/login", json={"username": name, "password": password}).status_code
    )


def user_id(admin: ApiClient, name: str) -> int:
    return int(next(u["id"] for u in admin.get(f"{AUTH}/users").json() if u["username"] == name))


def test_change_password(user: ApiClient) -> None:
    other_browser = ApiClient(user.app)
    assert login(other_browser, "alice", PW) == 200

    wrong = user.post(
        f"{AUTH}/password", json={"current_password": "nope nope nope", "new_password": NEW}
    )
    assert (wrong.status_code, wrong.json()) == (403, {"detail": "current_password"})
    weak = user.post(f"{AUTH}/password", json={"current_password": PW, "new_password": "short"})
    assert (weak.status_code, weak.json()) == (400, {"detail": "password"})

    ok = user.post(f"{AUTH}/password", json={"current_password": PW, "new_password": NEW})
    assert ok.status_code == 200 and ok.json()["username"] == "alice"
    assert user.get(f"{AUTH}/me").json()["username"] == "alice"  # this browser stays logged in
    assert other_browser.get(f"{AUTH}/me").json()["username"] is None  # the others are signed out
    assert login(ApiClient(user.app), "alice", PW) == 401
    assert login(ApiClient(user.app), "alice", NEW) == 200


def test_change_password_needs_login(client: ApiClient) -> None:
    r = client.post(f"{AUTH}/password", json={"current_password": PW, "new_password": NEW})
    assert r.status_code == 401


def test_only_the_first_account_is_admin(user: ApiClient) -> None:
    assert user.get(f"{AUTH}/me").json()["is_admin"] is True
    bob = add_user(user)
    assert bob.get(f"{AUTH}/me").json()["is_admin"] is False
    assert bob.get(f"{AUTH}/users").status_code == 403
    assert bob.post(f"{AUTH}/password-resets", json={"user_id": 1}).status_code == 403
    assert ApiClient(user.app).get(f"{AUTH}/users").status_code == 401


def test_admin_resets_someone_elses_password(user: ApiClient) -> None:
    bob = add_user(user)
    assert [u["username"] for u in user.get(f"{AUTH}/users").json()] == [
        "bob"
    ]  # not the admin itself

    link = user.post(f"{AUTH}/password-resets", json={"user_id": user_id(user, "bob")}).json()
    stranger = ApiClient(user.app)
    check = stranger.post(f"{AUTH}/password-resets/check", json={"token": link["token"]})
    assert check.json() == {"valid": True, "username": "bob"}

    body = {"token": link["token"], "password": "short"}
    assert (
        stranger.post(f"{AUTH}/password-resets/accept", json=body).status_code == 400
    )  # link not burnt
    body["password"] = NEW
    r = stranger.post(f"{AUTH}/password-resets/accept", json=body)
    assert r.status_code == 200 and r.json()["username"] == "bob"
    assert stranger.get(f"{AUTH}/me").json()["username"] == "bob"  # logged in right away
    assert bob.get(f"{AUTH}/me").json()["username"] is None  # old sessions revoked
    assert login(ApiClient(user.app), "bob", PW) == 401
    assert login(ApiClient(user.app), "bob", NEW) == 200

    again = ApiClient(user.app).post(f"{AUTH}/password-resets/accept", json=body)
    assert (again.status_code, again.json()) == (410, {"detail": "reset_invalid"})  # single use


def test_reset_link_expires_and_is_replaced(user: ApiClient) -> None:
    add_user(user)
    uid = user_id(user, "bob")
    first = user.post(f"{AUTH}/password-resets", json={"user_id": uid}).json()["token"]
    second = user.post(f"{AUTH}/password-resets", json={"user_id": uid}).json()["token"]
    guest = ApiClient(user.app)
    assert (
        guest.post(f"{AUTH}/password-resets/check", json={"token": first}).json()["valid"] is False
    )
    with SessionLocal() as db:
        row = db.query(PasswordReset).one()
        assert timedelta(minutes=19) < row.expires_at - utcnow() <= timedelta(minutes=20)
        db.execute(update(PasswordReset).values(expires_at=utcnow() - timedelta(seconds=1)))
        db.commit()
    body = {"token": second, "password": NEW}
    assert guest.post(f"{AUTH}/password-resets/accept", json=body).status_code == 410


def test_reset_clears_a_lockout(user: ApiClient) -> None:
    bob = add_user(user)
    bob.post(f"{AUTH}/logout")
    for _ in range(5):
        login(ApiClient(user.app), "bob", "wrong password!")
    assert login(ApiClient(user.app), "bob", PW) == 401  # locked
    token = user.post(f"{AUTH}/password-resets", json={"user_id": user_id(user, "bob")}).json()[
        "token"
    ]
    body = {"token": token, "password": NEW}
    assert ApiClient(user.app).post(f"{AUTH}/password-resets/accept", json=body).status_code == 200
    assert login(ApiClient(user.app), "bob", NEW) == 200


def test_reset_target_must_exist_and_not_be_the_admin(user: ApiClient) -> None:
    assert user.post(f"{AUTH}/password-resets", json={"user_id": 999}).status_code == 404
    with SessionLocal() as db:
        admin_id = db.query(User).filter_by(first_account=True).one().id
    assert user.post(f"{AUTH}/password-resets", json={"user_id": admin_id}).status_code == 404


def test_unknown_reset_token(client: ApiClient) -> None:
    assert client.post(f"{AUTH}/password-resets/check", json={"token": "nope"}).json() == {
        "valid": False,
        "username": None,
    }
    body = {"token": "nope", "password": NEW}
    assert client.post(f"{AUTH}/password-resets/accept", json=body).status_code == 410


def test_cli_reset_password(user: ApiClient) -> None:
    from app.cli import reset_password

    with SessionLocal() as db:
        reset_password(db, "ALICE", NEW)
        for bad_name, bad_password in (("nobody", NEW), ("alice", "short")):
            with pytest.raises(SystemExit):
                reset_password(db, bad_name, bad_password)
    assert user.get(f"{AUTH}/me").json()["username"] is None  # signed out
    assert login(ApiClient(user.app), "alice", PW) == 401
    assert login(ApiClient(user.app), "alice", NEW) == 200
