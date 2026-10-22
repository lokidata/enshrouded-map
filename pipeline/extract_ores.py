"""Finds ore deposits in the terrain voxels.

Usage: python extract_ores.py <export_dir> <level> <out.json>

Ores (copper, tin, iron, sulfur...) are voxel materials mined from the
terrain. Every block (8x8 voxel columns) of the level is decoded (voxels.py)
and its ore voxels counted per material; neighbouring blocks with the same
ore are merged into one deposit, placed at the centre of its voxels.

Output: list of {"material": id, "x", "y", "z" (metres), "voxels": count}.
"""
import glob
import json
import os
import sys
from multiprocessing import Pool

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voxels  # noqa: E402

# Voxel material id -> ore (see extract_surface.material_table for the colours).
ORE_MATERIALS = {6, 7, 17, 18, 19, 24, 25, 26, 27, 29, 30, 31, 63, 89, 90}
VOXEL_SIZE = {4: 2.0, 5: 1.0}
MIN_VOXELS = 4   # smaller clusters are stray voxels


def scan_tile(args):
    path, tx, ty = args
    with open(path, "rb") as f:
        data = f.read()
    tile_blocks = data[0]
    out = []  # (block x, block z, material, count, sum x, sum y, sum z) in voxels, world block grid
    ore_ids = np.array(sorted(ORE_MATERIALS), np.uint8)
    for bx, bz, block in voxels.tile_blocks(data):
        try:
            mat, den = voxels.decode_block(block)
        except voxels.CorruptBrick:
            continue
        ore = np.isin(mat, ore_ids) & (den > 0)
        if not ore.any():
            continue
        y, z, x = np.nonzero(ore)
        m = mat[y, z, x]
        gx, gz = tx * tile_blocks + bx, ty * tile_blocks + bz
        for mid in np.unique(m):
            sel = m == mid
            out.append((gx, gz, int(mid), int(sel.sum()),
                        float(x[sel].sum() + sel.sum() * (gx * 8 + 0.5)),
                        float(y[sel].sum() + sel.sum() * 0.5),
                        float(z[sel].sum() + sel.sum() * (gz * 8 + 0.5))))
    return out


def find(parent, a):
    while parent[a] != a:
        parent[a] = parent[parent[a]]
        a = parent[a]
    return a


def main(export, level, out):
    level = int(level)
    tiles = []
    for path in glob.glob(f"{export}/voxels/{level}/*.bin"):
        tx, ty = map(int, os.path.basename(path)[:-4].split("_"))
        tiles.append((path, tx, ty))
    cells = {}
    with Pool() as pool:
        for i, rows in enumerate(pool.imap_unordered(scan_tile, tiles, chunksize=4)):
            for gx, gz, mid, n, sx, sy, sz in rows:
                cells[(gx, gz, mid)] = (n, sx, sy, sz)
            if i % 200 == 0:
                print(f"{i}/{len(tiles)} tiles", flush=True)

    # Merge 8-connected blocks of the same material.
    keys = list(cells)
    index = {k: i for i, k in enumerate(keys)}
    parent = list(range(len(keys)))
    for (gx, gz, mid), i in index.items():
        for dx in (-1, 0, 1):
            for dz in (-1, 0, 1):
                j = index.get((gx + dx, gz + dz, mid))
                if j is not None:
                    a, b = find(parent, i), find(parent, j)
                    if a != b:
                        parent[a] = b
    deposits = {}
    for k, i in index.items():
        r = find(parent, i)
        n, sx, sy, sz = cells[k]
        d = deposits.setdefault(r, [k[2], 0, 0.0, 0.0, 0.0])
        d[1] += n
        d[2] += sx
        d[3] += sy
        d[4] += sz
    voxel = VOXEL_SIZE[level]
    result = [{"material": mid, "voxels": n,
               "x": round(sx / n * voxel, 1), "y": round(sy / n * voxel, 1), "z": round(sz / n * voxel, 1)}
              for mid, n, sx, sy, sz in deposits.values() if n >= MIN_VOXELS]
    result.sort(key=lambda d: (d["material"], -d["voxels"]))
    with open(out, "w", encoding="utf-8") as f:
        json.dump(result, f)
    by = {}
    for d in result:
        by[d["material"]] = by.get(d["material"], 0) + 1
    print(f"{len(result)} deposits:", dict(sorted(by.items())))


if __name__ == "__main__":
    main(*sys.argv[1:4])
