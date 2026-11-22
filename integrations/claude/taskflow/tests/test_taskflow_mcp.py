"""End-to-end tests: the real MCP server process against a fake TaskFlow API.

Run with:  python3 -m pytest integrations/claude/taskflow/tests -q
"""

from __future__ import annotations

import base64
import json
import queue
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import pytest

SERVER = Path(__file__).resolve().parents[1] / "server" / "taskflow_mcp.py"
API_KEY = "test-key-123"
ME = {
    "id": "00000000-0000-4000-8000-0000000000aa",
    "name": "Test Agent",
    "email": "agent@example.test",
    "is_agent": True,
}
RAVI = {"id": "00000000-0000-4000-8000-0000000000bb", "name": "Ravi Kumar", "email": "ravi@example.test"}
RAVINA = {"id": "00000000-0000-4000-8000-0000000000cc", "name": "Ravina Shah", "email": "ravina@example.test"}
DEV_GROUP = {"id": "00000000-0000-4000-8000-0000000000dd", "name": "Development Group"}
INC11 = "11111111-1111-4111-8111-111111111111"
SR11 = "22222222-2222-4222-8222-222222222222"
INC12 = "33333333-3333-4333-8333-333333333333"
PRB2 = "55555555-5555-4555-8555-555555555555"
WI9 = "66666666-6666-4666-8666-666666666666"
PROJECT = {"id": "77777777-7777-4777-8777-777777777777", "key": "VENDO", "name": "Vendor Web"}
DEPARTMENTS = [
    {
        "id": "88888888-8888-4888-8888-888888888888",
        "name": "Development",
        "code": "DEV",
        "children": [{"id": "99999999-9999-4999-8999-999999999999", "name": "QA"}],
    }
]
SEARCH_INDEX = [
    {"type": "ticket", "display_id": "INC-11", "id": INC11, "title": "Ticket INC-11"},
    {"type": "ticket", "display_id": "SR-11", "id": SR11, "title": "Ticket SR-11"},
    {"type": "problem", "display_id": "PRB-2", "id": PRB2, "title": "Vendor categories"},
    {"type": "work_item", "display_id": "VENDO-9", "id": WI9, "title": "Make Offer pickup default"},
]
CATEGORY_TREE = [{"value": "Software", "children": [{"value": "Business application"}]}, {"value": "Hardware"}]


def make_ticket(tid, number, ttype, display, **extra):
    t = {
        "id": tid,
        "number": number,
        "type": ttype,
        "display_id": display,
        "subject": f"Ticket {display}",
        "description": "Remove offer pickup from vendor profile.",
        "status": "open",
        "priority": 2,
        "urgency": 1,
        "impact": 1,
        "source": "phone",
        "requester": {"id": "r1", "name": "Thirupathi Keloth", "email": "keloth@example.test"},
        "responder": None,
        "group": None,
        "sla_state": "on_track",
        "category": "",
        "created_at": "2026-11-13T23:00:00Z",
        "updated_at": "2026-11-13T23:00:00Z",
    }
    t.update(extra)
    return t


class FakeTaskflow(BaseHTTPRequestHandler):
    tickets: dict = {}
    requests: list = []
    tasks: list = []
    extra_conversations: list = []

    def log_message(self, *args):  # keep test output clean
        pass

    def _send(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _handle(self, method):
        url = urlparse(self.path)
        length = int(self.headers.get("Content-Length") or 0)
        body = json.loads(self.rfile.read(length)) if length else None
        query = {k: v[0] for k, v in parse_qs(url.query).items()}
        FakeTaskflow.requests.append(
            {
                "method": method,
                "path": url.path,
                "query": query,
                "body": body,
                "auth": self.headers.get("Authorization"),
            }
        )
        expected = "Basic " + base64.b64encode(f"{API_KEY}:X".encode()).decode()
        if self.headers.get("Authorization") != expected:
            return self._send(401, {"message": "invalid API key"})
        path = url.path.removeprefix("/api/v2")
        parts = [p for p in path.split("/") if p]
        if method == "GET" and path == "/me":
            # Same shape as TaskFlow: person under "user", account details beside it,
            # and "org" is the person's department context, not the organization.
            return self._send(
                200,
                {
                    "user": ME,
                    "is_agent": True,
                    "is_account_admin": True,
                    "organization": {"id": "org-1", "name": "Kairvo"},
                    "org": {"name": "Development", "kind": "department"},
                },
            )
        if method == "GET" and path == "/agents":
            q = query.get("q", "").lower()
            people = [p for p in (ME, RAVI, RAVINA) if q in p["name"].lower() or q in p["email"]]
            return self._send(200, {"items": people, "total": len(people), "page": 1, "per_page": 25})
        if method == "GET" and path == "/groups":
            return self._send(200, [DEV_GROUP, {"id": "g2", "name": "Network"}])
        if method == "GET" and path == "/search":
            q = query.get("q", "").upper()
            return self._send(200, {"results": [r for r in SEARCH_INDEX if r["display_id"] == q]})
        if method == "GET" and path == "/departments":
            return self._send(200, {"items": DEPARTMENTS})
        if method == "GET" and path == "/projects":
            return self._send(200, {"items": [PROJECT], "total": 1})
        if method == "GET" and path == "/me/work-items":
            return self._send(
                200,
                {
                    "items": [
                        {
                            "id": WI9,
                            "display_id": "VENDO-9",
                            "title": "Make Offer pickup default",
                            "state": "in_progress",
                            "priority": "medium",
                            "project": PROJECT,
                        }
                    ]
                },
            )
        if method == "GET" and path == "/work-items/" + WI9 + "/conversations":
            return self._send(200, {"items": FakeTaskflow.extra_conversations})
        if method == "GET" and path == "/me/tasks":
            return self._send(200, {"items": [{"id": "task-1", "title": "Wire toggle", "status": "open"}]})
        if method == "GET" and path == "/problems":
            mine = {
                "id": PRB2,
                "display_id": "PRB-2",
                "subject": "Vendor categories",
                "status": "open",
                "agent_id": ME["id"],
            }
            closed = {"id": "p3", "display_id": "PRB-3", "subject": "Old", "status": "closed", "agent_id": ME["id"]}
            other = {"id": "p4", "display_id": "PRB-4", "subject": "Theirs", "status": "open", "agent_id": RAVI["id"]}
            return self._send(200, {"items": [mine, closed, other]})
        if method == "GET" and path == "/approvals":
            return self._send(200, {"items": [{"id": "ap1", "status": "requested", "entity_type": "change"}]})
        if method == "GET" and path == "/teams":
            return self._send(200, {"items": [{"id": "t1", "name": "Vendor squad"}]})
        if method == "GET" and path == "/classifications":
            return self._send(
                200,
                {"items": [{"entity": "ticket", "name": "category", "choices": json.loads(json.dumps(CATEGORY_TREE))}]},
            )
        if method == "GET" and path == "/tickets":
            items = list(FakeTaskflow.tickets.values())
            return self._send(200, {"items": items, "total": 42, "page": int(query.get("page", 1)), "per_page": 25})
        if method == "POST" and path == "/tickets":
            t = make_ticket(
                "44444444-4444-4444-8444-444444444444",
                13,
                body.get("type", "incident"),
                "INC-13",
                subject=body["subject"],
                source=body.get("source"),
            )
            return self._send(201, t)
        if len(parts) >= 2 and parts[0] == "tickets":
            t = FakeTaskflow.tickets.get(parts[1])
            if t is None:
                return self._send(404, {"message": "ticket not found"})
            if method == "GET" and len(parts) == 2:
                return self._send(200, t)
            if method == "GET" and parts[2:] == ["conversations"]:
                return self._send(
                    200,
                    {
                        "items": [
                            {
                                "id": "c1",
                                "kind": "reply",
                                "private": False,
                                "body": "Also update toggle buttons UI",
                                "author": {"name": "Test Agent", "email": "agent@example.test"},
                                "cc_emails": ["cc@example.test"],
                                "created_at": "2026-11-13T23:05:00Z",
                            },
                            {
                                "id": "c2",
                                "kind": "note",
                                "private": True,
                                "body": "Checked the vendor settings",
                                "author": {"name": "Test Agent", "email": "agent@example.test"},
                                "created_at": "2026-11-13T23:10:00Z",
                            },
                            *FakeTaskflow.extra_conversations,
                        ]
                    },
                )
            if method == "GET" and parts[2:] == ["tasks"]:
                return self._send(200, {"items": FakeTaskflow.tasks})
            if method == "PUT" and len(parts) == 2:
                if body.get("status") in ("resolved", "closed") and not (body.get("category") or t.get("category")):
                    return self._send(
                        422,
                        {"message": "validation failed", "errors": {"category": "is required to resolve the ticket"}},
                    )
                # Saved like the real server; fields in drop_on_put imitate a server without the INC-20 fix,
                # which answers with the new value but keeps the old one.
                t.update({k: v for k, v in body.items() if k not in FakeTaskflow.drop_on_put})
                return self._send(200, {**t, **body})
            if method == "POST" and parts[2:] in (["reply"], ["notes"]):
                return self._send(201, {"id": "conv-new", "body": body["body"]})
        # Anything else: echo, so tests can assert on the request that was made.
        return self._send(200, {"ok": True, "method": method, "path": path, "body": body})

    def do_DELETE(self):
        self._handle("DELETE")

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")

    def do_PUT(self):
        self._handle("PUT")


@pytest.fixture()
def api():
    FakeTaskflow.tickets = {
        INC11: make_ticket(INC11, 11, "incident", "INC-11"),
        SR11: make_ticket(SR11, 11, "service_request", "SR-11"),
        INC12: make_ticket(INC12, 12, "incident", "INC-12", category="Software"),
    }
    FakeTaskflow.requests = []
    FakeTaskflow.tasks = []
    FakeTaskflow.extra_conversations = []
    FakeTaskflow.drop_on_put = set()
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), FakeTaskflow)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{httpd.server_address[1]}"
    httpd.shutdown()


class McpProcess:
    def __init__(self, url, key, home):
        env = {"TASKFLOW_URL": url, "TASKFLOW_API_KEY": key, "HOME": str(home), "PATH": "/usr/bin:/bin"}
        self.proc = subprocess.Popen(
            [sys.executable, str(SERVER)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
        )
        self.lines: queue.Queue = queue.Queue()
        threading.Thread(target=self._read, daemon=True).start()
        self.next_id = 0

    def _read(self):
        for line in self.proc.stdout:
            self.lines.put(line)

    def send(self, msg):
        self.proc.stdin.write(json.dumps(msg).encode() + b"\n")
        self.proc.stdin.flush()

    def recv(self, timeout=10):
        return json.loads(self.lines.get(timeout=timeout))

    def request(self, method, params=None):
        self.next_id += 1
        self.send({"jsonrpc": "2.0", "id": self.next_id, "method": method, "params": params or {}})
        reply = self.recv()
        assert reply["id"] == self.next_id
        return reply

    def call(self, name, **arguments):
        reply = self.request("tools/call", {"name": name, "arguments": arguments})
        result = reply["result"]
        text = result["content"][0]["text"]
        return result["isError"], (text if result["isError"] else json.loads(text))

    def close(self):
        self.proc.stdin.close()
        self.proc.wait(timeout=5)


@pytest.fixture()
def mcp(api, tmp_path):
    proc = McpProcess(api, API_KEY, tmp_path)
    init = proc.request(
        "initialize",
        {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "pytest", "version": "1"}},
    )
    assert init["result"]["protocolVersion"] == "2025-06-18"
    proc.send({"jsonrpc": "2.0", "method": "notifications/initialized"})
    yield proc
    proc.close()


def last(method, path):
    return [r for r in FakeTaskflow.requests if r["method"] == method and r["path"] == "/api/v2" + path][-1]


def test_initialize_and_tool_list(mcp):
    tools = {t["name"]: t for t in mcp.request("tools/list")["result"]["tools"]}
    assert set(tools) == {
        "whoami",
        "list_tickets",
        "get_ticket",
        "create_ticket",
        "update_ticket",
        "close_ticket",
        "reply_to_ticket",
        "add_note",
        "search",
        "list_agents",
        "list_groups",
        "get_dashboard",
        "api_get",
        "describe_resources",
        "list_records",
        "get_record",
        "create_record",
        "update_record",
        "delete_record",
        "record_action",
        "add_category",
        "my_work",
        "log_progress",
    }
    for tool in tools.values():
        assert tool["inputSchema"]["type"] == "object"
        assert set(tool["inputSchema"]["required"]) <= set(tool["inputSchema"]["properties"])
    assert tools["get_ticket"]["annotations"]["readOnlyHint"] is True
    assert tools["reply_to_ticket"]["annotations"]["readOnlyHint"] is False
    assert tools["delete_record"]["annotations"]["destructiveHint"] is True
    assert not {"purge_ticket", "forget_person"} & set(tools)


def test_unknown_version_and_methods(api, tmp_path):
    proc = McpProcess(api, API_KEY, tmp_path)
    try:
        init = proc.request("initialize", {"protocolVersion": "1999-01-01", "capabilities": {}})
        assert init["result"]["protocolVersion"] == "2025-11-25"
        proc.send({"jsonrpc": "2.0", "method": "notifications/initialized"})  # must not be answered
        assert proc.request("ping")["result"] == {}
        assert proc.request("resources/list")["error"]["code"] == -32601
        assert proc.request("tools/call", {"name": "nope"})["error"]["code"] == -32602
        proc.proc.stdin.write(b"{not json\n")
        proc.proc.stdin.flush()
        assert proc.recv()["error"]["code"] == -32700
    finally:
        proc.close()


def test_list_tickets_maps_filters(mcp):
    failed, out = mcp.call("list_tickets", view="my_open", priority=["High", "Urgent"], agent="me", per_page=10)
    assert not failed
    req = last("GET", "/tickets")
    assert req["query"]["view"] == "my_open"
    assert req["query"]["priority"] == "3,4"
    assert req["query"]["responder_id"] == ME["id"]
    assert req["query"]["per_page"] == "10"
    assert out["total"] == 42 and out["has_more"] is True
    first = out["tickets"][0]
    assert first["ticket"] == "INC-11" and first["priority"] == "Medium" and first["agent"] == "unassigned"
    assert first["requester"] == "Thirupathi Keloth <keloth@example.test>"


def test_list_tickets_unassigned_filter(mcp):
    mcp.call("list_tickets", agent="none")
    assert last("GET", "/tickets")["query"]["responder_id"] == "none"


def test_get_ticket_by_display_id(mcp):
    failed, out = mcp.call("get_ticket", ticket="inc-11")
    assert not failed
    assert out["id"] == INC11 and out["ticket"] == "INC-11"
    assert out["url"].endswith(f"/tickets/{INC11}")
    assert [c["kind"] for c in out["conversation"]] == ["reply", "private note"]
    assert out["conversation"][0]["cc"] == ["cc@example.test"]
    assert last("GET", f"/tickets/{INC11}")["auth"] == "Basic " + base64.b64encode(b"test-key-123:X").decode()


def test_bare_number_matching_two_tickets_is_ambiguous(mcp):
    failed, text = mcp.call("get_ticket", ticket="11")
    assert failed and "INC-11" in text and "SR-11" in text


def test_missing_ticket(mcp):
    failed, text = mcp.call("get_ticket", ticket="INC-999")
    assert failed and "No ticket INC-999" in text
    failed, text = mcp.call("get_ticket", ticket="drop table")
    assert failed and "not a ticket reference" in text


def test_update_ticket_resolves_names(mcp):
    failed, out = mcp.call(
        "update_ticket",
        ticket="INC-12",
        agent="ravi@example.test",
        priority="Urgent",
        group="development group",
        status="pending",
        tags=["vendor", "ui"],
    )
    assert not failed
    body = last("PUT", f"/tickets/{INC12}")["body"]
    assert body == {
        "responder_id": RAVI["id"],
        "priority": 4,
        "group_id": DEV_GROUP["id"],
        "status": "pending",
        "tags": ["vendor", "ui"],
    }
    assert out["changed_fields"] == ["group_id", "priority", "responder_id", "status", "tags"]


def test_update_ticket_ambiguous_agent_and_unassign(mcp):
    failed, text = mcp.call("update_ticket", ticket="INC-12", agent="Ravi")
    assert failed and "several agents" in text and "ravina@example.test" in text
    failed, _ = mcp.call("update_ticket", ticket="INC-12", agent="none")
    assert not failed and last("PUT", f"/tickets/{INC12}")["body"] == {"responder_id": ""}


def test_update_ticket_rejects_bad_priority(mcp):
    failed, text = mcp.call("update_ticket", ticket="INC-12", priority="Critical")
    assert failed and "Low, Medium, High, Urgent" in text


def _calls_after_put(tid):
    calls = [(r["method"], r["path"]) for r in FakeTaskflow.requests]
    put = max(i for i, c in enumerate(calls) if c == ("PUT", f"/api/v2/tickets/{tid}"))
    return calls[put + 1 :]


def test_update_ticket_reads_back_text_and_cc(mcp):
    failed, out = mcp.call("update_ticket", ticket="INC-12", description="New text", cc_emails=["Sravan@Example.test"])
    assert not failed
    assert out["changed_fields"] == ["cc_emails", "description"]
    assert "not_saved" not in out and "warning" not in out
    assert ("GET", f"/api/v2/tickets/{INC12}") in _calls_after_put(INC12)


def test_update_ticket_reports_fields_the_server_did_not_save(mcp):
    # A server without the INC-20 fix answers 200 with the new values but keeps the old ones.
    FakeTaskflow.drop_on_put = {"description", "cc_emails"}
    failed, out = mcp.call(
        "update_ticket", ticket="INC-12", description="New text", cc_emails=["a@example.test"], tags=["vendor"]
    )
    assert not failed
    assert out["not_saved"] == ["cc_emails", "description"]
    assert out["changed_fields"] == ["tags"]
    assert "did not save" in out["warning"]


def test_update_ticket_without_text_fields_does_not_read_back(mcp):
    failed, out = mcp.call("update_ticket", ticket="INC-12", tags=["vendor"])
    assert not failed and out["changed_fields"] == ["tags"]
    assert ("GET", f"/api/v2/tickets/{INC12}") not in _calls_after_put(INC12)


def test_close_ticket_surfaces_validation(mcp):
    failed, text = mcp.call("close_ticket", ticket="INC-11", resolution_notes="Done")
    assert failed and "422" in text and "category: is required to resolve the ticket" in text
    failed, out = mcp.call("close_ticket", ticket="INC-12", resolution_notes="Toggle removed")
    assert not failed and out["updated"]["status"] == "closed"
    assert last("PUT", f"/tickets/{INC12}")["body"] == {"status": "closed", "resolution_notes": "Toggle removed"}


def test_reply_and_note(mcp):
    failed, text = mcp.call("reply_to_ticket", ticket="INC-11", body="Fixed", set_status="closed")
    assert failed and "close_ticket" in text
    failed, out = mcp.call(
        "reply_to_ticket", ticket="INC-11", body="On it", set_status="pending", cc_emails=["cc@example.test"]
    )
    assert not failed and out["status_set"] == "pending"
    assert last("POST", f"/tickets/{INC11}/reply")["body"] == {
        "body": "On it",
        "cc_emails": ["cc@example.test"],
        "status": "pending",
    }
    failed, out = mcp.call("add_note", ticket="INC-11", body="Internal")
    assert not failed and out["private"] is True
    assert last("POST", f"/tickets/{INC11}/notes")["body"] == {"body": "Internal", "private": True}


def test_create_ticket(mcp):
    failed, out = mcp.call(
        "create_ticket",
        subject="VPN down",
        priority="High",
        requester_email="user@example.test",
        requester_name="User One",
        group="Network",
    )
    assert not failed and out["created"]["ticket"] == "INC-13"
    body = last("POST", "/tickets")["body"]
    assert body == {
        "subject": "VPN down",
        "priority": 3,
        "group_id": "g2",
        "source": "api",
        "email": "user@example.test",
        "name": "User One",
    }


def test_api_get_is_read_only_and_fenced(mcp):
    for bad in ("/me/api-key", "/../admin", "tickets", "/auth/login", "/platform/users", "/x?y=1"):
        failed, _ = mcp.call("api_get", path=bad)
        assert failed, bad
    failed, _ = mcp.call("api_get", path="/api/v2/tickets", params={"q": "vpn", "page": 2})
    assert not failed
    assert last("GET", "/tickets")["query"] == {"q": "vpn", "page": "2"}


def test_wrong_key_gives_clear_error(api, tmp_path):
    proc = McpProcess(api, "wrong-key", tmp_path)
    try:
        proc.request("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}})
        failed, text = proc.call("whoami")
        assert failed and "rejected the API key" in text
    finally:
        proc.close()


def test_missing_key_explains_setup_and_key_file_works(api, tmp_path):
    proc = McpProcess(api, "${TASKFLOW_API_KEY:-}", tmp_path)  # an unexpanded value counts as unset
    try:
        proc.request("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}})
        failed, text = proc.call("whoami")
        assert failed and "Profile -> API key" in text
    finally:
        proc.close()
    key_file = tmp_path / ".config" / "taskflow" / "api_key"
    key_file.parent.mkdir(parents=True)
    key_file.write_text(API_KEY + "\n")
    proc = McpProcess(api, "", tmp_path)
    try:
        proc.request("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}})
        failed, out = proc.call("whoami")
        assert not failed and out["email"] == "agent@example.test"
    finally:
        proc.close()


def test_whoami_reports_organization(mcp):
    failed, out = mcp.call("whoami")
    assert not failed
    assert out["id"] == ME["id"] and out["name"] == "Test Agent"
    assert out["organization"] == "Kairvo"
    assert out["account_admin"] is True and out["is_agent"] is True


# ------------------------------------------------------------ resource catalog


def test_describe_resources(mcp):
    failed, out = mcp.call("describe_resources")
    assert not failed
    for name in ("problems", "changes", "releases", "projects", "work_items", "groups", "departments", "assets"):
        assert name in out["resources"], name
    assert out["resources"]["work_items"]["needs_parent"].startswith("the project")
    assert any("purge" in n for n in out["not_available"])
    failed, out = mcp.call("describe_resources", resource="groups")
    assert not failed and out["can"] == ["list", "create", "update", "delete"]
    assert out["sample_record"]["name"] == "Development Group"
    failed, text = mcp.call("describe_resources", resource="nope")
    assert failed and "Unknown resource" in text


def test_create_record_refuses_duplicates(mcp):
    failed, text = mcp.call("create_record", resource="groups", data={"name": "development  GROUP"})
    assert failed and "already exists" in text and DEV_GROUP["id"] in text
    failed, text = mcp.call("create_record", resource="groups", data={"name": "Dev Group"})
    assert failed and "Similar" in text and "Development Group" in text
    failed, text = mcp.call("create_record", resource="groups", data={"name": "Network Team"})
    assert failed and "'Network'" in text
    assert not [r for r in FakeTaskflow.requests if r["method"] == "POST"]
    failed, out = mcp.call("create_record", resource="groups", data={"name": "Platform Team", "description": "x"})
    assert not failed and last("POST", "/groups")["body"] == {"name": "Platform Team", "description": "x"}
    failed, _ = mcp.call("create_record", resource="groups", data={"name": "Network Team"}, force=True)
    assert not failed and last("POST", "/groups")["body"] == {"name": "Network Team"}


def test_change_requesters_resolve_names(mcp):
    # Both requesters of a change may be given as 'me', a name or an email; ids pass through.
    data = {"subject": "Ship the release", "requester_id": "me", "co_requester_id": "ravina@example.test"}
    failed, _ = mcp.call("create_record", resource="changes", data=data)
    assert not failed
    assert last("POST", "/changes")["body"] == {
        "subject": "Ship the release",
        "requester_id": ME["id"],
        "co_requester_id": RAVINA["id"],
    }
    change = "77777777-7777-4777-8777-777777777777"
    failed, _ = mcp.call("update_record", resource="changes", id=change, data={"requester_id": RAVI["id"], "co_requester_id": ""})
    assert not failed and last("PUT", f"/changes/{change}")["body"] == {"requester_id": RAVI["id"], "co_requester_id": ""}
    puts = len([r for r in FakeTaskflow.requests if r["method"] == "PUT"])
    failed, text = mcp.call("update_record", resource="changes", id=change, data={"co_requester_id": "ravi"})
    assert failed and "ravi" in text.lower()
    assert len([r for r in FakeTaskflow.requests if r["method"] == "PUT"]) == puts


def test_child_records_resolve_parents(mcp):
    failed, _ = mcp.call("create_record", resource="work_items", parent="VENDO", data={"title": "Toggle UI"})
    assert not failed and last("POST", f"/projects/{PROJECT['id']}/work-items")["body"] == {"title": "Toggle UI"}
    failed, _ = mcp.call("list_records", resource="tasks", parent="INC-11")
    assert not failed and last("GET", f"/tickets/{INC11}/tasks")
    failed, _ = mcp.call("create_record", resource="time_entries", parent="PRB-2", data={"minutes": 30})
    assert not failed and last("POST", f"/problems/{PRB2}/time-entries")["body"] == {"minutes": 30}
    failed, _ = mcp.call("list_records", resource="cycles", parent="Vendor Web")
    assert not failed and last("GET", f"/projects/{PROJECT['id']}/cycles")
    failed, text = mcp.call("list_records", resource="tasks")
    assert failed and "needs parent" in text
    failed, text = mcp.call("list_records", resource="tasks", parent=PRB2)
    assert failed and "parent_type" in text
    failed, _ = mcp.call("list_records", resource="tasks", parent=PRB2, parent_type="problems")
    assert not failed and last("GET", f"/problems/{PRB2}/tasks")
    failed, _ = mcp.call("list_records", resource="reports", parent="sla", params={"from": "2026-11-01"})
    assert not failed and last("GET", "/reports/sla")["query"] == {"from": "2026-11-01"}


def test_get_update_delete_by_display_id_or_name(mcp):
    failed, _ = mcp.call("get_record", resource="problems", id="prb-2")
    assert not failed and last("GET", f"/problems/{PRB2}")
    failed, _ = mcp.call("get_record", resource="work_items", id="VENDO-9")
    assert not failed and last("GET", f"/work-items/{WI9}")
    failed, _ = mcp.call("update_record", resource="groups", id="Network", data={"description": "LAN and VPN"})
    assert not failed and last("PUT", "/groups/g2")["body"] == {"description": "LAN and VPN"}
    failed, text = mcp.call("update_record", resource="groups", id="Network", data={"name": "Development Group"})
    assert failed and "already exists" in text
    failed, _ = mcp.call("update_record", resource="settings", data={"time_zone": "Asia/Kolkata"})
    assert not failed and last("PUT", "/settings")["body"] == {"time_zone": "Asia/Kolkata"}
    failed, _ = mcp.call("delete_record", resource="groups", id="Network")
    assert not failed and last("DELETE", "/groups/g2")
    failed, text = mcp.call("delete_record", resource="agents", id=RAVI["id"])
    assert failed and "does not support" in text
    failed, text = mcp.call("get_record", resource="assets", id="../admin")
    assert failed and "not a valid identifier" in text


def test_record_actions(mcp):
    failed, out = mcp.call("record_action", resource="problems", action="restore", id="PRB-2")
    assert not failed and last("POST", f"/problems/{PRB2}/restore")["body"] == {}
    failed, _ = mcp.call(
        "record_action",
        resource="tickets",
        action="set_project",
        id="INC-11",
        data={"project_id": PROJECT["id"], "state": "todo"},
    )
    assert not failed and last("PUT", f"/tickets/{INC11}/project")["body"]["state"] == "todo"
    failed, _ = mcp.call(
        "record_action", resource="teams", action="remove_member", id="Vendor squad", arg="ravi@example.test"
    )
    assert not failed and last("DELETE", f"/teams/t1/members/{RAVI['id']}")
    failed, _ = mcp.call("record_action", resource="changes", action="calendar", params={"from": "2026-11-01"})
    assert not failed and last("GET", "/changes/calendar")["query"] == {"from": "2026-11-01"}
    failed, text = mcp.call("record_action", resource="problems", action="purge", id="PRB-2")
    assert failed and "restore" in text
    failed, text = mcp.call("record_action", resource="tickets", action="apply_scenario", id="INC-11", arg="../x")
    assert failed and "not a valid identifier" in text


def test_add_category(mcp):
    failed, out = mcp.call("add_category", path=["software", "Business Application", "Vendor Portal"])
    assert not failed and out["added"] == ["Vendor Portal"]
    tree = last("PUT", "/classifications/ticket/category")["body"]["choices"]
    assert tree[0]["children"][0]["children"] == [{"value": "Vendor Portal"}]
    assert tree[1] == {"value": "Hardware"}
    before = len(FakeTaskflow.requests)
    failed, out = mcp.call("add_category", path=["Software", "Business application"])
    assert not failed and out["unchanged"] is True
    assert not [r for r in FakeTaskflow.requests[before:] if r["method"] == "PUT"]
    failed, text = mcp.call("add_category", path=["Softwares"])
    assert failed and "close to existing" in text


def test_ticket_department_project_and_duplicates(mcp):
    failed, text = mcp.call("create_ticket", subject="ticket inc-11")
    assert failed and "INC-11" in text and "already covers" in text
    failed, out = mcp.call(
        "create_ticket", subject="Toggle buttons UI", department="DEV", project="Vendor Web", project_state="todo"
    )
    assert not failed
    body = last("POST", "/tickets")["body"]
    assert body["department_id"] == DEPARTMENTS[0]["id"]
    assert body["project_id"] == PROJECT["id"] and body["project_state"] == "todo"
    failed, _ = mcp.call("create_ticket", subject="ticket inc-11", force=True)
    assert not failed
    failed, out = mcp.call("update_ticket", ticket="INC-12", project="VENDO", project_state="in_progress")
    assert not failed and "changed_fields" not in out
    assert last("PUT", f"/tickets/{INC12}/project")["body"] == {"project_id": PROJECT["id"], "state": "in_progress"}
    failed, out = mcp.call("update_ticket", ticket="INC-12", project="none", department="QA")
    assert not failed and out["project"] == "unlinked" and last("DELETE", f"/tickets/{INC12}/project")
    assert last("PUT", f"/tickets/{INC12}")["body"] == {"department_id": DEPARTMENTS[0]["children"][0]["id"]}


# ------------------------------------------------------- cross-session tracking

SESSION_LOG = {
    "id": "c9",
    "kind": "note",
    "private": True,
    "body": "[Session log] 2026-11-14 18:00 UTC\nDone:\n- Removed toggle\nNext:\n- Update toggle UI",
    "created_at": "2026-11-14T18:00:00Z",
}

# a handoff written by an earlier version of the plugin, before the marker became neutral
LEGACY_SESSION_LOG = {
    "id": "c8",
    "kind": "note",
    "private": True,
    "body": "[Claude session log] 2026-11-13 09:00 UTC\nDone:\n- Drafted toggle",
    "created_at": "2026-11-13T09:00:00Z",
}


def test_my_work_collects_open_work_and_last_logs(mcp):
    FakeTaskflow.extra_conversations = [SESSION_LOG]
    failed, out = mcp.call("my_work")
    assert not failed
    assert out["summary"] == {
        "tickets": 3,
        "work_items": 1,
        "tasks": 1,
        "problems": 1,
        "changes": 0,
        "releases": 0,
        "approvals_waiting": 1,
    }
    assert last("GET", "/tickets")["query"]["view"] == "my_open"
    assert out["tickets"][0]["last_log"]["log"].startswith("[Session log]")
    item = out["work_items"][0]
    assert item["ref"] == "VENDO-9" and item["project"] == "VENDO" and "Update toggle UI" in item["last_log"]["log"]
    assert out["problems"] == [{"ref": "PRB-2", "id": PRB2, "subject": "Vendor categories", "status": "open"}]


def test_my_work_still_reads_older_handoffs(mcp):
    FakeTaskflow.extra_conversations = [LEGACY_SESSION_LOG]
    failed, out = mcp.call("my_work")
    assert not failed
    assert out["tickets"][0]["last_log"]["log"].startswith("[Claude session log]")


def test_my_work_picks_the_newest_handoff_whichever_marker(mcp):
    FakeTaskflow.extra_conversations = [LEGACY_SESSION_LOG, SESSION_LOG]
    failed, out = mcp.call("my_work")
    assert not failed
    assert out["tickets"][0]["last_log"]["at"] == "2026-11-14T18:00:00Z"
    assert "Update toggle UI" in out["tickets"][0]["last_log"]["log"]


def test_my_work_ignores_ordinary_notes(mcp):
    FakeTaskflow.extra_conversations = [{**SESSION_LOG, "body": "Called the shop; session log to follow."}]
    failed, out = mcp.call("my_work")
    assert not failed
    assert out["tickets"][0].get("last_log") is None


def test_my_work_without_logs_skips_conversations(mcp):
    failed, out = mcp.call("my_work", include_logs=False)
    assert not failed and "last_log" not in out["tickets"][0]
    assert not [r for r in FakeTaskflow.requests if r["path"].endswith("/conversations")]


def test_log_progress_writes_handoff_and_syncs_tasks(mcp):
    FakeTaskflow.tasks = [
        {"id": "t-done", "title": "Remove toggle", "status": "open"},
        {"id": "t-old", "title": "Write tests", "status": "completed"},
    ]
    failed, out = mcp.call(
        "log_progress",
        record="INC-11",
        summary="Toggle removed, UI next",
        done=["remove toggle"],
        next=["Update toggle UI", "write tests"],
        blockers=["Need design for toggle"],
        files=["vendor-web: src/profile/Pickup.tsx"],
    )
    assert not failed
    note = last("POST", f"/tickets/{INC11}/notes")["body"]
    assert note["private"] is True
    text = note["body"]
    assert text.startswith("[Session log] ")
    assert "claude" not in text.lower()
    for part in (
        "Summary: Toggle removed, UI next",
        "Done:\n- remove toggle",
        "Next:\n- Update toggle UI",
        "Blockers:\n- Need design for toggle",
        "Files / branches / links:\n- vendor-web: src/profile/Pickup.tsx",
    ):
        assert part in text, part
    assert last("PUT", "/tasks/t-done")["body"] == {"status": "completed"}
    created = [r["body"] for r in FakeTaskflow.requests if r["method"] == "POST" and r["path"].endswith("/tasks")]
    assert created == [{"title": "Update toggle UI", "status": "open", "agent_id": ME["id"]}]
    assert out["tasks_completed"] == ["Remove toggle"] and out["tasks_created"] == ["Update toggle UI"]


def test_log_progress_status_rules(mcp):
    failed, out = mcp.call("log_progress", record="VENDO-9", done=["Shipped"], status="done", sync_tasks=False)
    assert not failed and out["status_set"] == "done"
    assert last("PUT", f"/work-items/{WI9}")["body"] == {"state": "done"}
    assert last("POST", f"/work-items/{WI9}/notes")
    failed, text = mcp.call("log_progress", record="VENDO-9", summary="x", status="finished")
    assert failed and "in_progress" in text
    failed, text = mcp.call("log_progress", record="INC-11", summary="x", status="closed")
    assert failed and "close_ticket" in text
    failed, _ = mcp.call("log_progress", record="PRB-2", summary="Root cause found", status="pending")
    assert not failed and last("PUT", f"/problems/{PRB2}")["body"] == {"status": "pending"}
    failed, text = mcp.call("log_progress", record="INC-11")
    assert failed and "summary" in text


def test_ticket_requester_by_name_email_or_me(mcp):
    failed, _ = mcp.call("update_ticket", ticket="INC-12", requester="ravi@example.test")
    assert not failed and last("PUT", f"/tickets/{INC12}")["body"] == {"requester_id": RAVI["id"]}
    failed, _ = mcp.call("create_ticket", subject="Pickup toggle copy", requester="me")
    assert not failed and last("POST", "/tickets")["body"]["requester_id"] == ME["id"]
    failed, text = mcp.call("update_ticket", ticket="INC-12", requester="Ravi")
    assert failed and "several persons" in text
