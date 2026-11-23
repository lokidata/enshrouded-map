# Save file format (`.ksd`): technical findings

Reverse-engineered on 2026-11-09 (client save) and 2026-11-17 (server world save) from one real `character3.ksd` and one real `world0.ksd`, to build the save import (issue #40; behaviour in RULES section 10, code in `frontend/src/app/save-import/`). The game's code was not disassembled for these notes: every rule below was measured on those two files and checked against the game data. What was confirmed in game is marked as such; the rest is a finding to re-check.

## What the save contains (measured)

Container `SV2C` (same for client and server files): header, a table of named sections, each an `S2BH` block, zstd-compressed or stored, with an XXH3 low32 per section.

| File | Sections |
|---|---|
| `character3.ksd` (client, 84 KB) | `character_data`, `player_character`, `voiceover`, `player_knowledge`, `fogofwar` |
| `world0.ksd` (server, 746 KB) | `world_metadata`, `base00..05`, `entity_chunk00`, `snapping`, `miscellaneous`, `world_knowledge`, `custom_strings`, `weather`, `logic`, `chunk_persistent_data`, `known_users` |

The server keeps **no character** (no level, skills or inventory): `world_knowledge` is what the world as a whole discovered, so it cannot give one player's progress. Only the client file is in scope.

### `player_knowledge`

Layout (verified, the section length matches exactly): `[u32 version = 1][u32 n][n x u32 id][n x u32 flags]`. The server's `world_knowledge` has the same layout with version 10.

**Id = FNV-1a 32 bits of the 16 bytes of the object's GUID, in little-endian field order** (`uuid.bytes_le`; `fnv_guid` in `pipeline/build_data.py` is the same function). Found by the reverse-engineering agent from the game data (`GameKnowledgeResource`, 10,690 ids); the code that writes the ids in the exe was not disassembled. On `character3.ksd` 2,829 of 2,830 ids are explained.

| Kind in the save | Count | Maps to our data |
|---|---|---|
| recipe | 972 | 389 craft.json **recipes** + 579 **blocks** (same `recipe:<guid>` mark); 4 are Flame Altar unlocks, which we do not model |
| quest | 88 | the knowledge id **is** the quest `id` of `lore.json` (checked: 88 of its 186 ids are in the list) |
| lore_page | 151 | note id + page rank; all 151 note ids exist in `lore.json` (the page index base, 0 or 1, is not checked) |
| item | 710 | `craft.json` items (441 of ours found); flags Pickup 1 / Use 2 / Inspect 4 (deduced) |
| scene_entity | 265 | discovered places (`8kMapLabel_*`), wells, towers, chests, with x/z in metres: not matched to our markers yet |
| dialog, quest steps, flags, derived | ~600 | not used |

Flags: for recipes the values seen are 1 (760), 3 (205), 2 (7); the likely meaning is 1 = inspected, 2 = crafted (not read in the code). Quests, pages, places: 1 = true.

### `fogofwar`

13-byte header (contains `FGOW`, version 2) then a **1280 x 1280 grid of bytes** (0 = unseen, 255 = seen, soft edges in between), 8 m per cell over the 10,240 m world. It has the same orientation as `overview.jpg` (drawn over it, the explored trail follows the coast of the island; checked by eye on one save only).

## `base00..05` (server `world0.ksd`): Flame Altar spots and levels

Checked on one world save (2026-11-17), the user confirmed in game: 1 altar of level 4 and 4 of level 1, positions correct.

Each `base` section starts with `[16 bytes GUID][min x,y,z: 3 x u32][max x,y,z: 3 x u32][...]`, then a large block of voxel data (not decoded; the `6` after the boxes is not understood). The unit is half a metre: **metres = value / 2**. y is the height, as in `map-data.json`.

- Centre (m) = (min + max) / 4 on x and z; height = (min y + max y) / 4.
- Side of the build area (m) = (max - min) / 2: 40, 80, 120, 160 m = altar level 1, 2, 3, 4. Only levels 1 and 4 were seen: 2 and 3 follow from the sizes the user gave, not from a save.
- The altar object itself was not found (the entity section is not decoded), so whether the box is exactly centred on it is unknown.
- 5 of the 6 slots were used in this save; the section is in the server file only.
- **Implemented 2026-11-18** (`frontend/src/app/save-import/altars.ts`, shown in the same import dialog; RULES section 10): the parser reads only the 40 bytes of header of `base00`..`base05`, refuses what is not a clean altar box (not a square, a side that is not a whole level of 80 half metres, outside 0..10,240 m, an upside-down height, a base outside the 16 slots (limit raised from 6 on 2026-11-19: a world holds up to 16 altars; the real save only had base00..05, so the names base10..base15 are assumed decimal)) and counts it, and refuses a file with more than 16 bases. Run on the real save above it gives the 5 altars of the notes (centres rounded to the metre: 3194/2018 level 4, 5838/2020, 6974/2826, 5867/3834, 3299/3642 level 1). The unit tests use a synthetic container, never the real save.
- The dialog recognises a world save by its sections (`base<nn>` and no `player_knowledge`).


## Unverified points

Nothing below was confirmed in game; re-check before relying on it.

- Recipe flags: values seen are 1 (760), 3 (205), 2 (7); the guess is 1 = inspected, 2 = crafted. The import treats any non-zero flag as known, which may over- or under-count.
- Lore pages: the page index base (0 or 1) is not checked (test with a note that has 2 of 4 pages collected).
- Quests: the meaning of "done" for a quest id is assumed (flag 1 = true).
- Fog: the alignment with `overview.jpg` was checked by eye on one save only.
- The id rule (FNV-1a of the GUID) comes from game data (`GameKnowledgeResource`), not from the code that writes the ids in the exe. A game update could change it: unknown ids must be reported, never fail the import.
- One save of each kind was examined; other players' saves (older versions, other builds, `character0..3.ksd`) may differ.
- Never commit a real save: the unit tests use synthetic containers (a tiny zstd-stored save built in the test).
