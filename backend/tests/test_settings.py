import re
from pathlib import Path

import pytest
from conftest import ApiClient
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.schemas.settings import LANGUAGES

ROOT = Path(__file__).resolve().parents[2]

URL = "/api/v1/settings"


def test_requires_login(client: ApiClient) -> None:
    assert client.get(URL).status_code == 401


def test_roundtrip(user: ApiClient) -> None:
    assert user.get(URL).json() == {"settings": None}
    state = {"lang": "fr", "filters": {"chest": [1, 2]}, "nom": "été"}
    assert user.put(URL, json={"settings": state}).status_code == 200
    assert user.get(URL).json() == {"settings": state}
    user.put(URL, json={"settings": {"lang": "en"}})
    assert user.get(URL).json() == {"settings": {"lang": "en"}}


def test_validation_and_size(user: ApiClient, settings: Settings) -> None:
    assert user.put(URL, json={"settings": [1]}).status_code == 422
    assert user.put(URL, json={"settings": None}).status_code == 422
    settings.max_settings_bytes = 50
    assert user.put(URL, json={"settings": {"x": "y" * 100}}).status_code == 400


def test_language_must_be_supported(user: ApiClient) -> None:
    assert user.put(URL, json={"settings": {"lang": "xx"}}).status_code == 422
    assert user.put(URL, json={"settings": {"lang": 1}}).status_code == 422
    assert user.put(URL, json={"settings": {"filters": {}}}).status_code == 200  # none: allowed
    assert user.put(URL, json={"settings": {"lang": "en"}}).status_code == 200


def test_missing_language_keeps_the_accounts_one(user: ApiClient) -> None:
    """A stale tab or an older front end saves only the filters: the language stays."""
    user.put(URL, json={"settings": {"lang": "en", "filters": {"a": True}}})
    user.put(URL, json={"settings": {"filters": {"b": False}}})
    assert user.get(URL).json() == {"settings": {"filters": {"b": False}, "lang": "en"}}
    user.put(URL, json={"settings": {"filters": {}, "lang": "fr"}})  # an explicit choice wins
    assert user.get(URL).json()["settings"]["lang"] == "fr"


def test_language_list_matches_the_front_end() -> None:
    """A language added on one side only would make every save answer 422."""
    source = (ROOT / "frontend/src/app/core/lang.ts").read_text()
    match = re.search(r"LANGUAGES: readonly string\[\] = \[([^\]]*)\]", source)
    assert match, "LANGUAGES not found in lang.ts"
    assert tuple(re.findall(r"'([a-z]+)'", match.group(1))) == LANGUAGES


def test_two_first_saves_at_once_do_not_fail(
    user: ApiClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """The timer and the page-leave send can both create the row: the loser updates it."""
    user.put(URL, json={"settings": {"a": 1}})  # the row the other request made
    real_commit = Session.commit
    calls = {"n": 0}

    def flaky(self: Session) -> None:
        calls["n"] += 1
        if calls["n"] == 1:
            raise IntegrityError("INSERT", {}, Exception("unique"))
        real_commit(self)

    monkeypatch.setattr(Session, "commit", flaky)
    assert user.put(URL, json={"settings": {"a": 2}}).status_code == 200
    assert user.get(URL).json() == {"settings": {"a": 2}}
