from types import SimpleNamespace
from unittest.mock import patch

import pytest
from conftest import PW, ApiClient
from webauthn.helpers.exceptions import InvalidAuthenticationResponse, InvalidRegistrationResponse

from app.core import passkeys as challenges
from app.core.config import Settings
from app.main import app

P = "/api/v1/auth/passkeys"
CRED = {"id": "AQID", "rawId": "AQID", "type": "public-key", "response": {}}


@pytest.fixture(autouse=True)
def _configured(settings: Settings) -> None:
    settings.webauthn_rp_id = "carte.example.lan"
    settings.webauthn_origin = "https://carte.example.lan"
    challenges._pending.clear()


def verified_registration(count: int = 0) -> SimpleNamespace:
    return SimpleNamespace(
        credential_id=b"\x01\x02\x03", credential_public_key=b"key", sign_count=count
    )


def register(client: ApiClient, name: str = "Téléphone") -> None:
    assert client.post(f"{P}/register/options").status_code == 200
    with patch(
        "app.api.v1.passkeys.verify_registration_response", return_value=verified_registration()
    ):
        r = client.post(f"{P}/register/verify", json={"name": name, "credential": CRED})
    assert r.status_code == 200, r.text


def test_disabled_without_configuration(user: ApiClient, settings: Settings) -> None:
    settings.webauthn_rp_id = ""
    assert user.get(P).status_code == 404
    assert user.get("/api/v1/auth/me").json()["passkeys_enabled"] is False


def test_enabled_flag_and_login_required(client: ApiClient) -> None:
    assert client.get("/api/v1/auth/me").json()["passkeys_enabled"] is True
    assert client.get(P).status_code == 401
    assert client.post(f"{P}/register/options").status_code == 401


def test_register_list_delete(user: ApiClient) -> None:
    options = user.post(f"{P}/register/options").json()
    assert options["rp"]["id"] == "carte.example.lan"
    assert options["authenticatorSelection"]["residentKey"] == "required"
    register(user)
    [passkey] = user.get(P).json()
    assert passkey["name"] == "Téléphone" and passkey["last_used_at"] is None
    assert user.delete(f"{P}/{passkey['id']}").status_code == 200
    assert user.get(P).json() == []
    assert user.delete(f"{P}/{passkey['id']}").status_code == 404


def test_registration_refused_or_replayed(user: ApiClient) -> None:
    # no challenge was asked for
    assert (
        user.post(f"{P}/register/verify", json={"name": "x", "credential": CRED}).status_code == 400
    )
    user.post(f"{P}/register/options")
    with patch(
        "app.api.v1.passkeys.verify_registration_response",
        side_effect=InvalidRegistrationResponse("bad"),
    ):
        assert (
            user.post(f"{P}/register/verify", json={"name": "x", "credential": CRED}).status_code
            == 400
        )
    # the challenge is used up, even by a failure
    with patch(
        "app.api.v1.passkeys.verify_registration_response", return_value=verified_registration()
    ):
        assert (
            user.post(f"{P}/register/verify", json={"name": "x", "credential": CRED}).status_code
            == 400
        )


def test_challenge_expires(user: ApiClient) -> None:
    user.post(f"{P}/register/options")
    for key, (challenge, purpose, _) in list(challenges._pending.items()):
        challenges._pending[key] = (challenge, purpose, 0.0)
    with patch(
        "app.api.v1.passkeys.verify_registration_response", return_value=verified_registration()
    ):
        assert (
            user.post(f"{P}/register/verify", json={"name": "x", "credential": CRED}).status_code
            == 400
        )


def test_login_with_a_passkey(user: ApiClient) -> None:
    register(user)
    with ApiClient(app) as anonymous:
        assert anonymous.post(f"{P}/login/options").json()["rpId"] == "carte.example.lan"
        verified = SimpleNamespace(new_sign_count=5)
        with patch(
            "app.api.v1.passkeys.verify_authentication_response", return_value=verified
        ) as check:
            r = anonymous.post(f"{P}/login/verify", json={"credential": CRED})
        assert r.status_code == 200 and r.json()["username"] == "alice"
        assert check.call_args.kwargs["require_user_verification"] is True
        assert anonymous.get("/api/v1/auth/me").json()["username"] == "alice"
    [passkey] = user.get(P).json()
    assert passkey["last_used_at"] is not None


def test_login_refused(user: ApiClient) -> None:
    register(user)
    with ApiClient(app) as anonymous:
        # unknown credential
        anonymous.post(f"{P}/login/options")
        other = {**CRED, "id": "AAAA"}
        assert anonymous.post(f"{P}/login/verify", json={"credential": other}).status_code == 401
        # bad signature
        anonymous.post(f"{P}/login/options")
        with patch(
            "app.api.v1.passkeys.verify_authentication_response",
            side_effect=InvalidAuthenticationResponse("bad"),
        ):
            assert anonymous.post(f"{P}/login/verify", json={"credential": CRED}).status_code == 401
        # no challenge
        assert anonymous.post(f"{P}/login/verify", json={"credential": CRED}).status_code == 400
        assert anonymous.get("/api/v1/auth/me").json()["username"] is None


def test_passkeys_go_with_the_account(user: ApiClient) -> None:
    token = user.post("/api/v1/auth/invitations").json()["token"]
    with ApiClient(app) as bob:
        body = {"token": token, "username": "bob", "password": PW}
        bob.post("/api/v1/auth/invitations/accept", json=body)
        register(bob)
        assert len(bob.get(P).json()) == 1
        assert user.get(P).json() == []  # not shared
        assert bob.post("/api/v1/auth/delete-account", json={"password": PW}).status_code == 200
    from app.db.models import Passkey
    from app.db.session import SessionLocal

    with SessionLocal() as db:
        assert db.query(Passkey).count() == 0
