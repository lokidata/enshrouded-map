"""Extracts the top terrain surface from the exported voxel tiles.

Usage: python extract_surface.py <unpacked_dir> <export_dir> <level> <out.npz>

Decodes every tile of a voxel level (see voxels.py) and keeps, per column,
the height of the highest non-air voxel and its material. Also writes the
material colour table taken from the game's simple world materials.

Output arrays are north-up (row 0 = north edge):
  height   float32, metres
  material uint8, voxel material index
  top, side uint8 [256, 3] sRGB colour of each material's top / side layer
  road     bool [256], road materials
"""
import glob
import json
import os
import struct
import sys
from multiprocessing import Pool

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import voxels  # noqa: E402

# Level -> metres per voxel (world = 10240 m).
VOXEL_SIZE = {2: 8.0, 3: 4.0, 4: 2.0, 5: 1.0, 6: 0.5}
LAYER_TOP, LAYER_SIDE = 1, 2


def decode_tile(args):
    path, tx, ty = args
    with open(path, "rb") as f:
        data = f.read()
    gx, gz = data[0], data[1]
    size = gx * voxels.BRICK
    height = np.full((size, size), -1.0, np.float32)
    material = np.zeros((size, size), np.uint8)
    bad = 0
    for bx, bz, block in voxels.tile_blocks(data):
        try:
            h, m = voxels.block_surface(block)
        except voxels.CorruptBrick:
            bad += 1
            continue
        height[bz * 8:bz * 8 + 8, bx * 8:bx * 8 + 8] = h
        material[bz * 8:bz * 8 + 8, bx * 8:bx * 8 + 8] = m
    return tx, ty, height, material, bad


def material_table(unpacked):
    """Top / side sRGB colours and road flags for the 256 voxel materials.

    Voxel materials 0-127 are terrain materials: their colours are entry
    2 * id of the simple world material table (the odd entries are variants).
    Materials 128-255 are building materials (GiVoxelBuildingMaterial).
    Checked against the item definitions (placeVoxelMaterialId, soilMaterialId).
    """
    srgb = lambda c: int(round(255 * min(1.0, max(0.0, c)) ** (1 / 2.2)))
    top = np.zeros((256, 3), np.uint8)
    side = np.zeros((256, 3), np.uint8)
    road = np.zeros(256, bool)

    with open(glob.glob(f"{unpacked}/SimpleWorldMaterialResource/*.json")[0], encoding="utf-8") as f:
        d = json.load(f)
    info = bytes(d["layerInfosDataBlock"]["data"])
    weights = bytes(d["layerWeightsDataBlock"]["data"])
    block = d["layerPbrMaterialsDataBlock"]
    pbr = bytes(block["data"])
    names = {pp["offset"] // 60: t["texture"]["debugName"] for pp, t in zip(block["patchPoints"], block["textures"])}
    for m in range(128):
        v = struct.unpack_from("<I", info, 2 * m * 4)[0]
        start, count = v & 0x1FF, v >> 9  # 9 bits start, then count
        layers = {}
        for k in range(start, start + count):
            flags = struct.unpack_from("<I", weights, k * 12)[0]
            layers.setdefault(flags, k)
            if "road" in names.get(k, "").lower():
                road[m] = True
        if not layers:
            continue
        first = next(iter(layers.values()))
        t = layers.get(LAYER_TOP, first)
        s = layers.get(LAYER_SIDE, t)
        top[m] = [srgb(c) for c in struct.unpack_from("<3f", pbr, t * 60)]
        side[m] = [srgb(c) for c in struct.unpack_from("<3f", pbr, s * 60)]

    with open(glob.glob(f"{unpacked}/GiVoxelBuildingMaterialResource/*.json")[0], encoding="utf-8") as f:
        building = bytes(json.load(f)["dataBlock"]["data"])
    for i in range(min(128, len(building) // 180)):
        # GiVoxelBuildingMaterial: top, side, bottom GiVoxelMaterial (60 bytes, albedo first)
        top[128 + i] = [srgb(c) for c in struct.unpack_from("<3f", building, i * 180)]
        side[128 + i] = [srgb(c) for c in struct.unpack_from("<3f", building, i * 180 + 60)]
    return top, side, road


def main(unpacked, export, level, out):
    level = int(level)
    tiles = []
    for path in glob.glob(f"{export}/voxels/{level}/*.bin"):
        tx, ty = map(int, os.path.basename(path)[:-4].split("_"))
        tiles.append((path, tx, ty))
    n = max(t[1] for t in tiles) + 1
    with open(tiles[0][0], "rb") as f:
        tile_size = f.read(1)[0] * voxels.BRICK
    size = n * tile_size
    height = np.full((size, size), -1.0, np.float32)
    material = np.zeros((size, size), np.uint8)
    bad = 0
    with Pool() as pool:
        for i, (tx, ty, h, m, b) in enumerate(pool.imap_unordered(decode_tile, tiles, chunksize=4)):
            height[ty * tile_size:(ty + 1) * tile_size, tx * tile_size:(tx + 1) * tile_size] = h
            material[ty * tile_size:(ty + 1) * tile_size, tx * tile_size:(tx + 1) * tile_size] = m
            bad += b
            if i % 200 == 0:
                print(f"{i}/{len(tiles)} tiles", flush=True)
    print(f"{size}x{size} columns, {bad} blocks failed to decode")
    voxel = VOXEL_SIZE[level]
    height = np.where(height >= 0, height * voxel, np.nan).astype(np.float32)[::-1]  # north-up
    material = material[::-1]
    top, side, road = material_table(unpacked)
    print(f"road columns: {road[material].mean() * 100:.2f}%")
    np.savez_compressed(out, height=height, material=material, top=top, side=side, road=road,
                        voxel=np.float32(voxel))


if __name__ == "__main__":
    main(*sys.argv[1:5])
