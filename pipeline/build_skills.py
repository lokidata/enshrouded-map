"""Skill tree of the game, for the build planner: writes skills.json (called by build_data.py).

  {"budget": 212,
   "nodes": [{"id", "x", "y", "type": "Root" | "Passive" | "Active" | "Attribute", "icon": "skills/<guid>.png" | None,
              "label": [fr, en] | None, "attr": attribute key | None, "gain": points of it per level, "flame": bool,
              "cls": "Neutral" | "Warrior" | "Ranger" | "Mage", "name": [fr, en], "desc": [fr, en],
              "cost": points per level, "max": levels (1 for a node taken once),
              "vals": [value at level 1, 2...] | None, "per": [fr, en] | None}],
   "links": [[from id, to id]]}

The icon is the picture the node points to (iconActive), exported by the mod's `skills` option; a node
the game gives no picture has None.

`label` is the name of the specialization a Root starts (Survivant, Maître de la bête...), written by the
game's screen next to the start points, in the order the screen draws them (see SPECIALIZATIONS). `attr` is the
attribute (constitution, spirit, resistance, strength, dexterity, intelligence) an Attribute node raises, by
`gain` points per level; the six big ones (`flame`) give one point per two levels of the Flame instead.

Texts keep their paragraphs ("\\n"), their bold parts as **...** and their italic parts as __...__. In `desc` and `per`, %k stands for the
value of the node at its level: `vals` has it for each level (the "scaleFactor" of the node's linear scaled
effect, a percentage when the game says so). A %k that the node gives no such value for is left as it is.
`budget` is the number of points to spend, as enshrouded.tools shows it: the game gives it by level, which
is not read here.
"""
import glob
import json
import math
import re

LANGUAGES = ("Fr_Fr", "En_Us")
TYPES = {"Root": "Root", "PassiveSkill": "Passive", "ActiveSkill": "Active", "Attribute": "Attribute"}
BUDGET = 212


# The 12 specializations, clockwise from the top-left, one start point every 30 degrees around the centre of
# the tree (the order of the labels on the game's skill screen); the English names come from the game's texts.
SPECIALIZATIONS = ["Survivant", "Maître de la bête", "Garde forestier", "Assassin", "Farceur", "Magicien",
                   "Guérisseur", "Mage de combat", "Tank", "Guerrier", "Barbare", "Athlète"]
START_ANGLE = -135  # degrees, y pointing down: the first start point is up and to the left
ATTRIBUTES = {"Constitution": "constitution", "Spirit": "spirit", "Endurance": "resistance",
              "Strength": "strength", "Dexterity": "dexterity", "Intelligence": "intelligence"}
GAIN = re.compile(r"Increases your (\w+) attribute by (\d+)")
FLAME = re.compile(r"Gain one point of (\w+) for every two levels of the Flame")


def load_texts(path):
    """Loca texts with paragraphs and bold parts (<b> becomes **)."""
    texts = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            key, _, text = line.rstrip("\n").partition("\t")
            text = text.replace("\\\\", "\0").replace("\\t", " ").replace("\\r", "").replace("\\n", "\n")
            text = re.sub(r"</?b>", "\x01", text)
            text = re.sub(r"</?i>", "\x02", text)
            text = re.sub(r"<[^>]*>", "", text).replace("\x01", "**").replace("\x02", "__").replace("\0", "\\")
            texts[int(key)] = "\n".join(p for p in (" ".join(line.split()) for line in text.split("\n")) if p)
    return texts


def number(value, percentage):
    value = value * 100 if percentage else value
    return f"{round(value, 2):g}" + ("%" if percentage else "")


ICON_SIZE = 96


def write_icon(export, out, guid):
    """Shrinks the picture of a node into out/skills; None when the export has none."""
    import os
    from PIL import Image
    path = f"{export}/skills/{guid}.png"
    if not guid or not os.path.exists(path):
        return None
    os.makedirs(f"{out}/skills", exist_ok=True)
    with Image.open(path) as picture:
        picture = picture.convert("RGBA")
        picture.thumbnail((ICON_SIZE, ICON_SIZE), Image.LANCZOS)
        picture.save(f"{out}/skills/{guid}.png", optimize=True)
    return f"skills/{guid}.png"


def build_skills(src, export, out):
    texts = [load_texts(f"{export}/loca/{lang}.tsv") for lang in LANGUAGES]

    def loca(value):
        names = [t.get(value) for t in texts]
        return names if all(names) else None

    with open(glob.glob(f"{src}/SkillTreeResource/*.json")[0], encoding="utf-8") as f:
        tree = json.load(f)
    nodes, resolved, with_k = [], 0, 0
    for n in tree["nodes"]:
        name, desc = loca(n["name"]["value"]), loca(n["description"]["value"]) or ["", ""]
        if not name:
            continue
        per = loca(n["perLevelEffectDescription"]["value"]) if n["perLevelEffectDescription"]["value"] else None
        levels = max(1, n["maxLevel"])
        scaled = next((c["$value"] for c in n["configValues"]["scaled"] if c["$value"]["function"] == "Linear"), None)
        vals = None
        if scaled:
            percentage = scaled["valueFormat"] == "Percentage"
            vals = [number(scaled["scaleFactor"] * level, percentage) for level in range(1, levels + 1)]
        if any("%k" in t for t in desc):
            with_k += 1
            resolved += bool(vals)
        nodes.append({
            "id": n["id"]["value"], "x": round(n["uiPosition"]["x"]), "y": round(n["uiPosition"]["y"]),
            "type": TYPES[n["type"]], "icon": write_icon(export, out, n["iconActive"]["image"]),
            "cls": n["classAlignment"], "name": name, "desc": desc,
            "label": None, "attr": None, "gain": 0, "flame": False,
            "cost": n["costs"], "max": levels, "vals": vals, "per": per,
        })
        if n["type"] == "Attribute":
            effect, big = GAIN.search(desc[1]), FLAME.search(desc[1])
            if effect and effect.group(1) in ATTRIBUTES:
                nodes[-1].update(attr=ATTRIBUTES[effect.group(1)], gain=int(effect.group(2)))
            elif big and big.group(1) in ATTRIBUTES:
                nodes[-1].update(attr=ATTRIBUTES[big.group(1)], flame=True)
    # name the start points by where they stand around the centre
    names_en = {}
    for key, fr_text in texts[0].items():
        if fr_text in SPECIALIZATIONS and key in texts[1]:
            names_en.setdefault(fr_text, []).append(texts[1][key])
    roots = [n for n in nodes if n["type"] == "Root"]
    cx, cy = sum(n["x"] for n in roots) / len(roots), sum(n["y"] for n in roots) / len(roots)
    for n in roots:
        angle = math.degrees(math.atan2(n["y"] - cy, n["x"] - cx))
        fr_name = SPECIALIZATIONS[round(((angle - START_ANGLE) % 360) / 30) % len(SPECIALIZATIONS)]
        en_name = max(set(names_en.get(fr_name, [fr_name])), key=names_en.get(fr_name, [fr_name]).count)
        n["label"] = [fr_name, en_name]
    ids = {n["id"] for n in nodes}
    links = [[l["sourceNode"]["value"], l["targetNode"]["value"]] for l in tree["links"]
             if l["sourceNode"]["value"] in ids and l["targetNode"]["value"] in ids]
    # a start point has the class of the nodes around it (the game tints its label with it)
    by_id = {n["id"]: n for n in nodes}
    for n in roots:
        around = [by_id[b if a == n["id"] else a]["cls"] for a, b in links if n["id"] in (a, b)]
        around = [c for c in around if c != "Neutral"]
        if around:
            n["cls"] = max(set(around), key=around.count)
    kinds = {}
    for n in nodes:
        kinds[n["type"]] = kinds.get(n["type"], 0) + 1
    print(f"skills: {len(nodes)} nodes {kinds}, {len(links)} links, {with_k} descriptions with a value, "
          f"{resolved} of them resolved, {sum(1 for n in nodes if n['icon'])} with an icon, "
          f"{sum(1 for n in nodes if n['attr'])} raising an attribute, specializations "
          f"{[n['label'][1] for n in roots]}", flush=True)
    return {"budget": BUDGET, "nodes": nodes, "links": links}
