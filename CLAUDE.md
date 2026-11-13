# Enshrouded interactive map

A private companion site for the game Enshrouded (map, workshop, lore, enemies, character planner, game settings, save import). Talk to the user in French.

## Where to read
- **`docs/RULES.md`: the detailed functional documentation and the project's memory**: every screen's rules, plus reference tables (mark ids, links, where each state is stored, API routes, limits, data files) and the known gaps. Read the section of the screen you touch before a change, and update it in the same change. This file only holds what RULES.md does not: how to run things, where the code is, and decisions.
- `docs/TODO.md` (open work), `docs/PLAN.md` (the original migration plan, in French, finished), `docs/DESIGN-save-import.md` (save file format), `docs/server-settings.md` (server file), `pipeline/README.md` (data formats, reference counts), `deploy/README.md`, `frontend/CLAUDE.md` (Angular and design rules).

## Run and check
- API: `cd backend && ENVIRONMENT=development uv run alembic upgrade head && uv run uvicorn app.main:app` (:8000, single worker: rate limit and passkey challenges are in memory).
- Front: `cd frontend && npx ng serve` (proxies /api; serves `artifacts/map` through the git-ignored symlink `frontend/map-artifacts`; it lists those files at start, so a new file needs a restart; it does not protect them).
- `make check` = backend (ruff, mypy, bandit, pip-audit, pytest) + frontend (npm audit, eslint, design guard, build, Vitest, Playwright) + gitleaks + Trivy. `make check-backend`, `make check-frontend` run one side. Playwright starts its own API on :8000 with an empty database: stop the dev API first.
- `make e2e-stack` (separate: wipes the compose DB; uses `deploy/compose.e2e.yml` to lift the login rate limit; also checks the map files are refused without a session, `PROTECTED_ASSETS=1`). `make stack | scan | lock`.
- e2e browsers: `npx playwright test` runs Chromium (everything). Firefox and WebKit run only tests tagged `@cross` (`E2E_BROWSER=firefox|webkit`, one browser per run since each run starts on an empty database and the first test creates the first account; `make e2e-browsers`, CI job `e2e (firefox|webkit)`). A new test that must run there needs the whole account chain before it, so tag it too. WebKit needs system libraries: CI only. Playwright runs on `http://localhost:4200` with a virtual authenticator for passkeys. AXE (WCAG A and AA) runs on every workshop tab. e2e in CI uses the fixture map `frontend/e2e/fixtures/map` (its `gear.json` has 8 slot items for the import test).
- Backend tests also pass on PostgreSQL (`DATABASE_URL=postgresql+psycopg://...`). Migrations 0013+ were run on SQLite only.

## Data and pipeline
- `artifacts/map/` is generated and must not go into git. `pipeline/` needs the game install, `emm.exe` and ~6.5 GB of raw data that only exist on the Windows PC (`D:\DEV\enshrouded_extract`, `unpacked/all` + `export`): it cannot run here. One run: `python build_data.py <unpacked/all> <export> <out>` writes every JSON (it calls `build_resources`, `build_craft`, `build_lore`, `build_enemies`, `build_places`, `build_skills`, `build_gear`, `build_gems`, `build_presets`); tiles come from `render_map.py`.
- After a run, copy the output to the server's artifacts folder (ask first, see memory); new front-end code also needs the new image.
- Never commit a real save file.

## Code map
- Backend `backend/app`: `api/v1/` (`auth`, `passkeys`, `characters` incl. the sheet, `progress`, `builds`, `fog`, `team`, `game_config`, `settings`, `health`), `db/models.py`, `db/queries.py` (`active_character`, `leave_team`), `schemas/` (`MarkId` in `progress.py`), `core/` (config, passkeys, logging), `cli.py` (`reset-password`). Alembic migrations up to 0015 (`character_sheets`).
- Frontend `frontend/src/app`: `core/` stores and pure logic (`session.service`, `view.store`, `progress.store`, `filter.store`, `team.store`, `character.store`, `planner.store` = the character sheet and builds, `found.service` = map and workshop in step, `craft.calc`, `craft.group`, `gear.logic`, `gems.logic`, `skills.logic`, `recommend.logic`, `lore-progress`, `game-settings.model|logic`, `sections.ts` = menu sections); screens `map/` (`map-view.ts`: `STACKED_CATS`, `LANDMARK_CATS`, fog layers), `sidebar/`, `topbar/`, `workshop/`, `lore/`, `enemies/`, `build/`, `equipment/`, `skills/`, `game/`, `save-import/` (`ksd.ts`, `knowledge.ts`, `character.ts`, `fog.ts`, `fog.store.ts`), `characters/`, `team/`, `auth/`, `progress-summary/`.
- Pure logic files are unit-tested (Vitest); keep new rules there.
- Shared look of every screen but the map: `workshop/workshop.css` (global, listed in `angular.json`, scoped by `app-workshop, app-lore, app-enemies, app-skills, app-build, app-equipment, app-game`; tab hosts are `display: contents`).

## enshrouded.exe findings (not in the data files)
- Damage % (melee/ranged/magic): one code at 0x140d1c990. Weapon number shown: 0x140e779a0. `applyDamage` structure: 0x1403dbdc0. Arrow added to a bow shot: 0x1403f0fb0. Ranged charge + fire times: 0x140476700. Weapon base damage: impact node GetWeaponBaseDamage.
- World settings are read from the world settings struct at +0x90 of the player context.
- The six Flame skill nodes add floor(Flame / 2) (`skills.json` `perFlame`).
- Parry: the screen's 26 for the Ornate Greatsword 0.7 at L16 needs `enemyStaminaFactor` 0.85-0.88; the default gives 30 (still an estimation).
- Gem values match in-game samples at L15 (Bleeding 14 /s for 7.1 s, Toxic Betrayal damage 8) but not Toxic Betrayal's 5.2 s; the curve was not found.

## Deployment and CI
- `deploy/` (compose, nginx template, security headers, `backup.sh`), `backend/Dockerfile`, `frontend/Dockerfile`: base images pinned by digest, hash-locked deps (`backend/requirements.lock`), read-only non-root containers. LAN only, behind the user's reverse proxy (it terminates TLS).
- GitHub `lokidata/enshrouded-map`. Workflows in `.github/workflows` (ci, codeql, trivy, gitleaks, dependency-review, zizmor, scorecard, publish-images -> GHCR for Portainer, see `deploy/portainer/`). Actions pinned by SHA (Dependabot updates them).

## Decisions taken with the user
- Stack: FastAPI + SQLAlchemy 2 + Alembic + Pydantic v2 (uv), Angular standalone + signals + Leaflet + Transloco, docker compose (nginx-unprivileged web + api), SQLite in a volume, code portable to PostgreSQL/MySQL via `DATABASE_URL`.
- Security best practices everywhere; run `/security-review` and `/code-review` on significant changes.
- Honesty rule for numbers (exact / estimation / "—"): see RULES.md; never invent a value.
- Visual identity "Codex of the Shroud" (tokens in `frontend/src/styles.css`, rules in `frontend/CLAUDE.md`, enforced by the lint). Performance rule learned the hard way: no `background-attachment: fixed`, no large blurred shadows, no 60 fps animation of big gradients (they made the e2e suite 4x slower); fonts are self-hosted and preloaded.
- Licence MIT (`LICENSE`): covers the original code only; the third-party skills in `.agents/` keep their own licences; the game's data and assets are not part of the repo.
