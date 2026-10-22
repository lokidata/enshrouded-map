"""Extracts the water mask of the main scene (8 m resolution).

Usage: python extract_water.py <unpacked_dir> <out.png>

Each WaterChunkResource covers 256x256 m (40x40 chunks, part = z * 40 + x)
and stores a 32x32 bit mask of 8 m tiles that contain water, as 16 u64.
The output is north-up, 1280x1280, 255 = water.
"""
import glob
import json
import sys

import numpy as np
from PIL import Image

MAIN_SCENE = "509feadb-4c60-425f-9c7c-deeefd9b6920"
CHUNKS = 40
TILES = 32


def chunk_mask(words):
    bits = np.zeros(TILES * TILES, np.uint8)
    for i, w in enumerate(words):
        for b in range(64):
            bits[i * 64 + b] = (w >> b) & 1
    return bits.reshape(TILES, TILES)  # [z][x], z grows north


def main(src, out):
    mask = np.zeros((CHUNKS * TILES, CHUNKS * TILES), np.uint8)  # row 0 = south
    for p in glob.glob(f"{src}/WaterChunkResource/{MAIN_SCENE}_*.json"):
        part = int(p.rsplit("_", 1)[1].split(".")[0])
        with open(p, encoding="utf-8") as f:
            chunk = json.load(f)
        if not chunk["containsWater"]:
            continue
        cx, cz = part % CHUNKS, part // CHUNKS
        mask[cz * TILES:(cz + 1) * TILES, cx * TILES:(cx + 1) * TILES] = chunk_mask(chunk["waterTileNotEmptyMask"])
    Image.fromarray(mask[::-1] * 255).save(out)
    print(f"water: {mask.mean() * 100:.1f}% of the map")


if __name__ == "__main__":
    main(*sys.argv[1:3])
