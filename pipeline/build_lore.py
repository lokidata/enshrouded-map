"""Lore notes and quests of the game's journal, for the app: writes lore.json (called by build_data.py).

  {"categories": {id: [fr, en]},                          where a note is found (region, theme)
   "notes":  [{"id", "name": [fr, en], "cat": id | None, "priority": n,
               "pages": [{"name": [fr, en], "text": [fr, en], "kid": n}]}],   kid = the id of the page in a save's player_knowledge
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

import languages

TAGS = re.compile(r"<[^>]*>")

# Quest.source as the game names it: a character, or the region of a world quest
GIVERS = {
    "Flame": (dict(fr="La Flamme", en="The Flame", de="Die Flamme"), False), "Alchemist": (dict(fr="Alchimiste", en="Alchemist", de="Alchemist"), False),
    "Blacksmith": (dict(fr="Forgeron", en="Blacksmith", de="Schmied"), False), "Huntress": (dict(fr="Chasseresse", en="Huntress", de="Jägerin"), False),
    "Farmer": (dict(fr="Fermier", en="Farmer", de="Bauer"), False), "Carpenter": (dict(fr="Charpentier", en="Carpenter", de="Schreiner"), False),
    "CryptKeeper": (dict(fr="Fossoyeur", en="Crypt Keeper", de="Gruftwächter"), False), "Barber": (dict(fr="Barbier", en="Barber", de="Barbier"), False),
    "Bard": (dict(fr="Barde", en="Bard", de="Barde"), False), "Fisher": (dict(fr="Pêcheur", en="Fisher", de="Fischer"), False),
    "AncientResearcher": (dict(fr="Chercheur des Anciens", en="Ancient Researcher", de="Erbauer-Forscherin"), False),
    "ChineseNewYearTrader": (dict(fr="Marchand du Nouvel An lunaire", en="Lunar New Year Trader", de="Mondneujahrs-Händlerin"), False),
    "Grassland": (dict(fr="Hautes pâtures", en="Springlands", de="Hochweiden"), True), "Deepforest": (dict(fr="Bois envoûtés", en="Revelwood", de="Düsterdickicht"), True),
    "Steppes": (dict(fr="Plateaux nomades", en="Nomad Highlands", de="Nomaden-Anhöhen"), True), "Desert": (dict(fr="Regs exaltés", en="Kindlewastes", de="Ödland"), True),
    "ColdHeights": (dict(fr="Sommets de l'Albaneve", en="Albaneve Summits", de="Albapracht-Gipfel"), True),
    "Wetlands": (dict(fr="Bassin des eaux voilées", en="Veilwater Basin", de="Wogschimmer-Grund"), True),
    "AncientLands": (dict(fr="Berceau des cendres", en="Cinder's Cradle", de="Glimmkessel"), True),
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
    texts = languages.load_all(export, load_texts)

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
        pages = [{"name": loca(e["name"]["value"]) or name, "text": loca(e["text"]["value"]),
                  "kid": e["knowledgeRequirement"]["knowledgeOrQueryId"]["value"]}
                 for e in c["entries"] if loca(e["text"]["value"])]
        if not name or not pages:
            skipped += 1
            continue
        cat = c["loreCategory"]["value"]
        if cat and loca(cat):
            categories[str(cat)] = loca(cat)
        notes.append({"id": str(c["entryId"]["value"]), "name": name, "cat": str(cat) if cat and loca(cat) else None,
                      "priority": c["priority"], "pages": pages})
    notes.sort(key=lambda n: (-n["priority"], n["name"][languages.FR]))

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
    givers = {k: {"name": languages.row(GIVERS[k][0]), "region": GIVERS[k][1]} for k in GIVERS
              if any(q["giver"] == k for q in quests)}
    items = {g: {"name": item_names[g], "icon": write_item_picture(export, out, g)} for g in sorted(used)}
    print(f"lore: {len(notes)} notes ({sum(len(n['pages']) for n in notes)} pages, {skipped} empty left out), "
          f"{len(categories)} categories, {len(quests)} quests, {len(items)} reward items; "
          f"quests without a known giver: {unknown}", flush=True)
    return {"categories": categories, "notes": notes, "quests": quests, "givers": givers, "items": items}
