"""Renders a top-down world map from the decoded voxel terrain surface.

Usage: python render_map.py <export_dir> <out_dir> [--preview]

Inputs in export_dir:
  surface5.npz  extract_surface.py output (1 m height, material, colours)
  props.npz     extract_props.py output (trees and bushes)
  water.png     extract_water.py output
  map/          map textures exported by the eml mod (FogZone tiles)

Each column takes the colour of its top voxel material (side colour on steep
slopes), lit from the north-west using the real 1 m height field. Roads are
voxel materials, so paths show up as they are in the game. Trees, water and
the Shroud are drawn on top.

Writes a Leaflet tile pyramid to <out_dir>/tiles/{z}/{x}_{y}.jpg where z=0 is
1 px per metre.
"""
import os
import sys

import numpy as np
from PIL import Image, ImageDraw

Image.MAX_IMAGE_PIXELS = None

WORLD = 10240           # metres
TILES = 10              # FogZone source tiles per side
SRC = WORLD // TILES
TILE = 256              # output tile size
LEVELS = 6              # zoom 0 .. -5
VOID_TIER = 16
BACKGROUND = (16, 20, 26)  # matches the #map background in index.html

EXPOSURE = 1.45            # albedo -> displayed colour
ROAD_BOOST = 1.18          # roads slightly lighter so they read like on the game map
LIGHT = np.array([-1.0, -1.0, 1.6])  # towards the light: west, north, up
LIGHT = LIGHT / np.linalg.norm(LIGHT)
# Materials whose flat albedo does not match their look in the game.
COLOR_OVERRIDES = {
    16: (62, 44, 66),   # env_global_fog_essence: floor of the deep Shroud, rendered as dark purple
}
WATER = np.array([52, 98, 124], np.float32)
SHROUD = np.array([96, 46, 120], np.float32)
SHROUD_EDGE = np.array([196, 150, 230], np.float32)


def load_rgba(path):
    return np.asarray(Image.open(path).convert("RGBA"))


def assemble(src, kind, channels):
    """Assembles the 10x10 map tiles of a kind into one north-up array.

    Tile rows are numbered from the south, but each tile's pixels are stored
    north-up (checked against the base height map and the tile seams).
    """
    out = np.zeros((WORLD, WORLD, len(channels)), np.uint8)
    for ty in range(TILES):
        row = TILES - 1 - ty
        for tx in range(TILES):
            tile = load_rgba(f"{src}/map/{kind}_{tx}_{ty}_.png")[..., channels]
            out[row * SRC:(row + 1) * SRC, tx * SRC:(tx + 1) * SRC] = tile
    return out


def void_mask(fog, tier):
    """Void-tier Shroud connected to the map border."""
    candidate = ((fog > 128) & (tier >= VOID_TIER)).astype(np.uint8) * 255
    img = Image.fromarray(candidate).copy()  # fromarray may share the buffer read-only
    h, w = candidate.shape
    for x, y in ((0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)):
        if img.getpixel((x, y)) == 255:
            ImageDraw.floodfill(img, (x, y), 128)
    return np.asarray(img) == 128


def resize(a, size, resample=Image.BILINEAR):
    """Resizes a 2D float array."""
    return np.asarray(Image.fromarray(a.astype(np.float32), "F").resize((size, size), resample))


def props_layer(export, size, scale):
    """Canopy coverage and shadow masks from the placed trees and bushes."""
    canopy = Image.new("L", (size, size), 0)
    shadow = Image.new("L", (size, size), 0)
    path = f"{export}/props.npz"
    if os.path.exists(path):
        dc, ds = ImageDraw.Draw(canopy), ImageDraw.Draw(shadow)
        for x, _, z, s, kind in np.load(path)["props"]:
            r = (2.6 if kind == 1 else 1.4) * float(s) * scale
            px, py = x * scale, (WORLD - z) * scale
            off = 1.2 * r
            ds.ellipse((px - r + off * 0.6, py - r + off, px + r + off * 0.6, py + r + off), fill=150)
            dc.ellipse((px - r, py - r, px + r, py + r), fill=255 if kind == 1 else 170)
    return np.asarray(canopy, np.float32) / 255.0, np.asarray(shadow, np.float32) / 255.0


def render(export, preview=False):
    step = 8 if preview else 1
    size = WORLD // step
    surface = np.load(f"{export}/surface5.npz")
    height = surface["height"][::step, ::step]
    material = surface["material"][::step, ::step]
    top = surface["top"].astype(np.float32)
    side = surface["side"].astype(np.float32)
    road = surface["road"]
    for m, c in COLOR_OVERRIDES.items():
        top[m] = side[m] = c
    px = float(surface["voxel"]) * step

    fog_zone = assemble(export, "FogZone", [0, 1])[::step, ::step]
    fog, tier = fog_zone[..., 0], fog_zone[..., 1]
    void = void_mask(fog, tier) | np.isnan(height)
    height = np.where(np.isnan(height), np.nanmin(height), height)

    water = np.asarray(Image.open(f"{export}/water.png").convert("L"), np.float32) / 255.0
    water = np.clip(resize(water, size) * 1.6 - 0.3, 0, 1)
    canopy, shadow = props_layer(export, size, 1.0 / step)

    out = np.empty((size, size, 3), np.uint8)
    band = max(64, 1024 // step)
    for r0 in range(0, size, band):
        r1 = min(size, r0 + band)
        g0, g1 = max(0, r0 - 1), min(size, r1 + 1)  # 1-row margin for the gradient
        rgb = shade(height[g0:g1], material[g0:g1], top, side, road, canopy[g0:g1], shadow[g0:g1],
                    water[g0:g1], fog[g0:g1], void[g0:g1], px)
        out[r0:r1] = rgb[r0 - g0:r0 - g0 + (r1 - r0)]
    return out


def shade(height, material, top, side, road, canopy, shadow, water, fog, void, px):
    gy, gx = np.gradient(height, px)   # gy: towards the south, gx: towards the east
    slope = np.hypot(gx, gy)

    steep = np.clip((slope - 0.9) / 0.6, 0, 1)[..., None]
    col = top[material] * (1 - steep) + side[material] * steep
    col = np.where(road[material][..., None], col * ROAD_BOOST, col)

    # Trees: darker, slightly greener version of the ground; shadows below.
    tree = col * np.array([0.55, 0.68, 0.5], np.float32) + np.array([4, 10, 2], np.float32)
    col = col * (1 - 0.45 * shadow[..., None])
    col = col * (1 - canopy[..., None]) + tree * canopy[..., None]

    # Lambert light from the north-west on the real height field.
    norm = np.sqrt(gx * gx + gy * gy + 1.0)
    lambert = (-gx * LIGHT[0] - gy * LIGHT[1] + LIGHT[2]) / norm
    light = 0.45 + 0.75 * np.clip(lambert, 0, 1)
    col = col * EXPOSURE * light[..., None]

    w = water[..., None]
    col = col * (1 - 0.85 * w) + WATER * 0.85 * w

    f = fog.astype(np.float32) / 255.0
    land = ~void
    inside = (np.clip((f - 0.45) / 0.1, 0, 1) * land)[..., None]
    col = col * (1 - 0.5 * inside) + SHROUD * 0.5 * inside
    edge = (np.clip(1 - np.abs(f - 0.5) / 0.05, 0, 1) * land)[..., None]
    col = col * (1 - 0.35 * edge) + SHROUD_EDGE * 0.35 * edge

    col[void] = BACKGROUND
    return np.clip(col, 0, 255).astype(np.uint8)


def write_tiles(rgb, out):
    img = Image.fromarray(rgb)
    for level in range(LEVELS):
        z = -level
        size = WORLD >> level
        if level:
            img = img.resize((size, size), Image.LANCZOS)
        n = -(-size // TILE)
        d = f"{out}/tiles/{z}"
        os.makedirs(d, exist_ok=True)
        for ty in range(n):
            for tx in range(n):
                box = (tx * TILE, ty * TILE, min(size, (tx + 1) * TILE), min(size, (ty + 1) * TILE))
                tile = Image.new("RGB", (TILE, TILE), BACKGROUND)
                tile.paste(img.crop(box), (0, 0))
                tile.save(f"{d}/{tx}_{ty}.jpg", quality=87)
        print(f"zoom {z}: {n}x{n} tiles")


if __name__ == "__main__":
    export, out = sys.argv[1:3]
    preview = "--preview" in sys.argv
    rgb = render(export, preview)
    if preview:
        Image.fromarray(rgb).save(f"{out}/preview.png")
    else:
        write_tiles(rgb, out)
