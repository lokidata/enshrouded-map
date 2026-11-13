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
- [x] **Appearance unlocks on the map**: the 23 colour palettes lying in the world have a position (20 `LootPickup_colorPalette_reward_*` pickups, found like the collectibles in `collectible_templates`, + 3 in the scene's special loot: Draped In Envy, Cathedral, Golden Ball); they are the new rose `palette` category (pipeline `special_loot` and `collectible_templates`, icon `palette.svg`, hidden by default, local `artifacts/map` patched; rerun the pipeline on tora to regenerate). The 5 `LootPickup_NPC_Barber_hairstyle_wigHead_*` wig heads (they unlock hairstyles; the 6th, "Barber's Favorite", has no pickup) are the `hairstyle` category. Eye and hair colours (second pass, 2026-11-13): the journal's "Player customisation" item sets give hints per colour; the tales and search areas they point to are the `eyecolor` (9 of 10 colours) and `haircolor` (5 of 15) categories, see RULES section 4. Not mappable: the hairstyles themselves, 10 hair colours and the dark red eyes (their hints name no place); the 4 `LoreText_*colorPalette*` pages (barber quests) are lore pages, not palettes, and left out; the other palettes are crafted at the Coloring Station or quest rewards; the game has no horse coat data.
