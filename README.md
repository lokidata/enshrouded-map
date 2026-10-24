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

## Rules

### Accounts and invitations
- There is **no public sign-up**. On an empty database the first visit creates the first account, and only with the setup code (`SETUP_TOKEN`, or the one printed once in the API log). The first account is the administrator.
- Any logged-in player can create an **invitation link** (profile menu > Invite). It is **single-use** and valid **20 minutes** (`INVITATION_MINUTES`); the token travels in the URL fragment (never logged) and is stored hashed. A link is only used up when the account is actually created.
- Without an account the page shows only the login dialog (no map, no way to dismiss it); the map files are refused by nginx without a session.
- Passwords: a player changes their own (current password required, their other sessions are closed). The administrator can generate a single-use, 20-minute **reset link** for another player; if the administrator themself is locked out, use `python -m app.cli reset-password USERNAME` in the api container. Optional **passkeys** (profile menu) sign in without a password; the password keeps working.
- A player can delete their own account (password required): their progress is erased. The first account cannot be deleted.

### Teams
- A player is in **at most one team**. Whoever creates it is its **owner**: only the owner renames or disbands it.
- **Any member** can add an existing player who has no team (immediately, no confirmation from them), create an **invitation link** that makes a new account directly inside the team (same rules as above: single-use, 20 minutes), or remove another member. Nobody can remove the owner or themself.
- Leaving is always possible. If the owner leaves, the longest-standing member becomes the owner; the last member to leave closes the team. Disbanding makes everybody leave. Each player keeps their own marks in every case.
- Marks stay personal. The team only shares **who marked what**: the popup of a POI lists the players who did, and the halo reflects the team (refreshed every minute and when the tab is shown again).

### Progress colours
Each POI has a halo that depends on who marked it:

| Halo | Meaning |
|---|---|
| none | nobody marked it |
| **violet** | **I** marked it, but not every member of my team did |
| **orange** | other members marked it and **I did not** |
| **green** | **every** member marked it |

Without a team, a POI I marked is green (I am the whole team). A POI I marked also appears as a faint ghost. Chests, plants and ores (dots) use the same colours for their outline.

Loot items (unique, cosmetic, collectible) lying within 3 m share **one icon**: green only when all of them are green, orange as soon as one of them is waiting on me, violet otherwise. Its popup lists the items with who marked each one, and has a **single button** that marks (or unmarks) all of them.

## Security

Argon2id passwords, server-side sessions, CSRF protection, rate limiting, invitation-only registration, hardened containers, signed images, CodeQL / Trivy / gitleaks / dependency review in CI. See [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

[MIT](LICENSE). Third-party skills under `.agents/` keep their own licenses.
