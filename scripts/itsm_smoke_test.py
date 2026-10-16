#!/usr/bin/env python3
"""End-to-end smoke test for the TaskFlow service desk.

Exercises account management, tickets, SLAs, workflows, approvals, the
service catalog, knowledge base, problem/change/release management, assets,
reporting and the security boundaries between tenants and roles.

Usage:
    python3 scripts/itsm_smoke_test.py [--base http://localhost:8080] [--mail-dir DIR]

When the server sends email, pass --mail-dir pointing at a local catch-all
SMTP server's output (one .eml file per message) so the test can follow
verification and reset links; or set SMOKE_SUPER_EMAIL/SMOKE_SUPER_PASSWORD
so new accounts can be verified through the platform console.

The script registers a brand-new organization each run, so it is safe to run
repeatedly against a development or staging environment. It never touches
existing organizations.
"""
import argparse
import email
import email.header
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE = "http://localhost:8080"
SSL_CONTEXT = None
MAIL_DIR = None
FAILURES = []
PASSES = 0


def call(method, path, token=None, body=None, headers=None, expect=None, raw=False):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    for attempt in range(6):
        try:
            with urllib.request.urlopen(req, timeout=30, context=SSL_CONTEXT) as resp:
                status, payload = resp.status, resp.read()
        except urllib.error.HTTPError as e:
            status, payload = e.code, e.read()
        # The gateway rate-limits per client IP; back off instead of failing.
        if status != 429:
            break
        time.sleep(0.5 * (attempt + 1))
    if raw:
        result = payload
    else:
        try:
            result = json.loads(payload) if payload else None
        except ValueError:
            result = payload.decode(errors="replace")
    if expect is not None:
        ok = status in expect if isinstance(expect, (list, tuple, set)) else status == expect
        check(ok, f"{method} {path} -> {status} (expected {expect}) {str(result)[:300]}")
    return status, result


def upload(token, name, data, ctype):
    """Uploads a file with multipart/form-data and returns the pending attachment."""
    boundary = "smoke" + uuid.uuid4().hex
    body = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: {ctype}\r\n\r\n").encode() + data + f"\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(BASE + "/api/v2/attachments", data=body, method="POST")
    req.add_header("Content-Type", "multipart/form-data; boundary=" + boundary)
    req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=30, context=SSL_CONTEXT) as resp:
        return json.loads(resp.read())


# A 1x1 PNG.
PNG = bytes.fromhex("89504e470d0a1a0a0000000d4948445200000001000000010806000000"
                    "1f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082")


def check(cond, label):
    global PASSES
    if cond:
        PASSES += 1
    else:
        FAILURES.append(label)
        print("  FAIL:", label)


def section(name):
    print(f"\n== {name}")


def login(email, password):
    status, res = call("POST", "/api/v1/auth/login", body={"email": email, "password": password})
    if status != 200:
        raise SystemExit(f"login failed for {email}: {status} {res}")
    return res["access_token"], res["refresh_token"]


def mails_to(addr, subject_part=None):
    """Messages in --mail-dir addressed to addr, oldest first, as (subject, body)."""
    out = []
    if not MAIL_DIR or not os.path.isdir(MAIL_DIR):
        return out
    for name in sorted(os.listdir(MAIL_DIR)):
        with open(os.path.join(MAIL_DIR, name), "rb") as fh:
            msg = email.message_from_bytes(fh.read())
        to = (msg.get("X-Envelope-To", "") + " " + str(msg.get("To", ""))).lower()
        subject = str(email.header.make_header(email.header.decode_header(msg.get("Subject", ""))))
        if addr.lower() in to and (subject_part is None or subject_part.lower() in subject.lower()):
            out.append((subject, mail_text(msg)))
    return out


def mail_part(msg, ctype):
    """Decoded body of the first part with this content type (whole body for single-part mail)."""
    for part in msg.walk():
        if part.get_content_type() == ctype and not part.is_multipart():
            return part.get_payload(decode=True).decode(part.get_content_charset() or "utf-8", "replace")
    return ""


def mail_text(msg):
    return mail_part(msg, "text/plain")


def mail_html(addr, subject_part):
    """HTML part of the newest matching message in --mail-dir."""
    found = ""
    if not MAIL_DIR or not os.path.isdir(MAIL_DIR):
        return found
    for name in sorted(os.listdir(MAIL_DIR)):
        with open(os.path.join(MAIL_DIR, name), "rb") as fh:
            msg = email.message_from_bytes(fh.read())
        to = (msg.get("X-Envelope-To", "") + " " + str(msg.get("To", ""))).lower()
        subject = str(email.header.make_header(email.header.decode_header(msg.get("Subject", ""))))
        if addr.lower() in to and subject_part.lower() in subject.lower():
            found = mail_part(msg, "text/html")
    return found


def wait_mail(addr, subject_part, count_before=0, timeout=30):
    deadline = time.time() + timeout
    while time.time() < deadline:
        found = mails_to(addr, subject_part)
        if len(found) > count_before:
            return found[-1]
        time.sleep(0.5)
    return None


def link_token(body, path):
    m = re.search(re.escape(path) + r"\?token=([A-Za-z0-9_%-]+)", body or "")
    return urllib.parse.unquote(m.group(1)) if m else None


def accept_invitation(res, addr):
    """Email off: the admin was given a temporary password. Email on: follow the
    activation link the way the invited person would and choose a password."""
    if "temporary_password" in res:
        return res
    check(res.get("invitation_sent") is True, f"{addr} is invited by email")
    if not MAIL_DIR:
        raise SystemExit("invitations are emailed on this server: pass --mail-dir to follow them")
    mail = wait_mail(addr, "invited")
    check(mail is not None, f"invitation email delivered to {addr}")
    token = link_token(mail[1] if mail else "", "/activate")
    check(token is not None, "invitation email contains an activation link")
    status, _ = call("POST", "/api/v1/auth/login", body={"email": addr, "password": "Guess@12345"})
    check(status == 401, f"an invited person cannot sign in before activating (got {status})")
    _, info = call("POST", "/api/v2/auth/activate/check", body={"token": token}, expect=200)
    check(info.get("email") == addr, "activation link identifies the invited person")
    call("POST", "/api/v2/auth/activate", body={"token": token, "new_password": "short"}, expect=422)
    pw = "Act1v@te-" + uuid.uuid4().hex[:6]
    call("POST", "/api/v2/auth/activate", body={"token": token, "new_password": pw}, expect=200)
    call("POST", "/api/v2/auth/activate", body={"token": token, "new_password": pw}, expect=400)
    res["temporary_password"] = pw
    return res


def verify_new_account(addr, password, super_token):
    """Confirms a self-service sign-up the way its owner would."""
    status, res = call("POST", "/api/v1/auth/login", body={"email": addr, "password": password})
    check(status == 400 and "verify your email" in str(res).lower(), f"unverified account cannot sign in yet (got {status})")
    status, _ = call("POST", "/api/v1/auth/login", body={"email": addr, "password": password + "x"})
    check(status == 401, f"a wrong password does not reveal the verification state (got {status})")
    call("POST", "/api/v2/auth/verify-email", body={"token": "not-a-real-token"}, expect=400)
    _, sent = call("POST", "/api/v2/auth/verify-email/send", body={"email": addr}, expect=200)
    _, other = call("POST", "/api/v2/auth/verify-email/send", body={"email": "nobody-" + addr}, expect=200)
    check(sent["message"] == other["message"], "resend does not reveal whether an account exists")
    if MAIL_DIR:
        mail = wait_mail(addr, "Verify your email")
        check(mail is not None, "verification email delivered")
        token = link_token(mail[1] if mail else "", "/verify-email")
        check(token is not None, "verification email contains the link")
        html = mail_html(addr, "Verify your email")
        check("<!DOCTYPE html>" in html and "Verify my email" in html and "/verify-email?token=" in html, "verification email has a branded HTML version with a button")
        _, res = call("POST", "/api/v2/auth/verify-email", body={"token": token}, expect=200)
        check(res and res.get("email") == addr, "verification link confirms the address")
        _, res = call("POST", "/api/v2/auth/verify-email", body={"token": token}, expect=200)
        check("already" in str(res).lower(), "opening the link again says the address is already verified")
    elif super_token:
        _, users = call("GET", "/api/v2/platform/users?q=" + urllib.parse.quote(addr), super_token, expect=200)
        u = next((u for u in users["items"] if u["email"] == addr), None)
        check(u is not None and u["status"] == "unverified", "platform shows the new account as unverified")
        call("POST", f"/api/v2/platform/users/{u['id']}/verify-email", super_token, expect=200)
    else:
        raise SystemExit("email verification is on: pass --mail-dir, or set SMOKE_SUPER_EMAIL/SMOKE_SUPER_PASSWORD")


def main():
    global BASE, SSL_CONTEXT, MAIL_DIR
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", default=BASE)
    ap.add_argument("--insecure", action="store_true", help="accept self-signed HTTPS certificates (local trial runs)")
    ap.add_argument("--mail-dir", default=os.environ.get("SMOKE_MAIL_DIR"), help="folder where a catch-all SMTP server writes .eml files")
    args = ap.parse_args()
    BASE = args.base.rstrip("/")
    MAIL_DIR = args.mail_dir
    if args.insecure:
        SSL_CONTEXT = ssl._create_unverified_context()
    suffix = uuid.uuid4().hex[:8]
    domain = f"acme{suffix}.test"
    admin_email = f"admin@{domain}"
    admin_pw = "Admin@12345"

    section("Gateway hardening")
    call("GET", "/health", expect=200)
    status, _ = call("GET", "/api/v1/admin/users", headers={"X-Role": "super_admin"})
    check(status in (401, 403), f"forged X-Role header must not grant admin access (got {status})")
    status, _ = call("GET", "/api/v1/admin/users", headers={"Grpc-Metadata-Role": "super_admin", "X-User-Id": str(uuid.uuid4())})
    check(status in (401, 403), f"forged gRPC metadata must not grant admin access (got {status})")
    call("GET", "/api/v2/me", expect=401)
    _, auth_cfg = call("GET", "/api/v2/auth/config", expect=200)
    check(isinstance(auth_cfg.get("email_enabled"), bool) and isinstance(auth_cfg.get("email_verification"), bool), "auth config reports email features")
    email_on, verify_on = auth_cfg["email_enabled"], auth_cfg["email_verification"]
    print(f"  email sending {'on' if email_on else 'off'}, sign-up verification {'on' if verify_on else 'off'}")

    super_token = os.environ.get("SMOKE_SUPER_TOKEN")
    if not super_token and os.environ.get("SMOKE_SUPER_EMAIL"):
        super_token, _ = login(os.environ["SMOKE_SUPER_EMAIL"], os.environ.get("SMOKE_SUPER_PASSWORD", ""))

    section("Organization signup and account admin")
    call("POST", "/api/v1/organizations/register", expect=200, body={
        "org_name": f"Acme {suffix}", "description": "smoke test", "admin_email": admin_email,
        "admin_password": admin_pw, "admin_full_name": "Alice Admin"})
    if verify_on:
        verify_new_account(admin_email, admin_pw, super_token)
    admin, admin_refresh = login(admin_email, admin_pw)
    _, me = call("GET", "/api/v2/me", admin, expect=200)
    check(me["is_agent"] and me["is_account_admin"], "org admin is an account admin agent")
    org_id = me["organization"]["id"]

    _, groups = call("GET", "/api/v2/groups", admin, expect=200)
    gmap = {g["name"]: g for g in groups["items"]}
    check("Network Team" in gmap and "Service Desk" in gmap, "default agent groups seeded")
    _, roles = call("GET", "/api/v2/roles", admin, expect=200)
    rmap = {r["name"]: r for r in roles["items"]}
    check({"Account Admin", "SD Agent", "Change Manager"} <= set(rmap), "default roles seeded")
    for path in ("/api/v2/sla-policies", "/api/v2/business-hours", "/api/v2/asset-types", "/api/v2/workflows", "/api/v2/email-templates"):
        _, res = call("GET", path, admin, expect=200)
        check(len(res["items"]) > 0, f"{path} seeded")

    section("Analytics on a new organization")
    # A brand-new organization has no tickets yet: every report must still
    # return lists (an empty period used to come back as null and crash the page).
    for kind in ("ticket-volume", "sla", "agent-performance", "group-performance", "csat", "assets"):
        _, rep_ = call("GET", f"/api/v2/reports/{kind}?range=30d", admin, expect=200)
        check(isinstance(rep_.get("rows"), list), f"{kind} report rows are a list on an empty organization")
        if kind == "csat":
            check(isinstance(rep_.get("distribution"), list), "csat distribution is a list on an empty organization")
    call("GET", "/api/v2/dashboard", admin, expect=200)
    check({"Release Manager", "Knowledge Manager", "Reporting Analyst"} <= set(rmap), "extra default agent roles seeded")

    section("People management")
    _, dept = call("POST", "/api/v2/departments", admin, {"name": "Finance"}, expect=201)
    _, loc = call("POST", "/api/v2/locations", admin, {"name": "HQ", "city": "Austin"}, expect=201)
    _, agent_res = call("POST", "/api/v2/agents", admin, {
        "email": f"agent@{domain}", "name": "Andy Agent", "role_ids": [rmap["SD Agent"]["id"], rmap["Change Manager"]["id"]],
        "group_ids": [gmap["Network Team"]["id"], gmap["Service Desk"]["id"]], "job_title": "Engineer"}, expect=201)
    agent_id = agent_res["person"]["id"]
    if email_on:
        check("temporary_password" not in agent_res, "no temporary password is shown when invitations are emailed")
        check(agent_res["person"].get("email_verified") is False, "an invited agent's email is unverified until they activate")
        accept_invitation(agent_res, f"agent@{domain}")
    else:
        check("temporary_password" in agent_res, "temporary password returned when SMTP is not configured")
    call("POST", "/api/v2/agents", admin, {"email": f"agent@{domain}", "name": "Dup"}, expect=422)
    call("POST", "/api/v2/agents", admin, {"email": "not-an-email", "name": "X"}, expect=422)

    _, req_res = call("POST", "/api/v2/requesters", admin, {
        "email": f"rita@{domain}", "name": "Rita Requester", "department_id": dept["id"], "location_id": loc["id"],
        "reporting_manager_id": me["user"]["id"]}, expect=201)
    requester_id = req_res["person"]["id"]
    _, other_res = call("POST", "/api/v2/requesters", admin, {"email": f"omar@{domain}", "name": "Omar Other"}, expect=201)
    accept_invitation(req_res, f"rita@{domain}")
    accept_invitation(other_res, f"omar@{domain}")

    agent_tok, _ = login(f"agent@{domain}", agent_res["temporary_password"])
    time.sleep(1.1)  # JWT iat has one-second precision
    _, ame = call("GET", "/api/v2/me", agent_tok, expect=200)
    check(ame["user"]["must_change_password"] or email_on, "new agent must change a temporary password")
    call("POST", "/api/v2/me/password", agent_tok, {"current_password": "wrong", "new_password": "Agent@12345"}, expect=422)
    call("POST", "/api/v2/me/password", agent_tok, {"current_password": agent_res["temporary_password"], "new_password": "short"}, expect=422)
    _, pw = call("POST", "/api/v2/me/password", agent_tok, {"current_password": agent_res["temporary_password"], "new_password": "Agent@12345"}, expect=200)
    status, _ = call("GET", "/api/v2/me", agent_tok)
    check(status == 401, f"old access token revoked after password change (got {status})")
    agent_tok = pw["access_token"]
    call("GET", "/api/v2/me", agent_tok, expect=200)

    req_tok, _ = login(f"rita@{domain}", req_res["temporary_password"])
    _, pw = call("POST", "/api/v2/me/password", req_tok, {"current_password": req_res["temporary_password"], "new_password": "Rita@12345"}, expect=200)
    req_tok = pw["access_token"]
    other_tok, _ = login(f"omar@{domain}", other_res["temporary_password"])

    section("Role boundaries")
    call("GET", "/api/v2/dashboard", req_tok, expect=403)
    call("GET", "/api/v2/agents", req_tok, expect=403)
    call("GET", "/api/v2/settings", agent_tok, expect=403)
    call("POST", "/api/v2/agents", agent_tok, {"email": f"x@{domain}", "name": "X"}, expect=403)
    call("GET", "/api/v2/problems", agent_tok, expect=200)
    call("POST", "/api/v2/problems", agent_tok, {"subject": "no rights"}, expect=403)

    section("Tickets, workflows and SLA")
    _, t = call("POST", "/api/v2/tickets", req_tok, {"subject": "VPN not connecting from home", "description": "Error 809",
                                                      "priority": 4, "category": "Network", "sub_category": "VPN"}, expect=201)
    tid = t["id"]
    check(t["display_id"].startswith("INC-"), "incident display id")
    check(t["group"] and t["group"]["name"] == "Network Team", "workflow routed VPN ticket to Network Team")
    check("vpn" in t["tags"], "workflow added vpn tag")
    check(t["priority"] <= 3, "requesters cannot raise urgent priority")
    check(t["due_by"] is not None, "SLA due date applied")
    call("GET", f"/api/v2/tickets/{tid}", other_tok, expect=404)
    _, lst = call("GET", "/api/v2/tickets?view=unassigned", agent_tok, expect=200)
    check(any(x["id"] == tid for x in lst["items"]), "ticket shows in unassigned view")
    _, upd = call("PUT", f"/api/v2/tickets/{tid}", agent_tok, {"responder_id": agent_id, "priority": 4, "status": "open"}, expect=200)
    check(upd["responder"]["id"] == agent_id and upd["priority"] == 4, "agent assigned and priority raised")
    check(upd["due_by"] != t["due_by"], "SLA recomputed after priority change")
    call("PUT", f"/api/v2/tickets/{tid}", agent_tok, {"responder_id": requester_id}, expect=422)
    call("POST", f"/api/v2/tickets/{tid}/notes", agent_tok, {"body": "Internal: checking VPN concentrator"}, expect=201)
    call("POST", f"/api/v2/tickets/{tid}/reply", agent_tok, {"body": "Could you restart the client?", "status": "pending"}, expect=201)
    _, tk = call("GET", f"/api/v2/tickets/{tid}", agent_tok, expect=200)
    check(tk["ticket"]["first_responded_at"] is not None and tk["ticket"]["status"] == "pending", "reply recorded first response and set pending")
    check(tk["ticket"]["sla_state"] == "paused", "SLA paused while pending")
    _, convs = call("GET", f"/api/v2/tickets/{tid}/conversations", req_tok, expect=200)
    check(all(not c["private"] for c in convs["items"]) and len(convs["items"]) == 1, "requester does not see private notes")
    call("POST", f"/api/v2/tickets/{tid}/notes", req_tok, {"body": "sneaky"}, expect=403)
    call("POST", f"/api/v2/tickets/{tid}/reply", req_tok, {"body": "Restarted, still failing"}, expect=201)
    _, tk = call("GET", f"/api/v2/tickets/{tid}", agent_tok, expect=200)
    check(tk["ticket"]["status"] == "open", "requester reply reopens pending ticket")
    _, task = call("POST", f"/api/v2/tickets/{tid}/tasks", agent_tok, {"title": "Check firewall logs", "agent_id": agent_id}, expect=201)
    call("PUT", f"/api/v2/tasks/{task['id']}", agent_tok, {"status": "completed"}, expect=200)
    call("POST", f"/api/v2/tickets/{tid}/time-entries", agent_tok, {"minutes": 45, "note": "Diagnosis"}, expect=201)
    _, te = call("GET", f"/api/v2/tickets/{tid}/time-entries", agent_tok, expect=200)
    check(te["total_minutes"] >= 45, "time entry totals")
    _, res = call("PUT", f"/api/v2/tickets/{tid}", agent_tok, {"status": "resolved"}, expect=200)
    check(res["resolved_at"] is not None, "resolved timestamp set")
    call("POST", f"/api/v2/tickets/{tid}/rating", req_tok, {"rating": 5, "feedback": "Great"}, expect=200)
    call("POST", f"/api/v2/tickets/{tid}/rating", other_tok, {"rating": 1}, expect=404)
    _, acts = call("GET", f"/api/v2/tickets/{tid}/activities", agent_tok, expect=200)
    check(len(acts["items"]) >= 5, "activity timeline recorded")
    call("PUT", f"/api/v2/tickets/{tid}", req_tok, {"status": "open"}, expect=200)

    _, t2 = call("POST", "/api/v2/tickets", agent_tok, {"subject": "Printer jam on floor 2", "email": f"newperson@{domain}", "name": "New Person",
                                                        "source": "phone", "priority": 2}, expect=201)
    _, t3 = call("POST", "/api/v2/tickets", agent_tok, {"subject": "Printer jam again", "requester_id": requester_id}, expect=201)
    call("POST", f"/api/v2/tickets/{t2['id']}/merge", agent_tok, {"ticket_ids": [t3["id"]]}, expect=200)
    _, merged = call("GET", f"/api/v2/tickets/{t3['id']}", agent_tok, expect=200)
    check(merged["ticket"]["status"] == "closed" and merged["ticket"]["merged_into_id"] == t2["id"], "merge closes secondary ticket")
    _, bulk = call("POST", "/api/v2/tickets/bulk", agent_tok, {"ids": [t2["id"]], "action": "update", "properties": {"priority": 3}}, expect=200)
    check(bulk["updated"] == 1, "bulk update")
    call("POST", "/api/v2/tickets/bulk", agent_tok, {"ids": [t2["id"]], "action": "delete"}, expect=403)
    call("DELETE", f"/api/v2/tickets/{t2['id']}", admin, expect=200)
    _, trash = call("GET", "/api/v2/tickets?view=trash", admin, expect=200)
    check(any(x["id"] == t2["id"] for x in trash["items"]), "deleted ticket in trash")
    call("POST", f"/api/v2/tickets/{t2['id']}/restore", admin, expect=200)
    status, csv_body = call("GET", "/api/v2/tickets/export", admin, raw=True)
    check(status == 200 and csv_body.startswith(b"ID,Subject"), "ticket CSV export")

    section("Service catalog and approvals")
    _, cat = call("GET", "/api/v2/catalog", req_tok, expect=200)
    vpn = next(i for i in cat["items"] if i["name"] == "VPN access")
    call("POST", f"/api/v2/catalog/items/{vpn['id']}/request", req_tok, {"fields": {}}, expect=422)
    _, sr = call("POST", f"/api/v2/catalog/items/{vpn['id']}/request", req_tok, {"fields": {"duration": "3 months"}}, expect=201)
    check(sr["display_id"].startswith("SR-") and sr["type"] == "service_request", "service request created")
    _, apps = call("GET", "/api/v2/approvals?status=requested", admin, expect=200)
    ap = next((a for a in apps["items"] if a["entity_id"] == sr["id"]), None)
    check(ap is not None, "reporting manager received approval request")
    if ap:
        call("PUT", f"/api/v2/approvals/{ap['id']}", agent_tok, {"status": "approved"}, expect=403)
        call("PUT", f"/api/v2/approvals/{ap['id']}", admin, {"status": "approved", "remark": "ok"}, expect=200)
        call("PUT", f"/api/v2/approvals/{ap['id']}", admin, {"status": "approved"}, expect=409)
        _, srd = call("GET", f"/api/v2/tickets/{sr['id']}", admin, expect=200)
        check(srd["requested_items"][0]["stage"] == "in_progress", "approved request moves to fulfilment")

    section("Problem, change and release management")
    _, prb = call("POST", "/api/v2/problems", admin, {"ticket_ids": [tid], "agent_id": agent_id}, expect=201)
    check(prb["display_id"].startswith("PRB-") and prb["incident_count"] == 1, "problem created from incident")
    call("PUT", f"/api/v2/problems/{prb['id']}", admin, {"known_error": True, "root_cause": "Expired cert", "workaround": "Use web VPN"}, expect=200)
    _, chg = call("POST", "/api/v2/changes", agent_tok, {"subject": "Renew VPN certificate", "change_type": "major", "risk": 3,
                                                       "planned_start": "2030-01-10T10:00:00Z", "planned_end": "2030-01-10T12:00:00Z",
                                                       "rollout_plan": "Swap cert", "backout_plan": "Restore old cert"}, expect=201)
    call("PUT", f"/api/v2/changes/{chg['id']}", agent_tok, {"status": "pending_release"}, expect=400)
    call("POST", f"/api/v2/changes/{chg['id']}/approvals", agent_tok, {"approver_ids": [me["user"]["id"]]}, expect=200)
    _, apps = call("GET", "/api/v2/approvals?status=requested", admin, expect=200)
    cap = next(a for a in apps["items"] if a["entity_id"] == chg["id"])
    call("PUT", f"/api/v2/approvals/{cap['id']}", admin, {"status": "approved"}, expect=200)
    _, cd = call("GET", f"/api/v2/changes/{chg['id']}", agent_tok, expect=200)
    check(cd["change"]["approval_status"] == "approved" and cd["change"]["status"] == "pending_release", "CAB approval advances change")
    _, rel = call("POST", "/api/v2/releases", agent_tok, {"subject": "Q1 network release", "change_ids": [chg["id"]]}, expect=201)
    check(rel["change_count"] == 1, "change attached to release")
    call("PUT", f"/api/v2/releases/{rel['id']}", agent_tok, {"status": "completed"}, expect=400)
    _, calendar = call("GET", "/api/v2/changes/calendar?from=2030-01-01&to=2030-02-01", agent_tok, expect=200)
    check(len(calendar["changes"]) == 1, "change calendar")

    section("Assets, CMDB and procurement")
    _, types = call("GET", "/api/v2/asset-types", admin, expect=200)
    tmap = {t_["name"]: t_ for t_ in types["items"]}
    _, laptop = call("POST", "/api/v2/assets", admin, {"name": "MacBook Pro 14", "asset_type_id": tmap["Laptop"]["id"], "serial_number": "C02XYZ",
                                                        "user_id": requester_id, "cost": 2399.99, "type_fields": {"memory_gb": 32}}, expect=201)
    check(laptop["state"] == "in_use" and laptop["user"]["id"] == requester_id, "asset assignment sets in_use")
    _, server = call("POST", "/api/v2/assets", admin, {"name": "vpn-gw-01", "asset_type_id": tmap["Server"]["id"], "impact": "high"}, expect=201)
    _, svc = call("POST", "/api/v2/assets", admin, {"name": "Remote Access", "asset_type_id": tmap["IT Service"]["id"], "impact": "high"}, expect=201)
    call("POST", f"/api/v2/assets/{svc['id']}/relationships", admin, {"target_id": server["id"], "type": "runs_on"}, expect=201)
    _, impact = call("GET", f"/api/v2/assets/{server['id']}/impact", admin, expect=200)
    check(any(i["asset"]["id"] == svc["id"] for i in impact["items"]), "impact analysis finds dependent service")
    call("POST", "/api/v2/assets", admin, {"name": "dup", "asset_type_id": tmap["Laptop"]["id"], "asset_tag": laptop["asset_tag"]}, expect=422)
    _, vendor = call("POST", "/api/v2/vendors", admin, {"name": "Apple", "email": "sales@apple.test"}, expect=201)
    _, po = call("POST", "/api/v2/purchase-orders", admin, {"name": "Laptops Q1", "vendor_id": vendor["id"], "tax_percent": 10,
                                                            "items": [{"item_name": "MacBook Air", "item_type": "asset", "asset_type_id": tmap["Laptop"]["id"], "cost": 1000, "quantity": 2}]}, expect=201)
    check(abs(po["total"] - 2200.0) < 0.01, "purchase order total includes tax")
    lines = json.loads(json.dumps(po["items"])) if isinstance(po["items"], list) else po["items"]
    _, recv = call("POST", f"/api/v2/purchase-orders/{po['id']}/receive", admin, {"lines": [{"id": lines[0]["id"], "quantity": 2}]}, expect=200)
    check(len(recv["created_asset_ids"]) == 2 and recv["purchase_order"]["status"] == "received", "receiving PO creates assets")
    _, ct = call("POST", "/api/v2/contracts", admin, {"name": "AppleCare", "contract_type": "warranty", "vendor_id": vendor["id"], "status": "active",
                                                      "start_date": "2026-01-01", "end_date": "2027-01-01", "asset_ids": [laptop["id"]]}, expect=201)
    _, sw = call("POST", "/api/v2/software", admin, {"name": "Slack", "publisher": "Salesforce"}, expect=201)
    call("POST", f"/api/v2/software/{sw['id']}/installations", admin, {"asset_id": laptop["id"], "version": "4.40"}, expect=201)
    _, ad = call("GET", f"/api/v2/assets/{laptop['id']}", admin, expect=200)
    check(len(ad["contracts"]) == 1 and len(ad["software"]) == 1, "asset shows contracts and software")
    call("GET", "/api/v2/assets", req_tok, expect=403)

    section("Knowledge base")
    _, tree = call("GET", "/api/v2/solutions", admin, expect=200)
    folder = tree["items"][0]["folders"][0]
    _, art = call("POST", "/api/v2/solutions/articles", admin, {"folder_id": folder["id"], "title": "Configure the VPN client",
                                                               "body": "Install the client and sign in.", "status": "published", "tags": ["vpn"]}, expect=201)
    _, rtree = call("GET", "/api/v2/solutions", req_tok, expect=200)
    check(all(f["visibility"] != "agents" for c in rtree["items"] for f in c["folders"]), "agent-only folders hidden from requesters")
    _, found = call("GET", "/api/v2/solutions/articles?q=vpn", req_tok, expect=200)
    check(any(a["id"] == art["id"] for a in found["items"]), "requester finds published article")
    call("POST", f"/api/v2/solutions/articles/{art['id']}/vote", req_tok, {"helpful": True}, expect=200)
    _, sugg = call("GET", "/api/v2/solutions/suggest?q=vpn%20client", req_tok, expect=200)
    check(len(sugg["items"]) >= 1, "article suggestions for deflection")
    call("POST", "/api/v2/solutions/articles", req_tok, {"folder_id": folder["id"], "title": "x"}, expect=403)

    section("Dashboard, reports and search")
    _, dash = call("GET", "/api/v2/dashboard?range=7d", admin, expect=200)
    check(dash["counters"]["created"] >= 3 and len(dash["trend"]) >= 7, "dashboard counters and trend")
    check(dash["csat"]["responses"] >= 1, "CSAT captured in dashboard")
    for kind in ("ticket-volume", "agent-performance", "group-performance", "sla", "csat", "assets"):
        call("GET", f"/api/v2/reports/{kind}?range=30d", admin, expect=200)
    _, sres = call("GET", "/api/v2/search?q=vpn", admin, expect=200)
    types_found = {r["type"] for r in sres["results"]}
    check({"ticket", "article"} <= types_found, f"global search spans modules ({types_found})")

    section("Admin configuration")
    _, wf = call("POST", "/api/v2/workflows", admin, {"name": "Urgent to SD", "event": "ticket_created",
                                                      "conditions": {"match": "all", "rules": [{"field": "subject", "operator": "contains", "value": "outage"}]},
                                                      "actions": [{"type": "set_priority", "value": 4}, {"type": "set_group", "value": gmap["Service Desk"]["id"]}]}, expect=201)
    call("POST", "/api/v2/workflows", admin, {"name": "bad", "conditions": {"rules": [{"field": "x", "operator": "regex"}]}, "actions": [{"type": "set_priority", "value": 1}]}, expect=422)
    _, ot = call("POST", "/api/v2/tickets", agent_tok, {"subject": "Email outage", "requester_id": requester_id}, expect=201)
    check(ot["priority"] == 4 and ot["group"]["name"] == "Service Desk", "custom workflow applied on create")
    _, settings = call("GET", "/api/v2/settings", admin, expect=200)
    s = settings["settings"]
    s["helpdesk_name"] = "Acme IT"
    s["password_require_special"] = True
    call("PUT", "/api/v2/settings", admin, s, expect=200)
    s["time_zone"] = "Mars/Olympus"
    call("PUT", "/api/v2/settings", admin, s, expect=422)
    call("POST", "/api/v2/sla-policies", admin, {"name": "VIP", "conditions": {"ticket_types": ["incident"]},
                                                 "targets": [{"priority": 4, "respond_within_minutes": 5, "resolve_within_minutes": 60, "business_hours": False}]}, expect=201)
    call("POST", "/api/v2/business-hours", admin, {"name": "Bad", "working_hours": {"monday": [{"start": "18:00", "end": "09:00"}]}}, expect=422)
    _, audit = call("GET", "/api/v2/audit-logs", admin, expect=200)
    check(audit["total"] >= 5, "audit log records admin actions")
    _, scen = call("GET", "/api/v2/scenarios", agent_tok, expect=200)
    call("POST", f"/api/v2/tickets/{ot['id']}/scenarios/{scen['items'][0]['id']}", agent_tok, expect=200)
    _, canned = call("GET", "/api/v2/canned-responses", agent_tok, expect=200)
    _, rendered = call("GET", f"/api/v2/canned-responses/{canned['items'][0]['id']}/render?ticket_id={ot['id']}", agent_tok, expect=200)
    check("Rita" in rendered["content"], "canned response placeholders rendered")
    _, notes = call("GET", "/api/v2/me/notifications", agent_tok, expect=200)
    check(notes["total"] >= 1, "in-app notifications delivered")

    section("Projects and work items")
    admin_uid = me["user"]["id"]
    _, roles = call("GET", "/api/v2/roles", admin, expect=200)
    sup = next(r for r in roles["items"] if r["name"] == "SD Supervisor")
    check("projects.manage" in sup["privileges"], "SD Supervisor can manage projects")
    call("POST", "/api/v2/projects", agent_tok, {"name": "No rights"}, expect=403)
    call("GET", "/api/v2/projects", req_tok, expect=403)
    _, proj = call("POST", "/api/v2/projects", admin, {"name": "Kairvo", "description": "Website relaunch"}, expect=201)
    pid = proj["id"]
    check(proj["key"] == "KAIRV" and proj["lead"]["id"] == admin_uid and proj["can_manage"], "project key derived and creator leads it")
    call("POST", "/api/v2/projects", admin, {"name": "Other", "key": "kairv"}, expect=422)
    call("POST", "/api/v2/projects", admin, {"name": "Other", "key": "1BAD"}, expect=422)
    _, secret = call("POST", "/api/v2/projects", admin, {"name": "Secret Ops", "visibility": "private"}, expect=201)
    _, plist = call("GET", "/api/v2/projects", agent_tok, expect=200)
    pids = {x["id"] for x in plist["items"]}
    check(pid in pids and secret["id"] not in pids, "agents see public projects but not private ones")
    call("GET", f"/api/v2/projects/{secret['id']}", agent_tok, expect=404)
    call("POST", f"/api/v2/projects/{pid}/work-items", agent_tok, {"title": "Not a member"}, expect=403)
    _, proj = call("PUT", f"/api/v2/projects/{pid}", admin, {"member_ids": [admin_uid, agent_id]}, expect=200)
    check(agent_id in proj["member_ids"], "agent added to the project")
    call("PUT", f"/api/v2/projects/{pid}", agent_tok, {"name": "Hijack"}, expect=403)
    _, w1 = call("POST", f"/api/v2/projects/{pid}/work-items", agent_tok, {"title": "Home Page Navigation", "priority": "medium",
                                                                           "start_date": "2026-10-15", "due_date": "2026-10-17"}, expect=201)
    check(w1["display_id"] == "KAIRV-1" and w1["state"] == "todo" and w1["reporter"]["id"] == agent_id, "work item numbered per project")
    _, w2 = call("POST", f"/api/v2/projects/{pid}/work-items", admin, {"title": "Create meta business account", "priority": "urgent",
                                                                       "assignee_id": agent_id, "ticket_id": tid}, expect=201)
    check(w2["display_id"] == "KAIRV-2" and w2["links"] == 1 and w2["assignee"]["id"] == agent_id, "work item created from a ticket and assigned")
    call("POST", f"/api/v2/projects/{pid}/work-items", admin, {"title": "x", "assignee_id": requester_id}, expect=422)
    call("POST", f"/api/v2/projects/{pid}/work-items", admin, {"title": "x", "state": "nope"}, expect=422)
    call("POST", f"/api/v2/projects/{pid}/work-items", admin, {"title": "x", "start_date": "2026-10-20", "due_date": "2026-10-01"}, expect=422)
    _, sub = call("POST", f"/api/v2/projects/{pid}/work-items", agent_tok, {"title": "Design the menu", "parent_id": w1["id"]}, expect=201)
    _, w1 = call("GET", f"/api/v2/work-items/{w1['id']}", agent_tok, expect=200)
    check(w1["sub_items"] == 1 and w1["can_edit"], "parent shows its sub-item")
    call("PUT", f"/api/v2/work-items/{w1['id']}", agent_tok, {"parent_id": sub["id"]}, expect=422)
    _, moved = call("PUT", f"/api/v2/work-items/{w1['id']}", agent_tok, {"state": "in_progress"}, expect=200)
    check(moved["state"] == "in_progress", "work item moved on the board")
    _, acts = call("GET", f"/api/v2/work-items/{w1['id']}/activities", agent_tok, expect=200)
    check(any("moved the work item to In Progress" in a["summary"] for a in acts["items"]), "move recorded in activity")
    _, done = call("PUT", f"/api/v2/work-items/{w1['id']}", agent_tok, {"state": "done"}, expect=200)
    check(done["completed_at"], "completing a work item stamps completed_at")
    _, items = call("GET", f"/api/v2/projects/{pid}/work-items?state=done", agent_tok, expect=200)
    check([x["id"] for x in items["items"]] == [w1["id"]], "board filters by state")
    _, items = call("GET", f"/api/v2/projects/{pid}/work-items?assignee_id=me", agent_tok, expect=200)
    check([x["id"] for x in items["items"]] == [w2["id"]], "board filters by assignee")
    _, items = call("GET", f"/api/v2/projects/{pid}/work-items?q=KAIRV-2", agent_tok, expect=200)
    check([x["id"] for x in items["items"]] == [w2["id"]], "board search by work item id")
    call("POST", f"/api/v2/work-items/{w2['id']}/notes", admin, {"body": "Business verification documents are ready"}, expect=201)
    _, notes = call("GET", "/api/v2/me/notifications", agent_tok, expect=200)
    kinds = {n.get("type") or n.get("kind") for n in notes["items"]}
    check({"work_item_assigned", "work_item_comment"} <= kinds, f"assignee notified of assignment and comments ({kinds})")
    _, assoc = call("GET", f"/api/v2/tickets/{tid}/associations", admin, expect=200)
    check(any(x.get("type") == "work_item" or x.get("record", {}).get("type") == "work_item" for x in assoc["items"]), "ticket shows its linked work item")
    _, cyc = call("POST", f"/api/v2/projects/{pid}/cycles", agent_tok, {"name": "Sprint 1", "start_date": "2026-10-12", "end_date": "2026-10-25"}, expect=201)
    call("POST", f"/api/v2/projects/{pid}/cycles", agent_tok, {"name": "Overlap", "start_date": "2026-10-20", "end_date": "2026-10-30"}, expect=422)
    call("PUT", f"/api/v2/work-items/{w2['id']}", agent_tok, {"cycle_id": cyc["id"]}, expect=200)
    _, cycles = call("GET", f"/api/v2/projects/{pid}/cycles", agent_tok, expect=200)
    check(cycles["items"][0]["total"] == 1, "cycle counts its work items")
    _, mine = call("GET", "/api/v2/me/work-items", agent_tok, expect=200)
    check([x["id"] for x in mine["items"]] == [w2["id"]], "my work items lists open assignments")
    _, found = call("GET", "/api/v2/search?q=KAIRV-2", agent_tok, expect=200)
    check(any(r["type"] == "work_item" and r["id"] == w2["id"] for r in found["results"]), "global search finds work items")
    call("DELETE", f"/api/v2/cycles/{cyc['id']}", agent_tok, expect=200)
    _, w2 = call("GET", f"/api/v2/work-items/{w2['id']}", agent_tok, expect=200)
    check(w2["cycle_id"] is None, "deleting a cycle keeps its work items")
    call("DELETE", f"/api/v2/work-items/{sub['id']}", agent_tok, expect=200)
    call("GET", f"/api/v2/work-items/{sub['id']}", agent_tok, expect=404)
    section("Work item details, modules and tickets")
    _, mod = call("POST", f"/api/v2/projects/{pid}/modules", agent_tok, {"name": "Home page", "status": "in_progress", "lead_id": agent_id}, expect=201)
    call("POST", f"/api/v2/projects/{pid}/modules", agent_tok, {"name": "Bad", "status": "someday"}, expect=422)
    _, d1 = call("PUT", f"/api/v2/work-items/{w1['id']}", agent_tok, {"module_ids": [mod["id"]],
                 "web_links": [{"url": "https://kairvo.com", "title": "Site"}]}, expect=200)
    check([m["name"] for m in d1["modules"]] == ["Home page"] and d1["web_links"][0]["title"] == "Site", "work item keeps modules and web links")
    call("PUT", f"/api/v2/work-items/{w1['id']}", agent_tok, {"web_links": [{"url": "javascript:alert(1)"}]}, expect=422)
    call("PUT", f"/api/v2/work-items/{w1['id']}", agent_tok, {"module_ids": [str(uuid.uuid4())]}, expect=422)
    _, mods = call("GET", f"/api/v2/projects/{pid}/modules", agent_tok, expect=200)
    check(mods["items"][0]["total"] == 1, "module counts its work items")
    _, inmod = call("GET", f"/api/v2/projects/{pid}/work-items?module_id={mod['id']}", agent_tok, expect=200)
    check([x["id"] for x in inmod["items"]] == [w1["id"]], "work items filter by module")
    up = upload(agent_tok, "screenshot.png", PNG, "image/png")
    _, d1 = call("POST", f"/api/v2/work-items/{w1['id']}/attachments", agent_tok, {"attachment_ids": [up["id"]]}, expect=200)
    check(len(d1["attachments"]) == 1 and d1["attachments"][0]["content_type"] == "image/png", "images attach to the work item")
    status, img = call("GET", f"/api/v2/attachments/{up['id']}", agent_tok, raw=True)
    check(status == 200 and img == PNG, "attached image downloads for preview")
    _, d1 = call("POST", f"/api/v2/work-items/{w1['id']}/relations", agent_tok, {"type": "blocks", "target_id": w2["id"]}, expect=200)
    check(any(r["type"] == "blocks" and r["item"]["id"] == w2["id"] for r in d1["relations"]), "relation recorded")
    _, d2 = call("GET", f"/api/v2/work-items/{w2['id']}", agent_tok, expect=200)
    check(any(r["type"] == "blocked_by" and r["item"]["id"] == w1["id"] for r in d2["relations"]), "relation shows its inverse on the other item")
    call("POST", f"/api/v2/work-items/{w1['id']}/relations", agent_tok, {"type": "relates_to", "target_id": w2["id"]}, expect=422)
    call("POST", f"/api/v2/work-items/{w1['id']}/relations", agent_tok, {"type": "owns", "target_id": w2["id"]}, expect=422)
    call("DELETE", f"/api/v2/work-items/{w1['id']}/relations/{d1['relations'][0]['link_id']}", agent_tok, expect=200)
    _, d1 = call("POST", f"/api/v2/work-items/{w1['id']}/subscribe", admin, expect=200)
    check(d1["subscribed"] and any(u["id"] == admin_uid for u in d1["subscribers"]), "subscribing adds you to the subscribers")
    before_mails = len(mails_to(admin_email, "updated KAIRV-1"))
    call("PUT", f"/api/v2/work-items/{w1['id']}", agent_tok, {"state": "in_progress", "priority": "high"}, expect=200)
    if email_on and MAIL_DIR:
        check(wait_mail(admin_email, "updated KAIRV-1", count_before=before_mails) is not None, "subscribers get an email when a work item changes")
        html = mail_html(admin_email, "updated KAIRV-1")
        check("Open in " in html and "Notification settings" in html, "notification emails are branded HTML with a button")
    _, d1 = call("DELETE", f"/api/v2/work-items/{w1['id']}/subscribe", admin, expect=200)
    check(not d1["subscribed"], "unsubscribe works")
    call("DELETE", f"/api/v2/modules/{mod['id']}", agent_tok, expect=200)
    _, d1 = call("GET", f"/api/v2/work-items/{w1['id']}", agent_tok, expect=200)
    check(d1["module_ids"] == [], "deleting a module keeps its work items")
    # Tickets on project boards, with the status kept in sync both ways.
    _, link = call("PUT", f"/api/v2/tickets/{tid}/project", admin, {"project_id": pid, "state": "in_progress"}, expect=200)
    tw = link["link"]["work_item"]
    check(link["link"]["project"]["id"] == pid and tw["state"] == "in_progress", "ticket added to a project with a status")
    call("PUT", f"/api/v2/work-items/{tw['id']}", agent_tok, {"state": "done"}, expect=200)
    _, link = call("GET", f"/api/v2/tickets/{tid}/project", admin, expect=200)
    check(link["link"]["work_item"]["state"] == "done", "moving the work item updates the ticket's project status")
    _, link = call("PUT", f"/api/v2/tickets/{tid}/project", admin, {"project_id": pid, "state": "backlog"}, expect=200)
    _, tdet = call("GET", f"/api/v2/work-items/{tw['id']}", agent_tok, expect=200)
    check(tdet["state"] == "backlog" and any(x["id"] == tid and x["tracked"] for x in tdet["tickets"]), "changing the ticket's project status moves the work item")
    call("PUT", f"/api/v2/tickets/{tid}/project", admin, {"project_id": pid, "state": "sideways"}, expect=422)
    call("PUT", f"/api/v2/tickets/{tid}/project", admin, {"project_id": str(uuid.uuid4())}, expect=422)
    _, nt = call("POST", "/api/v2/tickets", admin, {"subject": "Logo link in header", "project_id": pid, "project_state": "todo"}, expect=201)
    _, link = call("GET", f"/api/v2/tickets/{nt['id']}/project", admin, expect=200)
    check(link["link"] and link["link"]["work_item"]["state"] == "todo", "a ticket can be created straight into a project")
    call("POST", "/api/v2/tickets", admin, {"subject": "x", "project_id": str(uuid.uuid4())}, expect=422)
    call("DELETE", f"/api/v2/tickets/{nt['id']}/project", admin, expect=200)
    _, link = call("GET", f"/api/v2/tickets/{nt['id']}/project", admin, expect=200)
    check(link["link"] is None, "removing a ticket from its project keeps the work item but stops the sync")
    _, tfull = call("GET", f"/api/v2/tickets/{tid}", admin, expect=200)
    req_email = (tfull.get("requester") or {}).get("email", "")
    before_mails = len(mails_to(req_email, "is now Pending")) if req_email else 0
    call("PUT", f"/api/v2/tickets/{tid}", admin, {"status": "pending"}, expect=200)
    if email_on and MAIL_DIR and req_email:
        check(wait_mail(req_email, "is now Pending", count_before=before_mails) is not None, "requesters are emailed when their ticket's status changes")
    call("POST", "/api/v2/email-outbox/retry", admin, expect=200)
    call("POST", "/api/v2/email-outbox/retry", agent_tok, expect=403)

    call("PUT", f"/api/v2/projects/{pid}", admin, {"archived": True}, expect=200)
    call("POST", f"/api/v2/projects/{pid}/work-items", agent_tok, {"title": "Archived"}, expect=403)
    _, plist = call("GET", "/api/v2/projects", admin, expect=200)
    _, alist = call("GET", "/api/v2/projects?archived=true", admin, expect=200)
    check(pid not in {x["id"] for x in plist["items"]} and pid in {x["id"] for x in alist["items"]}, "archived projects are listed separately")
    call("DELETE", f"/api/v2/projects/{pid}", agent_tok, expect=403)
    call("DELETE", f"/api/v2/projects/{pid}", admin, expect=200)
    call("GET", f"/api/v2/work-items/{w2['id']}", admin, expect=404)

    section("Organization structure")
    _, hq = call("POST", "/api/v2/departments", admin, {"name": "Acme HQ", "kind": "company", "code": "hq"}, expect=201)
    _, ops = call("POST", "/api/v2/departments", admin, {"name": "Operations", "kind": "division", "parent_id": hq["id"]}, expect=201)
    _, fin = call("POST", "/api/v2/departments", admin, {"name": "Finance Ops", "parent_id": ops["id"], "code": "FIN",
                                                          "domains": [f"finance.{domain}"]}, expect=201)
    _, pay = call("POST", "/api/v2/departments", admin, {"name": "Payroll", "kind": "unit", "parent_id": fin["id"]}, expect=201)
    call("POST", "/api/v2/departments", admin, {"name": "Dup", "code": "fin"}, expect=422)
    call("POST", "/api/v2/departments", admin, {"name": "Bad", "kind": "planet"}, expect=422)
    call("PUT", f"/api/v2/departments/{fin['id']}", admin, {"parent_id": pay["id"]}, expect=422)
    _, units = call("GET", "/api/v2/departments", admin, expect=200)
    upay = next(u for u in units["items"] if u["id"] == pay["id"])
    check([r["name"] for r in upay["path"]] == ["Acme HQ", "Operations", "Finance Ops"] and upay["depth"] == 3, "unit path and depth")
    _, fr = call("POST", "/api/v2/requesters", admin, {"email": f"fiona@finance.{domain}", "name": "Fiona Finance", "job_title": "Payroll analyst"}, expect=201)
    fiona = fr["person"]["id"]
    check(fr["person"]["department"] and fr["person"]["department"]["id"] == fin["id"], "requester placed in the unit that owns the email domain")
    _, inside = call("GET", f"/api/v2/requesters?department_id={ops['id']}&include_children=true", admin, expect=200)
    check(fiona in [p["id"] for p in inside["items"]], "people filter includes sub-units")
    _, team = call("POST", "/api/v2/teams", admin, {"name": "Month-end close", "kind": "static", "member_ids": [agent_id, fiona], "lead_user_id": agent_id}, expect=201)
    check(team["member_count"] == 2 and team["lead"]["id"] == agent_id, "static team with lead and members")
    call("POST", "/api/v2/teams", admin, {"name": "month-end CLOSE"}, expect=422)
    rules = {"match": "all", "conditions": [{"field": "unit", "operator": "within", "value": ops["id"]}, {"field": "job_title", "operator": "contains", "value": "payroll"}]}
    _, prev = call("POST", "/api/v2/teams/preview", admin, rules, expect=200)
    check(prev["total"] == 1 and prev["sample"][0]["id"] == fiona, "dynamic rule preview")
    _, dyn = call("POST", "/api/v2/teams", admin, {"name": "Payroll people", "kind": "dynamic", "rules": rules}, expect=201)
    check(dyn["member_count"] == 1, "dynamic team computes members")
    call("POST", "/api/v2/teams", admin, {"name": "Broken", "kind": "dynamic", "rules": {"match": "all", "conditions": [{"field": "shoe_size", "operator": "is", "value": "9"}]}}, expect=422)
    call("POST", f"/api/v2/teams/{dyn['id']}/members", admin, {"user_ids": [agent_id]}, expect=400)
    _, by_team = call("GET", f"/api/v2/requesters?team_id={team['id']}", admin, expect=200)
    check([p["id"] for p in by_team["items"]] == [fiona], "people filter by team")
    _, bulk = call("POST", "/api/v2/people/bulk", admin, {"ids": [fiona, requester_id], "action": "set_unit", "value": pay["id"]}, expect=200)
    check(bulk["updated"] == 2, "bulk move to a unit")
    call("POST", "/api/v2/people/bulk", admin, {"ids": [fiona], "action": "set_vip_on"}, expect=200)
    _, vips = call("GET", "/api/v2/requesters?state=vip", admin, expect=200)
    check([p["id"] for p in vips["items"]] == [fiona], "VIP filter")
    call("POST", "/api/v2/people/bulk", agent_tok, {"ids": [fiona], "action": "set_vip_off"}, expect=403)
    csv_text = "name,email,job_title,unit,location,reporting_manager,vip\n" + \
        f"Ivan Import,ivan@{domain},Accountant,FIN,HQ,{admin_email},yes\n" + \
        "No Email,not-an-email,,,,,\n"
    _, dry = call("POST", "/api/v2/people/import", admin, {"kind": "requesters", "csv": csv_text, "dry_run": True}, expect=200)
    check(dry["summary"] == {"create": 1, "update": 0, "error": 1}, f"import dry run validates rows ({dry['summary']})")
    _, none = call("GET", f"/api/v2/requesters?q=ivan@{domain}", admin, expect=200)
    check(none["total"] == 0, "dry run creates nobody")
    _, imp = call("POST", "/api/v2/people/import", admin, {"kind": "requesters", "csv": csv_text}, expect=200)
    ivan_row = next(r for r in imp["rows"] if r["email"] == f"ivan@{domain}")
    check(ivan_row["action"] == "create" and (ivan_row.get("temporary_password") or email_on), "import creates people")
    _, ivan = call("GET", f"/api/v2/requesters?q=ivan@{domain}", admin, expect=200)
    iv = ivan["items"][0]
    check(iv["department"]["id"] == fin["id"] and iv["vip"] and iv["reporting_manager"]["id"] == admin_uid, "imported fields applied")
    _, again = call("POST", "/api/v2/people/import", admin, {"kind": "requesters", "csv": f"email,job_title\nivan@{domain},Controller\n"}, expect=200)
    check(again["summary"]["update"] == 1, "re-import updates existing people")
    st, exported = call("GET", "/api/v2/people/export?kind=requesters", admin, raw=True)
    check(st == 200 and f"ivan@{domain}".encode() in exported and b"Controller" in exported, "requesters export as CSV")
    _, g = call("PUT", f"/api/v2/groups/{gmap['Service Desk']['id']}", admin, {"observer_ids": [agent_id], "leader_id": admin_uid, "email": f"desk@{domain}"}, expect=200)
    _, groups = call("GET", "/api/v2/groups", admin, expect=200)
    sd = next(x for x in groups["items"] if x["id"] == gmap["Service Desk"]["id"])
    check(agent_id in sd["observer_ids"] and agent_id not in sd["member_ids"] and sd["leader"]["id"] == admin_uid, "group observers and leader")
    call("PUT", f"/api/v2/agents/{agent_id}", admin, {"reporting_manager_id": admin_uid}, expect=200)
    _, pa = call("GET", f"/api/v2/people/{admin_uid}", admin, expect=200)
    check(agent_id in [x["id"] for x in pa["org"]["direct_reports"]], "manager sees direct reports")
    _, pf = call("GET", f"/api/v2/people/{fiona}", admin, expect=200)
    check([r["name"] for r in pf["org"]["unit_path"]] == ["Acme HQ", "Operations", "Finance Ops", "Payroll"] and
          {t["name"] for t in pf["org"]["teams"]} == {"Month-end close", "Payroll people"}, "person org context")
    _, gone = call("DELETE", f"/api/v2/departments/{fin['id']}", admin, expect=200)
    _, units = call("GET", "/api/v2/departments", admin, expect=200)
    upay = next(u for u in units["items"] if u["id"] == pay["id"])
    check(upay["parent_id"] == ops["id"], "deleting a unit lifts its sub-units")
    _, iv2 = call("GET", f"/api/v2/people/{iv['id']}", admin, expect=200)
    check(iv2["person"]["department"]["id"] == ops["id"], "deleting a unit moves its people to the parent")

    section("Personal settings")
    png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
    _, av = call("PUT", "/api/v2/me/avatar", agent_tok, {"data_url": png}, expect=200)
    st, img = call("GET", av["avatar_url"], raw=True)
    check(st == 200 and img.startswith(b"\x89PNG"), "avatar is served publicly")
    call("PUT", "/api/v2/me/avatar", agent_tok, {"data_url": "data:image/png;base64,aGVsbG8="}, expect=422)
    _, ame = call("GET", "/api/v2/me", agent_tok, expect=200)
    check(ame["user"].get("avatar_url") and ame["org"]["manager_chain"][0]["id"] == admin_uid, "profile carries avatar and manager")
    call("PUT", "/api/v2/me/out-of-office", agent_tok, {"start": "2026-01-01T00:00:00Z", "end": "2026-01-02T00:00:00Z"}, expect=422)
    _, ame = call("PUT", "/api/v2/me/out-of-office", agent_tok, {"start": "2020-01-01T00:00:00Z", "end": "2099-01-01T00:00:00Z",
                                                                 "delegate_id": admin_uid, "message": "On leave"}, expect=200)
    check(ame["user"]["out_of_office"] and ame["user"]["ooo_delegate"]["id"] == admin_uid, "out of office with delegate")
    _, ch = call("POST", "/api/v2/changes", admin, {"subject": "Delegated approval check", "change_type": "major"}, expect=201)
    call("POST", f"/api/v2/changes/{ch['id']}/approvals", admin, {"approver_ids": [agent_id]}, expect=200)
    _, mine = call("GET", "/api/v2/approvals?status=requested", admin, expect=200)
    check(any("Delegated approval check" in json.dumps(x) for x in mine["items"]), "approvals go to the delegate while out of office")
    call("DELETE", "/api/v2/me/out-of-office", agent_tok, expect=200)
    _, prefs = call("GET", "/api/v2/me/notification-preferences", agent_tok, expect=200)
    check(any(x["key"] == "mention" for x in prefs["items"]), "notification preferences listed")
    call("PUT", "/api/v2/me/notification-preferences", agent_tok, {"bogus": {"in_app": False}}, expect=422)
    call("PUT", "/api/v2/me/notification-preferences", agent_tok, {"task_assigned": {"in_app": False}}, expect=200)
    _, before = call("GET", "/api/v2/me/notifications", agent_tok, expect=200)
    call("POST", f"/api/v2/tickets/{tid}/tasks", admin, {"title": "Quiet task", "agent_id": agent_id}, expect=201)
    _, after = call("GET", "/api/v2/me/notifications", agent_tok, expect=200)
    check(len(after["items"]) == len(before["items"]), "muted notifications are not delivered")
    s1_access, s1_refresh = login(f"agent@{domain}", "Agent@12345")
    _, s1 = call("POST", "/api/v2/auth/refresh", body={"refresh_token": s1_refresh}, expect=200)
    import hashlib
    _, sess = call("GET", "/api/v2/me/sessions", s1["access_token"], headers={"X-Session-Hash": hashlib.sha256(s1["refresh_token"].encode()).hexdigest()}, expect=200)
    check(any(x["current"] for x in sess["items"]), "current session is identified")
    time.sleep(1.1)
    _, fresh = call("POST", "/api/v2/me/sessions/sign-out-others", s1["access_token"], expect=200)
    call("GET", "/api/v2/me", agent_tok, expect=401)
    call("GET", "/api/v2/me", fresh["access_token"], expect=200)
    agent_tok = fresh["access_token"]

    section("Organization service tenant isolation (v1)")
    status, team = call("POST", f"/api/v1/organizations/{org_id}/teams", admin, {"org_id": org_id, "name": "Platform"})
    check(status == 200, f"org admin creates team ({status} {str(team)[:200]})")
    call("POST", f"/api/v1/organizations/{org_id}/teams", req_tok, {"org_id": org_id, "name": "Rogue"}, expect=403)
    call("GET", f"/api/v1/organizations/{uuid.uuid4()}/teams", admin, expect=403)
    call("GET", f"/api/v1/notifications?user_id={agent_id}", req_tok, expect=403)

    section("Account lifecycle")
    status, refreshed = call("POST", "/api/v2/auth/refresh", body={"refresh_token": admin_refresh})
    check(status == 200 and refreshed.get("access_token"), "refresh token issues a new pair")
    call("POST", "/api/v2/auth/refresh", body={"refresh_token": admin_refresh}, expect=401)
    call("POST", "/api/v2/auth/refresh", body={"refresh_token": refreshed["access_token"]}, expect=401)
    call("POST", f"/api/v2/people/{other_res['person']['id']}/deactivate", admin, expect=200)
    time.sleep(0.2)
    status, _ = call("POST", "/api/v1/auth/login", body={"email": f"omar@{domain}", "password": other_res["temporary_password"]})
    check(status in (401, 403), f"deactivated user cannot sign in (got {status})")
    call("POST", f"/api/v2/people/{other_res['person']['id']}/reactivate", admin, expect=200)
    _, conv = call("POST", f"/api/v2/people/{requester_id}/convert-to-agent", admin, {"role_ids": [rmap["SD Agent"]["id"]]}, expect=200)
    check(conv["is_agent"], "requester converted to agent")
    call("POST", f"/api/v2/people/{requester_id}/convert-to-requester", admin, expect=200)
    resets = len(mails_to(f"agent@{domain}", "Choose a new password"))
    _, rp = call("POST", f"/api/v2/people/{agent_id}/reset-password", admin, expect=200)
    if email_on:
        check(rp.get("link_sent") and "temporary_password" not in rp, "admin password reset emails a link instead of showing a password")
        if MAIL_DIR:
            mail = wait_mail(f"agent@{domain}", "Choose a new password", count_before=resets)
            check(mail is not None and link_token(mail[1], "/reset-password"), "admin password reset email contains a reset link")
    else:
        check("temporary_password" in rp, "admin password reset issues a temporary password")
    call("POST", f"/api/v2/people/{me['user']['id']}/deactivate", admin, expect=400)
    _, key = call("POST", "/api/v2/me/api-key", admin, expect=201)
    import base64
    basic = base64.b64encode((key["key"] + ":X").encode()).decode()
    call("GET", "/api/v2/tickets", headers={"Authorization": "Basic " + basic}, expect=200)

    section("Categories and change types")
    # A fresh agent: the first agent's password was reset above.
    _, viewer = call("POST", "/api/v2/agents", admin, {"email": f"viewer@{domain}", "name": "Vic Viewer", "role_ids": [rmap["SD Agent"]["id"]]}, expect=201)
    accept_invitation(viewer, f"viewer@{domain}")
    viewer_tok, _ = login(f"viewer@{domain}", viewer["temporary_password"])
    _, vpw = call("POST", "/api/v2/me/password", viewer_tok, {"current_password": viewer["temporary_password"], "new_password": "Viewer@12345"}, expect=200)
    viewer_tok = vpw["access_token"]
    _, cls = call("GET", "/api/v2/classifications?entity=ticket", admin, expect=200)
    tcat = next(c for c in cls["items"] if c["name"] == "category")
    check(len(tcat["choices"]) >= 10 and any(c["value"] == "Network" for c in tcat["choices"]), "rich default ticket categories")
    call("GET", "/api/v2/classifications", req_tok, expect=403)
    call("PUT", "/api/v2/classifications/ticket/category", viewer_tok, {"choices": tcat["choices"]}, expect=403)
    call("POST", "/api/v2/tickets", admin, {"subject": "Bad category", "category": "Nope"}, expect=422)
    call("POST", "/api/v2/tickets", admin, {"subject": "Bad item", "category": "Network", "sub_category": "VPN", "item_category": "Toaster"}, expect=422)
    _, okt = call("POST", "/api/v2/tickets", admin, {"subject": "Good path", "category": "Network", "sub_category": "VPN", "item_category": "Slow"}, expect=201)
    custom = tcat["choices"] + [{"value": "Smoke Category", "children": [{"value": "Sub", "children": [{"value": "Item"}]}]}]
    call("PUT", "/api/v2/classifications/ticket/category", admin, {"choices": custom}, expect=200)
    call("POST", "/api/v2/tickets", admin, {"subject": "Custom path", "category": "Smoke Category", "sub_category": "Sub", "item_category": "Item"}, expect=201)
    call("PUT", "/api/v2/classifications/ticket/category", admin, {"choices": [{"value": "A", "children": [{"value": "B", "children": [{"value": "C", "children": [{"value": "D"}]}]}]}]}, expect=422)
    call("PUT", "/api/v2/classifications/ticket/category", admin, {"choices": [{"value": "Dup"}, {"value": "dup"}]}, expect=422)
    _, after = call("POST", "/api/v2/classifications/ticket/category/reset", admin, expect=200)
    check(not any(c["value"] == "Smoke Category" for c in next(i for i in after["items"] if i["name"] == "category")["choices"]), "restore defaults replaces the list")
    call("PUT", f"/api/v2/tickets/{okt['id']}", admin, {"subject": "Good path (edited)"}, expect=200)
    _, pr = call("POST", "/api/v2/problems", admin, {"subject": "DB slow", "category": "Database", "sub_category": "Performance",
                                                     "business_impact": "High: major services degraded"}, expect=201)
    check(pr["sub_category"] == "Performance" and pr["business_impact"].startswith("High"), "problem keeps category path and business impact")
    call("POST", "/api/v2/problems", admin, {"subject": "x", "category": "Hardware", "sub_category": "Laptop"}, expect=422)
    call("POST", "/api/v2/problems", admin, {"subject": "x", "business_impact": "Apocalyptic"}, expect=422)
    _, ct = call("GET", "/api/v2/classifications?entity=change", admin, expect=200)
    types = next(c for c in ct["items"] if c["name"] == "change_type")["choices"]
    check({t["value"] for t in types} >= {"minor", "standard", "major", "emergency"}, "built-in change types present")
    _, ct = call("PUT", "/api/v2/classifications/change/change_type", admin,
                 {"choices": [{"value": "minor", "label": "Small"}, {"label": "Smoke Migration", "requires_approval": True}]}, expect=200)
    types = next(c for c in ct["items"] if c["name"] == "change_type")["choices"]
    check(any(t["value"] == "major" and t["requires_approval"] for t in types), "built-in change types cannot be removed or lose their approval rule")
    check(any(t["value"] == "minor" and t["label"] == "Small" for t in types), "built-in change types can be renamed")
    _, mig = call("POST", "/api/v2/changes", admin, {"subject": "Migrate", "change_type": "smoke_migration", "category": "Infrastructure",
                                                     "sub_category": "Cloud resource", "business_impact": "No user impact"}, expect=201)
    status, _ = call("PUT", f"/api/v2/changes/{mig['id']}", admin, {"status": "pending_release"})
    check(status == 400, f"a custom change type that needs CAB approval blocks release until approved (got {status})")
    call("POST", "/api/v2/changes", admin, {"subject": "x", "change_type": "yolo"}, expect=422)
    call("POST", "/api/v2/classifications/change/change_type/reset", admin, expect=200)

    section("Job roles and org chart")
    _, jr = call("GET", "/api/v2/job-roles", admin, expect=200)
    jmap = {r["name"]: r for r in jr["items"]}
    check(jmap.get("Chief Executive Officer", {}).get("level") == 1 and jmap["Vice President"]["level"] > jmap["Senior Vice President"]["level"],
          "default job role hierarchy seeded (CEO at the top, SVP above VP)")
    _, mine = call("POST", "/api/v2/job-roles", admin, {"name": "Head of IT Operations", "parent_id": jmap["Vice President"]["id"]}, expect=201)
    check(mine["level"] == jmap["Vice President"]["level"] + 1, "a new job role defaults to one level below the role it reports to")
    call("POST", "/api/v2/job-roles", admin, {"name": "head of it operations"}, expect=422)
    call("POST", "/api/v2/job-roles", admin, {"name": "Too Senior", "parent_id": jmap["Manager"]["id"], "level": 2}, expect=422)
    call("PUT", f"/api/v2/job-roles/{jmap['Senior Vice President']['id']}", admin, {"parent_id": mine["id"]}, expect=422)
    call("POST", "/api/v2/job-roles", viewer_tok, {"name": "Nope"}, expect=403)
    call("GET", "/api/v2/job-roles", viewer_tok, expect=200)
    call("PUT", f"/api/v2/agents/{agent_id}", admin, {"job_role_id": mine["id"], "reporting_manager_id": me["user"]["id"]}, expect=200)
    call("PUT", f"/api/v2/agents/{me['user']['id']}", admin, {"job_role_id": jmap["Chief Information Officer"]["id"], "reporting_manager_id": agent_id}, expect=422)
    _, ag = call("GET", f"/api/v2/people/{agent_id}", admin, expect=200)
    check((ag["person"].get("job_role") or {}).get("name") == "Head of IT Operations", "people show their job role")
    _, chart = call("GET", "/api/v2/org-chart/people", admin, expect=200)
    node = next((n for n in chart["items"] if n["id"] == agent_id), None)
    check(node and node["manager_id"] == me["user"]["id"] and node["job_role"]["name"] == "Head of IT Operations", "org chart shows reporting line and job role")
    call("GET", "/api/v2/org-chart/people", req_tok, expect=403)
    call("DELETE", f"/api/v2/job-roles/{mine['id']}", admin, expect=200)
    _, ag = call("GET", f"/api/v2/people/{agent_id}", admin, expect=200)
    check(ag["person"].get("job_role") is None, "deleting a job role clears it from people")

    section("Invitations")
    _, inv = call("POST", "/api/v2/requesters", admin, {"email": f"ivy@{domain}", "name": "Ivy Invite"}, expect=201)
    if email_on:
        check(inv.get("invitation_sent") and inv["person"]["email_verified"] is False, "new requester is invited and unverified")
        status, _ = call("POST", f"/api/v2/people/{inv['person']['id']}/invite", admin)
        check(status == 429, f"invitations are limited to one a minute (got {status})")
        _, invited = call("GET", "/api/v2/requesters?state=invited&q=ivy", admin, expect=200)
        check(any(p["id"] == inv["person"]["id"] for p in invited["items"]), "invited filter lists people who have not activated")
    else:
        call("POST", f"/api/v2/people/{inv['person']['id']}/invite", admin, expect=400)
    call("POST", f"/api/v2/people/{agent_id}/invite", admin, expect=400)
    call("POST", "/api/v2/requesters", admin, {"email": admin_email.upper(), "name": "Dup across case"}, expect=422)
    call("POST", "/api/v2/auth/activate", body={"token": "bogus", "new_password": "Whatever@123"}, expect=400)

    section("Password reset by email")
    if not email_on:
        call("POST", "/api/v2/auth/forgot/email", body={"email": admin_email}, expect=400)
        print("  (email is off: only checked that email reset is refused)")
    else:
        _, real = call("POST", "/api/v2/auth/forgot/email", body={"email": admin_email}, expect=200)
        _, ghost = call("POST", "/api/v2/auth/forgot/email", body={"email": f"nobody-{suffix}@{domain}"}, expect=200)
        check(real["message"] == ghost["message"], "reset request does not reveal whether an account exists")
        call("POST", "/api/v2/auth/forgot/email", body={"email": "not-an-email"}, expect=422)
        call("POST", "/api/v2/auth/forgot/email/check", body={"token": "bogus"}, expect=400)
        call("POST", "/api/v2/auth/forgot/email/reset", body={"token": "bogus", "new_password": "Whatever@123"}, expect=400)
        if MAIL_DIR:
            mail = wait_mail(admin_email, "Reset your")
            token = link_token(mail[1] if mail else "", "/reset-password")
            check(token is not None, "reset email delivered with a link")
            call("POST", "/api/v2/auth/forgot/email", body={"email": admin_email}, expect=200)
            time.sleep(2)
            check(len(mails_to(admin_email, "Reset your")) == 1, "a second reset request within a minute sends no extra email")
            _, who = call("POST", "/api/v2/auth/forgot/email/check", body={"token": token}, expect=200)
            check(who.get("email") == admin_email, "reset link identifies the account")
            _, old_refresh = login(admin_email, admin_pw)
            call("POST", "/api/v2/auth/forgot/email/reset", body={"token": token, "new_password": "short"}, expect=422)
            new_pw = "Reset@" + suffix + "A1"
            time.sleep(1.1)  # JWT iat has one-second precision
            call("POST", "/api/v2/auth/forgot/email/reset", body={"token": token, "new_password": new_pw}, expect=200)
            call("POST", "/api/v2/auth/forgot/email/reset", body={"token": token, "new_password": new_pw}, expect=400)
            status, _ = call("POST", "/api/v1/auth/login", body={"email": admin_email, "password": admin_pw})
            check(status == 401, f"old password stops working after an email reset (got {status})")
            status, _ = call("POST", "/api/v2/auth/refresh", body={"refresh_token": old_refresh})
            check(status == 401, f"sessions are signed out after an email reset (got {status})")
            admin_pw = new_pw
            admin, _ = login(admin_email, admin_pw)
            call("GET", "/api/v2/me", admin, expect=200)
            check(wait_mail(admin_email, "password was changed") is not None, "password-change notice emailed")
            html = mail_html(admin_email, "Reset your")
            check("Choose a new password" in html and "max-width:600px" in html, "reset email is responsive HTML")

    section("Platform administration")
    call("GET", "/api/v2/platform/organizations", expect=401)
    call("GET", "/api/v2/platform/organizations", admin, expect=403)
    call("GET", "/api/v2/platform/email", admin, expect=403)
    if not super_token:
        print("  (skipped: set SMOKE_SUPER_TOKEN or SMOKE_SUPER_EMAIL/SMOKE_SUPER_PASSWORD to test the platform console)")
    else:
        _, orgs = call("GET", "/api/v2/platform/organizations", super_token, expect=200)
        mine = next((o for o in orgs["items"] if o["id"] == org_id), None)
        check(mine and mine["status"] == "active" and mine["member_count"] >= 2, "platform lists the organization with counts")
        check(mine and mine.get("domain") == domain, "the verified admin's company domain is attached to the organization")
        _, est = call("GET", "/api/v2/platform/email", super_token, expect=200)
        check(est["configured"] == email_on and "pass" not in est and isinstance(est["recent"], list), "platform email status never exposes the password")
        call("POST", "/api/v2/platform/email/test", super_token, {"to": "not-an-email"}, expect=422)
        _, rq = call("POST", "/api/v2/platform/email/retry", super_token, expect=200)
        check(isinstance(rq.get("requeued"), int), "platform can queue failed emails again")
        if email_on:
            call("POST", "/api/v2/platform/email/test", super_token, {"to": f"ops@{domain}"}, expect=200)
            if MAIL_DIR:
                check(wait_mail(f"ops@{domain}", "test email") is not None, "platform test email delivered")
        else:
            call("POST", "/api/v2/platform/email/test", super_token, {"to": f"ops@{domain}"}, expect=400)
        _, users = call("GET", f"/api/v2/platform/users?org_id={org_id}", super_token, expect=200)
        check(any(u["email"] == admin_email for u in users["items"]), "platform lists organization members")
        call("POST", f"/api/v2/platform/organizations/{uuid.uuid4()}/suspend", super_token, expect=404)
        _, fresh_refresh = login(admin_email, admin_pw)
        call("POST", f"/api/v2/platform/organizations/{org_id}/suspend", super_token, expect=200)
        call("GET", "/api/v2/me", admin, expect=403)
        status, _ = call("POST", "/api/v1/auth/login", body={"email": admin_email, "password": admin_pw})
        check(status in (401, 403), f"suspended organization cannot sign in (got {status})")
        status, _ = call("POST", "/api/v2/auth/refresh", body={"refresh_token": fresh_refresh})
        check(status in (401, 403), f"suspended organization cannot refresh sessions (got {status})")
        _, orgs = call("GET", "/api/v2/platform/organizations", super_token, expect=200)
        check(any(o["id"] == org_id and o["status"] == "suspended" for o in orgs["items"]), "organization shows as suspended")
        call("POST", f"/api/v2/platform/organizations/{org_id}/activate", super_token, expect=200)
        admin, _ = login(admin_email, admin_pw)
        call("GET", "/api/v2/me", admin, expect=200)
        agent_user = next(u["id"] for u in users["items"] if u["email"] == f"agent@{domain}")
        call("POST", f"/api/v2/platform/users/{agent_user}/deactivate", super_token, expect=200)
        _, users = call("GET", f"/api/v2/platform/users?org_id={org_id}", super_token, expect=200)
        check(any(u["id"] == agent_user and u["status"] == "deactivated" for u in users["items"]), "platform deactivation is reflected")
        call("POST", f"/api/v2/platform/users/{agent_user}/reactivate", super_token, expect=200)
        call("POST", f"/api/v2/platform/users/{agent_user}/unlock", super_token, expect=200)
        _, sup = call("GET", "/api/v2/platform/users?q=" + urllib.parse.quote(os.environ.get("SMOKE_SUPER_EMAIL", "admin@taskflow.com")), super_token, expect=200)
        for u in sup["items"]:
            if u["role"] == "super_admin":
                call("POST", f"/api/v2/platform/users/{u['id']}/deactivate", super_token, expect=(400, 403))

    print(f"\n{PASSES} checks passed, {len(FAILURES)} failed")
    if FAILURES:
        for f in FAILURES:
            print(" -", f)
        sys.exit(1)


if __name__ == "__main__":
    main()
