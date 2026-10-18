#!/usr/bin/env python3
"""Homes currently FOR SALE around the Ravensbourne Place site -> data/market/listings.json

Source: OnTheMarket (onthemarket.com) search result pages, which embed the listing data
as JSON in <script id="__NEXT_DATA__">. The 2.5 km circle around the Phase 1A centroid
(51.3826, 0.0213) is covered by searching, "this area only", every postcode sector that
intersects it (OnTheMarket's sector polygons tile the area; the script checks the union of
the returned polygons really covers the circle and warns otherwise). Each sector is also
searched in the New Homes channel so that new-build listings are flagged. Results are
de-duplicated by listing id and only those within RADIUS_M of the centroid are kept.

For the nearest MAX_DETAILS houses and flats the listing page is read too: it carries a
structured floor area (minimumAreaSqM / minimumAreaSqFt) when the agent supplied one,
the new-home / development flags, the full feature list and the description, from which
a stated total floor area ("1,250 sq ft", "116 sq m") is parsed. When the structured value and
the stated total disagree by more than 10% the listing's area is marked 'conflict' (and left out
of the comparables by build_estimates.py). The tenure / lease length and sale conditions that make
a price non-comparable (cash buyers only, refurbishment project, probate, lease < 80 years) are
recorded too. Floorplan images are not read (no OCR). Images, descriptions and agent
contact details are NOT stored.

Politeness: one request at a time, >= 1.1 s apart, normal browser User-Agent, every
response cached on disk (a cached URL is never fetched again; delete the cache folder
to refresh). On 403 / 429 / captcha the script stops and reports - it never tries to
get around a block.

Usage:
  python3 scripts/market/fetch_listings.py --cache /path/to/cache/otm
  python3 scripts/market/fetch_listings.py --offline        # rebuild from the cache only
Options: --max-details N (default 120), --radius-m M (default 2500), --out PATH.
Default cache: $MARKET_CACHE/otm, else ~/.cache/bromley-market/otm (the root all scripts/market/*.py share).
"""
import argparse
import datetime as dt
import hashlib
import json
import math
import os
import re
import statistics
import sys
import time
import urllib.parse

import requests

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36")
BASE = "https://www.onthemarket.com"
CENTRE = (51.3826, 0.0213)          # Phase 1A centroid
RADIUS_M = 2500
MAX_DETAILS = 120
SQFT_TO_M2 = 0.092903
AREA_CONFLICT = 0.10                # structured vs stated-in-text floor area: > 10% apart = 'conflict'

# Postcode sectors that intersect the 2.5 km circle (found by reverse-geocoding a 300 m grid
# of points over the circle with postcodes.io). Largest overlap first.
SECTORS = ["br2-7", "br2-8", "br2-9", "br4-9", "br2-0", "br4-0", "br2-6", "br1-2",
           "br1-3", "br3-6", "br3-3", "br6-8", "br1-1"]

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "data", "market", "listings.json")


class Blocked(Exception):
    pass


class CachedHTTP:
    """GET with an on-disk cache (one file per URL) and a minimum interval between
    network requests. A cached response is never refetched."""

    def __init__(self, cache_dir, min_interval=1.1, offline=False):
        self.dir = cache_dir
        os.makedirs(self.dir, exist_ok=True)
        self.min_interval = min_interval
        self.offline = offline
        self.last = 0.0
        self.net = 0
        self.hits = 0
        self.s = requests.Session()
        self.s.headers.update({
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-GB,en;q=0.9",
        })

    def _path(self, url):
        return os.path.join(self.dir, hashlib.sha1(url.encode()).hexdigest()[:20] + ".html")

    def get(self, url):
        p = self._path(url)
        if os.path.exists(p):
            self.hits += 1
            with open(p, encoding="utf-8") as f:
                return f.read()
        if self.offline:
            return None
        wait = self.min_interval - (time.time() - self.last)
        if wait > 0:
            time.sleep(wait)
        self.last = time.time()
        self.net += 1
        r = self.s.get(url, timeout=40)
        body = r.text
        if r.status_code in (403, 429) or ("captcha" in body[:20000].lower() and "__NEXT_DATA__" not in body):
            raise Blocked(f"HTTP {r.status_code} on {url}")
        if r.status_code == 404:
            return None
        r.raise_for_status()
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(body)
        os.replace(tmp, p)
        with open(os.path.join(self.dir, "index.tsv"), "a", encoding="utf-8") as f:
            f.write(f"{os.path.basename(p)}\t{r.status_code}\t{time.strftime('%Y-%m-%dT%H:%M:%S')}\t{url}\n")
        return body


def next_data(html):
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html or "", re.S)
    return json.loads(m.group(1)) if m else None


def redux(html):
    d = next_data(html)
    return (d or {}).get("props", {}).get("pageProps", {}).get("initialReduxState")


# ---------------------------------------------------------------- geometry
KX = 111320 * math.cos(math.radians(CENTRE[0]))
KY = 110574


def dist_m(lat, lon):
    """Haversine distance from CENTRE in metres."""
    p1, p2 = math.radians(CENTRE[0]), math.radians(lat)
    dp, dl = p2 - p1, math.radians(lon - CENTRE[1])
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(a))


def _xy(lat, lon):
    return ((lon - CENTRE[1]) * KX, (lat - CENTRE[0]) * KY)


def _inside(pt, ring):
    x, y = pt
    c = False
    for i in range(len(ring)):
        x1, y1 = ring[i]
        x2, y2 = ring[i - 1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
            c = not c
    return c


def coverage(rings, radius_m, step=100):
    """Share of a `step`-metre grid over the circle that falls inside at least one ring,
    plus a few uncovered sample points (lat, lon)."""
    rings = [[_xy(lat, lon) for lat, lon in r] for r in rings if len(r) >= 3]
    n = tot = 0
    missing = []
    k = int(radius_m / step)
    for i in range(-k, k + 1):
        for j in range(-k, k + 1):
            x, y = i * step, j * step
            if math.hypot(x, y) > radius_m:
                continue
            tot += 1
            if any(_inside((x, y), r) for r in rings):
                n += 1
            elif len(missing) < 8:
                missing.append((round(CENTRE[0] + y / KY, 5), round(CENTRE[1] + x / KX, 5)))
    return (n / tot if tot else 0), missing


# ---------------------------------------------------------------- normalisation
FORM_WORDS = [(r"semi[- ]detached", "semi-detached"), (r"end[- ]of[- ]terrace|end[- ]terrace", "end-terrace"),
              (r"\bterrace[d]?\b|town ?house|\bmews\b", "terraced"), (r"\bdetached\b", "detached"),
              (r"\bbungalow\b", "bungalow")]


def norm_type(humanised, title="", extra=""):
    """OnTheMarket property type -> detached | semi-detached | terraced | end-terrace | flat |
    bungalow | other. A generic 'House' is resolved from the feature text when it names the
    built form; retirement / age-restricted homes, land, commercial and unknown -> other."""
    t = (humanised or "").lower()
    s = f"{t} {(title or '').lower()}"
    if "retirement" in s or "park home" in s or "mobile home" in s:
        return "other"
    if "bungalow" in t:
        return "bungalow"
    if any(w in t for w in ("flat", "apartment", "maisonette", "penthouse", "studio", "duplex")):
        return "flat"
    if "end of terrace" in t or "end terrace" in t or "end-terrace" in t:
        return "end-terrace"
    if "semi-detached" in t or "semi detached" in t:
        return "semi-detached"
    if "detached" in t:            # detached, link-detached
        return "detached"
    if "terrace" in t or "town house" in t or "townhouse" in t or "mews" in t:
        return "terraced"
    if t in ("house", "property", "cottage", "") and extra:
        for rx, typ in FORM_WORDS:
            if re.search(rx, extra, re.I):
                return typ
    return "other"


def parse_price(s):
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return int(s)
    m = re.search(r"£\s*([\d,]+)", s)
    return int(m.group(1).replace(",", "")) if m else None


NUM = r"(?<![\d.,])(\d{1,2}(?:,\d{3})+(?:\.\d+)?|\d{2,5}(?:\.\d+)?)"
RE_SQFT = re.compile(NUM + r"\s*(?:sq\.?\s*(?:ft|feet)\b|square\s+f(?:ee|oo)t\b|ft2|ft²|sqft\b)", re.I)
RE_SQM = re.compile(NUM + r"\s*(?:sq\.?\s*(?:m|metres?|meters?|mtrs?)\b|square\s+met(?:re|er)s?\b|m2\b|m²|sqm\b)", re.I)
# words right next to a figure that mean it is not the home's total internal area
HARD_BAD = re.compile(r"garden|plot|acre|grounds|\bland\b|outbuilding|garage|office|workshop|annex|cellar|"
                      r"basement|patio|decking|driveway|\bshed\b|summer ?house|cabin|commercial|retail|"
                      r"\bper\b|\bfrom\b|\bup to\b|\bbetween\b", re.I)
SOFT_BAD = re.compile(r"\broom|lounge|kitchen|bedroom|reception|studio|\bloft|extension|terrace|balcon|"
                      r"storage|conservatory|dining|suite|principal|master|landing|hall", re.I)
GOOD_CTX = re.compile(r"approx|total|internal|floor ?area|accommodation|\bgia\b|\bnia\b|living space|"
                      r"interior|in excess of|circa|\bc\.\s*$|of space|extends to|arranged over|measur|"
                      r"offering|boasts|provides|comprising", re.I)


def area_from_text(texts):
    """Best stated TOTAL floor area (m2, sqft) from free text, or (None, None).
    Room dimensions, garden/plot/outbuilding sizes and 'from ...' ranges are ignored."""
    cands = []
    k = 0
    for txt in texts:
        if not txt:
            continue
        txt = re.sub(r"<[^>]+>", " ", str(txt))
        for rx, unit in ((RE_SQFT, "ft"), (RE_SQM, "m")):
            for m in rx.finditer(txt):
                k += 1
                v = float(m.group(1).replace(",", ""))
                before = txt[max(0, m.start() - 40):m.start()]
                after = txt[m.end():m.end() + 25]
                if HARD_BAD.search(before[-30:]) or re.search(r"^\W{0,3}(?:of )?(?:garden|plot|grounds|land)", after, re.I):
                    continue
                if re.search(r"^\W{0,4}(?:incl\.?|including|inc\.?|with)\s+(?:the\s+)?(?:integral\s+|double\s+)?"
                             r"(?:garage|outbuilding|annex|cellar|basement|loft)", after, re.I):
                    continue            # gross figure that includes a garage etc., not the home's internal area
                good = bool(GOOD_CTX.search(before) or re.match(r"\W{0,3}(?:\(?[\d.,]+\s*sq\.?\s*m\)?\s*)?(?:floor area|of (?:living|accommodation|internal))", after, re.I))
                if SOFT_BAD.search(before[-30:]) and not good:
                    continue
                if re.search(r"(?:\bx|×|by)\s*$", before[-5:]) or re.match(r"\s*(?:x|×)\s*\d", after):
                    continue
                m2 = v * SQFT_TO_M2 if unit == "ft" else v
                if not 20 <= m2 <= 1500:
                    continue
                cands.append((2 if good else 1, -k, m2, v if unit == "ft" else None))
    if not cands:
        return None, None
    _, _, m2, sqft = max(cands)        # best context, then first mentioned
    return round(m2, 1), (round(sqft) if sqft else round(m2 / SQFT_TO_M2))


# New home: OnTheMarket's New Homes channel / new-home flags, or explicit wording. A "new build
# warranty" alone is not enough: homes resold within their 10-year warranty still mention it.
RE_NEW = re.compile(r"\bbrand[- ]new\b|\bnewly[- ]built\b|\bnew[- ]homes? development\b|\bplot\s*\d+\b|"
                    r"\bready for occupation\b|\bshow ?home\b|\bhelp to buy\b", re.I)
RE_RESALE = re.compile(r"\bbuilt (?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten) years? ago\b|"
                       r"\b(?:built|constructed|completed) in (?:19\d\d|20(?:[01]\d|2[0-4]))\b", re.I)
# Sale conditions that make an asking price non-comparable with an ordinary market sale.
SALE_FLAGS = [
    ("cash_only", re.compile(r"\bcash (?:buyers?|purchasers?) only\b|\bcash only\b|\bnon[- ]?mortgage?able\b|"
                             r"\bunmortgage?able\b|purchases? requiring lending will not be considered", re.I)),
    ("refurb_project", re.compile(r"\b(?:refurbishment|renovation|restoration|modernisation|modernization) project\b|"
                                  r"\b(?:requires?|in need of|needs) (?:a )?(?:complete|full|total|major|extensive) "
                                  r"(?:refurbishment|renovation|modernisation|modernization)\b|\bstate of disrepair\b|"
                                  r"\bderelict\b", re.I)),
    ("probate", re.compile(r"\bprobate\b", re.I)),
]
RE_LEASE = re.compile(r"(\d{2,4})\s*(?:yrs?|years?)\s*(?:left|remaining|unexpired)|"
                      r"\blease(?:hold)?\s*(?:of|:|-|–)?\s*(\d{2,4})\s*(?:yrs?|years?)\b", re.I)


def tenure_lease(keyinfo, texts):
    """('freehold'|'leasehold'|'share of freehold'|None, years left on the lease or None)."""
    t = str((keyinfo or {}).get("Tenure") or "")
    tl = t.lower()
    ten = ("share of freehold" if "share of freehold" in tl else "leasehold" if "leasehold" in tl
           else "freehold" if "freehold" in tl else None)
    years = None
    for src in [t] + [str(x) for x in texts if x]:
        m = RE_LEASE.search(src)
        if m:
            years = int(m.group(1) or m.group(2))
            break
    if years is not None and not 1 <= years <= 999:
        years = None
    return ten, years


def sale_flags(texts):
    blob = " | ".join(str(x) for x in texts if x)
    return [k for k, rx in SALE_FLAGS if rx.search(blob)]


def safe_url(u):
    """Only https links to onthemarket.com are kept (a scraped javascript:/data: URL is dropped)."""
    try:
        p = urllib.parse.urlparse(u or "")
    except ValueError:
        return None
    host = (p.hostname or "").lower()
    return u if p.scheme == "https" and (host == "onthemarket.com" or host.endswith(".onthemarket.com")) else None


RE_SHARED = re.compile(r"shared[- ]ownership|\b\d{1,2}(?:\.\d+)?\s*%\s*share\b|share of (?:\d|the) property", re.I)
RE_RETIRE = re.compile(r"retirement (?:flat|apartment|property|home|development|complex|living|studio)|"
                       r"\bover[- ]?(?:55|60|65|70)'?s\b|\bover (?:55|60|65|70)\b|age[- ]restricted|"
                       r"sheltered (?:housing|accommodation|flat|apartment)|warden", re.I)


def is_retirement(feats, *texts):
    """OnTheMarket tags age-restricted homes with a 'Retirement' feature; also check the text."""
    return any(str(f).strip().lower() == "retirement" for f in feats) or \
        bool(RE_RETIRE.search(" | ".join(map(str, list(feats) + list(texts)))))


# ---------------------------------------------------------------- search
def search_pages(http, url, log):
    """Yield (redux_state) for every results page of a search, following 'next' links."""
    seen = set()
    while url and url not in seen:
        seen.add(url)
        st = redux(http.get(url))
        if not st:
            log(f"  !! no data at {url}")
            return
        yield url, st
        nxt = (st.get("results", {}).get("paginationControls") or {}).get("next") or {}
        link = nxt.get("next-link")
        url = urllib.parse.urljoin(BASE, link) if link else None


def run_searches(http, log):
    raw, new_ids, rings, used = {}, set(), [], []
    for sec in SECTORS:
        for channel in ("for-sale", "new-homes"):
            first = f"{BASE}/{channel}/property/{sec}/"
            used.append(first)
            n_pages = 0
            for url, st in search_pages(http, first, log):
                n_pages += 1
                res = st["results"]
                if channel == "for-sale" and n_pages == 1:
                    for poly in (st.get("maps", {}).get("geoLocation", {}).get("polygons") or []):
                        for ring in poly:
                            rings.append([(p["lat"], p["lon"]) for p in ring])
                for x in res.get("list") or []:
                    if not x.get("id"):
                        continue
                    if channel == "new-homes":
                        new_ids.add(str(x["id"]))
                    raw.setdefault(str(x["id"]), x)
            log(f"  {channel:9s} {sec:6s} pages={n_pages}")
    return raw, new_ids, rings, used


# ---------------------------------------------------------------- details
def detail(http, lid):
    st = redux(http.get(f"{BASE}/details/{lid}/"))
    if not st:
        return None
    p = st.get("property") or {}
    if str(p.get("id")) != str(lid):
        return None
    hd = {}
    try:
        hd = json.loads((p.get("headerData") or {}).get("dataLayer") or "{}")
    except ValueError:
        pass
    feats = [f.get("feature") if isinstance(f, dict) else str(f) for f in (p.get("features") or [])]
    return {
        "sqm": p.get("minimumAreaSqM"), "sqft": p.get("minimumAreaSqFt"), "area_text": p.get("minimumArea"),
        "new": bool(p.get("newHomeFlag")) or bool(p.get("developmentProperty")) or bool(hd.get("new-home"))
               or (p.get("transTypeId") or "").startswith("new"),
        "trans": p.get("transTypeId"), "status": hd.get("status"),
        "features": feats, "summary": p.get("summary"), "description": p.get("description"),
        "labels": p.get("propertyLabels") or [], "type": p.get("humanisedPropertyType"),
        "title": p.get("propertyTitle"), "subtype": p.get("propSubId"), "qualifier": p.get("priceQualifier"), "price": p.get("priceRaw"),
        "keyinfo": {k.get("title"): k.get("value") for k in (p.get("keyInfo") or []) if isinstance(k, dict)},
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    default_cache = os.path.join(os.environ.get("MARKET_CACHE") or os.path.expanduser("~/.cache/bromley-market"), "otm")
    ap.add_argument("--cache", default=default_cache)
    ap.add_argument("--offline", action="store_true", help="use cached pages only, no network")
    ap.add_argument("--max-details", type=int, default=MAX_DETAILS)
    ap.add_argument("--radius-m", type=int, default=RADIUS_M)
    ap.add_argument("--out", default=OUT)
    a = ap.parse_args()
    log = lambda *s: print(*s, file=sys.stderr, flush=True)
    http = CachedHTTP(a.cache, offline=a.offline)

    try:
        raw, new_ids, rings, used = run_searches(http, log)
    except Blocked as e:
        log(f"BLOCKED by OnTheMarket: {e}. Stopping without writing anything.")
        sys.exit(2)

    cov, missing = coverage(rings, a.radius_m)
    log(f"search polygons cover {cov:.1%} of the {a.radius_m} m circle" + (f"; uncovered e.g. {missing}" if missing else ""))

    rows = []
    for lid, x in raw.items():
        loc = x.get("location") or {}
        if loc.get("lat") is None or loc.get("lon") is None:
            continue
        d = dist_m(loc["lat"], loc["lon"])
        if d > a.radius_m:
            continue
        feats = [str(f) for f in (x.get("features") or [])]
        typ = norm_type(x.get("humanised-property-type"), x.get("property-title"), " | ".join(feats))
        if typ != "other" and is_retirement(feats, x.get("property-title")):
            typ = "other"               # age-restricted retirement homes are a separate market
        rows.append({"lid": lid, "x": x, "d": d, "feats": feats, "type": typ})
    rows.sort(key=lambda r: r["d"])

    # detail pages: the nearest houses and flats (incl. a generic 'House' whose form is not
    # given), plus up to 10 suspiciously cheap ones further out (shares / auction lots).
    pool = [r for r in rows if r["type"] != "other" or
            ((r["x"].get("humanised-property-type") or "").lower() in ("house", "property")
             and not is_retirement(r["feats"]))]
    want = pool[: a.max_details]
    want += [r for r in pool[a.max_details:] if (parse_price(r["x"].get("price")) or 0) < 150000][:10]
    details = {}
    try:
        for i, r in enumerate(want):
            det = detail(http, r["lid"])
            if det:
                details[r["lid"]] = det
            if (i + 1) % 20 == 0:
                log(f"  details {i + 1}/{len(want)} (network {http.net})")
    except Blocked as e:
        log(f"BLOCKED by OnTheMarket while reading listing pages: {e}. Writing what was collected so far.")

    listings = []
    for r in rows:
        x, lid, det = r["x"], r["lid"], details.get(r["lid"])
        feats = r["feats"] + (det["features"] if det else [])
        texts_all = feats + [x.get("property-title")] + ([det.get("summary"), det.get("description")] if det else [])
        typ = r["type"]
        if det:
            dt_type = norm_type(det.get("type"), det.get("title"), " | ".join(feats + [str(det.get("summary"))]))
            if dt_type == "other" and det.get("subtype"):
                dt_type = norm_type(det["subtype"].replace("-", " "))
            if dt_type != "other" or typ == "other":
                typ = dt_type
            if typ != "other" and is_retirement(feats, det.get("summary")):
                typ = "other"
        qual = x.get("price-qualifier") or (det and det.get("qualifier")) or None
        if RE_SHARED.search(" | ".join(map(str, texts_all + [qual]))):
            qual = "Shared ownership" + (f" ({qual})" if qual and "shared" not in qual.lower() else "")
        elif "Auction" in feats or re.search(r"\bauction", str((x.get("agent") or {}).get("name")) + " " + str(qual), re.I) \
                or re.search(r"under the hammer", str((x.get("agent") or {}).get("name")), re.I):
            qual = "Auction" + (f" ({qual})" if qual and "auction" not in qual.lower() else "")
        # floor area: structured value from the listing page and/or a total stated in the text.
        # When both exist and differ by more than AREA_CONFLICT the area is marked 'conflict' (we cannot
        # tell which one is right, e.g. a loft conversion missing from the structured figure).
        m2 = sqft = None
        if det and (det.get("sqm") or det.get("sqft")) and not re.match(r"\s*from\b", det.get("area_text") or "", re.I):
            if det.get("sqft"):         # OTM rounds sq m to an integer; sq ft is the stated unit
                sqft = int(det["sqft"])
                m2 = round(sqft * SQFT_TO_M2, 1)
            else:
                m2 = round(float(det["sqm"]), 1)
                sqft = round(m2 / SQFT_TO_M2)
        if m2 is not None and not 20 <= m2 <= 1500:
            m2 = sqft = None
        t_m2, t_sqft = area_from_text(feats + ([det.get("summary"), det.get("description")] if det else []))
        area_source, m2_text = None, None
        if m2 is not None:
            area_source = "structured"
            if t_m2 and abs(t_m2 / m2 - 1) > AREA_CONFLICT:
                area_source, m2_text = "conflict", t_m2
        elif t_m2 is not None:
            m2, sqft, area_source = t_m2, t_sqft, "text"
        texts_det = feats + [x.get("property-title")] + ([det.get("summary"), det.get("description")] if det else [])
        tenure, lease_years = tenure_lease(det.get("keyinfo") if det else {}, feats + ([det.get("summary")] if det else []))
        flags = sale_flags(texts_det)
        if lease_years is not None and tenure != "freehold" and lease_years < 80:
            flags.append("short_lease")
        new_text = " | ".join(map(str, feats + ([det.get("summary")] if det else [])))
        new_home = ((lid in new_ids) or bool(det and det["new"]) or bool(RE_NEW.search(new_text))) \
            and not RE_RESALE.search(" | ".join(map(str, texts_det)))
        beds = x.get("bedrooms")
        if beds is None and re.search(r"\bstudio\b", f"{x.get('property-title')} {x.get('humanised-property-type')}", re.I):
            beds = 0
        agent = (x.get("agent") or {}).get("name")
        listings.append({
            "id": lid,
            "url": safe_url(urllib.parse.urljoin(BASE, x.get("details-url") or f"/details/{lid}/")),
            "price": parse_price(x.get("price")) or (det and det.get("price")) or None,
            "price_qualifier": qual,
            "beds": beds,
            "baths": x.get("bathrooms"),
            "type": typ,
            "address": x.get("address"),
            "lat": round(float(x["location"]["lat"]), 6),
            "lon": round(float(x["location"]["lon"]), 6),
            "dist_m": round(r["d"]),
            "m2": m2,
            "sqft": sqft,
            "area_source": area_source,
            "m2_text": m2_text,
            "tenure": tenure,
            "lease_years": lease_years,
            "sale_flags": flags,
            "new_home": new_home,
            "agent": agent,
        })

    out = {
        "generated": dt.date.today().isoformat(),
        "source": {"name": "OnTheMarket", "url": BASE + "/"},
        "searches": used,
        "centre": {"lat": CENTRE[0], "lon": CENTRE[1]},
        "radius_m": a.radius_m,
        "notes": ("Asking prices of homes listed for sale (under-offer / sold STC excluded) within "
                  f"{a.radius_m / 1000:g} km of the site, from OnTheMarket postcode-sector searches "
                  f"(coverage of the circle {cov:.0%}). Floor area as stated by the agent (listing's "
                  f"structured size or text), read from {len(details)} listing pages (nearest houses/flats first); "
                  "null when not stated. area_source: 'structured' (listing's size field), 'text' (total stated in "
                  f"the text) or 'conflict' (both given, more than {AREA_CONFLICT:.0%} apart; m2 = structured, m2_text = "
                  "stated). tenure / lease_years from the listing's key facts. sale_flags: cash_only, refurb_project, "
                  "probate, short_lease (< 80 years left) - not ordinary market sales. type 'other' = land, "
                  "retirement/age-restricted homes, unspecified. Shared-ownership and auction lots are marked in "
                  "price_qualifier (a share price / auction guide, not comparable with whole-home asking prices). "
                  "new_home: New Homes channel / new-home flag / explicit wording ('brand new', plot no.), not a "
                  "warranty mention alone."),
        "listings": listings,
    }
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:      # one listing per line: compact, diff-friendly
        head = json.dumps({k: v for k, v in out.items() if k != "listings"}, ensure_ascii=False, indent=1)
        f.write(head[:-2] + ',\n "listings": [\n')
        f.write(",\n".join("  " + json.dumps(l, ensure_ascii=False, separators=(",", ":")) for l in listings))
        f.write("\n ]\n}\n")
    log(f"wrote {a.out}: {len(listings)} listings within {a.radius_m} m "
        f"({sum(1 for l in listings if l['m2'])} with floor area, {sum(1 for l in listings if l['new_home'])} new homes); "
        f"network requests {http.net}, cache hits {http.hits}")
    report(listings, log)


def report(listings, log):
    """Print counts and medians by type / beds (shared-ownership and auction lots left out)."""
    import collections
    use = [l for l in listings if l["price"] and not re.match(r"shared|auction", (l["price_qualifier"] or "").lower())]
    by = collections.defaultdict(list)
    for l in use:
        by[(l["type"], l["beds"])].append(l)
    log(f"{'type':14s} {'beds':>4s} {'n':>4s} {'w/m2':>5s} {'median £':>11s} {'median £/m2':>12s}")
    for (t, b), L in sorted(by.items(), key=lambda kv: (kv[0][0], kv[0][1] if kv[0][1] is not None else -1)):
        pp = [l["price"] / l["m2"] for l in L if l["m2"]]
        log(f"{t:14s} {str(b):>4s} {len(L):4d} {len(pp):5d} {statistics.median([l['price'] for l in L]):11,.0f} "
            f"{(f'{statistics.median(pp):12,.0f}' if pp else '           -')}")


if __name__ == "__main__":
    main()
