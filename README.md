# Enshrouded interactive map

An interactive companion for the game **Enshrouded**: the map (markers, resources, filters, personal and team progress), the Workshop (recipes, items, building, altar, crafting calculator), the Lore journal, the Enemies, a Character planner (skills, equipment, gems, upgrades, level recommendations) and a Game page for the server settings. French / English. Accounts are private: the first account is created at setup, then people join through single-use invitation links.

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

## Features

The top bar switches between the screens, in this order. The complete functional rules (progress colours, team sharing, formulas, what is exact and what is an estimation) are in [`docs/RULES.md`](docs/RULES.md).

- **Progress**: a summary by category (recipes, quests, lore, places, items, explored area) and a map filter limited to the explored area of an imported save.
- **Accounts and teams**: no public sign-up; the first account (the administrator) is created with a setup code, then single-use 20-minute invitation links (profile menu > Invite). Import of a local character save (recipes, quests, lore pages, discovered places, picked-up unique items and the explored area of the map, read in the browser), password change and reset links, optional passkeys, account deletion (own, or by the administrator). A player is in at most one team; marks stay personal, the team only shares *who marked what*. Without an account the page shows only the login dialog and nginx refuses the map files.
- **Map**: markers with filters per category, a personal progress tracker and a halo showing the team's progress (blue = only me, violet = me and some others, orange = others and not me, green = everyone) with a foldable legend. Landmarks stay visible; loot lying within 3 m shares one icon and popup. Every popup has a picture (the item's, else the category icon), and boss, elite and summon-stone popups show the mob's head. Resources (chests, ores, 50+ kinds of plants) load after the first render.
- **Workshop** (`craft.json`): six tabs, Recipes, Items, Building, Stations, Altar (cost planner) and Calculator (crafting tree with leftovers and an *I have* quantity). Ticking a recipe as known stays in step with the matching item on the map. Recipes, Items, Building and Stations can be filtered by discovered or not; building pieces with several recipes are one card with a choice of variants, and building items are listed only in Building. Recipes and items that exist at several levels are one card or tile with a variants badge, and their page switches between the levels. The calculator does not apply the `scaling` of ingredient categories (its meaning is not confirmed).
- **Lore** (`lore.json`): Notes (320 notes, per page) and Quests (186), each ticked per player.
- **Enemies** (`enemies.json`): the bosses and elites with faction, experience, extra health per player, regions and a *show on the map* button; `#enemy=<id>` opens one.
- **Character** (`gear.json`, `gems.json`, `skills.json`): a sheet modelled on the game's character screen (weapons, shield, rings, armour, upgrades, gems on weapons), the Attributes screen, the Equipment picker and the skill tree (budget 212), with saved builds (up to 50 per player) and a share link. Level and Flame are set here. Exact values (attributes, health, mana, stamina, oxygen, armour, weapon base damage, block, the **Rested** duration from comfort) are told apart from the *estimations* (parry, **frost** duration, gem effects, the hit of a weapon (no crits, target or armour)); unknown values show "—". **Recommendations** flag armour and weapons whose level is too low for the character, taking the Flame into account: at Flame F the expected level is the maximum of the tier opened before it (never above the character level).
- **Game** (always shown): the 38 dedicated-server settings with the Default / Relaxed / Hard / Survival presets and a Custom set, import and export of `enshrouded_server.json`. The configuration is saved on the server: yours without a team, the team's with one (only the team owner edits it, the other members see it read-only). The values also feed the Character (health, mana, stamina, oxygen, Shroud time, parry).

Optional screens appear only when the server has their data file (see [`pipeline/README.md`](pipeline/README.md)): without `craft.json` there is no Workshop, without `lore.json` no Lore, and so on; without `gear.json` the Character entry opens the skill tree.

## Security

Argon2id passwords, server-side sessions, CSRF protection, rate limiting, invitation-only registration, hardened containers, signed images, CodeQL / Trivy / gitleaks / dependency review in CI. See [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

[MIT](LICENSE). Third-party skills under `.agents/` keep their own licenses. The fonts (IM Fell English, IM Fell English SC, Alegreya Sans) are under the SIL Open Font License; their licenses are in `frontend/public/fonts-licenses/`.
