import json
from pathlib import Path

import httpx

from app.core.addon_registry import AddonRegistry
from app.core.config import Settings


def _manifest(*ids: str) -> dict[str, object]:
    return {
        "api_version": 2,
        "entries": [
            {
                "id": i,
                "version": "1.0",
                "name": {"fr": i, "en": i},
                "description": {"fr": "d", "en": "d"},
                "element": f"addon-{i}",
                "capabilities": ["tab"],
                "script": "/addon/main.js",
                "styles": "/addon/main.css",
            }
            for i in ids
        ],
    }


class Clock:
    t = 0.0

    def __call__(self) -> float:
        return self.t


def _make(
    tmp_path: Path, handler: object, addons: str = "", clock: Clock | None = None
) -> AddonRegistry:
    s = Settings(_env_file=None, addons=addons, addons_dir=str(tmp_path))
    client = httpx.Client(transport=httpx.MockTransport(handler))  # type: ignore[arg-type]
    return AddonRegistry(s, client, clock or Clock())


def _static(tmp_path: Path, key: str, *ids: str) -> None:
    (tmp_path / key).mkdir()
    (tmp_path / key / "addon.json").write_text(json.dumps(_manifest(*ids)))


def _ok(request: httpx.Request) -> httpx.Response:
    assert request.url.path == "/addon/api/manifest"
    return httpx.Response(200, json=_manifest("a1"))


def test_container_and_static_keys_merge(tmp_path: Path) -> None:
    _static(tmp_path, "zed", "z1")
    reg = _make(tmp_path, _ok, "main=http://x:1")
    assert [(e.key, e.id) for e in reg.entries()] == [("main", "a1"), ("zed", "z1")]
    assert reg.entry("z1") is not None and reg.entry("z1").script == "/addon/zed/main.js"  # type: ignore[union-attr]
    assert reg.entry("nope") is None


def test_container_wins_over_folder(tmp_path: Path) -> None:
    _static(tmp_path, "main", "f1")
    assert [e.id for e in _make(tmp_path, _ok, "main=http://x:1").entries()] == ["a1"]


def test_duplicate_id_rejects_later_key(tmp_path: Path) -> None:
    _static(tmp_path, "zed", "a1", "z2")
    reg = _make(tmp_path, _ok, "main=http://x:1")
    assert [(e.key, e.id) for e in reg.entries()] == [("main", "a1")]


def test_down_then_up_appears_after_ttl(tmp_path: Path) -> None:
    up = False

    def handler(request: httpx.Request) -> httpx.Response:
        if not up:
            raise httpx.ConnectError("down")
        return _ok(request)

    clock = Clock()
    reg = _make(tmp_path, handler, "main=http://x:1", clock)
    assert reg.entries() == []
    up, clock.t = True, 31.0
    assert [e.id for e in reg.entries()] == ["a1"]


def test_oversized_or_invalid_json_ignored(tmp_path: Path) -> None:
    bodies = [b"x" * 70000, b"not json", b"[]", json.dumps({"api_version": 1}).encode()]
    for body in bodies:
        reg = _make(tmp_path, lambda r, b=body: httpx.Response(200, content=b), "main=http://x:1")
        assert reg.entries() == []
    reg = _make(tmp_path, lambda r: httpx.Response(500, json=_manifest("a1")), "main=http://x:1")
    assert reg.entries() == []


def test_ttl_caches(tmp_path: Path) -> None:
    calls: list[int] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(1)
        return _ok(request)

    clock = Clock()
    reg = _make(tmp_path, handler, "main=http://x:1", clock)
    reg.entries()
    clock.t = 29.0
    reg.entries()
    assert len(calls) == 1
    clock.t = 31.0
    reg.entries()
    assert len(calls) == 2


def test_deeply_nested_json_ignored_others_load(tmp_path: Path) -> None:
    (tmp_path / "deep").mkdir()
    (tmp_path / "deep" / "addon.json").write_text("[" * 60000)
    _static(tmp_path, "ok", "z1")

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "bad":
            return httpx.Response(200, content=b"[" * 60000)
        return _ok(request)

    reg = _make(tmp_path, handler, "bad=http://bad:1,main=http://x:1")
    assert [e.id for e in reg.entries()] == ["a1", "z1"]


def test_invalid_url_origin_does_not_break_others(tmp_path: Path) -> None:
    _static(tmp_path, "ok", "z1")
    reg = _make(tmp_path, _ok, "bad=http://a:b:c,main=http://x:1")
    assert [e.id for e in reg.entries()] == ["a1", "z1"]


def test_duplicate_element_rejects_later_key(tmp_path: Path) -> None:
    m = _manifest("z9")
    m["entries"][0]["element"] = "addon-a1"  # type: ignore[index]
    (tmp_path / "zed").mkdir()
    (tmp_path / "zed" / "addon.json").write_text(json.dumps(m))
    reg = _make(tmp_path, _ok, "main=http://x:1")
    assert [(e.key, e.id) for e in reg.entries()] == [("main", "a1")]
