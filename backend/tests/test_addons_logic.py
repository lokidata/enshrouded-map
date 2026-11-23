import copy
import json
from pathlib import Path
from typing import Any

import pytest

from app.core.addons import configured_origins, parse_manifest
from app.core.config import Settings


def _settings(**kw: Any) -> Settings:
    return Settings(_env_file=None, **kw)


def test_origins_alias() -> None:
    s = _settings(addons="a=http://x:1,b=https://y.lan", addon_url="http://m:2")
    assert configured_origins(s) == {"a": "http://x:1", "b": "https://y.lan", "main": "http://m:2"}
    assert configured_origins(_settings()) == {}


def test_addon_url_one_trailing_slash_tolerated() -> None:
    assert configured_origins(_settings(addon_url="http://m:2/")) == {"main": "http://m:2"}
    with pytest.raises(ValueError):
        configured_origins(_settings(addon_url="http://m:2//"))
    with pytest.raises(ValueError):
        configured_origins(_settings(addons="a=http://x:1/"))


@pytest.mark.parametrize("raw", ["a=http://x/y", "A=http://x", "a=ftp://x", "a=http://x y"])
def test_origins_reject_path_and_bad_key(raw: str) -> None:
    with pytest.raises(ValueError):
        configured_origins(_settings(addons=raw))


RAW: dict[str, object] = {
    "api_version": 2,
    "entries": [
        {
            "id": "status",
            "version": "1.0.0",
            "name": {"fr": "Statut", "en": "Status"},
            "description": {"fr": "Etat", "en": "State"},
            "element": "addon-status",
            "capabilities": ["tab"],
            "script": "/addon/main.js",
            "styles": "/addon/main.css",
        }
    ],
}


def test_parse_ok() -> None:
    entries = parse_manifest("k", RAW)
    assert entries is not None and len(entries) == 1
    e = entries[0]
    assert (e.key, e.id, e.script, e.styles) == (
        "k",
        "status",
        "/addon/k/main.js",
        "/addon/k/main.css",
    )
    assert e.capabilities == ("tab",) and e.name["fr"] == "Statut"


def _mut(fn: Any) -> dict[str, object]:
    raw = copy.deepcopy(RAW)
    fn(raw["entries"][0], raw)  # type: ignore[index]
    return raw


def _dup(_e, raw):  # type: ignore[no-untyped-def]
    raw["entries"].append(copy.deepcopy(raw["entries"][0]))


def _many(_e, raw):  # type: ignore[no-untyped-def]
    raw["entries"] = [{**raw["entries"][0], "id": f"e{i}"} for i in range(21)]


BAD = [
    lambda e, r: r.update(api_version=1),
    lambda e, r: e.update(script="/addon/../x.js"),
    lambda e, r: e.update(script="/addon//x.js"),
    lambda e, r: e.update(script="/other/main.js"),
    lambda e, r: e.update(script="https://x/main.js"),
    lambda e, r: e.update(element="script"),
    lambda e, r: e.update(capabilities=["root"]),
    lambda e, r: e.update(capabilities=[]),
    lambda e, r: e.update(name={"en": "Status"}),
    _many,
    _dup,
]


@pytest.mark.parametrize("fn", BAD)
def test_parse_refuses(fn: Any) -> None:
    assert parse_manifest("k", _mut(fn)) is None


def test_parse_not_a_dict() -> None:
    assert parse_manifest("k", []) is None


def test_example_manifest_parses() -> None:
    p = Path(__file__).resolve().parents[2] / "frontend/e2e/fixtures/addons/hello/addon.json"
    entries = parse_manifest("hello", json.loads(p.read_text()))
    assert entries is not None
    assert {(e.script, e.styles) for e in entries} == {
        ("/addon/hello/main.js", "/addon/hello/styles.css")
    }
