"""Writes item-names.json: [[internalName, nameFR, nameEN, nameDE, iconGuid], ...] sorted by internal name.

The internal name is the ItemInfo `debugName`, the spelling the chestsort mod's category file uses
(`Material_T2_Bug_Dust`). Only items with a name in every language are listed (the others cannot be shown).
`iconGuid` is the item's guid when the game has a picture for it (served as `items/<guid>.png`), else "".
"""
import glob
import json
import os


def build_item_names(src, locas, export, out=None):
    from build_data import fnv_guid, write_item_picture
    rows = []
    for p in glob.glob(f"{src}/ItemInfo/*.json"):
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        if not d.get("debugName") or not d.get("name"):
            continue
        names = [loca.get(fnv_guid(d["name"])) for loca in locas]
        if not all(names):
            continue
        guid = d["$guid"]
        has_icon = write_item_picture(export, out, guid) if out else os.path.exists(f"{export}/items/{guid}.png")
        rows.append([d["debugName"], *names, guid if has_icon else ""])
    rows.sort(key=lambda r: r[0])
    print(f"item-names: {len(rows)} items, {sum(1 for r in rows if r[-1])} with a picture", flush=True)
    return rows
