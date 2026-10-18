#!/usr/bin/env python3
"""Berkeley Group new homes currently ON SALE near the Ravensbourne Place site -> data/market/berkeley.json

Purpose: measure the NEW-BUILD price level (asking price per m²) of Berkeley Group homes that
are on the market now, as a benchmark for Ravensbourne Place (26/02199/OUT), which is not on
sale yet.

Source: www.berkeleygroup.co.uk, which lists the developments of every Group brand (Berkeley,
St George, St James, St Edward, St Joseph, St William). The public pages are filled by the
site's own JSON endpoints, which the script reads directly (same data a browser gets):
  1. /search_api/developments/list?county=<c>&city=&status=Default   -> development ids per city
     (COUNTIES: london, kent, surrey - every other county page is > 40 km from the site)
  2. /search_api/developments/details?developmentId=<id>&status=Default
     -> name, "Town, POSTCODE", status, property types, price range, URL
  3. postcodes.io bulk lookup of the development postcodes -> lat/lon (outcode centroid as a
     fallback for a truncated / unknown postcode) -> distance to the Phase 1A centroid
  4. for developments within --max-km and with homes released:
     /search_api/properties?noOfItemsPerPage=200&dataSourcePageId=<id>&status=Default
     -> every home on sale: plot number, status, price, bedrooms, square footage, floor,
        type (House / Apartment / ...), phase, estimated completion
  5. for HOUSES only, the property page (/development/<slug>/property-...) is read to get the
     built form ("3-bedroom end of terrace property", "detached", ...) and the tenure.
Square footage is converted to m² (x 0.092903) and ppm2 = price / m2.

Output fields follow the shared contract (developments[].homes[] = name, beds, type, price,
sqft, m2, ppm2, status) plus a few extras (phase, completion, floor, built_form, tenure, url,
ppsqft) and a top-level `summary` (median £/m² for houses and flats, all and "comparable"
outer-London / Kent subsets) and `web_notes` (recent price evidence found by web search,
maintained by hand in WEB_NOTES below - re-check the URLs when refreshing).

Politeness: one request at a time, >= 1.1 s apart, normal browser User-Agent, every response
cached on disk (a cached URL is never fetched again; delete the cache folder to refresh). On
403 / 429 / captcha the script stops and reports - it never tries to get around a block.

Usage:
  python3 scripts/market/fetch_berkeley.py --cache /path/to/cache/berkeley
  python3 scripts/market/fetch_berkeley.py --offline      # rebuild from the cache only
Options: --max-km K (default 35), --out PATH, --no-property-pages.
Default cache: $MARKET_CACHE/berkeley, else ~/.cache/bromley-market/berkeley (the root all scripts/market/*.py share).
"""
import argparse
import datetime as dt
import hashlib
import html as htmllib
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
BASE = "https://www.berkeleygroup.co.uk"
CENTRE = (51.3826, 0.0213)          # Ravensbourne Place Phase 1A centroid
CHARING_CROSS = (51.5073, -0.1276)  # used to tell central London from outer London
COUNTIES = ["london", "kent", "surrey"]
MAX_KM = 35
SQFT_TO_M2 = 0.092903
# A development counts as "comparable" for the headline numbers when it is in outer London
# (>= OUTER_KM from Charing Cross) within COMPARABLE_LONDON_KM of the site (i.e. the
# south-east London submarket, not north/west London), or in Kent/Surrey within COMPARABLE_KM.
OUTER_KM = 9.0
COMPARABLE_LONDON_KM = 20
COMPARABLE_KM = 35

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "data", "market", "berkeley.json")

# Evidence found by web search / one-off look-ups on 2026-10-18. Kept by hand (these pages are
# not scraped by this script); re-check the URLs when refreshing.
WEB_NOTES = [
    {"topic": "Berkeley Group average selling price",
     "text": "Year to 30 April 2026: 4,076 homes completed across London and the South East at an "
             "average selling price of £546,000, down 7.9% from £593,000 the year before (results of "
             "24 June 2026). Group-wide mix, mostly London apartments - context only.",
     "urls": ["https://www.ajbell.co.uk/news/articles/berkeley-group-shares-annual-profit-edges-past-guidance"]},
    {"topic": "Foal Hurst Green (Paddock Wood) - achieved new-build prices, first phase",
     "text": "HM Land Registry Price Paid, Juno Street TN12 6FU (an agent listing confirms Juno Street is "
             "Berkeley's Foal Hurst Green, 2021 build; 4 Juno Street = 3-bed semi of ~1,019 sq ft / 94.7 m²): "
             "11 new-build sales Oct 2021 - Apr 2022 - semis £445,000-£459,000 (No. 4: £445,000 = "
             "~£4,700/m²), terraces £437,600-£515,500, detached £505,000-£680,000 (median £666,250). "
             "Today's asking prices for 3-bed semis at the same scheme (1,133-1,136 sq ft) are "
             "£575,000-£600,000 (~£5,450-£5,700/m²).",
     "urls": ["https://landregistry.data.gov.uk/app/ppd/ppd_data.csv?header=true&limit=all&street=JUNO+STREET",
              "https://street.co.uk/platform/properties/389be23f-a5c7-4f65-99ec-8efe27520fdb"]},
    {"topic": "Kidbrooke Village (Greenwich SE3) - agent price guidance",
     "text": "Benhams new-homes page (updated October 2026) quotes Kidbrooke Village from £375,000 "
             "(1 bed), £525,000 (2 bed), £650,000 (3 bed) and £1,100,000 (4 bed); the Blackheath "
             "Collection townhouses are 4-bed, 1,515 sq ft (141 m²) at £1,110,000. Zoopla's new-homes "
             "listings show the Pegler Square townhouses at £1,100,000-£1,110,000, one of them listed since "
             "19 Sep 2025 (over a year on the market - asking prices are not necessarily achieved). These "
             "are the only Berkeley new-build HOUSES on sale within 15 km of the site.",
     "urls": ["https://www.benhams.com/new-homes/kidbrooke-village-london/",
              "https://www.zoopla.co.uk/new-homes/details/70635880/"]},
    {"topic": "Ravensbourne Place itself",
     "text": "No prices published: the outline application (26/02199/OUT, ~2,200 homes in two "
             "neighbourhoods, Bromley Gate and Hayes Mead, about half affordable per Berkeley) is "
             "undetermined, and no Berkeley scheme is on sale in Bromley, Croydon, Lewisham or Bexley "
             "boroughs today. Older Berkeley house-led schemes in the area (e.g. Ryewood, Dunton Green, "
             "Sevenoaks, 2012-2015) are long sold out.",
     "urls": ["https://britbrief.co.uk/business/property/detailed-plans-for-2200-home-green-belt-development-released.html",
              "https://www.berkeleygroup.co.uk/news-and-insights/news-and-features/2013/development-flourishes-in-sevensoaks"]},
    {"topic": "Incentives",
     "text": "Berkeley currently advertises an 'Own New: Rate Reducer' mortgage-rate incentive on its "
             "site; asking prices here are before any incentive.",
     "urls": ["https://www.berkeleygroup.co.uk/developments"]},
]


class Blocked(Exception):
    pass


class CachedHTTP:
    """GET/POST with an on-disk cache (one file per request) and a minimum interval between
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

    def _path(self, key):
        return os.path.join(self.dir, hashlib.sha1(key.encode()).hexdigest()[:20] + ".html")

    def get(self, url, post_json=None):
        key = url if post_json is None else url + "\nPOST " + json.dumps(post_json, sort_keys=True)
        p = self._path(key)
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
        if post_json is None:
            r = self.s.get(url, timeout=40)
        else:
            r = self.s.post(url, json=post_json, timeout=40)
        body = r.text
        if r.status_code in (403, 429) or "captcha" in body[:20000].lower():
            raise Blocked(f"HTTP {r.status_code} on {url}")
        if r.status_code == 404:
            return None
        r.raise_for_status()
        tmp = p + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(body)
        os.replace(tmp, p)
        with open(os.path.join(self.dir, "index.tsv"), "a", encoding="utf-8") as f:
            f.write(f"{os.path.basename(p)}\t{r.status_code}\t{time.strftime('%Y-%m-%dT%H:%M:%S')}\t{key}\n")
        return body

    def get_json(self, url, post_json=None):
        body = self.get(url, post_json)
        if body is None:
            return None
        try:
            return json.loads(body)
        except ValueError:
            return None


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def haversine_km(a, b):
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(h))


def money(s):
    """'£1,110,000' -> 1110000; anything without digits -> None."""
    if not s:
        return None
    d = re.sub(r"[^\d]", "", str(s).split(".")[0])
    return int(d) if d else None


def num(s):
    if s is None:
        return None
    d = re.sub(r"[^\d.]", "", str(s))
    try:
        return float(d) if d else None
    except ValueError:
        return None


POSTCODE_RE = re.compile(r"\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})?\b")


def split_address(addr):
    """'Greenwich, SE3 9FW' -> ('Greenwich', 'SE3 9FW', 'SE3'). Postcode may be partial."""
    addr = re.sub(r"\s+", " ", (addr or "")).strip()
    parts = [p.strip() for p in addr.split(",") if p.strip()]
    pc = outcode = None
    if parts:
        m = POSTCODE_RE.search(parts[-1].upper())
        if m:
            outcode = m.group(1)
            pc = f"{m.group(1)} {m.group(2)}" if m.group(2) else None
            parts = parts[:-1] if POSTCODE_RE.fullmatch(parts[-1].upper().strip()) or len(parts) > 1 else parts
    area = ", ".join(p for p in parts if not POSTCODE_RE.fullmatch(p.upper())) or None
    return area, pc, outcode


def geocode(http, postcodes, outcodes):
    """postcode -> (lat, lon) via postcodes.io (bulk POST), with outcode centroids as fallback."""
    out = {}
    pcs = sorted(p for p in postcodes if p)
    for i in range(0, len(pcs), 100):
        batch = pcs[i:i + 100]
        d = http.get_json("https://api.postcodes.io/postcodes", post_json={"postcodes": batch})
        for row in (d or {}).get("result") or []:
            r = row.get("result")
            if r and r.get("latitude") is not None:
                out[row["query"]] = (r["latitude"], r["longitude"], "postcode")
    for oc in sorted(o for o in outcodes if o):
        if ("OUT", oc) in out:
            continue
        d = http.get_json(f"https://api.postcodes.io/outcodes/{urllib.parse.quote(oc)}")
        r = (d or {}).get("result")
        if r and r.get("latitude") is not None:
            out[("OUT", oc)] = (r["latitude"], r["longitude"], "outcode")
    return out


def page_text(h):
    t = re.sub(r"<script.*?</script>|<style.*?</style>", " ", h or "", flags=re.S | re.I)
    t = re.sub(r"<[^>]+>", "\n", t)
    t = htmllib.unescape(t).replace("\xa0", " ")
    t = re.sub("[\u2010-\u2015]", "-", t)
    return re.sub(r"\n\s*\n+", "\n", t)


BUILT_FORMS = [
    (r"\bsemi[\s-]*detached\b", "semi-detached"),
    (r"\bend[\s-]+(?:of[\s-]+)?terrace", "end-terrace"),
    (r"\bmid[\s-]+terrace", "mid-terrace"),
    (r"\btown\s*houses?\b", "townhouse"),
    (r"\bterrace(?:d)?\b", "terraced"),
    (r"\bdetached\b", "detached"),
    (r"\bbungalow\b", "bungalow"),
    (r"\bmews\b", "mews"),
]


def parse_property_page(h):
    """Built form, bathrooms, storeys (floor-plan levels), tenure and estimated service
    charge from a property page. The page repeats the "Property <no>, <phase>" heading in
    the <title>; the real header block is the occurrence followed by the price and the
    feature bullets, up to "Register Interest"."""
    t = page_text(h)
    res = {"built_form": None, "baths": None, "storeys": None, "tenure": None,
           "service_charge_pa": None, "headline": None}
    block = ""
    for m in re.finditer(r"(?m)^Property [^\n]+$", t):
        end = t.find("Register Interest", m.start())
        b = t[m.start(): end if end > 0 else m.start() + 2500]
        if re.search(r"(?m)^(?:£\s*[\d,]{5,}\s*|Price on application.*)$", b):
            block = b
            break
    if not block:
        return res
    lines = [ln.strip() for ln in block.split("\n") if ln.strip()]
    for ln in lines:
        if re.match(r"\d+[\s-]*bed(room)?s?\b.*\b(property|house|home|townhouse)\b", ln, re.I):
            res["headline"] = ln
            break
    # built form: the headline first, then the heading + feature bullets
    for src in (res["headline"] or "", block):
        for rx, name in BUILT_FORMS:
            if re.search(rx, src, re.I):
                res["built_form"] = name
                break
        if res["built_form"]:
            break
    m = (re.search(r"(?m)^(\d+)\s+bathrooms?$", block, re.I) or
         re.search(r"\b(\d+)\s+bathrooms?\b", block, re.I))
    if m:
        res["baths"] = int(m.group(1))
    i, j = t.find("\nFloorplan\n"), t.find("\nSite Map\n")
    if 0 <= i < j:
        levels = {ln.strip().lower() for ln in t[i:j].split("\n")
                  if re.fullmatch(r"(lower ground|ground|first|second|third|fourth|basement|upper ground)"
                                  r"(\s+floor)?", ln.strip(), re.I)}
        res["storeys"] = len(levels) or None
    m = re.search(r"\nTenure\n(?:Tenure\n)?\s*(Freehold|Leasehold|Share of Freehold)", t, re.I)
    if m:
        res["tenure"] = m.group(1).title()
    m = re.search(r"Service Charge Total Amount[^\n]*\n\s*£\s*([\d,]+(?:\.\d+)?)", t)
    if m:
        res["service_charge_pa"] = round(float(m.group(1).replace(",", "")))
    return res


def norm_type(t):
    t = (t or "").strip().lower()
    if t in ("apartment", "flat", "penthouse", "duplex", "maisonette", "studio"):
        return "flat"
    if t in ("house", "townhouse", "town house", "cottage", "bungalow"):
        return "house"
    return t or None


def med(xs):
    xs = [x for x in xs if x is not None]
    return round(statistics.median(xs)) if xs else None


def quart(xs):
    xs = sorted(x for x in xs if x is not None)
    if len(xs) < 4:
        return None
    q = statistics.quantiles(xs, n=4)
    return [round(q[0]), round(q[2])]


def summarise(homes):
    """Median £/m² etc. for a list of home dicts (only homes with a size count for ppm2)."""
    out = {}
    for typ in ("house", "flat"):
        hs = [h for h in homes if h["type"] == typ]
        sized = [h for h in hs if h.get("ppm2")]
        by_beds = {}
        for h in hs:
            by_beds.setdefault(str(h["beds"]) if h["beds"] is not None else "?", []).append(h)
        out[typ] = {
            "n": len(hs),
            "n_with_size": sum(1 for h in hs if h.get("m2")),
            "n_with_ppm2": len(sized),
            "median_ppm2": med(h["ppm2"] for h in sized),
            "iqr_ppm2": quart(h["ppm2"] for h in sized),
            "median_price": med(h["price"] for h in hs),
            "median_m2": med(h["m2"] for h in sized),
            "by_beds": {
                b: {"n": len(v), "from_price": min((h["price"] for h in v if h["price"]), default=None),
                    "median_price": med(h["price"] for h in v),
                    "median_m2": med(h["m2"] for h in v),
                    "median_ppm2": med(h["ppm2"] for h in v)}
                for b, v in sorted(by_beds.items())
            },
        }
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    default_cache = os.path.join(os.environ.get("MARKET_CACHE") or os.path.expanduser("~/.cache/bromley-market"), "berkeley")
    ap.add_argument("--cache", default=default_cache)
    ap.add_argument("--offline", action="store_true")
    ap.add_argument("--max-km", type=float, default=MAX_KM)
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--no-property-pages", action="store_true")
    a = ap.parse_args()
    http = CachedHTTP(a.cache, offline=a.offline)
    source_urls = [BASE + "/developments"]

    try:
        # 1. development ids per county
        dev_ids = []   # (county, city_title, city_url, id)
        for c in COUNTIES:
            u = f"{BASE}/search_api/developments/list?county={c}&city=&status=Default"
            source_urls.append(f"{BASE}/developments/{c}")
            d = http.get_json(u) or {}
            for it in (d.get("data") or {}).get("items") or []:
                for i in it.get("developmentIds") or []:
                    dev_ids.append((c, it.get("title"), it.get("cityUrl"), i))
        log(f"{len(dev_ids)} development ids in {', '.join(COUNTIES)}")

        # 2. details
        devs = []
        for c, city_title, city_url, i in dev_ids:
            d = http.get_json(f"{BASE}/search_api/developments/details?developmentId={i}&status=Default") or {}
            x = d.get("data") or {}
            if not x.get("name"):
                continue
            area, pc, oc = split_address(x.get("address"))
            devs.append({"id": i, "county": c, "city": (city_title or "").replace("Homes in ", "") or None,
                         "name": x["name"].strip(), "address": re.sub(r"\s+", " ", x.get("address") or "").strip(),
                         "area": area, "postcode": pc, "outcode": oc,
                         "status": (x.get("status") or "").strip() or None,
                         "property_types": x.get("propertyTypes"),
                         "price_range": x.get("priceRange"),
                         "prices_not_released": bool(x.get("pricesNotReleased")),
                         "n_listed": int(num(x.get("viewPropertiesButtonLabel")) or 0),
                         "url": BASE + ((x.get("viewDevelopmentButton") or {}).get("url") or "")})

        # 3. geocode
        geo = geocode(http, {d["postcode"] for d in devs}, {d["outcode"] for d in devs})
        for d in devs:
            g = geo.get(d["postcode"]) or geo.get(("OUT", d["outcode"]))
            d["lat"], d["lon"], d["geocoded_by"] = (round(g[0], 6), round(g[1], 6), g[2]) if g else (None, None, None)
            d["dist_km"] = round(haversine_km(CENTRE, (d["lat"], d["lon"])), 1) if g else None
            d["km_from_charing_cross"] = round(haversine_km(CHARING_CROSS, (d["lat"], d["lon"])), 1) if g else None

        near = [d for d in devs if d["dist_km"] is not None and d["dist_km"] <= a.max_km]
        log(f"{len(near)} of {len(devs)} developments within {a.max_km:g} km")

        # 4. homes on sale
        for d in near:
            d["homes"] = []
            if d["n_listed"] <= 0:
                continue
            u = f"{BASE}/search_api/properties?noOfItemsPerPage=200&dataSourcePageId={d['id']}&status=Default"
            r = http.get_json(u) or {}
            for it in (r.get("data") or {}).get("items") or []:
                f = it.get("fields") or {}
                price = money(f.get("propertyprice"))
                sqft = num(f.get("propertysquarefootage"))
                sqft = int(round(sqft)) if sqft else None
                m2 = round(sqft * SQFT_TO_M2, 1) if sqft else None
                typ = norm_type(f.get("propertytype"))
                beds = f.get("propertynoofbedrooms")
                beds = int(num(beds)) if num(beds) is not None else (0 if "studio" in str(beds).lower() else None)
                fl = f.get("propertyfloor")
                url = (it.get("button") or {}).get("url")
                d["homes"].append({
                    "name": f"Plot {f.get('propertynumber')}".strip(),
                    "beds": beds, "type": typ,
                    "type_raw": f.get("propertytype"),
                    "price": price,
                    "price_text": None if price else (f.get("propertyprice") or None),
                    "sqft": sqft, "m2": m2,
                    "ppm2": round(price / m2) if price and m2 else None,
                    "ppsqft": round(price / sqft) if price and sqft else None,
                    "status": f.get("propertystatus") or None,
                    "phase": (f.get("phaseid") or "").strip() or None,
                    "completion": (f.get("propertyestimatedcompletion") or "").strip() or None,
                    "floor": int(num(fl)) if num(fl) is not None else None,
                    "built_form": None, "baths": None, "storeys": None, "tenure": None,
                    "service_charge_pa": None,
                    "url": BASE + url if url else None,
                })

        # 5. houses: built form + tenure from the property page
        if not a.no_property_pages:
            for d in near:
                for h in d["homes"]:
                    if h["type"] != "house" or not h["url"]:
                        continue
                    body = http.get(h["url"])
                    if body:
                        p = parse_property_page(body)
                        for k in ("built_form", "baths", "storeys", "tenure", "service_charge_pa"):
                            h[k] = p[k]
    except Blocked as e:
        log(f"BLOCKED: {e} - stopping; nothing written. Retry later (cached responses are kept).")
        sys.exit(2)

    # ------------------------------------------------------------ assemble
    out_devs = []
    for d in sorted(near, key=lambda d: d["dist_km"]):
        homes = sorted(d["homes"], key=lambda h: (h["type"] or "", h["beds"] or 0, h["price"] or 0))
        if d["county"] == "london":
            comparable = (d["dist_km"] <= COMPARABLE_LONDON_KM and
                          (d["km_from_charing_cross"] or 0) >= OUTER_KM)
        else:
            comparable = d["dist_km"] <= COMPARABLE_KM
        sized = [h for h in homes if h["ppm2"]]
        n_m2 = sum(1 for h in homes if h["m2"])
        n_house = sum(h["type"] == "house" for h in homes)
        notes = []
        if d["prices_not_released"]:
            notes.append("Developer flags prices as not (fully) released.")
        if d["status"] and d["status"].lower() != "available":
            notes.append(f"Development status: {d['status']}.")
        n_noprice = sum(1 for h in homes if not h["price"])
        if not homes:
            notes.append("No individual homes listed with prices.")
        if len(homes) - n_m2:
            notes.append(f"{len(homes) - n_m2} of {len(homes)} homes listed without a floor area.")
        if n_noprice:
            notes.append(f"{n_noprice} of {len(homes)} homes shown without a price (reserved).")
        if n_house:
            notes.append(f"{n_house} house(s) on sale.")
        if d["geocoded_by"] == "outcode":
            notes.append("Location is the postcode-district centroid (full postcode not published).")
        if comparable:
            notes.append("In the comparable set (outer south-east London / Kent).")
        elif d["county"] == "london" and (d["km_from_charing_cross"] or 0) < OUTER_KM:
            notes.append("Inner London (< %g km from Charing Cross): central pricing, not a like-for-like "
                         "benchmark for Hayes/Bromley." % OUTER_KM)
        else:
            notes.append("Different submarket (north/west London or > %d km away): kept out of the "
                         "comparable summary." % COMPARABLE_LONDON_KM)
        out_devs.append({
            "name": d["name"], "url": d["url"], "area": d["area"] or d["city"],
            "county": d["county"], "postcode": d["postcode"] or d["outcode"],
            "lat": d["lat"], "lon": d["lon"], "dist_km": d["dist_km"],
            "km_from_charing_cross": d["km_from_charing_cross"],
            "comparable": comparable,
            "status": d["status"], "property_types": d["property_types"], "price_range": d["price_range"],
            "n_homes": len(homes), "n_with_size": n_m2, "n_with_ppm2": len(sized),
            "median_ppm2_house": med(h["ppm2"] for h in sized if h["type"] == "house"),
            "median_ppm2_flat": med(h["ppm2"] for h in sized if h["type"] == "flat"),
            "from_price_by_beds": {str(b): min(h["price"] for h in homes if h["beds"] == b and h["price"])
                                   for b in sorted({h["beds"] for h in homes if h["price"] and h["beds"] is not None})},
            "homes": homes,
            "notes": " ".join(notes),
        })
    excluded = [{"name": d["name"], "area": d["area"] or d["city"], "dist_km": d["dist_km"], "url": d["url"]}
                for d in sorted(devs, key=lambda d: d["dist_km"] if d["dist_km"] is not None else 1e9)
                if d not in near]

    all_homes = [h for d in out_devs for h in d["homes"]]
    cmp_homes = [h for d in out_devs if d["comparable"] for h in d["homes"]]
    summary = {
        "all_within_km": a.max_km,
        "all": summarise(all_homes),
        "comparable": summarise(cmp_homes),
        "comparable_rule": (f"Outer London (>= {OUTER_KM:g} km from Charing Cross) within "
                            f"{COMPARABLE_LONDON_KM} km of the site, or Kent/Surrey within {COMPARABLE_KM} km."),
        "comparable_developments": [d["name"] for d in out_devs if d["comparable"]],
        "by_development": [
            {"name": d["name"], "dist_km": d["dist_km"], "comparable": d["comparable"],
             "n_house": sum(1 for h in d["homes"] if h["type"] == "house"),
             "median_ppm2_house": d["median_ppm2_house"],
             "n_flat": sum(1 for h in d["homes"] if h["type"] == "flat"),
             "median_ppm2_flat": d["median_ppm2_flat"]}
            for d in out_devs if d["homes"]],
    }

    res = {
        "generated": dt.date.today().isoformat(),
        "source_urls": sorted(set(source_urls)) + ["https://postcodes.io/"],
        "centre": {"lat": CENTRE[0], "lon": CENTRE[1]},
        "max_km": a.max_km,
        "method": ("Asking prices of every home listed as on sale on berkeleygroup.co.uk (all Berkeley "
                   "Group brands) in developments within %g km of the site; floor area = developer's "
                   "published square footage x 0.092903; ppm2 = asking price / m². Locations from the "
                   "development postcode (postcodes.io)." % a.max_km),
        "caveats": [
            "Asking prices, not achieved prices: Berkeley offers incentives (e.g. 'Own New Rate Reducer', "
            "contributions to costs) that are not deducted here.",
            "Published square footage is the developer's marketing internal area (flats: net internal "
            "area; houses: usually gross internal area including stairs) - close to, but not the same "
            "as, the GIA/NIA in the Ravensbourne Place planning schedule.",
            "Only homes still unsold are listed, so the sample is skewed to what has not sold yet "
            "(often the higher floors / dearer plots, or the remnants of a phase).",
            "Almost all nearby Berkeley stock is apartments in regeneration schemes; houses on sale are "
            "few (Kidbrooke Village townhouses, Foal Hurst Green in Paddock Wood).",
            "Inner-London schemes (Oval, Bermondsey, Wapping, Canary Wharf...) carry central-London "
            "pricing and are kept out of the 'comparable' summary.",
        ],
        "summary": summary,
        "developments": out_devs,
        "excluded_beyond_radius": excluded,
        "web_notes": WEB_NOTES,
    }
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
        f.write("\n")
    log(f"wrote {a.out}: {len(out_devs)} developments, {len(all_homes)} homes "
        f"({sum(1 for h in all_homes if h['ppm2'])} with size); network {http.net}, cache hits {http.hits}")
    for typ in ("house", "flat"):
        s, c = summary["all"][typ], summary["comparable"][typ]
        log(f"  {typ}: all n={s['n']} with m2={s['n_with_size']} with ppm2={s['n_with_ppm2']} "
            f"median £/m²={s['median_ppm2']} | comparable n={c['n']} with ppm2={c['n_with_ppm2']} "
            f"median £/m²={c['median_ppm2']} IQR={c['iqr_ppm2']}")


if __name__ == "__main__":
    main()
