#!/usr/bin/env python3
"""Cut the georeferenced Phase 1 drawings into Web-Mercator map tiles (tiles/{z}/{x}/{y}.webp).

Sources (assets/sheets/*.jpg) and their pixel -> British National Grid transforms
(scripts/source/georef.json):
  * zoom <= SITE_MAX_Z : Phase 1A / 1B site plans (1:1000)
  * zoom >  SITE_MAX_Z : the 12 ground-floor-plan sheets (1:200), site plans underneath as fallback

White paper becomes transparent so the drawings sit on top of the base map.
Requires: numpy, opencv-python-headless, pillow, pyproj.
"""
import json
import math
import os
import shutil

import cv2
import numpy as np
from PIL import Image
from pyproj import Transformer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SHEETS = os.path.join(ROOT, "assets", "sheets")
OUT = os.path.join(ROOT, "tiles")
GEOREF = json.load(open(os.path.join(ROOT, "scripts", "source", "georef.json")))["sheets"]

MIN_Z, SITE_MAX_Z, MAX_Z = 15, 17, 19
SITE = ["site1A", "site1B"]
GFP = [f"gfp{i}" for i in range(1, 13)]
TILE = 256
R = 6378137.0

to_bng = Transformer.from_crs("EPSG:3857", "EPSG:27700", always_xy=True)
from_bng = Transformer.from_crs("EPSG:27700", "EPSG:3857", always_xy=True)


def load(name):
    """RGBA float image: colour from the drawing, alpha from darkness (white paper = transparent)."""
    rgb = np.asarray(Image.open(os.path.join(SHEETS, name + ".jpg")).convert("RGB")).astype(np.float32) / 255
    x0, y0, x1, y1 = GEOREF[name]["crop"]
    lum = rgb @ np.array([0.299, 0.587, 0.114], np.float32)
    sat = rgb.max(-1) - rgb.min(-1)
    alpha = np.clip((1 - lum) * 3.0 + sat * 1.5, 0, 1)
    alpha[lum > 0.94] = 0                       # paper / jpeg noise
    mask = np.zeros_like(alpha)
    mask[y0:y1, x0:x1] = 1
    alpha *= mask
    return np.dstack([rgb, alpha])


def merc_bounds(name):
    """Web-Mercator bbox of a sheet's drawing area."""
    A = np.array(GEOREF[name]["A"])
    x0, y0, x1, y1 = GEOREF[name]["crop"]
    corners = np.array([[x0, y0, 1], [x1, y0, 1], [x0, y1, 1], [x1, y1, 1]], float).T
    E, N = A @ corners
    mx, my = from_bng.transform(E, N)
    return min(mx), min(my), max(mx), max(my)


def tile_range(bounds, z):
    n = 2 ** z
    def tx(mx): return int((mx + math.pi * R) / (2 * math.pi * R) * n)
    def ty(my): return int((math.pi * R - my) / (2 * math.pi * R) * n)
    return tx(bounds[0]), ty(bounds[3]), tx(bounds[2]), ty(bounds[1])


def shrunk(name, z):
    """Source image pre-shrunk (area-averaged) to about the output resolution at zoom z."""
    key = (name, z)
    if key not in CACHE:
        img, A = SRC[name], np.array(GEOREF[name]["A"])
        res = 2 * math.pi * R / (2 ** z * TILE)
        f = min(1.0, math.hypot(A[0, 0], A[1, 0]) / res)
        CACHE[key] = img if f > 0.67 else cv2.resize(img, (int(img.shape[1] * f), int(img.shape[0] * f)), interpolation=cv2.INTER_AREA)
    return CACHE[key]


def render(sources, z, x_range, y_range):
    """Composite `sources` into the Mercator raster covering tiles x_range x y_range at zoom z."""
    n = 2 ** z
    res = 2 * math.pi * R / (n * TILE)
    W, H = (x_range[1] - x_range[0] + 1) * TILE, (y_range[1] - y_range[0] + 1) * TILE
    left = x_range[0] * TILE * res - math.pi * R
    top = math.pi * R - y_range[0] * TILE * res
    out = np.zeros((H, W, 4), np.float32)
    out[..., :3] = 1
    for name in sources:
        # only the part of the band this sheet covers
        b = merc_bounds(name)
        c0, c1 = int((b[0] - left) / res) - 2, int((b[2] - left) / res) + 2
        r0, r1 = int((top - b[3]) / res) - 2, int((top - b[1]) / res) + 2
        c0, r0, c1, r1 = max(0, c0), max(0, r0), min(W, c1), min(H, r1)
        if c1 <= c0 or r1 <= r0:
            continue
        w_, h_ = c1 - c0, r1 - r0
        # Mercator -> BNG on a coarse grid, upsampled (the projection is smooth at this scale)
        step = 16
        gx = np.arange(0, w_ + step, step, dtype=np.float64)
        gy = np.arange(0, h_ + step, step, dtype=np.float64)
        MX, MY = np.meshgrid(left + (c0 + gx + 0.5) * res, top - (r0 + gy + 0.5) * res)
        E, N = to_bng.transform(MX, MY)
        size = (len(gx) * step, len(gy) * step)
        E = cv2.resize(E, size, interpolation=cv2.INTER_LINEAR)[:h_, :w_]
        N = cv2.resize(N, size, interpolation=cv2.INTER_LINEAR)[:h_, :w_]
        img, im = SRC[name], shrunk(name, z)
        A = np.array(GEOREF[name]["A"])
        Ai = np.linalg.inv(np.vstack([A, [0, 0, 1]]))[:2]
        kx, ky = im.shape[1] / img.shape[1], im.shape[0] / img.shape[0]
        sx = ((Ai[0, 0] * E + Ai[0, 1] * N + Ai[0, 2]) * kx).astype(np.float32)
        sy = ((Ai[1, 0] * E + Ai[1, 1] * N + Ai[1, 2]) * ky).astype(np.float32)
        w = cv2.remap(im, sx, sy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=(1, 1, 1, 0))
        a = w[..., 3:4]
        o = out[r0:r1, c0:c1]
        # darken-composite: overlapping sheets carry the same linework, keep the darkest stroke
        o[..., :3] = np.minimum(o[..., :3], np.where(a > 0, w[..., :3], 1.0))
        o[..., 3:4] = np.maximum(o[..., 3:4], a)
    # contrast: thin strokes fade when averaged down, so lift alpha and deepen neutral greys
    a = out[..., 3:4]
    out[..., 3:4] = 1 - np.clip(1 - a, 0, 1) ** 2.2
    rgb = out[..., :3]
    neutral = (rgb.max(-1, keepdims=True) - rgb.min(-1, keepdims=True)) < 0.12
    out[..., :3] = np.where(neutral, rgb * 0.55 + 0.05, rgb)
    return out


def save_tiles(raster, z, x_range, y_range, count):
    for ty in range(y_range[0], y_range[1] + 1):
        for tx in range(x_range[0], x_range[1] + 1):
            oy, ox = (ty - y_range[0]) * TILE, (tx - x_range[0]) * TILE
            t = raster[oy:oy + TILE, ox:ox + TILE]
            if t[..., 3].max() < 0.02:
                continue
            path = os.path.join(OUT, str(z), str(tx))
            os.makedirs(path, exist_ok=True)
            fn = os.path.join(path, f"{ty}.webp")
            if os.path.exists(fn):                   # tile shared by the 1A and 1B areas: merge
                old = np.asarray(Image.open(fn).convert("RGBA")).astype(np.float32) / 255
                t = t.copy()
                t[..., :3] = np.minimum(np.where(old[..., 3:4] > 0, old[..., :3], 1), np.where(t[..., 3:4] > 0, t[..., :3], 1))
                t[..., 3] = np.maximum(old[..., 3], t[..., 3])
            else:
                count[z] = count.get(z, 0) + 1
            Image.fromarray((np.clip(t, 0, 1) * 255).astype(np.uint8), "RGBA").save(fn, "WEBP", quality=72, method=5)


def union(bounds_list):
    return (min(b[0] for b in bounds_list), min(b[1] for b in bounds_list),
            max(b[2] for b in bounds_list), max(b[3] for b in bounds_list))


if __name__ == "__main__":
    SRC = {name: load(name) for name in SITE + GFP}
    CACHE = {}
    shutil.rmtree(OUT, ignore_errors=True)
    count = {}
    meta = {"min_zoom": MIN_Z, "max_native_zoom": MAX_Z, "areas": []}
    groups = [("1A", "site1A", [g for g in GFP if GEOREF[g]["registered_to"] == "site1A"]),
              ("1B", "site1B", [g for g in GFP if GEOREF[g]["registered_to"] == "site1B"])]
    for label, site, sheets in groups:
        b = merc_bounds(site)
        for z in range(MIN_Z, MAX_Z + 1):
            sources = [site] if z <= SITE_MAX_Z else [site] + sheets
            area = b if z <= SITE_MAX_Z else union([merc_bounds(s) for s in sheets])
            x0, y0, x1, y1 = tile_range(area, z)
            # render in horizontal bands to bound memory
            band = 16
            for by in range(y0, y1 + 1, band):
                yr = (by, min(y1, by + band - 1))
                save_tiles(render(sources, z, (x0, x1), yr), z, (x0, x1), yr, count)
            print(f"phase {label} z{z}: tiles x {x0}-{x1} y {y0}-{y1}")
    to_ll = Transformer.from_crs("EPSG:3857", "EPSG:4326", always_xy=True)
    for site in SITE:
        mb = merc_bounds(site)
        lo1, la1 = to_ll.transform(mb[0], mb[1])
        lo2, la2 = to_ll.transform(mb[2], mb[3])
        meta["areas"].append([[round(la1, 6), round(lo1, 6)], [round(la2, 6), round(lo2, 6)]])
    meta["tiles"] = count
    # index of existing tiles, so the app never requests an empty one
    meta["index"] = {}
    for z in sorted(os.listdir(OUT), key=lambda v: int(v) if v.isdigit() else -1):
        if z.isdigit():
            meta["index"][z] = sorted(f"{x}/{f[:-5]}" for x in os.listdir(os.path.join(OUT, z))
                                      for f in os.listdir(os.path.join(OUT, z, x)))
    json.dump(meta, open(os.path.join(OUT, "meta.json"), "w"), separators=(",", ":"))
    print("tiles per zoom:", count, "total", sum(count.values()))
