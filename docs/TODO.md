# TODO

## Page « Partie » (game settings)

Goal: one page holding the configuration of the player's game/server, starting from the game's default settings, used by the calculations and exportable/importable as a server file.

- [x] **Data** (presets, ranges: `settings-presets.json`; labels FR/EN written in `game-settings.model.ts`): list every game setting with its default, type, range and label FR/EN from the game data (pipeline on tora: `BalancingTable` / world settings; reuse `build_gear.py` helpers). Output `settings.json` (+ fixture, nginx protection like the other json files, README counts).
- [x] **Format of the server file**: documented in `docs/server-settings.md` (official article, version 0.9.0.0: 36 `gameSettings` keys with defaults and ranges, presets, `userGroups`). Still to do: the values of the Relaxed / Hard / Survival presets (not in the article; extract from the game data) and check the keys against a real file of the user's server.
- [x] **Page** (`frontend/src/app/game/`, top bar entry « Partie »): grouped fields (players, enemies, survival, resources, Shroud, Flame...), "default" badge and per-field reset, "reset all", presets if the game has them; same look as the workshop; AXE; FR/EN.
- [x] **State**: `GameSettingsStore` (signals), kept in `localStorage`; later saved per player (backend column/table + migration) if wanted. Only the differences from the default are stored.
- [x] **Export**: generate the server configuration file from the settings (download as `enshrouded_server.json`, copy button, preview). Keep the other server keys (name, ports, password) out or optional, never invent values.
- [x] **Import**: load an existing server file (file picker + paste), validate (JSON, known keys, ranges), show unknown/ignored keys and what changed against the default, then apply.
- [x] **Use in the calculations**: wire the settings the formulas depend on, for example Shroud time (world factor in "Temps dans la Brume"), enemy stamina for the parry (`weaponParry`: the screen's 26 needs about 0.85-0.88 instead of 1), damage/health factors, XP rate. Show in the tooltips which setting changes a value.
- [x] **Tests**: Vitest (parse/validate/export round trip, defaults), Playwright (edit, export, import, reload), backend tests if stored server side.
- [x] **Docs**: functional rules in `docs/RULES.md`, README and `pipeline/README.md` counts.

Open questions: which settings the server file really exposes in the current game version; whether the user wants the settings saved in their account or only in the browser.

## Later

- [x] **Save the Personnage page on the server**: the page's state (level, Flame, gear, upgrades, gems, weapon in hand) lives only in the browser per profile (`localStorage`); store it per character in the backend (table + migration) so it follows the player across devices.
- [x] **Appearance unlocks on the map**: the 23 colour palettes lying in the world have a position (20 `LootPickup_colorPalette_reward_*` pickups, found like the collectibles in `collectible_templates`, + 3 in the scene's special loot: Draped In Envy, Cathedral, Golden Ball); they are the new rose `palette` category (pipeline `special_loot` and `collectible_templates`, icon `palette.svg`, hidden by default, local `artifacts/map` patched; rerun the pipeline on tora to regenerate). The 5 `LootPickup_NPC_Barber_hairstyle_wigHead_*` wig heads (they unlock hairstyles; the 6th, "Barber's Favorite", has no pickup) are the `hairstyle` category. Eye and hair colours (second pass, 2026-11-13): the journal's "Player customisation" item sets give hints per colour; the tales and search areas they point to are the `eyecolor` (9 of 10 colours) and `haircolor` (5 of 15) categories, see RULES section 4. Not mappable: the hairstyles themselves, 10 hair colours and the dark red eyes (their hints name no place); the 4 `LoreText_*colorPalette*` pages (barber quests) are lore pages, not palettes, and left out; the other palettes are crafted at the Coloring Station or quest rewards.

## Custom markers and altar zones (issue #81, done 2026-11-18, released in 0.3.0)

Done: per-profile custom markers (name, note, `shared` per marker, 100 per profile), team members see shared ones read-only in a layer per member; sharing is reset when leaving a team (same rule as the explored area). The Flame Altar is a marker type with a centred square build area: level 1-4 = 40, 80, 120, 160 m (given by the user, not extracted from the game).

- [x] **First version**: custom pins and altar zones (levels 1-4 = 40/80/120/160 m), per profile, `shared` per marker, 100 per profile, a layer per teammate, privacy reset with the explored area, tests (pytest, Vitest, e2e). Also done the same day: moving a marker, the ticked layers kept per browser, the list "My markers" in the menu (count, search, shared by teammates).
- [ ] **Shared ping** (2): a click sends a point the team sees for a few minutes, nothing stored (the map already has local pings).
- [x] **Altar position from the save** (3): done 2026-11-18 in the save import dialog (`world0.ksd`, parser `save-import/altars.ts`, see RULES section 10). Tested on synthetic files and once, by hand, on the user's real save (5 altars read as expected); not tried in the browser with the real file.
- [x] **Measure tool** (4): done 2026-11-18 (button "Measure" on the map, see RULES section 4).
- [x] **Altar zone contents** and **build area in the Workshop altar tab** (done 2026-11-18, RULES sections 4 and 5). Not done: "show these elements on the map".

## More languages (planned, not started)

The game has 15 text languages (Steam: English, French, Italian, German, Spanish (Spain), Japanese, Korean, Polish, Portuguese (Brazil), Russian, Simplified and Traditional Chinese, Turkish, Ukrainian, Thai); the site has FR and EN. Not checked: that the 13 other `loca/*.tsv` files exist in the extracted data (needs Tora).

- [x] **Common refactor, 2 -> N languages** (done 2026-11-18, German added, released in 0.2.0): `LANGUAGES` in `build_data.py`, `build_lore.py`, `build_skills.py`; the `for lang in (0, 1)` loops in `build_craft.py` and `build_enemies.py`; the hand-written two-column tables (`TEXTS`, `CLASS_LABEL`, `APPEARANCE_PLACES`...); the `fr:` / `en:` labels of `game-settings.model.ts`; the language switch of the top bar.
- [x] **Data weight** (done 2026-11-20, PR #106, released in 0.5.0 and live on the server): craft, gear, lore, skills, gems split per language, see RULES.md > Data files split by language. Left: `map-data.json` and `resources.json` (0.4 MB per language at most; their names are filter keys).
- [x] **One more language first: German** (UI, settings labels and pipeline tables done and tested locally; the interface and settings texts are machine translated, and a German-speaking player reviewed them on 0.3.0 and found no problem (issue #97, 2026-11-19); the real data run is in `artifacts/map` only after the user's go). Remaining per language: translate the 687 keys of `frontend/public/i18n/*.json` (human review), run the pipeline on Tora with its `loca` file, translate the hand-written tables, Vitest + Playwright + AXE. About half a day per language after the refactor.

## Profile page (done, PR #82)

Account menu > Profile (popup): tabs Account (language kept by the account, password), Passkeys, Customization (menu layout), Danger zone. See RULES.md "Profile page".

- [ ] **Later, only if asked**: timezone, a global save button, the layout kept by the account (today per device), more languages (add the code to `LANGUAGES` in `frontend/src/app/core/lang.ts` and `backend/app/schemas/settings.py`, plus a `language_<code>` text).

## Plugins / add-ons (first version done)

- [x] Done (manifest, tabs, custom elements, see RULES.md > Optional server add-on). Still open: a second add-on in another repo, the add-on reading site data (account, team, map), a weight check of the second Angular runtime on a slow phone.
- [x] **Export the game's German texts on the pipeline PC** (done 2026-11-20: the installed `map_export` mod only listed `Fr_Fr, En_Us`; `De_De.tsv` exported with the 15-language list, pipeline rerun into `out_split`, JSON copied to the local `artifacts/map`; `item-names.json` now has real German names, 62 of 4,018 equal to English). Live on the server since 0.5.0.
- [ ] ~~**Plugin / add-on system**~~ (original idea, kept for the record): let the site host extensions, for example to manage a game server or its mods. Today the server tools live in a separate project (`enshrouded-map-addon`: server status, access, power, backups, chestsort editor) that shares only the look (`design-system/`). To decide: how an add-on registers itself (menu entry, screens, routes), what it may read (account, team, map data) and how it is isolated, with the same security rules as the site (sessions, CSRF, no data sent out).

## Feedback on 0.3.0 (issue #97)

A player's pipeline changes, shown by screenshots in the issue; their code is not in the repo (a pull request was invited).

- [ ] **Water tiles**: the tile rendering draws a little too much water around the altar areas. The player adjusted the render in their pipeline (`render_map.py`); to look at and reproduce, then fix the water threshold.
- [ ] **Roads**: highlight the roads and draw the roads that run in caves on the map (the player did both in their pipeline). To decide: roads as a tile layer or as map data, and whether it is wanted by default.

## Add-on SDK (phase 1 done on branch `feat/addon-sdk-phase1`; spec `docs/superpowers/specs/2026-11-23-addon-sdk-design.md`)

- [ ] **Phase 2**: map-layer API (the `map-layer` capability is declared and shown, nothing mounts it) and its JS package.
- [ ] **Phase 3**: Python helper for add-on backends, template repository, `addon-lint`, SDK docs; the contract schema then lives in the SDK repository.
- [ ] **Not run**: `nginx -t`, `docker compose config`, `make e2e-stack` (with `addon-stack.spec.ts`); migration 0018 on PostgreSQL.
- [ ] **Minor findings parked by the reviews**:
  - Backend: concurrent first-time `PUT /addons/{id}` and access writes can 500 on the primary key (retry as in `progress.py`); the `addon` flag globs the folder on every login/me (cache it or catch `OSError`); the flag is true for any `<key>/addon.json`, even invalid; registry: the fetch timeout is per operation (a slow-drip add-on holds the lock), refresh holds one lock for sequential fetches, `addon.json` symlinks are followed, one warning per key every 30 s.
  - Front: a stale success of entry B clears entry A's failed state; `parseEntries` does not check capability values or id uniqueness (the backend does); the enable toggle reuses the access error text and has no in-flight guard; injected `<link>`/`<script>` stay in the head after `clear()`.
  - Tests: carol-id-reuse assertion is SQLite-specific; missing negative cases (bad `ADDON_URL`, oversized/invalid static manifest, a good key after a failing one, failed enable PUT restore).
  - Deploy: `40-addon.sh` is stricter than the API (no spaces, duplicate keys); the test script uses a non-POSIX `grep '\|'`; the default `./addons` bind creates a root-owned folder (Portainer: set an absolute `ADDONS_PATH`); `addon-stack.spec.ts` depends on `map.spec.ts` leaving the admin password.
