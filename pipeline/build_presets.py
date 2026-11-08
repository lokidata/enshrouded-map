"""Dedicated-server difficulty presets: writes settings-presets.json (called by build_data.py).

  {"version": 1, "presets": {"Default"|"Relaxed"|"Hard"|"Survival": {key: value}},
   "min": {key: value}, "max": {key: value}}

Source: the resource GameSettingsPresetsResource (one file): `presets[].settings` (presetId + 38 keys each, all four
presets are complete: no key is missing) and `minValues` / `maxValues` (the range the server clamps to).
Values are the game's own: the 36 `gameSettings` keys of docs/server-settings.md plus `flameLevelFogRemoval`
(1..11, not in the article) and `randomSpawnerAmount` which can be "Automatic" (the article lists Few / Normal / Many /
Extreme; the Default preset is Automatic). Durations (fromHungerToStarving, dayTimeDuration, nightTimeDuration) are
integers in nanoseconds ({"value": n} in the resource, unwrapped here); enums are strings; float32 noise is rounded
to 4 decimals (0.8999999761581421 -> 0.9). Gaps with docs/server-settings.md are listed in pipeline/README.md.
"""
import glob

from build_gear import load


def unit(v):
    if isinstance(v, dict):
        return v["value"]
    return round(v, 4) if isinstance(v, float) else v


def build_presets(src):
    d = load(glob.glob(f"{src}/GameSettingsPresetsResource/*.json")[0])
    conv = lambda s: {k: unit(v) for k, v in s.items()}  # noqa: E731
    presets = {p["presetId"]: conv(p["settings"]) for p in d["presets"]}
    assert set(presets) == {"Default", "Relaxed", "Hard", "Survival"}, presets.keys()
    print(f"presets: {len(presets)} presets x {len(presets['Default'])} keys", flush=True)
    return {"version": 1, "presets": presets, "min": conv(d["minValues"]), "max": conv(d["maxValues"])}


if __name__ == "__main__":
    import json
    import sys
    with open(f"{sys.argv[2]}/settings-presets.json", "w", encoding="utf-8") as f:
        json.dump(build_presets(sys.argv[1]), f, ensure_ascii=False, separators=(",", ":"))
