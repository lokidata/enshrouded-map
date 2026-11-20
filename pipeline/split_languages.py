"""Splits the big data files by language, so that a player downloads the texts of one language only.

For each file in SPLIT, `<name>.json` keeps its structure but every text array (a list with one string per language,
under a key of TEXT_KEYS) becomes `["", "", ""]`, and `<name>.<code>.json` holds the texts of that language as one flat
list, in the order the walk below meets the arrays. The front end (core/texts.ts) walks the base file the same way and
puts the texts back at the language's position. A text array under another key, or anywhere under a `stats` key, stays whole (nothing breaks, it is just
not slimmed). map-data.json and resources.json are not split: their names are the keys of the saved filters.
Usage: python split_languages.py <data dir>
"""
import json
import sys

import languages

SPLIT = ("craft", "gear", "lore", "skills", "gems")
TEXT_KEYS = {"name", "desc", "label", "text"}
KEEP_UNDER = "stats"  # the code matches the English name of an item's stat lines (`name[1]`): they stay whole


def js_order(d):
    """Keys of a dict in the order JavaScript walks them: array indexes first (ascending), then the others as written."""
    ints = sorted((k for k in d if k.isascii() and k.isdigit() and str(int(k)) == k and int(k) < 2**32 - 1), key=int)
    return ints + [k for k in d if k not in set(ints)]


def is_text(key, v, n):
    return key in TEXT_KEYS and isinstance(v, list) and len(v) == n and all(isinstance(s, str) for s in v)


def split_value(v, key, n, out, keep=False):
    """The base copy of v; the texts met are appended to out (out[i] = the list of language i)."""
    if is_text(key, v, n) and not keep:
        for i, s in enumerate(v):
            out[i].append(s)
        return [""] * n
    if isinstance(v, dict):
        return {k: split_value(v[k], k, n, out, keep or k == KEEP_UNDER) for k in js_order(v)}
    if isinstance(v, list):
        return [split_value(x, key, n, out, keep or key == KEEP_UNDER) for x in v]
    return v


def split_file(path_without_ext, codes):
    with open(path_without_ext + ".json", encoding="utf-8") as f:
        data = json.load(f)
    out = [[] for _ in codes]
    base = split_value(data, "", len(codes), out)
    if out[0] and not any(t for texts in out for t in texts):
        raise SystemExit(f"{path_without_ext}.json is already split (its texts are blank): nothing written")
    dump = {"ensure_ascii": False, "separators": (",", ":")}
    with open(path_without_ext + ".json", "w", encoding="utf-8") as f:
        json.dump(base, f, **dump)
    for code, texts in zip(codes, out):
        with open(f"{path_without_ext}.{code}.json", "w", encoding="utf-8") as f:
            json.dump(texts, f, **dump)
    return len(out[0])


def split_all(out_dir, codes=languages.BUILD):
    for name in SPLIT:
        print(f"split {name}: {split_file(f'{out_dir}/{name}', codes)} texts per language", flush=True)


if __name__ == "__main__":
    split_all(sys.argv[1])
