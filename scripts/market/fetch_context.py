#!/usr/bin/env python3
"""Build data/market/context.json - market context for the Ravensbourne Place price estimator.

Parts (every HTTP response is cached under --cache/context/, so a re-run never refetches;
pass --refresh to fetch everything again):

 1. ukhpi - HM Land Registry UK House Price Index (linked data API, OGL v3.0) for the
    London Borough of Bromley: monthly average price overall and by property type
    (detached, semi-detached, terraced, flat/maisonette) from --since (default 2022-01)
    to the latest month published. One ELDA list query returns every month.
 2. sdlt - Stamp Duty Land Tax (England) residential rates IN FORCE on --date (default:
    today), parsed from the live GOV.UK content API (the same text as
    https://www.gov.uk/stamp-duty-land-tax/residential-property-rates and HMRC's
    first-time-buyer / higher-rates / non-resident guidance). The effective date comes
    from GOV.UK's "previous rates" publication (its last period ends the day before).
    Worked examples are computed from the parsed bands and GOV.UK's own worked examples
    are re-computed as a cross-check (the script aborts if any of them disagree).
 3. mortgage - Bank of England "quoted household interest rates" (Bankstats table G1.3,
    monthly, IADB CSV export, one cached request per series): 2-year fixed at 60/75/90%
    LTV, 5-year fixed at 75% and 95% LTV, 10-year fixed at 75%. Each code is checked
    against the G1.3 row label on https://www.bankofengland.co.uk/statistics/tables and
    against the IADB series title. G1.3 has NO 5-year 90% LTV series. Its 2y 85%, 2y 95%,
    3y 75% and SVR series were refused ("Access denied") by the IADB on 2026-10-18, so
    they are listed in BOE_DENIED and left out. A refused request is never retried: the
    script stops and asks for a CSV export saved in a browser (--boe-csv FILE).
 4. shared_ownership - GOV.UK shared ownership guide (share range, rent cap on the
    unsold share, London income cap, staircasing), plus London notes (GLA shared
    ownership rent cap, London Living Rent, Low-Cost Rent). london.gov.uk answers
    automated clients with HTTP 403, so the GLA figures are NOT fetched: they are kept
    in GLA_MANUAL below with their source URLs and the date they were checked.

Units: SDLT and shared-ownership rates are fractions (0.05 = 5%); mortgage rates are
percent per annum as published by the Bank of England (5.13 = 5.13%). Money in GBP.

Usage:
  python3 scripts/market/fetch_context.py
  python3 scripts/market/fetch_context.py --refresh          # refetch every source
  python3 scripts/market/fetch_context.py --since 2020-01 --date 2026-10-18
  python3 scripts/market/fetch_context.py --boe-csv ~/Downloads/results.csv   # if IADB refuses

Python 3 standard library + requests.
"""
import argparse
import datetime as dt
import hashlib
import html
import json
import math
import os
import re
import sys
import time

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "data", "market", "context.json")
# cache root shared by all scripts/market/*.py: $MARKET_CACHE, else ~/.cache/bromley-market
DEFAULT_CACHE = os.environ.get("MARKET_CACHE") or os.path.expanduser("~/.cache/bromley-market")
UA = ("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
      "Chrome/126.0.0.0 Safari/537.36")

# ---- sources
HPI_REGION = "bromley"
HPI_LIST = ("https://landregistry.data.gov.uk/data/ukhpi.json?refRegion="
            "http://landregistry.data.gov.uk/id/region/{region}&min-refMonth={since}"
            "&_pageSize=200&_sort=refMonth&_properties=refMonth,averagePrice,"
            "averagePriceDetached,averagePriceSemiDetached,averagePriceTerraced,"
            "averagePriceFlatMaisonette")
HPI_MONTH = "https://landregistry.data.gov.uk/data/ukhpi/region/{region}/month/{month}.json"
HPI_LICENCE = ("Contains HM Land Registry data © Crown copyright and database right {y}. "
               "This data is licensed under the Open Government Licence v3.0.")

GOVUK = "https://www.gov.uk"
API = GOVUK + "/api/content"
P_SDLT = "/stamp-duty-land-tax"                       # guide; part residential-property-rates
P_SDLT_PREV = "/government/publications/rates-and-allowances-stamp-duty-land-tax"
P_FTB = "/guidance/stamp-duty-land-tax-relief-for-land-or-property-transactions"
P_HIGHER = "/guidance/stamp-duty-land-tax-buying-an-additional-residential-property"
P_NONRES = "/guidance/rates-of-stamp-duty-land-tax-for-non-uk-residents"
P_SO = "/shared-ownership-scheme"

BOE_CSV = ("https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes"
           "&Datefrom=01/Jan/{y}&Dateto=now&SeriesCodes={codes}&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N")
BOE_TITLES = ("https://www.bankofengland.co.uk/boeapps/database/fromshowcolumns.asp?Travel=NIxAZxSUx"
              "&FromSeries=1&ToSeries=50&DAT=RNG&FD=1&FM=Jan&FY={y}&TD=31&TM=Dec&TY={y}&FNY=Y"
              "&CSVF=TT&html.x=66&html.y=26&SeriesCodes={codes}&UsingCodes=Y&Filter=N&title=G1.3&VPD=Y")
BOE_TABLE = "https://www.bankofengland.co.uk/statistics/tables"   # G1.3 code mapping
# code: (label, LTV, fixed years) - verified against the IADB series titles at run time
BOE_SERIES = {
    "IUMZICQ": ("2-year fixed, 60% LTV", 60, 2),
    "IUMBV34": ("2-year fixed, 75% LTV", 75, 2),
    "IUMB482": ("2-year fixed, 90% LTV", 90, 2),
    "IUMBV42": ("5-year fixed, 75% LTV", 75, 5),
    "IUM5WTL": ("5-year fixed, 95% LTV", 95, 5),
    "IUMBV45": ("10-year fixed, 75% LTV", 75, 10),
}
# Also in G1.3 but answered "Access denied" by the IADB CSV export on 2026-10-18 (not
# retried or worked around): IUMZICR 2y 85%, IUM2WTL 2y 95%, IUMBV37 3y 75%, IUMTLMV SVR.
BOE_DENIED = {"IUMZICR": "2-year fixed, 85% LTV", "IUM2WTL": "2-year fixed, 95% LTV",
              "IUMBV37": "3-year fixed, 75% LTV", "IUMTLMV": "Standard variable rate (SVR)"}

# london.gov.uk returns HTTP 403 to automated clients (checked 2026-10-18), so these few
# GLA figures are recorded by hand. Re-check them in a browser when refreshing.
GLA_MANUAL = {
    "checked": "2026-10-18",
    "fetched": False,
    "blocked": "https://www.london.gov.uk/... returned HTTP 403 to an automated request on 2026-10-18; "
               "not retried or worked around. Figures below are as published by the GLA and quoted "
               "in web-search extracts of its pages on that date.",
    "shared_ownership_url": "https://www.london.gov.uk/programmes-strategies/housing-and-land/"
                            "buying-and-owning-home/shared-ownership-scheme",
    "shared_ownership_rent_cap": 0.0275,      # initial rent <= 2.75% of the unsold share (GLA)
    "llr_url": "https://www.london.gov.uk/programmes-strategies/housing-and-land/homes-londoners/"
               "london-living-rent",
    "llr_income_cap": 67000,                  # GLA intermediate-rent income cap (July 2024 note)
    "llr_income_cap_note": "GLA material (July 2024) aligns London Living Rent with the GBP 67,000 "
                           "maximum household income for intermediate rented products; older GLA "
                           "pages still say GBP 60,000 - check the live GLA page.",
}

LOG = []


class Denied(Exception):
    """The server refused the request (403/429/captcha/'Access denied'); never retried."""


def log(*a):
    print(*a, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------- HTTP + cache
class Http:
    """requests.Session with a browser UA, a per-host minimum interval and a disk cache."""

    def __init__(self, cache, refresh=False):
        self.cache, self.refresh = cache, refresh
        os.makedirs(cache, exist_ok=True)
        self.s = requests.Session()
        self.s.headers.update({"User-Agent": UA, "Accept-Language": "en-GB,en;q=0.9"})
        self.last = {}
        self.fetched_on = {}           # url -> ISO date the cached copy was fetched

    def path(self, url):
        slug = re.sub(r"[^A-Za-z0-9]+", "_", re.sub(r"^https?://", "", url))[:80].strip("_")
        return os.path.join(self.cache, f"{slug}.{hashlib.sha1(url.encode()).hexdigest()[:10]}")

    def get(self, url, interval=0.6):
        """Return response text (cached). interval 0.6 s keeps us under 2 req/s per host."""
        p = self.path(url)
        if os.path.exists(p) and not self.refresh:
            self.fetched_on[url] = dt.date.fromtimestamp(os.path.getmtime(p)).isoformat()
            with open(p, encoding="utf-8") as f:
                return f.read()
        host = re.sub(r"^https?://([^/]+).*$", r"\1", url)
        err = None
        for i in range(3):
            t = self.last.get(host, 0) + interval - time.time()
            if t > 0:
                time.sleep(t)
            self.last[host] = time.time()
            try:
                r = self.s.get(url, timeout=(30, 120), allow_redirects=True)
            except requests.RequestException as e:
                err = repr(e)
                time.sleep(5 * (i + 1))
                continue
            if (r.status_code in (403, 429) or "captcha" in r.text[:5000].lower()
                    or ("ErrorPage.asp" in r.url and "Access denied" in r.text)):
                LOG.append(f"BLOCKED HTTP {r.status_code} {r.url} <- {url}")
                raise Denied(f"{host} refused the request (HTTP {r.status_code}, {r.url})")
            if r.status_code >= 500:
                err = f"HTTP {r.status_code}"
                time.sleep(5 * (i + 1))
                continue
            if r.status_code != 200 or "ErrorPage.asp" in r.url:
                raise SystemExit(f"unexpected response HTTP {r.status_code} ({r.url}) for {url}")
            r.encoding = r.encoding or "utf-8"
            with open(p, "w", encoding="utf-8") as f:
                f.write(r.text)
            self.fetched_on[url] = dt.date.today().isoformat()
            log(f"  fetched {url}")
            return r.text
        raise SystemExit(f"failed: {url}: {err}")

    def json(self, url):
        return json.loads(self.get(url))


# --------------------------------------------------------------------------- helpers
def money(s):
    """'£125,001' -> 125001 ; '£1.5 million' -> 1500000."""
    m = re.search(r"£\s*([\d,]+(?:\.\d+)?)\s*(million|m\b)?", s)
    if not m:
        return None
    v = float(m.group(1).replace(",", ""))
    return int(round(v * 1_000_000)) if m.group(2) else int(round(v))


def pct(s):
    s = s.strip().lower()
    if s.startswith("zero") or s.startswith("nil"):
        return 0.0
    m = re.search(r"(\d+(?:\.\d+)?)\s*%", s)
    return round(float(m.group(1)) / 100, 6) if m else None


def html_text(h):
    h = re.sub(r"</t[dh]>", " | ", h)
    h = re.sub(r"</(p|li|tr|h[1-6]|div)>|<br\s*/?>", "\n", h)
    t = html.unescape(re.sub(r"<[^>]+>", "", h))
    t = re.sub(r"[ \t ]+", " ", t)
    return re.sub(r"\n\s*\n+", "\n", t)


def body_html(b):
    if isinstance(b, list):
        return " ".join(x.get("content", "") for x in b if x.get("content_type") == "text/html")
    return b or ""


def govuk_parts(doc):
    """{part slug or '_body': html} for a GOV.UK content-API document."""
    det = doc.get("details", {})
    out = {"_body": body_html(det.get("body"))}
    for p in det.get("parts") or []:
        out[p["slug"]] = body_html(p.get("body"))
    return out


def tables(h):
    """Each <table> as a list of rows (list of cell texts)."""
    out = []
    for tb in re.findall(r"<table.*?</table>", h, flags=re.S | re.I):
        rows = []
        for tr in re.findall(r"<tr.*?</tr>", tb, flags=re.S | re.I):
            cells = [html_text(c).strip(" |\n") for c in
                     re.findall(r"<t[dh][^>]*>(.*?)</t[dh]>", tr, flags=re.S | re.I)]
            if cells:
                rows.append(cells)
        out.append(rows)
    return out


def band_table(rows):
    """GOV.UK SDLT band table -> [{from, rate}] (from = lower bound in GBP)."""
    bands = []
    for cells in rows:
        if len(cells) < 2:
            continue
        label, rate = cells[0], pct(cells[1])
        if rate is None:
            continue                       # header row
        low = label.lower()
        if low.startswith("up to"):
            lo = 0
        elif "portion from" in low:
            lo = money(label[low.index("portion from"):]) - 1
        elif "above" in low:
            lo = money(label[low.index("above"):])
        else:
            raise SystemExit(f"cannot parse SDLT band row: {cells}")
        bands.append({"from": lo, "rate": rate})
    if not bands or bands[0]["from"] != 0 or any(
            b["from"] <= a["from"] for a, b in zip(bands, bands[1:])):
        raise SystemExit(f"implausible SDLT bands parsed: {bands}")
    return bands


def sdlt_tax(price, bands, surcharge=0.0):
    """Marginal SDLT (rounded down to the pound, as HMRC does) with a per-band breakdown."""
    total, parts = 0.0, []
    for i, b in enumerate(bands):
        hi = bands[i + 1]["from"] if i + 1 < len(bands) else None
        if price <= b["from"]:
            break
        portion = (min(price, hi) if hi else price) - b["from"]
        r = round(b["rate"] + surcharge, 6)
        tax = portion * r
        total += tax
        parts.append({"from": b["from"], "to": min(price, hi) if hi else price, "rate": r,
                      "tax": int(round(tax))})
    return int(math.floor(total + 1e-6)), parts


def need(rx, text, what, flags=re.S | re.I):
    m = re.search(rx, text, flags)
    if not m:
        raise SystemExit(f"GOV.UK text changed - could not find {what!r} ({rx})")
    return m


# --------------------------------------------------------------------------- 1. UK HPI
def build_ukhpi(http, since):
    url = HPI_LIST.format(region=HPI_REGION, since=since)
    d = http.json(url)
    items = d["result"].get("items", [])
    if d["result"].get("next"):
        raise SystemExit("UK HPI list query paginated - raise _pageSize")
    months = []
    for it in sorted(items, key=lambda x: x["refMonth"]):
        months.append({"month": it["refMonth"][:7],
                       "all": int(it["averagePrice"]),
                       "detached": int(it["averagePriceDetached"]),
                       "semi": int(it["averagePriceSemiDetached"]),
                       "terraced": int(it["averagePriceTerraced"]),
                       "flat": int(it["averagePriceFlatMaisonette"])})
    if not months:
        raise SystemExit("UK HPI: no months returned")
    latest = months[-1]["month"]
    # cross-check the latest month against the per-month item endpoint
    one = http.json(HPI_MONTH.format(region=HPI_REGION, month=latest))["result"]["primaryTopic"]
    if int(one["averagePrice"]) != months[-1]["all"]:
        raise SystemExit("UK HPI: list and item endpoints disagree")
    prev_year = next((m for m in months if m["month"] == f"{int(latest[:4]) - 1}{latest[4:]}"), None)
    yoy = {k: round(100 * (months[-1][k] / prev_year[k] - 1), 1)
           for k in ("all", "detached", "semi", "terraced", "flat")} if prev_year else None
    log(f"UK HPI: {len(months)} months {months[0]['month']}..{latest}, all={months[-1]['all']:,}")
    return {
        "region": HPI_REGION,
        "region_label": "London Borough of Bromley",
        "source": "HM Land Registry UK House Price Index (linked data)",
        "source_url": url,
        "month_url": HPI_MONTH.format(region=HPI_REGION, month=latest),
        "licence": HPI_LICENCE.format(y=dt.date.today().year),
        "checked": http.fetched_on.get(url),
        "first_month": months[0]["month"],
        "latest_month": latest,
        "latest_one_year_change_pct": yoy,
        "notes": ("Mixed-adjusted average prices (all property types and by type); 'flat' is "
                  "flat/maisonette. UK HPI is published about two months after the reference "
                  "month (with the latest months revised as more sales are registered), so "
                  f"{latest} was the newest month available when checked. Index ratios equal "
                  "average-price ratios, so month[t]/month[s] can be used to time-adjust a sale."),
        "months": months,
    }


# --------------------------------------------------------------------------- 2. SDLT
def build_sdlt(http, on_date):
    srcs, docs = {}, {}
    for key, path in (("guide", P_SDLT), ("previous", P_SDLT_PREV), ("ftb", P_FTB),
                      ("higher", P_HIGHER), ("nonres", P_NONRES)):
        docs[key] = http.json(API + path)
        srcs[key] = {"title": docs[key].get("title"), "url": GOVUK + path,
                     "api_url": API + path,
                     "public_updated_at": docs[key].get("public_updated_at"),
                     "updated_at": docs[key].get("updated_at"),
                     "checked": http.fetched_on.get(API + path)}
    srcs["guide"]["url"] = GOVUK + P_SDLT + "/residential-property-rates"

    res_h = govuk_parts(docs["guide"]).get("residential-property-rates")
    if not res_h:
        raise SystemExit("GOV.UK SDLT guide has no 'residential-property-rates' part")
    res_t = html_text(res_h)

    # effective date: the last period in 'previous rates' ends the day before
    title = docs["previous"].get("title", "")
    end = need(r"to (\d{1,2} \w+ \d{4})\s*$", title, "previous-rates end date").group(1)
    effective = (dt.datetime.strptime(end, "%d %B %Y").date() + dt.timedelta(days=1))
    hi_t = html_text(govuk_parts(docs["higher"])["_body"])
    eff_txt = f"{effective.day} {effective:%B %Y}"
    need(r"higher rates from " + re.escape(eff_txt), hi_t, f"higher rates from {eff_txt}")
    if effective > on_date:
        raise SystemExit(f"parsed effective date {effective} is after {on_date}")

    # standard bands: first table in the residential part
    standard = band_table(tables(res_h)[0])

    # first-time buyer relief (guide part and HMRC relief guidance must agree)
    m = need(r"no SDLT up to (£[\d,]+).*?(\d+)% SDLT on the portion from (£[\d,]+) to (£[\d,]+)"
             r".*?price is over (£[\d,]+), you cannot claim", res_t, "FTB bands (guide)")
    ftb_nil, ftb_rate, ftb_cap = money(m.group(1)), int(m.group(2)) / 100, money(m.group(5))
    ftb_t = html_text(govuk_parts(docs["ftb"])["_body"])
    m2 = need(r"First-Time Buyers.? Relief.*?no more than (£[\d,]+).*?0% on the first (£[\d,]+)"
              r".*?(\d+)% on the remainder up to (£[\d,]+)", ftb_t, "FTB bands (HMRC guidance)")
    if (money(m2.group(1)), money(m2.group(2)), int(m2.group(3)) / 100) != (ftb_cap, ftb_nil, ftb_rate):
        raise SystemExit("FTB relief: GOV.UK guide and HMRC guidance disagree")
    ftb_bands = [{"from": 0, "rate": 0.0}, {"from": ftb_nil, "rate": ftb_rate}]

    # higher rates for additional dwellings: surcharge = higher table - standard table
    higher = band_table(tables(govuk_parts(docs["higher"])["_body"])[0])
    diffs = {round(h["rate"] - s["rate"], 6) for h, s in zip(higher, standard)}
    if len(diffs) != 1 or [h["from"] for h in higher] != [s["from"] for s in standard]:
        raise SystemExit(f"higher-rates table is not standard + constant surcharge: {higher}")
    additional = diffs.pop()
    if pct(need(r"usually have to pay (\d+%) on top", res_t, "additional surcharge").group(1)) != additional:
        raise SystemExit("additional-dwellings surcharge: text and table disagree")

    # non-resident surcharge
    nonres = pct(need(r"usually pay a (\d+%) surcharge", res_t, "non-resident surcharge").group(1))
    nr_t = html_text(govuk_parts(docs["nonres"])["_body"])
    if int(need(r"rates are (\d+) percentage points higher", nr_t, "non-resident pp").group(1)) / 100 != nonres:
        raise SystemExit("non-resident surcharge: guide and HMRC guidance disagree")

    nl = need(r"more than the SDLT threshold \(currently (£[\d,]+)\), you.ll pay SDLT at (\d+)%",
              res_t, "new-lease rent NPV rule")
    lease_npv = {"threshold": money(nl.group(1)), "rate": int(nl.group(2)) / 100}

    def ftb_tax(price):
        return sdlt_tax(price, ftb_bands) if price <= ftb_cap else sdlt_tax(price, standard)

    # GOV.UK's own worked examples, recomputed with the parsed bands
    so_t = html_text(govuk_parts(docs["guide"]).get("shared-ownership-property", ""))
    checks = []
    for desc, text, rx, fn, src in (
        ("GOV.UK example: standard purchase", res_t,
         r"buy a house for (£[\d,]+).*?total SDLT = (£[\d,]+)", lambda p: sdlt_tax(p, standard),
         srcs["guide"]["url"]),
        ("GOV.UK example: first-time buyer", res_t,
         r"first-time buyer and purchase a property for (£[\d,]+).*?total SDLT = (£[\d,]+)", ftb_tax,
         srcs["guide"]["url"]),
        ("HMRC example: additional dwelling (higher rates)", hi_t,
         r"additional residential property for (£[\d,]+).*?Total SDLT = (£[\d,]+)",
         lambda p: sdlt_tax(p, standard, additional), srcs["higher"]["url"]),
        ("GOV.UK example: shared ownership, market value election", so_t,
         r"market value of (£[\d,]+).*?total SDLT = (£[\d,]+)", lambda p: sdlt_tax(p, standard),
         GOVUK + P_SDLT + "/shared-ownership-property"),
    ):
        m = re.search(rx, text, re.S | re.I)
        if not m:
            LOG.append(f"WARN SDLT cross-check not found: {desc}")
            continue
        price, gov = money(m.group(1)), money(m.group(2))
        got = fn(price)[0]
        checks.append({"description": desc, "price": price, "govuk_total": gov, "computed": got,
                       "ok": got == gov, "source_url": src})
        if got != gov:
            raise SystemExit(f"SDLT cross-check failed: {desc}: GOV.UK {gov} vs computed {got}")

    examples = []
    for label_pt, label_en, price, kind in (
        ("£450.000 - comprador padrão (único imóvel)", "£450,000 - standard buyer (only home)", 450000, "standard"),
        ("£450.000 - comprador de primeiro imóvel", "£450,000 - first-time buyer", 450000, "first_time_buyer"),
        ("£650.000 - comprador padrão", "£650,000 - standard buyer", 650000, "standard"),
        ("£650.000 - primeiro imóvel (acima de £500.000: sem alívio)",
         "£650,000 - first-time buyer (over £500,000: no relief)", 650000, "first_time_buyer"),
        ("£650.000 - imóvel adicional (+5%)", "£650,000 - additional dwelling (+5%)", 650000, "additional"),
    ):
        if kind == "standard":
            tax, br = sdlt_tax(price, standard)
        elif kind == "first_time_buyer":
            tax, br = ftb_tax(price)
        else:
            tax, br = sdlt_tax(price, standard, additional)
        examples.append({"label_pt": label_pt, "label_en": label_en, "price": price, "buyer": kind,
                         "relief_applies": kind == "first_time_buyer" and price <= ftb_cap,
                         "tax": tax, "effective_rate_pct": round(100 * tax / price, 2),
                         "breakdown": br})
    log("SDLT: effective %s, standard %s, FTB nil %s cap %s, +%s additional, +%s non-resident" % (
        effective, [(b["from"], b["rate"]) for b in standard], ftb_nil, ftb_cap, additional, nonres))
    return {
        "effective_from": effective.isoformat(),
        "in_force_on": on_date.isoformat(),
        "source_url": srcs["guide"]["url"],
        "checked": srcs["guide"]["checked"],
        "rate_unit": "fraction",
        "standard": standard,
        "first_time_buyer": {
            "bands": ftb_bands, "max_price": ftb_cap,
            "source_url": GOVUK + P_FTB + "#first-time-buyers-relief",
            "conditions": "All buyers are first-time buyers, the home will be their main residence "
                          "and the price is no more than the cap; above the cap standard rates apply "
                          "to the whole price. Shared ownership: relief if the FULL market value is "
                          "within the cap (market value election or staged payments).",
        },
        "additional_surcharge": additional,
        "additional_surcharge_note": "Added to every band when the buyer (or spouse/co-buyer) will own "
                                     "more than one residential property worth GBP 40,000+ (rate "
                                     "raised from 3% to 5% on 31 October 2024). Not due when replacing "
                                     "a main residence sold on/before completion.",
        "non_resident_surcharge": nonres,
        "non_resident_note": "Buyers not present in the UK for at least 183 days in the 12 months "
                             "before purchase; stacks with the other rates (FTB relief or the 5% "
                             "surcharge). Refund possible if the 183-day test is met later.",
        "new_lease_rent": lease_npv,
        "examples": examples,
        "govuk_cross_checks": checks,
        "sources": list(srcs.values()),
        "notes": ("Rates in force for residential purchases in England (and Northern Ireland) "
                  f"completing on or after {effective.isoformat()}; still the current rates on "
                  f"{on_date.isoformat()} per the live GOV.UK pages. Tax on each band = (portion of "
                  "price in band) x rate; HMRC rounds the total down to the pound. Leasehold flats "
                  "can also owe 1% on rent NPV above GBP 125,000 (ground rent is normally a "
                  "peppercorn on new leases, so usually nil)."),
    }


# --------------------------------------------------------------------------- 3. mortgages
def read_boe_csv(text):
    """IADB CSV export (CSVF=TN: 'DATE,CODE,...' then '30 Sep 2026,5.13,...') -> {code: {date: rate}}."""
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    head = [h.strip() for h in lines[0].split(",")]
    if head[0] != "DATE" or not all(re.fullmatch(r"[A-Z0-9]{7}", h) for h in head[1:]):
        raise ValueError(f"not an IADB CSV export: {head}")
    out = {h: {} for h in head[1:]}
    for ln in lines[1:]:
        c = ln.split(",")
        d = dt.datetime.strptime(c[0].strip(), "%d %b %Y").date()
        for h, v in zip(head[1:], c[1:]):
            if v.strip() not in ("", ".."):
                out[h][d] = float(v)
    return out


def g13_mapping(http):
    """{code: row label} for Bankstats table G1.3 from the BoE statistics tables page."""
    h = http.get(BOE_TABLE)
    i = h.find("G1.3 - Average quoted household interest rates")
    if i < 0:
        raise SystemExit("BoE tables page: G1.3 section not found")
    seg = h[i:h.find("</table>", i)]
    out = {}
    for row in re.findall(r"<tr>(.*?)</tr>", seg, flags=re.S):
        cells = re.findall(r"<td>(.*?)</td>", row, flags=re.S)
        codes = re.findall(r"EC=([A-Z0-9]+)", row)
        if cells and codes:
            out[codes[0]] = html.unescape(re.sub(r"\s+", " ", re.sub("<[^>]+>", "", cells[0]))).strip()
    return out


def build_mortgage(http, since_year, csv_files):
    # 1. what each code means, from the published G1.3 table mapping
    g13 = g13_mapping(http)
    for code, (label, ltv, yrs) in BOE_SERIES.items():
        want = rf"^{yrs} year {ltv}% LTV fixed-rate owner occupied" if yrs else r"^Standard variable"
        if not re.search(want, g13.get(code, "")):
            raise SystemExit(f"BoE G1.3: {code} is {g13.get(code)!r}, expected {label!r}")
    # 2. one IADB CSV request per series (each cached); refusals are recorded, not retried
    data, used, denied = {}, {}, {}
    for code in BOE_SERIES:
        url = BOE_CSV.format(y=since_year, codes=code)
        try:
            d = read_boe_csv(http.get(url, interval=1.2))
            data[code] = d[code]
            used[code] = url
        except Denied as e:
            denied[code] = str(e)
    # 3. CSV exports saved by hand (browser / earlier session) fill the refused series
    for fpath in csv_files:
        with open(fpath, encoding="utf-8") as f:
            d = read_boe_csv(f.read())
        for code, series in d.items():
            if code in BOE_SERIES and code not in data:
                data[code] = series
                used[code] = f"file:{os.path.basename(fpath)} (IADB CSV export, saved " \
                             f"{dt.date.fromtimestamp(os.path.getmtime(fpath)).isoformat()})"
                denied.pop(code, None)
    if denied:
        raise SystemExit("BoE IADB refused: %s - save the CSV export in a browser from %s and pass "
                         "--boe-csv FILE" % (", ".join(denied), BOE_CSV.format(y=since_year, codes=",".join(denied))))
    # 4. latest month that every series has
    common = set.intersection(*(set(v) for v in data.values()))
    as_of = max(common)
    # optional: full IADB series titles (one request; tolerated if refused)
    titles = {}
    t_url = BOE_TITLES.format(y=as_of.year, codes=",".join(BOE_SERIES))
    try:
        t = html_text(http.get(t_url))
        for m in re.finditer(r"(Monthly interest rate of UK monetary financial institutions[^\n|]*?)"
                             r"\s*(?:\[[a-z]\]\s*)*\|?\s*(IUM[A-Z0-9]{4})\b", t):
            titles[m.group(2)] = re.sub(r"\s+", " ", m.group(1)).strip()
    except Denied:
        t_url = None
    rates = []
    for code, (label, ltv, yrs) in BOE_SERIES.items():
        tt = titles.get(code)
        if tt and yrs and not re.search(rf"\b{yrs} year \({ltv}% LTV\) fixed rate mortgage", tt):
            raise SystemExit(f"BoE series {code} title does not match {label!r}: {tt!r}")
        rates.append({"label": label, "ltv": ltv, "fixed_years": yrs, "rate": data[code][as_of],
                      "series": code, "g13_row": g13[code], "series_title": tt})
    months = sorted(set().union(*(set(v) for v in data.values())))
    hist = [{"month": d.strftime("%Y-%m"), **{c: data[c].get(d) for c in BOE_SERIES}} for d in months]
    log("BoE quoted rates %s: %s" % (as_of, {r["series"]: r["rate"] for r in rates}))
    return {
        "source": "Bank of England, Bankstats table G1.3 'Average quoted household interest rates' "
                  "(Interactive Statistical Database, monthly)",
        "source_url": BOE_CSV.format(y=since_year, codes=",".join(BOE_SERIES)),
        "series_urls": used,
        "series_titles_url": t_url,
        "table_url": BOE_TABLE,
        "checked": max((http.fetched_on.get(u) for u in used.values() if u in http.fetched_on),
                       default=dt.date.today().isoformat()),
        "as_of": as_of.isoformat(),
        "month": as_of.strftime("%Y-%m"),
        "rate_unit": "percent per annum",
        "rates": rates,
        "unavailable": [{"series": c, "label": l, "reason": "IADB export answered 'Access denied' "
                         "(2026-10-18); not retried"} for c, l in BOE_DENIED.items()],
        "history": hist,
        "notes": ("Monthly averages of advertised ('quoted') rates on new owner-occupier mortgages, "
                  "weighted by lender business volumes; not seasonally adjusted; exclude product "
                  "fees. The Bank publishes no 5-year 90% LTV series - the 5-year series are 75% "
                  "(IUMBV42) and 95% (IUM5WTL); for a 5-year fix at 90% LTV use a value between "
                  "them (closer to 95%). Use as indicative rates, not offers."),
    }


# --------------------------------------------------------------------------- 4. shared ownership
def build_shared_ownership(http):
    doc = http.json(API + P_SO)
    parts = govuk_parts(doc)
    txt = html_text(" ".join(parts.values()))
    m = need(r"buy a share between (\d+)% and (\d+)% of the home", txt, "share range")
    lo, hi = int(m.group(1)) / 100, int(m.group(2)) / 100
    m = need(r"share you can buy is usually between (\d+)% and (\d+)%", txt, "usual share range")
    usual = [int(m.group(1)) / 100, int(m.group(2)) / 100]
    m = need(r"new-build shared ownership home, the rent limit is (\d+(?:\.\d+)?)% of the value of "
             r"the share the landlord owns\. Most landlords charge (\d+(?:\.\d+)?)%", txt, "rent limit")
    cap, typical = float(m.group(1)) / 100, float(m.group(2)) / 100
    m = need(r"income is (£[\d,]+) a year or less \((£[\d,]+) a year or less in London\)", txt, "income cap")
    inc, inc_ldn = money(m.group(1)), money(m.group(2))
    m = need(r"deposit, usually between (\d+)% and (\d+)% of the share", txt, "deposit")
    dep = [int(m.group(1)) / 100, int(m.group(2)) / 100]
    one_pct_years = int(need(r"shares of 1% each year for the first (\d+) years", txt, "1% staircasing").group(1))
    if abs(GLA_MANUAL["shared_ownership_rent_cap"] - typical) > 1e-9:
        LOG.append("WARN GOV.UK typical rent differs from the GLA London cap")
    src = GOVUK + P_SO
    log(f"Shared ownership: share {lo:.0%}-{hi:.0%}, rent cap {cap:.2%} (typical {typical:.2%}), "
        f"London income cap {inc_ldn:,}")
    return {
        "source_url": src,
        "source_updated_at": doc.get("updated_at"),
        "checked": http.fetched_on.get(API + P_SO),
        "rate_unit": "fraction",
        "min_initial_share": lo,
        "max_initial_share": hi,
        "usual_initial_share": usual,
        "rent_rate_on_unsold": GLA_MANUAL["shared_ownership_rent_cap"],
        "rent_cap_national": cap,
        "rent_typical_national": typical,
        "deposit_of_share": dep,
        "household_income_cap": inc,
        "household_income_cap_london": inc_ldn,
        "staircasing": {
            "min_tranche": 0.10, "min_tranche_newer_leases": 0.05,
            "one_percent_annual_years": one_pct_years,
            "max_share": 1.0,
            "notes": "Shares of 10% or more at any time (some newer leases 5%, some older 25%), "
                     "priced at a RICS valuation at the time; homes bought from 1 April 2021 may "
                     "allow 1% a year for the first 15 years at an HPI-indexed price (no admin "
                     "fee). Rent falls in proportion to the landlord's remaining share. Max 100% "
                     "(80% in designated protected areas; 75% for older-persons shared ownership).",
        },
        "rent_review": "Annual; leases from 12 Oct 2023: RPI + up to 0.5% or CPI + 1% (never falls).",
        "sdlt_note": "SDLT: either a market value election (one-off SDLT on the FULL market value, "
                     "FTB relief if that value <= GBP 500,000, nothing more on staircasing) or "
                     "staged payments (SDLT on the share price only if above the threshold, plus "
                     "rent NPV; more SDLT only once the share exceeds 80%).",
        "london": {
            "source_url": GLA_MANUAL["shared_ownership_url"],
            "checked": GLA_MANUAL["checked"],
            "fetched": GLA_MANUAL["fetched"],
            "blocked": GLA_MANUAL["blocked"],
            "rent_cap_initial": GLA_MANUAL["shared_ownership_rent_cap"],
            "notes": "Bromley is a London borough: shared ownership homes are marketed through "
                     "Homes for Londoners and providers; the GLA caps the initial rent at 2.75% "
                     "a year of the unsold share's value; household income up to GBP 90,000.",
        },
        "london_living_rent": {
            "source_url": GLA_MANUAL["llr_url"],
            "checked": GLA_MANUAL["checked"],
            "fetched": GLA_MANUAL["fetched"],
            "income_cap": GLA_MANUAL["llr_income_cap"],
            "income_cap_note": GLA_MANUAL["llr_income_cap_note"],
            "notes": "London Living Rent is an intermediate RENT product, not a sale: rents are "
                     "set from GLA ward-level benchmarks at about one third of average local "
                     "household income (adjusted by bedroom count), for working households who "
                     "rent or live with others and cannot yet buy locally; it is meant to help "
                     "them save a deposit (often to buy their home through shared ownership).",
        },
        "low_cost_rent": {
            "notes": "Low-Cost Rent (Social Rent / London Affordable Rent) homes are let by a "
                     "registered provider to households nominated from the council's housing "
                     "register (London Borough of Bromley). They are rented, not sold, so no "
                     "purchase price applies.",
        },
        "notes": ("New-model shared ownership (homes funded from April 2021): buy 10%-75% of the "
                  "full market value with a mortgage or savings and pay rent on the rest; all "
                  "shared ownership homes are leasehold (service/estate charges apply). In this "
                  "app, 'Intermediate' plots are treated as shared ownership: share price = share "
                  "x market value; annual rent = rent_rate_on_unsold x (1 - share) x market value."),
    }


# --------------------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--cache", default=DEFAULT_CACHE, help="cache root (context/ is used inside)")
    ap.add_argument("--out", default=OUT)
    ap.add_argument("--since", default="2022-01", help="first UK HPI month (YYYY-MM)")
    ap.add_argument("--date", default=dt.date.today().isoformat(), help="SDLT rates in force on")
    ap.add_argument("--boe-since", type=int, default=2024, help="first year of BoE rate history")
    ap.add_argument("--boe-csv", action="append", default=[],
                    help="IADB CSV export saved by hand; fills series the IADB refuses to serve")
    ap.add_argument("--refresh", action="store_true", help="ignore the cache and refetch")
    a = ap.parse_args()

    http = Http(os.path.join(a.cache, "context"), refresh=a.refresh)
    on = dt.date.fromisoformat(a.date)
    out = {
        "generated": dt.date.today().isoformat(),
        "ukhpi": build_ukhpi(http, a.since),
        "sdlt": build_sdlt(http, on),
        "mortgage": build_mortgage(http, a.boe_since, a.boe_csv),
        "shared_ownership": build_shared_ownership(http),
    }
    out["sdlt"]["checked"] = out["sdlt"]["checked"] or on.isoformat()
    os.makedirs(os.path.dirname(os.path.abspath(a.out)), exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    log(f"wrote {a.out} ({os.path.getsize(a.out):,} bytes)")
    for ln in LOG:
        log(ln)


if __name__ == "__main__":
    main()
