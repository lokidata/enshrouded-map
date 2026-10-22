import hashlib
import hmac
import re
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

from app.core.common_passwords import COMMON_PASSWORDS

MIN_PASSWORD = 10
MAX_PASSWORD = 128  # bounds the work Argon2 does on attacker-supplied input

_hasher = PasswordHasher()
# Verified against when the user does not exist, so both cases cost the same.
_DUMMY_HASH = _hasher.hash(secrets.token_urlsafe(16))


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(stored: str | None, password: str) -> bool:
    try:
        _hasher.verify(stored or _DUMMY_HASH, password)
    except (VerificationError, InvalidHashError):
        return False
    return stored is not None


def needs_rehash(stored: str) -> bool:
    return _hasher.check_needs_rehash(stored)


def password_is_acceptable(password: str, username: str) -> bool:
    if not MIN_PASSWORD <= len(password) <= MAX_PASSWORD:
        return False
    lowered = password.lower()
    return lowered not in COMMON_PASSWORDS and lowered != username.lower()


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def tokens_equal(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


USERNAME = re.compile(r"^[A-Za-z0-9_.-]{3,32}$")
