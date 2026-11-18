"""The languages of the data files, in one place.

GAME_NAMES: site language code -> the name of the entry in the game's LocaTagCollectionResource (also the
name of export/loca/<name>.tsv). BUILD: the codes this run writes, in order; the data files hold name arrays
indexed by the position in BUILD, and map-data.json "languages" is BUILD. To add a language: put its code in
BUILD (its loca file must exist), add its texts to the hand tables (they fall back to English, then French,
and the run prints how many fell back), add it to frontend/src/app/core/lang.ts and
backend/app/schemas/settings.py, and write frontend/public/i18n/<code>.json.
"""

GAME_NAMES = {
    "de": "De_De", "en": "En_Us", "es": "Es_Es", "fr": "Fr_Fr", "it": "It_It", "ja": "Ja_Jp", "ko": "Ko_Kr",
    "pl": "Pl_Pl", "pt": "Pt_Br", "ru": "Ru_Ru", "th": "Th_Th", "tr": "Tr_Tr", "uk": "Uk_Ua", "zh": "Zh_Cn",
    "zh-tw": "Zh_Tw",
}
BUILD = ("fr", "en", "de")
FR, EN = BUILD.index("fr"), BUILD.index("en")  # positions: French is matched by name in a few places

FALLBACKS = ("en", "fr")
fallen_back = {}  # what was missing, by language code: printed once by report()


def tr(table, code):
    """A hand-written text for a language: table is {code: text}; missing -> English, then French (counted)."""
    if table.get(code):
        return table[code]
    for other in FALLBACKS:
        if table.get(other):
            fallen_back[code] = fallen_back.get(code, 0) + 1
            return table[other]
    raise KeyError(f"no text in {sorted(table)} for {code}: add an 'en' or 'fr' entry")


def row(table):
    """A hand table entry {code: text} as a name array, in BUILD order."""
    return [tr(table, code) for code in BUILD]


def fill_missing(locas):
    """Each non-English loca gets the English text of the ids it lacks, so that no name is blank."""
    english = locas[EN]
    for code, loca in zip(BUILD, locas):
        if code == "en":
            continue
        missing = [k for k in english if k not in loca]
        for k in missing:
            loca[k] = english[k]
        if missing:
            fallen_back[code + " (game texts)"] = fallen_back.get(code + " (game texts)", 0) + len(missing)
    return locas


def load_all(export, loader):
    """Every BUILD language's loca file read with `loader(path)`, missing texts filled from English."""
    return fill_missing([loader(f"{export}/loca/{GAME_NAMES[code]}.tsv") for code in BUILD])


def report():
    for code, n in fallen_back.items():
        print(f"language {code}: {n} texts fell back to English")
