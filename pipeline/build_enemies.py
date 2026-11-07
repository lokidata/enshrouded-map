"""Bosses and elite enemies of the game, for the app: writes enemies.json (called by build_data.py).

  {"factions": {key: [fr, en]},
   "regions":  {key: [fr, en]},
   "enemies":  [{"id", "name": [fr, en], "boss": bool, "faction": key | None, "image": "enemies/<id>.png" | None,
                 "trophy": [fr, en] | None, "places": [[fr, en]],
                 "xp": experience multiplier | None, "scaling": extra health per player, 0.6 = +60% | None,
                 "regions": [key], "spots": n, "sources": {"markers": [mark id]}}]}

Only the bosses (the named boss fights) and the elites (the generic heavy enemies) are here: the game names no
other enemy, and gives no readable damage table or drop list, so the app shows what the templates really say.
Where an enemy stands comes from the map markers build_data.py places for it.

The game has no portrait of an enemy: the picture is the item of its head ("Fell Cyclops Head"), else of its
trophy, both pictures the game renders for the items; `trophy` is that item's name. `places` are the named areas
("Howling Peak", markers of the category areaName) nearest to where it stands.
"""
import glob
import json
import math
import os
import re

# ecs Faction.faction as the game writes it
FACTIONS = {
    "Fogger": ("Déchus", "The Fell"), "Skeleton": ("Creux", "The Hollow"),
    "Scavenger": ("Maraudeurs", "Scavengers"), "Vukah": ("Vukah", "Vukah"), "Drak": ("Drak", "Drak"),
    "Wildlife": ("Faune", "Wildlife"), "Golem": ("Constructions anciennes", "Ancient Constructs"),
    "Ancient": ("Constructions anciennes", "Ancient Constructs"), "Ancients": ("Anciens", "Ancients"),
    "Cyclops": ("Cyclopes", "Cyclopes"), "WildBeast": ("Bêtes sauvages", "Wild beasts"),
}
FACTION = re.compile(r'"keen::ecs::Faction",\s*"\$value": \{\s*"faction": "(\w+)"')
XP = re.compile(r'"keen::ecs::ExperienceSource".{0,200}?"xpMod": ([\d.]+)', re.S)
HEALTH = re.compile(r'"playerCountScaling": \{[^}]*?"healthScaling": ([\d.]+)')


def stats(text):
    faction = FACTION.search(text)
    xp = XP.search(text)
    scaling = HEALTH.search(text)
    return (faction.group(1) if faction else None, float(xp.group(1)) if xp else None,
            float(scaling.group(1)) if scaling else None)


ILLUSTRATION_SIZE = 192
AREA_RADIUS = 600  # metres: an enemy is "near" a named area within this distance
TROPHY = re.compile(r"^(?:(Bronze|Iron|Gold|Silver) )?(.+?) (Trophy|Head)$")
# enemy name -> name of what its head or trophy is called, when they differ
ALIASES = {"Vorgoth": "Vorgoth's Eye"}


def head_pictures(src, locas):
    """Enemy name -> guid of the item picture that illustrates it (head, else trophy, else any trophy)."""
    from build_data import fnv_guid
    english = locas[1]
    found = {}  # name -> {"head": guid, "plain": guid, "tier": guid}
    titles = {}  # guid -> [fr, en]
    for path in glob.glob(f"{src}/ItemInfo/*.json"):
        with open(path, encoding="utf-8") as f:
            info = json.load(f)
        name = english.get(fnv_guid(info["name"])) if info.get("name") else None
        titles[info["$guid"]] = [loca.get(fnv_guid(info["name"])) for loca in locas] if info.get("name") else None
        match = TROPHY.match(re.sub(r"</?lorename>", "", name or ""))
        if match:
            tier, base, kind = match.groups()
            found.setdefault(base, {}).setdefault("head" if kind == "Head" else "tier" if tier else "plain",
                                                   info["$guid"])
    return found, titles


def illustration(name, pictures):
    """The guid of the picture of an enemy: its own name first, then the same without "Armored", then without
    its second word ("Scavenger Gorger Matron" -> "Scavenger Matron"), then the alias."""
    base = re.sub(r"^Armored ", "", name)
    words = base.split()
    tries = [name, base] + ([" ".join(words[:1] + words[2:])] if len(words) > 2 else [])
    tries += [alias for key, alias in ALIASES.items() if name.startswith(key)]
    for candidate in tries:
        kinds = pictures.get(candidate)
        if kinds:
            return kinds.get("head") or kinds.get("plain") or kinds.get("tier")
    return None


def write_illustration(export, out, guid, key):
    """Shrinks the picture of an item into out/enemies/<key>.png; None when the game has none."""
    from PIL import Image
    path = f"{export}/items/{guid}.png"
    if not os.path.exists(path):
        return None
    os.makedirs(f"{out}/enemies", exist_ok=True)
    with Image.open(path) as picture:
        picture = picture.convert("RGBA")
        picture = picture.crop(picture.getbbox() or (0, 0, *picture.size))
        picture.thumbnail((ILLUSTRATION_SIZE, ILLUSTRATION_SIZE), Image.LANCZOS)
        picture.save(f"{out}/enemies/{key}.png", optimize=True)
    return f"enemies/{key}.png"


def build_enemies(texts, bosses, elites, markers, region_of, region_names, src, export, out, locas):
    templates = {}  # (fr, en) -> [(raw, boss, text)]
    for found, boss in ((bosses, True), (elites, False)):
        for guid, info in found.items():
            templates.setdefault(tuple(info["names"]), []).append((info["raw"], boss, texts[guid]))

    spots = {}  # (fr, en) -> markers of boss or elite spawns
    for m in markers:
        if m.get("cat") in ("boss", "elite") and tuple(m["name"]) in templates:
            spots.setdefault(tuple(m["name"]), []).append(m)

    pictures, titles = head_pictures(src, locas)
    areas = [m for m in markers if m.get("cat") == "areaName"]
    enemies, used_regions, used_factions = [], set(), set()
    for names, group in templates.items():
        group.sort(key=lambda t: t[0])
        boss = any(b for _, b, _ in group)
        found = [stats(text) for _, _, text in group]
        faction = next((f for f, _, _ in found if f), None)
        xp = max((x for _, x, _ in found if x is not None), default=None)
        scaling = max((s for _, _, s in found if s is not None), default=None)
        where = spots.get(names, [])
        regions = sorted({r for m in where if (r := region_of(m["x"], m["z"]))})
        used_regions.update(regions)
        if faction:
            used_factions.add(faction)
        key = re.sub(r"[^a-z0-9]+", "-", names[1].lower()).strip("-")
        guid = illustration(names[1], pictures)
        near = []
        for m in where:
            closest = min(areas, key=lambda a: math.hypot(a["x"] - m["x"], a["z"] - m["z"]), default=None)
            if closest and math.hypot(closest["x"] - m["x"], closest["z"] - m["z"]) <= AREA_RADIUS \
                    and list(closest["name"]) not in near:
                near.append(list(closest["name"]))
        enemies.append({
            "id": key, "name": list(names), "boss": boss, "trophy": titles.get(guid) if guid else None,
            "places": near, "image": write_illustration(export, out, guid, key)
            if guid else None, "faction": faction, "xp": xp, "scaling": scaling, "regions": regions, "spots": len(where),
            **({"sources": {"markers": sorted({f"{m['cat']}:{math.floor(m['x'] + 0.5)}:{math.floor(m['z'] + 0.5)}"
                                              for m in where})}} if where else {}),
        })
    # the game's French text is the same for some different enemies (Fell Monstrosity and Fell Thunderbrute)
    for lang in (0, 1):
        count = {}
        for e in enemies:
            count[e["name"][lang]] = count.get(e["name"][lang], 0) + 1
        for e in enemies:
            if count[e["name"][lang]] > 1:
                e["name"][lang] = f"{e['name'][lang]} ({e['name'][1 - lang]})"
    enemies.sort(key=lambda e: (not e["boss"], e["name"][0]))
    factions = {k: list(FACTIONS.get(k, (k, k))) for k in sorted(used_factions)}
    print(f"enemies: {sum(e['boss'] for e in enemies)} bosses, {sum(not e['boss'] for e in enemies)} elites, "
          f"{sum(1 for e in enemies if e['spots'])} placed on the map, factions {sorted(used_factions)}, "
          f"{sum(1 for e in enemies if e['image'])} with a picture, without experience/scaling: {sum(1 for e in enemies if e['xp'] is None)}/"
          f"{sum(1 for e in enemies if e['scaling'] is None)}", flush=True)
    return {"factions": factions, "regions": {k: region_names[k] for k in sorted(used_regions)}, "enemies": enemies}
