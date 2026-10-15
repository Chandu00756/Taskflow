#!/usr/bin/env python3
"""Seed a demo organization with realistic service desk data.

Usage:
    python3 scripts/seed_demo.py [--base http://localhost:8080]

Creates (or reuses) the "Globex Demo" organization and fills it with agents,
requesters, departments, tickets in every state, a problem, a change, assets
and a knowledge base article. Intended for local development and demos only;
the credentials below are demo values and must never be used in production.
"""
import argparse
import json
import sys
import urllib.error
import urllib.request

BASE = "http://localhost:8080"
DOMAIN = "globex.test"
ADMIN = ("admin@globex.test", "Globex@Admin2026")
AGENT = ("sam.agent@globex.test", "Globex@Agent2026")
REQUESTER = ("rita.requester@globex.test", "Globex@User2026")


def call(method, path, token=None, body=None, ok=(200, 201)):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode() if body is not None else None, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        payload = e.read()
        try:
            data = json.loads(payload)
        except ValueError:
            data = payload.decode(errors="replace")
        if e.code not in ok:
            return e.code, data
        return e.code, data


def login(email, password):
    s, r = call("POST", "/api/v1/auth/login", body={"email": email, "password": password})
    return r.get("access_token") if s == 200 else None


def ensure_person(admin, kind, email, name, password, extra):
    """Create a person if missing and give them a known demo password."""
    s, r = call("POST", f"/api/v2/{kind}", admin, {"email": email, "name": name, **extra})
    if s == 201 and r.get("temporary_password"):
        tok = login(email, r["temporary_password"])
        call("POST", "/api/v2/me/password", tok, {"current_password": r["temporary_password"], "new_password": password})
        return r["person"]["id"]
    s, people = call("GET", f"/api/v2/{kind}?q={email}&state=all", admin)
    return people["items"][0]["id"] if s == 200 and people["items"] else None


def main():
    global BASE
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=BASE)
    BASE = ap.parse_args().base.rstrip("/")

    admin = login(*ADMIN)
    if not admin:
        s, r = call("POST", "/api/v1/organizations/register", body={
            "org_name": "Globex Demo", "description": "Demo organization", "admin_email": ADMIN[0],
            "admin_password": ADMIN[1], "admin_full_name": "Grace Admin"})
        if s != 200:
            sys.exit(f"could not register demo org: {s} {r}")
        admin = login(*ADMIN)
    print("admin signed in")

    _, roles = call("GET", "/api/v2/roles", admin)
    rid = {r["name"]: r["id"] for r in roles["items"]}
    _, groups = call("GET", "/api/v2/groups", admin)
    gid = {g["name"]: g["id"] for g in groups["items"]}

    _, depts = call("GET", "/api/v2/departments", admin)
    dept = {d["name"]: d["id"] for d in depts["items"]}
    for name in ("Finance", "Engineering", "Sales"):
        if name not in dept:
            _, d = call("POST", "/api/v2/departments", admin, {"name": name})
            dept[name] = d["id"]
    _, locs = call("GET", "/api/v2/locations", admin)
    loc = locs["items"][0]["id"] if locs["items"] else call("POST", "/api/v2/locations", admin, {"name": "New York HQ", "city": "New York", "country": "USA"})[1]["id"]

    _, me = call("GET", "/api/v2/me", admin)
    admin_id = me["user"]["id"]
    agent_id = ensure_person(admin, "agents", AGENT[0], "Sam Agent", AGENT[1], {
        "role_ids": [rid["SD Agent"], rid["Change Manager"], rid["Asset Manager"]], "group_ids": [gid["Service Desk"], gid["Network Team"]], "job_title": "Service Desk Engineer"})
    ensure_person(admin, "agents", "priya.network@globex.test", "Priya Network", AGENT[1], {
        "role_ids": [rid["SD Agent"]], "group_ids": [gid["Network Team"]], "job_title": "Network Engineer"})
    req_id = ensure_person(admin, "requesters", REQUESTER[0], "Rita Requester", REQUESTER[1], {
        "department_id": dept["Finance"], "location_id": loc, "reporting_manager_id": admin_id, "job_title": "Financial Analyst"})
    others = [ensure_person(admin, "requesters", f"{n.lower().replace(' ', '.')}@{DOMAIN}", n, REQUESTER[1], {"department_id": dept[d]})
              for n, d in (("Omar Hassan", "Engineering"), ("Lena Fischer", "Sales"), ("Kenji Sato", "Engineering"))]
    print("people ready")

    _, existing = call("GET", "/api/v2/tickets?view=all&per_page=1", admin)
    if existing["total"] < 5:
        tickets = [
            ("VPN disconnects every 10 minutes", "Since this morning the VPN drops every few minutes. Error 809.", 3, req_id, "Network", "VPN"),
            ("Laptop battery swelling", "The trackpad is lifting and the laptop gets hot.", 4, others[0], "Hardware", "Laptop"),
            ("Cannot access shared finance drive", "Getting *Access denied* on \\\\fs01\\finance.", 2, req_id, "Access", "Permissions"),
            ("Outlook keeps asking for password", "Prompts appear every hour on desktop Outlook.", 2, others[1], "Email & Collaboration", "Mailbox"),
            ("Printer on floor 3 jams constantly", "Paper jams on every print job.", 1, others[2], "Hardware", "Printer"),
            ("Request: new monitor for home office", "Would like a second monitor.", 1, others[0], "Hardware", "Monitor"),
        ]
        ids = []
        for subj, desc, prio, requester, cat, sub in tickets:
            _, t = call("POST", "/api/v2/tickets", admin, {"subject": subj, "description": desc, "priority": prio, "requester_id": requester,
                                                          "source": "portal", "category": cat, "sub_category": sub})
            ids.append(t["id"])
        call("PUT", f"/api/v2/tickets/{ids[0]}", admin, {"responder_id": agent_id})
        call("POST", f"/api/v2/tickets/{ids[0]}/reply", admin, {"body": "Hi Rita, we are looking at the VPN concentrator logs now.", "status": "pending"})
        call("PUT", f"/api/v2/tickets/{ids[1]}", admin, {"responder_id": agent_id, "group_id": gid["Hardware Team"]})
        call("POST", f"/api/v2/tickets/{ids[1]}/notes", admin, {"body": "Swollen batteries are a safety risk — replace today."})
        call("PUT", f"/api/v2/tickets/{ids[2]}", admin, {"responder_id": agent_id, "status": "resolved"})
        call("PUT", f"/api/v2/tickets/{ids[4]}", admin, {"status": "closed"})
        rtok = login(*REQUESTER)
        if rtok:
            call("POST", f"/api/v2/tickets/{ids[2]}/rating", rtok, {"rating": 5, "feedback": "Fixed within the hour, thanks!"})
            _, cat = call("GET", "/api/v2/catalog", rtok)
            vpn = next((i for i in cat["items"] if i["name"] == "VPN access"), None)
            if vpn:
                call("POST", f"/api/v2/catalog/items/{vpn['id']}/request", rtok, {"fields": {"duration": "3 months"}})
        call("POST", "/api/v2/problems", admin, {"ticket_ids": [ids[0]], "agent_id": agent_id})
        call("POST", "/api/v2/changes", admin, {"subject": "Upgrade VPN concentrator firmware", "change_type": "standard", "risk": 2,
                                              "planned_start": "2026-11-02T22:00:00Z", "planned_end": "2026-11-03T01:00:00Z",
                                              "rollout_plan": "Upgrade secondary, fail over, upgrade primary.", "backout_plan": "Roll back to previous firmware image.",
                                              "ticket_ids": [ids[0]]})
        _, types = call("GET", "/api/v2/asset-types", admin)
        tid = {t["name"]: t["id"] for t in types["items"]}
        call("POST", "/api/v2/assets", admin, {"name": "MacBook Pro 14 (Rita)", "asset_type_id": tid["Laptop"], "serial_number": "C02DEMO01", "user_id": req_id,
                                             "cost": 2399, "warranty_expiry": "2027-08-01", "type_fields": {"memory_gb": 32, "os": "macOS 15"}})
        call("POST", "/api/v2/assets", admin, {"name": "vpn-gw-01", "asset_type_id": tid["Server"], "impact": "high", "state": "in_use", "location_id": loc})
        _, tree = call("GET", "/api/v2/solutions", admin)
        folder = tree["items"][0]["folders"][1]["id"]
        call("POST", "/api/v2/solutions/articles", admin, {"folder_id": folder, "title": "Fixing frequent VPN disconnects", "status": "published", "tags": ["vpn"],
                                                         "body": "## Symptoms\nThe VPN drops every few minutes.\n\n## Fix\n1. Update the VPN client.\n2. Disable Wi-Fi power saving.\n3. Reconnect."})
        print("tickets, problem, change, assets and article created")
    print(f"\nDemo ready at {BASE}. Sign-in accounts are defined at the top of this script.")


if __name__ == "__main__":
    main()
