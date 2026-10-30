"""Crafting data for the workshop pages (used by build_data.py).

Writes craft.json:

  {"items":   {guid: {"name": [fr, en], "icon": "items/<guid>.png" | None}},
   "stations": {id: {"name": [fr, en], "npc": bool}},
   "categories": {id: [{"item": guid, "scaling": n}]},   any item of the list
   "groups": {key: [fr, en]},                            groups of building pieces
   "recipes": [entry], "blocks": [entry + "group", "tier"],
   "altar":   [entry without "unlock", + "kind", "level", "unlocks": [recipe ids]]}

  entry = {"id": recipe guid, "name": [fr, en], "output": {"item", "count"} | None,
           "station": id | None, "inputs": [{"item" | "category", "count"}],
           "props": [[fr, en]], "seconds": n, "cooking": bool, "sheltered": bool,
           "unlock": {"type", "text": [fr, en], "items": [guid], "npcs": [id],
                      "flame": n, "playerLevel": n, "altarLevel": n, "altars": n},
           "sources": {"markers": [mark id], "groups": [{"cat", "name"}]}}

"blocks" are the recipes making a building item. An altar entry has no output;
"unlocks" lists the recipes that wait for the level it reaches (level + 1).

How a recipe unlocks comes from the tree of knowledge queries of the game
(GameKnowledgeQueryResourceDb): a query is an AND / OR of actions, each one a
sub-query or a knowledge. A knowledge whose id is an item id means the item was
found (or, for a few, that an item was used: ItemInfo.sequences). Queries and
knowledge have developer names only, so the text is written here from the items,
NPCs and levels met in the tree; anything else (quests, hints) is reported as
quest progress.
"""
import glob
import json
import math
import re

ALTAR_RECIPE = re.compile(r"^(Flame_Level_|FlameAltar_HomeBase_Upgrade_)")
# Knowledge action name -> English name of the NPC in the workshop registry.
NPC_ACTIONS = [
    (re.compile(r"(?i)^carpenter"), "Carpenter"),
    (re.compile(r"(?i)^alchemist"), "Alchemist"),
    (re.compile(r"(?i)^farmer"), "Farmer"),
    (re.compile(r"(?i)^hunt(ress|er)"), "Hunter"),
    (re.compile(r"(?i)^blacksmith"), "Blacksmith"),
    (re.compile(r"(?i)^bard"), "Bard"),
    (re.compile(r"(?i)^(cryptkeeper|collector)"), "Collector"),
    (re.compile(r"(?i)^fisher"), "Fisher"),
    (re.compile(r"(?i)^(ancient)?researcher"), "Ancient Researcher"),
    (re.compile(r"(?i)^barber"), "Barber"),
]
# Knowledge that only says the station exists or stands: the recipe shows it.
STATION_KNOWLEDGE = re.compile(r"(?i)(craftable|placed|_set)(_WK|_PK)?$")
LEVEL_FIELDS = {"MotherFlameLevel": "flame", "PlayerLevel": "playerLevel", "FlameAltarLevel": "altarLevel",
                "FlameAltarCount": "altars"}
TEXTS = {
    "items": ("Obtenir : {}", "Get: {}"),
    "npcs": ("Avec : {}", "With: {}"),
    "flame": ("Flamme niveau {}", "Flame level {}"),
    "playerLevel": ("Joueur niveau {}", "Player level {}"),
    "altarLevel": ("Autel de la Flamme niveau {}", "Flame Altar level {}"),
    "altars": ("{} autels de la Flamme", "{} Flame Altars"),
    "quest": ("Progression de quête", "Quest progress"),
    "none": ("Sans condition", "No condition"),
    "altarLevelName": ("Flamme niveau {}", "Flame level {}"),
}
# Building pieces: second word of "Prop_*" item names, or first word of the others.
BLOCK_GROUPS = {
    "Decoration": ("Décoration", "Decoration"), "Block": ("Blocs", "Blocks"), "Flower": ("Plantes", "Plants"),
    "Collection": ("Collections", "Collections"), "Production": ("Production", "Production"),
    "Craftingstation": ("Production", "Production"), "Component": ("Production", "Production"),
    "Storage": ("Stockage", "Storage"), "Logic": ("Mécanismes", "Mechanisms"), "NPC": ("PNJ", "NPCs"),
    "WaterDrain": ("Eau", "Water"), "WaterDispenser": ("Eau", "Water"), "WaterGate": ("Eau", "Water"),
    "WaterBarrier": ("Eau", "Water"),
}
OTHER_GROUP = ("Divers", "Other")


def empty_condition():
    return {"items": set(), "npcs": set(), "quest": False}


def merge(a, b):
    """Both conditions must hold."""
    out = {"items": a["items"] | b["items"], "npcs": a["npcs"] | b["npcs"], "quest": a["quest"] or b["quest"]}
    for field in LEVEL_FIELDS.values():
        if field in a or field in b:
            out[field] = max(a.get(field, 0), b.get(field, 0))
    return out


def weight(c):
    """Which branch of an OR to show: known conditions first, then the shortest."""
    return (c["quest"], len(c["items"]) + len(c["npcs"]) + sum(f in c for f in LEVEL_FIELDS.values()))


class Unlocks:
    """Turns the knowledge requirement of a recipe into a condition."""

    def __init__(self, src, infos, npcs):
        with open(glob.glob(f"{src}/GameKnowledgeQueryResourceDb/*.json")[0], encoding="utf-8") as f:
            db = json.load(f)
        self.queries = {q["queryId"]["id"]["value"]: q for q in db["queries"] + db["runtimeQueries"]}
        self.infos = infos
        self.npcs = npcs
        self.other = {}  # knowledge names that gave no text, for the report
        self.granted_by = {}  # knowledge id -> item that gives it when used
        for d in infos.values():
            for sequence in d.get("sequences") or ():
                operation = sequence.get("knowledgeUnlockOperation")
                knowledge = operation["knowledgeId"]["id"]["value"] if operation else 0
                if knowledge:
                    self.granted_by[knowledge] = d["$guid"]

    def of(self, requirement):
        return self.walk(requirement["knowledgeOrQueryId"]["value"], requirement["type"], "", ())

    def walk(self, ident, kind, name, seen):
        c = empty_condition()
        if kind != "Extern":
            if ident in self.infos:
                c["items"].add(self.infos[ident]["$guid"])
                return c
            if ident in self.granted_by:
                c["items"].add(self.granted_by[ident])
                return c
            if STATION_KNOWLEDGE.search(name):
                return c
            for rx, npc in NPC_ACTIONS:
                if rx.match(name) and npc in self.npcs:
                    c["npcs"].add(self.npcs[npc])
                    return c
            self.other[name] = self.other.get(name, 0) + 1
            c["quest"] = True
            return c
        query = self.queries.get(ident)
        if ident == 0:  # no condition
            return c
        if not query or ident in seen:
            c["quest"] = True
            return c
        if query["type"] in LEVEL_FIELDS:
            # Upper bounds only hide old recipes: the lower bound is the unlock.
            value = query.get("compareValue", 0)
            operation = query.get("compareOperation")
            if operation == "GreaterThan":
                c[LEVEL_FIELDS[query["type"]]] = value + 1
            elif operation == "Equals":
                c[LEVEL_FIELDS[query["type"]]] = value
            return c
        if query["type"] not in ("AND", "OR", "XOR"):
            c["quest"] = True
            return c
        parts = [self.walk(a["query"]["knowledgeOrQueryId"]["value"], a["query"]["type"], a["name"], seen + (ident,))
                 for a in query["actions"] if not a["invertResult"]]
        if not parts:
            return c
        if query["type"] != "AND":
            return min(parts, key=weight)
        for part in parts:
            c = merge(c, part)
        return c


def describe(c, item_names, npc_names):
    """The unlock entry of craft.json."""
    out = {"items": sorted(c["items"]), "npcs": sorted(c["npcs"])}
    lines = []
    for lang in (0, 1):
        parts = []
        if c["items"]:
            parts.append(TEXTS["items"][lang].format(", ".join(sorted(item_names[i][lang] for i in c["items"]))))
        if c["npcs"]:
            parts.append(TEXTS["npcs"][lang].format(", ".join(sorted(npc_names[n][lang] for n in c["npcs"]))))
        for field in LEVEL_FIELDS.values():
            if c.get(field):
                parts.append(TEXTS[field][lang].format(c[field]))
        if c["quest"]:
            parts.append(TEXTS["quest"][lang])
        lines.append(" · ".join(parts) or TEXTS["none"][lang])
    for field in LEVEL_FIELDS.values():
        if c.get(field):
            out[field] = c[field]
    out["text"] = lines
    out["type"] = ("item" if c["items"] else "npc" if c["npcs"] else "flame" if c.get("flame")
                   else "level" if any(c.get(f) for f in LEVEL_FIELDS.values()) else "quest" if c["quest"] else "none")
    return out


def map_sources(markers, resources, categories, item_names):
    """Item guid -> where the map shows it: mark ids and resource groups."""
    ids, groups = {}, {}
    for m in markers:
        if categories[m["cat"]]["kind"] == "label":
            continue
        mark = f"{m['cat']}:{math.floor(m['x'] + 0.5)}:{math.floor(m['z'] + 0.5)}"
        for item in [m.get("item")] + [e["item"] for e in m.get("loot", ())]:
            if item:
                ids.setdefault(item, set()).add(mark)
    for r in resources.get("chest", ()):
        for index, contents in r.get("loot", {}).items():
            i = int(index) * 3
            mark = f"chest:{r['pts'][i]}:{r['pts'][i + 1]}"
            for e in contents:
                ids.setdefault(e["item"], set()).add(mark)
    by_name = {tuple(names): guid for guid, names in item_names.items()}
    for cat in ("plant", "ore"):
        for r in resources.get(cat, ()):
            guid = by_name.get(tuple(r["name"]))
            if guid:
                groups.setdefault(guid, []).append({"cat": cat, "name": r["name"]})
    return ids, groups


def build_craft(src, locas, markers, resources, categories, export, out):
    from build_data import fnv_guid, write_item_picture
    infos = {}
    for p in glob.glob(f"{src}/ItemInfo/*.json"):
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        infos[fnv_guid(d["$guid"])] = d
    item_names = {}
    for d in infos.values():
        loca_id = fnv_guid(d["name"]) if d.get("name") else None
        names = [loca.get(loca_id) for loca in locas]
        if all(names):
            item_names[d["$guid"]] = names

    with open(glob.glob(f"{src}/RecipeRegistryResource/*.json")[0], encoding="utf-8") as f:
        registry = json.load(f)
    with open(glob.glob(f"{src}/WorkshopRegistryResource/*.json")[0], encoding="utf-8") as f:
        workshops = json.load(f)
    stations = {}
    for w in workshops["workshops"]:
        names = [loca.get(w["name"]["value"]) for loca in locas]
        if all(names):
            stations[w["workshopId"]["value"]] = {"name": names, "npc": w["isNpc"]}
    props = {p["craftingPropId"]["value"]: [loca.get(p["name"]["value"]) for loca in locas]
             for p in workshops["craftingProps"]}
    npcs = {s["name"][1]: ident for ident, s in stations.items() if s["npc"]}
    npc_names = {ident: s["name"] for ident, s in stations.items() if s["npc"]}
    unlocks = Unlocks(src, infos, npcs)
    # Items without a translated name cannot be told apart in a text.
    for d in infos.values():
        item_names.setdefault(d["$guid"], [d["debugName"]] * len(locas))

    ids, groups = map_sources(markers, resources, categories, item_names)

    def inputs(r):
        out_list = []
        for x in r["input"]:
            stack, cat = x["itemStack"], x["inputItemCategory"]
            if stack["itemRef"] and stack["count"]:
                out_list.append({"item": stack["itemRef"], "count": stack["count"]})
            if cat["count"]:
                out_list.append({"category": str(cat["category"]["value"]), "count": cat["count"]})
        return out_list

    def entry(r):
        c = unlocks.of(r["knowledgeRequirement"])
        output = r["output"][0] if r["output"] else None
        loca_id = fnv_guid(r["recipeName"]) if r["recipeName"] else None
        names = [loca.get(loca_id) for loca in locas]
        if not all(names):
            names = item_names[output["itemRef"]] if output else [r["debugName"]] * len(locas)
        station = r["workshopId"]["value"]
        e = {
            "id": r["recipeGuid"], "name": names,
            "output": {"item": output["itemRef"], "count": output["count"]} if output else None,
            "station": str(station) if station in stations else None,
            "inputs": inputs(r),
            "props": [props[p["value"]] for p in r["requiredProps"]
                      if p["value"] in props and all(props[p["value"]])],
            "seconds": round(r["craftingDuration"]["value"] / 1e9),
            "cooking": r["isCookingRecipe"], "sheltered": r["requiresSheltered"],
            "unlock": describe(c, item_names, npc_names),
        }
        wanted = set(c["items"]) | ({output["itemRef"]} if output else set())
        marks = sorted(m for i in wanted for m in ids.get(i, ()))
        group = [g for i in sorted(wanted) for g in groups.get(i, ())]
        if marks or group:
            e["sources"] = {"markers": marks, "groups": group}
        return e

    recipes, blocks, altar, dropped, groups_seen = [], [], [], 0, {}
    for r in registry["recipes"]:
        info = infos.get(fnv_guid(r["output"][0]["itemRef"])) if r["output"] else None
        if ALTAR_RECIPE.match(r["debugName"]):
            kind = "flame" if r["debugName"].startswith("Flame_") else "altar"
            e = {**entry(r), "kind": kind, "level": r["level"], "unlocks": []}
            del e["unlock"]
            if kind == "flame":
                e["name"] = [text.format(r["level"] + 1) for text in TEXTS["altarLevelName"]]
            altar.append(e)
        elif not info or info["$guid"] not in item_names or item_names[info["$guid"]][0] == info["debugName"]:
            dropped += 1  # no name in the game: not meant to be shown
        elif info["category"] == "BuildTools":
            parts = info["debugName"].lstrip("_").split("_")
            tier = next((p for p in parts if re.fullmatch(r"T[0-9X]", p)), None)
            group = parts[1] if parts[0] == "Prop" and len(parts) > 1 else parts[0]
            labels = BLOCK_GROUPS.get(group, OTHER_GROUP)
            blocks.append({**entry(r), "group": labels[1], "tier": tier})
            groups_seen[labels[1]] = list(labels)
        else:
            recipes.append(entry(r))

    # What each level opens: the recipes waiting for that level.
    altar.sort(key=lambda a: (a["kind"], a["level"]))
    field = {"flame": "flame", "altar": "altarLevel"}
    for a in altar:
        a["unlocks"] = [r["id"] for r in recipes + blocks if r["unlock"].get(field[a["kind"]]) == a["level"] + 1]

    used = set()
    for e in recipes + blocks + altar:
        if e["output"]:
            used.add(e["output"]["item"])
        used.update(i["item"] for i in e["inputs"] if "item" in i)
        used.update(e.get("unlock", {}).get("items", ()))
    used_categories = {i["category"] for e in recipes + blocks + altar for i in e["inputs"] if "category" in i}
    input_categories = {}
    for c in registry["inputCategories"]:
        key = str(c["inputCategoryId"]["value"])
        if key in used_categories:
            members = [{"item": infos[i["itemId"]["value"]]["$guid"], "scaling": i["scaling"]}
                       for i in c["items"] if i["itemId"]["value"] in infos]
            input_categories[key] = members
            used.update(m["item"] for m in members)
    items = {guid: {"name": item_names[guid], "icon": write_item_picture(export, out, guid)} for guid in sorted(used)}
    data = {"items": items, "stations": {str(k): v for k, v in stations.items()},
            "categories": input_categories, "groups": groups_seen, "recipes": recipes, "blocks": blocks, "altar": altar}
    types = {}
    for e in recipes + blocks:
        types[e["unlock"]["type"]] = types.get(e["unlock"]["type"], 0) + 1
    print(f"craft: {len(recipes)} recipes, {len(blocks)} blocks, {len(altar)} altar levels, {len(items)} items, "
          f"{dropped} unnamed left out")
    print("craft unlocks:", types, "with map sources:", sum("sources" in e for e in recipes + blocks))
    print("craft: most common knowledge without text:",
          sorted(unlocks.other.items(), key=lambda kv: -kv[1])[:12])
    return data
