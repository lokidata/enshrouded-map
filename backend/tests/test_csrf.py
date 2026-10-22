from conftest import PW, ApiClient


def test_cookie_issued_on_get(client: ApiClient) -> None:
    r = client.get("/api/v1/health")
    assert "xsrf-token" in r.headers["set-cookie"].lower()


def test_unsafe_request_without_token_is_refused(client: ApiClient) -> None:
    body = {"username": "alice", "password": PW}
    assert client.request("POST", "/api/v1/auth/setup", json=body, csrf=False).status_code == 403
    client.get("/api/v1/health")
    r = client.request("POST", "/api/v1/auth/setup", json=body, csrf=False)  # cookie but no header
    assert r.status_code == 403 and r.json() == {"detail": "csrf"}
    r = client.request(
        "POST", "/api/v1/auth/setup", json=body, csrf=False, headers={"X-XSRF-TOKEN": "x"}
    )
    assert r.status_code == 403
    assert client.post("/api/v1/auth/setup", json=body).status_code == 200


def test_state_changing_endpoints_are_protected(user: ApiClient) -> None:
    for method, url, body in [
        ("PUT", "/api/v1/progress", {"ids": ["chest:1:2"]}),
        ("PUT", "/api/v1/settings", {"settings": {}}),
        ("POST", "/api/v1/auth/logout", None),
    ]:
        assert user.request(method, url, json=body, csrf=False).status_code == 403
