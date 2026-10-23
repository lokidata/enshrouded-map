"""Chests, plants and ores for the map (used by build_data.py).

Resources are far too many for one marker each in map-data.json (tens of
thousands of plants), so they are grouped per element with compact point
lists:

  {category: [{"name": [fr, en], "raw": ..., "color": "#rrggbb",
               "pts": [x, z, y, x, z, y, ...], "sizes": [...] (ores only)}]}

  chest  LootChest_* templates, by chest type
  plant  harvestable plants and mushrooms, by the item they give
         (generic resources - wood, fibre, twigs, stone... - are left out)
  ore    ore deposits found in the terrain voxels (extract_ores.py) and the
         Ancients' mining containers

Chests holding a unique item or a collectible (special_loot) are left out of
the chests: those items get their own markers.
"""
import colorsys
import glob
import json
import os
import re

GUID = r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"

# Items given by plants that are worth a map entry (debug names), in the
# order used to name a plant that gives several of them.
PLANT_ITEMS = [
    "Food_T1_raw_fruit_Red_Berries", "Food_T1_raw_mushroom_Mushroom_brown",
    "Food_T2_raw_bad_mushroom_AzureRussula", "Food_T5_raw_bad_mushroom_YellowFogMushroom",
    "Food_T2_raw_grain_Hazelnut", "Food_T4_raw_fruit_YuccaFruit", "Food_T4_raw_fruit_Date",
    "Food_T5_raw_vegetables_Pumpkin", "Food_T6_raw_fruit_YellowBanana", "Food_T6_raw_bad_fruit_GreenBanana",
    "Food_T6_raw_hydration_CoconutWater", "Food_T7_raw_vegetable_Cabbage", "Food_T7_raw_fruit_Artichoke",
    "Material_T4_Aloe", "Material_T3_Straw", "Material_T7_LavaPlant_Magma_Gel",
    "Material_T6_Night_GleamRoot_under_water",
    "Material_T2_MushroomDrop_ShroudMush", "Material_T1_MushroomDrop_ShroudLiquid",
    "Material_T3_MushroomDrop_GreenMushroomMeat", "Material_T4_MushroomDrop_BrittleShroudFlakes",
    "Material_T5_MushroomDrop_FrozenShroudSolids", "Material_T6_MushroomDrop_PinkMushroomMeat",
    "Material_T1_FogTerrain_ActiveMycelium",
]
# Voxel ore material id -> item mined from it.
ORE_ITEMS = {
    6: "Material_T5_Coal", 7: "Material_T5_Obsidian", 17: "Material_T1_Salt", 18: "Material_T2_Amber",
    19: "Material_T1_Stone_Flint", 24: "Material_T5_Amethyst", 25: "Material_T2_Clay",
    26: "Material_T2_Ore_Copper", 27: "Material_T3_Ore_Tin", 29: "Material_T4_Ore_Iron",
    30: "Material_T4_Sulfur", 31: "Material_T4_Lapislazuli", 63: "Material_T5_Silver_Ore",
    89: "Material_T6_Gold_Ore", 90: "Build_TerrainMaterial_T6_Wetlands_Gold_Coins",
}
ORE_COLORS = {
    6: "#3b3631", 7: "#2a2340", 17: "#e8e2d8", 18: "#e09a2c", 19: "#8a8f86", 24: "#a070d8", 25: "#c07850",
    26: "#d4763c", 27: "#b8c4c8", 29: "#9a6a5a", 30: "#e6dc4a", 31: "#3f5fd0", 63: "#d8dee6",
    89: "#f2c14e", 90: "#ffd84a",
}
MINING_CONTAINER = re.compile(r"^Prop_Ancients_Container_Mining_")
MINING_CONTAINER_NAME = ("Conteneur minier des Anciens", "Ancients' mining container")
OTHER_ORE_COLORS = {"Material_T7_Archaic_Shards": "#c8a2ff", "mining container": "#6fd6c4"}

# Chest templates: (regex, [fr, en]); first match wins. Names of wooden and
# silver chests come from the game texts (loca ids).
CHEST_TYPES = [
    (r"(?i)sarcophag", ("Sarcophage", "Sarcophagus"), "#9b6cc8"),
    (r"(?i)gold", ("Coffre en or", "Golden Chest"), "#f2c14e"),
    (r"(?i)silver", 4193367922, "#cfd6de"),   # Silver Chest
    (r"(?i)wood", 725466433, "#b07a45"),      # Wooden Chest
]
chest_colors = {}  # chest names -> colour, filled by resource_templates
CHEST_EXCLUDE = re.compile(r"(?i)test|dummy|debug")

# Special loot (SceneRandomLootResource.specialItems): items the game puts in
# given containers. Item category -> map category; collectibles are also
# recognised by their debug name (paintings are building items).
UNIQUE_ITEM_CATEGORIES = {"Weapons", "Equipment", "Tools", "Instrument", "FishingRod", "WeaponGem", "Ammunition"}
COLLECTIBLE = re.compile(r"^Collection_")
# Common gear that is not worth a marker.
SPECIAL_LOOT_EXCLUDE = re.compile(r"^(Consumable_|Tool_Torch)|_Enemy_")


def item_table(src, locas):
    """ItemInfo guid -> (debug name, [names])."""
    from build_data import fnv_guid
    items = {}
    for p in glob.glob(f"{src}/ItemInfo/*.json"):
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        loca_id = fnv_guid(d["name"]) if d.get("name") else None
        items[d["$guid"]] = (d["debugName"], [loca.get(loca_id) for loca in locas])
    return items


def special_loot(src, scene, locas):
    """Unique items and collectibles placed in a given chest.

    Returns [(category, names, debug name, x, y, z)]. Only items with a single
    candidate container are kept: their position is exact (the others are
    random among many containers, and none of them is a unique item).
    """
    from build_data import fnv_guid
    infos = {}
    for p in glob.glob(f"{src}/ItemInfo/*.json"):
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        infos[fnv_guid(d["$guid"])] = d
    with open(glob.glob(f"{src}/SceneRandomLootResource/{scene}_*.json")[0], encoding="utf-8") as f:
        loot = json.load(f)
    out = []
    for s in loot["specialItems"]:
        info = infos.get(s["itemId"]["value"])
        if not info or len(s["lootContainerCandidates"]) != 1 or not info.get("name"):
            continue
        debug = info["debugName"]
        if info["category"] == "Collectibles" or COLLECTIBLE.match(debug):
            cat = "collectible"
        elif info["category"] in UNIQUE_ITEM_CATEGORIES and not SPECIAL_LOOT_EXCLUDE.search(debug):
            cat = "cosmetic" if debug.startswith("Vanity_") else "unique"
        else:
            continue
        loca_id = fnv_guid(info["name"])
        names = [loca.get(loca_id) for loca in locas]
        if not all(names):
            continue
        pos = s["lootContainerBoundingBox"]["min"]
        out.append((cat, names, debug, pos["x"], pos["y"], pos["z"]))
    print("special loot:", {c: sum(1 for o in out if o[0] == c) for c in ("unique", "cosmetic", "collectible")})
    return out


def collectible_templates(src, locas, texts, raws):
    """Collectibles lying in the world (LootPickup_Collections_* templates).

    Returns {template guid: marker template} as in build_data.main. Most of
    them are also special loot; build_data drops those duplicates.
    """
    items = item_table(src, locas)
    out = {}
    for guid, raw in raws.items():
        if not raw.startswith("LootPickup_Collections_"):
            continue
        for ref in re.findall(rf'"item": "({GUID})"', texts[guid]):
            debug, names = items.get(ref, ("", []))
            if COLLECTIBLE.match(debug) and names and all(names):
                out[guid] = {"raw": raw, "names": names, "cat": "collectible", "fastTravel": False}
                break
    print(f"{len(out)} collectible pickup templates")
    return out


def inventory_items(src):
    """DefaultInventoryResource guid -> item guids it can give."""
    out = {}
    for p in glob.glob(f"{src}/DefaultInventoryResource/*.json"):
        with open(p, encoding="utf-8") as f:
            text = f.read()
        out[os.path.basename(p)[:36]] = re.findall(rf'"itemRef": "({GUID})"', text)
    return out


def palette(n, s=0.55, v=0.95):
    """n distinct colours (golden angle hues)."""
    return ["#%02x%02x%02x" % tuple(int(c * 255) for c in colorsys.hsv_to_rgb((i * 0.618034) % 1, s, v))
            for i in range(n)]


def resource_templates(src, locas, texts, raws):
    """Template guid -> (category, names, raw) for chests, plants and mining containers."""
    from build_data import fnv_guid
    items = item_table(src, locas)
    by_debug = {debug: names for debug, names in items.values()}
    inventories = inventory_items(src)

    def drops(guid, depth=0):
        """Items a template gives: picked up, harvested (default inventory) or mined."""
        text = texts[guid]
        out = []
        for key, ref in re.findall(rf'"(item|itemRef|pickupItemReference|entity|defaultInventory)": "({GUID})"', text):
            if key in ("item", "itemRef") and ref in items:
                out.append(items[ref][0])
            elif key == "defaultInventory" and ref in inventories:
                out += [items[i][0] for i in inventories[ref] if i in items]
            elif key in ("pickupItemReference", "entity") and ref in texts and depth < 2:
                out += drops(ref, depth + 1)
        return out

    result = {}
    for guid, raw in raws.items():
        if raw.startswith("LootChest_") and not CHEST_EXCLUDE.search(raw):
            for rx, names, color in CHEST_TYPES:
                if re.search(rx, raw):
                    if isinstance(names, int):
                        names = [loca.get(names) for loca in locas]
                    names = list(names)
                    if "fog" in raw.lower():
                        names = [names[0] + " du Voile", "Shroud " + names[1]]
                    if "locked" in raw.lower():
                        names = [names[0] + " (verrouillé)", names[1] + " (locked)"]
                    result[guid] = ("chest", names, raw)
                    chest_colors[tuple(names)] = color
                    break
            continue
        if MINING_CONTAINER.match(raw):
            given = []
            for d in drops(guid):
                if d in by_debug and by_debug[d] not in given and by_debug[d][0]:
                    given.append(by_debug[d])
            if len(given) == 1:
                result[guid] = ("ore", given[0], raw)
            elif given:
                # mixed loot: one entry whatever the order of the drops
                given.sort(key=lambda n: n[0])
                names = [f"{MINING_CONTAINER_NAME[i]} : " + ", ".join(n[i] for n in given) for i in range(len(locas))]
                result[guid] = ("ore", names, raw)
            continue
        if "PickupItem" not in texts[guid] and "MiningNode" not in texts[guid] and "defaultInventory" not in texts[guid]:
            continue
        given = set(drops(guid))
        plant = next((d for d in PLANT_ITEMS if d in given), None)
        if plant and by_debug.get(plant) and all(by_debug[plant]):
            result[guid] = ("plant", by_debug[plant], raw)
    counts = {}
    for cat, _, _ in result.values():
        counts[cat] = counts.get(cat, 0) + 1
    print("resource templates:", counts)
    return result, by_debug


def build_resources(placed, templates, by_debug, export, locas, dungeon_areas, void, special=()):
    """Groups the placed resource templates (and voxel ore deposits) per element.

    void: north-up boolean grid over the world, True outside the island
    (points there are under the sea floor or out of reach).
    special: (x, z) of the special loot (special_loot); the chests there are skipped.
    """
    groups = {}
    cell = 10240 / void.shape[0]
    special_cells = {(round(x), round(z)) for x, z in special}
    skipped = 0

    def holds_special(x, z):
        rx, rz = round(x), round(z)
        return any((rx + dx, rz + dz) in special_cells for dx in (-1, 0, 1) for dz in (-1, 0, 1))

    def add(cat, names, raw, x, y, z, size=None):
        nonlocal skipped
        if cat == "chest" and holds_special(x, z):
            skipped += 1
            return
        if any(x0 <= x <= x1 and z0 <= z <= z1 for x0, z0, x1, z1 in dungeon_areas):
            return
        row, col = int((10240 - z) / cell), int(x / cell)
        if not (0 <= row < void.shape[0] and 0 <= col < void.shape[1]) or void[row, col]:
            return
        key = (cat, tuple(names))
        g = groups.setdefault(key, {"name": list(names), "raw": set(), "pts": [], "sizes": []})
        g["raw"].add(raw)
        g["pts"] += [round(x), round(z), round(y)]
        if size is not None:
            g["sizes"].append(size)

    seen = set()
    for guid, x, y, z in placed:
        cat, names, raw = templates[guid]
        k = (guid, round(x), round(z))
        if k not in seen:
            seen.add(k)
            add(cat, names, raw, x, y, z)

    ores_path = f"{export}/ores.json"
    if os.path.exists(ores_path):
        with open(ores_path, encoding="utf-8") as f:
            deposits = json.load(f)
        for d in deposits:
            names = by_debug.get(ORE_ITEMS.get(d["material"]))
            if names and all(names):
                add("ore", names, f"voxel material {d['material']}", d["x"], d["y"], d["z"], d["voxels"])

    out = {}
    for (cat, _), g in sorted(groups.items(), key=lambda kv: (kv[0][0], -len(kv[1]["pts"]))):
        item = {"name": g["name"], "raw": ", ".join(sorted(g["raw"]))[:200], "pts": g["pts"]}
        if g["sizes"] and len(g["sizes"]) * 3 == len(g["pts"]):
            item["sizes"] = g["sizes"]
        out.setdefault(cat, []).append(item)

    # Colours: ores from their material, chests per type, plants spread over the hue wheel.
    ore_color_by_name = {tuple(by_debug[v]): ORE_COLORS[k] for k, v in ORE_ITEMS.items() if by_debug.get(v)}
    for cat, entries in out.items():
        colors = palette(len(entries))
        for i, item in enumerate(entries):
            if cat == "ore":
                item["color"] = ore_color_by_name.get(tuple(item["name"]))
                if not item["color"]:
                    container = item["name"][0].startswith(MINING_CONTAINER_NAME[0])
                    item["color"] = OTHER_ORE_COLORS["mining container" if container else "Material_T7_Archaic_Shards"]
            elif cat == "chest":
                item["color"] = chest_colors.get(tuple(item["name"]), "#b07a45")
            else:
                item["color"] = colors[i]
    print(f"{skipped} chests holding special loot left out")
    for cat, entries in out.items():
        print(f"{cat}: {len(entries)} elements, {sum(len(e['pts']) // 3 for e in entries)} points")
    return out
