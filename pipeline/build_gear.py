"""Equipment stats and character constants, for the build screen: writes gear.json (called by build_data.py).

  {"constants": {name: value},   game balancing values (BalancingTable): every number, string and list of numbers
                                  it holds, plus armorOffset / armorGradient and comfortBase / comfortFactor
   "player": {attribute: value},  base values of the player character (template "1_Player"), named like the
                                  game's attributes (AttributeContainerResource), see PLAYER below
   "rested": {name: value},       the constants of the Rested buff's impact program (see PLAYER below)
   "colors": {rarity: "#rrggbb"}, rarity colours of the game's UI (common, uncommon, rare, epic, legendary...)
   "texts": {path: [fr, en]},     the game's UI labels of the Attributes and Character screens, by their path in
                                  the UI bundle (/rpgTerms/attributes/<row>/displayInfo/label | alternativeLabel |
                                  tooltip, /rpgTerms/attributes/group*, /rpgTerms/rarity*, /inventory/equipmentMenu/*,
                                  /itemEquipmentSlots/*...); %k stands for a value
   "ui": {texture name: "ui/<guid>.png"},  the pictures exported by the mod's `ui` option (perk icons perk_*,
                                  skill node frames skillnode_*, equipmentslot_*, buff_*, item_rarity...)
   "items": {guid: {"name": [fr, en], "slot": one of SLOTS, "rarity": ItemInfo.rarity, "lvl": [min, max],
                    "icon": "items/<guid>.png" | absent,
                    "type": weapon family (build_craft.weapon_type, weapons only),
                    "armor": {kind: share},      armour pieces, kinds of ARMOR, only the non-zero ones
                    "block": quality,            shields
                    "gem": chance,               weapons: chance the item has a gem slot (1 = always: its
                                                 gemSlotOverride is set, else gemSlotProbability of its rarity);
                                                 the slot unlocks once every upgrade is taken (game text)
                    "parry": n,                  ParryProficiency_Base the item adds (helmets, shields, two-handed
                                                 weapons); the screen shows another number, see below
                    "damage": {"mod": damage factor, "speed": speed factor, "hands": 1 | 2,
                               "attr": attribute key the weapon scales with (skills.json "attr") | None,
                               "types": {kind: share}},   kinds of DAMAGE, only the non-zero ones
                    "stats": [stat], "upgrades": [upgrade]}}}

  upgrade = {"name": [fr, en] | None, "armor": {kind: share}, "stats": [stat],
             "icon": "ui/<guid>.png" | None, "desc": [fr, en] | absent, "skill": skills.json node id | absent}
  (a perk that raises a skill by one level, like Purification, has "skill" and the gold coin icon)
  upgrade "damage": {"type": kind of DAMAGE, "share": s, "label": [fr, en]}  (weapons only, Perk.damageModifier:
             8 perks Perk_Damage_*, all s = 0.1) adds s x the weapon's base damage (weaponBaseDamage(L) x dmgMod, L =
             the item's current level) of that kind; "name" is then the label (/rpgTerms/perkAttributes/*) and the
             card's second line is /inventory/damagePerkDescription ("%k of base damage"). Checked on the card of an
             Ornate Greatsword at level 16 (+5.1 Cutting Damage, 10 % of base damage, on each of the 3 perks).
  The card's "Damage" column of upgrade n is trunc(base(L+n) x dmgMod) - trunc(base(L+n-1) x dmgMod): same card,
  +3 +1 +3 +2 +3 from level 12 to 16 (dmgMod 1.5). How the perks' damage adds to the hit is in the game's code.
  Durability (the card's 288 / 392) is not in the item data: BalancingTable durabilityStart, durabilityGrowth and
  rarityDurabilityMod exist, the formula combining them is in the game's code (not derived). The attack speed
  is the "Attack Speed" stat in ms (774); the card shows it truncated to 0.1 s (0.7s).

  stat = {"id": loca id of the line, "name": [fr, en], "value": n, "format": "Normal" | "Percentage" | "Duration"
          | "DurationMilliseconds"}, the tooltip lines of the item as the game writes them (Percentage: 6 = 6%,
          Duration: as given, "Attack Speed" is in ms). One stat can have several ids (an item's line and an
          upgrade's line): group by name.

The optional fields are absent when the game has no value. Armour of a piece of item level L, for each kind:
round(share * (armor.offset + armor.gradient * L)) (constants "armorOffset", "armorGradient"). `lvl` is the level
of the item as found; each upgrade raises it by 1 and adds the upgrade's armour shares at that level, so upgrade
n (1-based) of an item of level L gives round(share * (offset + gradient * (L + n))) and the item's own armour
is then counted at L + number of upgrades. Checked against the wiki (Warlock, Soldier, Mercenary helmets and
their upgrades) and against the game's item card of a Tank Helmet (lvl 10, 5 upgrades = "NIVEAU 15/15"):
physical 22 / magical 12, the card's armour column per upgrade (+1/+0, +1/+1, +2/+1, +1/+1, +1/+0) is the rise of
the base armour from level 10+n-1 to 10+n, and the upgrades give +6 blunt (at 11), +6 pierce (12), +7 cut (14).
`upgrades` are the item's perks in order (common to legendary); the game unlocks at most 5 (5 perk slots per
equipped item). The card showed that helmet as "Légendaire" although ItemInfo says Rare: the rarity shown rises
with the upgrades (rule not in the data). The upgrade cost (Runes = constants.perkCostItem, Legendary Runes =
advancedPerkCostItem from upgrade advancedPerkCostStartLevel) uses perkUpgradeCostSeed, perkCostCreep and
perkCostFactor*; the formula is in the game's code, not in the data. The card's "Améliorer à : Forgeron" is the
workshop of the item's recipe (craft.json).

Constants are the BalancingTable values as named by the game; how the game combines them is in its code, not
in the data. Checked against the game's Attributes screen: the Flame raises the six attributes by
apPerFlameLevel per Flame level above 1, ranged / magic / melee damage = damageScalePerAttributePoint per point
of dexterity / intelligence / strength, oxygen = playerBaseOxygen seconds. Not checked (the screen shows more,
from food, skills or gear): health = playerBaseHealth + playerHealthPerAP * constitution, mana and stamina the
same with spirit and endurance, Shroud time = playerBaseFogResistance + playerFogResistancePerFlameLevel * Flame
level seconds (Flame 4: 8 min; the screen showed 11 min, which Inner Fires 3/3 = 3 x 60 s would explain).

PLAYER: the player template gives, as the game names them (all checked against the Attributes screen, level 20):
CritChance_Base 0.05 (5 %), CritChance_Max 0.75, CritDamageMod_Base 1.5 (+150 %), DamageModSneak_Base 10 (+900 %),
DamageModMerciless_Base 6 (+500 %), DamageModBackstab_Multiplier 1.1 (+10 %), DamageModSkillShot_Base 1 (0 %),
HealingMod_Base 1 (0 %), Revive_Delay_Base 6 (s), Revive_Healing_Percentage 0.1 (10 %), Health_Max_Base /
Mana_Max_Base / Stamina_Max_Base 100, Health_Recharge 0, Mana_Recharge 5, Stamina_Recharge 50 (per 5 s, the
tooltip says), *_RechargeTimeout 500 (ms: the 0.50 s delays), Armor_*_Blowthrough 0.4, WeaponCategoryDamageMod_*,
DamageModAgainst_*, *DamageMod_* (multipliers, 1 = +0 %). Skill nodes change these attributes (skills.json
"effects"), gear and food too. The XP needed per level after level 5 (experienceNeedPerLevel stops there) is
not in the data: the wiki's floor(7100 + 112.5 * (L - 7)) gives 8562 at level 20 as the game's screen does.
Parry and block: "parry" / "block" are the item's ParryProficiency_Base and blockSetup.quality; the shown numbers
come from enshrouded.exe (parryPower / blockPower in frontend gear.logic.ts, from the constants here): block of
Riptide (0.25) at level 16 = 15 as the game shows; parry also uses the world's enemyStaminaFactor (1 by default).
"rested" holds the Rested buff's program constants: it adds Stamina_Max_Increase and Stamina_Recharge_Increase
times (attribute + 2) / 5 to Stamina_Max_Adder and Stamina_Recharge, the attribute being "Level" (the program's
own entity level: probably the comfort level, unverified).
"""
import glob
import json
import os
import shutil
import struct
import uuid

SLOTS = {"Armour_Head": "Head", "Armour_Arms": "Hands", "Armour_UpperBody": "Chest", "Armour_LowerBody": "Legs",
         "Armour_Feet": "Feet", "Armour_Ring": "Ring", "Shield": "Shield", "Backpack": "Backpack",
         "MeleeWeapon": "Weapon", "RangeWeapon": "Weapon", "MidRangeWeapon": "Weapon"}
ARMOR = {"physical": "physical", "cut": "cut", "pierce": "pierce", "blunt": "blunt", "magical": "magical",
         "fire": "fire", "ice": "ice", "fog": "shroud", "lightning": "shock"}
DAMAGE = {"physicalCutDamage": "cut", "physicalPierceDamage": "pierce", "physicalBluntDamage": "blunt",
          "magicalFireDamage": "fire", "magicalIceDamage": "ice", "magicalFogDamage": "shroud",
          "magicalLightningDamage": "shock", "poisonDamage": "poison", "healing": "healing"}
TEXTS = ("/rpgTerms/attributes/", "/rpgTerms/rarity", "/rpgTerms/comfort", "/rpgTerms/restedBuff",
         "/inventory/equipmentMenu/", "/inventory/upgrade", "/inventory/enhancementsHeader", "/itemEquipmentSlots/",
         "/rpgTerms/perkAttributes/", "/inventory/damagePerkDescription", "/inventory/gemSlotHeader",
         "/inventory/lockedGemSlot")
FLOAT = 3902764048  # impact value type of a float (the others read here are integers)


def shares(distribution, names):
    return {names[k]: round(v, 4) for k, v in distribution.items() if k in names and v}


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def attribute_names(src):
    """{hash of an attribute guid: attribute name} and {component name: names of its values}."""
    container = load(glob.glob(f"{src}/AttributeContainerResource/*.json")[0])
    ids, parts = {}, {}
    for a in container["attributes"]:
        parts[a["debugNames"][0]] = a["debugNames"]
        ids.update((i["value"], n) for i, n in zip(a["ids"], a["debugNames"]))
    return ids, parts


def impact_programs(src):
    return {d["programGuid"]: d for d in map(load, glob.glob(f"{src}/ImpactProgram/*.json"))}


def program_constants(program, ids):
    """The values an impact program holds itself: {name: number | attribute name}."""
    from build_data import fnv_guid
    data, out = bytes(program["data"]), {}
    for x in program["dataLayout"]:
        raw, name = data[x["offsetInBytes"]:x["offsetInBytes"] + x["size"]], x["dbgName"].removesuffix("::value")
        if x["size"] == 16 and name.endswith("attributeRef"):
            out[name] = ids.get(fnv_guid(str(uuid.UUID(bytes_le=raw))))
        elif x["configId"]["value"] and x["size"] == 4:
            out[name] = round(struct.unpack("<f" if x["type"]["value"] == FLOAT else "<i", raw)[0], 4)
    return out


def player_base(src, parts):
    """Base attribute values of the player template, by attribute name."""
    for p in glob.glob(f"{src}/TemplateResource/*.json"):
        with open(p, encoding="utf-8") as f:
            if '"name": "1_Player"' not in f.read(200):
                continue
        player = {}
        for c in load(p)["components"]:
            names, values = parts.get(c["$type"].split("::")[-1]), (c["$value"] or {}).get("dataStorage")
            if names and values and len(names) == len(values):
                player.update((n, round(v, 4)) for n, v in zip(names, values))
        return player
    return {}


def ui_texts(src, locas):
    """The UI bundle's labels under TEXTS: {path: [fr, en]}."""
    from build_data import fnv_guid
    out = {}

    def walk(v, path):
        if isinstance(v, dict):
            for k, x in v.items():
                walk(x, f"{path}/{k}")
        elif isinstance(v, list):
            for i, x in enumerate(v):
                walk(x, f"{path}[{i}]")
        elif isinstance(v, str) and path.startswith(TEXTS) and len(v) == 36:
            names = [lang.get(fnv_guid(v)) for lang in locas]
            if all(names):
                out[path] = names
    bundle = load(glob.glob(f"{src}/FbUiBundle/*.json")[0])
    walk(bundle["locatags"], "")
    # colours are stored ABGR
    colors = {k: "#%02x%02x%02x" % (c["value"] & 255, c["value"] >> 8 & 255, c["value"] >> 16 & 255)
              for k, c in bundle["globalColors"]["rarity"].items() if isinstance(c, dict)}
    return out, colors


def ui_pictures(export, out):
    """Copies the mod's ui/ export to out/ui: {texture name: "ui/<guid>.png"}."""
    index = f"{export}/ui/index.tsv" if export else ""
    if not os.path.exists(index):
        return {}
    os.makedirs(f"{out}/ui", exist_ok=True)
    pictures = {}
    with open(index, encoding="utf-8") as f:
        for guid, name in (line.rstrip("\n").split("\t") for line in f if line.strip()):
            shutil.copyfile(f"{export}/ui/{guid}.png", f"{out}/ui/{guid}.png")
            pictures[name] = f"ui/{guid}.png"
    return pictures


def build_gear(src, locas, export=None, out=None):
    from build_craft import weapon_type
    from build_data import fnv_guid, write_item_picture
    from build_skills import ATTRIBUTES

    def loca(ident):
        names = [lang.get(ident) for lang in locas]
        return names if all(names) else None

    def stats(values):
        return [{"id": u["locaId"]["value"], "name": loca(u["locaId"]["value"]), "value": u["value"],
                 "format": u["valueFormat"]} for u in values if loca(u["locaId"]["value"])]

    table = load(glob.glob(f"{src}/BalancingTable/*.json")[0])
    constants = {k: v for k, v in table.items() if not k.startswith("$") and (
        isinstance(v, (int, float, str)) or isinstance(v, list) and all(isinstance(x, (int, float)) for x in v))}
    constants.update(armorOffset=table["armorSetup"]["offset"], armorGradient=table["armorSetup"]["gradient"],
                     comfortBase=table["comfortSetup"]["base"], comfortFactor=table["comfortSetup"]["factor"])
    ids, parts = attribute_names(src)
    programs = impact_programs(src)
    parry_ids = {x["configId"]["value"] for d in programs.values() for x in d["dataLayout"]
                 if x["dbgName"] == "ParryProficiency_Base::value"}
    buffs = load(glob.glob(f"{src}/BuffTypeCollectionResource/*.json")[0])["buffs"]
    rested = next(b["impact"] for b in buffs if b["slot"] == "Rested")
    texts, colors = ui_texts(src, locas)
    pictures = ui_pictures(export, out)
    exported = set(pictures.values())
    attributes = {}  # BaseAttributeResource guid -> attribute key
    for p in glob.glob(f"{src}/BaseAttributeResource/*.json"):
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        if d["debugNames"][0] in ATTRIBUTES:
            attributes[d["$guid"]] = ATTRIBUTES[d["debugNames"][0]]
    perks = {}
    for p in glob.glob(f"{src}/Perk/*.json"):
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        perk = {"name": loca(fnv_guid(d["name"])) if d["name"] else None,
                "armor": shares(d["perkArmorSetup"]["distribution"], ARMOR) if d["perkArmorSetup"]["isSet"] else {},
                "stats": stats(d["uiValues"]),
                "icon": f"ui/{d['icon']['image']}.png" if f"ui/{d['icon']['image']}.png" in exported else None}
        if d["damageModifier"]["isSet"]:
            # the perk's own name is missing or wrong ("Heavy"): the card shows the label of its damage kind
            key, share = next((k, v) for k, v in d["damageModifier"]["distribution"].items() if k in DAMAGE and v)
            label = texts.get("/rpgTerms/perkAttributes/damage" + key[0].upper() + key[1:].removesuffix("Damage"))
            perk["damage"] = {"type": DAMAGE[key], "share": round(share, 4), "label": label}
            perk["name"] = label
        if d["description"] and loca(fnv_guid(d["description"])):
            perk["desc"] = loca(fnv_guid(d["description"]))
        skill = next((c["$value"]["value"]["value"] for c in d["impactValues"]["simple"]
                      if c["$type"] == "keen::impact::SkillIdConfig"), None)
        if skill:
            perk["skill"] = skill
        perks[d["$guid"]] = perk

    items = {}
    for p in glob.glob(f"{src}/ItemInfo/*.json"):
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        slot = SLOTS.get((d.get("equipment") or {}).get("slot"))
        name = loca(fnv_guid(d["name"])) if d.get("name") else None
        if not slot or not name or d["category"] not in ("Equipment", "Weapons"):
            continue
        item = {"name": name, "slot": slot, "rarity": d["rarity"],
                "lvl": [d["itemLevelRange"]["minLevel"], d["itemLevelRange"]["maxLevel"]]}
        if export and write_item_picture(export, out, d["$guid"]):
            item["icon"] = f"items/{d['$guid']}.png"
        parry = next((c["$value"]["value"] for c in d["impactValues"]["simple"]
                      if c["$value"]["configId"]["value"] in parry_ids), None)
        if parry:
            item["parry"] = round(parry, 4)
        if d["armorSetup"]["isSet"]:
            item["armor"] = shares(d["armorSetup"]["distribution"], ARMOR)
        if d["blockSetup"]["isSet"]:
            item["block"] = round(d["blockSetup"]["quality"], 4)
        if d["category"] == "Weapons":
            item["gem"] = 1.0 if d["gemSlotOverride"]["isSet"] else round(table["gemSlotProbability"].get(
                d["rarity"].lower(), 0), 4)
        if slot == "Weapon" and d["damageSetup"]["isSet"]:
            item["type"] = weapon_type(d["debugName"])
            setup = d["damageSetup"]
            attr = next((attributes.get(c["$value"]["value"]) for c in d["impactValues"]["simple"]
                         if c["$type"] == "keen::impact::AttributeReferenceConfig"), None)
            item["damage"] = {"mod": round(setup["dmgMod"], 4), "speed": round(setup["speedMod"], 4),
                              "hands": 2 if item["type"].startswith("TwoHanded") else 1, "attr": attr,
                              "types": shares(setup["distribution"], DAMAGE)}
        item["stats"] = stats(d["uiValues"])
        item["upgrades"] = [perks[g] for g in d["perkReferences"] if g in perks]
        items[d["$guid"]] = item

    by_slot = {}
    for item in items.values():
        by_slot[item["slot"]] = by_slot.get(item["slot"], 0) + 1
    print(f"gear: {len(items)} items {by_slot}, {sum('armor' in i for i in items.values())} with armour, "
          f"{sum(bool(i.get('damage', {}).get('attr')) for i in items.values())} weapons with a scaling attribute, "
          f"{len(perks)} upgrades, {sum('icon' in i for i in items.values())} pictures, "
          f"{sum('parry' in i for i in items.values())} with parry, "
          f"{sum(1 for i in items.values() for u in i['upgrades'] if 'damage' in u)} damage perks, {len(texts)} texts, {len(pictures)} ui pictures",
          flush=True)
    return {"constants": constants, "player": player_base(src, parts), "rested": program_constants(programs[rested], ids),
            "colors": colors, "texts": texts, "ui": pictures, "items": items}
