# Enshrouded interactive map

An interactive map for the game **Enshrouded**: markers (bosses, chests, shrines, dungeons, resources…), filters per element, French / English, and a personal progress tracker (mark what you have done, shown as ghost markers). Accounts are private: the first account is created at setup, then people join through single-use invitation links.

> Unofficial fan project, not affiliated with Keen Games. The game's data and assets are **not** part of this repository: the map data is generated offline from your own game install (see [`pipeline/`](pipeline)).

## Stack

| Part | Tech |
|---|---|
| `frontend/` | Angular 22 (standalone, signals), Leaflet, Transloco (FR/EN) |
| `backend/` | FastAPI, SQLAlchemy 2, Alembic, Pydantic v2 — SQLite by default, PostgreSQL-ready |
| `deploy/` | docker compose, nginx (strict CSP), Portainer stack |
| `pipeline/` | Offline extraction scripts that produce the map data (tiles, icons, JSON) |

## Run it

```sh
cp deploy/.env.example deploy/.env      # set COOKIE_SECURE=false for plain http
cd deploy && docker compose up -d --build
```

Put the generated map data in `artifacts/map/` (or set `ARTIFACTS_DIR`), open <http://127.0.0.1:8080> and create the first account with the setup code printed by `docker compose logs api` (or `SETUP_TOKEN`).

On a server with Portainer, use the images published to GHCR: see [`deploy/portainer/`](deploy/portainer/README.md).

## Develop

```sh
make check            # backend + frontend lint, types, tests, audits, gitleaks, Trivy
make e2e-stack        # Playwright against the compose stack (wipes its database)
```

Backend: `cd backend && uv sync && uv run pytest`. Frontend: `cd frontend && npm ci --ignore-scripts && npx ng serve` (the dev server proxies `/api` to `localhost:8000`). CI uses a tiny fixture map (`frontend/e2e/fixtures/map`), so no game data is needed to run the tests.

## Security

Argon2id passwords, server-side sessions, CSRF protection, rate limiting, invitation-only registration, hardened containers, signed images, CodeQL / Trivy / gitleaks / dependency review in CI. See [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

[MIT](LICENSE). Third-party skills under `.agents/` keep their own licenses.
