# Functional documentation

What the app does, screen by screen, and the rules it follows. This file is the reference ("memory") for any change: read the section of the screen you touch, and update it in the same change when a rule moves. Last full review: 2026-11-13.

Other documents: data formats in `pipeline/README.md` and in the docstrings of `pipeline/build_*.py`; deployment in `deploy/README.md`; save file format in `docs/ksd-format.md`; server file in `docs/server-settings.md`; open work in `docs/TODO.md`; architecture notes and decisions in `CLAUDE.md`.

Contents: 0. Overview and shared rules · 1. Access and accounts · 2. Character profiles · 3. Teams · 4. Map · 5. Workshop · 6. Lore · 7. Enemies · 8. Character · 9. Game settings · 10. Save import · 11. My progress · 12. Languages, layout, accessibility · 13. Reference tables (marks, links, storage, API, limits, data files) · 14. Known gaps

---

## 0. Overview and shared rules

### What it is
A private companion site for the game Enshrouded, for a small group of players on a LAN behind a reverse proxy: an interactive map where each player marks what they did (alone or with a team), a crafting workshop, the lore journal, the bosses, a character planner with the game's formulas, the dedicated-server settings, and the import of a save file.

### Screens (top bar)
| Entry (FR / EN) | View (`ViewStore`) | Shown when | Data file |
| --- | --- | --- | --- |
| Carte / Map | `map` | always | `map-data.json`, `resources.json` |
| Atelier / Workshop | `workshop` | `craft.json` exists | `craft.json` |
| Lore | `lore` | `lore.json` exists | `lore.json` |
| Ennemis / Enemies | `enemies` | `enemies.json` exists | `enemies.json` |
| Personnage / Character | `build`, `equipment`, `skills` | `gear.json` exists (else the entry opens `skills`) | `gear.json`, `gems.json`, `skills.json` |
| Partie / Game | `game` | always | `settings-presets.json` (optional) |
| One tab per add-on entry | `addon` (`addonId`) | the administrator enabled the entry and the player has access | none (see "Optional server add-on") |

The top bar holds the account menu (`AccountBar`): invite, team, my characters, my progress, import a save, Profile, administration (administrator only), logout. "Profile" opens the profile popup (`AuthService.profileOpen`). With several character profiles, a select in the top bar switches the profile followed.

The map stays mounted (hidden) when another screen is shown; the others load on demand (`@defer`). A server that lacks an optional data file simply has no such screen: never an error.

### Honesty rule (every computed number)
- **Exact**: read from the game data or `enshrouded.exe` and checked against the game.
- **Estimation**: shown with an "estimation" tag.
- **"—"**: unknown. A value is never invented.

### Who sees what
- Personal and private: recipe, lore and quest ticks, saved builds, the character sheet, the explored area (unless shared).
- Shared with the team: who marked which map element; the explored area only after an explicit tick; the team's game configuration (read-only for members).
- A team member is always seen through the character profile they follow.

### Data and time
- The game data is extracted offline on the Windows PC (the pipeline) into `artifacts/map/`, which is not in git and is copied to the server by hand. Counts in this file are those of the run of 2026-11-13.
- All data files load after login (`SessionService.enter`); `resources.json` loads in the background after the first render.
- Dev note: `ng serve` lists the files of `artifacts/map` when it starts; a file added later answers 404 until it is restarted.

---

## 1. Access and accounts

### First account and sign-up
- No public sign-up. On an empty database the first visit creates the first account (`POST /auth/setup`), only with the setup token (`SETUP_TOKEN`, or a random one printed once in the API log at start). The dialog cannot be dismissed. Refused as soon as any account exists.
- The first account is the **administrator** (`users.first_account`, `is_admin` in the API). There is only one, and it cannot be deleted.
- A logged-in player creates a single-use **invitation** (`POST /auth/invitations`, valid `INVITATION_MINUTES` = 20), sent as `<site>/#invite=<token>` (a fragment, so it is never logged). The token is stored hashed; accepting it creates the account atomically. An invitation created from a team (`POST /team/invitations`) makes the new account join that team.

### Session and protection of the files
- Without a session the page shows only the login dialog (no map, not dismissible).
- nginx serves the data files only with a valid session (`auth_request` -> `GET /auth/check`): `tiles`, `icons`, `biomes.png`, `overview.jpg`, `map-data.json`, `resources.json`, `craft.json`, `lore.json`, `enemies.json`, `enemies/`, `gear.json`, `gems.json`, `item-names.json`, `skills.json`, the per-language text files `<name>.<code>.json`, `skills/`, `ui/`, `settings-presets.json`. `ng serve` does not protect them. `/auth/check` reads only the session (no user), still sliding its expiry. nginx caches its 204 for 30 s per session cookie (`proxy_cache` in `/tmp/auth-cache`, a tmpfs; never a 401; API down = refusal unless that session is cached): after a logout or an expiry, map files stay readable for up to 30 s (the API itself refuses at once).
- Login is rate-limited per client address (10 per 5 minutes; setup and invitations 10 per hour) and an account locks progressively after 5 failed logins. The limit is in memory: a single API worker.

### Passwords
- A player changes their own password (`POST /auth/password`): the current one is required and the other sessions are revoked.
- The administrator generates a single-use reset link for another player (`#reset=<token>`, 20 minutes); a new link replaces the previous one for the same player.
- Administrator locked out: `python -m app.cli reset-password USERNAME` in the api container.
- Every password field has a show/hide button; creation and change have a confirmation field.

### Passkeys (WebAuthn)
- Optional: on only when `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN` are set (https, one host name); `/auth/me` returns `passkeys_enabled`.
- An alternative to the password: managed in Profile > Passkeys, "Use a passkey" on the login screen. Challenges are kept in memory (single worker).

### Optional server add-on
- Off by default. Add-ons come from `ADDONS=key=origin,key2=origin` (key `[a-z0-9-]{1,20}`, origin only; `ADDON_URL=<origin>` is an alias of `main=<origin>`, one trailing `/` tolerated there, not in `ADDONS` values), read by the api and web containers, plus static folders `<ADDONS_DIR>/<key>/addon.json` (`ADDONS_DIR`, default `/addons`, mounted read-only on both). A key that is both is the container. The web container writes one nginx block per key at start (`40-addon.sh`, same rules as `core/addons.py`): `/addon/<key>/...` is proxied to the container with the prefix stripped (the add-on serves `/addon/...` and never knows its key; the name is resolved lazily so the site starts with the add-on down and answers 502 until it is up; the prefix strip decodes `%2F`, so an add-on route must not rely on an encoded slash in a path parameter), or served from the folder behind the session check (`auth_request`). Invalid `ADDONS`, `ADDON_URL` or `ADDONS_DIR` = the web container stops. The auth answers always have the same shape: `GET /auth/me`, login, setup, invitation accept, password change/reset accept and passkey login send `id` and `created_at` when logged in (absent when logged out); `GET /auth/users` always has `created_at`. Nothing configured: no tab, no route, no nginx block.
- **Manifest v2** (`contract/manifest.schema.json`, copied from the add-on's repo): static and public, `GET /addon/api/manifest` for a container or `addon.json` for a folder: `{api_version: 2, entries: [{id, version, name{fr,en}, description{fr,en}, element, capabilities[], script, styles}]}`. `script`/`styles` are add-on-relative (`/addon/main.js`); the site rewrites them to `/addon/<key>/main.js`. `capabilities` (`tab`, `map-layer`) and `description` are informative: they are shown to the administrator, they grant nothing. The **registry** (`core/addon_registry.py`, `app.state.addons`) fetches each manifest with a 3 s timeout and a 64 KiB cap and keeps it 30 s. A bad key (unreachable, oversized, invalid, not v2) is dropped alone and the others stay. Entry ids are unique across keys: with a duplicate, the key sorted later is rejected whole; `element` names are unique across keys by the same rule. Parsing is `parse_manifest` (`core/addons.py`): `api_version` 2, at most 20 entries, `id` `^[a-z0-9-]{1,20}$`, `element` `^addon-[a-z0-9-]{1,30}$` (never `script` or `div`), paths `^(?!.*(\.\.|//))/addon/[A-Za-z0-9._/-]{1,100}$`.
- **Access** (tables `addon_entries`, `addon_access`, migration 0018): entries are **disabled by default**. The administrator enables each entry, then grants a player `read` or `action`. Once an entry is enabled the administrator (`first_account`) is implicitly `action` and never listed. A player's rows die with the account (`ON DELETE CASCADE`). Routes (`api/v1/addons.py`, writes need the CSRF header): `GET /addons` (what the caller may use: enabled entries with a level, with the public `script`/`styles`), `GET /addons/admin` (admin: every entry with `description`, `capabilities`, `version`, `enabled`), `PUT /addons/{id}` `{enabled}` (admin), `GET /addons/{id}/access` (admin: accounts but the administrator, `level` or null), `PUT /addons/{id}/access/{user_id}` `{level: read|action|null}` (admin, 204; 400 `administrator_is_implicit`, 404 `unknown_addon` / `unknown_user`), `GET /addons/{id}/me`. **Contract for add-on backends**: with the user's session cookie they call `GET /api/v1/addons/<id>/me`: 401 no session, 403 `forbidden` when the entry is unknown, disabled or the player has no access (all alike, so nothing can be probed), 200 `{user_key, username, is_admin, level}` with `user_key` = `<id>:<created_at ISO>` (stable across SQLite id reuse) and `level` always `read` or `action`. The `Admin` dependency lives in `api/deps.py`.
- **Screens**: the session reads `GET /api/v1/addons` (`AddonService`, `core/addon.service.ts`; `parseEntries` in `core/addon.logic.ts` refuses a whole answer whose `script`/`styles` do not match `^(?!.*(\.\.|//))/addon/<key>/[A-Za-z0-9._/-]{1,100}$` or whose `element` is off; any error means no entry and nothing in the console). One top-bar tab per entry (label `name.fr` in French, `name.en` otherwise), after "Game" (view `addon`, `addonId`; `NavState.addon` so Back/Forward restore it). `AddonHost` (`addon/addon-host.ts`) adds each key's stylesheet and `<script type="module">` once (a failure shows a message and a Retry button, shown per entry), then mounts `<div data-addon><addon-xxx lang active base>` per opened entry: `lang` is the site's language, `active` `"true"` while its tab is shown, `base` the add-on's public prefix `/addon/<key>/` (for its own API calls; it may be set after the element is connected, so add-on elements must tolerate that). The element stays mounted, hidden, on other screens, so an unsaved draft survives. `#addon/<id>` opens that tab; an unknown id stays on the map. The add-on's JavaScript runs with the page's rights (same origin under `/addon/`); the CSP stays `script-src 'self'`.
- **Administration dialog** (administrator only): a tab "Accounts" (reset links, deletion) and one tab per entry of `GET /addons/admin` (`AddonAccess`, `addon/addon-access.ts`): an enable checkbox, the entry's description and capabilities, then, once enabled, the access table (`none|read|action` per account). A refused change puts the old value back and shows a message.
- **Style**: `workshop.css` has one scope selector for add-ons, `[data-addon]` (plus `[data-addon][hidden]`), and the generic `.tiles`/`.tile` classes; the add-on's own CSS is scoped under that wrapper (`docs/style-contract.md` in the add-on repo). The example add-on is `frontend/e2e/fixtures/addons/hello` (a static folder).
- **Upgrade from 0.x with the old add-on (contract v1)**: add-ons are hidden until the administrator enables each entry and grants access again (the old lists are not imported); ship the site and the add-on together (the add-on must speak manifest v2); a v1 add-on shows nothing. `ADDON_URL` tolerates one trailing slash; an `ADDONS` value with a trailing slash is refused by the web container (fix it); `ADDONS` must have no spaces after the commas (the API accepts them, the web container does not).
- **Known gaps**: `nginx -t`, `docker compose config` and `make e2e-stack` (with `addon-stack.spec.ts`) were not run (no Docker where this was built); the 0018 migration ran on SQLite only; the map-layer API (`map-layer` capability) is not built (phase 2: it is declared and shown, nothing mounts it); no import of the old access lists; a concurrent first-time `PUT /addons/{id}` or access write can answer 500 (primary-key race); `addon-stack.spec.ts` relies on `map.spec.ts` having left the administrator password (the Makefile runs them in that order).

### Profile popup (account menu > Profile)
- One dialog, tabs along the top: **Account** (user name, read-only; language; change password), **Passkeys** (only when passkeys are available), **Customization** (menu layout `auto|left|top`, kept per device), **Danger zone** (delete my account). Each setting applies at once, except the password which has its own Save button; there is no global save button. The top bar has no language switch: the language is chosen when creating the account and then here.
- The first-account and invitation dialogs have a language select, saved with the account at its first login. The client sends `lang` only when this tab changed it (or the account has none), and `PUT /settings` keeps the stored `lang` when the body has none, so a stale tab cannot erase it. A test checks that the front and back lists agree, and another that the map data holds the same languages. The language list comes from `LANGUAGES` (`core/lang.ts`); the backend keeps the same list (`schemas/settings.py`, `PUT /settings` answers 422 for an unknown `lang`). The language is kept in the account settings (`lang` beside `filters`): at login the account's language wins, and an account without one takes the browser's saved choice (then saves it). The top bar switch stays and changes the same value.

### Deleting an account
- A player deletes their own account (profile > Danger zone, `POST /auth/delete-account`, password required): progress, builds, profiles and sessions are erased.
- The administrator deletes another account (profile > Administration, `DELETE /auth/users/{id}`): same cascade plus leaving the team (an owner hands it over). Never itself, never the first account. The Administration dialog also holds the reset links.

---

## 2. Character profiles

- A player has one or more profiles (profile menu > My characters). The first, "Principal", is made on demand; at most 10; names are unique per player (1-40 characters).
- **Each profile owns**: its progress marks, its saved builds (50), its character sheet, its explored area, its last import.
- **Shared by all profiles of a player**: the account, the map filters, the game configuration, the team membership.
- The profile **followed** (`active_characters`) is the one `/progress`, `/builds` and `/fog` work on, and the one the team sees. Switching (top bar select, or the dialog) reloads marks, builds, sheet, explored area and team halos.
- Creating a profile makes it the one followed. Deleting a profile deletes its marks, builds, sheet and explored area; the last one cannot be deleted; if it was followed, the oldest remaining one takes over.
- **Character sheet storage**: kept on the server per profile (`GET|PUT /characters/{id}/sheet`, table `character_sheets`, an opaque JSON of at most 256,000 bytes; another player's profile answers 404) and cached in the browser (`skillDraft:<id>`, `itemLevels:<id>`, `activeWeapon:<id>`). The server stamps each copy with its time of writing (`updated_at`); the browser keeps the stamp it last saw (`sheetStamp:<id>`) and whether it holds changes it did not send (`sheetDirty:<id>`). A write carries that stamp as `base` and is **refused with 409 when another device wrote since**; the browser then takes the server's copy (so a stale tab or device can never overwrite a newer sheet, and its own change is the one that is lost). When a profile is opened: no copy on the server = this browser's copy is sent (this is how sheets made before the server kept them migrate); changes made here on top of the copy the server still holds (same stamp) are sent; otherwise the server's copy wins. A change is sent 0.8 s after the last one, at once when the page is left (`keepalive`), when another profile is opened and at logout; a failed send is silent and the changes stay marked as unsent for the next visit.

---

## 3. Teams

- The team popup has the same tabs look as Profile: **Team** (name: create or rename), **Members** (list, add, invitation link, hand over) and **Danger zone** (leave, disband); the last two only once there is a team.
- At most one team per player. The creator is the **owner**: only the owner renames, disbands or hands the team over (`POST /team/owner`; the former owner stays a member).
- Any member: adds an existing player who has no team (immediate, `POST /team/members`), removes another member (not the owner, not themself), creates an invitation link whose new account joins the team.
- Leaving is always possible. If the owner leaves, the longest-standing member becomes owner; the last one to leave closes the team. Marks stay personal in every case.
- The team shares only **who marked what on the map** (the popup lists the players). The others' marks are refetched every 60 s and when the tab comes back, with `If-None-Match`: `GET /team/marks` sends an ETag (hash of who follows which profile, the count and the newest `created_at` of the shared marks) and answers 304 while nothing changed (an added or removed mark, or a changed profile, changes it); the front keeps what it shows on a 304 and asks in full when the server sends no ETag. Recipe, lore and quest ticks are never shared.
- The game configuration of a team belongs to its owner (section 9). The explored areas and the custom markers are shared only on request (section 4): both switch off when a player leaves a team, is removed, sees the team dissolved or is added by someone else (`unshare_all`).

---

## 4. Map

### Layout
- Left menu: filters per category with counts (done / total), grouped in sections; the Loot section holds unique items, cosmetics, colour palettes, hairstyles, hair and eye colours, collectibles and chests. It can be hidden and placed left, on top, or automatically (portrait = top), remembered per device.
- The filters chosen are saved per player on the server (`/settings`); a new player keeps the defaults.
- No biome layer (removed on request; `biomes.png` is still produced and `map-data.json` still lists the biomes). The layers control (top right) lists the explored-area layers and the custom-marker layers.
- Look: mist vignette, popups as plates (see the design rules in `frontend/CLAUDE.md`).

### Categories (counts of 2026-11-13)
- Icon markers: point of interest 110, cosmetic 110, collectible 107, enemy camp 92, elite 84, unique item 79, elixir well 76, landmark 67, flame shrine 63, cave 55, summoning stone 45, camp 44, farm 37, dungeon 37, night temple 30, boss 28, dungeon entrance 27, place name 25, **colour palette 23**, gem forge 21, mine 21, shroud root 15, obelisk 14, fast travel 10, balefire 9, **eye colour 11**, big dungeon 6, **hairstyle 5**, **hair colour 4**, hidden grave 4, start 1, plus region names.
- Dots (`resources.json`): chests 2575 (12 kinds), ores 6632 (17 kinds), plants 124,417 points (52 kinds).
- Hidden until ticked: chest, plant, ore, unique, cosmetic, palette, hairstyle, haircolor, eyecolor, collectible.
- **Plants**: a whitelist (`PLANT_ITEMS` in `pipeline/build_resources.py`) decides which plants appear.

### Loot markers
- A loot marker is one item at one place (it carries `item`, a key of `map-data.json` `items`, with its picture). Sources: the scene's guaranteed loot with a single container, the items placed in the scene, and pickups lying in the world.
- **unique**: weapons, equipment, tools, instruments, fishing rods, gems, ammunition. **cosmetic**: the same whose developer name starts with `Vanity_` (violet). **collectible**: the Collections items. **palette**: the 23 colour palettes that lie in the world (20 pickups + 3 in guaranteed loot); the other palettes are crafted at the Coloring Station or are quest rewards, and the 4 palette lore texts are lore pages, not palettes. **hairstyle**: the 5 Barber wig heads that unlock haircuts once picked up (braid, cowlick, slick fade, afro, hanfu ponytail); the sixth, "Barber's Favorite", has no place in the world.
- **haircolor**, **eyecolor**: the places the game's own journal hints ("Player customisation": 22 hair colours, 15 eye colours) send the player to: the tale to read or the quest's search area. The game unlocks 15 hair colours and 10 eye colours (the others are there from the start). On the map: 9 of the 10 eye colours (purple, bright blue, orange, yellow, white, red, turquoise, black, pink; yellow and white also have their first hint note) and 4 places for 5 hair colours (red x2 at Fort Kelvin, blue x2: the dungeon and the dark berry field, green: the night plants). The two plant fields are matched to their hint by its text (the hint's marker id was not resolved): their name says "deduced place". The table is hand-written in `build_resources.APPEARANCE_PLACES` and the run fails if a place gives no marker. Five of them share the template of another marker (a farm, a camp, three points of interest): the colour marker is placed 6 m east of it. A colour marker never carries knowledge ids, so a save import does not tick it.
- Not on the map because their hints name no place: 10 hair colours (an item to bring to the Barber: spiced tea, ice, flowers, sparkling dust..., or the Collector's ectoplasm for one green), the dark red eyes (a Bloodlust gem for the Alchemist's apprentice), the hairstyles themselves.
- Items sharing a container are moved apart by 1 m so that each keeps its own mark id.
- **Loot stacks**: loot markers within 3 m share one icon and one popup listing each item with who marked it, and a single button that marks or unmarks all. Stack icon: green when all are green, orange as soon as one waits on me, blue when I am alone on all that are marked, violet otherwise.
- Other guaranteed items of a container (materials, blocks...) are listed in the popup of what stands there (the loot marker, the chest or the enemy).

### Marking
- A player marks an element as done; the mark id is `category:x:z` (rounded metres). Marking shows at once and is sent in order (`PUT /progress`, idempotent: a concurrent identical request is retried once; a persistent conflict answers 409). A refused change is put back and an error shows.
- A marked element shows as a faint ghost, except **landmarks** (`start`, `fastTravel`): icon 1.4x bigger, above the others, never faded; their halo still applies.
- **Halo** by who marked: none = nobody; blue = only me (team of 2+); violet = me and some, not all, of the others (3+ members); orange = others did, I did not; green = every member (no team or a team of one: green when I marked it). Dots use the same colours for their outline. A foldable legend lists only the colours the team size can produce.
- **Hide what I marked** (side menu checkbox, off by default, kept in the browser): hides the markers and the chest, plant and ore dots that **I** marked (a teammate's mark hides nothing), except the fast travel points (`fastTravel: true`), which always stay. A loot stack keeps showing its unmarked items; an element marked while the option is on disappears at once (untick the option to unmark it).
- The profile counter counts map marks only (recipes, lore pages and quests are left out).

### Popups
- Every popup has a picture: the item's or the enemy's, else the category icon. Boss, elite and summoning-stone popups show the head of the creature (by mark id, else by name; up to 3, smaller from 2). Fixed content height, except popups flagged tall.

### Explored area
- Comes from a save import (section 10): a grid of 1280 x 1280 cells of 8 m, north up. It is drawn as a dark veil over what is not explored.
- **Kept by the server for the profile** (table `fogs`, one bit per cell, readable by its owner only): it survives a logout and comes back on another browser. The browser caches it with the server's stamp and takes the server copy when the stamp differs. An area imported before the server kept them is sent on the next load.
- **Sharing with the team** is opt-in, off by default, switchable at any time, and **never follows a player to another team**: leaving a team, being removed, a team that is dissolved or being added to a team by someone else all switch it off (every profile of the player), and a player must tick it again for each team: from the import dialog ("Share this area with my team", shown only in a team), from "My progress", or from the map's side menu. `PUT /fog` stores the area of the profile followed (`bits` + `shared`, replaces the last), `PATCH` switches `shared`, `DELETE` removes it. Nothing else is stored: no position, no discovered places. Never share without the explicit tick.
- **Layers**: each area is its own layer in the layers control: "My explored area" and one "Explored area of <name>" per member who shares (`GET /team/fog` lists them with a stamp, `GET /team/fog/{user id}` gives one; only new or changed ones are fetched). Ticking is the player's choice, kept in the browser; new members start shown. The map draws **one veil** over everything outside the union of the ticked layers; nothing ticked, no veil. Leaving the team, deleting the profile or unsharing removes the layer for the others.
- **Only the explored area** (side menu checkbox, enabled once an area exists): hides the markers whose cell is not explored, by the same union. Names of places and regions stay; chest, plant and ore dots are not filtered.

### Custom markers
- A player places their own markers on the map: a **simple marker** (pin) or a **Flame Altar** (level 1-4) with a name (1-40 characters) and a plain-text note (up to 500). Button "Add a marker" at the top left of the map: a mouse click turns placing on (crosshair; Esc or a second click cancels) and the next click on the map opens the form there; from the keyboard the button opens it at the centre of the view. The form (name, note, type, level, "Share with my team" only in a team, save, delete, cancel) opens on the name; a click on a marker of mine opens it again to edit or delete. **Move**: the popup of one of my markers has a "Move" button; the next click on the map is its new point (name, note, type, level, icon, colour and sharing stay; an altar's square follows). Same mode as adding, said in a plate at the top of the map (`role=status`: "Click the map to move <name>"); Escape cancels either; from the keyboard the button moves it to the centre of the view at once. A refused move says so in the same plate and the marker stays where it was. It is `PATCH /markers/{id}` with the new `x` and `z` (ownership and ranges checked as for any change). A simple marker wears an **icon of the game's map** chosen in the form (the 10 pictures of the game's own "create a custom marker" dialog, in its order: flag, chest, creature, bag, feather, beast, drop, fish, crystal, sword; default flag; the pipeline writes them as `icons/custom_marker_<n>.png`, names in `core/markers.logic.ts`; stored as that key in `icon`, an unknown key shows the flag). An altar always wears the Flame Altar icon and a **fixed orange**, the ochre of the game's palette (`--marker-altar`) for its disc and its square: `icon` and `color` stay null (422 otherwise) and the form hides both pickers, leaving the level. A simple marker has one of the game's **8 colours** (white, green, pink, lavender, ochre, purple, teal, grey; default white; tokens `--marker-*`, read approximately from a screenshot of the game's dialog; stored by name in `color`, 16 lowercase letters): the disc behind its icon wears it. Form: name, note, type, then the level (altar) or the colour and the icon (simple marker), then share; the colours and the icons are each on one line.
- **Altar zone**: an altar draws a **square centred on its point, 40 m per level** (level 1 = 40 m, 2 = 80, 3 = 120, 4 = 160; sizes given by the user, checked against one real world save, not extracted from the game; the square is drawn flat, the map is 2D). Pure rule in `core/markers.logic.ts`.
- **Not map elements**: not counted in the progress, not under the category filters, not in the table `marks`, not in the explored-area filter. Stored in `custom_markers` per character profile (integer metres like the mark ids, 0-10,240), 100 per profile (409 `too_many_markers` beyond).
- **Private by default.** `shared` is per marker, set with the form; a marker is visible to teammates only while `shared` is true **and** its owner is in the team, through the profile the owner follows now. Sharing without a team is refused (409 `no_team`). Leaving a team, being removed, a dissolved team or being added by someone else switch `shared` off for every marker of every profile of the player (`unshare_all`, shared with the explored area); the player ticks it again for each team. Never share without the explicit tick.
- **Layers**: "My markers" and one "Markers of <name>" per teammate who shares (read-only popup with the owner's name, the note and, for an altar, its area; each marker keeps its own colour; the owner is told by the layer and the popup). The ticked layers are kept per browser (`markerView`, the list of **unticked** layer keys `me` / `u<user id>`: a new member starts shown; anything unreadable counts as everything shown; wiped at logout; storage errors are ignored). Ticking does not redraw the layers. `GET /team/markers` has an ETag (hash of the answer) and answers 304 while nothing changed; the others' markers are refetched with the team (every 60 s, when the tab comes back, when the profile or the team changes).
- **List in the left menu**: a foldable block "My markers" above the categories, with the count out of the limit (`n / 100`), a search box (name and note, accents and case ignored), my markers sorted by name, then one block "Shared by <name>" per teammate (read-only, only the ones that match). A click centres the map on the marker (zoom -2 at least), shows its layer again if it was unticked and opens its popup. Empty state: a hint on how to add one. The list is a separate view of the same stores: searching does not touch the map layers. Pure rules in `core/markers.list.ts`.
- **What is in an altar's zone**: the popup of an altar (mine and teammates') lists the map elements of `map-data.json` inside its square (`|dx|` and `|dz|` <= side / 2, the border included), per category with the category icon and name in the current language, most first (ties by key), the first 8 and "+ n in other categories", and the total. Label categories (regions, place names) are left out; chests, plants and ores (dots, `resources.json`) are not counted. Computed when the popup opens (and again when the level or type changes in my form), not while drawing. Pure rule in `core/markers.zone.ts`. "Show on the map" was not done.
- **Ruler** ("Measure" button under "Add a marker"): click two points, a dashed line with a label "<d> m · ΔX <dx> · ΔZ <dz>" (straight line on x and z, whole metres, height not used); a further click starts a new measure. Escape or the button ends it and removes the line; nothing is kept or sent. From the keyboard the button places a point at the centre of the view (twice for a measure). **One map mode at a time** (adding, moving, measuring): turning one on turns the others off; the active one is shown on its button (`aria-pressed`) and in the plate at the top of the map. Pure rule in `core/measure.ts`.
- **Popup layout** (form, teammate's popup, zone list): 340 px wide and never wider than the screen minus 56 px; it never scrolls sideways (the colour and icon rows are one line each and shrink to fit); it scrolls vertically only when the map is too short, the buttons staying in view (sticky). The map is panned (past its usual bounds while the popup is open) so that the whole popup is inside it. On a screen under 700 px the map's buttons, legend and coordinates are hidden while a marker popup is open. The e2e checks that the form is no wider than the popup content.
- Names and notes are plain text: stored as typed, shown with text bindings only (the form, the popup, the tooltip), and escaped in the layer labels, which Leaflet writes as HTML.

---

## 5. Workshop (`craft.json`)

Data of 2026-11-13: 1198 recipes, 1324 building pieces, 14 altar levels, 2774 items, 79 armour sets.

### Tabs
Recipes, Items, Building, Stations, Altar (with a cost planner between two levels), Calculator. The Altar tab's upgrades of the Flame Altar (craft.json `altar` entries of kind `altar`: Claim, then Level 2, 3, 4) show their **build area** (40 / 80 / 120 / 160 m, `core/markers.logic.ts` `altarAreaOfEntry`: the altar level reached = entry level + 1, checked against the names of the real data in 3 languages); the Flame levels (kind `flame`) show none, the area does not depend on them. Every item chip is a button that opens the item's page. Recipe and building lists have a grid or a table view.

### Filters
- From the fields `cat` / `type` / `food` / `rarity` / `cls` / `lvl` written per item by `build_craft.py` (same categories and types as enshrouded.tools; `type` and `food` come from developer names, so they are heuristics). No "New in 1.0" filter: the game data has no such field.
- **Discovery filter** on Recipes, Items, Building and Stations: All / Discovered / Not discovered (three buttons under the search field; on Stations it filters the recipes of the open station and the counts of the list). A recipe or piece is discovered when it is known (below); an item when one of its places on the map is marked or a recipe that makes it is known; a set when any of its pieces is.

### Grouping into cards
- **Recipes**: the recipes of the levels of one item (same name, category and type) and its other benches are one card with a stacked look, a "N variants" badge and a choice inside, each variant named by the level of what it makes (or by bench and number of materials when levels do not tell them apart). A known variant has a green outline and a tick. The table view lists every recipe.
- **Building pieces** with the same name, group, tier and product are one card with a choice between variants named by bench and number of materials.
- **Item tiles**: items with the same name, category and type (levels and rarities of one weapon) are one tile with a stacked look, the badge and the range of levels; the item page opens on the lowest level and offers a button per variant. A tile has the green frame when any variant is discovered.
- The Items tab lists no building item (1325; the Building tab owns them); their page still opens from a chip.
- Category counts and result counts count cards, not recipes.

### Known recipes
- A player ticks the recipes they know: mark `recipe:<guid>`. Personal, not shared, not in the profile counter.
- **Map and workshop in step** (`Found`): a recipe whose unlock is a single item that exists on the map is *known* when `recipe:<id>` is marked OR that item's marker is. Ticking the recipe also marks the item's marker when the item has one place; unticking clears the recipe and every marker of the item. The 6 recipes with 7 unlock items are left alone. The item page shows its marked places; enemy pages and cards count their marked places.
- How a recipe unlocks is read from the game's knowledge queries (level, NPC, item found, quest, Flame, none); missing data shows as "Unknown station" or "Quest progress".
- *Show on the map* switches on the filters of the places and frames them.

### Calculator
- Pure logic (`core/craft.calc.ts`): demand per item, then whole crafts with leftovers.
- Default recipe = no quest, fewest ingredients, changeable; cycles stay raw where they close; an ingredient category takes its first item unless chosen; "I have" quantities stop the breakdown; a tree shows the breakdown.
- The category `scaling` is deliberately not applied. The project is kept in the browser.

---

## 6. Lore (`lore.json`)

- Two tabs: Notes (320 notes, 564 pages, 13 categories) and Quests (186, with 129 reward items).
- Marks: a collected page is `lore:<note id>:<page>`; a whole note `lore:<note id>` (the first version's mark: it counts as all its pages, and unticking one page splits it); a finished quest `quest:<quest id>`. Personal, not shared, not in the profile counter.
- Notes have no map position: the journal gives none.

---

## 7. Enemies (`enemies.json`)

- Only the bosses and the elites that the game names (20 bosses and 5 elites in the file of 2026-11-13, 22 of them placed on the map). The game gives no name to the other enemy templates; damage taken and drops are not readable in the data.
- Page: faction, experience multiplier, extra health per player, regions, nearby named areas (within 600 m), trophy item, *show on the map*, *copy link* (`#enemy=<id>`). The picture is the enemy's head or trophy item (the game data has no portrait).
- Cards and pages count the enemy's places that are marked. The map popup of a boss shows the same picture.

---

## 8. Character (`gear.json`, `gems.json`, `skills.json`)

### Sheet (view `build`)
- Slots: ranged, shield, weapons 1-3 (the third optional), 2 rings on the left; 5 armour pieces on the right with the headline totals (physical and magical armour only; the other kinds are Protection rows). No backpack or tool slot, no 3D model, no status details; the level bar is level / cap.
- A slot click opens the Equipment picker on it (view `equipment`: any item for the slot, search, rarity, weapon class). Each equipped slot has a hover/focus card: level, armour, parry, the upgrade chain, the gem.
- "All attributes…" opens the copy of the game's Attributes screen: level (capped at the game's cap), Flame, main stats, tabs Bases / Damage / Protection.
- The weapon in hand (one of the weapon slots or ranged) decides which weapon the Protection tab and the totals use.
- What the sheet holds: level, Flame, comfort, gear per slot, arrow, upgrades per slot, gems per weapon slot, skill levels, base level per slot, weapon in hand. Storage: section 2.

### Upgrades
- A chain: upgrade n needs the n-1 before it. The piece's armour counts at level + n plus each upgrade's share at its rank. At most 8 per slot; reset when the slot's item changes.

### Gems
- Each weapon slot (weapons 1-3, ranged) holds one gem at a chosen level (any gem: the data has no per-weapon restriction; a weapon without a gem slot gets a note but still takes one; the level is clamped to the gem's range). Dropped when the slot's item changes.
- Shown as a badge, a block in the slot's popup (the gem's name and level, its description, then each effect with its value at the chosen level, tagged "estimation" when it scales with the level) and rows under the weapon in the Damage tab; the Equipment picker shows the same description with the level field. A value that the text carries is not listed again: only the lines the text does not use (and every line of a gems.json without `fill`) stay as rows. The description has the values of the chosen level written where the game puts its %k, in the gold colour (dotted underline = estimation, from `gems.json` `fill`, a hand-written mapping per gem because the game's own is code and not in the order of the data's lines); a value the data does not give (a count of projectiles, a radius, a share of the base damage: Aerobatics, Destiny, Corruption) stays "…" with a tooltip, and a gems.json without `fill` shows "…" everywhere. Two times the data lists without a label are appended as lines: Storm's Eye mark duration 5 s and cooldown 1 s (cooldown 1 s confirmed by the user), Corruption explosion delay 3 s. **Never added to totals** (every gem effect is a trigger). The value scales on the gem's own level: an estimation.

### Skills (view `skills`)
- 243 nodes, 312 links, 12 roots. A node is reachable from a root or a taken neighbour; the last level of a node that others hang from cannot be removed. Click +1, right click -1, Enter / Delete, plus +/- buttons in the detail panel.
- Points = cost x level against a budget of 212 (taken from enshrouded.tools, not from the game). The six Flame nodes add floor(Flame / 2) attribute points once taken (exact).
- 91 of the 163 descriptions with a value show it; the others show "…".
- **Saved builds** (skills page only): name (1-60) + skill nodes, 50 per profile, private, reachable (open, replace, delete) only while that profile is the one followed; opened, replaced by saving under the same name, deleted. The share link `#build=` carries the nodes by their index in `skills.json` (it breaks if the game adds nodes).

### Formulas
- **Exact**:
  - Attributes (skills + Flame).
  - Health, mana, stamina = round((base + per point x attribute) x world factor) + the worn items' and their upgrades' lines (not scaled).
  - Oxygen (x `playerDivingTimeFactor`); Shroud time = round((240 + 60 x Flame) s x `shroudTimeFactor`) + the worn items' "Time in the Shroud" lines + Inner Fires; passage level = Flame level (both confirmed in game 2026-11-09).
  - Melee, ranged and magic damage % = 0.05 x points + the worn items' lines (+ Mage Apprentice for magic); food and buffs are not modelled.
  - Armour per piece = `armorOffset + armorGradient x level`.
  - Weapon base damage = trunc(genericWeaponSeed x powerCreepWeapon x level + seed); the number the game shows for a weapon = trunc(trunc(base) x damage mod x speed mod), no attribute and no class in it.
  - Crit, sneak, merciless, backstab, skill-shot, healing, revive, regen delays and values, wet, against-family, class and kind rows, resistances, block.
  - Rested duration = ln(1 + comfortFactor x C) x comfortBase + RestedMinDuration minutes, C capped 0..255 (confirmed: C = 39 gives 36 min 58 s).
- **Estimation** (tagged):
  - The hit of a weapon = item damage x (1 + damage perks) x (1 + 5 % per attribute point) x (1 + weapon class) x (1 + Melee/Ranged/Magic lines and skills); combo factor, final rounding, crits, target and armour are not verified.
  - **DPS** = hit / attack time. Ranged: charge + fire (bows 1.1 s or 1.5 s, wands 0.666 s, thrown 1.1 s). Melee: the mean of the light chain of the family (one-handed 0.633 s, two-handed 0.967 s, greatsword 1.011 s, daggers 0.4 s). Staves and fists show "—". A bow adds the chosen arrow's number (the arrow at its own level, and it gives the damage kind; 44 arrows). Not counted: speed skills, crits, heavy attacks, dodges, extra shots, poison, explosions.
  - Parry (scales with the world's `enemyStaminaFactor`), frost duration = ((R + 1) x 95 - 75) x `playerBodyHeatFactor` seconds (not checked in game), gem effects.
- **"—"**: the Rested stamina bonus, frost resistance with no item line. Not applied: `Armor_*_Mod` skills, `ParryProficiency_Multiplier`.
- Parry and block per weapon: the shield parries with a one-handed weapon, else the weapon itself; Block is the shield's whenever one is worn.
- The world settings of the Game page feed health / mana / stamina, oxygen, Shroud time and parry; a tooltip names the setting when its factor is not 1.

### Recommendations (under the sheet)
Our own rule, not the game's, and never an equipment suggestion. For each armour piece and weapon (weapon slots + ranged), with P = character level and L = item level, the value (armour, or weapon base damage) is read twice: at the item's base level and with the upgrades taken.
- Flagged when either ratio value(L) / value(target) is below 0.85 (critical below 0.70). State `still` (too low even upgraded) or `compensated` (base low, upgrades make up). The slot badge follows the with-upgrades reading only.
- Target level = P, lowered by the Flame: at Flame F, the maximum level of the tier opened before it (tiers 1..10 = 5, 9, 15, 20, 27, 30, 35, 39, 45, 50; Flame 1 -> 1, Flame 2 -> 5, ..., Flame 11 -> 50), never above P. "Flame N opens tier N" is a deduction, not read in the exe. The panel says when the cap applies.
- Never flagged: L >= P, rings, shield, missing data. Only advice: the untaken upgrades when they reach 85 %.

---

## 9. Game settings (page "Game")

- The 38 dedicated-server `gameSettings` keys, each with kind (number, enum, boolean, duration), default, the game's min/max, group, FR/EN label and help. Durations are stored in ns and edited in minutes. Values are clamped like the server does.
- Presets Default / Relaxed / Hard / Survival (values from `settings-presets.json`; without it the preset shows the defaults with a note) and Custom; only Custom edits.
- **Who owns it**: a player without a team sees, edits and saves their own configuration; a team member sees the team's read-only; only the team owner edits and saves it (403 otherwise). Read again at login and when the player joins, leaves or changes role in a team.
- Saved on the server with the Save button (preset, differences from the default, server name, slots); the unsaved draft stays in the browser.
- **Export** builds the whole `enshrouded_server.json` (name and slot count editable; placeholder `userGroups` passwords with a warning to change them): preview, download, copy.
- **Import** (file or paste) validates, lists unknown / invalid / clamped keys, shows the diff against the default, then applies. Other server keys (ports, userGroups, bans) are kept in memory only, never in the browser storage (passwords), so the export round-trips them until a reload.
- Used by the Character formulas (section 8). Body heat, food buff, fog removal, XP and enemy damage / health are not shown on the Character, so not wired.

---

## 10. Save import (profile menu > Import a save)

- The player picks a local `character*.ksd` (or a dedicated server's `world0.ksd`, see "World save: Flame Altars" below). It is **read in the browser and never sent**. Limits: 50 MB file, 64 sections, 64 MB per section and 256 MB for all of them once decompressed, every offset checked. Never commit a real save.
- A preview shows, per kind, what is new; each kind has its checkbox. Applying only ticks, never unticks (`PUT /progress`).
- **Kinds**:
  - Known recipes and building pieces (`recipe:<guid>`): the id in the save is the FNV-1a 32 of the GUID bytes; flag not 0.
  - Finished quests (`quest:<id>`).
  - Collected lore pages (`lore:<note>:<page>`): each page of `lore.json` carries its `kid`; a file without `kid` imports no pages. Pages that share a knowledge id are ticked together, as the game does.
  - Discovered places: a marker with `kids` in `map-data.json` (757 markers), known when any id has a non-zero flag. A file without `kids` offers none.
  - Unique items, cosmetics and collectibles picked up: an item with a single marker whose flags include 1.
  - Places and picked-up items are the game's "discovered / picked up", not proof the marker was done: hence their own checkboxes. A marker counts once.
  - The explored area (section 4).
  - The **character sheet** (section `player_character`): level, the 8 worn slots (head, chest, hands, legs, feet, 2 rings, shield) and the 3 weapons of slots 1-3 of the first action bar, the equipped bow (the quiver entry that has a level), upgrades, gems (clamped to the gem's range), skill levels. Item level = base + upgrades, the base clamped to the item's range; unknown items are dropped; Flame is kept. It goes into the sheet of the profile followed. The layout is reverse-engineered from two saves: the preview shows the decoded values so that the player can check.
- **Into which profile**: the profile followed or a new one. Default: the same file as last time, or an empty profile, goes to the profile followed; another character's save becomes a new profile named "Personnage N". The dialog remembers the last import per profile (file name, date, counts) and names the character slot of `character<N>.ksd`.
- Checked on real saves (968 recipes, 88 quests, 166 pages, 199 places, 83 items on the test save); the meaning of a recipe's flag is not confirmed in game.

---

### World save: Flame Altars (`world0.ksd`)
- The dialog tells the two kinds apart by their sections: `player_knowledge` = a character save; no `player_knowledge` but at least one `base<nn>` = a world save; anything else shows "neither a character save nor a world save". Same limits and the same rule: read in the browser, never sent, nothing kept but the markers created.
- Parser `save-import/altars.ts`: sections `base00`..`base15` (a world holds up to 16 altars; only base00..05 were seen in the one real save, the names 10 to 15 are assumed decimal), each `[16 bytes GUID][min x,y,z u32 LE][max x,y,z u32 LE]...`, **half metres**; centre = (min + max) / 4 rounded to the metre, height = (min y + max y) / 4, side (m) = (max - min) / 2 = 40 m x level. **Refused / skipped and counted, never guessed**: a section shorter than 40 bytes, a box that is not a square on x and z, a side that is not 80, 160, 240 or 320 half metres (levels 1-4), a box past 10,240 m, an upside-down height, a `base` section outside `base00`..`base15`. A file with **more than 16** `base` sections is refused as unreadable. The altar object itself is not decoded: the box is taken as centred on it (matched the game on one real save: 1 altar of level 4 and 4 of level 1).
- Preview: how many altars, each with level and X / Z; the ones already a marker of mine (an altar within 1 m on x and z) are flagged and cannot be ticked, so importing the same file again adds nothing; the count of ignored sections; how many more markers fit (limit 100: the first that fit are ticked, no more can be ticked). Apply creates private altar markers (shared off, name "Altar <n>") in the profile followed, one request each, through `POST /markers`; a failure leaves the ones added and shows the server's reason.

---

## 11. My progress (profile menu)

- One bar per kind: recipes and building pieces, quests, lore pages, discovered places, picked-up unique items, explored area; from the marks against what the data files list.
- A kind the data files do not list shows a dash, never 0 %. The explored area is the share kept by the import.

---

## 12. Languages, layout, accessibility

- FR / EN / DE (Transloco), chosen when creating the account or in Profile > Account, kept by the account (`/settings`) and cached per device (`localStorage` `lang`, used before login). With the user, talk in French.
- **Languages are a list, not a pair.** Pipeline: `pipeline/languages.py` (`GAME_NAMES`: code -> the game's loca name, 15 entries; `BUILD`: the codes a run writes, today `fr, en, de`) is the only list; `map-data.json` `languages` is `BUILD` and every name array of the data files follows its order. Hand-written texts of the pipeline are dicts `{code: text}` read with `languages.tr` / `languages.row`: a language without an entry shows English, then French (counted and printed by the run, never blank, never a crash); a game text missing in a language also falls back to English (`fill_missing`, counted). French is matched by name in a few places (`languages.FR`), so it must stay in `BUILD`. Front: `LANGUAGES` in `core/lang.ts` (UI list; the backend list and the data's `languages` are checked against it), one `public/i18n/<code>.json` per language (a Vitest test fails when a file lacks or adds a key compared with `en.json`, or changes a `{{ placeholder }}`), the settings labels of the Game page have a `de` overlay in `core/game-settings.de.ts` (a language without a label shows the English one). Adding a language: see `pipeline/languages.py`.
- German (added 2026-11-18): the interface file and the settings labels are machine translated (game terms taken from `De_De.tsv` where the UI names a game thing); a German-speaking player reviewed them on 0.3.0 and found no problem (issue #97, 2026-11-19); the hand tables of the pipeline were written by hand with the game's German terms where the game has them.
- The left menu's position is per device. `.tabs` of the workshop and lore keep a fixed height, and a test measures the layout shift.
- Every screen must pass AXE and WCAG AA; AXE runs in the e2e suite on each workshop tab.
- Visual identity "Codex of the Shroud": tokens only, enforced by `npm run lint` (rules in `frontend/CLAUDE.md`).

---

## 13. Reference tables

### Mark ids (table `marks`, per character profile)
| Shape | Meaning | Shared with the team | In the profile counter |
| --- | --- | --- | --- |
| `<category>:<x>:<z>` | a map element done | yes | yes |
| `recipe:<guid>` | a recipe or building piece known | no | no |
| `lore:<note id>` | a whole note collected | no | no |
| `lore:<note id>:<page>` | one page collected | no | no |
| `quest:<quest id>` | a quest finished | no | no |

Custom markers (section 4) are **not** mark ids: they live in `custom_markers`, not in `marks`.

### Links (URL fragment)
| Fragment | Effect |
| --- | --- |
| `#invite=<token>` | create an account from an invitation |
| `#reset=<token>` | choose a new password |
| `#enemy=<id>` | open an enemy page |
| `#build=<nodes>` | open a skill build |

### Where state lives
| State | Server | Browser (`localStorage`) |
| --- | --- | --- |
| Marks | `marks` (per profile) | — |
| Map filters, language | `/settings` (per player: `filters`, `lang`) | `lang` (cache, used before login) |
| Character sheet | `character_sheets` (per profile) | cache `skillDraft:<id>`, `itemLevels:<id>`, `activeWeapon:<id>` |
| Saved builds | `builds` (per profile) | — |
| Custom markers | `custom_markers` (per profile) | unticked layers `markerView` |
| Explored area | `fogs` (per profile) | cache `fog:<id>`, `fogShare:<id>`; ticked layers `fogView`; `onlyExplored` |
| Hide what I marked | — | `hideDone` |
| Last import | — | `lastImport:<id>` |
| Game configuration | `game_configs` (per team, else per player) | unsaved draft `gameSettings` |
| Calculator project | — | `project` |
| Add-on entries on/off, access levels | `addon_entries`, `addon_access` (per entry, per player) | — |
| Menu layout, menu hidden, legend folded | — | `layout`, `menu`, `legend` |

Everything personal in the browser is wiped at logout. The first version's single keys (`skillDraft`, `itemLevels`, `activeWeapon`, `fog`...) go to the first profile that asks.

### API (`/api/v1`)
| Prefix | Routes |
| --- | --- |
| `/auth` | `POST setup`, `POST invitations` (+ `/check`, `/accept`), `POST login`, `POST logout`, `GET check`, `GET me` (`username`, `is_admin`, `setup_required`, `passkeys_enabled`, `addon`; `id`, `created_at` when logged in), `POST password`, `POST delete-account`, `GET users` (admin; `id`, `username`, `created_at`), `DELETE users/{id}`, `POST password-resets` (+ `/check`, `/accept`) |
| `/addons` | `GET` (what I may use), `GET admin`, `PUT {id}` (enable), `GET {id}/access`, `PUT {id}/access/{user_id}`, `GET {id}/me` (for add-on backends) |
| `/auth/passkeys` | `GET`, `DELETE {id}`, `POST register/options`, `POST register/verify`, `POST login/options`, `POST login/verify` |
| `/characters` | `GET`, `POST`, `POST {id}/activate`, `PATCH {id}`, `DELETE {id}`, `GET|PUT {id}/sheet` |
| `/progress` | `GET`, `PUT` |
| `/builds` | `GET`, `POST`, `PUT {id}`, `DELETE {id}` |
| `/fog` | `GET`, `PUT`, `PATCH`, `DELETE` |
| `/markers` | `GET` (mine), `POST`, `PATCH {id}` (replaces every field), `DELETE {id}` |
| `/team` | `GET`, `POST`, `PATCH`, `DELETE`, `POST leave`, `POST members`, `DELETE members/{id}`, `POST owner`, `POST invitations`, `GET available`, `GET marks`, `GET fog`, `GET fog/{user id}`, `GET markers` |
| `/game-config` | `GET`, `PUT` |
| `/settings` | `GET`, `PUT` |
| — | `GET health` |

### Versions and releases
| What | Rule |
| --- | --- |
| Scheme | SemVer tag `vMAJOR.MINOR.PATCH`; first release `v0.1.0` (0.x until stable) |
| Source of the number | `backend/pyproject.toml` = `frontend/package.json` (+ lock); the `Release` workflow refuses a tag that differs |
| Release notes | generated from merged PRs, grouped by label (`.github/release.yml`) |
| Images | tag `v1.2.3` -> `ghcr.io/lokidata/enshrouded-map-{api,web}:1.2.3`, `:1.2`, `:latest`; `main` -> `:latest`, `:sha-xxxxxxx` |
| Procedure | `deploy/README.md` > Releases |

### Limits
| What | Limit |
| --- | --- |
| Character profiles per player | 10 |
| Saved builds per profile | 50 (name 1-60, 400 nodes, level 1-3) |
| Marks | 200,000; 50,000 per request |
| Custom markers per profile | 100 (name 1-40, note 500, x and z 0-10,240, altar level 1-4) |
| Sheet, filters, game configuration | 256,000 bytes each |
| Request body | 4,000,000 bytes |
| Invitation and reset links | 20 minutes, single use |
| Upgrades per slot | 8 |
| Gem level | 1-200, clamped to the gem's range |

### Data files (`artifacts/map/`, from the pipeline)
| File | Content | Without it |
| --- | --- | --- |
| `map-data.json` | categories, markers (with loot and `kids`), biomes, item names and pictures | no map |
| `resources.json` | chests, plants, ores | no dots |
| `tiles/`, `icons/`, `items/`, `overview.jpg` | map tiles and pictures | — |
| `craft.json` | recipes, building pieces, stations, altar, items, sets | no Workshop |
| `lore.json` | notes, pages (with `kid`), quests | no Lore |
| `enemies.json`, `enemies/` | bosses and elites, pictures | no Enemies |
| `gear.json`, `ui/` | equipment, constants, texts, slot art | Character opens the skills only |
| `gems.json` | gems, comfort furniture | no gem choice |
| `item-names.json` | internal item names (`debugName`) with FR/EN/DE names and the picture guid, read by the chestsort add-on only | the add-on's chestsort editor shows internal names only, without the picker's pictures and translated names |
| `skills.json`, `skills/` | skill tree and icons | no skills |
| `settings-presets.json` | the presets' values | presets show the defaults |

After a pipeline run: copy the output to the server's artifacts folder; nothing to restart (`map-data.json` is revalidated on each load). New front-end code (a new category in the menu) needs the new image deployed.

---

## 14. Known gaps (do not present as done)

- Hairstyles, 10 hair colours, 1 eye colour: no position in the game data (section 4).
- Ordinary enemies, damage taken, drops: not readable in the data (section 7).
- Estimations: weapon hit, DPS, parry, frost duration, gem effects (section 8). Not modelled: food, buffs, speed skills, crits.
- Skill budget 212 comes from enshrouded.tools; 72 skill descriptions show "…" for their value.
- The share link of a build breaks if the game adds skill nodes.
- The save layout of the character sheet rests on two saves; a recipe's flag meaning is not confirmed in game.
- The sheet's send to the server is silent on failure; the changes stay marked as unsent and go out at the next visit if no other device wrote meanwhile (else the server's copy wins and they are lost).
- The migrations after 0012 were run on SQLite; PostgreSQL was not run for 0013 and 0018.

## Data files split by language (2026-11-20)

`craft`, `gear`, `lore`, `skills` and `gems` are written by `pipeline/split_languages.py` (last step of `build_data.py`) as `<name>.json` (structure; every name/desc/label/text array blank) + `<name>.<code>.json` (the texts of one language, one flat list in walk order). `core/data-files.service.ts` loads the structure and the texts of the active language; `LangService.set` fetches the texts of a new language before the switch; `core/texts.ts` merges them. Not split: `map-data.json` and `resources.json` (names are the keys of the saved filters, `itemKey`). Measured on the real data (3 languages, 5 files): 8.2 MB raw / 1.59 MB gzipped -> one player gets 3.9 MB / 0.78 MB. Search finds text of the language shown only (it used to match all languages). A new language needs no change in the split. Verified: split + merge gives back the original files exactly (3 languages).
