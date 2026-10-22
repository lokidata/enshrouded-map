import secrets
from functools import lru_cache

from app.core.config import get_settings


@lru_cache
def setup_token() -> tuple[str, bool]:
    """The code that authorises creating the first account, and whether it was generated here.

    SETUP_TOKEN from the environment when set; otherwise a random one, shown once in the log
    at start (only the person who can read the API log can create the first account).
    """
    configured = get_settings().setup_token
    if configured and configured.get_secret_value():
        return configured.get_secret_value(), False
    return secrets.token_urlsafe(16), True
