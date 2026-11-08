"""Weapon gems and house comfort, for the build screen: writes gems.json (called by build_data.py).

  {"gems": [gem], "slot": {...}, "crafting": {...}, "comfort": {...}}

  gem = {"id": guid, "name": [fr, en], "desc": [fr, en] (%k = a value below, in order), "rarity": ItemInfo.rarity,
         "tier": 1..7 (the T<n> of its developer name), "lvl": [min, max] (itemLevelRange, 1..105 for all 29),
         "icon": "items/<guid>.png" | absent,
         "sources": [{"name": [fr, en], "enemy": enemies.json id | absent}]  enemies that carry the gem in their loot
                    inventory (see GEM_DROPS),
         "stats": [{"name": [fr, en], "value": n, "scale": scaleFactor | absent, "fn": scale function | absent,
                    "format": ...}],
         "timesNs": [n]    TimeImpactConfig values (cooldowns / durations; 5000000000 = 5 s if ns, unverified)}
  A gem is not crafted (no recipe) and has no perks: its "upgrade tiers" are its levels, raised at Shroud Forges /
  the Gem Forge ("Refine Gem", "Max Gem Level: %k"). Every scaled line of the 29 gems (uiValues and the impact
  configs alike) has "fn" WeaponPowerCreep and reads the attribute "Level" of the gem itself (sourceEntity Self,
  BaseAttributeResource bbf879a8): the gem's level drives it, not the weapon's. The curve is game code (not found
  in enshrouded.exe); value + scale x constants.powerCreepWeapon x gem level (durations: scale in seconds)
  reproduces in-game samples at level 15 (Bleeding: 14 damage per second for 7.1 s; Toxic Betrayal: damage 8;
  "Normal" lines are Sint32 configs, rounded) but not Toxic Betrayal's 5.2 s (its line and impact config both say
  6 s, the impact program's default is 3 s), so the site shows it as an estimation (`gemValue`, core/gems.logic.ts).
  The %k of a "desc" are NOT in the order of "stats" (Toxic Betrayal, Meteoric Impact): the game's mapping is code.
  Every effect is a trigger (crit, kill, block, orb...): none is a permanent stat of the character. All gems carry
  the same item tag and no weapon category: the data puts no restriction on which socketed weapon takes which gem.
  The max gem level and the cost of a level are game code: not derived here.
  "slot": {"probability": {rarity: chance a found weapon has a gem slot} (gemSlotProbability),
           "weapons": [guid of the weapons whose gemSlotOverride is set: 40, Rare+ only],
           "rule": the game's texts: the weapon must be fully upgraded to unlock the slot}
  "crafting": BalancingTable gemCrafting {maxUpgradeCost, insertBaseCost, extractBaseCost,
              increasePerLevelPercentage, salvageGainPercentage} (names as the game's; units not in the data)
  "comfort": {"constants": {comfortBase, comfortFactor, maximumTotalMusicComfortBuff, maximumInstrumentsCountedForComfort,
                            timePerInstrumentUntilMaxBuff (ns)},
              "rested": {"name": [fr, en], "desc": [fr, en], "lifetimeNs": default duration, "program": the impact
                         program's constants (same as gear.json "rested")},
              "texts": {...}, "categories": [[fr, en]] ("Comfort - Bed"...),
              "furniture": [{"id", "name", "icon", "category": [fr, en], "points": n, "other": [{name, value}]}],
              "instruments": [{"id", "name", "icon", "points": comfortSetup.comfortAmount}]}
  Furniture comfort = the item's "Comfort - <category>" tooltip line (Uint32 impact value).
Gem sources (exact vs unknown). Exact: an enemy's death sequence (ActorSequenceResource, event
TransformToLootEvent.defaultInventory) or its LootContainer_Enemy_* template names a DefaultInventoryResource, and
that inventory lists the gem (itemRef) in its groups; 25 of the 29 gems are in at least one, 4 have no known source (no "sources" key).
Heuristic: the names in GEM_DROPS (the game names none of these enemy templates; they are written from the developer
names, e.g. Enemy_Scavenger_Melee*), and the LootContainer_Enemy_X <-> Enemy_X link, which is by name only.
UNKNOWN: the odds (selector weights and spawnProbability are in the inventories but the roll rules are game code),
gems in chests / vendors / world loot (no DefaultInventoryResource or loot table outside these was found to hold a gem
guid; 7 other resource kinds were searched), and any enemy not listed. "enemy" is set only when enemies.json has it.
NOT in the data (game code): how points add up to a comfort level, the level thresholds, and how the level
sets the Rested duration (the game's texts: comfort "increases the duration of the Rested buff"; higher levels
make it harder). The Rested buff itself (impact program) adds Stamina_Max_Adder and Stamina_Recharge from the
attribute "Level" with constants 2, 5, 4 (recharge) and 8 (max); operand order of the program is ambiguous, and
screenshots (player level 20) showed +41 stamina max and +15 stamina regeneration while rested, which neither
reading reproduces: no per-level numbers are given.
"""
import glob
import json
import re

from build_gear import attribute_names, impact_programs, load, program_constants


# (names, enemies.json id or None, DefaultInventoryResource guids [first 8 chars]); see the docstring
GEM_DROPS = [
    (("Maraudeurs au corps à corps", "Scavenger melee fighters"), None, ["9453a728"]),
    (("Maraudeurs à distance (arbalète, canon, lance-flammes)", "Scavenger ranged fighters (crossbow, cannon, flamethrower)"),
     None, ["fa4f3d61", "42d872f6"]),
    (("Chiens des maraudeurs et loups", "Scavenger hounds and wolves"), None, ["70a65d18"]),
    (("Vukah d'élite au corps à corps", "Vukah elite melee"), None, ["aa7e9284"]),
    (("Chamans vukah", "Vukah shamans"), None, ["c1ab0724", "31db827d"]),
    (("Archers vukah, Tyran de ruche", "Vukah rangers, Hive Tyrant"), "vukah-hive-tyrant", ["d29c5e01"]),
    (("Traqueur du Voile", "Shroud Stalker"), "shroud-stalker", ["700d18b1"]),
    (("Drak d'élite au corps à corps", "Drak elite melee"), None, ["48413d5e"]),
    (("Chevalier noir déchu", "Fell Black Knight"), None, ["2f1a7de8"]),
    (("Soldat d'élite déchu avec bouclier", "Fell elite soldier with shield"), None, ["86313f1d"]),
    (("Banshees déchues", "Fell Banshees"), None, ["3a5650a5", "7791abfd"]),
    (("Squelettes d'élite creux", "Hollow elite skeletons"), None, ["00645e44", "eb6993fb"]),
    (("Nécromanciens creux", "Hollow necromancers"), None, ["fd01ff50", "6730b2db"]),
    (("Sentinelle d'élite (archer)", "Elite Sentinel ranger"), None, ["aecd4d0f"]),
]


def inventory_items(src, short):
    """Item guids in one DefaultInventoryResource (all groups)."""
    found = set()

    def walk(g):
        found.update(s["itemRef"] for s in g.get("stacks", []))
        for x in g.get("groups", []):
            walk(x)
    walk(load(glob.glob(f"{src}/DefaultInventoryResource/{short}*.json")[0])["rootGroup"])
    return found


def gem_sources(src, gem_ids):
    """gem guid -> [{"name": [fr, en], "enemy"?}] from GEM_DROPS."""
    out = {g: [] for g in gem_ids}
    for names, enemy, shorts in GEM_DROPS:
        items = set().union(*(inventory_items(src, s) for s in shorts))
        for g in gem_ids:
            if g in items:
                out[g].append({"name": list(names), **({"enemy": enemy} if enemy else {})})
    return out


def build_gems(src, locas, export=None, out=None):
    from build_data import fnv_guid, write_item_picture

    def loca(ident):
        names = [lang.get(ident) for lang in locas]
        return names if all(names) else None

    def icon(d):
        return f"items/{d['$guid']}.png" if export and write_item_picture(export, out, d["$guid"]) else None

    table = load(glob.glob(f"{src}/BalancingTable/*.json")[0])
    infos = [load(p) for p in glob.glob(f"{src}/ItemInfo/*.json")]
    gems = []
    for d in sorted(infos, key=lambda d: d["debugName"]):
        if d["category"] != "WeaponGem" or not d.get("name") or not loca(fnv_guid(d["name"])):
            continue
        gem = {"id": d["$guid"], "name": loca(fnv_guid(d["name"])), "rarity": d["rarity"],
               "tier": int(re.match(r"T(\d+)_", d["debugName"]).group(1)),
               "lvl": [d["itemLevelRange"]["minLevel"], d["itemLevelRange"]["maxLevel"]]}
        if d.get("description") and loca(fnv_guid(d["description"])):
            gem["desc"] = loca(fnv_guid(d["description"]))
        if icon(d):
            gem["icon"] = icon(d)
        gem["stats"] = [{"name": loca(u["locaId"]["value"]), "value": u["value"], "format": u["valueFormat"],
                         **({"scale": u["scaleData"]["scaleFactor"], "fn": u["scaleData"]["function"]}
                            if u["isScaled"] else {})}
                        for u in d["uiValues"] if loca(u["locaId"]["value"])]
        gem["timesNs"] = [c["$value"]["value"]["value"] for c in d["impactValues"]["simple"]
                          if c["$type"] == "keen::impact::TimeImpactConfig"]
        gems.append(gem)
    for g, srcs in gem_sources(src, [g["id"] for g in gems]).items():
        if srcs:
            next(x for x in gems if x["id"] == g)["sources"] = srcs

    labels = {}
    for d in infos:
        for u in d["uiValues"]:
            n = loca(u["locaId"]["value"])
            if n and n[1].startswith("Comfort - "):
                labels[u["locaId"]["value"]] = n
    furniture = []
    for d in sorted(infos, key=lambda d: d["debugName"]):
        lines = d["uiValues"]
        cat = next((u for u in lines if u["locaId"]["value"] in labels), None)
        if not cat or not d.get("name") or not loca(fnv_guid(d["name"])):
            continue
        item = {"id": d["$guid"], "name": loca(fnv_guid(d["name"])), "category": labels[cat["locaId"]["value"]],
                "points": cat["value"],
                "other": [{"name": loca(u["locaId"]["value"]), "value": u["value"]} for u in lines
                          if u is not cat and loca(u["locaId"]["value"])]}
        if icon(d):
            item["icon"] = icon(d)
        furniture.append(item)
    instruments = [{"id": d["$guid"], "name": loca(fnv_guid(d["name"])), "points": d["comfortSetup"]["comfortAmount"],
                    **({"icon": icon(d)} if icon(d) else {})}
                   for d in sorted(infos, key=lambda d: d["debugName"]) if d["comfortSetup"]["isSet"] and d.get("name")]

    ids, _ = attribute_names(src)
    buff = next(b for b in load(glob.glob(f"{src}/BuffTypeCollectionResource/*.json")[0])["buffs"]
                if b["slot"] == "Rested")
    program = impact_programs(src)[buff["impact"]]
    texts = {}
    for lang_id in (621687412, 931304421, 1453474826, 3207596760, 3444621872, 256646925, 3692838819):
        if loca(lang_id):
            texts[str(lang_id)] = loca(lang_id)
    comfort = {"constants": {k: table[k] if not isinstance(table[k], dict) else table[k]["value"]
                             for k in ("maximumTotalMusicComfortBuff", "maximumInstrumentsCountedForComfort",
                                       "timePerInstrumentUntilMaxBuff")},
               "rested": {"name": loca(fnv_guid(buff["name"])), "desc": loca(fnv_guid(buff["description"])),
                          "lifetimeNs": buff["defaultLifeTime"]["value"], "program": program_constants(program, ids)},
               "texts": texts, "categories": sorted({tuple(v) for v in labels.values()}),
               "furniture": furniture, "instruments": instruments}
    comfort["constants"].update(comfortBase=table["comfortSetup"]["base"], comfortFactor=table["comfortSetup"]["factor"])
    comfort["categories"] = [list(c) for c in comfort["categories"]]
    weapons = [d["$guid"] for d in infos if d["category"] == "Weapons" and d["gemSlotOverride"]["isSet"]]
    print(f"gems: {len(gems)} gems, {len(weapons)} weapons with a gem slot, {len(furniture)} comfort furniture in "
          f"{len(comfort['categories'])} categories, {len(instruments)} instruments", flush=True)
    return {"gems": gems, "slot": {"probability": table["gemSlotProbability"], "weapons": weapons},
            "crafting": table["gemCrafting"], "constants": {"powerCreepWeapon": table["powerCreepWeapon"]},
            "comfort": comfort}
