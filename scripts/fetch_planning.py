#!/usr/bin/env python3
"""Fetch the live status of planning application 26/02199/OUT (Ravensbourne Place)
from the London Borough of Bromley Public Register and record what changed.

Every run:
  * reads the application record, the full document list and the public comments
    (stance + date only - comment text is not stored) from the register's API;
  * writes the snapshot to data/planning.json;
  * compares it with the previous snapshot and prepends an entry to data/updates.json
    (status / key-date changes, new documents, new comments).

Usage:
  python3 scripts/fetch_planning.py                    # fetch + log
  python3 scripts/fetch_planning.py --note-pt "..." --note-en "..."   # add an analyst note

The register (planningaccess.bromley.gov.uk) serves an incomplete TLS chain (the
Sectigo "Public Server Authentication CA DV R36" intermediate is missing). Browsers
fetch it automatically; here it is shipped in scripts/certs/ and appended to the
normal CA bundle, so the connection is still fully verified.
"""
import argparse
import collections
import datetime as dt
import html
import json
import os
import re
import sys
import tempfile
import time
import urllib.parse

import requests

BASE = "https://planningaccess.bromley.gov.uk"
RECORD_ID = "a0lTv000003RpUXIA0"
REGISTER = "Arcus_BE_Public_Register"
REFERENCE = "26/02199/OUT"
DETAIL_URL = f"{BASE}/pr/s/detail/{RECORD_ID}?c__r={REGISTER}"
FILES_URL = DETAIL_URL + "&tabset-ff68f=3"          # the record's "Files" tab
DOWNLOAD_URL = BASE + "/sfc/servlet.shepherd/version/download/{}"
# Bromley committee papers (ModernGov). Major applications are decided by the Development Control Committee.
CDS = "https://cds.bromley.gov.uk/"
COMMITTEE_ID = 133
AGENDA_KEYWORDS = ["26/02199", "Rookery Estates", "Ravensbourne Place"]

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(ROOT, "data")
SNAPSHOT = os.path.join(DATA_DIR, "planning.json")
UPDATES = os.path.join(DATA_DIR, "updates.json")
INTERMEDIATE = os.path.join(ROOT, "scripts", "certs", "sectigo-public-server-auth-ca-dv-r36.pem")

# Field labels on the register -> keys in our snapshot
FIELD_KEYS = {
    "Application type": "type",
    "Applicant": "applicant",
    "Status": "status",
    "Agent": "agent",
    "Officer": "officer",
    "Proposal": "proposal",
    "Decision": "decision",
    "Decision date": "decision_date",
    "Decision notice sent date": "decision_notice_date",
    "Determination level": "determination_level",
    "Received date": "received_date",
    "Valid date": "valid_date",
    "Consultation Deadline": "consultation_deadline",
    "Earliest Decision Date": "earliest_decision_date",
    "Date of committee": "committee_date",
    "Scheduled Decision Date": "scheduled_decision_date",
    "Planning Portal reference": "planning_portal_ref",
    "Wards": "wards",
}
KEY_DATES = ["received_date", "valid_date", "consultation_deadline", "earliest_decision_date",
             "committee_date", "scheduled_decision_date", "decision_date", "decision_notice_date"]
TRACKED = ["status", "decision", "determination_level", "officer"] + KEY_DATES


def ca_bundle():
    """System/proxy CA bundle + the missing Sectigo intermediate, in a temp file."""
    base = os.environ.get("REQUESTS_CA_BUNDLE") or os.environ.get("SSL_CERT_FILE")
    if not base or not os.path.exists(base):
        import certifi
        base = certifi.where()
    fd, path = tempfile.mkstemp(suffix=".pem")
    with os.fdopen(fd, "w") as out:
        out.write(open(base).read())
        out.write("\n")
        out.write(open(INTERMEDIATE).read())
    return path


class Register:
    def __init__(self):
        self.s = requests.Session()
        # passed per request: a Session-level `verify` is overridden by REQUESTS_CA_BUNDLE
        self.ca = ca_bundle()
        self.s.headers["User-Agent"] = "ravensbourne-place-tracker (+https://github.com/leoolmos/bromley)"
        html = self.s.get(BASE + "/s/", timeout=60, verify=self.ca).text
        dec = urllib.parse.unquote(html)
        fwuid = re.search(r'"fwuid":"([^"]+)"', dec)
        loaded = re.search(r'"loaded":(\{"APPLICATION@markup://siteforce:communityApp":"[^"]+"\})', dec)
        if not fwuid or not loaded:
            raise RuntimeError("Could not read the Aura framework id from the register home page")
        self.context = json.dumps({
            "mode": "PROD", "fwuid": fwuid.group(1), "app": "siteforce:communityApp",
            "loaded": json.loads(loaded.group(1)), "dn": [], "globals": {}, "uad": True,
        })
        self.n = 0

    def apex(self, classname, method):
        self.n += 1
        message = {"actions": [{
            "id": f"{self.n};a",
            "descriptor": "aura://ApexActionController/ACTION$execute",
            "callingDescriptor": "UNKNOWN",
            "params": {"namespace": "arcuscommunity", "classname": classname, "method": method,
                       "params": {"recordId": RECORD_ID, "registerName": REGISTER},
                       "cacheable": False, "isContinuation": False},
        }]}
        r = self.s.post(BASE + f"/s/sfsites/aura?r={self.n}&aura.ApexAction.execute=1", data={
            "message": json.dumps(message),
            "aura.context": self.context,
            "aura.pageURI": f"/s/detail/{RECORD_ID}?c__r={REGISTER}",
            "aura.token": "null",
        }, timeout=180, verify=self.ca)
        r.raise_for_status()
        action = r.json()["actions"][0]
        if action.get("state") != "SUCCESS":
            raise RuntimeError(f"{classname}.{method}: {action.get('error')}")
        return action["returnValue"]["returnValue"]


def uk_date(v):
    """'2026-06-16 00:00:00' or '16/6/2026' -> '2026-06-16'."""
    if not v:
        return None
    iso = re.match(r"^\s*(\d{4}-\d{2}-\d{2})", str(v))
    if iso:
        return iso.group(1)
    m = re.match(r"^\s*(\d{1,2})/(\d{1,2})/(\d{4})\s*$", str(v))
    if not m:
        return str(v).strip() or None
    d, mo, y = map(int, m.groups())
    return f"{y:04d}-{mo:02d}-{d:02d}"


def parse_details(ret):
    app = {"reference": REFERENCE, "record_id": RECORD_ID, "url": DETAIL_URL, "files_url": FILES_URL}
    for section in ret.get("sections", []):
        for f in section.get("fields", []):
            key = FIELD_KEYS.get(f.get("primaryLanguageLabel") or f.get("label"))
            if not key:
                continue
            val = f.get("value")
            if isinstance(val, str):
                val = val.replace("\r\n", "\n").strip()
            if key in KEY_DATES:
                val = uk_date(val)
            if key == "wards" and isinstance(val, str):
                val = [w.strip() for w in re.split(r"[;\n]", val) if w.strip()]
            app[key] = val if val not in ("", None) else None
    return app


def parse_files(files):
    docs = []
    for f in files:
        docs.append({
            "id": f["Id"],
            "title": (f.get("Title") or "").strip(),
            "category": f.get("arcshared__Category__c") or "Other",
            "date": f.get("arcshared__Document_Date__c") or (f.get("CreatedDate") or "")[:10],
            "published": (f.get("CreatedDate") or "")[:10],
            "ext": (f.get("FileExtension") or "").lower(),
            "size": f.get("ContentSize"),
            "url": DOWNLOAD_URL.format(f["Id"]),
        })
    docs.sort(key=lambda d: (d["published"], d["date"], d["title"]), reverse=True)
    return docs


def parse_comments(comments):
    by_stance = collections.Counter()
    by_month = collections.defaultdict(collections.Counter)
    by_day = collections.Counter()
    for c in comments:
        stance = c.get("arcshared__Stance__c") or "Neutral"
        day = (c.get("CreatedDate") or "")[:10]
        by_stance[stance] += 1
        by_month[day[:7]][stance] += 1
        by_day[day] += 1
    last = max(by_day) if by_day else None
    return {
        "total": len(comments),
        "by_stance": dict(by_stance.most_common()),
        "by_month": {m: dict(v) for m, v in sorted(by_month.items())},
        "last_comment_date": last,
        "last_7_days": sum(n for d, n in by_day.items() if last and d > (dt.date.fromisoformat(last) - dt.timedelta(days=7)).isoformat()),
    }


def fetch():
    reg = Register()
    app = parse_details(reg.apex("PublicRegisterViewService", "getRecordDetails"))
    try:
        appeals = reg.apex("PublicRegisterViewService", "getRelatedListView")
        app["appeals"] = sum(len(x.get("tiles") or []) for x in appeals if x.get("title") == "Appeals")
    except Exception:  # appeals list is informative only
        app["appeals"] = None
    docs = parse_files(reg.apex("PR_FilesListCont", "getFiles"))
    comments = parse_comments(reg.apex("PR_CommentService", "getComments"))
    try:
        app["open_for_comments"] = bool(reg.apex("PR_CommentService", "getCommentingState").get("allowComments"))
    except Exception:
        app["open_for_comments"] = None
    try:
        meetings = committee_meetings()
    except Exception as e:  # committee site is a secondary source
        print("committee calendar unavailable:", e)
        meetings = None
    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()
    return {"fetched_at": now, "source": DETAIL_URL, "application": app,
            "documents": docs, "comments": comments,
            "committee": {"name": "Development Control Committee",
                          "url": CDS + f"ieListMeetings.aspx?CommitteeId={COMMITTEE_ID}", "meetings": meetings}}


def committee_meetings():
    """Upcoming Development Control Committee meetings and whether their agenda mentions the application."""
    s = requests.Session()
    s.headers["User-Agent"] = "ravensbourne-place-tracker (+https://github.com/leoolmos/bromley)"

    def get(url):   # the site sometimes drops a connection: two more tries, a little apart (never on 4xx/5xx)
        for i in range(3):
            try:
                r = s.get(url, timeout=60)
                r.raise_for_status()
                return r.text
            except requests.ConnectionError:
                if i == 2:
                    raise
                time.sleep(15 * (i + 1))

    page = get(CDS + f"ieListMeetings.aspx?CommitteeId={COMMITTEE_ID}")
    today = dt.date.today()
    out = []
    for href, label in re.findall(r'<a[^>]+href="([^"]*MId=\d+[^"]*)"[^>]*>(.*?)</a>', page, re.S):
        label = html.unescape(re.sub(r"<[^>]+>", "", label)).strip()
        m = re.match(r"(\d{1,2} \w{3} \d{4})\s*(.*)", label)
        if not m:
            continue
        day = dt.datetime.strptime(m.group(1), "%d %b %Y").date()
        if day < today - dt.timedelta(days=45):
            continue
        url = CDS + html.unescape(href)
        agenda = html.unescape(re.sub(r"<[^>]+>", " ", get(url)))
        out.append({
            "date": day.isoformat(), "time": m.group(2) or None, "url": url,
            "agenda_published": bool(re.search(r"Agenda (frontsheet|reports pack)|Public reports pack", agenda)),
            "mentions_application": any(k.lower() in agenda.lower() for k in AGENDA_KEYWORDS),
        })
    return sorted(out, key=lambda x: x["date"])


def fmt_pt(d):
    return dt.date.fromisoformat(d).strftime("%d/%m/%Y") if d and re.match(r"\d{4}-\d\d-\d\d$", d) else (d or "—")


def fmt_en(d):
    return dt.date.fromisoformat(d).strftime("%-d %b %Y") if d and re.match(r"\d{4}-\d\d-\d\d$", d) else (d or "—")


LABELS = {
    "status": ("Status", "Status"), "decision": ("Decisão", "Decision"),
    "determination_level": ("Nível de decisão", "Determination level"), "officer": ("Técnico responsável", "Case officer"),
    "received_date": ("Recebido", "Received"), "valid_date": ("Validado", "Valid"),
    "consultation_deadline": ("Fim da consulta pública", "Consultation deadline"),
    "earliest_decision_date": ("Data mais cedo para decisão", "Earliest decision date"),
    "committee_date": ("Data do comitê", "Committee date"),
    "scheduled_decision_date": ("Decisão agendada", "Scheduled decision date"),
    "decision_date": ("Data da decisão", "Decision date"), "decision_notice_date": ("Notificação da decisão", "Decision notice sent"),
}


def diff(prev, cur):
    a0, a1 = (prev or {}).get("application", {}), cur["application"]
    fields = []
    for k in TRACKED:
        if prev is not None and a0.get(k) != a1.get(k):
            fields.append({"field": k, "label_pt": LABELS[k][0], "label_en": LABELS[k][1],
                           "from": a0.get(k), "to": a1.get(k)})
    old_ids = {d["id"] for d in (prev or {}).get("documents", [])}
    new_docs = [d for d in cur["documents"] if d["id"] not in old_ids] if prev is not None else []
    cur_ids = {d["id"] for d in cur["documents"]}
    removed = [d["title"] for d in (prev or {}).get("documents", []) if d["id"] not in cur_ids]
    c0 = (prev or {}).get("comments", {})
    c1 = cur["comments"]
    stance_delta = {s: c1["by_stance"].get(s, 0) - c0.get("by_stance", {}).get(s, 0)
                    for s in set(c1["by_stance"]) | set(c0.get("by_stance", {}))} if prev is not None else {}
    def on_agenda(snap):
        meetings = ((snap or {}).get("committee") or {}).get("meetings") or []
        return {m["date"] for m in meetings if m.get("mentions_application")}
    agenda_new = sorted(on_agenda(cur) - on_agenda(prev))
    return {
        "fields": fields,
        "agenda_new": agenda_new,
        "new_documents": [{k: d[k] for k in ("id", "title", "category", "date", "published", "ext", "size", "url")} for d in new_docs],
        "removed_documents": removed,
        "comments_total": c1["total"],
        "comments_delta": (c1["total"] - c0.get("total", 0)) if prev is not None else None,
        "stance_delta": {k: v for k, v in stance_delta.items() if v},
    }


def summarise(cur, ch, first):
    a = cur["application"]
    decided = bool(a.get("decision"))
    pt, en = [], []
    if first:
        pt.append(f"Primeiro registro do monitoramento: {len(cur['documents'])} documentos e {cur['comments']['total']} comentários públicos no registro.")
        en.append(f"First tracked snapshot: {len(cur['documents'])} documents and {cur['comments']['total']} public comments on the register.")
    for f in ch["fields"]:
        fr_pt, to_pt = (fmt_pt(f["from"]), fmt_pt(f["to"])) if f["field"] in KEY_DATES else (f["from"] or "—", f["to"] or "—")
        fr_en, to_en = (fmt_en(f["from"]), fmt_en(f["to"])) if f["field"] in KEY_DATES else (f["from"] or "—", f["to"] or "—")
        pt.append(f"{f['label_pt']}: {fr_pt} → {to_pt}.")
        en.append(f"{f['label_en']}: {fr_en} → {to_en}.")
    if not first:
        n = len(ch["new_documents"])
        pt.append(f"{n} documento(s) novo(s)." if n else "Nenhum documento novo.")
        en.append(f"{n} new document(s)." if n else "No new documents.")
        if ch["comments_delta"]:
            pt.append(f"+{ch['comments_delta']} comentário(s) públicos (total {ch['comments_total']}).")
            en.append(f"+{ch['comments_delta']} public comment(s) (total {ch['comments_total']}).")
    for day in ch.get("agenda_new", []):
        pt.append(f"O pedido aparece na pauta do Development Control Committee de {fmt_pt(day)}.")
        en.append(f"The application is on the Development Control Committee agenda for {fmt_en(day)}.")
    if decided:
        pt.append(f"DECISÃO: {a['decision']} em {fmt_pt(a.get('decision_date'))}.")
        en.append(f"DECISION: {a['decision']} on {fmt_en(a.get('decision_date'))}.")
    elif a.get("committee_date"):
        pt.append(f"Comitê de planejamento marcado para {fmt_pt(a['committee_date'])}.")
        en.append(f"Planning committee scheduled for {fmt_en(a['committee_date'])}.")
    else:
        pt.append("Ainda sem decisão e sem data de comitê publicada no registro.")
        en.append("Not yet decided; no committee date published on the register.")
    return " ".join(pt), " ".join(en)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--note-pt", help="analyst note (Portuguese) attached to this fetch")
    ap.add_argument("--note-en", help="analyst note (English) attached to this fetch")
    ap.add_argument("--always-log", action="store_true", help="log an entry even if nothing changed")
    args = ap.parse_args()

    prev = json.load(open(SNAPSHOT)) if os.path.exists(SNAPSHOT) else None
    cur = fetch()
    cm, pm = cur["committee"], (prev or {}).get("committee") or {}
    if cm["meetings"] is None and pm.get("meetings"):
        # committee site unreachable this time: keep the last list (and when it was read) instead of blanking it
        cm["meetings"] = pm["meetings"]
        cm["meetings_checked"] = pm.get("meetings_checked") or prev.get("fetched_at")
    elif cm["meetings"] is not None:
        cm["meetings_checked"] = cur["fetched_at"]
    ch = diff(prev, cur)
    updates = json.load(open(UPDATES)) if os.path.exists(UPDATES) else []
    changed = (prev is None or ch["fields"] or ch["agenda_new"] or ch["new_documents"]
               or ch["removed_documents"] or ch["comments_delta"])
    if changed or args.always_log or args.note_pt or args.note_en:
        s_pt, s_en = summarise(cur, ch, prev is None)
        a = cur["application"]
        entry = {
            "fetched_at": cur["fetched_at"],
            "summary_pt": s_pt, "summary_en": s_en,
            "status": a.get("status"), "decision": a.get("decision"),
            "key_dates": {k: a.get(k) for k in KEY_DATES},
            "changes": ch,
        }
        if args.note_pt:
            entry["note_pt"] = args.note_pt
        if args.note_en:
            entry["note_en"] = args.note_en
        updates.insert(0, entry)
    os.makedirs(DATA_DIR, exist_ok=True)
    with open(SNAPSHOT, "w") as f:
        json.dump(cur, f, ensure_ascii=False, indent=1)
    with open(UPDATES, "w") as f:
        json.dump(updates, f, ensure_ascii=False, indent=1)
    a = cur["application"]
    print(f"{REFERENCE}: status={a.get('status')} decision={a.get('decision')} committee={a.get('committee_date')} "
          f"docs={len(cur['documents'])} (+{len(ch['new_documents'])}) comments={cur['comments']['total']} "
          f"logged={'yes' if updates and updates[0]['fetched_at'] == cur['fetched_at'] else 'no'}")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as f:
            f.write(f"changed={'true' if changed else 'false'}\n")


if __name__ == "__main__":
    sys.exit(main())
