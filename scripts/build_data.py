#!/usr/bin/env python3
"""Build the map data (data/homes.json, data/geo.json) from the planning-drawing extracts.

Inputs (scripts/source/):
  map_data.json                      plot schedule (Phase 1 Plot Schedule Rev P2) + label positions on each drawing
  apartments_schedule_2026-10.json   Phase 1 Apartments Schedule (Oct 2026): floor level + NIA per flat
  georef.json                        drawing pixel -> British National Grid transforms
  phases.geojson / parcels.geojson   phase areas (Illustrative Phasing Strategy) and Phase 1 parcels (Parcel Plan)
"""
import json
import os
import re
import datetime as dt

import numpy as np
from pyproj import Transformer

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "scripts", "source")
OUT = os.path.join(ROOT, "data")

to_wgs = Transformer.from_crs("EPSG:27700", "EPSG:4326", always_xy=True)
PHASE_1B_PARCELS = {"R-S01", "R-S02"}


def parcel_of(plot):
    m = re.match(r"^(?:R-)?(S\d+[A-Z]?)", plot)
    p = "R-" + m.group(1) if m else None
    return {"R-S011": "R-S11"}.get(p, p)


def num(v):
    try:
        f = float(v)
        return int(f) if f.is_integer() else f
    except (TypeError, ValueError):
        return None


def main():
    md = json.load(open(os.path.join(SRC, "map_data.json")))
    apts = json.load(open(os.path.join(SRC, "apartments_schedule_2026-10.json")))["units"]
    georef = json.load(open(os.path.join(SRC, "georef.json")))["sheets"]
    panels = md["panel_defs"]

    # marker positions -> lat/lon (a plot can be labelled on two overlapping sheets: average)
    pos, sheet_of, block_markers = {}, {}, []
    for pid, markers in md["markers_by_panel"].items():
        A = np.array(georef[pid]["A"])
        d = panels[pid]
        for m in markers:
            x, y = m["left_pct"] / 100 * d["px_w"], m["top_pct"] / 100 * d["px_h"]
            E, N = A @ [x, y, 1]
            if m["kind"] == "house":
                pos.setdefault(m["plot_number"], []).append((E, N))
                sheet_of.setdefault(m["plot_number"], pid)
            else:
                block_markers.append((m, E, N, pid))

    def ll(E, N):
        lon, lat = to_wgs.transform(E, N)
        return round(lat, 7), round(lon, 7)

    homes = []
    for r in md["table_rows"]:
        plot = r["plot_number"]
        is_apt = r["plot_type"].startswith("Apartment")
        h = {
            "id": plot,
            "kind": "apartment" if is_apt else "house",
            "parcel": parcel_of(plot),
            "beds": r.get("beds"),
            "occupancy": r.get("occupancy") or r.get("housetype"),
            "housetype": r.get("housetype"),
            "design_option": r.get("design_option"),
            "tenure": r.get("tenure"),
            "plot_type": "Apartment" if is_apt else r.get("plot_type"),
            "parking": num(r.get("parking")),
            "accessibility": r.get("accessibility"),
            "handed": r.get("handed"),
            "gia": num(r.get("gia")),
            "img": r.get("img"),
        }
        h["phase"] = "1B" if h["parcel"] in PHASE_1B_PARCELS else "1A"
        if is_apt:
            a = apts.get(plot, {})
            h["block"] = a.get("block") or (r.get("img") or "blk:?").split(":")[1]
            h["level"] = a.get("level")
            h["nia"] = a.get("nia_sqm")
        if plot in pos:
            E, N = np.mean(pos[plot], axis=0)
            h["lat"], h["lon"] = ll(E, N)
            h["sheet"] = sheet_of[plot]
        homes.append(h)

    # the three schedule plots never labelled on a drawing: place between their numbered neighbours
    by_id = {h["id"]: h for h in homes}
    for h in homes:
        if h["kind"] != "house" or "lat" in h:
            continue
        m = re.match(r"^(.*_)(\d{3})$", h["id"])
        prefix = h["parcel"] + "_"
        n = int(m.group(2))
        nb = [by_id.get(f"{prefix}{n + k:03d}") for k in (-1, 1)]
        nb = [x for x in nb if x and "lat" in x]
        if len(nb) == 2:
            h["lat"] = round((nb[0]["lat"] + nb[1]["lat"]) / 2, 7)
            h["lon"] = round((nb[0]["lon"] + nb[1]["lon"]) / 2, 7)
            h["approx"] = True

    blocks = []
    for m, E, N, pid in block_markers:
        key = None
        for u in m["units"]:
            key = (by_id.get(u["plot_number"]) or {}).get("img") or key
        letter = (key or "blk:?").split(":")[1]
        units = [u["plot_number"] for u in m["units"]]
        lat, lon = ll(E, N)
        for u in units:
            by_id[u]["lat"], by_id[u]["lon"] = lat, lon
        levels = sorted({by_id[u].get("level") for u in units if by_id[u].get("level") is not None})
        blocks.append({
            "id": "blk:" + letter, "name": f"Block {letter}", "parcel": parcel_of(units[0]),
            "phase": "1B" if parcel_of(units[0]) in PHASE_1B_PARCELS else "1A",
            "lat": lat, "lon": lon, "count": len(units), "units": units,
            "bed_mix": {str(k): v for k, v in sorted(m["bed_mix"].items())},
            "tenure": m.get("block_tenure"),
            "storeys": (max(levels) + 1) if levels else None,
            "nia_total": sum(by_id[u].get("nia") or 0 for u in units) or None,
            "img": key, "sheet": pid,
        })
    blocks.sort(key=lambda b: b["name"])

    os.makedirs(OUT, exist_ok=True)
    located = sum(1 for h in homes if "lat" in h)
    json.dump({
        "generated": dt.date.today().isoformat(),
        "sources": {
            "plots": "Phase 1 Plot Schedule Rev P2 (16/06/2026) and Phase 1 ground floor plans 1-12 / site plans 1A, 1B (Rev P1)",
            "apartments": "Phase 1 Apartments Schedule (12/10/2026)",
        },
        "counts": {"homes": len(homes), "located": located,
                   "houses": sum(h["kind"] == "house" for h in homes),
                   "apartments": sum(h["kind"] == "apartment" for h in homes)},
        "homes": homes, "blocks": blocks,
    }, open(os.path.join(OUT, "homes.json"), "w"), ensure_ascii=False, separators=(",", ":"))

    phases = json.load(open(os.path.join(SRC, "phases.geojson")))
    parcels = json.load(open(os.path.join(SRC, "parcels.geojson")))
    for f in parcels["features"]:
        p = f["properties"]["parcel"]
        hs = [h for h in homes if h["parcel"] == p or (p == "R-S07B" and h["parcel"] == "R-S07A")]
        f["properties"]["homes"] = len(hs)
    json.dump({"phases": phases, "parcels": parcels}, open(os.path.join(OUT, "geo.json"), "w"),
              ensure_ascii=False, separators=(",", ":"))
    print(f"homes {len(homes)} (located {located}, approx {sum(1 for h in homes if h.get('approx'))}), blocks {len(blocks)}")


if __name__ == "__main__":
    main()
