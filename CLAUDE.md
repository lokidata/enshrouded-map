# Enshrouded interactive map

Migration of a working prototype into a real app. The plan (approved, in French) is in `docs/PLAN.md`; follow it step by step.

## Current state
- `legacy/index.html` + `legacy/server.py`: the working prototype = behaviour reference (Leaflet map, card menu by sections, per-element sub-filters, FR/EN, accounts, "done" marking shown as ghost markers, filters saved per profile). Run it with `python3 legacy/server.py --host 127.0.0.1 --port 8765` after copying/linking `artifacts/map/*` next to it (it serves its own folder).
- `artifacts/map/`: generated map data (tiles/{z}/{x}_{y}.jpg, icons/, biomes.png, overview.jpg, markers.js = `window.MAP_DATA = {categories, markers, resources}`). Must not go into git.
- `pipeline/`: offline extraction scripts. They need the game install, `emm.exe` and ~6.5 GB of raw data that only exist on the Windows PC (D:\DEV\enshrouded_extract). They cannot run here; only edit them (e.g. step 1: make `build_data.py` write `map-data.json` + `resources.json` instead of `markers.js`) and convert the existing `markers.js` with a small one-off script so the counts stay identical: 1057 markers, 2702 chests, 6632 ores, 76742 plants.

## Progress
- Step 1 (repo base, `map-data.json` + `resources.json`) done.
- Step 2 (backend) done: `backend/`, `make check-backend`; tests also pass on PostgreSQL (`DATABASE_URL=postgresql+psycopg://...`). Run the API: `cd backend && ENVIRONMENT=development uv run alembic upgrade head && uv run uvicorn app.main:app`. Single uvicorn worker (in-memory rate limit). 
- Step 3 (front) done: `frontend/` (Angular 22, signals, Leaflet, Transloco FR/EN, signal forms), `make check-frontend` (lint, build, Vitest, Playwright e2e that starts the API itself). Dev: API on :8000, then `cd frontend && npx ng serve` (proxies /api; serves `artifacts/map` through the git-ignored symlink `frontend/map-artifacts`). `resources.json` is loaded in the background after the first render (the menu needs its counts), not on demand. Next: step 4 (Docker, nginx).

- Step 4 (Docker) done: `deploy/` (compose, nginx template, security headers, `backup.sh`, README), `backend/Dockerfile`, `frontend/Dockerfile`, `make stack | e2e-stack | scan | lock`. Pinned base images by digest, hash-locked deps (`backend/requirements.lock`), read-only non-root containers. - Step 5 (quality chain) done: `make check` = backend (ruff, mypy, bandit, pip-audit, pytest) + frontend (npm audit, eslint, build, Vitest, Playwright) + gitleaks + Trivy. `make e2e-stack` is separate (wipes the compose DB). The /security-review and /code-review skills cannot run here (they diff against origin/HEAD, there is no commit/remote): do them once the repo has a first commit and a base branch.

## Accounts (decided later)
- No public sign-up. On an empty database the first visit must create the first account (`POST /auth/setup`, refused once any account exists and unless the caller sends the setup token: `SETUP_TOKEN`, or a random one printed once in the API log at start; the dialog cannot be dismissed). After that only a logged-in user can create a single-use invitation (`POST /auth/invitations`, valid `INVITATION_MINUTES`=20), sent as `<site>/#invite=<token>` (fragment, so it is never logged). The token is stored hashed; accepting it creates the account atomically.

## Decisions taken with the user
- Stack: FastAPI + SQLAlchemy 2 + Alembic + Pydantic v2 (uv), Angular standalone + signals, docker compose (nginx-unprivileged web + api), SQLite in a volume, code portable to PostgreSQL/MySQL via `DATABASE_URL`.
- Exposure: LAN only, behind the user's own reverse proxy (it terminates TLS).
- Start from an empty database (no migration of prototype accounts).
- Apply security best practices (see plan step 2/4/5), run `/security-review` and `/code-review` at the end.
- Talk to the user in French.
