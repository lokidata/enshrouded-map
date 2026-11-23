"""In-memory registry of the add-on entries, refreshed from manifests at most every 30 s."""

import json
import logging
import threading
import time
from collections.abc import Callable
from pathlib import Path

import httpx

from app.core.addons import KEY_RE, Entry, configured_origins, parse_manifest
from app.core.config import Settings

log = logging.getLogger("app")
TTL = 30.0
TIMEOUT = 3.0
MAX_BYTES = 64 * 1024


class AddonRegistry:
    def __init__(
        self,
        settings: Settings,
        client: httpx.Client | None = None,
        now: Callable[[], float] = time.monotonic,
    ) -> None:
        self._settings = settings
        self._client = client  # created lazily: no socket or network at startup
        self._now = now
        self._lock = threading.Lock()
        self._entries: list[Entry] = []
        self._next = 0.0
        self._loaded = False

    def entries(self) -> list[Entry]:
        with self._lock:
            if not self._loaded or self._now() >= self._next:
                self._entries = self._load()
                self._next = self._now() + TTL
                self._loaded = True
            return list(self._entries)

    def entry(self, entry_id: str) -> Entry | None:
        return next((e for e in self.entries() if e.id == entry_id), None)

    def _load(self) -> list[Entry]:
        raws: dict[str, object] = {}
        # A key that is both a container and a folder: the container wins.
        for key, path in self._static().items():
            raws[key] = self._read_file(path)
        try:
            origins = configured_origins(self._settings)
        except ValueError as exc:  # a bad ADDONS value must not break requests
            log.error("Add-ons: %s", exc)
            origins = {}
        for key, origin in origins.items():
            raws[key] = self._fetch(origin)
        out: list[Entry] = []
        ids: set[str] = set()
        elements: set[str] = set()
        for key in sorted(raws):
            parsed = parse_manifest(key, raws[key])
            if parsed is None:
                if raws[key] is not None:
                    log.warning("Add-on %s: invalid manifest", key)
                continue
            if ids & {e.id for e in parsed}:
                log.warning("Add-on %s: duplicate entry id, key rejected", key)
                continue
            if elements & {e.element for e in parsed}:
                log.warning("Add-on %s: duplicate element name, key rejected", key)
                continue
            ids |= {e.id for e in parsed}
            elements |= {e.element for e in parsed}
            out += parsed
        return out

    def _static(self) -> dict[str, Path]:
        root = Path(self._settings.addons_dir)
        try:
            return {
                d.name: d / "addon.json"
                for d in root.iterdir()
                if KEY_RE.fullmatch(d.name) and (d / "addon.json").is_file()
            }
        except OSError:
            return {}

    @staticmethod
    def _read_file(path: Path) -> object:
        try:
            with path.open("rb") as f:
                data = f.read(MAX_BYTES + 1)
            return json.loads(data) if len(data) <= MAX_BYTES else None
        except (OSError, ValueError, RecursionError):
            return None

    def _fetch(self, origin: str) -> object:
        if self._client is None:
            self._client = httpx.Client(timeout=TIMEOUT, follow_redirects=False)
        try:
            with self._client.stream("GET", f"{origin}/addon/api/manifest", timeout=TIMEOUT) as r:
                if r.status_code != 200:
                    return None
                data = b""
                for chunk in r.iter_bytes():
                    data += chunk
                    if len(data) > MAX_BYTES:
                        return None
            return json.loads(data)
        except (httpx.HTTPError, httpx.InvalidURL, ValueError, RecursionError):
            return None
