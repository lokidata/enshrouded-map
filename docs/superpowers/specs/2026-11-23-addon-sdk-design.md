# Add-on SDK for the community: design

Status: phase 1 is implemented on branch `feat/addon-sdk-phase1` and awaiting local testing (2026-11-23). Phases 2 and 3 are not built.

## Intent
Let a third party write an add-on without touching the `enshrouded-map-addon` repository, and let an administrator install it knowingly. Target examples:
1. A game-server mod reports who is connected and where; the add-on shows it on the map.
2. An add-on generates a mod's JSON configuration file (form + download, no backend).

Why: today `manifest.py` hardcodes `server` and `chestsort`, there is one `ADDON_URL` and one script, an add-on can only have a tab, and every add-on reimplements identity, CSRF and access lists.

## Goals / non-goals / anti-goals
- **Goals**: adding an add-on without a backend = dropping a folder; with a backend = one container following a short HTTP contract; zero access-control code for the author; an add-on can contribute to the map; the administrator sees what the add-on declares before enabling it.
- **Non-goals**: iframe isolation (possible later evolution); installing from the UI (containers are read-only, no Docker socket); *enforced* permissions (they are declarative); an online registry or marketplace; add-on signing.
- **Anti-goals**: a down or invalid add-on must never break the site or the other add-ons; the author must never handle a password or a cookie other than through the SDK.

## Constraints
- Trust model: an add-on's JS runs same-origin with the user's rights, CSP `script-src 'self'` unchanged. The administrator installs knowingly.
- Alembic migrations portable across SQLite/PostgreSQL (the next one is 0018); nginx is read-only, its block is written at start by `40-addon.sh`; UI text through Transloco; design guard and front-end lint; honesty rule for numbers (RULES.md).
- The site stays usable without any add-on (`/addon/` answering 502 = no entry, nothing in the console).

## Approaches
1. **One container per add-on under `/addon/<key>/` (chosen)**: secrets stay isolated, any language. Cost: N nginx prefixes, N manifests, contract v2.
2. Plugins inside the current container: rejected (third-party code in the same process as the Pelican key, Python only).
3. Contributions merged into a single repository: rejected (the maintainer becomes the bottleneck).

Access lists: **A chosen** (the site keeps them) over B (each add-on keeps its own). Reason: the author writes no access code; the site is already the identity authority. This reverses the earlier decision "each add-on keeps its own list".

## Chosen design

### Deployment
- `ADDONS=<key>=<url>,...` for containers (key `^[a-z0-9-]{1,20}$`). `ADDON_URL` stays as an alias of `ADDONS=main=<url>` (**my call**: paths move from `/addon/…` to `/addon/main/…`; the site and the current add-on ship together, as the existing deployment rule says).
- Add-ons without a backend: a folder `<key>/addon.json` + `main.js` + `styles.css` in a volume mounted read-only in the web container, served by nginx under `/addon/<key>/`, no container. The API container mounts the same volume read-only (`ADDONS_DIR`, default `/addons`) and reads each `addon.json` from it; container add-ons are read over HTTP at `<url>/addon/api/manifest`.
- nginx blocks are still written at start; an invalid URL stops the container (current behaviour).
- **Prefix handling (my call)**: nginx strips `/addon/<key>` and forwards `/addon/…` to the add-on, so an add-on never knows its key and keeps serving `/addon/…` (the current add-on's server paths stay as they are). Consequence: an add-on's front end must learn its public base path; the site sets a `base` attribute on the mounted element (`/addon/<key>/`) next to `lang` and `active`, and the SDK's API client uses it. The current add-on's `const API = '/addon/api'` (`frontend/src/app/core/api.ts`) becomes `base + 'api'`.

### Manifest v2
Static and public, one per key: `{api_version: 2, entries: [{id, version, name{fr,en}, description{fr,en}, element, script, styles, capabilities: ["tab"|"map-layer"]}]}`. `script` and `styles` are declared per entry, add-on-relative (`/addon/main.js`); the site rewrites them under `/addon/<key>/`. They keep the `PATH_RE` rules (no scheme, no `//`, no `..`); `id` and `element` keep their regexes (`addon-…`). Entry `id`s must be unique across all keys (a duplicate rejects the later key); `element` names are unique across keys too (same rule), so `#addon/<id>` links and history stay valid. An invalid manifest rejects **that key only** (before: everything). `capabilities` and `description` are **informative, not enforced**; the Administration dialog shows them before activation.

### Site side (backend, migration 0018)
- The backend reads the manifests at start and re-reads them periodically (interval up to the builder), validates them with the rules above, and keeps the result in memory. An unreachable key = no entries.
- Tables: `addon_entries(entry_id PK, enabled)` and `addon_access(entry_id, user_id → users ON DELETE CASCADE, level read|action)` (both keyed by entry id alone, which is globally unique; no `key` column, so an add-on never needs to know its key — refinement found while planning). An entry is **disabled by default** (the administrator enables it). The administrator is an implicit `action` once the entry is enabled. Access is identified by the account `id` (no more `id:created_at` pair).
- Routes (writes protected by the existing CSRF guard): `GET /api/v1/addons` (enabled entries the user may use, with their level and the script/styles paths); admin: `GET /api/v1/addons/admin`, `PUT /api/v1/addons/<entry>` (activation), `GET /api/v1/addons/<entry>/access`, `PUT /api/v1/addons/<entry>/access/<user_id>`.
- For a backend add-on: `GET /api/v1/addons/<entry>/me` (with the session cookie relayed, as today) returns `{user_key, username, is_admin, level}` (`user_key` = `<id>:<created_at ISO>`, stable across SQLite id reuse); the add-on writes nothing else for access. Cookie relay stays the identity method (a signed token from nginx is a possible evolution).

### Site side (front end)
`AddonService` reads `/api/v1/addons`; one script/stylesheet per entry (keyed by its `script`/`styles` paths, so entries sharing files load them once); `AddonHost` mounts one element per entry (current behaviour: `lang`, `active`, stays mounted); `AddonAccess` reads/writes the site API directly. The `parseManifest` rules stay as a second guard on what the backend returns.

### Map extension (phase 2)
A `map-layer` entry is loaded as soon as the map is shown, without a tab, and receives an API provided by the site (at least `addLayer(id, markers)`, `updateLayer`, `removeLayer`). Constraints: do not break `STACKED_CATS` / `LANDMARK_CATS` / the fog; frequent updates (player positions every few seconds) without rebuilding the layer; the layer is removed when the add-on is disabled. The exact API shape is left to the builder.

### The SDK (separate repository, single source of the contract)
Contents: JSON schemas of the v2 contract; a JS package (base class of the element with `lang`/`active`, API client with the `X-Addon` header, map API); a Python helper (identity through `/me`, CSRF guard); a template repository with a backend-less example; `addon-lint` (manifest + the `style-contract.md` rules: `[data-addon]` scope, no hex colour, no inline style); a "write your first add-on" guide and a list of known add-ons. The site and the current add-on consume the contract from this repository (today it is copied by hand).

### Migration of the current add-on
A migration, not a rewrite. It stays one repository and one container with two entries (`server`, `chestsort`, ids kept so links survive) sharing the Pelican key. It moves to v2 and becomes the SDK's advanced example (with a backend). Access lists **start empty** (**my call**, same precedent as 0.4.0: "grant access again"; no import script); the old `access_v2` table is left dormant, no destructive migration. Splitting `api.py` (generic dependencies vs business routes) is deferred to phase 3, when the Python helper is extracted. `contract/manifest.schema.json` moves to the SDK repository.

## Impact on existing code
**Site, backend**: migration 0018, `/api/v1/addons*` routes, server-side manifest fetch (new outbound call from the API to URLs that come only from the environment, so no user-driven SSRF; `httpx` is declared in `pyproject.toml`, runtime vs dev not checked). `/auth/me` keeps `addon` (true when any key is declared), `id` and `created_at` (now unused by add-ons). Single worker: the in-memory manifest cache is fine.
**Site, nginx and deploy**: `frontend/nginx/40-addon.sh` rewritten (N blocks, read-only static volume, prefix strip); `deploy/docker-compose.yml`, `deploy/portainer/docker-compose.yml` and both READMEs updated.
**Site, front end**: `addon.logic`, `addon.service`, `addon-host`, `addon-access`, `admin-dialog` (activation toggle, capabilities), `topbar`, i18n fr/en/de; `view.store` and history keep working because entry ids are globally unique; e2e `fakeAddon` routes and `fixtures/addon/manifest.json` move to v2; `docs/RULES.md` ("Optional server add-on") rewritten.
**Add-on repository**: removed: access routes (`/{addon}/access`), `site_users`, local `level_of`, per-user filtering in `build_manifest` (the manifest becomes static); changed: identity (`/me` returns the level), front `API` base path; kept: Pelican client, audit journal, throttle, chestsort, both Angular screens. Tests to rework: `test_api` (access part), `test_manifest`, `test_store` (access part), `test_identity`.
**Users after the upgrade**: no add-on until the administrator enables it and grants access again. A v2 site with a v1 add-on shows nothing (manifest refused), and the reverse fails too: **ship the site and the add-on together**, and say so in the release notes. No compatibility shim.

## Order of work (one plan each)
1. Several add-ons on the site side: `ADDONS`, manifest v2, migration 0018, routes, administration, migration of the current add-on; a backend-less example add-on doubles as the e2e fixture.
2. Map API + JS package.
3. Python helper, template, lint, documentation.

## Tests and docs
Vitest on pure logic; pytest on routes, the migration, an unreachable manifest; Playwright with the example add-on (tab, activation, access, outage); `docs/RULES.md` ("Optional server add-on" rewritten) and `deploy/README.md` updated in the same change.

## Left to the builder
Exact nginx rewrite rule for the prefix strip, manifest refresh interval, shape of the map API, template tooling.
