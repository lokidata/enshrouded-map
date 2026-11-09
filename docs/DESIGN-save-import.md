# Design proposal: import progress from a local savegame (issue #40)

Status: proposal, nothing implemented. Written 2026-11-09 from one real client save (`character3.ksd`) and one real server world save (`world0.ksd`). Nothing here has been checked inside the game yet (see "How to verify").

## Goal

Let a player load their own `character*.ksd` and tick, in one step, what the game already knows about them: known recipes, finished quests, collected lore pages, and the explored area of the map. No extra `.exe`, no upload: the file is read in the browser.

Non-goals: writing or editing saves, reading the dedicated server's world save, and any automatic marking of map markers from "seen" data (seen is not done).

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

## Proposal

### Phase 1: knowledge import (recipes, quests, lore pages)

1. **Pipeline** (Windows PC): `build_craft.py` and `build_lore.py` write the knowledge id next to each entry (`kid`, the FNV-1a of the recipe/block GUID; the quest and note ids already are ids; lore pages get `kid` from `GameKnowledgeResource`). The browser does not hash GUIDs itself: this keeps the mapping tied to the same game version as the data, and avoids my check finding only 389 of the 972 known recipes when matching on `craft.json` recipe ids alone (the others are blocks).
2. **Frontend** `frontend/src/app/save-import/`:
   - `ksd.ts` (pure, unit-tested): read the header and section table, validate, decompress, return sections. Limits: file at most 50 MB, at most 64 sections, every offset and size checked against the file before use, decompressed size capped (64 MB) before allocating. Unknown container or knowledge version: refuse with a clear message (no guessing).
   - `knowledge.ts` (pure): parse `[version][n][ids][flags]`, require `8 + 8n = length`, version 1 only, `n` capped.
   - `save-import.logic.ts` (pure): ids -> proposed marks (`recipe:<guid>`, `quest:<id>`, `lore:<note>:<page>`), counts by kind, number of unknown ids, and the diff against the current marks.
   - zstd: the browser's `DecompressionStream` does not support zstd, so add one small pure-JS dependency (for example `fzstd`, MIT, no WASM so the strict CSP is untouched), pinned, covered by `npm audit` and Dependabot. The XXH3 section check is optional: the length checks are enough to reject truncated files.
   - UI: profile menu > "Import from a save" (file picker or drop). A preview dialog shows the file name, size and date, counts per category (new / already marked), a checkbox per category, and **Apply**. No name or level is shown: they are not decoded.
3. **Applying**: additive only (it never unticks anything), through the existing `PUT /progress` with the marks in batches, so no backend change. Check that an import fits under `max_marks`.
4. **Privacy**: the file never leaves the browser; nothing is stored apart from the marks.

Do not auto-tick map markers from item knowledge: picking up an item elsewhere does not mean the marker was done. The existing recipe/marker sync (`Found`) keeps working on the recipe marks that are imported.

### Phase 2: explored area layer

Decode `fogofwar` into a canvas, show it as a toggleable overlay (Leaflet image overlay on the 10,240 m bounds, same orientation as the overview), and keep it only in the browser (about 80 KB as a PNG; IndexedDB or `localStorage` with a try/catch). Optional filter "only places inside the explored area". Never shared with the team by default; a server-side copy per player could come later.

### Phase 3: places and wells (needs more work)

Match the `scene_entity` x/z to our markers (wells, towers, discovered places) and propose them in the same preview. Not before checking the match on real data.

## How to verify (not possible yet)

Nothing was tested in the game. Before trusting phase 1, with a save and the game side by side:
1. Known recipes: the game's count of known recipes against the import's recipe + block count; try a recipe that is only inspected, and one that is crafted, to see which flags count as "known" (proposal: any non-zero flag).
2. Finished quests: compare the 88 quests of `character3.ksd` with the journal.
3. Lore pages: check one note with 2 of 4 pages collected, to settle the page index base.
4. Fog: compare a few cells with the in-game map.
5. Re-import after a game update, to see how unknown ids are reported.

## Risks and open points

- The id rule comes from game data, not from disassembled code; a game update could change how ids are made. The import must report unknown ids and never fail on them.
- The recipe flag meaning is a guess; "known = non-zero" may over- or under-count.
- Page index base and the quest "done" meaning are unchecked.
- A save may hold several characters (`character0..3.ksd`): the player picks the file, and the file name is the only label.
- One save was examined; other players' saves (older versions, other builds) may differ.
- Contributor code in the issue (Nick-Beat) and the editor it builds on: reuse only what is read-only; the editor's source is MIT but its decoder is written for editing, so the parser here is written from the format notes above and tested with synthetic saves (a tiny zstd-stored save built in the test), never with a real player's save committed to the repository.
