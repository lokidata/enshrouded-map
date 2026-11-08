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
- The administrator can delete **another** player's account (profile menu > Administration, "Delete a user's account", after a confirmation): the account, its progress and its sessions are erased and the player leaves their team (an owner hands the team over). The administrator cannot delete themself this way, and there is only one administrator.

### Teams
- A player is in **at most one team**. Whoever creates it is its **owner**: only the owner renames it, disbands it or **hands the ownership** to another member (who then becomes the owner; the former owner stays a member).
- **Any member** can add an existing player who has no team (immediately, no confirmation from them), create an **invitation link** that makes a new account directly inside the team (same rules as above: single-use, 20 minutes), or remove another member. Nobody can remove the owner or themself.
- Leaving is always possible. If the owner leaves, the longest-standing member becomes the owner; the last member to leave closes the team. Disbanding makes everybody leave. Each player keeps their own marks in every case.
- Marks stay personal. The team only shares **who marked what**: the popup of a POI lists the players who did, and the halo reflects the team (refreshed every minute and when the tab is shown again).

### Progress colours
Each POI has a halo that depends on who marked it:

| Halo | Meaning |
|---|---|
| none | nobody marked it |
| **blue** | **only I** marked it (a team of at least 2) |
| **violet** | **I** marked it **and some** of the others, but not all of them (needs a team of 3 or more) |
| **orange** | other members marked it and **I did not** |
| **green** | **every** member marked it |

A **legend** of these colours sits at the bottom right of the map (it only lists the colours the team size can produce); it can be folded, and the choice is remembered in the browser.

Without a team, a POI I marked is green (I am the whole team). A POI I marked also appears as a faint ghost, except the **landmarks** (starting point and fast-travel points): their icons are 40 % bigger than the others and are never greyed out, so you can always find your way (their halo still shows who marked them). Chests, plants and ores (dots) use the same colours for their outline.

Loot items (unique, cosmetic, collectible) lying within 3 m share **one icon**: green only when all of them are green, orange as soon as one of them is waiting on me, blue when I am the only one on everything that is marked, violet otherwise. Its popup lists the items with who marked each one, and has a **single button** that marks (or unmarks) all of them.

### Workshop

The fixed **top bar** holds the title, the **Map** and **Workshop** entries (the latter when the server has `craft.json`, see `pipeline/README.md`), the language and the profile menu. On the map, the left menu holds the map filters; in the Workshop, the left menu holds the filters of the open tab, which has six tabs: **Recipes** (search, filter by station, category and rarity, grid or table, how each one unlocks, a *show on the map* button when the game tells where to find it, and a *raw materials and steps* detail), **Items** (every item of the recipes, with the filters of enshrouded.tools: category, type, rarity, class and food type, sort by name or level; armour pieces are grouped into their set (one card per set, a button ungroups them); one item's page lists the recipes that make it and those that use it, and a set's page lists its pieces and how each one is unlocked), **Building** (the building pieces: filter by category, tier and rarity, sort by name or tier), **Stations** (what each crafting station makes), **Altar** (what each Flame Altar upgrade and Flame level costs, which recipes it opens, and a planner for the total cost between two levels) and the **Calculator** (crafting tree, an *I have* quantity per item that stops the breakdown, leftovers, number of crafts). Every item name in the Workshop opens the item's page. A marker that is an item (a cosmetic, a unique item, a collectible) and a recipe that item alone unlocks stay in step: marking the item on the map ticks the recipe as known, ticking the recipe marks the item (when it has one place on the map), unticking clears both; the item's page says how many of its places are marked, and an enemy shows how many of its places are done.

- Each player ticks the recipes they have **unlocked**; the ticks are saved with their progress (ids `recipe:<guid>`), are never shared with the team and are not counted with the map marks.
- The calculator adds up the ingredients of a **project** (kept in this browser only). It can break craftable ingredients down to raw materials; when several recipes make an item it takes one without a quest and with the fewest ingredients, and you can pick another (or keep the item raw). A cycle stays raw where it closes. For ingredients that several items can fill, the first item of the list is used unless you choose. The `scaling` of those categories is **not applied**: its meaning in the game data is not confirmed.
- The game does not say a workshop for every recipe or a precise unlock for every entry: those show as *Unknown station* or *Quest progress*.

## Security

Argon2id passwords, server-side sessions, CSRF protection, rate limiting, invitation-only registration, hardened containers, signed images, CodeQL / Trivy / gitleaks / dependency review in CI. See [SECURITY.md](SECURITY.md) to report a vulnerability.

## License

[MIT](LICENSE). Third-party skills under `.agents/` keep their own licenses.


### Lore

When the server has `lore.json` (see `pipeline/README.md`), the top bar has a **Lore** entry with the same look as the Workshop: **Notes** (the 320 lore notes of the game's journal, with their pages and paragraphs; filter by category and by *found* / *to find*, search in the texts; each player ticks the pages collected (or a whole note), remembered with the account like the known recipes; a card shows `2/4` when only some pages are) and **Quests** (the journal's quests: filter by who gives them, a character or a region, main or side, and done or to do; each player ticks the quests done; steps and rewards). The game gives no map position for a note, so there is no *show on the map* button here.


### Enemies

When the server has `enemies.json` (see `pipeline/README.md`), the top bar has an **Enemies** entry, same look as the Workshop: the **bosses** (the named boss fights) and the **elite** enemies (the generic heavy ones), filtered by kind, faction and region, with a picture of each boss (the game has no portrait: it is the picture of its head or trophy item, when it has one), and one enemy's page: faction, experience multiplier, extra health per player, regions, the named areas near where it stands ("Howling Peak"), its trophy item, a *show on the map* button (same ping as the Workshop's) and a *copy link* button (the address `#enemy=<id>` opens that page). The popup of a boss or an elite on the map shows the same picture. The game names no other enemy and gives no readable damage table or drop list, so the ordinary creatures, the damage taken and the drops are not here.


### Character (sheet, attributes, equipment, skills)

When the server has `gear.json` (see `pipeline/README.md`), the top bar's **Character** entry (*Personnage* in French; it replaces the former Skills one) opens a sheet modelled on the game's character screen: weapons, shield and rings on the left, the five armour pieces on the right with the physical and magic armour totals and the level; each slot shows the item's picture (rarity-coloured border) and, on hover or focus, a card with its level, armour, parry and the chain of upgrades (tap one to take it, Escape closes); clicking a slot opens the picker. The **All attributes…** button shows the Attributes screen under it: character level (1 to the game's cap, 50) and Flame level, the main characteristics and three tabs Bases / Damage / Protection. From it you open the **Equipment** screen (11 slots, a picker filtered by slot with search, rarity and weapon class, per-item armour, damage factors and stat lines) and the **skill tree** (below), each with a *Back to the character* button; the name / save / new / reset / link / saved builds panel is the same on all of them. A saved build keeps the skills, the levels and the gear. Without `gear.json` the entry opens the skill tree as before.

Each worn piece can have its upgrades recorded in the Equipment screen (a chain: upgrade n needs the n - 1 before it). The piece's armour is then counted at its level + n, plus each upgrade's own armour at its rank, and the upgrades' stat lines are added. Saved with the build (`upgrades`, indices of the item's upgrade list).

Rows of the Attributes screen use the game's own base values (`gear.json` `player`), the effects of the taken skill nodes (`skills.json` `effects`) and the worn items' stat lines, with the game's labels (`texts`) and rarity colours (`colors`); empty slots show the game's slot art and upgrades their icon and description (`ui`, served by nginx at `/ui/` with a session only). Exact: attributes, ranged damage, oxygen, critical damage / chance (and melee, magic, ranged), sneak, merciless, backstab, skill-shot, healing, revive time and heal, regeneration delays, wet reduction, damage against enemy families, per-weapon-class and per-kind damage, resistances (base 0 % + skill + item lines), armour per piece. Marked "estimation": health, mana, stamina, melee and magic damage, the regeneration values (food and the Rested buff are missing), Shroud time, parry (`round(parry x 0.15 x (23 + 15 L))`, fitted on one card). Still "—": frost resistance without an item line. Not applied: the armour multipliers of skills (Heavy / Shiny Plates), block, bow attack power. An older `gear.json` without these keys keeps the former behaviour (items' lines only).

What is computed, honestly: the six attributes (skills + `apPerFlameLevel` per Flame level above 1), ranged damage (0.05 x dexterity), oxygen and the armour of each worn piece (`round(share x (offset + gradient x level))`, at the piece's highest level, upgrades not counted) are checked against the game. Health, mana, stamina, melee and magic damage are marked *estimate*: the formulas from the game data do not reproduce the game's screen. Every other line (critical strikes, regeneration, healing, damage against enemy families, resistances, block, parry...) has no known base: it shows only the sum of the worn items' stat lines, or "—" when no worn piece has one. The six skills that add an attribute point per two Flame levels are counted as floor(Flame / 2) per level taken (marked *estimate*: the rounding is unverified). The Flame is clamped to 1..11, the level cap is 50; the screen also shows the XP to the next level and to reach the level (wiki table, checked: level 20 = 8562, levels 1 to 49 = 429094), the Flame's altar count and frost protection (from Flame 8), and the Shroud time at the default world setting (4 min + Flame, *estimate*: a world can change it). Health/mana/stamina and the damage bonuses use the wiki's confirmed formulas but stay *estimates*: the game shows more (gear and skill effects are not modelled).

### Skills (build planner)

When the server has `skills.json` (see `pipeline/README.md`), the top bar has a **Skills** entry: the game's skill tree (243 nodes laid out as the game draws them, 12 starting points, three class branches), with zoom, drag, a search and a class highlight; the 43 active skills show the game's own icon (the game gives none to the passives and attributes). Click a node to take a level, right click to remove one (or the *+ / −* buttons, or Enter and Delete from the keyboard); a node can be taken from a start point or from a node already taken next to it, and the last level of a node others hang from cannot be removed. Points are counted per level against a budget of 212 (the figure enshrouded.tools shows; the game derives it from the level). Each player **saves several builds** under a name (stored on the server with the account, up to 50), opens, renames by saving again, and deletes them; *Copy link* gives a link (`#build=...`) that opens the same build for anyone logged in. The values written in a description ("+10%") come from the game where it gives them; the others show "…".
