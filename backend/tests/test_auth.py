from datetime import timedelta
from unittest.mock import patch

from conftest import PW, ApiClient
from sqlalchemy import update

from app.core.config import Settings
from app.db.base import utcnow
from app.db.models import Invitation
from app.db.session import SessionLocal

SETUP = "/api/v1/auth/setup"
LOGIN = "/api/v1/auth/login"
INVITE = "/api/v1/auth/invitations"


def test_setup_is_required_until_the_first_account_exists(client: ApiClient) -> None:
    assert client.get("/api/v1/auth/me").json() == {"username": None, "setup_required": True}
    r = client.post(SETUP, json={"username": "Alice", "password": PW})
    assert r.json() == {"username": "Alice", "setup_required": False}
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    assert client.get("/api/v1/auth/me").json()["username"] == "Alice"

    client.post("/api/v1/auth/logout")
    assert client.get("/api/v1/auth/me").json() == {"username": None, "setup_required": False}


def test_setup_is_refused_once_an_account_exists(user: ApiClient) -> None:
    r = user.post(SETUP, json={"username": "mallory", "password": PW})
    assert (r.status_code, r.json()) == (409, {"detail": "setup_done"})


def test_open_registration_does_not_exist(client: ApiClient) -> None:
    r = client.post("/api/v1/auth/register", json={"username": "bob", "password": PW})
    assert r.status_code == 404


def test_account_validation(client: ApiClient) -> None:
    assert client.post(SETUP, json={"username": "al", "password": PW}).status_code == 422
    assert client.post(SETUP, json={"username": "bob", "password": "short"}).status_code == 400
    assert (
        client.post(SETUP, json={"username": "bob", "password": "password123"}).status_code == 400
    )
    assert client.post(SETUP, json={"username": "bob", "password": 123456}).status_code == 422
    r = client.post(SETUP, json={"username": "bob", "password": PW, "admin": True})
    assert r.status_code == 422 and r.json() == {"detail": "invalid_request"}
    assert client.get("/api/v1/auth/me").json()["setup_required"] is True  # nothing was created


def test_login_logout_case_insensitive(user: ApiClient) -> None:
    user.post("/api/v1/auth/logout")
    assert user.post(LOGIN, json={"username": "ALICE", "password": PW}).status_code == 200
    assert user.get("/api/v1/auth/me").json()["username"] == "alice"


def test_wrong_credentials_are_indistinguishable(user: ApiClient) -> None:
    user.post("/api/v1/auth/logout")
    a = user.post(LOGIN, json={"username": "alice", "password": "wrong password!"})
    b = user.post(LOGIN, json={"username": "nobody", "password": "wrong password!"})
    assert (
        (a.status_code, a.json()) == (b.status_code, b.json()) == (401, {"detail": "credentials"})
    )


def test_login_rotates_session(user: ApiClient) -> None:
    old = user.cookies.get("session")
    user.post(LOGIN, json={"username": "alice", "password": PW})
    assert user.cookies.get("session") != old
    user.cookies.set("session", old or "")
    assert user.get("/api/v1/auth/me").json()["username"] is None  # old token revoked


def test_progressive_lockout(user: ApiClient, settings: Settings) -> None:
    settings.login_rate_limit = "1000/minute"
    user.post("/api/v1/auth/logout")
    for _ in range(settings.lockout_threshold):
        user.post(LOGIN, json={"username": "alice", "password": "wrong password!"})
    # locked: even the right password is refused, with the usual answer
    r = user.post(LOGIN, json={"username": "alice", "password": PW})
    assert (r.status_code, r.json()) == (401, {"detail": "credentials"})


def test_login_rate_limit(client: ApiClient, settings: Settings) -> None:
    settings.login_rate_limit = "3/minute"
    codes = [
        client.post(LOGIN, json={"username": "nobody", "password": "wrong password!"}).status_code
        for _ in range(5)
    ]
    assert codes == [401, 401, 401, 429, 429]


# ---- invitations ----


def accept(client: ApiClient, token: str, username: str = "bob") -> int:
    body = {"token": token, "username": username, "password": PW}
    return int(client.post(f"{INVITE}/accept", json=body).status_code)


def test_invitation_requires_login(client: ApiClient) -> None:
    assert client.post(INVITE).status_code == 401


def test_invitation_creates_one_account_then_is_spent(user: ApiClient) -> None:
    invite = user.post(INVITE).json()
    assert user.post(f"{INVITE}/check", json={"token": invite["token"]}).json() == {"valid": True}

    guest = ApiClient(user.app)  # another browser
    assert accept(guest, invite["token"]) == 200
    assert guest.get("/api/v1/auth/me").json()["username"] == "bob"

    assert user.post(f"{INVITE}/check", json={"token": invite["token"]}).json() == {"valid": False}
    other = ApiClient(user.app)
    r = other.post(
        f"{INVITE}/accept", json={"token": invite["token"], "username": "eve", "password": PW}
    )
    assert (r.status_code, r.json()) == (410, {"detail": "invitation_invalid"})


def test_invitation_expires_after_20_minutes(user: ApiClient) -> None:
    token = user.post(INVITE).json()["token"]
    with SessionLocal() as db:
        row = db.query(Invitation).one()
        assert timedelta(minutes=19) < row.expires_at - utcnow() <= timedelta(minutes=20)
        db.execute(update(Invitation).values(expires_at=utcnow() - timedelta(seconds=1)))
        db.commit()
    assert user.post(f"{INVITE}/check", json={"token": token}).json() == {"valid": False}
    assert accept(ApiClient(user.app), token) == 410


def test_failed_signup_does_not_burn_the_link(user: ApiClient) -> None:
    token = user.post(INVITE).json()["token"]
    guest = ApiClient(user.app)
    assert accept(guest, token, "alice") == 409  # name taken
    body = {"token": token, "username": "bob", "password": "short"}
    assert guest.post(f"{INVITE}/accept", json=body).status_code == 400
    assert accept(guest, token, "bob") == 200


def test_made_up_token_does_not_reveal_usernames(user: ApiClient) -> None:
    # "alice" exists: with a bad token the answer must be the same as for a free name
    assert accept(ApiClient(user.app), "nope", "alice") == 410
    assert accept(ApiClient(user.app), "nope", "nobody") == 410


def test_unknown_token(client: ApiClient) -> None:
    assert client.post(f"{INVITE}/check", json={"token": "nope"}).json() == {"valid": False}
    assert accept(client, "nope") == 410


def test_invitation_is_not_stored_in_clear(user: ApiClient) -> None:
    token = user.post(INVITE).json()["token"]
    with SessionLocal() as db:
        assert db.query(Invitation).one().token_hash != token
    with patch("app.api.v1.auth.audit") as audit:
        accept(ApiClient(user.app), token)
    assert token not in str(audit.mock_calls)
