"""Lore notes and quests of the game's journal, for the app: writes lore.json (called by build_data.py).

  {"categories": {id: [fr, en]},                          where a note is found (region, theme)
   "notes":  [{"id", "name": [fr, en], "cat": id | None, "priority": n,
               "pages": [{"name": [fr, en], "text": [fr, en]}]}],
   "quests": [{"id", "name": [fr, en], "giver": key | None, "main": bool,
               "steps": [{"name": [fr, en], "text": [fr, en]}], "rewards": [guid]}],
   "givers": {key: {"name": [fr, en], "region": bool}},   who gives a quest: a character or a region
   "items":  {guid: {"name": [fr, en], "icon": "items/<guid>.png" | None}}}   rewards of the quests

The journal says where a page is found only through knowledge ids that are not items or markers of the map, so
a note has no position here. Paragraphs of the texts are kept ("\\n").
"""
import glob
import json
import re

LANGUAGES = ("Fr_Fr", "En_Us")
TAGS = re.compile(r"<[^>]*>")

# Quest.source as the game names it: a character, or the region of a world quest
GIVERS = {
    "Flame": (("La Flamme", "The Flame"), False), "Alchemist": (("Alchimiste", "Alchemist"), False),
    "Blacksmith": (("Forgeron", "Blacksmith"), False), "Huntress": (("Chasseresse", "Huntress"), False),
    "Farmer": (("Fermier", "Farmer"), False), "Carpenter": (("Charpentier", "Carpenter"), False),
    "CryptKeeper": (("Fossoyeur", "Crypt Keeper"), False), "Barber": (("Barbier", "Barber"), False),
    "Bard": (("Barde", "Bard"), False), "Fisher": (("Pêcheur", "Fisher"), False),
    "AncientResearcher": (("Chercheur des Anciens", "Ancient Researcher"), False),
    "ChineseNewYearTrader": (("Marchand du Nouvel An lunaire", "Lunar New Year Trader"), False),
    "Grassland": (("Hautes pâtures", "Springlands"), True), "Deepforest": (("Bois envoûtés", "Revelwood"), True),
    "Steppes": (("Plateaux nomades", "Nomad Highlands"), True), "Desert": (("Regs exaltés", "Kindlewastes"), True),
    "ColdHeights": (("Sommets de l'Albaneve", "Albaneve Summits"), True),
    "Wetlands": (("Bassin des eaux voilées", "Veilwater Basin"), True),
    "AncientLands": (("Berceau des cendres", "Cinder's Cradle"), True),
}


def load_texts(path):
    """Loca texts with their paragraphs (the map's loader flattens them into one line)."""
    texts = {}
    with open(path, encoding="utf-8") as f:
        for line in f:
            key, _, text = line.rstrip("\n").partition("\t")
            text = text.replace("\\\\", "\0").replace("\\t", " ").replace("\\r", "").replace("\\n", "\n")
            lines = [" ".join(TAGS.sub("", part).split()) for part in text.replace("\0", "\\").split("\n")]
            texts[int(key)] = "\n".join(p for p in lines if p)
    return texts


def build_lore(src, export, out):
    from build_data import fnv_guid, write_item_picture
    texts = [load_texts(f"{export}/loca/{lang}.tsv") for lang in LANGUAGES]

    def loca(value):
        names = [t.get(value) for t in texts]
        return names if all(names) else None

    item_names = {}
    for p in glob.glob(f"{src}/ItemInfo/*.json"):
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        names = [t.get(fnv_guid(d["name"])) if d.get("name") else None for t in texts]
        if all(names):
            item_names[d["$guid"]] = names

    with open(glob.glob(f"{src}/JournalRegistryResource/*.json")[0], encoding="utf-8") as f:
        journal = json.load(f)

    categories, notes, skipped = {}, [], 0
    for c in journal["collections"]:
        name = loca(c["name"]["value"])
        pages = [{"name": loca(e["name"]["value"]) or name, "text": loca(e["text"]["value"])}
                 for e in c["entries"] if loca(e["text"]["value"])]
        if not name or not pages:
            skipped += 1
            continue
        cat = c["loreCategory"]["value"]
        if cat and loca(cat):
            categories[str(cat)] = loca(cat)
        notes.append({"id": str(c["entryId"]["value"]), "name": name, "cat": str(cat) if cat and loca(cat) else None,
                      "priority": c["priority"], "pages": pages})
    notes.sort(key=lambda n: (-n["priority"], n["name"][0]))

    quests, used, unknown = [], set(), {}
    for q in journal["quests"]:
        name = loca(q["name"]["value"])
        steps = [{"name": loca(e["name"]["value"]) or name, "text": loca(e["text"]["value"])}
                 for e in q["entries"] if loca(e["text"]["value"])]
        if not name or not steps:
            continue
        giver = q.get("source")
        if giver not in GIVERS:
            unknown[giver] = unknown.get(giver, 0) + 1
            giver = None
        rewards = [r["itemRef"] for r in q.get("rewards", ()) if r.get("itemRef") in item_names]
        used.update(rewards)
        quests.append({"id": str(q["entryId"]["value"]), "name": name, "giver": giver,
                       "main": bool(q.get("isMainQuest")), "steps": steps, "rewards": rewards})
    givers = {k: {"name": list(GIVERS[k][0]), "region": GIVERS[k][1]} for k in GIVERS
              if any(q["giver"] == k for q in quests)}
    items = {g: {"name": item_names[g], "icon": write_item_picture(export, out, g)} for g in sorted(used)}
    print(f"lore: {len(notes)} notes ({sum(len(n['pages']) for n in notes)} pages, {skipped} empty left out), "
          f"{len(categories)} categories, {len(quests)} quests, {len(items)} reward items; "
          f"quests without a known giver: {unknown}", flush=True)
    return {"categories": categories, "notes": notes, "quests": quests, "givers": givers, "items": items}
