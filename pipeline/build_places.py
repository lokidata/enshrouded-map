"""Knowledge ids of the map's places, for the save import (called by build_data.py).

A place the player discovers sets knowledge ids in their save (`player_knowledge`). The game data ties those ids to
quest entities of the scenes (a template name, a position, "unlock operations"). A marker of the map has the same
template name (`raw`) and the same position (within a metre), so each matched marker gets
  "kids": [id, ...]          every knowledge id its entity sets (one is enough to say the place is known)
The app never hashes anything for this: it reads the ids from map-data.json.
"""
import glob
import json
import math
import os

MAX_DISTANCE = 3.0  # metres between a marker and its entity (measured: under 0.8 on the whole map)
CELL = 8


def scene_entities(src):
    """[(template name, x, z, knowledge id)] of every quest entity that unlocks something."""
    names = {}
    for p in glob.glob(f"{src}/TemplateResource/*.json"):
        with open(p, encoding="utf-8") as f:
            text = f.read()
        if '"name"' in text:
            d = json.loads(text)
            names[d["$guid"]] = d.get("name")
    out = []
    for p in glob.glob(f"{src}/SceneResource/*.json"):
        with open(p, encoding="utf-8") as f:
            scene = json.load(f)
        for e in scene["questEntities"]:
            name = names.get(e["templateGuid"])
            if not name:
                continue
            pos = e["transform"]["position"]
            x, z = pos["x"] / 2**32, pos["z"] / 2**32  # fixed point, 32 fractional bits
            for op in e["unlockOperations"]:
                out.append((name, x, z, op["unlockOperation"]["knowledgeId"]["id"]["value"]))
    return out


def attach_kids(src, markers):
    """Adds `kids` to the markers that have an entity of the same name within MAX_DISTANCE; returns how many."""
    grid = {}
    for name, x, z, kid in scene_entities(src):
        grid.setdefault((name, int(x // CELL), int(z // CELL)), []).append((x, z, kid))
    matched = 0
    for m in markers:
        raw = m.get("raw")
        if not raw:
            continue
        cx, cz = int(m["x"] // CELL), int(m["z"] // CELL)
        kids = {kid for dx in (-1, 0, 1) for dz in (-1, 0, 1) for x, z, kid in grid.get((raw, cx + dx, cz + dz), ())
                if math.hypot(x - m["x"], z - m["z"]) <= MAX_DISTANCE}
        if kids:
            m["kids"] = sorted(kids)
            matched += 1
    print(f"places: {matched} markers with knowledge ids", flush=True)
    return matched
