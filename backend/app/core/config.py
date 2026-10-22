from functools import lru_cache

from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """All configuration comes from environment variables (or a local .env)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    environment: str = "production"  # "development" enables the OpenAPI docs
    database_url: str = "sqlite:///./data/app.db"

    cookie_secure: bool = True  # set COOKIE_SECURE=false only for plain-http tests
    # Authorises the creation of the first account; generated and logged at start when unset.
    setup_token: SecretStr | None = None
    session_days: int = 30
    invitation_minutes: int = 20  # lifetime of the link a user sends to create an account

    login_rate_limit: str = "10/5 minutes"  # per client address
    register_rate_limit: str = "10/hour"  # setup and invitations
    lockout_threshold: int = 5  # failed logins before an account is locked progressively

    max_marks: int = 200_000
    max_settings_bytes: int = 256_000
    max_body_bytes: int = 4_000_000

    @field_validator("setup_token")
    @classmethod
    def _setup_token_size(cls, token: SecretStr | None) -> SecretStr | None:
        # Empty means "generate one". The upper bound is what the API accepts in the request body.
        if token and token.get_secret_value() and not 16 <= len(token.get_secret_value()) <= 128:
            raise ValueError("SETUP_TOKEN must be 16 to 128 characters long")
        return token


@lru_cache
def get_settings() -> Settings:
    return Settings()
