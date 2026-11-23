"""Pure helpers for the optional server add-ons: configured origins and manifest parsing."""

import re
from dataclasses import dataclass

from app.core.config import Settings

KEY_RE = re.compile(r"[a-z0-9-]{1,20}")
ORIGIN_RE = re.compile(r"https?://[A-Za-z0-9.:_-]+")
ELEMENT_RE = re.compile(r"addon-[a-z0-9-]{1,30}")
PATH_RE = re.compile(r"(?!.*(\.\.|//))/addon/[A-Za-z0-9._/-]{1,100}")
CAPABILITIES = frozenset({"tab", "map-layer"})
MAX_ENTRIES = 20
LANGS = ("fr", "en")


@dataclass(frozen=True)
class Entry:
    key: str
    id: str
    version: str
    name: dict[str, str]
    description: dict[str, str]
    element: str
    capabilities: tuple[str, ...]
    script: str
    styles: str


def configured_origins(settings: Settings) -> dict[str, str]:
    """Key -> origin from ADDONS, plus `main` from ADDON_URL. Raises ValueError when malformed."""
    out: dict[str, str] = {}
    for item in filter(None, (p.strip() for p in settings.addons.split(","))):
        key, sep, origin = item.partition("=")
        if not sep or not KEY_RE.fullmatch(key) or not ORIGIN_RE.fullmatch(origin):
            raise ValueError(f"invalid ADDONS item: {item!r}")
        out[key] = origin
    if settings.addon_url:
        url = settings.addon_url.removesuffix(
            "/"
        )  # one trailing slash tolerated (ADDONS values: no)
        if not ORIGIN_RE.fullmatch(url):
            raise ValueError("invalid ADDON_URL")
        out["main"] = url
    return out


def _text(raw: object, limit: int) -> dict[str, str] | None:
    if not isinstance(raw, dict):
        return None
    out: dict[str, str] = {}
    for lang in LANGS:
        v = raw.get(lang)
        if not isinstance(v, str) or not 1 <= len(v) <= limit:
            return None
        out[lang] = v
    return out


def _path(key: str, raw: object) -> str | None:
    if not isinstance(raw, str) or not PATH_RE.fullmatch(raw):
        return None
    return f"/addon/{key}/{raw.removeprefix('/addon/')}"


def parse_manifest(key: str, raw: object) -> list[Entry] | None:
    """Validate a raw manifest; None when anything is off. Paths are rewritten to /addon/<key>/."""
    if not isinstance(raw, dict) or raw.get("api_version") != 2:
        return None
    items = raw.get("entries")
    if not isinstance(items, list) or len(items) > MAX_ENTRIES:
        return None
    entries: list[Entry] = []
    for it in items:
        if not isinstance(it, dict):
            return None
        eid, ver, el = it.get("id"), it.get("version"), it.get("element")
        caps = it.get("capabilities")
        name, desc = _text(it.get("name"), 40), _text(it.get("description"), 200)
        script, styles = _path(key, it.get("script")), _path(key, it.get("styles"))
        if (
            not isinstance(eid, str)
            or not KEY_RE.fullmatch(eid)
            or not isinstance(ver, str)
            or not 1 <= len(ver) <= 20
            or not isinstance(el, str)
            or not ELEMENT_RE.fullmatch(el)
            or not isinstance(caps, list)
            or not caps
            or not all(isinstance(c, str) and c in CAPABILITIES for c in caps)
            or name is None
            or desc is None
            or script is None
            or styles is None
        ):
            return None
        entries.append(
            Entry(key, eid, ver, name, desc, el, tuple(dict.fromkeys(caps)), script, styles)
        )
    if len({e.id for e in entries}) != len(entries):
        return None
    return entries
