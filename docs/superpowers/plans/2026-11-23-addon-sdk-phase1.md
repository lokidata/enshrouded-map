# Add-on SDK, phase 1: several add-ons on the site Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The site hosts several add-ons (containers or static folders), keeps their activation and access lists itself, and the current add-on moves to the new contract.

**Architecture:** The site backend reads one manifest per add-on key (HTTP for containers, `addon.json` for static folders), keeps `addon_entries` / `addon_access` in its database and serves `/api/v1/addons*`. nginx proxies `/addon/<key>/` (prefix stripped) or serves a static folder. The front end mounts one element per entry with a `base` attribute. The add-on repository drops its own access code and asks the site `/me`.

**Tech Stack:** FastAPI, SQLAlchemy 2, Alembic, httpx; Angular signals + Vitest + Playwright; nginx shell entrypoint; FastAPI add-on + Angular elements (second repository).

**Spec:** `docs/superpowers/specs/2026-11-23-addon-sdk-design.md`

## Global Constraints
- Repositories: site = `/home/thomas/Documents/git/enshrouded-map` (tasks 1-10, 14), add-on = `/home/thomas/Documents/git/enshrouded-map-addon` (tasks 11-13). Task headers name the repository.
- **No commit, push or PR** at any step: the user tests locally and approves first (project memory). Leave changes in the working tree. Release (version bump, tag) is a separate request.
- Every file, comment and doc is written in English.
- Keys: `^[a-z0-9-]{1,20}$`; entry ids `^[a-z0-9-]{1,20}$`; elements `^addon-[a-z0-9-]{1,30}$`; manifest paths (what an add-on writes, it never knows its key) `^(?!.*(\.\.|//))/addon/[A-Za-z0-9._/-]{1,100}$`, e.g. `/addon/main.js`; the site rewrites them to the public path `/addon/<key>/main.js` (`Entry.script`/`styles`, API answers, front guard `^(?!.*(\.\.|//))/addon/<key>/[A-Za-z0-9._/-]{1,100}$`); manifest `api_version: 2`; capabilities `tab` | `map-layer`; levels `read` | `action`.
- Entry ids are globally unique: with a duplicate, the key sorted later is rejected whole.
- Entries are disabled by default; the administrator (`first_account`) is implicit `action` once an entry is enabled and is never listed in access lists.
- `ADDON_URL` is an alias of `ADDONS=main=<url>`. Static folder root: `ADDONS_DIR`, default `/addons`. Manifest cache TTL: 30 s. Manifest fetch timeout 3 s, size cap 64 KiB.
- Site routes under `/api/v1/addons`; writes use the existing global `csrf_protect`; errors `{"detail": "<code>"}`; unknown entry or user: 404 `unknown_addon` / `unknown_user`.
- Next migration is `0018` (the latest is `0017_custom_markers`).
- Never invent user-facing numbers; UI strings in `frontend/public/i18n/{fr,en,de}.json`.

## Review Focus
1. Two keys declare the same entry id: the earlier key works, the later is rejected, nothing crashes (Task 2).
2. An add-on is down at site start and up later: it appears within the TTL without a restart; a malformed or oversized manifest is ignored (Task 2).
3. A hostile `ADDONS` value (spaces, `;`, a path, a bad scheme): the web container exits 1 instead of writing a config (Task 6).
4. The administrator disables an entry: `/me` answers 403 at once, so the add-on refuses even if the user's page is stale (Task 4).
5. SQLite reuses a deleted account's id: the new account must not inherit access (rows are deleted with the user) (Task 3).

---

### Task 1 (site backend): configuration and manifest parsing
**Files:** Create `backend/app/core/addons.py`, `backend/tests/test_addons_logic.py`; Modify `backend/app/core/config.py:26-27`, `backend/pyproject.toml` (move `httpx>=0.27` from the `dev` group to `dependencies`), then `cd backend && uv lock` and `make lock`.
**Interfaces — Produces:**
- `Settings.addons: str = ""`, `Settings.addons_dir: str = "/addons"` (env `ADDONS`, `ADDONS_DIR`).
- `configured_origins(settings: Settings) -> dict[str, str]`: key → origin from `addons` (`key=url,key=url`) plus `main` from `addon_url` when set. Raises `ValueError` on a bad key or an origin that is not `https?://[A-Za-z0-9.:_-]+` (no path, no trailing junk).
- `@dataclass(frozen=True) class Entry`: `key, id, version, name: dict[str,str], description: dict[str,str], element, capabilities: tuple[str,...], script, styles`.
- `parse_manifest(key: str, raw: object) -> list[Entry] | None`: `None` when anything is off (design rules: version 2, paths under `/addon/<key>/`, regexes, `name` and `description` with `fr` and `en` ≤ 40 / ≤ 200 chars, capabilities non-empty subset, ≤ 20 entries, no duplicate id inside the manifest).
- [ ] **Step 1: Write failing tests** in `test_addons_logic.py`: `test_origins_alias`, `test_origins_reject_path_and_bad_key` (`"a=http://x/y"`, `"A=http://x"`, `"a=ftp://x"`, `"a=http://x y"` raise), `test_parse_ok` (returns the entries with script `/addon/k/main.js`), and parametrised `test_parse_refuses` (wrong `api_version`, path with `..`, path under `/addon/other/`, element `script`, unknown capability, missing `fr`, 21 entries, duplicate id).
- [ ] **Step 2:** `cd backend && uv run pytest tests/test_addons_logic.py -q` → FAIL (module missing).
- [ ] **Step 3:** Implement the interfaces above (pure functions, no I/O).
- [ ] **Step 4:** Same command → PASS; `uv run ruff check . && uv run mypy app` clean.

### Task 2 (site backend): the registry
**Files:** Create `backend/app/core/addon_registry.py`, `backend/tests/test_addon_registry.py`; Modify `backend/app/main.py` (create one registry on `app.state`).
**Interfaces — Consumes:** Task 1. **Produces:**
- `class AddonRegistry(settings: Settings, client: httpx.Client | None = None, now: Callable[[], float] = time.monotonic)`
- `registry.entries() -> list[Entry]`: refreshes at most every 30 s (thread-safe, one lock), sorted by key then manifest order. Container keys: `GET {origin}/addon/api/manifest` (timeout 3 s, ≤ 64 KiB, JSON object, status 200). Static keys: every `{addons_dir}/<key>/addon.json` where the folder name matches the key regex. A key that fails stays absent until the next refresh; the previous good result of that key is dropped. Duplicate entry ids: reject the whole later key.
- `registry.entry(entry_id: str) -> Entry | None`.
- [ ] **Step 1: Failing tests** with `httpx.MockTransport` and `tmp_path`: `test_container_and_static_keys_merge`, `test_duplicate_id_rejects_later_key`, `test_down_then_up_appears_after_ttl` (fake clock: absent at t=0, present at t=31 without a new registry), `test_oversized_or_invalid_json_ignored`, `test_ttl_caches` (one HTTP call within 30 s).
- [ ] **Step 2:** `uv run pytest tests/test_addon_registry.py -q` → FAIL. **Step 3:** implement. **Step 4:** PASS + ruff + mypy.

### Task 3 (site backend): tables and migration 0018
**Files:** Modify `backend/app/db/models.py` (append); Create `backend/alembic/versions/0018_addons.py` (style of `0017_custom_markers.py`); Test `backend/tests/test_addon_models.py`.
**Interfaces — Produces:** `AddonEntryRow` (`addon_entries`: `entry_id String(20)` PK, `enabled Boolean default False`); `AddonAccess` (`addon_access`: `entry_id`, `user_id → users.id ON DELETE CASCADE`, `level String(6)`, PK `(entry_id, user_id)`, index on `user_id`).
- [ ] **Step 1: Failing test:** `test_access_rows_die_with_the_user` (grant, delete the user through the admin route or the session, row gone; a new account getting the reused id has no row — Review Focus 5) and `test_migration_0018_upgrades` (`alembic upgrade head` on a temporary SQLite file, tables exist).
- [ ] **Step 2:** `uv run pytest tests/test_addon_models.py -q` → FAIL. **Step 3:** models + migration (portable: no batch needed, new tables). **Step 4:** PASS; also `uv run alembic upgrade head` then `uv run alembic downgrade -1` on a scratch DB.

### Task 4 (site backend): routes
**Files:** Create `backend/app/api/v1/addons.py`, `backend/app/schemas/addons.py`, `backend/tests/test_addons_api.py`; Modify `backend/app/main.py` (add `addons` to the router tuple).
**Interfaces — Consumes:** Tasks 1-3, `CurrentUser`, `Admin` (`auth.py:243-249`: move `Admin` to `app/api/deps.py` and import it from both). **Produces** (all JSON):
- `GET /api/v1/addons` → `[{id, key, name{fr,en}, element, capabilities, script, styles, level}]` — enabled entries where the caller has a level (admin: `action`), registry order.
- `GET /api/v1/addons/admin` (Admin) → `[{id, key, name, description, capabilities, version, enabled}]` for every registry entry.
- `PUT /api/v1/addons/{entry}` (Admin) body `{enabled: bool}` → the admin row. Unknown entry → 404 `unknown_addon`.
- `GET /api/v1/addons/{entry}/access` (Admin) → `[{user_id, username, level|null}]` (admin account excluded).
- `PUT /api/v1/addons/{entry}/access/{user_id}` (Admin) body `{level: "read"|"action"|null}`; the admin's own id → 400 `administrator_is_implicit`; unknown user → 404 `unknown_user`.
- `GET /api/v1/addons/{entry}/me` (any logged-in user) → `{user_key: str(user.id), username, is_admin, level}`; entry unknown, disabled or caller without level → 403 `forbidden` (never 404, so an add-on cannot probe).
- [ ] **Step 1: Failing tests** (fixtures `user` = admin alice, `bob`; a fake registry set on `app.state.addons`): `test_list_hides_disabled_and_unauthorised`, `test_admin_enables_and_grants` (bob sees the entry at `read` after both calls, not before), `test_me_levels` (bob `read`, alice `action`, stranger 403), `test_disable_revokes_at_once` (Review Focus 4: after `PUT enabled=false`, bob's `/me` is 403), `test_access_admin_only` (bob gets 403 on every admin route), `test_admin_is_implicit`, `test_unknown_codes`, `test_csrf_required` (PUT with `csrf=False` → 403).
- [ ] **Step 2:** `uv run pytest tests/test_addons_api.py -q` → FAIL. **Step 3:** implement with the existing patterns (`DbSession`, pydantic `StrictModel`). **Step 4:** PASS; `uv run pytest -q` whole suite green.

### Task 5 (site backend): the `addon` flag
**Files:** Modify `backend/app/schemas/auth.py:59`, `backend/tests/test_auth.py:58-77`.
- [ ] **Step 1:** Change `test_me_carries_the_addon_fields_only_when_enabled` to also set `settings.addons = "pelican=http://a:8000"` (flag true) and to keep the `ADDON_URL` path (flag true), both false when empty. **Step 2:** run → FAIL. **Step 3:** `addon=bool(configured_origins(get_settings())) or has_static_dir`, where `has_static_dir` is `any(Path(addons_dir).glob("*/addon.json"))`. **Step 4:** `uv run pytest tests/test_auth.py -q` PASS.

### Task 6 (site deploy): nginx, compose, docs
**Files:** Rewrite `frontend/nginx/40-addon.sh`; Create `frontend/nginx/test-40-addon.sh`; Modify `frontend/nginx/default.conf.template:116-117` (keep the include), `deploy/docker-compose.yml:13,42`, `deploy/portainer/docker-compose.yml:13,46`, `deploy/README.md`, `deploy/portainer/README.md`, `Makefile` (`check-frontend` runs the test script).
**Interfaces:** the script reads `ADDONS`, `ADDON_URL` (alias → `main=`), `ADDONS_DIR` (default `/addons`) and writes `${ADDON_CONF:-/etc/nginx/conf.d/addon.inc}`. Per container key: `location ^~ /addon/<key>/` with `rewrite ^/addon/<key>/(.*)$ /addon/$1 break;`, the existing lazy-resolver `proxy_pass` block (security headers, `Cache-Control: no-store`). Per static folder (a directory in `ADDONS_DIR` containing `addon.json`, name matching the key regex): `location ^~ /addon/<key>/ { alias <dir>/; add_header Cache-Control "no-store" always; include security headers; }`. Invalid input → message on stderr, `exit 1`. Nothing configured → no file, exit 0. Compose: api and web get `ADDONS: ${ADDONS:-}`, `ADDONS_DIR`; both mount `${ADDONS_PATH:-./addons}:/addons:ro`.
- [ ] **Step 1: Failing test script** (`sh frontend/nginx/test-40-addon.sh`) with `ADDON_CONF` in a temp dir: `ADDONS=a=http://a:8000,b=http://b:9` writes two blocks each containing its rewrite; `ADDON_URL=http://x:1` alone writes `/addon/main/`; a static folder writes an `alias` block; each of `ADDONS='a=http://a b'`, `'A=http://a'`, `'a=http://a/p'`, `'a=ftp://a'`, `'a=http://a;x'` exits 1 and writes nothing; empty env exits 0 with no file.
- [ ] **Step 2:** run → FAIL. **Step 3:** rewrite the script (POSIX `sh`, no bashisms). **Step 4:** run → PASS.
- [ ] **Step 5:** Update compose files and both READMEs: the `ADDONS` / `ADDONS_DIR` / `ADDONS_PATH` variables, how to deploy a container add-on and a static folder, "enable it then grant access in Administration", the ship-together rule. Add the test script to `make check-frontend`.

### Task 7 (site front): logic and service
**Files:** Modify `frontend/src/app/core/addon.logic.ts`, `addon.service.ts`, `addon.logic.spec.ts`, `addon.service.spec.ts`.
**Interfaces — Produces:**
- `interface AddonEntry { id: string; key: string; name: LabelByLang; element: string; capabilities: string[]; script: string; styles: string; level: 'read' | 'action' }`; `export const ADDON_API_VERSION = 2` removed (the manifest is the backend's now).
- `parseEntries(raw: unknown): AddonEntry[] | null`: second guard with the same regexes as the Global Constraints; any bad field → `null`.
- `AddonService.load()` reads `GET /api/v1/addons` (failure → no entries, silent, as today); `ensureLoaded(key: string): Promise<void>` loads that key's script and stylesheet once, retry after failure; `baseOf(entry): string` → `/addon/<key>/`.
- [ ] **Step 1: Failing specs:** `parseEntries` accepts a good row and refuses (each → `null`): script outside `/addon/<key>/`, element `script`, level `none`, missing `fr`; `ensureLoaded('a')` twice adds one `<script>`; `ensureLoaded('a')` and `('b')` add two; failed load can be retried.
- [ ] **Step 2:** `cd frontend && npx ng test --watch=false --include='src/app/core/addon*.spec.ts'` → FAIL. **Step 3:** implement. **Step 4:** PASS.

### Task 8 (site front): host and top bar
**Files:** Modify `frontend/src/app/addon/addon-host.ts`, `addon-host.spec.ts`, `topbar/topbar.ts` (only if it reads removed fields).
- [ ] **Step 1: Failing spec:** the mounted element has `base="/addon/<key>/"`, `lang`, `active` (`'true'` only while its tab shows); two entries of two keys load two scripts; a failed key shows the retry message only for its own entry. **Step 2:** run the spec → FAIL. **Step 3:** `sync()` calls `ensureLoaded(entry.key)` and sets `base` from `baseOf`. **Step 4:** PASS.

### Task 9 (site front): access list and administration
**Files:** Modify `addon/addon-access.ts` + spec, `auth/admin-dialog.ts`, `admin-dialog.html:35-36`, i18n `fr/en/de.json` (`addon.*`).
**Interfaces:** `AddonAccess` input `addon` = entry id; reads `GET /api/v1/addons/{id}/access`, writes `PUT /api/v1/addons/{id}/access/{user_id}` (field `user_id`, not `user_key`); on a refusal the old level comes back. `AdminDialog` loads `GET /api/v1/addons/admin`, shows one tab per entry with: name, version, `description` in the current language, capabilities, an enable checkbox (`PUT /api/v1/addons/{id}`), and the access table only while enabled. New strings: `addon.enable`, `addon.capabilities`, `addon.capTab`, `addon.capMapLayer`, `addon.enableHint` ("informative: an add-on runs with your account's rights").
- [ ] **Step 1: Failing specs** for the access component (URL, body, revert on error) and for the dialog (disabled entry hides the table; toggling calls the PUT). **Step 2:** run the specs → FAIL. **Step 3:** implement. **Step 4:** PASS; `npm run lint` clean (design guard included).

### Task 10 (site front): e2e and example add-on
**Files:** Create `frontend/e2e/fixtures/addons/hello/{addon.json,main.js,styles.css}` (a tab with one `<p>` and a form; element `addon-hello`; capabilities `["tab"]`); Modify `frontend/e2e/map.spec.ts:2666-2690` (`fakeAddon` routes `**/api/v1/addons` and `**/addon/hello/*`; delete the `addon/manifest.json`, `elements.*` fixtures), `frontend/e2e/protected.spec.ts` or the stack spec chosen by `playwright.stack.config.ts`, `deploy/compose.e2e.yml` (mount `frontend/e2e/fixtures/addons` read-only on api and web).
- [ ] **Step 1:** Rewrite the existing add-on e2e tests: the tab appears after the administrator enables the entry and grants `bob` access; `#addon/hello` opens it; a second page without access shows no tab; the outage test (route aborted) shows no tab and no console error.
- [ ] **Step 2:** In the stack spec add: `GET /addon/hello/main.js` is 200 with a session and refused without (like the protected map files); `GET /api/v1/addons/admin` lists `hello` disabled.
- [ ] **Step 3:** `cd frontend && npx playwright test` (stop the dev API first) → PASS; `make e2e-stack` → PASS (wipes the compose DB, as documented).

### Task 11 (add-on repo): identity through `/me`, access code removed
**Files:** Modify `src/addon/identity.py`, `src/addon/api.py` (remove `site_users`, `list_access`, `set_access`, `level_of`, `known_addon`, `prune_missing` use; rewrite `me`, `manifest`, the `reader`/`actor` factories), `src/addon/store.py` (delete `grant`, `revoke`, `level_of`, `list_access`, `prune_missing`, keep the `access_v2` table and the audit), `src/addon/manifest.py`, `src/addon/config.py` (no new setting), `tests/test_identity.py`, `tests/test_api.py`, `tests/test_manifest.py`, `tests/test_store.py`.
**Interfaces — Produces:**
- `Identity(key: str, username: str, is_admin: bool, level: Level | None)`; `async who_am_i(cookie_header, client, settings, entry: str) -> Identity` calls `GET {site_url}/api/v1/addons/{entry}/me`: 401 → `Unauthenticated`; 403 → identity with `level=None`; other failures → `SiteUnavailable`.
- `manifest.py`: `MANIFEST` constant (`api_version: 2`, `script: "/addon/main.js"`, `styles: "/addon/styles.css"`, entries `server` and `chestsort` with `version`, `name`, `description`, `element`, `capabilities: ["tab"]`) and `build_manifest(settings, static_dir) -> dict` that drops `chestsort` when `chestsort_file` is unset and keeps the hashed-file lookup (`_find`). `GET /addon/api/manifest` needs no login.
- `reader("server")` / `actor("server")` / chestsort ones check `who.level` for their own entry (`read` ≥ read, `action` ≥ action) and call `who_am_i` with that entry; `GET /addon/api/me` asks the site once per entry and returns `{levels: {server, chestsort}, chestsort: bool, ...}` as today (403 → `null`).
- [ ] **Step 1: Failing tests:** identity maps 200/401/403/500 as above (httpx mock); reader refuses `level=None` and accepts `read`; actor refuses `read`; `GET /addon/api/manifest` works without cookie and omits `chestsort` when unset; `/addon/api/me` returns the two levels; the `/access` routes answer 404 (test deleted → assert 404). Rework existing `test_api` access tests accordingly.
- [ ] **Step 2:** `uv run pytest -q` → FAIL. **Step 3:** implement. **Step 4:** `uv run pytest -q` PASS; `make check` of that repo clean (ruff, mypy, bandit).

### Task 12 (add-on repo): front end `base`
**Files:** Modify `frontend/src/app/core/api.ts:3` (+ `api.spec.ts`), `frontend/src/elements.ts`, the two root components `server/server.ts` and `mods/mods.ts`.
**Interface:** `const API = '/addon/api'` becomes an injectable `ApiBase` with `base = signal('/addon/')` set from the element's `base` input (`input<string>('/addon/')`, forwarded by `createCustomElement`); every request goes to `base + 'api/...'`.
- [ ] **Step 1: Failing spec** in `api.spec.ts`: with base `/addon/main/` a GET goes to `/addon/main/api/status`; default base keeps `/addon/api/status`. **Step 2:** `cd frontend && npm test -- --watch=false` → FAIL. **Step 3:** implement; `npm run lint` clean. **Step 4:** PASS.

### Task 13 (add-on repo): contract and docs
**Files:** Modify `contract/manifest.schema.json` (v2 per the spec), `docs/RULES.md`, `README.md`, `docs/style-contract.md` (no change except `base`), `deploy/` examples (`ADDONS=main=...` not needed on its side; document the keys).
- [ ] **Step 1:** Rewrite the schema (`api_version` const 2, `entries`, `description`, `capabilities`, paths `/addon/<key>/` replaced by `^/addon/[A-Za-z0-9._/-]{1,100}$` since the add-on never knows its key) and add a pytest asserting `MANIFEST` validates against it (`jsonschema` is not installed: compare keys/regexes manually in the test). **Step 2:** Document: what is gone (access list), `/me`, the `base` attribute, ship-together rule. **Step 3:** `uv run pytest -q` PASS.

### Task 14 (site): documentation and full check
**Files:** Modify `docs/RULES.md` ("Optional server add-on" lines 69-75 rewritten: routes table at line 354 gains `/addons`, data tables gain `addon_entries`, `addon_access`), `CLAUDE.md` (migrations up to 0018, `ADDONS`), copy the v2 schema to `contract/manifest.schema.json`.
- [ ] **Step 1:** Rewrite the docs. **Step 2:** `make check` (stop the dev API first) → all green. **Step 3:** Hand the working tree to the user for local testing; report what was not run (`make e2e-stack` needs Docker; PostgreSQL run of the new migration).

---
Skipped on purpose: map layer API, JS package, Python helper, template, lint, SDK repository (phases 2 and 3); import of old access lists; any compatibility shim for add-on contract v1.
