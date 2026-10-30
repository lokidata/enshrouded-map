# Map data pipeline

These scripts turn your own Enshrouded install into the files the map serves
from `artifacts/map/`: the satellite tiles, the marker data and the icons. The
game's data is not in this repository, and the app never reads the game: run
the pipeline offline, then copy its output to the server.

Reading the game files relies on
[kfc-parser](https://github.com/Brabb3l/kfc-parser) by Brabb3l
(<https://github.com/Brabb3l/kfc-parser>): its `kfc-parser` unpacks the
resources and its mod loader `emm` runs the export mod in `eml_mod/`.

```
game install ──kfc-parser unpack──▶ unpacked/   (resource descriptors, JSON)
             ──emm + eml_mod───────▶ export/     (texts, textures, voxels, pictures)
                                       │
         extract_*.py ─────────────────┤ export/surface5.npz, ores.json, props.npz, water.png
                                       ▼
         render_map.py ─────────────▶ artifacts/map/tiles/
         build_data.py ─────────────▶ artifacts/map/map-data.json, resources.json,
                                      biomes.png, icons/, items/
```

## Requirements

- Enshrouded installed (the folder holding `enshrouded.kfc` and the
  `enshrouded._XXX.dat` files), for instance
  `C:\Program Files (x86)\Steam\steamapps\common\Enshrouded`.
- **kfc-parser**, from <https://github.com/Brabb3l/kfc-parser> (a third-party
  project by Brabb3l, not part of this repository), built from source. It
  provides `kfc-parser` (unpacks the game resources) and `emm` (the mod loader
  that runs `eml_mod/`). It needs Rust and, on Windows, the MSVC build tools:
  ```sh
  git clone https://github.com/Brabb3l/kfc-parser
  cd kfc-parser && cargo build --release      # -> target/release/kfc-parser, emm
  ```
- Python 3.12+ with `numpy` and `Pillow` (`pip install numpy pillow`).
- About 12 GB free: `unpacked/` is ~5 GB (92,000 files), `export/` ~1.5 GB.

The examples below use these names; keep `unpacked/` and `export/` outside the
repository (they hold game data):

| Name   | Example                                        |
| ------ | ---------------------------------------------- |
| `GAME` | the Enshrouded install folder                  |
| `WORK` | a scratch folder, e.g. `D:/enshrouded_extract` |
| `REPO` | this repository                                |

## 1. Unpack the game resources

```sh
kfc-parser unpack -g "$GAME" -o "$WORK/unpacked/all"
```

Writes one JSON file per resource, sorted by type
(`TemplateResource/`, `ItemInfo/`, `SceneResource/`...). Every later step reads
`$WORK/unpacked/all`.

## 2. Export texts, textures, voxels and pictures (mod)

`kfc-parser unpack` only gives the descriptors; the binary content (texts,
textures, terrain voxels) is read by the Lua mod in `eml_mod/`, run by `emm`.

1. Copy the mod into the game's `mods` folder:
   `$REPO/pipeline/eml_mod` → `$GAME/mods/map_export` (keep `mod.json` and
   `src/mod.lua`).
2. Choose what to export in the `args` table at the end of
   `$GAME/mods/map_export/src/mod.lua`. For a full run, set everything to
   `true`:
   ```lua
   local args = { translations = true, icons = true, map = true, voxels = true, items = true }
   ```
3. Run the export:
   ```sh
   emm run -g "$GAME" --export --export-directory "$WORK/export"
   ```
   `--export` only lets the mod write files: it does not patch or start the
   game.

| `args` key     | Output in `$WORK/export/`             | Used by                                               |
| -------------- | ------------------------------------- | ----------------------------------------------------- |
| `translations` | `loca/Fr_Fr.tsv`, `loca/En_Us.tsv`    | build_data.py (all names)                             |
| `icons`        | `icons/<guid>.png`, `icons/index.tsv` | build_data.py (marker icons)                          |
| `map`          | `map/*.png`, `map/*.r16`              | render_map.py, build_data.py (Shroud, island outline) |
| `voxels`       | `voxels/5/<x>_<y>.bin` (1 m terrain)  | extract_surface.py, extract_ores.py                   |
| `items`        | `items/<guid>.png` (256 px)           | build_data.py (item pictures in popups)               |

## 3. Extract the terrain

```sh
cd "$REPO/pipeline"
python extract_surface.py "$WORK/unpacked/all" "$WORK/export" 5 "$WORK/export/surface5.npz"
python extract_ores.py    "$WORK/export" 5 "$WORK/export/ores.json"
python extract_props.py   "$WORK/unpacked/all" "$WORK/export" "$WORK/export/props.npz"
python extract_water.py   "$WORK/unpacked/all" "$WORK/export/water.png"
```

- `extract_surface.py`: height and material of the top voxel of every 1 m
  column, plus the material colours (`voxels.py` decodes the voxel format).
- `extract_ores.py`: ore deposits (copper, iron, sulfur...) found in the
  voxels.
- `extract_props.py`: trees, bushes and rocks drawn on the map.
- `extract_water.py`: the water mask.

`extract_surface.py` and `extract_ores.py` decode the whole world on every
CPU core: they are the slow steps.

## 4. Render the map tiles

```sh
python render_map.py "$WORK/export" "$REPO/artifacts/map"
```

Writes the Leaflet tile pyramid `artifacts/map/tiles/{z}/{x}_{y}.jpg` (z = 0
is 1 px per metre). To try a change of the map look quickly, add `--preview`:
it writes only `preview.png`, the whole island at 1/8 of the resolution, and
no tiles.

## 5. Build the markers and resources

```sh
python build_data.py "$WORK/unpacked/all" "$WORK/export" "$REPO/artifacts/map"
```

Writes, in `artifacts/map/`:

| File             | Content                                                                                     |
| ---------------- | ------------------------------------------------------------------------------------------- |
| `map-data.json`  | categories, markers (with the guaranteed loot of each one), biomes, item names and pictures |
| `resources.json` | chests, plants and ores, grouped per element (loaded after the first render)                |
| `craft.json`     | recipes, Flame Altar levels, building pieces, stations, how each one unlocks                |
| `biomes.png`     | biome layer                                                                                 |
| `icons/`         | category icons (game icons and the SVGs written by the script)                              |
| `items/`         | pictures of the items shown in the popups (64 px)                                           |

It prints counts at the end; compare them with the previous run to spot a
change in the game data. Current reference: 1215 markers (74 unique items,
105 cosmetics, 107 collectibles), 2579 chests, 6632 ores, 76,742 plants,
1198 recipes, 1324 building pieces, 14 altar levels, 2881 item
pictures.

`build_resources.py` (chests, plants, ores, special loot) and `build_craft.py`
(recipes, altar, building; its docstring describes `craft.json`) are used by
`build_data.py` and are not run on their own.

## 6. Publish

Copy `artifacts/map/` to the server (the folder mounted as `ARTIFACTS_DIR`,
read-only, see [`deploy/`](../deploy)). No restart is needed:
`map-data.json` and `resources.json` are revalidated on every load, the tiles,
icons and pictures are cached for a day.

Progress marks are stored as `category:x:z`. They stay valid across runs as
long as an element does not move or change category.

## Which steps to run again

| Change                                                                                | Steps                    |
| ------------------------------------------------------------------------------------- | ------------------------ |
| Game update                                                                           | all of them (1 to 6)     |
| Marker, loot or craft logic (`build_data.py`, `build_resources.py`, `build_craft.py`) | 5 and 6                  |
| Map look (`render_map.py`)                                                            | 4 and 6                  |
| Terrain extraction (`extract_*.py`, `voxels.py`)                                      | 3, 4, 5 and 6            |
| New mod export (`eml_mod/`)                                                           | 2, then whatever uses it |

## Troubleshooting

- **A script imports the wrong module** (for instance a file of yours named
  `types.py` or `inspect.py` next to it): run Python with `-P`
  (`python -P build_data.py ...`) so the current folder is not on the import
  path.
- **`emm` panics while decoding a texture**: the block decoder of the mod
  loader fails on pictures whose size is not a multiple of 4. `export_item_icons`
  already decodes whole 4×4 blocks; do the same in any new texture export.
- **Missing translations or icons**: check that the matching `args` key was
  `true` during step 2 and that `$WORK/export` is the folder passed to the
  later steps.
