import time

from fastapi import HTTPException

from app.core.config import get_settings
from app.core.security import new_token

CHALLENGE_SECONDS = 300
MAX_PENDING = 1000

# shortcut: challenges live in this process (one uvicorn worker, like the rate limits);
# move them to the database when the API runs with several workers.
_pending: dict[str, tuple[bytes, str, float]] = {}


def passkeys_enabled() -> bool:
    s = get_settings()
    return bool(s.webauthn_rp_id and s.webauthn_origin)


def require_enabled() -> None:
    if not passkeys_enabled():
        raise HTTPException(404, "passkeys_disabled")


def remember(challenge: bytes, purpose: str) -> str:
    """Keeps a challenge for a few minutes and returns the key to send back as a cookie."""
    now = time.monotonic()
    for key in [k for k, (_, _, until) in _pending.items() if until < now]:
        del _pending[key]
    if len(_pending) >= MAX_PENDING:
        raise HTTPException(429, "too_many_requests")
    key = new_token()
    _pending[key] = (challenge, purpose, now + CHALLENGE_SECONDS)
    return key


def take(key: str | None, purpose: str) -> bytes:
    """The challenge for this key, used up: 400 when it is unknown, expired or for another use."""
    entry = _pending.pop(key, None) if key else None
    if entry is None or entry[1] != purpose or entry[2] < time.monotonic():
        raise HTTPException(400, "passkey")
    return entry[0]
