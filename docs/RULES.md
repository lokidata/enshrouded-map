# Functional documentation

What the app does, screen by screen, and the rules it follows. This file is the reference ("memory") for any change: read the section of the screen you touch, and update it in the same change when a rule moves. Last full review: 2026-11-13.

Other documents: data formats in `pipeline/README.md` and in the docstrings of `pipeline/build_*.py`; deployment in `deploy/README.md`; save file format in `docs/DESIGN-save-import.md`; server file in `docs/server-settings.md`; open work in `docs/TODO.md`; architecture notes and decisions in `CLAUDE.md`.

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

The top bar also holds the layout and language choices and the profile menu (`AccountBar`): invite, team, my characters, my progress, import a save, password, passkeys, delete account, administration (administrator only), logout. With several character profiles, a select in the top bar switches the profile followed.

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
- nginx serves the data files only with a valid session (`auth_request` -> `GET /auth/check`): `tiles`, `icons`, `biomes.png`, `overview.jpg`, `map-data.json`, `resources.json`, `craft.json`, `lore.json`, `enemies.json`, `enemies/`, `gear.json`, `gems.json`, `skills.json`, `skills/`, `ui/`, `settings-presets.json`. `ng serve` does not protect them.
- Login is rate-limited per client address (10 per 5 minutes; setup and invitations 10 per hour) and an account locks progressively after 5 failed logins. The limit is in memory: a single API worker.

### Passwords
- A player changes their own password (`POST /auth/password`): the current one is required and the other sessions are revoked.
- The administrator generates a single-use reset link for another player (`#reset=<token>`, 20 minutes); a new link replaces the previous one for the same player.
- Administrator locked out: `python -m app.cli reset-password USERNAME` in the api container.
- Every password field has a show/hide button; creation and change have a confirmation field.

### Passkeys (WebAuthn)
- Optional: on only when `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN` are set (https, one host name); `/auth/me` returns `passkeys_enabled`.
- An alternative to the password: managed in profile > Passkeys, "Use a passkey" on the login screen. Challenges are kept in memory (single worker).

### Deleting an account
- A player deletes their own account (`POST /auth/delete-account`, password required): progress, builds, profiles and sessions are erased.
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

- At most one team per player. The creator is the **owner**: only the owner renames, disbands or hands the team over (`POST /team/owner`; the former owner stays a member).
- Any member: adds an existing player who has no team (immediate, `POST /team/members`), removes another member (not the owner, not themself), creates an invitation link whose new account joins the team.
- Leaving is always possible. If the owner leaves, the longest-standing member becomes owner; the last one to leave closes the team. Marks stay personal in every case.
- The team shares only **who marked what on the map** (the popup lists the players). The others' marks are refetched every 60 s and when the tab comes back. Recipe, lore and quest ticks are never shared.
- The game configuration of a team belongs to its owner (section 9). The explored areas are shared only on request (section 4).

---

## 4. Map

### Layout
- Left menu: filters per category with counts (done / total), grouped in sections; the Loot section holds unique items, cosmetics, colour palettes, hairstyles, collectibles and chests. It can be hidden and placed left, on top, or automatically (portrait = top), remembered per device.
- The filters chosen are saved per player on the server (`/settings`); a new player keeps the defaults.
- No biome layer (removed on request; `biomes.png` is still produced and `map-data.json` still lists the biomes). The layers control (top right) lists only the explored-area layers.
- Look: mist vignette, popups as plates (see the design rules in `frontend/CLAUDE.md`).

### Categories (counts of 2026-11-13)
- Icon markers: point of interest 110, cosmetic 110, collectible 107, enemy camp 92, elite 84, unique item 79, elixir well 76, landmark 67, flame shrine 63, cave 55, summoning stone 45, camp 44, farm 37, dungeon 37, night temple 30, boss 28, dungeon entrance 27, place name 25, **colour palette 23**, gem forge 21, mine 21, shroud root 15, obelisk 14, fast travel 10, balefire 9, big dungeon 6, **hairstyle 5**, hidden grave 4, start 1, plus region names.
- Dots (`resources.json`): chests 2575 (12 kinds), ores 6632 (17 kinds), plants 124,417 points (52 kinds).
- Hidden until ticked: chest, plant, ore, unique, cosmetic, palette, hairstyle, collectible.
- **Plants**: a whitelist (`PLANT_ITEMS` in `pipeline/build_resources.py`) decides which plants appear.

### Loot markers
- A loot marker is one item at one place (it carries `item`, a key of `map-data.json` `items`, with its picture). Sources: the scene's guaranteed loot with a single container, the items placed in the scene, and pickups lying in the world.
- **unique**: weapons, equipment, tools, instruments, fishing rods, gems, ammunition. **cosmetic**: the same whose developer name starts with `Vanity_` (violet). **collectible**: the Collections items. **palette**: the 23 colour palettes that lie in the world (20 pickups + 3 in guaranteed loot); the other palettes are crafted at the Coloring Station or are quest rewards, and the 4 palette lore texts are lore pages, not palettes. **hairstyle**: the 5 Barber wig heads that unlock haircuts once picked up (braid, cowlick, slick fade, afro, hanfu ponytail); the sixth, "Barber's Favorite", has no place in the world.
- Not on the map because the game data gives them no position: the hairstyles themselves, eye and hair colours (unlocked by the Barber's quests and by reading tales), horse coat colours (no such data).
- Items sharing a container are moved apart by 1 m so that each keeps its own mark id.
- **Loot stacks**: loot markers within 3 m share one icon and one popup listing each item with who marked it, and a single button that marks or unmarks all. Stack icon: green when all are green, orange as soon as one waits on me, blue when I am alone on all that are marked, violet otherwise.
- Other guaranteed items of a container (materials, blocks...) are listed in the popup of what stands there (the loot marker, the chest or the enemy).

### Marking
- A player marks an element as done; the mark id is `category:x:z` (rounded metres). Marking shows at once and is sent in order (`PUT /progress`, idempotent: a concurrent identical request is retried once; a persistent conflict answers 409). A refused change is put back and an error shows.
- A marked element shows as a faint ghost, except **landmarks** (`start`, `fastTravel`): icon 1.4x bigger, above the others, never faded; their halo still applies.
- **Halo** by who marked: none = nobody; blue = only me (team of 2+); violet = me and some, not all, of the others (3+ members); orange = others did, I did not; green = every member (no team or a team of one: green when I marked it). Dots use the same colours for their outline. A foldable legend lists only the colours the team size can produce.
- The profile counter counts map marks only (recipes, lore pages and quests are left out).

### Popups
- Every popup has a picture: the item's or the enemy's, else the category icon. Boss, elite and summoning-stone popups show the head of the creature (by mark id, else by name; up to 3, smaller from 2). Fixed content height, except popups flagged tall.

### Explored area
- Comes from a save import (section 10): a grid of 1280 x 1280 cells of 8 m, north up. It is drawn as a dark veil over what is not explored.
- **Kept by the server for the profile** (table `fogs`, one bit per cell, readable by its owner only): it survives a logout and comes back on another browser. The browser caches it with the server's stamp and takes the server copy when the stamp differs. An area imported before the server kept them is sent on the next load.
- **Sharing with the team** is opt-in, off by default, switchable at any time: from the import dialog ("Share this area with my team", shown only in a team), from "My progress", or from the map's side menu. `PUT /fog` stores the area of the profile followed (`bits` + `shared`, replaces the last), `PATCH` switches `shared`, `DELETE` removes it. Nothing else is stored: no position, no discovered places. Never share without the explicit tick.
- **Layers**: each area is its own layer in the layers control: "My explored area" and one "Explored area of <name>" per member who shares (`GET /team/fog` lists them with a stamp, `GET /team/fog/{user id}` gives one; only new or changed ones are fetched). Ticking is the player's choice, kept in the browser; new members start shown. The map draws **one veil** over everything outside the union of the ticked layers; nothing ticked, no veil. Leaving the team, deleting the profile or unsharing removes the layer for the others.
- **Only the explored area** (side menu checkbox, enabled once an area exists): hides the markers whose cell is not explored, by the same union. Names of places and regions stay; chest, plant and ore dots are not filtered.

---

## 5. Workshop (`craft.json`)

Data of 2026-11-13: 1198 recipes, 1324 building pieces, 14 altar levels, 2774 items, 79 armour sets.

### Tabs
Recipes, Items, Building, Stations, Altar (with a cost planner between two levels), Calculator. Every item chip is a button that opens the item's page. Recipe and building lists have a grid or a table view.

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
- **Saved builds** (skills page only): name (1-60) + skill nodes, 50 per profile, private; opened, replaced by saving under the same name, deleted. The share link `#build=` carries the nodes by their index in `skills.json` (it breaks if the game adds nodes).

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

- The player picks a local `character*.ksd`. It is **read in the browser and never sent**. Limits: 50 MB file, 64 sections, 64 MB per section, every offset checked. Never commit a real save.
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

## 11. My progress (profile menu)

- One bar per kind: recipes and building pieces, quests, lore pages, discovered places, picked-up unique items, explored area; from the marks against what the data files list.
- A kind the data files do not list shows a dash, never 0 %. The explored area is the share kept by the import.

---

## 12. Languages, layout, accessibility

- FR / EN (Transloco), chosen in the top bar and remembered per device. With the user, talk in French.
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
| Map filters | `/settings` (per player) | — |
| Character sheet | `character_sheets` (per profile) | cache `skillDraft:<id>`, `itemLevels:<id>`, `activeWeapon:<id>` |
| Saved builds | `builds` (per profile) | — |
| Explored area | `fogs` (per profile) | cache `fog:<id>`, `fogShare:<id>`; ticked layers `fogView`; `onlyExplored` |
| Last import | — | `lastImport:<id>` |
| Game configuration | `game_configs` (per team, else per player) | unsaved draft `gameSettings` |
| Calculator project | — | `project` |
| Language, menu layout, menu hidden, legend folded | — | `lang`, `layout`, `menu`, `legend` |

Everything personal in the browser is wiped at logout. The first version's single keys (`skillDraft`, `itemLevels`, `activeWeapon`, `fog`...) go to the first profile that asks.

### API (`/api/v1`)
| Prefix | Routes |
| --- | --- |
| `/auth` | `POST setup`, `POST invitations` (+ `/check`, `/accept`), `POST login`, `POST logout`, `GET check`, `GET me`, `POST password`, `POST delete-account`, `GET users`, `DELETE users/{id}`, `POST password-resets` (+ `/check`, `/accept`) |
| `/auth/passkeys` | `GET`, `DELETE {id}`, `POST register/options`, `POST register/verify`, `POST login/options`, `POST login/verify` |
| `/characters` | `GET`, `POST`, `POST {id}/activate`, `PATCH {id}`, `DELETE {id}`, `GET|PUT {id}/sheet` |
| `/progress` | `GET`, `PUT` |
| `/builds` | `GET`, `POST`, `PUT {id}`, `DELETE {id}` |
| `/fog` | `GET`, `PUT`, `PATCH`, `DELETE` |
| `/team` | `GET`, `POST`, `PATCH`, `DELETE`, `POST leave`, `POST members`, `DELETE members/{id}`, `POST owner`, `POST invitations`, `GET available`, `GET marks`, `GET fog`, `GET fog/{user id}` |
| `/game-config` | `GET`, `PUT` |
| `/settings` | `GET`, `PUT` |
| — | `GET health` |

### Limits
| What | Limit |
| --- | --- |
| Character profiles per player | 10 |
| Saved builds per profile | 50 (name 1-60, 400 nodes, level 1-3) |
| Marks | 200,000; 50,000 per request |
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
| `skills.json`, `skills/` | skill tree and icons | no skills |
| `settings-presets.json` | the presets' values | presets show the defaults |

After a pipeline run: copy the output to the server's artifacts folder; nothing to restart (`map-data.json` is revalidated on each load). New front-end code (a new category in the menu) needs the new image deployed.

---

## 14. Known gaps (do not present as done)

- Hairstyles, eye and hair colours, horse coats: no position in the game data (section 4).
- Ordinary enemies, damage taken, drops: not readable in the data (section 7).
- Estimations: weapon hit, DPS, parry, frost duration, gem effects (section 8). Not modelled: food, buffs, speed skills, crits.
- Skill budget 212 comes from enshrouded.tools; 72 skill descriptions show "…" for their value.
- The share link of a build breaks if the game adds skill nodes.
- The save layout of the character sheet rests on two saves; a recipe's flag meaning is not confirmed in game.
- The sheet's send to the server is silent on failure; the changes stay marked as unsent and go out at the next visit if no other device wrote meanwhile (else the server's copy wins and they are lost).
- The migrations after 0012 were run on SQLite; PostgreSQL was not run for 0013.
