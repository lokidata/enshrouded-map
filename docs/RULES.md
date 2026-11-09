# Functional rules

What the app does and the rules it follows, in the order of the screens (account, team, then the top bar: Map, Workshop, Lore, Enemies, Character, Game). Last review: 2026-11-09. Data formats live in `pipeline/README.md` and in the docstrings of the `pipeline/build_*.py` scripts; the architecture notes are in `CLAUDE.md`.

Honesty rule used everywhere a number is computed: **exact** = read from the game data or `enshrouded.exe` and checked against the game; **estimation** = shown with an "estimation" tag; **"—"** = unknown, never invented.

## 1. Access and accounts

- No public sign-up. On an empty database the first visit creates the first account (`POST /auth/setup`), only with the setup token (`SETUP_TOKEN`, or the random one printed once in the API log). The dialog cannot be dismissed. The first account is the administrator (`users.first_account`); there is only one.
- A logged-in player creates a single-use **invitation** (`POST /auth/invitations`, `INVITATION_MINUTES` = 20), sent as `<site>/#invite=<token>` (fragment: never logged). The token is stored hashed; accepting it creates the account atomically.
- Without a session the page shows only the login dialog (not dismissible). nginx serves the map files (`tiles`, `icons`, `biomes.png`, `overview.jpg`, `map-data.json`, `resources.json`, `craft.json`, `lore.json`, `enemies.json`, `enemies/`, `gear.json`, `gems.json`, `skills.json`, `skills/`, `ui/`, `settings-presets.json`) only with a valid session (`auth_request` -> `GET /auth/check`). `ng serve` does not protect them.
- Passwords: a player changes their own (current password required, other sessions revoked). The administrator generates a single-use 20-minute reset link (`#reset=<token>`) for another player; a new link replaces the previous one. If the administrator is locked out: `python -m app.cli reset-password USERNAME` in the api container. Password fields have a show/hide button and a confirmation field.
- **Passkeys** (WebAuthn) are optional: on only when `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGIN` are set (https, one host name). They are an alternative to the password (profile > Passkeys; "Use a passkey" on the login screen).
- A player deletes their own account (password required): progress, builds and sessions are erased. The first account cannot be deleted. The administrator can delete another account (profile > Administration): same cascade plus leaving the team (an owner hands the team over); never itself.
- The profile menu holds: invite, team, password, passkeys, delete account, administration (admin only), logout.

## 2. Teams

- At most one team per player. The creator is the **owner**: only the owner renames, disbands or hands the team over (`POST /team/owner`; the former owner stays a member).
- Any member adds an existing player without a team (immediately), removes another member (not the owner, not themself) or creates an invitation link whose new account joins the team.
- Leaving is always possible. If the owner leaves, the longest-standing member becomes owner; the last one to leave closes the team. Marks stay personal in every case.
- The team only shares who marked what (the map popup lists the players). Others' marks are refetched every 60 s and when the tab comes back. Recipes, lore and quests ticks are never shared.

## 3. Map

- Left menu: filters per category, with counts; it can be hidden and placed left, on top, or automatically (portrait = top), remembered per device. `resources.json` (chests, plants, ores) loads in the background after the first render.
- A player marks a POI as done (mark id `cat:x:z`). A marked POI shows a faint ghost, except **landmarks** (`start`, `fastTravel`): icon 1.4x bigger, above the others, never faded.
- **Halo** by who marked it: none = nobody; blue = only me (team of 2+); violet = me and some, not all, of the others (3+ members); orange = others did, I did not; green = every member (no team or a team of one: green when I marked it). Dots (chests, plants, ores) use the same colours for their outline. A foldable legend (state in `localStorage` `legend`) lists only the colours the team size can produce.
- **Loot stacks**: loot markers (unique, cosmetic, collectible) within 3 m share one icon and one popup listing each item with who marked it, and a single button that marks/unmarks all. Icon: green when all are green, orange as soon as one waits on me, blue when I am alone on all that are marked, violet otherwise. Cosmetics (`Vanity_*` items) have their own violet category `cosmetic` (mark ids `cosmetic:x:z`).
- **Popups**: every popup has a picture: the dedicated item/enemy picture, else the category icon. Boss, elite and summon-stone popups show the head of the mob (by mark id, else by name, up to 3, smaller from 2). Fixed content height, except popups flagged tall.
- **Plants**: a whitelist of plant items (`PLANT_ITEMS` in `pipeline/build_resources.py`) decides which plants appear; adding an item to the list and re-running the pipeline adds it.
- The profile counter counts map marks only (recipes, lore pages and quests are left out).

## 4. Workshop (`craft.json`)

- Tabs: Recipes, Items, Building, Stations, Altar (with a cost planner between two levels), Calculator. Every item chip opens the item's page.
- Filters come from the `cat`/`type`/`food`/`rarity`/`cls`/`lvl` fields written by `build_craft.py` (`type` and `food` come from developer names: heuristics). Armour pieces are grouped into sets (79). No "New in 1.0" filter: the data has no such field.
- A player ticks the recipes they know (mark `recipe:<guid>`). These marks are not shared and not counted with the map marks.
- **Map and workshop in step**: a recipe whose `unlock.items` is a single item that exists on the map is *known* when `recipe:<id>` is marked OR that item's marker is. Ticking the recipe marks the item's marker when it has one place; unticking clears the recipe and every marker of the item. The 6 recipes with 7 unlock items are left alone. The item page shows its marked places; enemy pages and cards count their marked places.
- *Show on the map* focuses the map on the places (filters switched on, view framed).
- **Calculator** (`core/craft.calc.ts`): demand per item, then whole crafts with leftovers. Default recipe = no quest, fewest ingredients, changeable; cycles stay raw where they close; an ingredient category takes its first item unless chosen; "I have" quantities stop the breakdown. The category `scaling` is deliberately not applied. The project is kept in `localStorage` (`project`).
- Missing station or unlock data show as "Unknown station" or "Quest progress".

## 5. Lore (`lore.json`)

- Notes (320 notes, 564 pages, 13 categories) and Quests (186). A collected page is `lore:<note id>:<page>`, a whole note `lore:<note id>` (counts as all its pages; unticking one page splits it), a finished quest `quest:<quest id>`. Marks are personal, not shared, not in the profile counter. Notes have no map position (the journal gives none).

## 6. Enemies (`enemies.json`)

- Only the 24 bosses and the elites. Page: faction, experience multiplier, extra health per player (`EnemyScaling`), regions, nearby named areas, trophy item, *show on the map*, *copy link* (`#enemy=<id>`). The picture is the enemy's head or trophy item (no portrait exists in the game data). Ordinary creatures, damage taken and drops are not available in the data.

## 7. Character (`gear.json`, `gems.json`, `skills.json`)

### Sheet, equipment, builds
- The sheet has weapons 1-3 (the third is optional), ranged, shield, 2 rings and 5 armour pieces. A slot opens the Equipment picker (any item for the slot, search, rarity, weapon class). Each slot has a card: level, armour, parry and the upgrade chain.
- **Upgrades**: a chain, upgrade n needs the n-1 before it; the piece's armour counts at level + n plus each upgrade's share at its rank. Saved with the build (max 8 per slot).
- **Builds** (skills, level, Flame, gear, upgrades, gems) are saved on the server per player (max 50, private, name 1-60), opened, replaced by saving under the same name, deleted. The share link `#build=` carries the skill nodes only (index in `skills.json`: it breaks if the game adds nodes).
- Draft in `localStorage` `skillDraft`, cleared at logout.

### Skills
- 243 nodes, 312 links, 12 roots. A node is reachable from a root or a taken neighbour; the last level of a node others hang from cannot be removed. Points = cost x level against a budget of 212 (taken from enshrouded.tools). Six Flame nodes add floor(Flame / 2) attribute points once taken. 91 of the 163 descriptions with `%k` show their value, the others show "…".

### Formulas
- **Exact**: the weapon number the game shows (trunc(base x dmgMod x speedMod), no attribute and no class in it), attributes (skills + Flame), **Shroud time** = round((240 + 60 x Flame) s x `shroudTimeFactor`) + the worn items' "Time in the Shroud" lines (ms) + Inner Fires, and the **passage level** (= Flame level), both confirmed in game on 2026-11-09, **melee, ranged and magic damage** (0.05 x points + the worn items' lines, + Mage Apprentice for magic: the same code for all three, read from enshrouded.exe 0x140d1c990; food and buffs such as Blood Rage and Lunar Howl add in game and are not modelled), health/mana/stamina (round((base + per point x attribute) x world factor) + worn items' and upgrades' lines, which are not scaled), ranged damage, oxygen (x `playerDivingTimeFactor`), armour per piece (`armorOffset + armorGradient x level`), crit / sneak / merciless / backstab / skill-shot / healing / revive / regen delays / wet / against-family / class and kind rows, resistances, block (`blockPower`), weapon base damage `trunc(genericWeaponSeed x powerCreepWeapon x level + seed)`, **Rested duration** = `ln(1 + comfortFactor x C) x comfortBase + RestedMinDuration` minutes, comfort C capped 0..255 (confirmed in game: C = 39 -> 36 min 58 s).
- **DPS** (Damage tab, per weapon, estimation): hit / attack time. A ranged shot takes charge + fire (bows 1.1 s or 1.5 s, wands 0.666 s, thrown 1.1 s; read from the exe), a melee hit the mean of the light chain of the family (one-handed 0.633 s, two-handed 0.967 s, greatsword 1.011 s, daggers 0.4 s); staves (the time is the spell's) and fists show "—". A **bow** takes one arrow type chosen in a list (the ammo of gear.json, 44 arrows): D = bow's number + the arrow's (its own level), and the arrow gives the kind. The choice is kept in the draft and saved in builds (`gear.arrow`). Not counted: speed skills (Swift Blades, Heavy Hitter), crits, heavy attacks, dodges, extra-shot skills, poison and explosions.
- **Estimation**: the hit of a weapon (item damage x (1 + damage perks) x (1 + 5 % per attribute point) x (1 + weapon class) x (1 + gear Melee/Ranged/Magic lines and skills), structure read from applyDamage; the combo factor, the final rounding, crits, target and armour are not verified), parry (`parryPower` scales with `enemyStaminaFactor`, unknown on the site), **frost duration** = `((R + 1) x 95 - 75) x playerBodyHeatFactor` seconds with R = worn items' frost resistance (read from the exe, not yet checked in game; food and fires are not modelled), gem effects (`gemValue`).
- **"—"**: the Rested stamina bonus (the exe program does not match a measured sample), frost resistance with no item line. Not applied: `Armor_*_Mod` skills, `ParryProficiency_Multiplier`.
- Parry/block per weapon: the shield parries with a one-handed weapon, else the weapon itself; Block = the shield's whenever one is worn.
- Gems: each weapon slot (weapons 1-3, ranged) holds one gem at a chosen level (any gem, level clamped to the gem's `lvl`), shown as a badge, a slot-card line and rows under the weapon; never added to totals (every gem effect is a trigger).
- World settings (page Game) feed health/mana/stamina, oxygen, Shroud time and parry; tooltips name the setting when its factor is not 1.

### Recommendations (`core/recommend.logic.ts`)
Our own rule, never an equipment suggestion. For each armour piece and weapon, with P = character level and L = item level, the value is read twice: at the item's base level and with the upgrades taken.
- Flagged when either ratio value(L) / value(target) is below `LOW_RATIO` 0.85 (critical below `CRITICAL_RATIO` 0.70). State `still` (too low even upgraded) or `compensated` (base low, upgrades make up). The slot badge follows the with-upgrades reading only.
- Target level = P, lowered by the **Flame**: at Flame F, the maximum level of the tier opened before it (`TIER_MAX_LEVEL`: tiers 1..10 = 5, 9, 15, 20, 27, 30, 35, 39, 45, 50; Flame 1 -> 1, Flame 2 -> 5, Flame 3 -> 9, Flame 4 -> 15, ..., Flame 11 -> 50), never above P. Flame N opening tier N is a deduction, not read in the exe. The panel says when the cap applies (`capped`).
- Never flagged: L >= P, rings, shield, missing data. Advice only: the untaken upgrades when they reach 85 %.

## 8. Game settings (page "Game")

- The 38 dedicated-server keys with default, game min/max, group and FR/EN label. Presets Default / Relaxed / Hard / Survival (from `settings-presets.json`) and Custom; only Custom edits. Saved on the server (`game_configs`, `GET/PUT /api/v1/game-config`: preset, differences from the default, server name, slots) with the Save button; the browser keeps the unsaved draft in `localStorage` `gameSettings`. A player without a team sees, edits and saves their own configuration. A team member sees the team's configuration read-only (403 on save); only the team owner edits and saves it. It is read again at login and when the player joins, leaves or changes role in a team. Durations are stored in ns, edited in minutes. Values are clamped like the server does.
- Export builds the whole `enshrouded_server.json` (name and slots editable; placeholder `userGroups` with a warning to change the passwords): preview, download, copy. Import (file or paste) validates, lists unknown/invalid/clamped keys, shows the diff against the default, then applies. Other server keys (ports, userGroups, bans) are kept in memory only, never in `localStorage`.

## 9. Languages, layout, accessibility

- FR/EN (Transloco), chosen from the top bar. Layout of the left menu per device. Every screen must pass AXE and WCAG AA (AXE runs on each workshop tab in the e2e suite).
