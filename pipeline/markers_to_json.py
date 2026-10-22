"""One-off: converts the prototype's markers.js into map-data.json + resources.json.

Usage: python markers_to_json.py <map_dir>
"""
import json
import sys

PREFIX = "window.MAP_DATA = "


def main(d):
    raw = open(f"{d}/markers.js", encoding="utf-8").read().strip()
    data = json.loads(raw[len(PREFIX):].removesuffix(";"))
    resources = data.pop("resources")
    for name, obj in (("map-data", data), ("resources", resources)):
        with open(f"{d}/{name}.json", "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
    counts = {k: sum(len(x["pts"]) // 3 for x in v) for k, v in resources.items()}
    assert counts == {"chest": 2702, "ore": 6632, "plant": 76742}, counts
    print(len(data["markers"]), "markers", counts)


if __name__ == "__main__":
    main(sys.argv[1])
