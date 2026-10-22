"""Extracts trees, bushes and rocks placed in the world (for the map texture).

Usage: python extract_props.py <unpacked_dir> <export_dir> <out.npz>

Reads the RenderModelChunkModelResource chunks of the main scene and keeps
the instances that sit on the ground surface (underground models are dropped
by comparing their height with the base height map).
"""
import glob
import json
import re
import sys

import numpy as np

MAIN_SCENE = "509feadb-4c60-425f-9c7c-deeefd9b6920"
WORLD_HEIGHT = 2560.0

KINDS = [  # (kind id, regex on the model name), first match wins
    (0, re.compile(r"underworld|_below_|interior|cave|mine", re.I)),           # skipped
    (1, re.compile(r"tree|palm|pine|lupuna|mangrove|birch|oak|fir|spruce|willow", re.I)),
    (2, re.compile(r"bush|shrub|plant|bamboo|fern|hedge|reed", re.I)),
    (3, re.compile(r"rock|stone|boulder|cliff", re.I)),
]


def model_names(src):
    names = {}
    for p in glob.glob(f"{src}/RenderModel/*.json"):
        with open(p, encoding="utf-8") as f:
            head = f.read(4000)
        m = re.search(r'"debugName": "([^"]*)"', head)
        names[p.split("\\")[-1].split("/")[-1][:36]] = m.group(1) if m else ""
    return names


def kind_of(name):
    for kind, rx in KINDS:
        if rx.search(name):
            return kind
    return None


def main(src, export, out):
    names = model_names(src)
    kinds = {}
    base = np.fromfile(f"{export}/map/_map_shader_parameters_baseHeight.r16", dtype="<u2").reshape(1280, 1280)
    height = base.astype(np.float32) / 65535.0 * WORLD_HEIGHT  # row 0 = north

    rows = []
    for p in glob.glob(f"{src}/RenderModelChunkModelResource/{MAIN_SCENE}_*.json"):
        with open(p, encoding="utf-8") as f:
            chunk = json.load(f)
        ox = chunk["origin"]["x"] / 2**32
        oy = chunk["origin"]["y"] / 2**32
        oz = chunk["origin"]["z"] / 2**32
        guids = chunk["modelGuids"]
        for inst in chunk["instances"]:
            guid = guids[inst["modelIndex"]]
            if guid not in kinds:
                kinds[guid] = kind_of(names.get(guid, ""))
            kind = kinds[guid]
            if not kind:
                continue
            pos = inst["position"]
            rows.append((ox + pos["x"], oy + pos["y"], oz + pos["z"], inst["scale"], kind))

    props = np.array(rows, np.float32)
    x, y, z = props[:, 0], props[:, 1], props[:, 2]
    col = np.clip((x / 8).astype(int), 0, 1279)
    row = np.clip(1279 - (z / 8).astype(int), 0, 1279)
    ground = height[row, col]
    diff = y - ground
    print(f"{len(props)} props, height above ground: median {np.median(diff):.1f} m, "
          f"p5 {np.percentile(diff, 5):.1f}, p95 {np.percentile(diff, 95):.1f}")
    keep = diff > -25
    props = props[keep]
    print(f"kept {len(props)} on the surface:",
          {k: int((props[:, 4] == k).sum()) for k in (1, 2, 3)})
    np.savez_compressed(out, props=props)


if __name__ == "__main__":
    main(*sys.argv[1:4])
