#!/usr/bin/env python3
"""Build data/market/estimates.json: an indicative price for every Ravensbourne Place home.

Method (transparent comparables model, re-runnable, stdlib + requests only):

 1. Comparable pool, in price per m² (ppm2):
    - Land Registry sales (data/market/sold.json) that have an EPC floor area, sold on or
      after 2023-01-01, not new-build. Each price is time-adjusted to the latest UK HPI
      month with Bromley's index for the same property type (data/market/context.json).
    - OnTheMarket asking prices (data/market/listings.json) that state a floor area,
      excluding auctions, shared-ownership shares, retirement/"other", bungalows and
      new homes (new homes are kept apart to measure the new-build premium). Asking ppm2
      is converted to a sold-equivalent ppm2 with ASK_TO_SOLD.
    sold.json has no floor areas yet (the EPC register cannot be fetched automatically),
    so today the pool is the listings only. Once sold.json is rebuilt with --epc-csv, the
    same code uses both sources automatically (sales weighted above listings).
 1b. Listings that are not ordinary market sales are left out (sale_flags from
    fetch_listings.py: cash buyers only, refurbishment project, probate, lease < 80 years);
    a listing whose stated total area contradicts its size field by > 10% is used with the
    stated total at half weight. The same home listed twice (same type and beds, price
    within 3%, < 75 m apart, same street, areas within 10%, leases not different) counts once.
 2. For each home (area = GIA for houses, NIA for flats) the comparables are the same
    Land Registry property type (Detached->D, Semi->S, End/Mid Terrace->T, Apartment->F)
    within 2.5 km whose floor area is at most 1.3x larger or smaller (|ln(Ac/Ah)| <= ln 1.3);
    the band widens to 1.45x, 1.6x, then any size, and the radius to 3 km, until there are
    at least 8. Each comparable's ppm2 is size-adjusted to the home's area with the
    price/size elasticity fitted on the pool (log price = type + beta*log area) and weighted
    by distance, recency and size similarity. value_resale = weighted median ppm2 x area.
    Area used: the plan area, except homes whose plan area is > 20% off the median of their
    house type (likely schedule errors: valued at the typical area) and wheelchair M4(3) homes
    (valued at the standard area for their occupancy); both get an `area_note` and
    `value_at_plan_area`.
 3. New-build estimate: value = value_resale x NEW_BUILD factor, rounded to GBP 1,000.
    The evidence for the factor (local new-home schemes vs the resale model, one ratio per
    scheme; Berkeley asking ppm2 vs resale levels of their boroughs, scaled from Bromley with
    UK HPI average prices; local Land Registry new-build sales when they have floor areas) is
    computed and printed on every run.
 4. Accuracy: leave-one-out backtest. Each comparable (2025-2026 sales when floor areas
    exist, otherwise every listing in the pool) is predicted from the others with the same
    procedure; median and 80th-percentile absolute % error are reported overall and by type.
    low/high = the central 80% of the backtest's log errors for the home's type, widened (in
    quadrature) by the asking->sold uncertainty and, for the new-build value, the premium range.

The only network access is UK HPI (HM Land Registry, OGL v3.0) average prices for the
boroughs of the comparable Berkeley schemes: 5 small requests, cached on disk under
--cache/estimates/, so a re-run makes no request (--offline refuses to fetch).

Usage:
  python3 scripts/market/build_estimates.py            # writes data/market/estimates.json
  python3 scripts/market/build_estimates.py --offline  # cache only
  python3 scripts/market/build_estimates.py --examples 20
"""
import argparse
import datetime as dt
import hashlib
import json
import math
import os
import re
import statistics as st
import sys
import time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DATA = os.path.join(ROOT, "data")
MKT = os.path.join(DATA, "market")
OUT = os.path.join(MKT, "estimates.json")
# cache root shared by all scripts/market/*.py: $MARKET_CACHE, else ~/.cache/bromley-market
DEFAULT_CACHE = os.environ.get("MARKET_CACHE") or os.path.expanduser("~/.cache/bromley-market")
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0.0.0 Safari/537.36")

VALUATION_DATE = "2026-10-18"
SITE = (51.3826, 0.0213)

# ---------------------------------------------------------------- model parameters
MIN_SALE_DATE = "2023-01-01"
MIN_N = 8                       # comparables wanted per home
MAX_COMPS_OUT = 8               # comparables recorded per home
RADII = (2500, 3000)            # m, from the home
SIZE_BANDS = (0.30, 0.45, 0.60, None)   # comparable area at most (1+b)x larger or smaller (log-symmetric); None = any
DIST_SCALE = 1200.0             # m: weight = 1 / (1 + (d/DIST_SCALE)^2)
SIZE_SIGMA = 0.20               # log-area: weight = exp(-(ln(Ac/Ah))^2 / (2 sigma^2))
RECENCY_HALF_LIFE = 2.0         # years (sales only; listings are current)
W_LISTING = 0.8                 # listings weigh less than sales when both exist
W_AREA_CONFLICT = 0.5           # listing whose stated total area contradicts its size field: the stated
                                # total is used, at half weight, and it is not a backtest target
ELASTICITY_CLAMP = (0.55, 0.95)
AREA_FLAG = 0.20               # flag a home whose area is >20% off its house type's median
PPM2_SANITY = (1800, 15000)     # GBP/m2 outside this = data error, dropped
AREA_SANITY = (25, 500)         # m2

# Asking -> achieved price. Zoopla's House Price Index put the average achieved discount
# to asking at 3.9% (Mar 2024, agents achieving 96.1% of asking) and 5.5% at its late-2023
# peak; with Bromley prices falling 3.1% a year (UK HPI, Jul 2026) we use 4.5%. The
# script checks it locally: median asking price of current listings vs median 2025-26
# Land Registry price (HPI-adjusted), by type.
ASK_TO_SOLD = 0.955
ASK_TO_SOLD_SOURCES = [
    "https://www.estateagenttoday.co.uk/breaking-news/2024/03/zoopla-asking-price-discounts-narrow-as-market-mood-improves/",
    "https://www.nationalworld.com/property/zoopla-reflects-on-buyers-market-in-latest-house-price-index-4426171",
]

# New-build premium (chosen after looking at the evidence printed by evidence_premium()):
# two local new-home schemes ask +7% and +12% over the resale model, Berkeley's Kent houses
# about +13%; the London comparisons are rougher and higher. Central 1.10, range 1.05-1.20.
NEW_BUILD = {"factor": 1.10, "low": 1.05, "high": 1.20}
# Uncertainty of the asking -> sold discount (sources range 3.9-5.5%; not checked locally),
# added in quadrature (log scale) to the range of every estimate.
ASK_TO_SOLD_UNCERT = 0.03
RANGE_Q = 0.80                  # published low-high = central 80% of the backtest errors
STALE_ID = 18_500_000           # OnTheMarket listing ids below this were listed roughly a year+ ago
# Listing de-duplication (same home listed by several agents): same type and beds, asking
# prices within 3%, < 75 m apart, same street, floor areas within 10%, leases not different.
DUP = {"price": 0.03, "dist_m": 75, "area": 0.10, "lease_years": 3}

PLOT_TO_PPD = {"Detached": "D", "Semi-Detached": "S", "End Terrace": "T", "Mid Terrace": "T",
               "Apartment": "F"}
LISTING_TO_PPD = {"detached": "D", "semi-detached": "S", "terraced": "T", "end-terrace": "T",
                  "flat": "F"}
PPD_NAME = {"D": "detached", "S": "semi", "T": "terraced", "F": "flat"}
HPI_KEY = PPD_NAME
BERKELEY_FORM_TO_PPD = {"detached": "D", "semi-detached": "S", "end-terrace": "T",
                        "terraced": "T", "mid-terrace": "T", "townhouse": "T"}
# borough of each comparable Berkeley development -> UK HPI region slug
BERKELEY_REGION = {"Kidbrooke Village": "greenwich", "Lombard Square": "greenwich",
                   "Royal Arsenal Riverside": "greenwich", "Sutton Garden Square": "sutton",
                   "TwelveTrees Park": "newham", "Oakhill": "tonbridge-and-malling",
                   "Foal Hurst Green": "tunbridge-wells"}
HPI_MONTH = "https://landregistry.data.gov.uk/data/ukhpi/region/{region}/month/{month}.json"


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# ---------------------------------------------------------------- HTTP (cached)
class Http:
    def __init__(self, cache, offline=False):
        self.cache, self.offline = cache, offline
        os.makedirs(cache, exist_ok=True)
        self.last = 0.0
        self.n = 0

    def path(self, url):
        slug = re.sub(r"[^A-Za-z0-9]+", "_", re.sub(r"^https?://", "", url))[:80].strip("_")
        return os.path.join(self.cache, f"{slug}.{hashlib.sha1(url.encode()).hexdigest()[:10]}")

    def json(self, url):
        p = self.path(url)
        if os.path.exists(p):
            with open(p, encoding="utf-8") as f:
                return json.load(f)
        if self.offline:
            raise SystemExit(f"--offline and not cached: {url}")
        import requests
        wait = self.last + 0.6 - time.time()        # < 2 requests/s (government service)
        if wait > 0:
            time.sleep(wait)
        self.last = time.time()
        r = requests.get(url, headers={"User-Agent": UA, "Accept": "application/json"},
                         timeout=(30, 90))
        self.n += 1
        if r.status_code in (403, 429) or "captcha" in r.text[:3000].lower():
            raise SystemExit(f"blocked (HTTP {r.status_code}) by {url}; not retried")
        if r.status_code != 200:
            return None
        with open(p, "w", encoding="utf-8") as f:
            f.write(r.text)
        log(f"  fetched {url}")
        return r.json()


# ---------------------------------------------------------------- helpers
def hav(lat1, lon1, lat2, lon2):
    r = math.radians
    a = (math.sin(r(lat2 - lat1) / 2) ** 2
         + math.cos(r(lat1)) * math.cos(r(lat2)) * math.sin(r(lon2 - lon1) / 2) ** 2)
    return 2 * 6371000 * math.asin(math.sqrt(a))


def wquantile(pairs, q):
    """Weighted quantile of [(value, weight)] (weights as probability mass, midpoint rule)."""
    pairs = sorted((v, w) for v, w in pairs if w > 0)
    tot = sum(w for _, w in pairs)
    if not pairs:
        return None
    if len(pairs) == 1:
        return pairs[0][0]
    cum, pts = 0.0, []
    for v, w in pairs:
        pts.append(((cum + w / 2) / tot, v))
        cum += w
    if q <= pts[0][0]:
        return pts[0][1]
    if q >= pts[-1][0]:
        return pts[-1][1]
    for (q0, v0), (q1, v1) in zip(pts, pts[1:]):
        if q0 <= q <= q1:
            return v0 + (v1 - v0) * (q - q0) / (q1 - q0) if q1 > q0 else v1
    return pts[-1][1]


def r1000(x):
    return int(round(x / 1000.0)) * 1000


def pctl(xs, q):
    xs = sorted(xs)
    if not xs:
        return None
    k = (len(xs) - 1) * q
    f = math.floor(k)
    c = min(f + 1, len(xs) - 1)
    return xs[f] + (xs[c] - xs[f]) * (k - f)


def ols(X, Y):
    n = len(X[0])
    A = [[sum(x[i] * x[j] for x in X) for j in range(n)] + [sum(x[i] * y for x, y in zip(X, Y))]
         for i in range(n)]
    for i in range(n):
        p = max(range(i, n), key=lambda r: abs(A[r][i]))
        A[i], A[p] = A[p], A[i]
        for r in range(n):
            if r != i and A[i][i]:
                f = A[r][i] / A[i][i]
                A[r] = [a - f * b for a, b in zip(A[r], A[i])]
    return [A[i][n] / A[i][i] for i in range(n)]


def years_between(d0, d1):
    a, b = dt.date.fromisoformat(d0), dt.date.fromisoformat(d1)
    return (b - a).days / 365.25


# ---------------------------------------------------------------- data
def load(name, market_dir=None):
    with open(os.path.join(market_dir or MKT, name), encoding="utf-8") as f:
        return json.load(f)


class Hpi:
    def __init__(self, ctx):
        self.months = {m["month"]: m for m in ctx["ukhpi"]["months"]}
        self.latest = max(self.months)

    def factor(self, date, ppd):
        """Multiply a price from `date` by this to express it at the latest HPI month."""
        m = min(date[:7], self.latest)
        if m not in self.months:
            m = min(self.months)
        k = HPI_KEY[ppd]
        return self.months[self.latest][k] / self.months[m][k]


def listing_ok(x):
    q = (x.get("price_qualifier") or "").lower()
    return not (q.startswith("auction") or "shared" in q) and x.get("price")


TOWNS = {"bromley", "hayes", "keston", "west wickham", "beckenham", "kent", "london", "shortlands",
         "bromley common", "petts wood", "orpington", "park langley", "coney hall", "locksbottom"}
RE_STREETWORD = re.compile(r"\b(?:road|lane|close|avenue|drive|gardens|way|walk|street|row|place|crescent|grove|"
                           r"hill|rise|park|court|square|terrace|mews|green|view|common|approach|parade|vale|"
                           r"wood|end|fields?)\b", re.I)


def street_of(address):
    """Street name from a displayed address ('Flat 2, 14 Mead Way, Bromley BR2' -> 'mead way');
    None when only a town is given. 'Bromley Common' counts as a street (it is one)."""
    parts = [re.sub(r"\b[A-Z]{1,2}\d[A-Z\d]?(?:\s*\d[A-Z]{2})?\b", "", p).strip(" .") for p in (address or "").split(",")]
    for p in parts:
        q = re.sub(r"^(?:flat|apartment|unit|plot)\s*\w+\s*", "", p, flags=re.I)
        q = re.sub(r"^\d+[a-z]?\s+", "", q, flags=re.I).strip().lower()
        if q and RE_STREETWORD.search(q) and (q not in TOWNS or q == "bromley common"):
            return q
    return None


def same_home(a, b):
    """Two listings of the same home (different agents / re-listed)."""
    if a["ppd"] != b["ppd"]:
        return False
    if a.get("beds") is not None and b.get("beds") is not None and a["beds"] != b["beds"]:
        return False
    if abs(a["price"] - b["price"]) > DUP["price"] * max(a["price"], b["price"]):
        return False
    if hav(a["lat"], a["lon"], b["lat"], b["lon"]) > DUP["dist_m"]:
        return False
    sa, sb = a.get("street"), b.get("street")
    if sa and sb and sa != sb:
        return False
    if abs(math.log(a["area"] / b["area"])) > math.log(1 + DUP["area"]):
        return False
    la, lb = a.get("lease_years"), b.get("lease_years")
    if la is not None and lb is not None and abs(la - lb) > DUP["lease_years"]:
        return False
    return True


def build_pool(sold, listings, hpi):
    pool, dropped = [], {"sold_no_area": 0, "sold_new_build": 0, "sold_old": 0, "sold_retirement": 0,
                         "sold_duplicate": 0, "insane": 0,
                         "listing_no_area": 0, "listing_excluded": 0, "listing_dupe": 0,
                         "listing_new_home": 0, "listing_non_market": 0, "listing_area_conflict_half_weight": 0}
    dupes, excluded = [], []
    for t in sold["transactions"]:
        if not t.get("floor_area") or not t.get("ppm2"):
            dropped["sold_no_area"] += 1
            continue
        if t.get("new_build"):
            dropped["sold_new_build"] += 1
            continue
        if t["date"] < MIN_SALE_DATE:
            dropped["sold_old"] += 1
            continue
        if t.get("retirement"):
            dropped["sold_retirement"] += 1
            continue
        if t.get("duplicate_of"):
            dropped["sold_duplicate"] += 1
            continue
        a = float(t["floor_area"])
        f = hpi.factor(t["date"], t["ppd_type"])
        ppm2 = t["price"] * f / a
        if not (AREA_SANITY[0] <= a <= AREA_SANITY[1] and PPM2_SANITY[0] <= ppm2 <= PPM2_SANITY[1]):
            dropped["insane"] += 1
            continue
        pool.append({"src": "sold", "id": t["id"], "ppd": t["ppd_type"], "area": a,
                     "ppm2": ppm2, "ppm2_raw": t["price"] / a, "price": t["price"],
                     "price_adj": t["price"] * f, "date": t["date"], "lat": t["lat"],
                     "lon": t["lon"], "w_src": 1.0, "address": t["address"], "beds": None,
                     "url": t.get("epc_url")})
    seen = []
    for x in listings["listings"]:
        if not x.get("m2"):
            dropped["listing_no_area"] += 1
            continue
        if x["type"] not in LISTING_TO_PPD or not listing_ok(x):
            dropped["listing_excluded"] += 1
            continue
        if x.get("new_home"):
            dropped["listing_new_home"] += 1
            continue
        if x.get("sale_flags"):     # cash buyers only, refurbishment project, probate, lease < 80 years
            dropped["listing_non_market"] += 1
            excluded.append({"id": str(x["id"]), "why": x["sale_flags"]})
            continue
        conflict = x.get("area_source") == "conflict" and x.get("m2_text")
        if conflict:                # listing's size field and stated total disagree by > 10%
            dropped["listing_area_conflict_half_weight"] += 1
            excluded.append({"id": str(x["id"]), "why": ["area_conflict: stated total used at half weight"],
                             "m2": x["m2"], "m2_text": x["m2_text"]})
        a = float(x["m2_text"] if conflict else x["m2"])
        ppm2 = x["price"] / a
        if not (AREA_SANITY[0] <= a <= AREA_SANITY[1] and PPM2_SANITY[0] <= ppm2 <= PPM2_SANITY[1]):
            dropped["insane"] += 1
            continue
        ppd = LISTING_TO_PPD[x["type"]]
        item = {"src": "listing", "id": str(x["id"]), "ppd": ppd, "area": a,
                "ppm2": ppm2 * ASK_TO_SOLD, "ppm2_raw": ppm2, "price": x["price"],
                "price_adj": x["price"] * ASK_TO_SOLD, "date": listings.get("generated", VALUATION_DATE),
                "lat": x["lat"], "lon": x["lon"], "w_src": W_LISTING, "address": x["address"],
                "beds": x.get("beds"), "url": x.get("url"), "type": x["type"],
                "street": street_of(x["address"]), "lease_years": x.get("lease_years"),
                "w_q": W_AREA_CONFLICT if conflict else 1.0, "area_conflict": bool(conflict)}
        dup = next((q for q in seen if same_home(q, item)), None)
        if dup:                     # same home listed by two agents (or re-listed): keep the better one
            dropped["listing_dupe"] += 1
            if dup["area_conflict"] and not item["area_conflict"]:
                pool[pool.index(dup)] = item
                seen[seen.index(dup)] = item
                dupes.append([item["id"], dup["id"]])
            else:
                dupes.append([dup["id"], item["id"]])
            continue
        pool.append(item)
        seen.append(item)
    if pool and all(p["src"] == "listing" for p in pool):
        for p in pool:
            p["w_src"] = 1.0
    return pool, dropped, dupes, excluded


def fit_elasticity(pool):
    """log(price) = a_type + beta*log(area): beta < 1 means ppm2 falls as homes get bigger."""
    types = sorted({p["ppd"] for p in pool})
    X = [[1.0 if p["ppd"] == t else 0.0 for t in types] + [math.log(p["area"])] for p in pool]
    Y = [math.log(p["ppm2"] * p["area"]) for p in pool]
    b = ols(X, Y)
    beta = b[-1]
    resid = [y - sum(xi * bi for xi, bi in zip(x, b)) for x, y in zip(X, Y)]
    return {"beta": beta, "type_effects": {PPD_NAME[t]: round(math.exp(b[i] - b[types.index("T")]), 3)
                                           for i, t in enumerate(types)} if "T" in types else {},
            "n": len(pool), "resid_sd": st.pstdev(resid)}


# ---------------------------------------------------------------- the estimator
class Model:
    def __init__(self, pool, beta):
        self.pool = pool
        self.beta = min(max(beta, ELASTICITY_CLAMP[0]), ELASTICITY_CLAMP[1])

    def comps(self, ppd, area, lat, lon, exclude=(), on_date=VALUATION_DATE, use_raw=False):
        cands = []
        for p in self.pool:
            if p["ppd"] != ppd or p["id"] in exclude:
                continue
            d = hav(lat, lon, p["lat"], p["lon"])
            cands.append((p, d))
        chosen, radius, band = [], RADII[-1], SIZE_BANDS[-1]
        done = False
        for radius in RADII:
            for band in SIZE_BANDS:
                sel = [(p, d) for p, d in cands if d <= radius
                       and (band is None or abs(math.log(p["area"] / area)) <= math.log(1 + band))]
                if len(sel) >= MIN_N:
                    chosen, done = sel, True
                    break
                chosen = sel
            if done:
                break
        out = []
        for p, d in chosen:
            k = (area / p["area"]) ** (self.beta - 1.0)       # size adjustment of ppm2
            base = p["ppm2_raw"] if use_raw else p["ppm2"]
            w_d = 1.0 / (1.0 + (d / DIST_SCALE) ** 2)
            w_s = math.exp(-(math.log(p["area"] / area)) ** 2 / (2 * SIZE_SIGMA ** 2))
            age = max(0.0, years_between(p["date"], on_date)) if p["src"] == "sold" else 0.0
            w_r = 0.5 ** (age / RECENCY_HALF_LIFE)
            w = w_d * w_s * w_r * p["w_src"] * p.get("w_q", 1.0)
            out.append({"p": p, "d": d, "ppm2": base * k, "w": w})
        out.sort(key=lambda c: -c["w"])
        return out, radius, band

    def estimate(self, ppd, area, lat, lon, exclude=(), use_raw=False):
        cs, radius, band = self.comps(ppd, area, lat, lon, exclude, use_raw=use_raw)
        if not cs:
            return None
        pairs = [(c["ppm2"], c["w"]) for c in cs]
        med, lo, hi = (wquantile(pairs, q) for q in (0.5, 0.25, 0.75))
        return {"ppm2": med, "ppm2_lo": lo, "ppm2_hi": hi, "n": len(cs), "radius_m": radius,
                "band": band, "comps": cs}


def half_widths(acc):
    """Log half-width of the 80% range by type: the 80th percentile of |ln(pred/actual)| in the
    backtest (the overall value for a type with fewer than 15 tests)."""
    allh = acc["p80_abs_log_error"]
    return {k: (v["p80_abs_log_error"] if v["n"] >= 15 else allh) for k, v in acc["by_type"].items()}, allh


def ranges(v_res, h_res, prem):
    """(low_resale, high_resale, low, high) for a central resale value. The resale range is the
    backtest's 80% error band widened by the asking->sold uncertainty; the new-build range also
    carries the premium range. Independent errors add in quadrature on the log scale."""
    hr = math.hypot(h_res, math.log(1 + ASK_TO_SOLD_UNCERT))
    hl = math.hypot(hr, math.log(prem["factor"] / prem["low"]))
    hh = math.hypot(hr, math.log(prem["high"] / prem["factor"]))
    v_new = v_res * prem["factor"]
    return v_res * math.exp(-hr), v_res * math.exp(hr), v_new * math.exp(-hl), v_new * math.exp(hh)


# ---------------------------------------------------------------- backtest
def backtest(model, pool):
    sold_test = [p for p in pool if p["src"] == "sold" and p["date"] >= "2025-01-01"]
    test = sold_test or [p for p in pool if p["src"] == "listing" and not p.get("area_conflict")]
    basis = "sold_2025_2026" if sold_test else "listings_asking"
    errs, by, preds = [], {}, []
    for p in test:
        e = model.estimate(p["ppd"], p["area"], p["lat"], p["lon"], exclude={p["id"]},
                           use_raw=(basis == "listings_asking"))
        if not e:
            continue
        actual = p["ppm2_raw"] if basis == "listings_asking" else p["ppm2"]
        err = e["ppm2"] / actual - 1.0
        errs.append(err)
        preds.append((PPD_NAME[p["ppd"]], e, actual))
        by.setdefault(PPD_NAME[p["ppd"]], []).append(err)
    ab = [abs(x) for x in errs]
    lg = lambda v: [abs(math.log(1 + x)) for x in v]
    res = {"basis": basis, "backtest_n": len(errs),
           "median_abs_pct_error": round(100 * st.median(ab), 1),
           "p80_abs_pct_error": round(100 * pctl(ab, 0.8), 1),
           "median_signed_pct_error": round(100 * st.median(errs), 1),
           "p80_abs_log_error": round(pctl(lg(errs), RANGE_Q), 4),
           "by_type": {k: {"n": len(v), "median_abs_pct_error": round(100 * st.median([abs(x) for x in v]), 1),
                           "p80_abs_pct_error": round(100 * pctl([abs(x) for x in v], 0.8), 1),
                           "median_signed_pct_error": round(100 * st.median(v), 1),
                           "p80_abs_log_error": round(pctl(lg(v), RANGE_Q), 4)}
                       for k, v in sorted(by.items())}}
    # how many held-out prices fall inside the published resale range (asking basis: without the
    # asking->sold widening) and inside the comparables' interquartile range
    hw, _ = half_widths(res)
    inside = sum(math.exp(-hw[t]) <= a / e["ppm2"] <= math.exp(hw[t]) for t, e, a in preds)
    inside_iqr = sum(e["ppm2_lo"] <= a <= e["ppm2_hi"] for _, e, a in preds)
    res["range_quantile"] = RANGE_Q
    res["share_within_low_high"] = round(inside / len(errs), 2)
    res["share_within_comps_iqr"] = round(inside_iqr / len(errs), 2)
    return res, errs


# ---------------------------------------------------------------- new-build evidence
def ukhpi_region(http, region, month):
    d = http.json(HPI_MONTH.format(region=region, month=month))
    if not d:
        return None
    p = d["result"]["primaryTopic"]
    return {"all": p.get("averagePrice"), "detached": p.get("averagePriceDetached"),
            "semi": p.get("averagePriceSemiDetached"), "terraced": p.get("averagePriceTerraced"),
            "flat": p.get("averagePriceFlatMaisonette"), "url": HPI_MONTH.format(region=region, month=month)}


def evidence_premium(model, sold, listings, berkeley, hpi, http):
    ev = {}
    # (a) Land Registry new-build sales with a floor area, vs the resale model (sold basis)
    rows = []
    for t in sold["transactions"]:
        if t.get("new_build") and t.get("floor_area") and t["date"] >= MIN_SALE_DATE:
            e = model.estimate(t["ppd_type"], float(t["floor_area"]), t["lat"], t["lon"])
            if e:
                adj = t["price"] * hpi.factor(t["date"], t["ppd_type"]) / float(t["floor_area"])
                rows.append({"id": t["id"], "address": t["address"], "ratio": round(adj / e["ppm2"], 3)})
    nb_sales = [t for t in sold["transactions"] if t.get("new_build")]
    ev["land_registry"] = {
        "n_new_build_sales": len(nb_sales), "n_with_floor_area": len(rows),
        "new_build_sales": [{"id": t["id"], "date": t["date"], "price": t["price"], "ppd_type": t["ppd_type"],
                             "address": t["address"]} for t in nb_sales],
        "median_ratio": round(st.median([r["ratio"] for r in rows]), 3) if rows else None,
        "rows": rows,
        "note": ("%d new-build sales within 2.5 km since 2023 (%s), none with a floor area, so no "
                 "like-for-like ratio can be computed." % (len(nb_sales), "; ".join(
                     "%s %s £%s" % (t["date"][:7], t["address"].split(",")[1].strip() if "," in t["address"] else t["address"],
                                    format(t["price"], ",")) for t in nb_sales[:6])))
        if not rows else "Ratio of HPI-adjusted new-build £/m² to the resale model at the same place and size."}
    # (c) OnTheMarket new homes vs the resale model, asking vs asking. Plots of one scheme are not
    # independent evidence: listings of the same type within 150 m with floor areas within 5% are
    # grouped into a scheme and each scheme counts once (its median ratio).
    rows = []
    for x in listings["listings"]:
        if not (x.get("new_home") and x.get("m2") and x["type"] in LISTING_TO_PPD and listing_ok(x)):
            continue
        e = model.estimate(LISTING_TO_PPD[x["type"]], x["m2"], x["lat"], x["lon"], use_raw=True)
        if e:
            rows.append({"id": str(x["id"]), "address": x["address"], "type": x["type"], "beds": x["beds"],
                         "m2": x["m2"], "price": x["price"], "ppm2": round(x["price"] / x["m2"]),
                         "resale_ask_ppm2": round(e["ppm2"]), "n": e["n"], "lat": x["lat"], "lon": x["lon"],
                         "ratio": round(x["price"] / x["m2"] / e["ppm2"], 3)})
    schemes = []
    for r in rows:
        sc = next((g for g in schemes if g["type"] == r["type"]
                   and hav(g["lat"], g["lon"], r["lat"], r["lon"]) < 150
                   and abs(math.log(g["m2"] / r["m2"])) < math.log(1.05)), None)
        if sc:
            sc["ids"].append(r["id"])
            sc["ratios"].append(r["ratio"])
        else:
            schemes.append({"type": r["type"], "lat": r["lat"], "lon": r["lon"], "m2": r["m2"],
                            "address": r["address"], "ids": [r["id"]], "ratios": [r["ratio"]]})
    for i, g in enumerate(schemes):
        g["ratio"] = round(st.median(g["ratios"]), 3)
        for r in rows:
            if r["id"] in g["ids"]:
                r["scheme"] = i
    for r in rows:
        r.pop("lat"), r.pop("lon")
    sch_r = [g["ratio"] for g in schemes]
    ev["onthemarket_new_homes"] = {
        "n": len(rows), "n_schemes": len(schemes), "rows": rows,
        "schemes": [{"address": g["address"], "type": g["type"], "listings": g["ids"], "ratio": g["ratio"]} for g in schemes],
        "median_ratio": round(st.median(sch_r), 3) if sch_r else None,
        "note": "One ratio per scheme (plots of one development are not independent). A listing whose "
                "text says it was built years ago is a resale and is not counted."}
    # (b) Berkeley comparable schemes: asking ppm2 vs the resale asking ppm2 expected in
    # their borough = Bromley resale model (same type and size, at the site) x UK HPI ratio
    month = hpi.latest
    brom = hpi.months[month]
    regions = {}
    for reg in sorted(set(BERKELEY_REGION.values())):
        regions[reg] = ukhpi_region(http, reg, month)
    rows = []
    for d in berkeley["developments"]:
        reg = BERKELEY_REGION.get(d["name"])
        if not d.get("comparable") or not reg or not regions.get(reg):
            continue
        for h in d["homes"]:
            if not (h.get("ppm2") and h.get("m2")):
                continue
            if h["type"] == "flat":
                ppd = "F"
            else:
                ppd = BERKELEY_FORM_TO_PPD.get((h.get("built_form") or "").lower())
                if not ppd:
                    continue
            k = HPI_KEY[ppd]
            if not regions[reg].get(k):
                continue
            ratio_reg = regions[reg][k] / brom[k]
            e = model.estimate(ppd, h["m2"], SITE[0], SITE[1], use_raw=True)
            if not e:
                continue
            implied = e["ppm2"] * ratio_reg
            rows.append({"development": d["name"], "region": reg, "ppd": ppd, "beds": h["beds"],
                         "m2": h["m2"], "price": h["price"], "ppm2": h["ppm2"],
                         "hpi_ratio": round(ratio_reg, 3), "implied_resale_ask_ppm2": round(implied),
                         "ratio": round(h["ppm2"] / implied, 3)})
    bydev = {}
    for r in rows:
        bydev.setdefault(r["development"], []).append(r["ratio"])
    ev["berkeley"] = {
        "hpi_month": month, "regions": regions, "n": len(rows),
        "median_ratio": round(st.median([r["ratio"] for r in rows]), 3) if rows else None,
        "median_ratio_houses": round(st.median([r["ratio"] for r in rows if r["ppd"] != "F"]), 3)
        if any(r["ppd"] != "F" for r in rows) else None,
        "median_ratio_flats": round(st.median([r["ratio"] for r in rows if r["ppd"] == "F"]), 3)
        if any(r["ppd"] == "F" for r in rows) else None,
        "by_development": {k: {"n": len(v), "median_ratio": round(st.median(v), 3)} for k, v in bydev.items()},
        "rows": rows}
    return ev


def ask_vs_sold_check(sold, listings, hpi):
    out = {}
    for ppd in "DSTF":
        ls = [x["price"] for x in listings["listings"]
              if LISTING_TO_PPD.get(x["type"]) == ppd and listing_ok(x) and not x.get("new_home")]
        ss = [t["price"] * hpi.factor(t["date"], ppd) for t in sold["transactions"]
              if t["ppd_type"] == ppd and t["date"] >= "2025-01-01" and not t.get("new_build")
              and not t.get("retirement")]
        if ls and ss:
            out[PPD_NAME[ppd]] = {"n_listings": len(ls), "median_asking": int(st.median(ls)),
                                  "n_sales": len(ss), "median_sold_adj": int(st.median(ss)),
                                  "ratio": round(st.median(ls) / st.median(ss), 3)}
    return out


# ---------------------------------------------------------------- text
def texts(acc, prem, ev, has_sold=False):
    """Plain-language method (<=130 words each) and the premium basis, filled from the evidence."""
    mae = acc["median_abs_pct_error"]
    f, lo, hi = prem["factor"], prem["low"], prem["high"]
    disc = f"{round((1 - ASK_TO_SOLD) * 100, 1):g}%"
    br = lambda x: str(x).replace(".", ",")          # Portuguese decimal comma
    band = SIZE_BANDS[0]

    def pct(x):
        return "n/a" if x is None else f"{'+' if x >= 1 else ''}{round((x - 1) * 100):d}%"

    test_pt = ("vendas fechadas" if has_sold else "anúncios (preços pedidos)")
    test_en = ("achieved sales" if has_sold else "listings (asking prices)")
    method_pt = (
        "Estimativa indicativa, não é uma avaliação oficial. Para cada casa usamos imóveis parecidos "
        + ("vendidos e à venda " if has_sold else "à venda ") + "num raio de 2,5 km: mesmo tipo (isolada, geminada, em fileira ou apartamento) e área parecida "
        f"(até {br(f'{1 + band:g}')} vez maior ou menor; se não houver {MIN_N}, ampliamos a faixa). Pegamos o preço por m² de cada um, ajustamos pela diferença de tamanho, damos mais peso aos "
        f"mais próximos e tiramos {br(disc)} do preço pedido para chegar ao preço de venda. Valor de revenda = "
        "mediana do £/m² × área da planta (GIA nas casas, NIA nos apartamentos). Por ser imóvel novo da "
        f"Berkeley, somamos {round((f - 1) * 100)}% (faixa {round((lo - 1) * 100)}–{round((hi - 1) * 100)}%). "
        f"No teste com {test_pt}, o erro típico foi de ~{br(f'{mae:g}')}%; a faixa provável cobre 8 em cada 10 casos. "
        "No preço de imóvel novo a incerteza é maior: o desconto sobre o preço pedido e o prêmio de novo não puderam ser testados."
    )
    method_en = (
        "Indicative estimate, not a formal valuation. For each home we use similar homes "
        + ("sold and for sale " if has_sold else "for sale ") + f"within 2.5 km: same type (detached, semi, terraced or flat) and a similar floor area (up to {1 + band:g}× larger or smaller, widened when there are fewer than {MIN_N}). We take each one's "
        "price per m², adjust it for the difference in size, give nearer homes more weight and take "
        f"{disc} off asking prices to reach likely sale prices. Resale value = median £/m² × the plan floor "
        "area (GIA for houses, NIA for flats). Because it is a new Berkeley home we add "
        f"{round((f - 1) * 100)}% (range {round((lo - 1) * 100)}–{round((hi - 1) * 100)}%). Tested on {test_en}, "
        f"the typical error was ~{mae:g}%; the likely range covers 8 in 10 cases. The new-home price is less certain: "
        "the asking-to-sale discount and the new-build premium could not be tested."
    )
    lr, otm, bk = ev["land_registry"], ev["onthemarket_new_homes"], ev["berkeley"]
    sch = otm.get("schemes", [])
    first = lambda a: (a or "").split(",")[0].strip()
    sch_en = "; ".join(f"{first(g['address'])}, {len(g['listings'])} listing{'s' if len(g['listings']) > 1 else ''}: {pct(g['ratio'])}" for g in sch)
    sch_pt = "; ".join(f"{first(g['address'])}, {len(g['listings'])} anúncio{'s' if len(g['listings']) > 1 else ''}: {pct(g['ratio'])}" for g in sch)
    fhg = bk["by_development"].get("Foal Hurst Green", {})
    fhg_r = [r["ratio"] for r in bk["rows"] if r["development"] == "Foal Hurst Green"]
    ldn = [r["ratio"] for r in bk["rows"] if r["region"] in ("greenwich", "sutton")]
    rng = lambda xs: f"{pct(min(xs))} to {pct(max(xs))}" if xs else "n/a"
    rng_pt = lambda xs: f"{pct(min(xs))} a {pct(max(xs))}" if xs else "n/d"
    ldn_med = st.median(ldn) if ldn else None
    oak = [r for r in lr.get("new_build_sales", []) if "oak house" in r["address"].lower()]
    oak_en = (f" Land Registry also shows {len(oak)} new flats at Oak House, 145 Hayes Lane, sold for "
              f"£{min(r['price'] for r in oak) // 1000}–{max(r['price'] for r in oak) // 1000}k in "
              f"{min(r['date'] for r in oak)[:4]}–{max(r['date'] for r in oak)[:4]}, while flats there now ask £425k: for flats "
              "the premium may be close to nothing (floor areas unknown).") if oak else ""
    oak_pt = (f" O Land Registry mostra ainda {len(oak)} apartamentos novos no Oak House (145 Hayes Lane) vendidos por "
              f"£{min(r['price'] for r in oak) // 1000}–{max(r['price'] for r in oak) // 1000} mil em "
              f"{min(r['date'] for r in oak)[:4]}–{max(r['date'] for r in oak)[:4]}, e apartamentos de lá pedem hoje £425 mil: nos "
              "apartamentos o prêmio pode ser quase zero (áreas desconhecidas).") if oak else ""
    if lr["n_with_floor_area"]:
        lr_en = (f"(3) The {lr['n_with_floor_area']} local Land Registry new-build sales with a floor area sold "
                 f"at a median {pct(lr['median_ratio'])} over the resale model (achieved prices).")
        lr_pt = (f"(3) As {lr['n_with_floor_area']} vendas de imóveis novos do Land Registry com área foram fechadas "
                 f"em mediana {pct(lr['median_ratio'])} acima do modelo de revenda (preços pagos).")
    else:
        lr_en = (f"(3) Land Registry has {lr['n_new_build_sales']} new-build sales nearby since 2023, none with a "
                 f"floor area, so no premium on achieved prices could be measured.{oak_en}")
        lr_pt = (f"(3) O Land Registry tem {lr['n_new_build_sales']} vendas de imóveis novos na região desde 2023, "
                 f"nenhuma com área, então não deu para medir o prêmio em preços efetivamente pagos.{oak_pt}")
    basis_en = (
        f"Factor {f:g} (range {lo:g}–{hi:g}), from three checks, each comparing price per m² for the same "
        f"type and size. (1) Local new-home schemes for sale on OnTheMarket: {len(sch)} ({sch_en}), against "
        f"what our resale model predicts for the same spot (asking vs asking; one ratio per scheme, as plots of one "
        f"scheme are not independent; 'prices from' quotes may understate). (2) Berkeley's houses at Foal Hurst Green, Paddock Wood ask "
        f"{rng(fhg_r)} (median {pct(fhg.get('median_ratio'))}) over resale homes in Tunbridge Wells borough, "
        f"estimated as the Bromley resale level scaled by UK HPI average prices. The same rough comparison "
        f"gives a median {pct(ldn_med)} ({rng(ldn)}) for Kidbrooke, Plumstead, Woolwich and Sutton, mostly flats; "
        f"it overstates the gap where the borough's homes are smaller, and Berkeley asking prices ignore incentives. {lr_en} "
        f"We use {pct(f)}: a little above the local schemes (smaller builders) and below Berkeley's Kent houses; {pct(lo)} to "
        f"{pct(hi)} spans the local and Kent evidence. It is an assumption: edit the price in the calculator to try another."
    )
    basis_pt = (
        f"Fator {br(f'{f:g}')} (faixa {br(f'{lo:g}')}–{br(f'{hi:g}')}), a partir de três comparações de preço por m² para o mesmo tipo "
        f"e tamanho. (1) Empreendimentos novos à venda perto do terreno no OnTheMarket: {len(sch)} ({sch_pt}), comparados ao que "
        f"o nosso modelo de revenda prevê para o mesmo local (preço pedido contra preço pedido; um número por empreendimento, "
        f"porque lotes do mesmo projeto não são independentes; preços \"a partir de\" podem subestimar). (2) As casas da Berkeley em Foal Hurst Green, "
        f"Paddock Wood, pedem {rng_pt(fhg_r)} (mediana {pct(fhg.get('median_ratio'))}) acima de imóveis usados "
        f"em Tunbridge Wells, estimados pelo nível de revenda de Bromley ajustado pelos preços médios do UK HPI. "
        f"A mesma comparação, mais grosseira, dá mediana de {pct(ldn_med)} ({rng_pt(ldn)}) em Kidbrooke, Plumstead, "
        f"Woolwich e Sutton, quase tudo apartamentos; ela exagera a diferença onde os imóveis do bairro são menores, "
        f"e os preços da Berkeley não descontam incentivos. {lr_pt} Usamos {pct(f)}: um pouco acima dos empreendimentos locais (de "
        f"construtoras menores) e abaixo das casas da Berkeley em Kent; a faixa de {pct(lo)} a {pct(hi)} cobre a evidência local e de "
        f"Kent. É uma premissa: mude o preço na calculadora para testar outra."
    )
    return method_pt, method_en, basis_pt, basis_en


# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--cache", default=DEFAULT_CACHE, help="cache root (estimates/ is used inside)")
    ap.add_argument("--offline", action="store_true", help="never fetch; fail if a URL is not cached")
    ap.add_argument("--examples", type=int, default=14, help="example homes to print")
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--market-dir", default=MKT, help="where sold/listings/berkeley/context.json are read")
    args = ap.parse_args()

    sold, listings, berkeley, ctx = (load(n, args.market_dir) for n in (
        "sold.json", "listings.json", "berkeley.json", "context.json"))
    with open(os.path.join(DATA, "homes.json"), encoding="utf-8") as f:
        homes = json.load(f)["homes"]
    hpi = Hpi(ctx)
    http = Http(os.path.join(args.cache, "estimates"), offline=args.offline)

    pool, dropped, dupes, excluded = build_pool(sold, listings, hpi)
    src_n = {s: sum(p["src"] == s for p in pool) for s in ("sold", "listing")}
    log(f"pool: {len(pool)} comparables {src_n}; dropped {dropped}")
    log(f"  duplicates (kept, dropped): {dupes}")
    log(f"  excluded: {excluded}")
    fit = fit_elasticity(pool)
    model = Model(pool, fit["beta"])
    log(f"size elasticity beta={fit['beta']:.3f} (used {model.beta:.3f}); type effects vs terraced "
        f"{fit['type_effects']}; resid sd {fit['resid_sd']:.3f}")

    acc, errs = backtest(model, pool)
    # same backtest without the size adjustment, for the record
    m1 = Model(pool, 1.0)
    m1.beta = 1.0
    acc_nosize, _ = backtest(m1, pool)
    log(f"backtest ({acc['basis']}): n={acc['backtest_n']} median |err| {acc['median_abs_pct_error']}% "
        f"p80 {acc['p80_abs_pct_error']}% bias {acc['median_signed_pct_error']}% within low-high "
        f"{acc['share_within_low_high']}; by type {acc['by_type']}")
    log(f"  (without size adjustment: median |err| {acc_nosize['median_abs_pct_error']}% "
        f"p80 {acc_nosize['p80_abs_pct_error']}%)")

    # listings on the market a long time (OnTheMarket ids are sequential; below STALE_ID ~ listed more
    # than a year ago and still unsold): do they ask more than the model predicts? (recorded, not used)
    stale = []
    for p in pool:
        if p["src"] == "listing" and not p.get("area_conflict") and p["id"].isdigit() and int(p["id"]) < STALE_ID:
            e = model.estimate(p["ppd"], p["area"], p["lat"], p["lon"], exclude={p["id"]}, use_raw=True)
            if e:
                stale.append(p["ppm2_raw"] / e["ppm2"] - 1)
    stale_med = round(100 * st.median(stale), 1) if stale else None
    log(f"long-listed (id < {STALE_ID}): n={len(stale)} median ask vs model {stale_med}%")

    avs = ask_vs_sold_check(sold, listings, hpi)
    log("asking vs 2025-26 sold (HPI-adjusted) medians: " +
        "; ".join(f"{k} {v['ratio']}" for k, v in avs.items()))

    ev = evidence_premium(model, sold, listings, berkeley, hpi, http)
    log(f"premium evidence: OTM new homes median {ev['onthemarket_new_homes']['median_ratio']} "
        f"(n={ev['onthemarket_new_homes']['n']}, schemes {ev['onthemarket_new_homes']['n_schemes']}: "
        f"{ev['onthemarket_new_homes']['schemes']}); Berkeley median {ev['berkeley']['median_ratio']} "
        f"(houses {ev['berkeley']['median_ratio_houses']}, flats {ev['berkeley']['median_ratio_flats']}, "
        f"n={ev['berkeley']['n']}) {ev['berkeley']['by_development']}; LR new-build with area "
        f"{ev['land_registry']['n_with_floor_area']}")
    for r in ev["onthemarket_new_homes"]["rows"]:
        log(f"   OTM new: {r}")

    prem = NEW_BUILD
    hw, hw_all = half_widths(acc)
    ht_areas, occ_std = {}, {}
    for h in homes:
        a = h.get("gia") if h["kind"] == "house" else h.get("nia")
        if a and h.get("housetype"):      # wheelchair (M4(3)) units are legitimately larger
            ht_areas.setdefault((h["housetype"], h.get("accessibility")), []).append(a)
        if a and h.get("accessibility") != "M4(3)":
            occ_std.setdefault((h["kind"], h.get("occupancy")), []).append(a)
    num = lambda x: int(x) if float(x).is_integer() else round(x, 1)
    out_homes, used, flagged, m43 = {}, {}, [], []
    for h in homes:
        ppd = PLOT_TO_PPD[h["plot_type"]]
        area = h.get("gia") if h["kind"] == "house" else h.get("nia")
        kind = "GIA" if h["kind"] == "house" else "NIA"
        if not area:
            area, kind = (h.get("nia") or h.get("gia")), ("NIA" if h.get("nia") else "GIA")
        # area the value is based on: the plan area, except (a) a schedule area far off its house
        # type's usual one (likely a schedule error) -> the house type's typical area; (b) wheelchair
        # M4(3) homes -> the standard area for the same occupancy (the market does not pay for the
        # extra circulation space as living space)
        a_used, basis, note = float(area), "plan", None
        hk = (h.get("housetype"), h.get("accessibility"))
        typ = st.median(ht_areas.get(hk, [area]))
        if len(ht_areas.get(hk, [])) >= 3 and abs(area / typ - 1) > AREA_FLAG:
            others = sorted(set(ht_areas[hk]))
            typ = num(typ)
            a_used, basis = float(typ), "typical_for_house_type"
            note = {"housetype": h["housetype"], "typical_area": typ, "areas_in_schedule": others,
                    "en": f"The plot schedule gives {area:g} m², unusual for house type {h['housetype']} (usually {typ:g} m²); "
                          f"it is probably a schedule error, so the estimate uses {typ:g} m². At {area:g} m² it would be "
                          "£{alt}.",
                    "pt": f"A planilha de lotes dá {area:g} m², incomum para o tipo {h['housetype']} (normalmente {typ:g} m²); "
                          f"provavelmente é erro da planilha, então a estimativa usa {typ:g} m². Com {area:g} m² seria "
                          "£{alt}."}
        elif h.get("accessibility") == "M4(3)" and occ_std.get((h["kind"], h.get("occupancy"))):
            std_a = num(st.median(occ_std[(h["kind"], h["occupancy"])]))
            if std_a < area:
                a_used, basis = float(std_a), "standard_for_occupancy"
                note = {"typical_area": std_a,
                        "en": f"Wheelchair-user home (M4(3)): {area:g} m² includes extra circulation space. It is valued at "
                              f"the area of a standard {h['occupancy']} {'flat' if h['kind'] == 'apartment' else 'home'} ({std_a:g} m²), "
                              "as buyers do not pay for that space as living space; at the full area it would be £{alt}.",
                        "pt": f"Imóvel para cadeirante (M4(3)): os {area:g} m² incluem espaço extra de circulação. O valor usa a "
                              f"área de um {'apartamento' if h['kind'] == 'apartment' else 'imóvel'} {h['occupancy']} padrão ({std_a:g} m²), "
                              "porque o mercado não paga esse espaço como área útil; com a área toda seria £{alt}."}
        e = model.estimate(ppd, a_used, h["lat"], h["lon"])
        tk = PPD_NAME[ppd]
        v_res = e["ppm2"] * a_used
        lo_res, hi_res, lo_new, hi_new = ranges(v_res, hw.get(tk, hw_all), prem)
        tot_w = sum(c["w"] for c in e["comps"]) or 1.0
        best = e["comps"][:MAX_COMPS_OUT]
        for c in best:
            used[c["p"]["id"]] = c["p"]
        o = out_homes[h["id"]] = {
            "area": area, "area_kind": kind, "ppd_type": ppd, "ppm2": int(round(e["ppm2"])),
            "value_resale": r1000(v_res), "low_resale": r1000(lo_res), "high_resale": r1000(hi_res),
            "value": r1000(v_res * prem["factor"]), "low": r1000(lo_new), "high": r1000(hi_new),
            "n": e["n"], "radius_m": e["radius_m"],
            "size_band_pct": int(round(e["band"] * 100)) if e["band"] else None,
            "comps": [c["p"]["id"] for c in best],
            "comps_w": [round(c["w"] / tot_w, 3) for c in best],
        }
        if basis != "plan":
            e_full = model.estimate(ppd, float(area), h["lat"], h["lon"])
            alt = r1000(e_full["ppm2"] * area * prem["factor"])
            o["area_used"], o["area_basis"], o["value_at_plan_area"] = num(a_used), basis, alt
            o["area_note"] = dict(note, en=note["en"].replace("{alt}", f"{alt:,}"),
                                  pt=note["pt"].replace("{alt}", f"{alt:,}".replace(",", ".")))
            (flagged if basis == "typical_for_house_type" else m43).append(
                (h["id"], h.get("housetype"), area, a_used, o["value"], alt))

    # summary by type, beds and accessibility (wheelchair M4(3) homes apart)
    groups = {}
    for h in homes:
        o = out_homes[h["id"]]
        acc_k = "M4(3)" if h.get("accessibility") == "M4(3)" else None
        groups.setdefault((PPD_NAME[o["ppd_type"]], h["beds"], acc_k or ""), []).append(o)
    order = {"detached": 0, "semi": 1, "terraced": 2, "flat": 3}
    summary = [{"type": t, "beds": b, "accessibility": a or None, "n_homes": len(v),
                "median_area": num(st.median([o["area"] for o in v])),
                "median_area_used": num(st.median([o.get("area_used", o["area"]) for o in v])),
                "median_ppm2_resale": int(st.median([o["ppm2"] for o in v])),
                "median_value_resale": r1000(st.median([o["value_resale"] for o in v])),
                "median_value_newbuild": r1000(st.median([o["value"] for o in v]))}
               for (t, b, a), v in sorted(groups.items(), key=lambda kv: (order[kv[0][0]], kv[0][1], kv[0][2]))]
    # sanity: OTM resale asking for the same type and beds (any size) within 2.5 km
    for s in summary:
        ppd = next(k for k, v in PPD_NAME.items() if v == s["type"])
        ls = [x for x in listings["listings"] if LISTING_TO_PPD.get(x["type"]) == ppd
              and x.get("beds") == s["beds"] and listing_ok(x) and not x.get("new_home")]
        s["otm_same_beds"] = {"n": len(ls), "median_asking": int(st.median([x["price"] for x in ls])) if ls else None,
                              "median_m2": num(st.median([x["m2"] for x in ls if x.get("m2")])) if any(x.get("m2") for x in ls) else None}
        # same type, similar size (+-20%), any beds: asking ppm2 vs our asking-equivalent
        sim = [p for p in pool if p["ppd"] == ppd and p["src"] == "listing"
               and abs(p["area"] / s["median_area_used"] - 1) <= 0.20]
        s["otm_similar_size"] = {"n": len(sim), "median_asking_ppm2": int(st.median([p["ppm2_raw"] for p in sim])) if sim else None,
                                 "our_asking_equiv_ppm2": int(s["median_ppm2_resale"] / ASK_TO_SOLD)}

    has_sold = src_n["sold"] > 0
    method_pt, method_en, basis_pt, basis_en = texts(acc, prem, ev, has_sold)
    comps_index = {}
    for cid, p in used.items():
        comps_index[cid] = {"src": p["src"], "ppd_type": p["ppd"], "type": p.get("type"), "beds": p.get("beds"),
                            "price": p["price"], "area": p["area"], "ppm2": int(round(p["ppm2_raw"])),
                            "ppm2_sold_equiv": int(round(p["ppm2"])), "date": p["date"],
                            "address": p["address"], "lat": p["lat"], "lon": p["lon"], "url": p.get("url"),
                            "basis": "sold" if p["src"] == "sold" else "asking"}

    disc_s = f"{round((1 - ASK_TO_SOLD) * 100, 1):g}%"
    notes = ([
        f"Comparables: {src_n['sold']} Land Registry sales with an EPC floor area (time-adjusted with UK HPI) "
        f"and {src_n['listing']} OnTheMarket listings with a stated area (asking prices less {disc_s}).",
        "Backtest = leave-one-out on 2025-2026 Land Registry sales with a floor area.",
    ] if has_sold else [
        "Comparables are asking prices (OnTheMarket, Oct 2026) with the agent's stated floor area, converted "
        f"to likely sale prices with a {round((1 - ASK_TO_SOLD) * 100, 1):g}% discount: Land Registry sales "
        "have no floor area yet (the EPC register cannot be fetched automatically).",
        "Backtest = leave-one-out on the listings pool (asking prices), not on achieved sale prices.",
        "Contract note: until sold.json has EPC floor areas, homes[*].comps are OnTheMarket listing ids "
        "(asking prices), resolved through comps_index (basis 'asking'), not Land Registry transaction ids.",
    ]) + [
        f"Left out of the comparables: {dropped['listing_non_market']} listings that are not ordinary market sales "
        f"(cash buyers only, refurbishment project, probate, lease under 80 years) and {dropped['listing_dupe']} "
        f"duplicates (the same home listed by another agent). For {dropped['listing_area_conflict_half_weight']} listings "
        "whose stated total floor area contradicts the listing's size field by more than 10%, the stated total is used "
        "at half weight (and they are not used as backtest targets).",
        f"The likely range (low-high) is the central {int(RANGE_Q * 100)}% of the backtest errors for the home's type, "
        f"widened by ±{ASK_TO_SOLD_UNCERT * 100:g}% for the asking-to-sale discount and, for the new-home value, by the "
        "premium range. The comparables listed are the 8 with the most weight (comps_w = share of the total weight).",
        f"{len(stale)} comparables are long-listed (OnTheMarket id below {STALE_ID:,}, probably on the market for "
        f"over a year): they ask a median {stale_med}% versus the model. They keep full weight (too few to calibrate "
        "a stale-listing discount).",
        f"{len(flagged)} homes have a plot-schedule area far off their house type's usual area (likely schedule errors) "
        f"and {len(m43)} wheelchair-user (M4(3)) flats have extra circulation space: these are valued at the typical / "
        "standard area (area_used), with the value at the plan area in value_at_plan_area.",
    ] + [
        "Agents' floor areas are often gross figures that may include garages or outbuildings; the planning "
        "GIA/NIA of Ravensbourne Place may be measured differently.",
        "Values are at today's prices (UK HPI latest month %s; listings %s). Ravensbourne Place has outline "
        "planning only; launch prices years from now will follow the market." % (hpi.latest, listings.get("generated")),
        "Low-Cost Rent and Intermediate (shared-ownership) homes are not sold at these prices: the figure is "
        "the full open-market value of the home (for shared ownership the buyer pays a share of it).",
    ]
    notes_pt = ([
        f"Comparáveis: {src_n['sold']} vendas do Land Registry com área do EPC (corrigidas pelo UK HPI) e "
        f"{src_n['listing']} anúncios do OnTheMarket com área (preço pedido menos {disc_s.replace('.', ',')}).",
        "O teste de erro (deixando um de fora) foi feito sobre vendas fechadas de 2025-2026 com área.",
    ] if has_sold else [
        "Os comparáveis são preços pedidos (OnTheMarket, out/2026) com a área informada pelo corretor, convertidos "
        f"em preço provável de venda com desconto de {str(round((1 - ASK_TO_SOLD) * 100, 1)).replace('.', ',')}%: "
        "as vendas do Land Registry ainda não têm área (o registro de EPC não pode ser lido automaticamente).",
        "O teste de erro (deixando um de fora) foi feito sobre os anúncios (preços pedidos), não sobre vendas fechadas.",
    ]) + [
        f"Ficaram de fora dos comparáveis: {dropped['listing_non_market']} anúncios que não são venda normal de mercado "
        f"(só para compra à vista, reforma completa, inventário, contrato de leasehold com menos de 80 anos) e "
        f"{dropped['listing_dupe']} duplicados (o mesmo imóvel anunciado por outra imobiliária). Em "
        f"{dropped['listing_area_conflict_half_weight']} anúncios a área total do texto contradiz a do anúncio em mais "
        "de 10%: usamos a do texto, com metade do peso (e eles não entram no teste de erro).",
        f"A faixa provável cobre {int(RANGE_Q * 10)} em cada 10 erros do teste para o tipo do imóvel, mais ±"
        f"{ASK_TO_SOLD_UNCERT * 100:g}% pelo desconto sobre o preço pedido e, no valor de imóvel novo, a faixa do prêmio. "
        "A lista mostra os comparáveis de maior peso.",
        f"{len(stale)} comparáveis estão anunciados há muito tempo (provavelmente mais de um ano): pedem em mediana "
        f"{str(stale_med).replace('.', ',')}% em relação ao modelo. Mantêm o peso normal (são poucos para calibrar um desconto).",
        f"{len(flagged)} imóveis têm na planilha uma área muito diferente da usual do seu tipo (provável erro da planilha) "
        f"e {len(m43)} apartamentos para cadeirante (M4(3)) têm espaço extra de circulação: o valor usa a área típica / padrão.",
    ] + [
        "A área dos anúncios costuma ser bruta e pode incluir garagem ou anexos; a GIA/NIA da planta de "
        "Ravensbourne Place pode ser medida de outro jeito.",
        "Valores a preços de hoje (UK HPI até %s; anúncios de %s). O projeto só tem aprovação em esboço "
        "(outline); o preço de lançamento daqui a alguns anos vai seguir o mercado." % (hpi.latest, listings.get("generated")),
        "Casas de aluguel social (Low-Cost Rent) e Intermediate (shared ownership) não são vendidas por esse "
        "preço: o número é o valor de mercado da casa inteira (no shared ownership o comprador paga uma parte).",
    ]
    out = {
        "generated": dt.date.today().isoformat(),
        "valuation_date": VALUATION_DATE,
        "method": {"pt": method_pt, "en": method_en},
        "new_build_premium": {"factor": prem["factor"], "low": prem["low"], "high": prem["high"],
                              "basis_pt": basis_pt, "basis_en": basis_en, "evidence": ev},
        "accuracy": dict(acc, notes=((
            "Leave-one-out on %d Land Registry sales of 2025-2026 with a floor area: each sale's time-adjusted "
            "£/m² predicted from the other comparables with the same rules. Median absolute error %s%%, 80%% of "
            "errors below %s%%. Without the size adjustment the median error would be %s%%." % (
                acc["backtest_n"], acc["median_abs_pct_error"], acc["p80_abs_pct_error"],
                acc_nosize["median_abs_pct_error"])) if has_sold else (
            "Leave-one-out on %d listings with a floor area (duplicates and non-market listings removed): each "
            "home's asking £/m² predicted from the others with the same rules. Median absolute error %s%%, 80%% of "
            "errors below %s%%; %d%% of the held-out prices fall inside the published resale range. Without the size "
            "adjustment the median error would be %s%%. Land Registry sale prices could not be used (no floor "
            "areas), so the error on achieved prices is unknown and likely larger; the new-home value adds the "
            "untested asking-to-sale discount and the new-build premium." % (
                acc["backtest_n"], acc["median_abs_pct_error"], acc["p80_abs_pct_error"],
                round(acc["share_within_low_high"] * 100), acc_nosize["median_abs_pct_error"])))),
        "params": {"comparables": src_n, "min_comparables": MIN_N, "radii_m": list(RADII),
                   "size_bands": [b for b in SIZE_BANDS if b], "distance_scale_m": DIST_SCALE,
                   "size_sigma_log": SIZE_SIGMA, "recency_half_life_years": RECENCY_HALF_LIFE,
                   "size_elasticity": round(model.beta, 3), "size_elasticity_fit_n": fit["n"],
                   "type_effects_vs_terraced": fit["type_effects"],
                   "ask_to_sold": ASK_TO_SOLD, "ask_to_sold_sources": ASK_TO_SOLD_SOURCES,
                   "ask_vs_sold_local_check": avs,
                   "ask_vs_sold_local_check_note": "Median asking price vs median HPI-adjusted 2025-26 sale price by type. "
                       "The two sets differ in size mix, so this cannot confirm the asking-to-sale discount.",
                   "ask_to_sold_uncertainty": ASK_TO_SOLD_UNCERT, "range_quantile": RANGE_Q,
                   "range_half_width_log": {k: round(v, 4) for k, v in hw.items()},
                   "duplicate_rule": DUP, "duplicates": dupes, "excluded_listings": excluded,
                   "long_listed": {"id_below": STALE_ID, "n": len(stale), "median_ask_vs_model_pct": stale_med},
                   "hpi_latest_month": hpi.latest, "dropped": dropped},
        "comps_source": "listings" if not has_sold else ("mixed" if src_n["listing"] else "sold"),
        "notes": notes,
        "notes_pt": notes_pt,
        "summary": summary,
        "comps_index": comps_index,
        "homes": out_homes,
    }
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    log(f"wrote {args.out} ({os.path.getsize(args.out) // 1024} KB), {len(out_homes)} homes, "
        f"{http.n} HTTP requests")
    log("method.pt words: %d, method.en words: %d" % (len(method_pt.split()), len(method_en.split())))

    # ---- printed tables
    print("\nSUMMARY (type, beds, homes, median m2, resale ppm2, resale value, new-build value | OTM same beds n, median asking, median m2)")
    for s in summary:
        o = s["otm_same_beds"]
        print(f"  {s['type']:<9} {s['beds']} {(s['accessibility'] or ''):<5} n={s['n_homes']:<4} {s['median_area']:>6} m2  £{s['median_ppm2_resale']:,}/m2  "
              f"£{s['median_value_resale']:>9,}  £{s['median_value_newbuild']:>9,} | OTM n={o['n']:<3} "
              f"£{(o['median_asking'] or 0):>9,} {o['median_m2']}")
    hs = {h["id"]: h for h in homes}
    picks, seen = [], set()
    for h in homes:              # one example per (plot type, beds), tenure Private first
        k = (h["plot_type"], h["beds"])
        if k not in seen:
            seen.add(k)
            picks.append(h["id"])
    picks = picks[:max(args.examples, 1)]
    print("\nSANITY vs OnTheMarket asking £/m², same type and size +-20% (any beds)")
    for s in summary:
        o = s["otm_similar_size"]
        r = o["our_asking_equiv_ppm2"] / o["median_asking_ppm2"] if o["median_asking_ppm2"] else None
        flag = "  <-- check" if r and abs(r - 1) > 0.15 else ""
        print(f"  {s['type']:<9} {s['beds']}b {s['median_area']:>5} m2: ours (asking-equiv) £{o['our_asking_equiv_ppm2']:,}"
              f" vs OTM median £{(o['median_asking_ppm2'] or 0):,} (n={o['n']}) ratio {r and round(r, 3)}{flag}")
    print(f"\nAREA FLAGS (area >{int(AREA_FLAG * 100)}% off the house type's median): {len(flagged)}; M4(3) at standard area: {len(m43)}")
    for f_ in flagged + m43[:4]:
        print(f"  {f_[0]} {f_[1]} plan {f_[2]} m2 -> valued at {f_[3]:g} m2: £{f_[4]:,} (at plan area £{f_[5]:,})")
    print("\nEXAMPLES (plot, type, beds, area, ppm2, value_resale [low-high], value [low-high], n, radius, band)")
    for pid in picks:
        h, o = hs[pid], out_homes[pid]
        print(f"  {pid:<14} {h['plot_type']:<13} {h['beds']}b {o['area']:>5} {o['area_kind']}  £{o['ppm2']:,}/m2  "
              f"£{o['value_resale']:,} [{o['low_resale']:,}-{o['high_resale']:,}]  £{o['value']:,} "
              f"[{o['low']:,}-{o['high']:,}]  n={o['n']} r={o['radius_m']} band={o['size_band_pct']}")


if __name__ == "__main__":
    main()
