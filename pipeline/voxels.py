"""Decoder for Enshrouded terrain voxel tiles (VoxelWorldResource levels).

Reverse engineered from the game executable (block reader, brick seek, run
header and brick decoder). Format of one tile:

  u8 blocksX, u8 blocksZ
  u24 offset[blocksX * blocksZ]           block start, relative to the data
  data: blocks, back to back

A block is a column of 8x8 voxels made of bricks of 8x8x8 voxels, stacked
from y = 0 upwards:

  u16 brickCount                          bricks above are air
  u16 bitBytes
  u8  bits[bitBytes]                      LSB-first bit stream
  u8  bytes[...]                          uniform values and brick payloads

The bit stream is a list of runs of bricks:
  varint count, bit "mixed"
  uniform run (mixed = 0): bit hasMaterial [, bit hasDensity]; the material
    and density bytes are taken in order from the byte stream, a run without
    material repeats the previous uniform value (initially air)
  mixed run: per brick, 10 bits payload size; payloads follow each other in
    the byte stream

varint: v = 1; while read(1): v = v * 2 | read(1)

A brick payload holds 512 voxels (index x + 8 * y + 64 * z) as two RLE
passes reading flags from the front of the payload and literal bytes from its
back: materials, then densities (0 = air, 0xff = solid).
"""
import numpy as np

BRICK = 8
VOXELS = BRICK ** 3


class BitReader:
    __slots__ = ("data", "pos", "acc", "bits")

    def __init__(self, data):
        self.data = data
        self.pos = 0
        self.acc = 0
        self.bits = 0

    def read(self, n):
        while self.bits < 25 and self.pos < len(self.data):
            self.acc |= self.data[self.pos] << self.bits
            self.pos += 1
            self.bits += 8
        v = self.acc & ((1 << n) - 1)
        self.acc >>= n
        self.bits -= n
        return v

    def varint(self):
        v = 1
        while self.read(1):
            v = (v << 1) | self.read(1)
        return v

    def consumed(self):
        """Bytes of the stream actually used."""
        return self.pos - (self.bits >> 3)


class CorruptBrick(Exception):
    pass


def decode_brick(payload):
    """Returns (materials, densities) as two lists of 512 ints."""
    br = BitReader(payload)
    back = len(payload)
    mat = [0] * VOXELS
    i = 0
    prev2 = prev1 = 0
    while i < VOXELS:
        if br.read(1):
            back -= 1
            if back < 0:
                raise CorruptBrick("material literals")
            val = payload[back]
        else:
            val = prev2
        n = br.varint()
        if i + n > VOXELS:
            raise CorruptBrick("material run")
        mat[i:i + n] = [val] * n
        i += n
        prev2, prev1 = prev1, val

    den = [0] * VOXELS
    i = 0
    last = 0
    while i < VOXELS:
        m = mat[i]
        if br.read(1):
            back -= 1
            if back < 0:
                raise CorruptBrick("density literals")
            d = payload[back]
            if m >= 0x80:
                last = d
            n = br.varint() if (d in (0, 0xFF) or m > 0x7F) else 1
        else:
            d = 0 if m == 0 else (0xFF if m <= 0x7F else last)
            n = br.varint()
        if i + n > VOXELS:
            raise CorruptBrick("density run")
        den[i:i + n] = [d] * n
        i += n

    if br.consumed() != back:
        raise CorruptBrick(f"streams do not meet ({br.consumed()} != {back})")
    return mat, den


def tile_blocks(data):
    """Yields (blockX, blockZ, block bytes) for a tile."""
    gx, gz = data[0], data[1]
    n = gx * gz
    base = 2 + n * 3
    offs = [int.from_bytes(data[2 + i * 3:5 + i * 3], "little") for i in range(n)] + [len(data) - base]
    for i in range(n):
        yield i % gx, i // gx, data[base + offs[i]:base + offs[i + 1]]


def block_bricks(block):
    """Yields (brickY, kind, value) for the bricks of a block, bottom-up.

    kind is "uniform" with value (material, density) or "mixed" with value
    the brick payload.
    """
    count = block[0] | block[1] << 8
    bit_bytes = block[2] | block[3] << 8
    br = BitReader(block[4:4 + bit_bytes])
    stream = block[4 + bit_bytes:]
    off = 0
    mat = den = None  # previous uniform value; None = air
    y = 0
    while y < count:
        run = br.varint()
        mixed = br.read(1)
        if not mixed:
            if br.read(1):
                mat = stream[off]
                off += 1
                if br.read(1):
                    den = stream[off]
                    off += 1
                else:
                    den = None
            m = mat or 0
            d = den if den is not None else (0xFF if m else 0)
            for _ in range(min(run, count - y)):
                yield y, "uniform", (m, d)
                y += 1
        else:
            for _ in range(min(run, count - y)):
                size = br.read(10)
                yield y, "mixed", stream[off:off + size]
                off += size
                y += 1


def decode_block(block):
    """Full voxels of a block: (materials, densities) as uint8 [y][z][x]."""
    count = block[0] | block[1] << 8
    mat = np.zeros((count * BRICK, BRICK, BRICK), np.uint8)
    den = np.zeros_like(mat)
    for y, kind, value in block_bricks(block):
        s = slice(y * BRICK, (y + 1) * BRICK)
        if kind == "uniform":
            mat[s], den[s] = value
        else:
            m, d = decode_brick(value)
            # index x + 8 y + 64 z  ->  [z][y][x]  ->  [y][z][x]
            mat[s] = np.array(m, np.uint8).reshape(BRICK, BRICK, BRICK).transpose(1, 0, 2)
            den[s] = np.array(d, np.uint8).reshape(BRICK, BRICK, BRICK).transpose(1, 0, 2)
    return mat, den


def block_surface(block):
    """Top surface of a block: (height in voxels, material) as [z][x] arrays.

    Height is the top of the highest non-air voxel plus its density fraction;
    -1 where the column is empty.
    """
    mat, den = decode_block(block)
    solid = den > 0
    any_solid = solid.any(axis=0)
    top = np.where(any_solid, solid.shape[0] - 1 - np.argmax(solid[::-1], axis=0), -1)
    zz, xx = np.indices(top.shape)
    t = np.maximum(top, 0)
    height = np.where(any_solid, t + den[t, zz, xx] / 255.0, -1.0)
    material = np.where(any_solid, mat[t, zz, xx], 0)
    return height, material
