#!/usr/bin/env python3
"""Build data/market/sold.json - recent ACTUAL sale prices around Ravensbourne Place.

Stages (every HTTP response is cached under --cache, so a re-run never refetches):

 1. HM Land Registry Price Paid Data (OGL v3.0). The yearly CSVs (--since-year .. the
    current year) and the monthly change file are STREAMED and filtered on the fly:
    postcode district BR1/BR2/BR3/BR4/BR6, PPD category A, property type D/S/T/F,
    record status != D. Only the filtered rows are written to disk. The monthly file's
    A/C/D record changes are then applied (a no-op when the yearly files were rebuilt
    on the same day, which HM Land Registry normally does).
 2. postcodes.io bulk geocoding (100 postcodes per POST; terminated postcodes via
    /terminated_postcodes/). Sales within --radius metres of the site centroid are kept
    and get dist_m.
 3. EPC floor area (optional). Read from one or more domestic-EPC bulk files
    (certificates.csv, or the .zip it comes in) passed with --epc-csv. The bulk data is
    published by MHCLG at https://get-energy-performance-data.communities.gov.uk/
    (free, but needs a GOV.UK One Login account - download the Bromley file once).
    Addresses are matched per postcode: 'exact' (SAON + PAON + street, normalised),
    'fuzzy' (same house/flat numbers + street, or the same house name, and only one
    candidate address), else 'none'. The certificate closest in date to the sale wins.
    NOTE: the public register find-energy-certificate.service.gov.uk is deliberately NOT
    scraped - its robots.txt disallows all automated clients ("User-agent: * /
    Disallow: /"), so without --epc-csv every sale has floor_area = null.
 4. ppm2 = price / floor_area. Implausible pairs (area < 25 or > 600 m2, ppm2 < 1,500 or
    > 15,000 GBP/m2) are flagged: floor_area/ppm2 -> null, epc_match -> 'none'; the sale
    itself is kept.
 5. Retirement-scheme sales are flagged (retirement=true) and duplicate Land Registry
    records (same address, date and price) removed.
 6. data/market/sold.json, sorted by date (newest first).

Usage:
  python3 scripts/market/fetch_sold.py
  python3 scripts/market/fetch_sold.py --epc-csv ~/Downloads/domestic-E09000006-Bromley.zip
  python3 scripts/market/fetch_sold.py --refresh-ppd          # re-download Land Registry
  python3 scripts/market/fetch_sold.py --offline              # rebuild from the cache only
  python3 scripts/market/fetch_sold.py --selftest             # address-matcher tests only

Python 3 standard library + requests.
"""
import argparse
import csv
import datetime as dt
import glob
import hashlib
import io
import json
import math
import os
import re
import statistics
import sys
import time
import zipfile

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "data", "market", "sold.json")
# cache root shared by all scripts/market/*.py: $MARKET_CACHE, else ~/.cache/bromley-market
DEFAULT_CACHE = os.environ.get("MARKET_CACHE") or os.path.expanduser("~/.cache/bromley-market")

CENTRE = (51.3826, 0.0213)          # Phase 1A centroid
DISTRICTS = {"BR1", "BR2", "BR3", "BR4", "BR6"}
PPD_BASE = "http://prod.publicdata.landregistry.gov.uk.s3-website-eu-west-1.amazonaws.com/"
PPD_ALT = "https://price-paid-data.publicdata.landregistry.gov.uk/"
PPD_MONTHLY = "pp-monthly-update-new-version.csv"
PPD_COLS = ["id", "price", "date", "postcode", "type", "old_new", "duration", "paon", "saon",
            "street", "locality", "town", "district", "county", "category", "status"]
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0.0.0 Safari/537.36")
EPC_REGISTER = "https://find-energy-certificate.service.gov.uk/energy-certificate/"

LICENCE_LR = ("Contains HM Land Registry data © Crown copyright and database right {y}. "
              "This data is licensed under the Open Government Licence v3.0.")
LICENCE_EPC = ("Energy Performance of Buildings Data: England and Wales - © Crown copyright, "
               "Open Government Licence v3.0 (address data: © Royal Mail / Ordnance Survey).")
LICENCE_PC = ("postcodes.io (ONS Postcode Directory): Contains OS data © Crown copyright and "
              "database right; Contains Royal Mail data © Royal Mail copyright and database "
              "right; Source: Office for National Statistics licensed under the OGL v3.0.")

# Age-restricted retirement schemes within the radius (a separate market, excluded from the
# comparables and the app's sales medians). Each name was confirmed by OnTheMarket listings
# tagged "Retirement" / "over 60s" at the same address (Oct 2026); the street guards against
# another building of the same name. (building, street) as in the Land Registry address.
RETIREMENT_SCHEMES = [("HEYDON COURT", "DEER PARK WAY"), ("SHERIDAN LODGE", "HOMESDALE ROAD"),
                      ("BEAUMONT LODGE", "ADDINGTON ROAD"), ("PRIORY LODGE", "GLEBE WAY"),
                      ("HOPTON COURT", "FORGE CLOSE"), ("SOVEREIGN COURT", "MAGPIE HALL LANE"),
                      ("ALDERBROOK COURT", "THE ALDERS"), ("GABLE LODGE", ""), ("NEWMAN COURT", "NORTH STREET"),
                      ("ANDORRA COURT", "WIDMORE ROAD"), ("SUMMERLANDS LODGE", "")]


def is_retirement(address):
    a = (address or "").upper()
    return any(b in a and st_ in a for b, st_ in RETIREMENT_SCHEMES)


AREA_MIN, AREA_MAX = 25, 600
PPM2_MIN, PPM2_MAX = 1500, 15000

LOG = []                            # failed / blocked requests, for the report


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------- HTTP
class Http:
    """requests.Session with a browser UA and a per-host minimum interval."""

    def __init__(self, offline=False):
        self.offline = offline
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": UA, "Accept-Language": "en-GB,en;q=0.9"})
        self.last = {}

    def wait(self, host, interval):
        t = self.last.get(host, 0) + interval - time.time()
        if t > 0:
            time.sleep(t)
        self.last[host] = time.time()

    def request(self, method, url, interval=1.0, tries=3, **kw):
        if self.offline:
            raise SystemExit(f"--offline and not cached: {method} {url}")
        host = re.sub(r"^https?://([^/]+).*$", r"\1", url)
        err = None
        for i in range(tries):
            self.wait(host, interval)
            try:
                r = self.s.request(method, url, timeout=kw.pop("timeout", (30, 120)), **kw)
                if r.status_code in (403, 429) or "captcha" in r.text[:5000].lower():
                    LOG.append(f"BLOCKED {r.status_code} {method} {url}")
                    return r
                if r.status_code >= 500:
                    err = f"HTTP {r.status_code}"
                    time.sleep(5 * (i + 1))
                    continue
                return r
            except requests.RequestException as e:
                err = repr(e)
                time.sleep(5 * (i + 1))
        LOG.append(f"FAILED {method} {url}: {err}")
        return None


# --------------------------------------------------------------------------- stage 1: PPD
def ppd_keep(row, years=None):
    if len(row) < 16:
        return False
    pc = row[3].strip().upper()
    if pc.split(" ")[0] not in DISTRICTS:
        return False
    if row[14] != "A" or row[4] not in ("D", "S", "T", "F"):
        return False
    if years and row[2][:4] not in years:
        return False
    return True


def stream_filter(http, name, out_path, keep, prefilter=b'"BR'):
    """Stream one PPD file and write only the rows `keep` accepts. Returns meta dict."""
    if http.offline:
        raise SystemExit(f"--offline and not cached: {name}")
    for base in (PPD_ALT, PPD_BASE):          # https mirror first
        url = base + name
        for attempt in range(3):
            http.wait("landregistry", 1.0)
            tmp = out_path + ".part"
            try:
                with http.s.get(url, stream=True, allow_redirects=True, timeout=(30, 300)) as r:
                    if r.status_code != 200:
                        LOG.append(f"FAILED GET {url}: HTTP {r.status_code}")
                        break
                    n = k = 0
                    with open(tmp, "w", newline="", encoding="utf-8") as f:
                        w = csv.writer(f)
                        for line in r.iter_lines(chunk_size=1 << 20):
                            n += 1
                            if prefilter and prefilter not in line:
                                continue
                            row = next(csv.reader([line.decode("utf-8", "replace")]))
                            if keep(row):
                                w.writerow(row)
                                k += 1
                    meta = {"url": r.url, "last_modified": r.headers.get("Last-Modified"),
                            "fetched": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
                            "rows_scanned": n, "rows_kept": k}
                os.replace(tmp, out_path)
                with open(out_path + ".meta.json", "w") as f:
                    json.dump(meta, f, indent=1)
                log(f"  {name}: scanned {n:,} rows, kept {k:,}")
                return meta
            except (requests.RequestException, OSError) as e:
                log(f"  {name}: attempt {attempt + 1} failed: {e!r}")
                time.sleep(10 * (attempt + 1))
        else:
            LOG.append(f"FAILED GET {url}: 3 attempts")
    raise SystemExit(f"could not download {name}")


def load_ppd(http, cache, since_year, refresh):
    d = os.path.join(cache, "ppd")
    os.makedirs(d, exist_ok=True)
    this_year = dt.date.today().year
    years = [str(y) for y in range(since_year, this_year + 1)]
    rows, metas = {}, {}
    for y in years:
        p = os.path.join(d, f"pp-{y}.BR.csv")
        if refresh or not os.path.exists(p):
            log(f"downloading pp-{y}.csv (stream-filtered)")
            metas[y] = stream_filter(http, f"pp-{y}.csv", p, lambda r: ppd_keep(r))
        else:
            metas[y] = json.load(open(p + ".meta.json"))
        with open(p, newline="", encoding="utf-8") as f:
            for r in csv.reader(f):
                rows[r[0]] = r
    # monthly change file: keep our districts' A/C rows + every C/D row (deletions are by id)
    p = os.path.join(d, "pp-monthly.BR.csv")
    if refresh or not os.path.exists(p):
        log("downloading monthly change file (stream-filtered)")
        stream_filter(http, PPD_MONTHLY, p,
                      lambda r: len(r) >= 16 and (r[15] in ("C", "D") or ppd_keep(r, set(years))),
                      prefilter=None)
    changes = {"A": 0, "C": 0, "D": 0}
    with open(p, newline="", encoding="utf-8") as f:
        for r in csv.reader(f):
            st = r[15]
            if st == "D":
                if rows.pop(r[0], None) is not None:
                    changes["D"] += 1
            elif st in ("A", "C"):
                if ppd_keep(r, set(years)):
                    if rows.get(r[0]) != r[:15] + ["A"]:
                        changes[st] += 1
                    rows[r[0]] = r[:15] + ["A"]
                elif st == "C" and rows.pop(r[0], None) is not None:
                    changes["C"] += 1       # changed so that it no longer qualifies
    log(f"  monthly changes applied: {changes}")
    return list(rows.values()), metas, changes


# --------------------------------------------------------------------------- stage 2: geocode
def geocode(http, cache, postcodes):
    d = os.path.join(cache, "postcodes")
    os.makedirs(d, exist_ok=True)
    lk_path = os.path.join(d, "lookup.json")
    lookup = json.load(open(lk_path)) if os.path.exists(lk_path) else {}
    todo = sorted(p for p in postcodes if p not in lookup)
    log(f"geocoding: {len(postcodes):,} postcodes, {len(todo):,} not cached")
    for i in range(0, len(todo), 100):
        batch = todo[i:i + 100]
        key = hashlib.sha1("\n".join(batch).encode()).hexdigest()[:16]
        raw = os.path.join(d, f"bulk_{key}.json")
        if os.path.exists(raw):
            data = json.load(open(raw))
        else:
            r = http.request("POST", "https://api.postcodes.io/postcodes", interval=1.0,
                             json={"postcodes": batch})
            if r is not None and r.status_code in (403, 429):
                json.dump(lookup, open(lk_path, "w"))
                raise SystemExit(f"postcodes.io refused the request (HTTP {r.status_code}); stopping, not retried. "
                                 "Postcodes geocoded so far are cached.")
            if r is None or r.status_code != 200:
                LOG.append(f"FAILED postcodes.io bulk batch {i // 100}: "
                           f"{getattr(r, 'status_code', 'no response')}")
                continue
            data = r.json()
            json.dump(data, open(raw, "w"))
        for item in data.get("result", []):
            res = item.get("result")
            lookup[item["query"]] = ([res["latitude"], res["longitude"]]
                                     if res and res.get("latitude") is not None else None)
        json.dump(lookup, open(lk_path, "w"))
    # terminated / unknown postcodes
    for pc in sorted(p for p in postcodes if lookup.get(p) is None and p in lookup):
        raw = os.path.join(d, "term_" + pc.replace(" ", "_") + ".json")
        if os.path.exists(raw):
            data = json.load(open(raw))
        else:
            r = http.request("GET", "https://api.postcodes.io/terminated_postcodes/"
                             + requests.utils.quote(pc), interval=1.0)
            if r is None:
                continue
            if r.status_code in (403, 429):
                raise SystemExit(f"postcodes.io refused the request (HTTP {r.status_code}); stopping, not retried.")
            data = {"status": r.status_code, **(r.json() if r.headers.get(
                "content-type", "").startswith("application/json") else {})}
            json.dump(data, open(raw, "w"))
        res = data.get("result") or {}
        if res.get("latitude") is not None:
            lookup[pc] = [res["latitude"], res["longitude"]]
    json.dump(lookup, open(lk_path, "w"))
    return lookup


def haversine(a, b):
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(h))


# --------------------------------------------------------------------------- stage 3: EPC
FLAT_WORDS = {"FLAT", "APARTMENT", "APT", "UNIT", "MAISONETTE", "STUDIO"}
TAIL_WORDS = {"BROMLEY", "KENT", "LONDON", "HAYES", "KESTON", "WEST", "WICKHAM", "BECKENHAM",
              "ORPINGTON", "FARNBOROUGH", "PETTS", "WOOD", "BICKLEY", "SHORTLANDS", "PARK",
              "LANGLEY", "EDEN", "COMMON", "LOCKSBOTTOM", "LOCKS", "BOTTOM", "GREATER"}


def norm_tokens(s):
    s = (s or "").upper().replace("&", " AND ")
    s = re.sub(r"(?<=\d)\s*-\s*(?=\d)", "-", s)            # keep 1-3 ranges
    s = re.sub(r"[^A-Z0-9\- ]+", " ", s).replace(" - ", " ")
    s = re.sub(r"\b(\d+)\s+([A-Z])\b(?=\s)", r"\1\2", s + " ")  # "12 A Foo" -> "12A Foo"
    return [t for t in s.split() if t and t != "-" and t not in FLAT_WORDS]


def has_num(t):
    return any(c.isdigit() for c in t)


def ppd_tokens(saon, paon, street):
    return norm_tokens(saon) + norm_tokens(paon) + norm_tokens(street)


def match_address(saon, paon, street, tail, candidates):
    """candidates: {epc_address_key: token list}.

    Returns ([keys], 'exact'|'fuzzy') or ([], 'none'). Several exact keys can only differ
    by trailing locality words (e.g. '... West Wickham'), i.e. they are the same dwelling."""
    want = ppd_tokens(saon, paon, street)
    if not want:
        return [], "none"
    tailset = TAIL_WORDS | set(tail)
    exact = []
    for k, toks in candidates.items():
        if toks[:len(want)] == want and all(t in tailset for t in toks[len(want):]):
            exact.append(k)
    if exact:
        return exact, "exact"
    nums = [t for t in want if has_num(t)]
    st = norm_tokens(street)
    name = [t for t in norm_tokens(saon) + norm_tokens(paon) if not has_num(t)]
    fuzzy = []
    for k, toks in candidates.items():
        if [t for t in toks if has_num(t)] != nums:
            continue
        if st and not all(t in toks for t in st):
            # the street may be missing from the EPC address only for a named building
            if not (name and all(t in toks for t in name)):
                continue
        if not nums:                                         # named house: names must agree
            if not name or sum(t in toks for t in name) < max(1, math.ceil(len(name) * 0.5)):
                continue
        fuzzy.append(k)
    if len(fuzzy) == 1:
        return fuzzy, "fuzzy"
    return [], "none"


def _norm_header(h):
    return re.sub(r"[^a-z0-9]+", "_", h.strip().lower()).strip("_")


def _iter_epc_rows(path):
    def rows_from(fh):
        rd = csv.reader(fh)
        hdr = [_norm_header(h) for h in next(rd)]
        for r in rd:
            yield dict(zip(hdr, r))
    if path.lower().endswith(".zip"):
        with zipfile.ZipFile(path) as z:
            for n in z.namelist():
                if re.search(r"certificates[^/]*\.csv$", n, re.I) or n.lower().endswith(".csv") \
                        and "recommend" not in n.lower():
                    with z.open(n) as raw:
                        yield from rows_from(io.TextIOWrapper(raw, encoding="utf-8", errors="replace"))
    else:
        with open(path, newline="", encoding="utf-8", errors="replace") as fh:
            yield from rows_from(fh)


def _pick(d, *names):
    for n in names:
        v = d.get(n)
        if v not in (None, ""):
            return v
    return None


def _num(v, cast=float):
    try:
        x = cast(float(v))
        return x if x > 0 else None
    except (TypeError, ValueError):
        return None


def load_epc(paths, wanted_postcodes):
    """Index EPC certificates by postcode (only for the postcodes we need)."""
    idx, n = {}, 0
    for p in paths:
        for d in _iter_epc_rows(p):
            pc = re.sub(r"\s+", " ", (d.get("postcode") or "").strip().upper())
            if pc not in wanted_postcodes:
                continue
            n += 1
            addr = " ".join(x for x in (_pick(d, "address1"), _pick(d, "address2"),
                                        _pick(d, "address3")) if x) or _pick(d, "address") or ""
            date = (_pick(d, "inspection_date", "lodgement_date", "lodgement_datetime",
                          "registration_date") or "")[:10]
            rrn = _pick(d, "certificate_number", "rrn", "report_reference_number",
                        "certificate_reference_number")
            idx.setdefault(pc, []).append({
                "addr": addr, "toks": norm_tokens(addr), "date": date or None,
                "area": _num(_pick(d, "total_floor_area")),
                "rooms": _num(_pick(d, "number_habitable_rooms"), int),
                "built_form": _pick(d, "built_form"),
                "property_type": _pick(d, "property_type"),
                "url": (EPC_REGISTER + rrn) if rrn and re.match(r"^[\d-]{20,24}$", rrn) else None,
            })
    log(f"EPC: {n:,} certificates for {len(idx):,} of our postcodes")
    return idx


def days_between(a, b):
    try:
        return abs((dt.date.fromisoformat(a) - dt.date.fromisoformat(b)).days)
    except (TypeError, ValueError):
        return 10 ** 6


# --------------------------------------------------------------------------- formatting
def fmt_words(s):
    out = []
    for w in (s or "").split():
        out.append(w if has_num(w) else (w[:1] + w[1:].lower()))
    return " ".join(out)


def fmt_address(r):
    rec = dict(zip(PPD_COLS, r))
    first = " ".join(x for x in (rec["paon"], rec["street"]) if x)
    parts = [rec["saon"], first, rec["locality"] if rec["locality"] != rec["town"] else "", rec["town"]]
    return ", ".join(fmt_words(p) for p in parts if p)


# --------------------------------------------------------------------------- self-test
def selftest():
    cands = {
        "a": norm_tokens("12 Hayes Lane"),
        "b": norm_tokens("Flat 1, 12 Hayes Lane"),
        "c": norm_tokens("Flat 2 12 Hayes Lane Bromley"),
        "d": norm_tokens("Rose Cottage, Baston Road, Hayes"),
        "e": norm_tokens("14a, Hayes Lane"),
        "f": norm_tokens("3 The Crescent"),
        "g": norm_tokens("Apartment 4, Rothsay Court, 3 Pickhurst Rise"),
        "h": norm_tokens("209 Pickhurst Rise"),
        "i": norm_tokens("209 Pickhurst Rise, West Wickham"),
    }
    cases = [
        (("", "12", "HAYES LANE"), ("a", "exact")),
        (("FLAT 1", "12", "HAYES LANE"), ("b", "exact")),
        (("FLAT 2", "12", "HAYES LANE"), ("c", "exact")),
        (("", "ROSE COTTAGE", "BASTON ROAD"), ("d", "exact")),
        (("", "ROSE COTTAGE", ""), ("d", "fuzzy")),
        (("", "14A", "HAYES LANE"), ("e", "exact")),
        (("", "14", "HAYES LANE"), (None, "none")),
        (("FLAT 3", "12", "HAYES LANE"), (None, "none")),
        (("", "3", "THE CRESCENT"), ("f", "exact")),
        (("APARTMENT 4", "ROTHSAY COURT, 3", "PICKHURST RISE"), ("g", "exact")),
        (("4", "ROTHSAY COURT 3", "PICKHURST RISE"), ("g", "exact")),
        (("", "IVY HOUSE", "BASTON ROAD"), (None, "none")),
        (("", "209", "PICKHURST RISE"), (["h", "i"], "exact")),
    ]
    bad = 0
    for (saon, paon, street), want in cases:
        keys, how = match_address(saon, paon, street, ["HAYES", "BROMLEY"], cands)
        got = (keys[0] if len(keys) == 1 else (keys or None), how)
        ok = got == want
        bad += not ok
        print(("ok  " if ok else "FAIL"), saon, "|", paon, "|", street, "->", got)
    print("all ok" if not bad else f"{bad} failures")
    return bad == 0


# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--cache", default=DEFAULT_CACHE, help="cache root (sold/ is used inside)")
    ap.add_argument("--since-year", type=int, default=2023)
    ap.add_argument("--radius", type=float, default=2500)
    ap.add_argument("--epc-csv", action="append", default=[],
                    help="domestic EPC bulk certificates CSV or ZIP (repeatable; globs ok)")
    ap.add_argument("--refresh-ppd", action="store_true")
    ap.add_argument("--offline", action="store_true", help="use the cache only; fail if something is missing")
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--selftest", action="store_true")
    a = ap.parse_args()
    if a.selftest:
        sys.exit(0 if selftest() else 1)

    cache = os.path.join(a.cache, "sold")
    os.makedirs(cache, exist_ok=True)
    http = Http(offline=a.offline)

    rows, metas, changes = load_ppd(http, cache, a.since_year, a.refresh_ppd)
    log(f"PPD rows kept (BR1/2/3/4/6, cat A, D/S/T/F): {len(rows):,}")

    pcs = {re.sub(r"\s+", " ", r[3].strip().upper()) for r in rows}
    lookup = geocode(http, cache, pcs)

    near = []
    for r in rows:
        pc = re.sub(r"\s+", " ", r[3].strip().upper())
        ll = lookup.get(pc)
        if not ll:
            continue
        dist = haversine(CENTRE, ll)
        if dist <= a.radius:
            near.append((r, pc, ll, dist))
    no_geo = sum(1 for r in rows if not lookup.get(re.sub(r"\s+", " ", r[3].strip().upper())))
    log(f"within {a.radius:.0f} m: {len(near):,}  (not geocoded: {no_geo})")

    epc_paths = sorted({p for g in a.epc_csv for p in glob.glob(os.path.expanduser(g))})
    epc = load_epc(epc_paths, {pc for _, pc, _, _ in near}) if epc_paths else {}
    if not epc_paths:
        log("EPC: no --epc-csv given -> floor areas unavailable (register scraping disabled, "
            "robots.txt disallows it)")

    out, flagged = [], 0
    for r, pc, ll, dist in near:
        rec = dict(zip(PPD_COLS, r))
        date = rec["date"][:10]
        price = int(rec["price"])
        item = {
            "id": rec["id"].strip("{}"), "price": price, "date": date, "postcode": pc,
            "address": fmt_address(r), "ppd_type": rec["type"], "new_build": rec["old_new"] == "Y",
            "tenure": rec["duration"] if rec["duration"] in ("F", "L") else None,
            "lat": round(ll[0], 6), "lon": round(ll[1], 6), "dist_m": int(round(dist)),
            "floor_area": None, "epc_url": None, "epc_match": "none", "epc_date": None,
            "habitable_rooms": None, "built_form": None, "ppm2": None,
        }
        if is_retirement(item["address"]):
            item["retirement"] = True
        certs = epc.get(pc)
        if certs:
            groups = {}
            for c in certs:
                groups.setdefault(" ".join(c["toks"]), []).append(c)
            keys, how = match_address(rec["saon"], rec["paon"], rec["street"],
                                     norm_tokens(" ".join((rec["locality"], rec["town"],
                                                           rec["district"]))),
                                     {k: v[0]["toks"] for k, v in groups.items()})
            if keys:
                allc = [c for k in keys for c in groups[k]]
                pool = [c for c in allc if c["area"]] or allc
                c = min(pool, key=lambda c: days_between(c["date"], date))
                area = c["area"]
                ppm2 = price / area if area else None
                if area and not (AREA_MIN <= area <= AREA_MAX and PPM2_MIN <= ppm2 <= PPM2_MAX):
                    flagged += 1                    # keep the sale, drop the EPC link
                    item["epc_flag"] = (f"implausible: EPC area {area:g} m2 -> "
                                        f"{ppm2:,.0f} GBP/m2 ({how} match, {c['date']})")
                else:
                    item.update(epc_match=how, epc_date=c["date"], epc_url=c["url"],
                                habitable_rooms=c["rooms"], built_form=c["built_form"])
                    if area:
                        item.update(floor_area=round(area, 1), ppm2=int(round(ppm2)))
        out.append(item)
    out.sort(key=lambda x: (x["date"], x["id"]), reverse=True)
    # Land Registry occasionally carries the same sale twice (same address, date and price,
    # different transaction ids): keep one
    seen, dupes = {}, []
    for x in sorted(out, key=lambda x: x["id"]):
        k = (x["address"].upper(), x["date"], x["price"])
        if k in seen:
            dupes.append({"id": x["id"], "duplicate_of": seen[k]})
        else:
            seen[k] = x["id"]
    drop = {d["id"] for d in dupes}
    out = [x for x in out if x["id"] not in drop]
    n_ret = sum(1 for x in out if x.get("retirement"))
    log(f"removed {len(dupes)} duplicate Land Registry records; {n_ret} sales in retirement schemes flagged")

    year = dt.date.today().year
    sources = [{"name": "HM Land Registry Price Paid Data",
                "url": "https://www.gov.uk/government/statistical-data-sets/price-paid-data-downloads",
                "licence": LICENCE_LR.format(y=year)},
               {"name": "postcodes.io (ONS Postcode Directory)", "url": "https://postcodes.io/",
                "licence": LICENCE_PC}]
    if epc_paths:
        sources.append({"name": "Energy Performance of Buildings Data: England and Wales",
                        "url": "https://get-energy-performance-data.communities.gov.uk/",
                        "licence": LICENCE_EPC})
    doc = {
        "generated": dt.date.today().isoformat(),
        "sources": sources,
        "centre": {"lat": CENTRE[0], "lon": CENTRE[1]},
        "radius_m": int(a.radius),
        "ppd_files": {y: {"last_modified": m.get("last_modified")} for y, m in metas.items()},
        "removed_duplicates": dupes,
        "retirement_schemes": [b.title() for b, _ in RETIREMENT_SCHEMES],
        "notes": ("Category A sales (standard market-value transactions) of houses and flats, "
                  f"{a.since_year}-{year}, within {int(a.radius)} m of the site (postcode centroid). "
                  f"Sales in age-restricted retirement schemes carry retirement=true ({n_ret}); "
                  f"{len(dupes)} duplicate records (same address, date and price) removed. "
                  + ("Floor areas from the EPC register, matched by address; "
                     "implausible area/price pairs nulled." if epc_paths else
                     "Floor areas not included: the EPC register's robots.txt disallows "
                     "automated access and the bulk EPC download needs a GOV.UK One Login "
                     "account; re-run with --epc-csv once the Bromley file is downloaded.")),
        "transactions": out,
    }
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(doc, f, ensure_ascii=False, separators=(",", ":"))
    log(f"wrote {a.out}: {len(out):,} transactions ({os.path.getsize(a.out) / 1e6:.2f} MB), "
        f"{flagged} EPC matches flagged as implausible")

    report(out, a.since_year, changes, LOG)


def report(out, since, changes, failures):
    by = lambda pred: [x for x in out if pred(x)]
    print("\n=== sold.json report ===")
    print(f"transactions within radius: {len(out)}")
    for t in "DSTF":
        xs = by(lambda x, t=t: x["ppd_type"] == t)
        print(f"  {t}: {len(xs):4d}  new-build {sum(x['new_build'] for x in xs):3d}  "
              f"with floor area {sum(x['floor_area'] is not None for x in xs):4d}")
    m = {k: sum(x["epc_match"] == k for x in out) for k in ("exact", "fuzzy", "none")}
    print(f"EPC match: {m}  rate {(m['exact'] + m['fuzzy']) / max(1, len(out)):.1%}")
    print("median price / ppm2 by type, 2025-2026 sales:")
    for t in "DSTF":
        xs = by(lambda x, t=t: x["ppd_type"] == t and x["date"] >= "2025-01-01")
        pp = [x["ppm2"] for x in xs if x["ppm2"]]
        print(f"  {t}: n={len(xs):4d} median price "
              f"{int(statistics.median([x['price'] for x in xs])) if xs else '-'}  "
              f"ppm2 n={len(pp)} median {int(statistics.median(pp)) if pp else '-'}")
    print(f"monthly-file changes applied: {changes}")
    print("failed/blocked requests:", failures or "none")


if __name__ == "__main__":
    main()
