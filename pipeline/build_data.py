"""Builds the marker data for the interactive map.

Usage: python build_data.py <unpacked_dir> <export_dir> <out_dir>

  unpacked_dir  output of `kfc-parser unpack` (resource descriptors as JSON)
  export_dir    output of the eml mod in eml_mod/ (translations, icons)

Produces in out_dir:
  map-data.json   map markers, categories, biomes
  resources.json  chests, plants, ores (loaded on demand)
  biomes.png    biome map (optional background layer)
  icons/        map marker icons used by the markers
"""
import collections
import glob
import json
import math
import os
import re
import shutil
import struct
import sys
import uuid
import zlib

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import render_map  # noqa: E402  (FogZone tiles and void mask)
import build_resources  # noqa: E402  (chests, plants, ores)

MAIN_SCENE = "509feadb-4c60-425f-9c7c-deeefd9b6920"
LANGUAGES = ("Fr_Fr", "En_Us")

# Marker type GUID -> (category id, kind). "icon" markers use the game's icon
# from the marker registry, "label" markers are map texts (place names).
CATEGORIES = {
    "fe05bfcd-bd2b-4761-923f-a00e5abd2579": ("enemyCamp", "icon"),
    "8e313547-131a-46fe-b430-c8d028d52573": ("landmark", "icon"),
    "c85fd053-92c1-4827-9aff-d8f0dfe73977": ("camp", "icon"),
    "8cc3aae1-5041-462d-a03d-bb81cef9c611": ("elixirWell", "icon"),
    "fa92b5da-6559-45d5-a7c0-66e3b5d5a90a": ("farm", "icon"),
    "f6889e13-fe04-4a7f-99d2-b02195d7e888": ("dungeon", "icon"),
    "188d04bd-6710-4fea-b38c-34f0dc42eed6": ("dungeonEntrance", "icon"),
    "d486f2ce-66a3-4ef4-86a4-bf2ea9a24373": ("flameShrine", "icon"),
    "9bdc9998-a8a4-4ede-979d-9a815e106df0": ("mine", "icon"),
    "cbe63957-cac4-48be-a127-8137ff2a9c0e": ("shroudRoot", "icon"),
    "2db08430-3cb3-4962-bda4-ac6d2e57654b": ("gemForge", "icon"),
    "643190e1-b5cf-44a2-8001-7508ea877847": ("obelisk", "icon"),
    "a9ea4318-7cbc-4804-ad6c-7d7a6e229be5": ("cave", "icon"),
    # cf788a1f-0f2a-464d-903d-51eca6186ee2: Ancient towers ("Tour des Anciens"), left out on purpose
    "2bad3206-cad7-469a-a358-64ea99181416": ("fastTravel", "icon"),
    "5ebdad4b-08b6-4578-8d63-fe9917449eaf": ("fastTravel", "icon"),
    "aee9062f-4642-438e-a743-1cb156b5673a": ("nightTemple", "icon"),
    "073adc32-ceee-488a-9321-1d69c78418bb": ("balefire", "icon"),
    "8d041ba5-4af7-46c4-b76b-3751c8d5a4d8": ("bigDungeon", "icon"),
    "593043e8-6667-4f5e-94e0-52f6e2807956": ("hiddenGrave", "icon"),
    "65ac1a61-2153-4d55-9fcf-a9994f35c2a7": ("flameAltar", "icon"),
    "fffa09d9-623a-4daa-b202-c7b35bfb178b": ("poi", "icon"),
    "58c32c26-6267-4b3f-b412-01a94f40184a": ("areaName", "label"),
    "0d43c5d0-1d2c-41f0-9be1-fb214f013a82": ("areaName", "label"),  # districts and named spots
    # Biome entries ("Passage to ...") and a few area names: place names, the
    # region labels themselves are generated from the biome map.
    "61342e2e-823a-4f16-82fc-0e196487b775": ("areaName", "label"),
}

# Biome -> how to find its region name: the quest category of the biome in
# the UI bundle, or the English name for the biomes without one.
REGION_SOURCES = {
    "Grassland": "questCategoryCompletedGrassland",
    "Deepforest": "questCategoryCompletedDeepforest",
    "Steppes": "questCategoryCompletedSteppes",
    "Desert": "questCategoryCompletedDesert",
    "ColdHeights": "questCategoryCompletedColdheights",
    "Wetland": "questCategoryCompletedWetlands",
    "TallTrees": "=Blackmire",
    "AncientLand": "=Cinder's Cradle",
}

CATEGORY_LABELS = {
    "enemyCamp": ("Camp ennemi", "Enemy camp"),
    "landmark": ("Lieu notable", "Landmark"),
    "camp": ("Camp de survivants", "Survivor camp"),
    "elixirWell": ("Puits d'élixir", "Elixir well"),
    "farm": ("Ferme", "Farm"),
    "dungeon": ("Donjons et temples", "Dungeons and temples"),
    "dungeonEntrance": ("Cryptes des Anciens et tombeaux", "Ancient crypts and tombs"),
    "flameShrine": ("Sanctuaire de la Flamme", "Flame shrine"),
    "mine": ("Mine", "Mine"),
    "shroudRoot": ("Racine du Voile", "Shroud root"),
    "gemForge": ("Forge à gemmes", "Gem forge"),
    "obelisk": ("Obélisque ancien", "Ancient obelisk"),
    "cave": ("Grotte", "Cave"),
    "fastTravel": ("Point de voyage rapide", "Fast travel point"),
    "nightTemple": ("Sanctuaire nocturne", "Night shrine"),
    "balefire": ("Garnison du Feu de joie", "Balefire garrison"),
    "bigDungeon": ("Salles creuses", "Hollow Halls"),
    "hiddenGrave": ("Tombe cachée", "Hidden grave"),
    "flameAltar": ("Autel de la Flamme", "Flame altar"),
    "poi": ("Lieu d'intérêt", "Point of interest"),
    "areaName": ("Nom de lieu", "Place name"),
    "region": ("Région", "Region"),
    "boss": ("Boss", "Boss"),
    "elite": ("Élite", "Elite"),
    "summon": ("Pierre d'invocation", "Summoning stone"),
    "chest": ("Coffre", "Chest"),
    "unique": ("Objet unique", "Unique item"),
    "cosmetic": ("Cosmétique", "Cosmetic"),
    "collectible": ("Objet de collection", "Collectible"),
    "plant": ("Plante", "Plant"),
    "ore": ("Minerai", "Ore"),
    "start": ("Point de départ", "Starting point"),
}
# Resource category -> game icon (debug name) shown in the menu; the map draws dots.
RESOURCE_CATEGORIES = {"chest": "icon_chest", "plant": "icon_plants", "ore": "icon_ore"}
# Hidden until checked: thousands of points each.
CRYPT_NAME = re.compile(r"^Crypte des Anciens")
# Markers of a single item (special loot), see build_resources.special_loot.
LOOT_MARKER_CATEGORIES = ("unique", "cosmetic", "collectible")
HIDDEN_BY_DEFAULT = {"chest", "plant", "ore", "unique", "cosmetic", "collectible"}

# Categories that do not come from map markers: category -> icon (game icon
# debug name, or an svg written by this script).
EXTRA_CATEGORIES = {"start": "mapmarker_spawn_flame_altar", "boss": "boss.svg", "elite": "elite.svg",
                    "summon": "summon.svg", "unique": "unique.svg", "cosmetic": "cosmetic.svg",
                    "collectible": "collectible.svg"}
# Technical suffixes of enemy template names (see enemy_key).
ENEMY_SUFFIX = re.compile(r"bosshealthbar|bosshealtbar|healthbar|hookpte|hook|summonstone|ag2|elite|deprecated|"
                          r"dungeon\d*|\d+|trap|nomovement|variant|caster")
# Elites without a named variant: enemy key -> loca id of their name.
ELITE_NAMES = {
    "heavycyclopsfogger": 589119890,    # Fell Cyclops
    "heavycyclopsnatural": 2070863872,  # Cyclops
    "fogcritterqueent2": 907771151,     # Fell Critter Queen
    "fogcritterqueent4": 274119482,     # Fell Crimson Critter Queen (the red, exploding critters one)
    "foggerbansheehover": 1518244296,   # Fell Banshee (summoning stones)
}
# Big enemies placed at fixed spots without the Boss component: template ->
# loca id, or (fr, en) when the game has no name for them.
EXTRA_ELITES = {
    "Enemy_Fog_CritterQueen_T2_NO_SPECIAL_CRITTERS": 907771151,   # Fell Critter Queen
    "Enemy_Fog_CritterQueen_T3_FlyingCritters": 907771151,
    "Enemy_Fog_CritterQueen_T4_ExplosiveCritters": 274119482,     # Fell Crimson Critter Queen
    "Enemy_Fog_Predator": 1102902815,                             # Shroud Stalker
    "Enemy_Wildbeast_Fog_Mushroom_Heavy_Big": ("Champignon géant du Voile", "Giant Shroud Mushroom"),
    "Enemy_Vukah_Ranger_Elite_Hive_Tyrant": ("Tyran de ruche vukah", "Vukah Hive Tyrant"),
}
SUMMON_STONE = re.compile(r"^Prop_Enemy_SummonStone_T\d(?!.*(?i:test))")
START_SPAWN_TEMPLATE = "Base_Spawnpoints_Player"
# Templates referencing a boss without being the boss fight itself.
BOSS_SPAWNER_EXCLUDE = re.compile(r"(?i)signalreceiver|_adds|artillery|groundbreak|trophy|^prop_|^lore|^attack_|^base_|"
                                  r"scattering")  # scattering = random spawns over an area
SKULL = """<path d="M32 14c-9 0-15 6-15 14 0 5 2 8 5 10v6h20v-6c3-2 5-5 5-10 0-8-6-14-15-14z" fill="#f1e6d0"/>
<circle cx="26" cy="29" r="4" fill="{bg}"/><circle cx="38" cy="29" r="4" fill="{bg}"/>
<path d="M30 37h4l-2-4z" fill="{bg}"/>
<path d="M27 44v4M32 44v4M37 44v4" stroke="{bg}" stroke-width="2"/>"""
ICON_SVGS = {
    # boss: skull on a dark red diamond with a gold border
    "boss.svg": f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<path d="M32 2 L62 32 L32 62 L2 32 Z" fill="#3a0d12" stroke="#d8b25a" stroke-width="3"/>
{SKULL.format(bg="#3a0d12")}
</svg>
""",
    # elite: horned skull on a dark grey diamond with a silver border
    "elite.svg": f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<path d="M32 2 L62 32 L32 62 L2 32 Z" fill="#26282c" stroke="#b9c0c8" stroke-width="3"/>
<path d="M19 22c-4-3-5-7-4-11 3 4 6 6 9 7zM45 22c4-3 5-7 4-11-3 4-6 6-9 7z" fill="#b9c0c8"/>
{SKULL.format(bg="#26282c")}
</svg>
""",
    # summoning stone: glowing purple standing stone
    "summon.svg": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<path d="M32 2 L62 32 L32 62 L2 32 Z" fill="#2a1638" stroke="#c79cf0" stroke-width="3"/>
<path d="M24 48 L22 22 L32 12 L42 22 L40 48 Z" fill="#6c5a78" stroke="#1a0f22" stroke-width="2"/>
<path d="M32 20 L36 28 L32 36 L28 28 Z" fill="#e2b8ff"/>
<path d="M30 40h4" stroke="#e2b8ff" stroke-width="2"/>
</svg>
""",
    # unique item: gold star on a dark orange diamond
    "unique.svg": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<path d="M32 2 L62 32 L32 62 L2 32 Z" fill="#3d2108" stroke="#f0a43a" stroke-width="3"/>
<path d="M32 14 L37 27 L51 27 L40 36 L44 50 L32 42 L20 50 L24 36 L13 27 L27 27 Z" fill="#ffd36b" stroke="#7a4310" stroke-width="2"/>
</svg>
""",
    # cosmetic: violet hanger on a dark violet diamond
    "cosmetic.svg": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<path d="M32 2 L62 32 L32 62 L2 32 Z" fill="#26103d" stroke="#b36cf0" stroke-width="3"/>
<path d="M32 20 a4 4 0 1 1 4 4 v3 L50 40 q3 4 -2 4 H16 q-5 0 -2 -4 L28 27 v-4" fill="#d9a8ff" stroke="#4a1f78" stroke-width="2" stroke-linejoin="round"/>
</svg>
""",
    # collectible: ammonite fossil on a dark teal diamond
    "collectible.svg": """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<path d="M32 2 L62 32 L32 62 L2 32 Z" fill="#0f2e2c" stroke="#5fd0c0" stroke-width="3"/>
<circle cx="32" cy="32" r="15" fill="#d9c9a3" stroke="#3b2f1c" stroke-width="2"/>
<path d="M32 32 m0 -3 a3 3 0 1 1 -3 3 a6 6 0 1 1 6 6 a9 9 0 1 1 -9 -9 a12 12 0 1 1 12 12" fill="none" stroke="#3b2f1c" stroke-width="2"/>
</svg>
""",
}

# Player-built or test markers, not part of the world.
IGNORED_TEMPLATE_HINTS = ("_PLAYER", "Home_Base", "test", "TEST", "_OLD", "Tombstone", "placeholder")

BIOME_COLORS = {
    "Grassland": (122, 156, 84),
    "Deepforest": (58, 102, 66),
    "TallTrees": (44, 84, 72),
    "Steppes": (176, 160, 104),
    "Wetland": (92, 108, 88),
    "ColdHeights": (190, 202, 212),
    "Desert": (214, 184, 128),
    "AncientLand": (150, 120, 160),
}
BIOME_LABELS = {
    "Grassland": ("Prairies", "Grassland"), "Deepforest": ("Forêt profonde", "Deep forest"),
    "TallTrees": ("Grands arbres", "Tall trees"), "Steppes": ("Steppes", "Steppes"),
    "Wetland": ("Marais", "Wetlands"), "ColdHeights": ("Hauteurs gelées", "Cold heights"),
    "Desert": ("Désert", "Desert"), "AncientLand": ("Terres anciennes", "Ancient lands"),
}

TAG_RE = re.compile(r"<[^>]*>")


def fnv_guid(g):
    """keen hash of a GUID: FNV-1a over its 16 bytes (little-endian layout)."""
    h = 0x811C9DC5
    for b in uuid.UUID(g).bytes_le:
        h = ((h ^ b) * 0x1000193) & 0xFFFFFFFF
    return h


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_loca(path):
    unescape = {"\\\\": "\\", "\\t": "\t", "\\r": "", "\\n": " "}
    loca = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            key, _, text = line.rstrip("\n").partition("\t")
            text = re.sub(r"\\[\\trn]", lambda m: unescape[m.group(0)], text)
            loca[int(key)] = " ".join(TAG_RE.sub("", text).split())
    return loca


def pretty_name(name):
    for prefix in ("8kMapLabel_", "8KMapLabel_", "MapLabel_", "MapMarker_", "HintMarker_"):
        if name.startswith(prefix):
            name = name[len(prefix):]
            break
    return name.replace("_", " ")


def write_png(path, width, height, rgb_rows):
    raw = b"".join(b"\x00" + row for row in rgb_rows)
    def chunk(tag, data):
        c = tag + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)
    png = b"\x89PNG\r\n\x1a\n"
    png += chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9))
    png += chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


def enemy_key(name):
    """Enemy template name without technical suffixes, to match variants."""
    tokens = re.sub(r"^(Base_)?Enemy_", "", name).lower().replace("foger", "fogger").split("_")
    # joined without separators: names mix "HeavyMage" and "Heavy_Mage"
    return "".join(t for t in tokens if not ENEMY_SUFFIX.fullmatch(t))


def load_templates(src):
    """Template guid -> JSON text, for all TemplateResource files."""
    texts = {}
    for p in glob.glob(f"{src}/TemplateResource/*.json"):
        with open(p, encoding="utf-8") as f:
            texts[os.path.basename(p)[:36]] = f.read()
    return texts


def boss_templates(src, locas, all_texts):
    """Templates whose placement means a boss or an elite: the enemies and their spawners.

    Enemies with the keen::ecs::Boss component are bosses when they have a
    displayName (the named boss fights), elites otherwise (generic heavy
    enemies). Elites take the name of the named variant of the same enemy, or
    ELITE_NAMES. Spawners reference the enemy template (possibly through an
    intermediate template), so references are followed transitively; a
    spawner referencing both kinds counts as a boss.
    """
    texts = all_texts
    named = {}       # enemy key -> names, any enemy with a displayName
    unnamed = {}     # guid -> raw name, Boss component without displayName
    bosses = {}
    for guid, text in texts.items():
        raw = re.search(r'"name": "([^"]*)"', text[:300]).group(1)
        m = re.search(r'"displayName": "([0-9a-f-]{36})"', text)
        names = [loca.get(fnv_guid(m.group(1))) for loca in locas] if m else None
        if names and all(names) and re.match(r"(Base_)?Enemy_", raw):
            named.setdefault(enemy_key(raw), names)
        if '"$type": "keen::ecs::Boss"' in text:
            if names and all(names):
                bosses[guid] = {"raw": raw, "names": names, "cat": "boss", "fastTravel": False}
            elif not raw.startswith("Base_"):
                unnamed[guid] = raw

    raws = {g: re.search(r'"name": "([^"]*)"', t[:300]).group(1) for g, t in texts.items()}
    for guid, raw in raws.items():
        if raw in EXTRA_ELITES:
            unnamed[guid] = raw

    def enemy_names(raw):
        """In-game names of an enemy template, from its variants or the tables."""
        extra = EXTRA_ELITES.get(raw)
        if isinstance(extra, tuple):
            return list(extra)
        loca_id = extra if extra else ELITE_NAMES.get(enemy_key(raw))
        if loca_id:
            return [loca.get(loca_id) for loca in locas]
        return named.get(enemy_key(raw))

    elites = {}
    for guid, raw in unnamed.items():
        names = enemy_names(raw)
        if names and all(names):
            elites[guid] = {"raw": raw, "names": names, "cat": "elite", "fastTravel": False}

    found = {**elites, **bosses}
    for _ in range(3):
        added = False
        for guid, text in texts.items():
            if guid in found:
                continue
            name = re.search(r'"name": "([^"]*)"', text[:300]).group(1)
            if BOSS_SPAWNER_EXCLUDE.search(name):
                continue
            refs = [found[ref] for ref in list(found) if ref in text]
            if refs:
                best = next((r for r in refs if r["cat"] == "boss"), refs[0])
                found[guid] = {**best, "raw": name}
                added = True
        if not added:
            break
    n_boss = sum(1 for v in found.values() if v["cat"] == "boss")
    print(f"{len(bosses)} boss and {len(elites)} elite enemy templates, {len(found)} templates with spawners "
          f"({n_boss} boss)")

    # Summoning stones: players activate them to summon the enemies they
    # reference; named after those enemies.
    enemies = {g: r for g, r in raws.items() if re.match(r"(Base_)?Enemy_", r)}
    stones = 0
    for guid, raw in raws.items():
        if not SUMMON_STONE.match(raw):
            continue
        summoned = []
        for ref in sorted(set(re.findall(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}", texts[guid]))):
            if ref in enemies:
                names = found[ref]["names"] if ref in found else enemy_names(enemies[ref])
                if names and all(names) and names not in summoned:
                    summoned.append(names)
        if summoned:
            found[guid] = {"raw": raw, "names": [" · ".join(n[i] for n in summoned) for i in range(len(locas))],
                           "cat": "summon", "fastTravel": False}
            stones += 1
    print(f"{stones} summoning stone templates")
    return found


def region_names(src, locas):
    """Biome -> [fr, en] region name."""
    bundle = open(glob.glob(f"{src}/FbUiBundle/*.json")[0], encoding="utf-8").read()
    en = locas[LANGUAGES.index("En_Us")]
    names = {}
    for biome, source in REGION_SOURCES.items():
        if source.startswith("="):
            ids = [k for k, v in en.items() if v == source[1:]]
        else:
            m = re.search(rf'"{source}": "([0-9a-f-]{{36}})"', bundle)
            ids = [fnv_guid(m.group(1))] if m else []
        for loca_id in ids:
            if all(loca_id in loca for loca in locas):
                names[biome] = [loca[loca_id] for loca in locas]
                break
    return names


def interior_point(mask):
    """A point deep inside a mask: the centre of what survives the most erosion."""
    cur = mask.copy()
    while True:
        nxt = cur.copy()
        nxt[1:] &= cur[:-1]
        nxt[:-1] &= cur[1:]
        nxt[:, 1:] &= cur[:, :-1]
        nxt[:, :-1] &= cur[:, 1:]
        if nxt.sum() < 20:
            break
        cur = nxt
    rows, cols = np.nonzero(cur)
    # pick the surviving cell closest to the survivors' centroid
    i = np.argmin((rows - rows.mean()) ** 2 + (cols - cols.mean()) ** 2)
    return rows[i], cols[i]


def region_labels(src, export, locas, cells, size, scale):
    """One label per biome region, placed inside its largest land area."""
    names = region_names(src, locas)
    grid = np.array(cells).reshape(size, size)  # [z][x], row 0 = south
    # Land = not the void around the island (FogZone tiles, see render_map.py).
    fog = render_map.assemble(export, "FogZone", [0, 1])
    step = fog.shape[0] // size
    fog = fog[::step, ::step]
    land = ~render_map.void_mask(fog[..., 0], fog[..., 1])[::-1]  # north-up -> south-up
    labels = []
    for biome, name in names.items():
        mask = (grid == biome) & land
        if mask.sum() == 0:
            continue
        r, c = interior_point(mask)
        labels.append({"name": name, "raw": biome, "cat": "region",
                       "x": round((c + 0.5) * scale, 1), "y": 0, "z": round((r + 0.5) * scale, 1),
                       "fastTravel": False})
        print(f"region {biome}: {name[0]} at ({labels[-1]['x']:.0f}, {labels[-1]['z']:.0f})")
    return labels


ITEM_ICON_SIZE = 64


def item_table_for_map(markers, resources, item_names, export, out):
    """Items shown in the popups: {guid: {"name": [...], "icon": "items/<guid>.png" | None}}.

    The pictures come from the export mod (items/<guid>.png, 256 px), shrunk.
    """
    from PIL import Image
    used = set()
    for m in markers:
        if "item" in m:
            used.add(m["item"])
            item_names.setdefault(m["item"], m["name"])
        used.update(e["item"] for e in m.get("loot", ()))
    for entries in resources.values():
        for r in entries:
            for contents in r.get("loot", {}).values():
                used.update(e["item"] for e in contents)
    os.makedirs(f"{out}/items", exist_ok=True)
    items = {}
    for guid in sorted(used):
        icon = None
        src_icon = f"{export}/items/{guid}.png"
        if os.path.exists(src_icon):
            with Image.open(src_icon) as picture:
                picture = picture.convert("RGBA")
                picture = picture.crop(picture.getbbox() or (0, 0, *picture.size))
                picture.thumbnail((ITEM_ICON_SIZE, ITEM_ICON_SIZE), Image.LANCZOS)
                square = Image.new("RGBA", (ITEM_ICON_SIZE, ITEM_ICON_SIZE))
                square.paste(picture, ((ITEM_ICON_SIZE - picture.width) // 2, (ITEM_ICON_SIZE - picture.height) // 2))
                square.save(f"{out}/items/{guid}.png", optimize=True)
            icon = f"items/{guid}.png"
        items[guid] = {"name": item_names[guid], "icon": icon}
    print(f"{len(items)} items in popups, {sum(1 for i in items.values() if not i['icon'])} without a picture")
    return items


def main(src, export, out):
    os.makedirs(f"{out}/icons", exist_ok=True)
    locas = [load_loca(f"{export}/loca/{lang}.tsv") for lang in LANGUAGES]
    icon_names = dict(line.rstrip("\n").split("\t") for line in open(f"{export}/icons/index.tsv", encoding="utf-8"))

    registry = load(glob.glob(f"{src}/MapMarkerRegistryResource/*.json")[0])
    reg_by_id = {v["markerId"]["value"]: v for v in registry["mapMarkers"]["values"]}

    # Category -> icon, taken from the marker registry.
    categories = {}
    for type_guid, (cat, kind) in CATEGORIES.items():
        if cat in categories:
            continue
        reg = reg_by_id[fnv_guid(type_guid)]
        icon = None
        if kind == "icon" and reg["icon"]["image"] in icon_names:
            icon = f"icons/{icon_names[reg['icon']['image']]}.png"
            shutil.copyfile(f"{export}/icons/{reg['icon']['image']}.png", f"{out}/{icon}")
        categories[cat] = {
            "label": CATEGORY_LABELS[cat],
            "kind": kind,
            "icon": icon,
            "visible": cat not in HIDDEN_BY_DEFAULT,
        }

    # Region labels are generated from the biome map (region_labels).
    categories["region"] = {"label": CATEGORY_LABELS["region"], "kind": "label", "icon": None, "visible": True}

    marker_templates = {}
    for p in glob.glob(f"{src}/TemplateResource/*.json"):
        t = load(p)
        for c in t["components"]:
            if c["$type"] != "keen::ecs::MapMarker":
                continue
            mt = c["$value"]["markerType"]
            if mt in CATEGORIES and not any(h in t["name"] for h in IGNORED_TEMPLATE_HINTS):
                reg = reg_by_id.get(fnv_guid(mt), {})
                loca_id = fnv_guid(c["$value"]["markerId"]) if c["$value"]["markerId"] else None
                marker_templates[t["$guid"]] = {
                    "raw": t["name"],
                    "names": [loca.get(loca_id) for loca in locas],
                    "cat": CATEGORIES[mt][0],
                    "fastTravel": bool(reg.get("isFastTravelDestination")),
                }
            break
    print(f"{len(marker_templates)} marker templates")

    # Bosses and the start spawn have no map marker: they are added from their
    # spawn templates.
    texts = load_templates(src)
    raws = {g: re.search(r'"name": "([^"]*)"', t[:300]).group(1) for g, t in texts.items()}
    marker_templates.update(boss_templates(src, locas, texts))
    marker_templates.update(build_resources.collectible_templates(src, locas, texts, raws))
    for guid, raw in raws.items():
        if raw == START_SPAWN_TEMPLATE:
            marker_templates[guid] = {
                "raw": START_SPAWN_TEMPLATE, "names": [None] * len(locas), "cat": "start", "fastTravel": False}
    # Chests, plants and ores: grouped point lists (build_resources.py).
    resource_tpl, by_debug = build_resources.resource_templates(src, locas, texts, raws)
    for cat, icon in RESOURCE_CATEGORIES.items():
        guid = next(g for g, n in icon_names.items() if n == icon)
        shutil.copyfile(f"{export}/icons/{guid}.png", f"{out}/icons/{icon}.png")
        categories[cat] = {"label": CATEGORY_LABELS[cat], "kind": "dots", "icon": f"icons/{icon}.png",
                           "visible": cat not in HIDDEN_BY_DEFAULT}
    for cat, icon in EXTRA_CATEGORIES.items():
        if icon.endswith(".svg"):
            with open(f"{out}/icons/{icon}", "w", encoding="utf-8") as f:
                f.write(ICON_SVGS[icon])
        else:
            guid = next(g for g, n in icon_names.items() if n == icon)
            shutil.copyfile(f"{export}/icons/{guid}.png", f"{out}/icons/{icon}.png")
            icon += ".png"
        categories[cat] = {"label": CATEGORY_LABELS[cat], "kind": "icon", "icon": f"icons/{icon}",
                           "visible": cat not in HIDDEN_BY_DEFAULT}

    placed = []           # (template guid, x, height, z)
    resources_placed = []
    scene = load(glob.glob(f"{src}/SceneResource/{MAIN_SCENE}_*.json")[0])
    for e in scene["questEntities"]:
        guid = e["templateGuid"]
        if guid in marker_templates or guid in resource_tpl:
            pos = e["transform"]["position"]
            (placed if guid in marker_templates else resources_placed).append(
                (guid, pos["x"] / 2**32, pos["y"] / 2**32, pos["z"] / 2**32))

    for p in glob.glob(f"{src}/SceneEntityChunkResource/{MAIN_SCENE}_*.json"):
        chunk = load(p)
        templates = chunk["templates"]
        for e in chunk["entities"]:
            guid = templates[e["templateIndex"]]
            if guid in marker_templates or guid in resource_tpl:
                tr = e["transform"]
                fixed = lambda lo, hi: tr[hi] + tr[lo] / 65536  # 16.16 fixed point
                (placed if guid in marker_templates else resources_placed).append(
                    (guid, fixed("positionX0", "positionX1"), fixed("positionY0", "positionY1"),
                     fixed("positionZ0", "positionZ1")))

    # Dungeon interiors are stored in a corner of the world, outside of the map.
    dungeon_areas = [
        (a["areaMin"]["x"] / 2**32, a["areaMin"]["z"] / 2**32, a["areaMax"]["x"] / 2**32, a["areaMax"]["z"] / 2**32)
        for a in scene["resetPlayersOutOfBounds"]["playableAreas"]
        if "BigDungeon" in a["flags"]
    ]

    markers = []
    seen = {}  # de-duplication key -> index in markers
    unnamed = 0
    for guid, x, y, z in placed:
        t = marker_templates[guid]
        if any(x0 <= x <= x1 and z0 <= z <= z1 for x0, z0, x1, z1 in dungeon_areas):
            continue
        # Same element placed twice (scene + chunk): keep one. The phases of a
        # boss (Vorgoth...) have their own names but share the spot: one marker,
        # named after the first phase (template names end with Phase1, Phase2...).
        same = "phases" if t["cat"] == "boss" else tuple(t["names"]) if t["names"][0] else guid
        key = (t["cat"], same, round(x / 4), round(z / 4))
        # Untranslated markers are mostly generic ones (elixir wells...), for
        # which the category name is the in-game name.
        fallback = CATEGORY_LABELS[t["cat"]]
        marker = {
            "name": [n or fb for n, fb in zip(t["names"], fallback)],
            "raw": t["raw"],
            # the Bard's crypt is a point of interest marker in the game
            "cat": "dungeonEntrance" if CRYPT_NAME.match(t["names"][0] or "") else t["cat"],
            "x": round(x, 1), "y": round(y, 1), "z": round(z, 1),
            "fastTravel": t["fastTravel"],
        }
        if "item" in t:  # collectibles lying in the world: picture in the popup
            marker["item"] = t["item"]
        if key in seen:
            kept = markers[seen[key]]
            if t["cat"] == "boss" and marker["raw"] < kept["raw"]:
                kept.update(name=marker["name"], raw=marker["raw"])
            continue
        seen[key] = len(markers)
        if not t["names"][0]:
            unnamed += 1
        markers.append(marker)
    # Unique items and collectibles: one marker per item, at its chest. Items
    # sharing a chest are moved apart by 1 m so that each one keeps its own
    # mark id (category:x:z).
    # Collectibles lying in the world are often special loot too: keep one.
    # The other guaranteed items of a container (materials, blocks...) are listed
    # in the popup of what stands there: the loot marker, the chest or the enemy.
    special = []
    taken = set()
    item_names = {}  # item guid -> names, for the items table
    container_loot = build_resources.ContainerLoot()
    lying = {(tuple(m["name"]), round(m["x"]), round(m["z"])): m for m in markers if m["cat"] == "collectible"}
    special_items = [s for s in build_resources.special_loot(src, MAIN_SCENE, locas)
                     if not any(x0 <= s[5] <= x1 and z0 <= s[7] <= z1 for x0, z0, x1, z1 in dungeon_areas)]
    for cat, names, debug, item, amount, x, y, z in special_items:
        item_names[item] = names
        if not cat:
            container_loot.add(x, z, item, amount)
    for cat, names, debug, item, amount, x, y, z in special_items:
        if not cat:
            continue
        special.append((x, z))
        contents = container_loot.take(x, z)
        same = [lying.get((tuple(names), round(x) + dx, round(z) + dz)) for dx in (-1, 0, 1) for dz in (-1, 0, 1)]
        marker = next((m for m in same if m), None)
        if not marker:
            x, z = round(x, 1), round(z, 1)
            # same rounding as the front end's mark ids (Math.round)
            while (cat, math.floor(x + 0.5), math.floor(z + 0.5)) in taken:
                x = round(x + 1, 1)
            taken.add((cat, math.floor(x + 0.5), math.floor(z + 0.5)))
            marker = {"name": names, "raw": debug, "cat": cat,
                      "x": x, "y": round(y, 1), "z": z, "fastTravel": False}
            markers.append(marker)
        marker["item"] = item
        if contents:
            marker["loot"] = contents

    print(f"{len(markers)} markers ({unnamed} without translation)")
    print(collections.Counter(m["cat"] for m in markers).most_common())
    fog = render_map.assemble(export, "FogZone", [0, 1])[::8, ::8]
    void = render_map.void_mask(fog[..., 0], fog[..., 1])  # north-up, 8 m cells
    resources = build_resources.build_resources(resources_placed, resource_tpl, by_debug, export, locas,
                                                dungeon_areas, void, special, container_loot)
    # Guaranteed loot still unclaimed: an enemy, a skeleton... standing on a marker.
    for m in markers:
        if categories[m["cat"]]["kind"] == "icon" and m["cat"] not in LOOT_MARKER_CATEGORIES:
            contents = container_loot.take(m["x"], m["z"])
            if contents:
                m["loot"] = contents
    print(f"{len(container_loot.cells)} containers of guaranteed loot without a chest or a marker")
    items = item_table_for_map(markers, resources, item_names, export, out)

    # Biome layer. Biome map row 0 is the south edge, so flip it for north-up.
    biome = load(glob.glob(f"{src}/BiomeMapResource/{MAIN_SCENE}_*.json")[0])
    w, h = biome["worldSize"]["x"], biome["worldSize"]["y"]
    cells = biome["biomeMap"]

    markers += region_labels(src, export, locas, cells, w, biome["mapScale"])
    rows = []
    for row in range(h - 1, -1, -1):
        line = bytearray()
        for col in range(w):
            line += bytes(BIOME_COLORS.get(cells[row * w + col], (40, 40, 40)))
        rows.append(bytes(line))
    write_png(f"{out}/biomes.png", w, h, rows)

    present = set(cells)
    data = {
        "worldSize": w * biome["mapScale"],
        "languages": ["fr", "en"],
        "biomes": {k: {"color": "#%02x%02x%02x" % v, "label": BIOME_LABELS[k]}
                   for k, v in BIOME_COLORS.items() if k in present},
        "categories": categories,
        "items": items,
        "markers": markers,
    }
    for name, obj in (("map-data", data), ("resources", resources)):
        with open(f"{out}/{name}.json", "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))


if __name__ == "__main__":
    main(*sys.argv[1:4])
