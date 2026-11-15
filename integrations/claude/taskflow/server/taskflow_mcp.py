#!/usr/bin/env python3
"""TaskFlow MCP server: lets Claude work with the TaskFlow service desk.

It speaks the Model Context Protocol over stdio (newline-delimited JSON-RPC 2.0)
and calls the TaskFlow REST API (/api/v2) with an agent API key. It uses only
the Python standard library, so it runs anywhere python3 3.9+ does.

Configuration (environment):
  TASKFLOW_URL           TaskFlow address, default https://taskflow.portalvii.com
  TASKFLOW_API_KEY       agent API key (TaskFlow -> Profile -> API key)
  TASKFLOW_API_KEY_FILE  file holding the key when TASKFLOW_API_KEY is unset,
                         default ~/.config/taskflow/api_key

Every call runs as the agent who owns the key, with that agent's permissions,
and shows up in the TaskFlow audit log. Dedicated tools cover tickets; a
resource catalog plus generic tools (list/get/create/update/delete/action)
cover the rest of the API. Not exposed: sign-in, passwords, API keys, sessions,
file transfer, ticket purge, GDPR forget and platform (super admin) endpoints.
"""

from __future__ import annotations

import base64
import json
import os
import re
import sys
import traceback
from datetime import datetime, timezone
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Callable

SERVER_NAME = "taskflow"
SERVER_VERSION = "0.2.1"
# Newest first. The server only uses tools, which every listed version supports.
PROTOCOL_VERSIONS = ("2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05")
DEFAULT_URL = "https://taskflow.portalvii.com"
REQUEST_TIMEOUT = 30.0

PRIORITY_LABELS = {1: "Low", 2: "Medium", 3: "High", 4: "Urgent"}
LEVEL_LABELS = {1: "Low", 2: "Medium", 3: "High"}
VIEWS = (
    "all",
    "open",
    "my_open",
    "unassigned",
    "my_groups",
    "overdue",
    "due_today",
    "pending",
    "resolved",
    "closed",
    "raised_by_me",
    "watching",
    "spam",
    "trash",
)
SOURCES = (
    "portal",
    "email",
    "phone",
    "chat",
    "walkup",
    "slack",
    "ms_teams",
    "api",
    "monitoring",
    "feedback_widget",
)
WORK_ITEM_STATES = ("backlog", "todo", "in_progress", "done", "cancelled")
MAX_TEXT = 6000  # longest description / message body returned to Claude

UUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
REF_RE = re.compile(r"^#?\s*(?:([A-Za-z]{1,10})\s*[-\s]?\s*)?(\d{1,12})$")

INSTRUCTIONS = """TaskFlow is an IT service desk. Tickets are incidents or service requests and are
referred to by display IDs such as INC-11 or SR-4 (a bare number or the UUID also works).
Priority is Low, Medium, High or Urgent; urgency and impact are Low, Medium or High.
Standard statuses are open, pending, resolved and closed (an account may add its own).
Agents and groups can be given by name or email; 'me' means the signed-in agent.
reply_to_ticket emails the requester, so show the user the text before sending it.
Confirm with the user before closing tickets or changing many tickets at once.
Everything beyond tickets (problems, changes, releases, approvals, projects, work items, cycles,
modules, tasks, time entries, assets, catalog, knowledge base, groups, departments, teams, SLA,
workflows, settings, ...) goes through describe_resources, list_records, get_record,
create_record, update_record, delete_record and record_action; categories through add_category.
Records can be named by display ID (PRB-2, CHG-3, VENDO-9) or exact name. create_record and
create_ticket refuse duplicates and near-duplicates: reuse what exists."""


class ToolError(Exception):
    """A failure reported to Claude as an unsuccessful tool result."""


def log(message: str) -> None:
    print(f"[taskflow-mcp] {message}", file=sys.stderr, flush=True)


# ---------------------------------------------------------------- configuration


def _unexpanded(value: str) -> bool:
    """True for a config value a client passed through without expanding it."""
    return "${" in value


def load_base_url() -> str:
    url = os.environ.get("TASKFLOW_URL", "").strip()
    if not url or _unexpanded(url):
        url = DEFAULT_URL
    return url.rstrip("/")


def load_api_key() -> str:
    key = os.environ.get("TASKFLOW_API_KEY", "").strip()
    if key and not _unexpanded(key):
        return key
    path = os.environ.get("TASKFLOW_API_KEY_FILE", "").strip()
    key_file = Path(path).expanduser() if path else Path.home() / ".config" / "taskflow" / "api_key"
    try:
        return key_file.read_text(encoding="utf-8").strip()
    except OSError:
        return ""


# ------------------------------------------------------------------ API client


def _http_error_message(err: urllib.error.HTTPError) -> str:
    try:
        payload = json.loads(err.read() or b"{}")
    except ValueError:
        payload = {}
    message = payload.get("message") if isinstance(payload, dict) else None
    fields = payload.get("errors") if isinstance(payload, dict) else None
    detail = message or err.reason or "request failed"
    if isinstance(fields, dict) and fields:
        detail += " (" + "; ".join(f"{k}: {v}" for k, v in fields.items()) + ")"
    if err.code == 401:
        return (
            f"TaskFlow rejected the API key (401: {detail}). Generate a new key under "
            "Profile -> API key and update TASKFLOW_API_KEY or ~/.config/taskflow/api_key."
        )
    if err.code == 403:
        return f"Your TaskFlow role does not allow this (403: {detail})."
    if err.code == 404:
        return f"Not found in TaskFlow (404: {detail})."
    if err.code == 429:
        return "TaskFlow is rate limiting requests (429). Wait a moment and try again."
    return f"TaskFlow returned HTTP {err.code}: {detail}"


def items_of(data: Any) -> list:
    """The record list from a list response ({items: [...]}) or a bare array."""
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for key in ("items", "results", "data"):
            if isinstance(data.get(key), list):
                return data[key]
    return []


class TaskflowClient:
    def __init__(self, base_url: str, api_key: str, timeout: float = REQUEST_TIMEOUT):
        self.base_url = base_url.rstrip("/")
        self.api = self.base_url + "/api/v2"
        self.api_key = api_key
        self.timeout = timeout
        self._me: dict | None = None

    def request(self, method: str, path: str, params: dict | None = None, body: Any = None) -> Any:
        if not self.api_key:
            raise ToolError(
                "No TaskFlow API key is configured. In TaskFlow open Profile -> API key and generate one, "
                "then either export TASKFLOW_API_KEY=<key> before starting Claude, or save the key to "
                "~/.config/taskflow/api_key (chmod 600) and restart Claude."
            )
        url = self.api + path
        if params:
            clean = {k: v for k, v in params.items() if v is not None and v != ""}
            if clean:
                url += "?" + urllib.parse.urlencode(clean)
        token = base64.b64encode(f"{self.api_key}:X".encode()).decode()
        headers = {
            "Authorization": f"Basic {token}",
            "Accept": "application/json",
            "User-Agent": f"taskflow-mcp/{SERVER_VERSION}",
        }
        data = None
        if body is not None:
            data = json.dumps(body).encode()
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                raw = resp.read()
        except urllib.error.HTTPError as err:
            raise ToolError(_http_error_message(err)) from None
        except urllib.error.URLError as err:
            raise ToolError(f"Could not reach TaskFlow at {self.base_url}: {err.reason}") from None
        except TimeoutError:
            raise ToolError(f"TaskFlow did not answer within {self.timeout:.0f} seconds.") from None
        if not raw:
            return None
        try:
            return json.loads(raw)
        except ValueError:
            return raw.decode("utf-8", "replace")

    def get(self, path: str, params: dict | None = None) -> Any:
        return self.request("GET", path, params=params)

    # -- lookups ---------------------------------------------------------------

    def me(self) -> dict:
        if self._me is None:
            me = self.get("/me")
            # /me wraps the person in "user" and puts the account details beside it.
            if isinstance(me, dict) and isinstance(me.get("user"), dict):
                extra = {k: me[k] for k in ("organization", "is_agent", "is_account_admin") if k in me}
                me = {**me["user"], **extra}
            if not isinstance(me, dict) or not me.get("id"):
                raise ToolError("TaskFlow did not return the signed-in agent.")
            self._me = me
        return self._me

    def resolve_ticket(self, ref: Any) -> str:
        """Ticket UUID for a display ID (INC-11), a number (11 or #11) or a UUID."""
        text = str(ref or "").strip()
        if UUID_RE.match(text):
            return text
        m = REF_RE.match(text)
        if not m:
            raise ToolError(
                f"'{text}' is not a ticket reference. Use a display ID like INC-11, a number, or the ticket UUID."
            )
        prefix, number = (m.group(1) or "").upper(), int(m.group(2))
        query = f"{prefix}-{number}" if prefix else str(number)
        candidates = items_of(self.get("/tickets", {"q": query, "per_page": 50}))
        matches = [
            t
            for t in candidates
            if t.get("number") == number
            and (not prefix or str(t.get("display_id", "")).upper() == f"{prefix}-{number}")
        ]
        if len(matches) == 1:
            return matches[0]["id"]
        if not matches:
            raise ToolError(
                f"No ticket {query} is visible to you (it may not exist, be deleted, or be outside your scope)."
            )
        found = ", ".join(str(t.get("display_id") or t.get("id")) for t in matches)
        raise ToolError(f"'{text}' matches several tickets ({found}). Use the full display ID.")

    def resolve_agent(self, who: Any) -> str:
        """Agent UUID for a name, email, 'me' or UUID; '' (unassign) for 'none'."""
        text = str(who or "").strip()
        if text.lower() in ("", "none", "unassigned", "nobody"):
            return ""
        if text.lower() == "me":
            return self.me()["id"]
        if UUID_RE.match(text):
            return text
        people = items_of(self.get("/agents", {"q": text, "per_page": 25}))
        return _pick_one(people, text, "agent", ("email", "name", "full_name", "username"))

    def resolve_person(self, who: Any) -> str:
        """Person UUID (agent or requester) for a name, email, 'me' or UUID."""
        text = str(who or "").strip()
        if not text:
            raise ToolError("requester must name a person.")
        if text.lower() == "me":
            return self.me()["id"]
        if UUID_RE.match(text):
            return text
        people = items_of(self.get("/agents", {"q": text, "per_page": 25}))
        try:
            people += items_of(self.get("/requesters", {"q": text, "per_page": 25}))
        except ToolError:
            pass  # roles without requester access still resolve agents
        unique = list({str(p.get("id")): p for p in people if p.get("id")}.values())
        return _pick_one(unique, text, "person", ("email", "name", "full_name", "username"))

    def resolve_group(self, name: Any) -> str:
        """Agent group UUID for a group name or UUID; '' (no group) for 'none'."""
        text = str(name or "").strip()
        if text.lower() in ("", "none"):
            return ""
        if UUID_RE.match(text):
            return text
        groups = items_of(self.get("/groups"))
        exact = [g for g in groups if str(g.get("name", "")).lower() == text.lower()]
        partial = [g for g in groups if text.lower() in str(g.get("name", "")).lower()]
        pick = exact or partial
        if len(pick) == 1:
            return pick[0]["id"]
        if not pick:
            names = ", ".join(str(g.get("name")) for g in groups[:30]) or "none"
            raise ToolError(f"No agent group matches '{text}'. Groups: {names}.")
        raise ToolError(f"'{text}' matches several groups: {', '.join(str(g.get('name')) for g in pick)}.")

    def resolve_department(self, name: Any) -> str:
        """Department (org unit) UUID for a name, code or UUID; '' (none) for 'none'."""
        text = str(name or "").strip()
        if text.lower() in ("", "none"):
            return ""
        if UUID_RE.match(text):
            return text
        units = list(_records(self.get("/departments", {"per_page": 100})))
        wanted = text.lower()
        exact = [u for u in units if wanted in (str(u.get("name", "")).lower(), str(u.get("code") or "").lower())]
        if len(exact) == 1:
            return exact[0]["id"]
        if not exact:
            names = ", ".join(str(u.get("name")) for u in units[:30]) or "none"
            raise ToolError(f"No department matches '{text}'. Departments: {names}.")
        raise ToolError(f"'{text}' matches several departments. Use the id.")

    def resolve_by_search(self, ref: str, types: tuple) -> tuple:
        """(type, id) for a display ID such as PRB-2 or VENDO-9, via global search."""
        wanted = _norm_ref(str(ref)) or str(ref).strip().upper()
        results = items_of(self.get("/search", {"q": wanted, "limit": 25}))
        hits = [
            r
            for r in results
            if str(r.get("display_id", "")).upper() == wanted and (not types or r.get("type") in types)
        ]
        if len(hits) == 1:
            return hits[0]["type"], hits[0]["id"]
        if not hits:
            raise ToolError(f"Nothing with ID {wanted} is visible to you.")
        raise ToolError(f"{wanted} matches several records. Use the UUID.")


def _pick_one(records: list, text: str, kind: str, keys: tuple) -> str:
    lowered = text.lower()
    exact = [r for r in records if any(str(r.get(k) or "").lower() == lowered for k in keys)]
    pick = exact or records
    if len(pick) == 1:
        return pick[0]["id"]
    if not pick:
        raise ToolError(f"No {kind} matches '{text}'.")
    names = ", ".join(f"{r.get('name') or r.get('full_name')} <{r.get('email')}>" for r in pick[:10])
    raise ToolError(f"'{text}' matches several {kind}s: {names}. Use the email address.")


# ------------------------------------------------------------------ formatting


def _clip(text: Any, limit: int = MAX_TEXT) -> Any:
    if isinstance(text, str) and len(text) > limit:
        return text[:limit] + f"… [{len(text) - limit} more characters]"
    return text


def _person(p: Any) -> Any:
    if not isinstance(p, dict):
        return None
    name, email = p.get("name") or p.get("full_name"), p.get("email")
    if name and email:
        return f"{name} <{email}>"
    return name or email


def _ref_name(r: Any) -> Any:
    return r.get("name") if isinstance(r, dict) else None


def _drop_empty(d: dict) -> dict:
    return {k: v for k, v in d.items() if v not in (None, "", [], {})}


def ticket_summary(t: dict) -> dict:
    return _drop_empty(
        {
            "ticket": t.get("display_id") or t.get("number"),
            "id": t.get("id"),
            "subject": t.get("subject"),
            "type": t.get("type"),
            "status": t.get("status"),
            "priority": PRIORITY_LABELS.get(t.get("priority"), t.get("priority")),
            "requester": _person(t.get("requester")),
            "agent": _person(t.get("responder")) or "unassigned",
            "group": _ref_name(t.get("group")),
            "sla": t.get("sla_state"),
            "due_by": t.get("due_by"),
            "created_at": t.get("created_at"),
            "updated_at": t.get("updated_at"),
        }
    )


def ticket_detail(t: dict) -> dict:
    out = ticket_summary(t)
    out.update(
        _drop_empty(
            {
                "description": _clip(t.get("description")),
                "urgency": LEVEL_LABELS.get(t.get("urgency"), t.get("urgency")),
                "impact": LEVEL_LABELS.get(t.get("impact"), t.get("impact")),
                "source": t.get("source"),
                "department": _ref_name(t.get("department")),
                "category": t.get("category"),
                "sub_category": t.get("sub_category"),
                "item_category": t.get("item_category"),
                "tags": t.get("tags"),
                "cc_emails": t.get("cc_emails"),
                "custom_fields": t.get("custom_fields"),
                "first_responded_at": t.get("first_responded_at"),
                "resolved_at": t.get("resolved_at"),
                "closed_at": t.get("closed_at"),
                "resolution_notes": _clip(t.get("resolution_notes")),
                "escalated": t.get("is_escalated") or None,
                "spam": t.get("is_spam") or None,
                "deleted": t.get("is_deleted") or None,
            }
        )
    )
    return out


def conversation_entry(c: dict) -> dict:
    kind = c.get("kind") or "reply"
    if kind == "note":
        kind = "private note" if c.get("private") else "public note"
    elif c.get("incoming"):
        kind = "requester message"
    return _drop_empty(
        {
            "kind": kind,
            "from": _person(c.get("author")),
            "at": c.get("created_at"),
            "to": c.get("to_emails"),
            "cc": c.get("cc_emails"),
            "body": _clip(c.get("body")),
        }
    )


def _label_to_int(value: Any, labels: dict, field: str) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, int) and value in labels:
        return value
    text = str(value).strip().lower()
    for number, label in labels.items():
        if text in (label.lower(), str(number)):
            return number
    raise ToolError(f"{field} must be one of: {', '.join(labels.values())}.")


def _string_list(value: Any, field: str) -> list | None:
    if value is None:
        return None
    if isinstance(value, str):
        value = [v.strip() for v in value.split(",")]
    if not isinstance(value, list):
        raise ToolError(f"{field} must be a list of strings.")
    return [str(v).strip() for v in value if str(v).strip()]


# ----------------------------------------------------------------------- tools


class Tool:
    def __init__(
        self,
        name: str,
        title: str,
        description: str,
        schema: dict,
        handler: Callable[[TaskflowClient, dict], Any],
        *,
        read_only: bool,
        destructive: bool = False,
        idempotent: bool = False,
        open_world: bool = False,
    ):
        self.name, self.title, self.description = name, title, description
        self.schema, self.handler = schema, handler
        self.annotations = {
            "title": title,
            "readOnlyHint": read_only,
            "destructiveHint": destructive,
            "idempotentHint": idempotent or read_only,
            "openWorldHint": open_world,
        }

    def spec(self) -> dict:
        return {
            "name": self.name,
            "title": self.title,
            "description": self.description,
            "inputSchema": self.schema,
            "annotations": self.annotations,
        }


def _schema(properties: dict, required: tuple = ()) -> dict:
    return {"type": "object", "properties": properties, "required": list(required), "additionalProperties": False}


TICKET_REF = {"type": "string", "description": "Ticket display ID (e.g. INC-11, SR-4), number, or UUID."}
PRIORITY = {"type": "string", "enum": list(PRIORITY_LABELS.values())}
LEVEL = {"type": "string", "enum": list(LEVEL_LABELS.values())}
STRINGS = {"type": "array", "items": {"type": "string"}}

EDITABLE_FIELDS = {
    "subject": {"type": "string", "maxLength": 255},
    "description": {"type": "string"},
    "type": {"type": "string", "enum": ["incident", "service_request"]},
    "priority": PRIORITY,
    "urgency": LEVEL,
    "impact": LEVEL,
    "source": {"type": "string", "enum": list(SOURCES)},
    "requester": {
        "type": "string",
        "description": "Existing person (agent or requester) as name, email or 'me'. A ticket has one requester.",
    },
    "agent": {"type": "string", "description": "Assignee: agent name, email, 'me', or 'none' to unassign."},
    "group": {"type": "string", "description": "Agent group name, or 'none'."},
    "department": {"type": "string", "description": "Department (org unit) name or code, or 'none'."},
    "project": {
        "type": "string",
        "description": "Project name, key (e.g. VENDO) or id to track the ticket in as a work item. On update, "
        "'none' unlinks it.",
    },
    "project_state": {
        "type": "string",
        "enum": list(WORK_ITEM_STATES),
        "description": "Work item state in the project.",
    },
    "category": {"type": "string"},
    "sub_category": {"type": "string"},
    "item_category": {"type": "string"},
    "tags": {**STRINGS, "description": "Replaces the ticket's tags."},
    "cc_emails": STRINGS,
    "due_by": {"type": "string", "description": "Due date-time, ISO 8601 (e.g. 2026-11-20T17:00:00Z)."},
}


def _ticket_payload(client: TaskflowClient, args: dict) -> dict:
    """Map tool arguments onto the TaskFlow ticket input."""
    body: dict[str, Any] = {}
    for key in ("subject", "description", "type", "source", "category", "sub_category", "item_category", "due_by"):
        if args.get(key) is not None:
            body[key] = args[key]
    if args.get("status") is not None:
        body["status"] = str(args["status"]).strip().lower()
    if (p := _label_to_int(args.get("priority"), PRIORITY_LABELS, "priority")) is not None:
        body["priority"] = p
    for key in ("urgency", "impact"):
        if (v := _label_to_int(args.get(key), LEVEL_LABELS, key)) is not None:
            body[key] = v
    if args.get("requester"):
        body["requester_id"] = client.resolve_person(args["requester"])
    if args.get("agent") is not None:
        body["responder_id"] = client.resolve_agent(args["agent"])
    if args.get("group") is not None:
        body["group_id"] = client.resolve_group(args["group"])
    if args.get("department") is not None:
        body["department_id"] = client.resolve_department(args["department"])
    for key in ("tags", "cc_emails"):
        if (lst := _string_list(args.get(key), key)) is not None:
            body[key] = lst
    if args.get("resolution_notes") is not None:
        body["resolution_notes"] = args["resolution_notes"]
    return body


def tool_whoami(client: TaskflowClient, args: dict) -> Any:
    me = client.me()
    return _drop_empty(
        {
            "id": me.get("id"),
            "name": me.get("name") or me.get("full_name"),
            "email": me.get("email"),
            "job_title": me.get("job_title"),
            "is_agent": me.get("is_agent"),
            "role": me.get("role") or me.get("platform_role"),
            "organization": _ref_name(me.get("organization")),
            "account_admin": me.get("is_account_admin") or None,
            "taskflow_url": client.base_url,
        }
    )


def tool_list_tickets(client: TaskflowClient, args: dict) -> Any:
    view = args.get("view") or "all"
    if view not in VIEWS:
        raise ToolError(f"view must be one of: {', '.join(VIEWS)}.")
    priorities = args.get("priority")
    if isinstance(priorities, str):
        priorities = [priorities]
    params: dict[str, Any] = {
        "view": None if view == "all" else view,
        "q": args.get("query"),
        "status": ",".join(_string_list(args.get("status"), "status") or []),
        "priority": ",".join(str(_label_to_int(p, PRIORITY_LABELS, "priority")) for p in priorities or []),
        "type": args.get("type"),
        "tag": args.get("tag"),
        "category": args.get("category"),
        "created_from": args.get("created_from"),
        "created_to": args.get("created_to"),
        "sort": args.get("sort"),
        "order": args.get("order"),
        "page": args.get("page") or 1,
        "per_page": min(int(args.get("per_page") or 25), 100),
    }
    if args.get("agent") is not None:
        params["responder_id"] = client.resolve_agent(args["agent"]) or "none"
    if args.get("group") is not None:
        params["group_id"] = client.resolve_group(args["group"])
    if args.get("department") is not None:
        params["department_id"] = client.resolve_department(args["department"])
    data = client.get("/tickets", params)
    tickets = [ticket_summary(t) for t in items_of(data)]
    total = data.get("total", len(tickets)) if isinstance(data, dict) else len(tickets)
    page, per_page = params["page"], params["per_page"]
    return {"total": total, "page": page, "per_page": per_page, "has_more": page * per_page < total, "tickets": tickets}


def tool_get_ticket(client: TaskflowClient, args: dict) -> Any:
    tid = client.resolve_ticket(args.get("ticket"))
    ticket = client.get(f"/tickets/{tid}")
    if isinstance(ticket, dict) and isinstance(ticket.get("ticket"), dict):
        ticket = ticket["ticket"]
    out = ticket_detail(ticket)
    out["url"] = f"{client.base_url}/tickets/{tid}"
    if args.get("include_conversation", True):
        convs = items_of(client.get(f"/tickets/{tid}/conversations"))
        out["conversation"] = [conversation_entry(c) for c in convs]
    return out


def tool_create_ticket(client: TaskflowClient, args: dict) -> Any:
    if not str(args.get("subject") or "").strip():
        raise ToolError("subject is required.")
    if not args.get("force"):
        _refuse_duplicate_ticket(client, str(args["subject"]))
    body = _ticket_payload(client, args)
    body.setdefault("source", "api")
    if args.get("requester_email"):
        body["email"] = args["requester_email"]
        if args.get("requester_name"):
            body["name"] = args["requester_name"]
    if args.get("project"):
        body["project_id"] = resolve_record(client, RESOURCES["projects"], args["project"])
        if args.get("project_state"):
            body["project_state"] = args["project_state"]
    created = client.request("POST", "/tickets", body=body)
    if isinstance(created, dict) and isinstance(created.get("ticket"), dict):
        created = created["ticket"]
    out = ticket_summary(created) if isinstance(created, dict) else {"result": created}
    if isinstance(created, dict) and created.get("id"):
        out["url"] = f"{client.base_url}/tickets/{created['id']}"
    return {"created": out}


# A TaskFlow server without the INC-20 fix answers 200 to an edit that changes only these fields
# but does not save it, so after such an edit the ticket is read back to check.
CHECK_SAVED = ("description", "resolution_notes", "cc_emails")


def _email_list(value: Any) -> list[str]:
    return sorted(e for e in (str(x).strip().lower() for x in (value or [])) if e)


def _not_saved(sent: dict, stored: dict) -> list[str]:
    missed = []
    for key in CHECK_SAVED:
        if key not in sent:
            continue
        if key == "cc_emails":
            same = _email_list(sent[key]) == _email_list(stored.get(key))
        else:
            same = str(sent[key] or "") == str(stored.get(key) or "")
        if not same:
            missed.append(key)
    return missed


def tool_update_ticket(client: TaskflowClient, args: dict) -> Any:
    tid = client.resolve_ticket(args.get("ticket"))
    fields = {k: v for k, v in args.items() if k not in ("ticket", "project", "project_state")}
    project = args.get("project")
    if not fields and project is None:
        raise ToolError("Give at least one field to change.")
    out: dict[str, Any] = {"updated": str(args.get("ticket"))}
    body = _ticket_payload(client, fields)
    if body:
        updated = client.request("PUT", f"/tickets/{tid}", body=body)
        if isinstance(updated, dict) and isinstance(updated.get("ticket"), dict):
            updated = updated["ticket"]
        if isinstance(updated, dict) and updated.get("id"):
            out["updated"] = ticket_summary(updated)
        out["changed_fields"] = sorted(body)
        if any(key in body for key in CHECK_SAVED):
            stored = client.get(f"/tickets/{tid}")
            if isinstance(stored, dict) and isinstance(stored.get("ticket"), dict):
                stored = stored["ticket"]
            missed = _not_saved(body, stored) if isinstance(stored, dict) else []
            if missed:
                out["changed_fields"] = sorted(set(body) - set(missed))
                out["not_saved"] = sorted(missed)
                out["warning"] = (
                    "TaskFlow accepted these fields but did not save them. Send them again together with a "
                    "change to another field (for example a tag), then read the ticket to check."
                )
    if project is not None:
        if str(project).strip().lower() in ("", "none"):
            client.request("DELETE", f"/tickets/{tid}/project")
            out["project"] = "unlinked"
        else:
            link = {"project_id": resolve_record(client, RESOURCES["projects"], project)}
            if args.get("project_state"):
                link["state"] = args["project_state"]
            out["project"] = _trim(client.request("PUT", f"/tickets/{tid}/project", body=link))
    return out


def _refuse_duplicate_ticket(client: TaskflowClient, subject: str) -> None:
    """Raise if an unresolved ticket already has the same (or near-same) subject."""
    wanted = _normalize(subject)
    if not wanted:
        return
    for t in items_of(client.get("/tickets", {"view": "open", "q": subject, "per_page": 50})):
        have = _normalize(t.get("subject"))
        if have == wanted or (len(wanted) >= 12 and _similar(have, wanted)):
            raise ToolError(
                f"An open ticket already covers this: {t.get('display_id')} '{t.get('subject')}' "
                f"({t.get('status')}). Update it instead, or pass force=true if this is genuinely separate work."
            )


def tool_close_ticket(client: TaskflowClient, args: dict) -> Any:
    status = (args.get("status") or "closed").lower()
    if status not in ("closed", "resolved"):
        raise ToolError("status must be closed or resolved.")
    update = {"ticket": args.get("ticket"), "status": status}
    if args.get("resolution_notes"):
        update["resolution_notes"] = args["resolution_notes"]
    return tool_update_ticket(client, update)


def tool_reply_to_ticket(client: TaskflowClient, args: dict) -> Any:
    tid = client.resolve_ticket(args.get("ticket"))
    body_text = str(args.get("body") or "").strip()
    if not body_text:
        raise ToolError("body is required.")
    payload: dict[str, Any] = {"body": body_text}
    if cc := _string_list(args.get("cc_emails"), "cc_emails"):
        payload["cc_emails"] = cc
    status = str(args.get("set_status") or "").strip().lower()
    if status in ("resolved", "closed"):
        raise ToolError("Use close_ticket to resolve or close a ticket, so the closure checks run.")
    if status:
        payload["status"] = status
    conv = client.request("POST", f"/tickets/{tid}/reply", body=payload)
    return {
        "replied": str(args.get("ticket")),
        "conversation_id": conv.get("id") if isinstance(conv, dict) else None,
        "status_set": status or None,
    }


def tool_add_note(client: TaskflowClient, args: dict) -> Any:
    tid = client.resolve_ticket(args.get("ticket"))
    body_text = str(args.get("body") or "").strip()
    if not body_text:
        raise ToolError("body is required.")
    private = args.get("private", True)
    conv = client.request("POST", f"/tickets/{tid}/notes", body={"body": body_text, "private": bool(private)})
    return {
        "noted": str(args.get("ticket")),
        "private": bool(private),
        "conversation_id": conv.get("id") if isinstance(conv, dict) else None,
    }


def tool_search(client: TaskflowClient, args: dict) -> Any:
    query = str(args.get("query") or "").strip()
    if not query:
        raise ToolError("query is required.")
    data = client.get("/search", {"q": query, "limit": min(int(args.get("limit") or 10), 25)})
    return {
        "results": [
            _drop_empty({k: r.get(k) for k in ("type", "display_id", "title", "subtitle", "id")})
            for r in items_of(data)
        ]
    }


def tool_list_agents(client: TaskflowClient, args: dict) -> Any:
    data = client.get("/agents", {"q": args.get("query"), "per_page": min(int(args.get("per_page") or 25), 100)})
    return {
        "agents": [
            _drop_empty(
                {
                    "id": p.get("id"),
                    "name": p.get("name") or p.get("full_name"),
                    "email": p.get("email"),
                    "job_title": p.get("job_title"),
                    "active": p.get("active"),
                    "groups": [g.get("name") for g in p.get("groups") or [] if isinstance(g, dict)],
                }
            )
            for p in items_of(data)
        ]
    }


def tool_list_groups(client: TaskflowClient, args: dict) -> Any:
    return {
        "groups": [
            _drop_empty({"id": g.get("id"), "name": g.get("name"), "description": g.get("description")})
            for g in items_of(client.get("/groups"))
        ]
    }


def tool_dashboard(client: TaskflowClient, args: dict) -> Any:
    return client.get("/dashboard")


BLOCKED_GET_PREFIXES = ("/me/api-key", "/auth", "/platform")


def tool_api_get(client: TaskflowClient, args: dict) -> Any:
    path = str(args.get("path") or "").strip()
    if not path.startswith("/") or ".." in path or "?" in path or "#" in path or "//" in path:
        raise ToolError(
            "path must be an /api/v2 path such as /problems or /assets/<id>; pass query parameters in params."
        )
    if path.startswith("/api/v2/"):
        path = path[len("/api/v2") :]
    if any(path == p or path.startswith(p + "/") for p in BLOCKED_GET_PREFIXES):
        raise ToolError(f"{path} is not available through this connector.")
    params = args.get("params") or {}
    if not isinstance(params, dict):
        raise ToolError("params must be an object of query parameters.")
    return client.get(path, {k: str(v) for k, v in params.items()})


# ------------------------------------------------------------ resource catalog
#
# Every TaskFlow /api/v2 resource, so a handful of generic tools can reach the
# whole service desk. Paths use {id} (record), {parent} (owning project/record or
# report kind) and {arg} (a second id, e.g. a scenario or team member).

SAFE_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,127}$")
RECORD_MODULES = {
    "ticket": "tickets",
    "problem": "problems",
    "change": "changes",
    "release": "releases",
    "work_item": "work-items",
}
REPORT_KINDS = ("ticket-volume", "sla", "agent-performance", "group-performance", "csat", "assets")
DUP_FIELDS = ("email", "name", "title", "subject", "label")
NAME_FIELDS = ("name", "title", "subject", "email", "label", "key")
NOT_AVAILABLE = (
    "sign-in, passwords, API keys and sessions (/auth, /me/password, /me/api-key, /me/sessions)",
    "file uploads and downloads (attachments, avatars)",
    "permanent deletes: ticket purge and GDPR 'forget' of a person",
    "admin password resets for other people",
    "platform (super admin) endpoints",
)
PARENT_HELP = {
    "project": "the project name, key (e.g. VENDO) or id",
    "record": "the ticket, problem, change, release or work item it belongs to (e.g. INC-11, PRB-2, VENDO-9)",
    "report": "the report kind: " + ", ".join(REPORT_KINDS),
}


class Action:
    def __init__(self, method: str, path: str, desc: str, destructive: bool = False):
        self.method, self.path, self.desc, self.destructive = method, path, desc, destructive
        self.needs_id = "{id}" in path
        self.needs_arg = "{arg}" in path


class Resource:
    def __init__(
        self,
        name: str,
        desc: str,
        *,
        collection: str | None = None,
        item: str | None = None,
        ops: str = "",
        get: str | None = None,
        parent: str | None = None,
        search_type: str | None = None,
        dup: bool = True,
        dup_source: str | None = None,
        actions: dict | None = None,
        notes: str | None = None,
    ):
        self.name, self.desc, self.notes = name, desc, notes
        self.collection, self.item, self.get_path = collection, item, get or item
        self.ops = set(ops)
        self.parent, self.search_type = parent, search_type
        self.dup, self.dup_source = dup, dup_source
        self.actions: dict[str, Action] = actions or {}
        self.singleton = item is not None and "{id}" not in item

    def can(self) -> list:
        words = {"L": "list", "G": "get", "C": "create", "U": "update", "D": "delete"}
        return [words[o] for o in "LGCUD" if o in self.ops]


def _restore(base: str, what: str) -> dict:
    return {"restore": Action("POST", base + "/{id}/restore", f"Restore a deleted {what}")}


_SHARED_NOTE = "parent is the owning record, e.g. INC-11, PRB-2, CHG-3, REL-1 or VENDO-9 (use parent_type with a UUID)."

RESOURCE_LIST = [
    # -- service management ------------------------------------------------------
    Resource(
        "tickets",
        "Incidents and service requests. Prefer the dedicated ticket tools; use this for trash, spam, watch, "
        "forward, merge, scenarios, ratings, project links, bulk updates and export.",
        collection="/tickets",
        item="/tickets/{id}",
        ops="LGD",
        search_type="ticket",
        dup=False,
        actions={
            "restore": Action("POST", "/tickets/{id}/restore", "Restore a ticket from trash"),
            "mark_spam": Action("POST", "/tickets/{id}/spam", "Mark the ticket as spam", destructive=True),
            "unmark_spam": Action("POST", "/tickets/{id}/unspam", "Mark the ticket as not spam"),
            "watch": Action("POST", "/tickets/{id}/watch", "Watch the ticket"),
            "unwatch": Action("DELETE", "/tickets/{id}/watch", "Stop watching the ticket"),
            "forward": Action(
                "POST", "/tickets/{id}/forward", "Email the ticket on: data {body, to_emails, cc_emails}"
            ),
            "merge": Action(
                "POST", "/tickets/{id}/merge", "Merge other tickets into this one: data {ticket_ids, note}", True
            ),
            "apply_scenario": Action("POST", "/tickets/{id}/scenarios/{arg}", "Run a scenario; arg = scenario id"),
            "rate": Action("POST", "/tickets/{id}/rating", "Record satisfaction: data {rating, feedback}"),
            "get_project": Action("GET", "/tickets/{id}/project", "The project work item linked to the ticket"),
            "set_project": Action("PUT", "/tickets/{id}/project", "Link to a project: data {project_id, state}"),
            "unlink_project": Action("DELETE", "/tickets/{id}/project", "Unlink the ticket from its project"),
            "bulk_update": Action("POST", "/tickets/bulk", "Change many tickets at once: data {ids, ...fields}", True),
            "export": Action("GET", "/tickets/export", "Export tickets as CSV; params = list filters"),
        },
    ),
    Resource(
        "requested_items",
        "Catalog items requested on a service request (fulfilment status).",
        item="/requested-items/{id}",
        ops="U",
        dup=False,
    ),
    Resource(
        "problems",
        "Problems: root cause of one or more incidents, known errors, workarounds.",
        collection="/problems",
        item="/problems/{id}",
        ops="LGCUD",
        search_type="problem",
        actions=_restore("/problems", "problem"),
    ),
    Resource(
        "changes",
        "Change requests: planned changes to production with risk, plans, approvals and schedule.",
        collection="/changes",
        item="/changes/{id}",
        ops="LGCUD",
        search_type="change",
        actions={
            **_restore("/changes", "change"),
            "request_approval": Action(
                "POST", "/changes/{id}/approvals", "Ask for approval: data {approver_ids, group_id}"
            ),
            "calendar": Action("GET", "/changes/calendar", "Change calendar; params {from, to}"),
        },
    ),
    Resource(
        "releases",
        "Releases: bundles of changes shipped together.",
        collection="/releases",
        item="/releases/{id}",
        ops="LGCUD",
        search_type="release",
        actions=_restore("/releases", "release"),
    ),
    Resource(
        "approvals",
        "Approval requests. update = respond with data {status: approved|rejected, remark}.",
        collection="/approvals",
        item="/approvals/{id}",
        ops="LU",
        dup=False,
    ),
    # -- records shared by tickets, problems, changes, releases and work items -----
    Resource(
        "tasks",
        "To-dos on a ticket, problem, change, release or work item.",
        collection="/{parent}/tasks",
        item="/tasks/{id}",
        ops="LCUD",
        parent="record",
        dup=False,
        notes=_SHARED_NOTE,
    ),
    Resource(
        "time_entries",
        "Time logged on a ticket, problem, change, release or work item.",
        collection="/{parent}/time-entries",
        item="/time-entries/{id}",
        ops="LCUD",
        parent="record",
        dup=False,
        actions={"toggle_timer": Action("POST", "/time-entries/{id}/toggle", "Start or stop the timer")},
        notes=_SHARED_NOTE,
    ),
    Resource(
        "notes",
        "Notes on a problem, change, release or work item (for tickets use add_note). data {body, private}.",
        collection="/{parent}/notes",
        ops="C",
        parent="record",
        dup=False,
        notes=_SHARED_NOTE,
    ),
    Resource(
        "conversations",
        "Replies and notes on a record. Edit or delete one by id.",
        collection="/{parent}/conversations",
        item="/conversations/{id}",
        ops="LUD",
        parent="record",
        dup=False,
        notes=_SHARED_NOTE,
    ),
    Resource(
        "associations",
        "Links between records (ticket to problem, change to release, ...): data {target_type, target_id, link_type}.",
        collection="/{parent}/associations",
        item="/associations/{id}",
        ops="LCD",
        parent="record",
        dup=False,
        notes=_SHARED_NOTE,
    ),
    Resource(
        "activities",
        "Activity history of a record.",
        collection="/{parent}/activities",
        ops="L",
        parent="record",
        notes=_SHARED_NOTE,
    ),
    Resource(
        "attachments",
        "Attachments on a record (list only).",
        collection="/{parent}/attachments",
        ops="L",
        parent="record",
        notes=_SHARED_NOTE,
    ),
    # -- projects ------------------------------------------------------------------
    Resource(
        "projects",
        "Projects (planned work) with a key such as VENDO; work items, cycles and modules live inside them.",
        collection="/projects",
        item="/projects/{id}",
        ops="LGCUD",
    ),
    Resource(
        "work_items",
        "Work items in a project (states: " + ", ".join(WORK_ITEM_STATES) + ").",
        collection="/projects/{parent}/work-items",
        item="/work-items/{id}",
        ops="LGCUD",
        parent="project",
        search_type="work_item",
        actions={
            "relate": Action("POST", "/work-items/{id}/relations", "Relate to another item: data {type, target_id}"),
            "unrelate": Action("DELETE", "/work-items/{id}/relations/{arg}", "Remove a relation; arg = link id"),
            "subscribe": Action("POST", "/work-items/{id}/subscribe", "Subscribe to updates"),
            "unsubscribe": Action("DELETE", "/work-items/{id}/subscribe", "Unsubscribe"),
        },
    ),
    Resource("my_work_items", "Work items assigned to you across projects.", collection="/me/work-items", ops="L"),
    Resource(
        "cycles",
        "Cycles (sprints) in a project.",
        collection="/projects/{parent}/cycles",
        item="/cycles/{id}",
        ops="LCUD",
        parent="project",
    ),
    Resource(
        "modules",
        "Modules (feature areas) in a project.",
        collection="/projects/{parent}/modules",
        item="/modules/{id}",
        ops="LCUD",
        parent="project",
    ),
    # -- assets and procurement -------------------------------------------------------
    Resource(
        "asset_types", "Asset types (CMDB classes).", collection="/asset-types", item="/asset-types/{id}", ops="LCUD"
    ),
    Resource(
        "assets",
        "Assets / configuration items (CMDB).",
        collection="/assets",
        item="/assets/{id}",
        ops="LGCUD",
        search_type="asset",
        actions={
            **_restore("/assets", "asset"),
            "relate": Action("POST", "/assets/{id}/relationships", "Relate assets: data {target_id, type}"),
            "impact": Action("GET", "/assets/{id}/impact", "What depends on this asset"),
            "associations": Action("GET", "/assets/{id}/associations", "Tickets and records linked to the asset"),
            "associate": Action(
                "POST", "/assets/{id}/associations", "Link to a record: data {target_type, target_id, link_type}"
            ),
            "export": Action("GET", "/assets/export", "Export assets as CSV"),
        },
    ),
    Resource("asset_relationships", "Asset relationships.", item="/relationships/{id}", ops="D"),
    Resource("products", "Products (asset models).", collection="/products", item="/products/{id}", ops="LCUD"),
    Resource("vendors", "Vendors.", collection="/vendors", item="/vendors/{id}", ops="LCUD"),
    Resource(
        "software",
        "Software and licences.",
        collection="/software",
        item="/software/{id}",
        ops="LGCUD",
        actions={
            "add_installation": Action(
                "POST", "/software/{id}/installations", "Record an installation: data {asset_id, version, user_id}"
            )
        },
    ),
    Resource("software_installations", "Software installations.", item="/installations/{id}", ops="D"),
    Resource("contracts", "Contracts.", collection="/contracts", item="/contracts/{id}", ops="LCUD"),
    Resource(
        "purchase_orders",
        "Purchase orders.",
        collection="/purchase-orders",
        item="/purchase-orders/{id}",
        ops="LGCUD",
        dup=False,
        actions={
            "receive": Action(
                "POST", "/purchase-orders/{id}/receive", "Receive items: data {id, quantity, location_id}"
            )
        },
    ),
    # -- catalog and knowledge ------------------------------------------------------------
    Resource("catalog", "The service catalog: categories and their items.", collection="/catalog", ops="L"),
    Resource(
        "catalog_items",
        "Service catalog items people can request.",
        collection="/catalog/items",
        item="/catalog/items/{id}",
        ops="GCUD",
        dup_source="/catalog",
        actions={
            "request": Action(
                "POST",
                "/catalog/items/{id}/request",
                "Raise a service request for the item: data {quantity, requested_for_id, fields, notes}",
            )
        },
    ),
    Resource(
        "catalog_categories",
        "Service catalog categories.",
        collection="/catalog/categories",
        item="/catalog/categories/{id}",
        ops="CUD",
        dup_source="/catalog",
    ),
    Resource("solutions", "Knowledge base tree: categories and folders.", collection="/solutions", ops="L"),
    Resource(
        "solution_articles",
        "Knowledge base articles.",
        collection="/solutions/articles",
        item="/solutions/articles/{id}",
        ops="LGCUD",
        search_type="article",
        actions={
            "vote": Action("POST", "/solutions/articles/{id}/vote", "Rate an article: data {helpful}"),
            "suggest": Action("GET", "/solutions/suggest", "Articles matching text: params {q}"),
        },
    ),
    Resource(
        "solution_categories",
        "Knowledge base categories.",
        collection="/solutions/categories",
        item="/solutions/categories/{id}",
        ops="CUD",
        dup_source="/solutions",
    ),
    Resource(
        "solution_folders",
        "Knowledge base folders.",
        collection="/solutions/folders",
        item="/solutions/folders/{id}",
        ops="CUD",
        dup_source="/solutions",
    ),
    Resource("announcements", "Announcements.", collection="/announcements", item="/announcements/{id}", ops="LCUD"),
    # -- people and organization --------------------------------------------------------
    Resource(
        "agents",
        "Agents (people who work tickets).",
        collection="/agents",
        item="/agents/{id}",
        get="/people/{id}",
        ops="LGCU",
    ),
    Resource(
        "requesters",
        "Requesters (people who raise tickets).",
        collection="/requesters",
        item="/requesters/{id}",
        get="/people/{id}",
        ops="LGCU",
    ),
    Resource(
        "people",
        "Any person, by id: account actions.",
        item="/people/{id}",
        ops="G",
        dup=False,
        actions={
            "convert_to_agent": Action("POST", "/people/{id}/convert-to-agent", "Make the requester an agent"),
            "convert_to_requester": Action("POST", "/people/{id}/convert-to-requester", "Make the agent a requester"),
            "deactivate": Action("POST", "/people/{id}/deactivate", "Deactivate the account", destructive=True),
            "reactivate": Action("POST", "/people/{id}/reactivate", "Reactivate the account"),
            "unlock": Action("POST", "/people/{id}/unlock", "Unlock after failed sign-ins"),
            "invite": Action("POST", "/people/{id}/invite", "Resend the invitation email"),
            "bulk": Action("POST", "/people/bulk", "Bulk change people: data {ids, action, value}", True),
            "import": Action("POST", "/people/import", "Import people from CSV: data {kind, csv, dry_run}", True),
            "export": Action("GET", "/people/export", "Export people as CSV: params {kind}"),
        },
    ),
    Resource("org_chart", "Org chart of people and managers.", collection="/org-chart/people", ops="L"),
    Resource(
        "groups", "Agent groups that tickets are assigned to.", collection="/groups", item="/groups/{id}", ops="LCUD"
    ),
    Resource(
        "departments",
        "Departments / org units (kind, parent_id, code, cost_center, location_id, domains).",
        collection="/departments",
        item="/departments/{id}",
        ops="LCUD",
    ),
    Resource("locations", "Locations.", collection="/locations", item="/locations/{id}", ops="LCUD"),
    Resource(
        "teams",
        "Teams of people (with membership rules).",
        collection="/teams",
        item="/teams/{id}",
        ops="LGCUD",
        actions={
            "members": Action("GET", "/teams/{id}/members", "List team members"),
            "add_members": Action("POST", "/teams/{id}/members", "Add people: data {user_ids}"),
            "remove_member": Action("DELETE", "/teams/{id}/members/{arg}", "Remove a person; arg = user id"),
            "preview": Action("POST", "/teams/preview", "Preview who membership rules would include"),
        },
    ),
    Resource("job_roles", "Job roles.", collection="/job-roles", item="/job-roles/{id}", ops="LCUD"),
    Resource("roles", "Agent roles and their privileges.", collection="/roles", item="/roles/{id}", ops="LCUD"),
    Resource("oncall", "On-call schedules.", collection="/oncall", item="/oncall/{id}", ops="LCUD"),
    # -- service desk configuration -----------------------------------------------------
    Resource(
        "settings", "Helpdesk settings (one record).", collection="/settings", item="/settings", ops="LU", dup=False
    ),
    Resource(
        "business_hours",
        "Business hours calendars.",
        collection="/business-hours",
        item="/business-hours/{id}",
        ops="LCUD",
    ),
    Resource("sla_policies", "SLA policies.", collection="/sla-policies", item="/sla-policies/{id}", ops="LCUD"),
    Resource("workflows", "Workflow automator rules.", collection="/workflows", item="/workflows/{id}", ops="LCUD"),
    Resource("scenarios", "Scenario automations.", collection="/scenarios", item="/scenarios/{id}", ops="LCUD"),
    Resource(
        "canned_responses",
        "Canned responses.",
        collection="/canned-responses",
        item="/canned-responses/{id}",
        ops="LCUD",
        actions={"render": Action("GET", "/canned-responses/{id}/render", "Render for a ticket: params {ticket_id}")},
    ),
    Resource("canned_folders", "Canned response folders.", collection="/canned-folders", ops="C"),
    Resource(
        "form_fields", "Ticket and record form fields.", collection="/form-fields", item="/form-fields/{id}", ops="LCUD"
    ),
    Resource(
        "classifications",
        "Category trees (id = entity/name, e.g. ticket/category). Update replaces the whole tree: use add_category.",
        collection="/classifications",
        item="/classifications/{id}",
        ops="LU",
        dup=False,
        actions={"reset": Action("POST", "/classifications/{id}/reset", "Reset a tree to defaults", True)},
    ),
    Resource(
        "survey",
        "Satisfaction survey settings (one record).",
        collection="/survey",
        item="/survey",
        ops="LU",
        dup=False,
    ),
    Resource(
        "email_templates",
        "Email templates.",
        collection="/email-templates",
        item="/email-templates/{id}",
        ops="LU",
        dup=False,
    ),
    Resource(
        "email_outbox",
        "Outgoing email queue.",
        collection="/email-outbox",
        ops="L",
        actions={"retry": Action("POST", "/email-outbox/retry", "Retry failed emails")},
    ),
    Resource("audit_logs", "Audit log.", collection="/audit-logs", ops="L"),
    Resource("reports", "Reports.", collection="/reports/{parent}", ops="L", parent="report"),
    # -- you ---------------------------------------------------------------------------
    Resource("me", "Your profile (one record).", collection="/me", item="/me", ops="LU", dup=False),
    Resource("availability", "Your availability for assignment.", item="/me/availability", ops="U", dup=False),
    Resource("out_of_office", "Your out-of-office.", item="/me/out-of-office", ops="UD", dup=False),
    Resource(
        "notification_preferences",
        "Your notification preferences.",
        collection="/me/notification-preferences",
        item="/me/notification-preferences",
        ops="LU",
        dup=False,
    ),
    Resource(
        "notifications",
        "Your notifications.",
        collection="/me/notifications",
        ops="L",
        actions={"mark_read": Action("POST", "/me/notifications/read", "Mark notifications read: data {ids}")},
    ),
    Resource("my_tasks", "Tasks assigned to you.", collection="/me/tasks", ops="L"),
]
RESOURCES = {r.name: r for r in RESOURCE_LIST}


def _resource(name: Any) -> Resource:
    key = str(name or "").strip().lower().replace("-", "_").replace(" ", "_")
    res = RESOURCES.get(key)
    if res is None:
        raise ToolError(f"Unknown resource '{name}'. Call describe_resources to see them all.")
    return res


def _require(res: Resource, op: str) -> None:
    if op not in res.ops:
        can = ", ".join(res.can()) or "only its actions"
        raise ToolError(f"{res.name} does not support that; it supports: {can}.")


def _segment(value: Any, what: str) -> str:
    text = str(value or "").strip()
    if not SAFE_ID_RE.match(text) or ".." in text:
        raise ToolError(f"{what} '{text}' is not a valid identifier.")
    return text


def _normalize(text: Any) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", str(text or "").lower()).split())


def _similar(a: str, b: str) -> bool:
    """Same or near-same names: 'Dev Group' ~ 'Development Group', 'Network' ~ 'Network Team'."""
    if not a or not b:
        return False
    if a == b:
        return True
    if min(len(a), len(b)) >= 4 and (f" {a} " in f" {b} " or f" {b} " in f" {a} "):
        return True
    ta, tb = a.split(), b.split()
    return len(ta) == len(tb) and all(
        min(len(x), len(y)) >= 3 and (x.startswith(y) or y.startswith(x)) for x, y in zip(ta, tb)
    )


def _records(obj: Any):
    """Records in a list response or a tree (following nested lists, not nested references)."""
    if isinstance(obj, list):
        for value in obj:
            yield from _records(value)
    elif isinstance(obj, dict):
        if obj.get("id") is not None:
            yield obj
        for value in obj.values():
            if isinstance(value, list):
                yield from _records(value)


def _trim(obj: Any) -> Any:
    if isinstance(obj, str):
        return _clip(obj, 3000)
    if isinstance(obj, list):
        out = [_trim(v) for v in obj[:100]]
        if len(obj) > 100:
            out.append(f"… {len(obj) - 100} more")
        return out
    if isinstance(obj, dict):
        return {k: _trim(v) for k, v in obj.items()}
    return obj


def _norm_ref(text: str) -> str | None:
    m = REF_RE.match(text.strip())
    if not m or not m.group(1):
        return None
    return f"{m.group(1).upper()}-{int(m.group(2))}"


def _find_by_name(client: TaskflowClient, res: Resource, text: str) -> str | None:
    source = res.dup_source or res.collection
    if not source or "{" in source:
        return None
    wanted = _normalize(text)
    hits = {
        str(r["id"]): r
        for r in _records(client.get(source, {"per_page": 100}))
        if any(_normalize(r.get(f)) == wanted for f in NAME_FIELDS if isinstance(r.get(f), str))
    }
    if len(hits) == 1:
        return next(iter(hits))
    if len(hits) > 1:
        names = ", ".join(f"{_record_name(r)} ({i})" for i, r in list(hits.items())[:10])
        raise ToolError(f"'{text}' matches several {res.name}: {names}. Use the id.")
    return None


def _record_name(r: dict) -> str:
    return next((str(r[f]) for f in NAME_FIELDS if r.get(f)), str(r.get("id")))


def resolve_record(client: TaskflowClient, res: Resource, value: Any) -> str:
    """Record id from a UUID, a display ID (PRB-2, VENDO-9), a name, or a plain id."""
    text = str(value or "").strip()
    if not text:
        raise ToolError(f"id is required for {res.name}.")
    if res.name == "tickets":
        return client.resolve_ticket(text)
    if UUID_RE.match(text):
        return text
    if res.name == "classifications":
        entity, _, field = text.partition("/")
        return f"{_segment(entity, 'entity')}/{_segment(field, 'field')}"
    if res.search_type and _norm_ref(text):
        try:
            return client.resolve_by_search(text, (res.search_type,))[1]
        except ToolError:
            pass  # not a display ID after all; try it as a name
    if "L" in res.ops or res.dup_source:
        found = _find_by_name(client, res, text)
        if found:
            return found
    return _segment(text, "id")


def resolve_parent(client: TaskflowClient, res: Resource, parent: Any, parent_type: Any = None) -> str | None:
    if not res.parent:
        return None
    text = str(parent or "").strip()
    if not text:
        raise ToolError(f"{res.name} needs parent: {PARENT_HELP[res.parent]}.")
    if res.parent == "project":
        return resolve_record(client, RESOURCES["projects"], text)
    if res.parent == "report":
        if text not in REPORT_KINDS:
            raise ToolError(f"parent must be one of: {', '.join(REPORT_KINDS)}.")
        return text
    module = str(parent_type or "").strip().lower().replace("_", "-")
    if module:
        if module not in RECORD_MODULES.values():
            raise ToolError(f"parent_type must be one of: {', '.join(RECORD_MODULES.values())}.")
        return f"{module}/{resolve_record(client, RESOURCES[module.replace('-', '_')], text)}"
    if UUID_RE.match(text):
        raise ToolError("Give parent_type (tickets, problems, changes, releases or work-items) with a UUID parent.")
    kind, rid = client.resolve_by_search(text, tuple(RECORD_MODULES))
    return f"{RECORD_MODULES[kind]}/{rid}"


def _fill(template: str, *, rid: str | None = None, parent: str | None = None, arg: str | None = None) -> str:
    path = template
    if "{parent}" in path:
        path = path.replace("{parent}", parent or "")
    if "{id}" in path:
        path = path.replace("{id}", rid or "")
    if "{arg}" in path:
        path = path.replace("{arg}", arg or "")
    return path


def refuse_duplicates(
    client: TaskflowClient, res: Resource, data: dict, parent: str | None = None, exclude_id: str | None = None
) -> None:
    """Raise if a record with the same or a near-same name already exists."""
    field = next((f for f in DUP_FIELDS if isinstance(data.get(f), str) and data[f].strip()), None)
    source = res.dup_source or res.collection
    if not res.dup or not field or not source or ("{parent}" in source and not parent):
        return
    source = _fill(source, parent=parent)
    listing = client.get(source, {"per_page": 100})
    records = list(_records(listing))
    if isinstance(listing, dict) and isinstance(listing.get("total"), int) and listing["total"] > len(records):
        records += list(_records(client.get(source, {"per_page": 100, "q": data[field]})))
    wanted = _normalize(data[field])
    same, near = {}, {}
    for r in records:
        if str(r.get("id")) == str(exclude_id) or not isinstance(r.get(field), str):
            continue
        have = _normalize(r[field])
        if have == wanted:
            same[str(r["id"])] = r[field]
        elif _similar(have, wanted):
            near[str(r["id"])] = r[field]
    if same:
        rid, name = next(iter(same.items()))
        raise ToolError(
            f"{res.name} '{name}' already exists (id {rid}). Use or update it instead of creating a duplicate."
        )
    if near:
        listed = "; ".join(f"'{n}' (id {i})" for i, n in list(near.items())[:5])
        raise ToolError(
            f"Similar {res.name} already exist: {listed}. Use one of them; pass force=true only if '{data[field]}' "
            "is genuinely different."
        )


def _data_arg(args: dict, required: bool) -> dict:
    data = args.get("data")
    if data is None:
        data = {}
    if not isinstance(data, dict):
        raise ToolError("data must be an object of fields.")
    if required and not data:
        raise ToolError("data is required: give the fields to set.")
    return data


def _params_arg(args: dict) -> dict:
    params = args.get("params") or {}
    if not isinstance(params, dict):
        raise ToolError("params must be an object of query parameters.")
    return {k: str(v).lower() if isinstance(v, bool) else str(v) for k, v in params.items()}


def tool_describe_resources(client: TaskflowClient, args: dict) -> Any:
    if not args.get("resource"):
        return {
            "resources": {
                r.name: _drop_empty(
                    {
                        "what": r.desc,
                        "can": r.can(),
                        "actions": sorted(r.actions),
                        "needs_parent": PARENT_HELP.get(r.parent or ""),
                    }
                )
                for r in RESOURCE_LIST
            },
            "not_available": list(NOT_AVAILABLE),
            "tip": "describe_resources with a resource name shows its paths, actions and a live sample record.",
        }
    res = _resource(args["resource"])
    out: dict[str, Any] = _drop_empty(
        {
            "resource": res.name,
            "what": res.desc,
            "can": res.can(),
            "needs_parent": PARENT_HELP.get(res.parent or ""),
            "notes": res.notes,
            "paths": _drop_empty({"collection": res.collection, "item": res.item, "get": res.get_path}),
            "checks_duplicates_on": "/".join(DUP_FIELDS) if res.dup and "C" in res.ops else None,
            "actions": {
                n: _drop_empty(
                    {
                        "does": a.desc,
                        "method": a.method,
                        "needs_id": a.needs_id or None,
                        "needs_arg": a.needs_arg or None,
                        "destructive": a.destructive or None,
                    }
                )
                for n, a in res.actions.items()
            },
        }
    )
    if "L" in res.ops and res.collection and not res.parent:
        try:
            sample = next(_records(client.get(res.collection, {"per_page": 1})), None)
        except ToolError as err:
            out["sample_error"] = str(err)
        else:
            if sample:
                out["sample_record"] = {k: _clip(v, 120) if isinstance(v, str) else v for k, v in sample.items()}
    return out


def tool_list_records(client: TaskflowClient, args: dict) -> Any:
    res = _resource(args.get("resource"))
    _require(res, "L")
    parent = resolve_parent(client, res, args.get("parent"), args.get("parent_type"))
    return _trim(client.get(_fill(res.collection or "", parent=parent), _params_arg(args)))


def tool_get_record(client: TaskflowClient, args: dict) -> Any:
    res = _resource(args.get("resource"))
    _require(res, "G")
    rid = resolve_record(client, res, args.get("id"))
    return _trim(client.get(_fill(res.get_path or "", rid=rid)))


def tool_create_record(client: TaskflowClient, args: dict) -> Any:
    res = _resource(args.get("resource"))
    _require(res, "C")
    data = _data_arg(args, required=True)
    parent = resolve_parent(client, res, args.get("parent"), args.get("parent_type"))
    if not args.get("force"):
        refuse_duplicates(client, res, data, parent)
    created = client.request("POST", _fill(res.collection or "", parent=parent), body=data)
    return {"created": _trim(created)}


def tool_update_record(client: TaskflowClient, args: dict) -> Any:
    res = _resource(args.get("resource"))
    _require(res, "U")
    data = _data_arg(args, required=True)
    rid = None if res.singleton else resolve_record(client, res, args.get("id"))
    if not args.get("force") and "C" in res.ops:
        refuse_duplicates(client, res, data, exclude_id=rid)
    updated = client.request("PUT", _fill(res.item or "", rid=rid), body=data)
    return {"updated": _trim(updated) if updated is not None else rid or res.name}


def tool_delete_record(client: TaskflowClient, args: dict) -> Any:
    res = _resource(args.get("resource"))
    _require(res, "D")
    rid = None if res.singleton else resolve_record(client, res, args.get("id"))
    result = client.request("DELETE", _fill(res.item or "", rid=rid))
    return {"deleted": rid or res.name, "result": _trim(result)}


def tool_record_action(client: TaskflowClient, args: dict) -> Any:
    res = _resource(args.get("resource"))
    name = str(args.get("action") or "").strip()
    action = res.actions.get(name)
    if action is None:
        known = ", ".join(sorted(res.actions)) or "none"
        raise ToolError(f"{res.name} has no action '{name}'. Its actions: {known}.")
    rid = resolve_record(client, res, args.get("id")) if action.needs_id else None
    arg = None
    if action.needs_arg:
        raw = args.get("arg")
        if res.name == "teams" and raw and not UUID_RE.match(str(raw)):
            raw = client.resolve_agent(raw)
        arg = _segment(raw, "arg")
    path = _fill(action.path, rid=rid, arg=arg)
    if action.method == "GET":
        result = client.get(path, _params_arg(args))
    elif action.method == "DELETE":
        result = client.request("DELETE", path)
    else:
        result = client.request(action.method, path, body=_data_arg(args, required=False))
    return {"action": f"{res.name}.{name}", "id": rid, "result": _trim(result)}


def tool_add_category(client: TaskflowClient, args: dict) -> Any:
    entity = _segment(args.get("entity") or "ticket", "entity")
    field = _segment(args.get("field") or "category", "field")
    path = [str(p).strip() for p in args.get("path") or [] if str(p).strip()]
    if not path:
        raise ToolError('path is required, e.g. ["Software", "Business application", "Vendor Portal"].')
    trees = items_of(client.get("/classifications", {"entity": entity}))
    spec = next((t for t in trees if t.get("name") == field), None)
    if spec is None:
        names = ", ".join(str(t.get("name")) for t in trees) or "none"
        raise ToolError(f"No '{field}' classification for {entity}. Available: {names}.")
    tree = spec.get("choices") or []
    level, added, kept = tree, [], []
    for depth, label in enumerate(path):
        wanted = _normalize(label)
        match = next(
            (c for c in level if wanted in (_normalize(c.get("value")), _normalize(c.get("label")))),
            None,
        )
        if match is None and not args.get("force"):
            near = [c.get("label") or c.get("value") for c in level if _similar(_normalize(c.get("value")), wanted)]
            if near:
                raise ToolError(
                    f"'{label}' is close to existing {', '.join(map(str, near))}. Use the existing name; pass "
                    "force=true only if it is genuinely different."
                )
        if match is None:
            match = {"value": label}
            level.append(match)
            added.append(label)
        else:
            kept.append(match.get("value"))
        if depth < len(path) - 1:
            match.setdefault("children", [])
            level = match["children"]
    if not added:
        return {"unchanged": True, "already_exists": kept}
    client.request("PUT", f"/classifications/{entity}/{field}", body={"choices": tree})
    return {"added": added, "already_existed": kept, "classification": f"{entity}/{field}"}


# ------------------------------------------------------- cross-session tracking
#
# TaskFlow is Claude's memory between sessions: my_work shows what is assigned
# and what the last session left behind; log_progress leaves a structured
# handoff (done / next / blockers / files) and keeps the record's tasks in step.

# The first line of every handoff note. It is neutral on purpose: notes are read by the whole desk.
LOG_MARKER = "[Session log]"
# Markers of earlier versions, still recognised so handoffs already in TaskFlow keep counting as the last log.
LEGACY_LOG_MARKERS = ("[Claude session log]",)
LOG_MARKERS = (LOG_MARKER, *LEGACY_LOG_MARKERS)
CLOSED_STATES = {"resolved", "closed", "completed", "done", "cancelled", "canceled", "rejected", "released"}


def _last_log(client: TaskflowClient, module_path: str) -> dict | None:
    try:
        convs = items_of(client.get(f"/{module_path}/conversations"))
    except ToolError:
        return None
    logs = [c for c in convs if str(c.get("body") or "").lstrip().startswith(LOG_MARKERS)]
    if not logs:
        return None
    latest = max(logs, key=lambda c: str(c.get("created_at") or ""))
    return {"at": latest.get("created_at"), "log": _clip(latest.get("body"), 1500)}


def _brief(r: dict, *fields: str) -> dict:
    out = {"ref": r.get("display_id") or r.get("key") or r.get("number"), "id": r.get("id")}
    for f in fields:
        value = r.get(f)
        if f in ("project", "group", "department") and isinstance(value, dict):
            value = value.get("key") or value.get("name")
        out[f] = value
    return _drop_empty(out)


def _mine_open(client: TaskflowClient, path: str, me_id: str) -> list:
    try:
        records = items_of(client.get(path, {"per_page": 100}))
    except ToolError:
        return []
    return [
        r
        for r in records
        if me_id in (r.get("agent_id"), r.get("owner_id"), r.get("assignee_id"))
        and str(r.get("status") or r.get("state") or "").lower() not in CLOSED_STATES
    ]


def tool_my_work(client: TaskflowClient, args: dict) -> Any:
    me_id = client.me()["id"]
    with_logs = args.get("include_logs", True)
    tickets = items_of(
        client.get("/tickets", {"view": "my_open", "per_page": 50, "sort": "updated_at", "order": "desc"})
    )
    work_items = items_of(client.get("/me/work-items"))
    tasks = items_of(client.get("/me/tasks"))
    problems = _mine_open(client, "/problems", me_id)
    changes = _mine_open(client, "/changes", me_id)
    releases = _mine_open(client, "/releases", me_id)
    try:
        approvals = [
            a
            for a in items_of(client.get("/approvals"))
            if str(a.get("status") or "").lower() in ("requested", "pending", "")
        ]
    except ToolError:
        approvals = []

    out_tickets = []
    for i, t in enumerate(tickets):
        row = ticket_summary(t)
        if with_logs and i < 10 and t.get("id"):
            row["last_log"] = _last_log(client, f"tickets/{t['id']}")
        out_tickets.append(_drop_empty(row))
    out_items = []
    for i, w in enumerate(work_items):
        row = _brief(w, "title", "state", "priority", "project", "due_date", "updated_at")
        if with_logs and i < 10 and w.get("id"):
            row["last_log"] = _last_log(client, f"work-items/{w['id']}")
        out_items.append(_drop_empty(row))
    return {
        "summary": {
            "tickets": len(tickets),
            "work_items": len(work_items),
            "tasks": len(tasks),
            "problems": len(problems),
            "changes": len(changes),
            "releases": len(releases),
            "approvals_waiting": len(approvals),
        },
        "tickets": out_tickets,
        "work_items": out_items,
        "tasks": [
            _drop_empty(
                {
                    "id": t.get("id"),
                    "title": t.get("title"),
                    "status": t.get("status"),
                    "due_date": t.get("due_date"),
                    "on": t.get("entity_display_id") or t.get("entity_type"),
                    "entity_id": t.get("entity_id"),
                }
            )
            for t in tasks
        ],
        "problems": [_brief(p, "subject", "status", "updated_at") for p in problems],
        "changes": [_brief(c, "subject", "status", "planned_start_date", "updated_at") for c in changes],
        "releases": [_brief(r, "subject", "status", "planned_start_date", "updated_at") for r in releases],
        "approvals_waiting": [_trim(a) for a in approvals[:20]],
        "next_step": "Resume the most recently updated in-progress item; its last_log says what is next. "
        "Call log_progress at milestones and before the session ends.",
    }


def tool_log_progress(client: TaskflowClient, args: dict) -> Any:
    module_path = resolve_parent(client, RESOURCES["tasks"], args.get("record"), args.get("record_type"))
    module, rid = module_path.split("/", 1)
    sections = {
        "Done": _string_list(args.get("done"), "done") or [],
        "Next": _string_list(args.get("next"), "next") or [],
        "Blockers": _string_list(args.get("blockers"), "blockers") or [],
        "Files / branches / links": _string_list(args.get("files"), "files") or [],
    }
    summary = str(args.get("summary") or "").strip()
    if not summary and not any(sections.values()):
        raise ToolError("Give a summary or at least one of done, next, blockers.")
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
    lines = [f"{LOG_MARKER} {stamp}"]
    if summary:
        lines.append(f"Summary: {summary}")
    for title, items in sections.items():
        if items:
            lines.append(f"{title}:")
            lines.extend(f"- {item}" for item in items)
    client.request("POST", f"/{module_path}/notes", body={"body": "\n".join(lines), "private": True})
    result: dict[str, Any] = {"logged_on": args.get("record"), "record": module_path}

    if args.get("sync_tasks", True) and (sections["Next"] or sections["Done"]):
        me_id = client.me()["id"]
        existing = items_of(client.get(f"/{module_path}/tasks"))
        open_by_title = {
            _normalize(t.get("title")): t for t in existing if str(t.get("status")) != "completed" and t.get("id")
        }
        all_titles = {_normalize(t.get("title")) for t in existing}
        completed, created = [], []
        for item in sections["Done"]:
            task = open_by_title.get(_normalize(item))
            if task:
                client.request("PUT", f"/tasks/{task['id']}", body={"status": "completed"})
                completed.append(task.get("title"))
        for item in sections["Next"]:
            if _normalize(item) in all_titles:
                continue
            client.request(
                "POST", f"/{module_path}/tasks", body={"title": item[:255], "status": "open", "agent_id": me_id}
            )
            all_titles.add(_normalize(item))
            created.append(item)
        result.update(_drop_empty({"tasks_completed": completed, "tasks_created": created}))

    status = str(args.get("status") or "").strip().lower()
    if status:
        if module == "work-items":
            if status not in WORK_ITEM_STATES:
                raise ToolError(f"Work item state must be one of: {', '.join(WORK_ITEM_STATES)}.")
            body = {"state": status}
        else:
            if module == "tickets" and status in ("resolved", "closed"):
                raise ToolError("Log first, then use close_ticket to resolve or close, so the closure checks run.")
            body = {"status": status}
        client.request("PUT", f"/{module_path}", body=body)
        result["status_set"] = status
    return result


RESOURCE_NAME = {"type": "string", "enum": [r.name for r in RESOURCE_LIST]}
RECORD_ID = {"type": "string", "description": "Record id, display ID (PRB-2, VENDO-9) or exact name."}
PARENT = {"type": "string", "description": "Owning project (name/key/id), record (INC-11, PRB-2, ...) or report kind."}
PARENT_TYPE = {"type": "string", "enum": list(RECORD_MODULES.values()), "description": "Only with a UUID parent."}
DATA = {"type": "object", "description": "Fields to send, as the TaskFlow API names them."}
PARAMS = {
    "type": "object",
    "description": 'Query parameters, e.g. {"page": 2, "per_page": 50, "q": "vpn"}.',
    "additionalProperties": {"type": ["string", "number", "boolean"]},
}
FORCE = {
    "type": "boolean",
    "description": "Skip the duplicate check. Only when a similar record is genuinely different.",
}

TOOLS: list[Tool] = [
    Tool(
        "whoami",
        "Who am I",
        "Show the TaskFlow agent this connector signs in as.",
        _schema({}),
        tool_whoami,
        read_only=True,
    ),
    Tool(
        "list_tickets",
        "List tickets",
        "List or filter tickets you can see, newest first unless sorted. Use view for queues "
        "(my_open, unassigned, overdue, ...) and query for free text or a display ID.",
        _schema(
            {
                "view": {"type": "string", "enum": list(VIEWS), "default": "all"},
                "query": {
                    "type": "string",
                    "description": "Text in subject, description, people, group or conversation; or a display ID.",
                },
                "status": {**STRINGS, "description": 'Statuses to include, e.g. ["open", "pending"].'},
                "priority": {"type": "array", "items": PRIORITY},
                "type": {"type": "string", "enum": ["incident", "service_request"]},
                "agent": {
                    "type": "string",
                    "description": "Assigned agent name/email, 'me', or 'none' for unassigned.",
                },
                "group": {"type": "string", "description": "Agent group name."},
                "department": {"type": "string", "description": "Department name or code."},
                "tag": {"type": "string"},
                "category": {"type": "string"},
                "created_from": {"type": "string", "description": "ISO 8601 date or date-time."},
                "created_to": {"type": "string", "description": "ISO 8601 date or date-time."},
                "sort": {
                    "type": "string",
                    "enum": ["created_at", "updated_at", "priority", "number", "status", "due_by"],
                },
                "order": {"type": "string", "enum": ["asc", "desc"]},
                "page": {"type": "integer", "minimum": 1},
                "per_page": {"type": "integer", "minimum": 1, "maximum": 100},
            }
        ),
        tool_list_tickets,
        read_only=True,
    ),
    Tool(
        "get_ticket",
        "Get ticket",
        "Get one ticket with its full details and conversation (replies and notes).",
        _schema({"ticket": TICKET_REF, "include_conversation": {"type": "boolean", "default": True}}, ("ticket",)),
        tool_get_ticket,
        read_only=True,
    ),
    Tool(
        "create_ticket",
        "Raise ticket",
        "Raise a new incident or service request. Without requester_email the ticket is raised for you.",
        _schema(
            {
                **EDITABLE_FIELDS,
                "requester_email": {
                    "type": "string",
                    "description": "Requester's email; a new requester is created if unknown.",
                },
                "requester_name": {"type": "string", "description": "Name for a new requester."},
                "force": {
                    "type": "boolean",
                    "description": "Create even though an open ticket has the same subject (genuinely separate work).",
                },
            },
            ("subject",),
        ),
        tool_create_ticket,
        read_only=False,
    ),
    Tool(
        "update_ticket",
        "Update ticket",
        "Change ticket fields: status, priority, urgency, impact, type, assignee, group, department, category, "
        "tags, due date, subject or description, and the project it is tracked in. Only the fields you pass change.",
        _schema(
            {
                "ticket": TICKET_REF,
                **EDITABLE_FIELDS,
                "status": {"type": "string", "description": "open, pending, resolved, closed, or a custom status key."},
                "resolution_notes": {"type": "string"},
            },
            ("ticket",),
        ),
        tool_update_ticket,
        read_only=False,
        idempotent=True,
    ),
    Tool(
        "close_ticket",
        "Close ticket",
        "Close (or resolve) a ticket, optionally recording resolution notes. TaskFlow may refuse if required "
        "closure fields (such as category) are missing; set them with update_ticket and retry.",
        _schema(
            {
                "ticket": TICKET_REF,
                "status": {"type": "string", "enum": ["closed", "resolved"], "default": "closed"},
                "resolution_notes": {"type": "string"},
            },
            ("ticket",),
        ),
        tool_close_ticket,
        read_only=False,
        idempotent=True,
    ),
    Tool(
        "reply_to_ticket",
        "Reply to requester",
        "Send a public reply on a ticket. TaskFlow emails it to the requester and any CCs.",
        _schema(
            {
                "ticket": TICKET_REF,
                "body": {"type": "string"},
                "cc_emails": STRINGS,
                "set_status": {"type": "string", "description": "Optional status to set with the reply, e.g. pending."},
            },
            ("ticket", "body"),
        ),
        tool_reply_to_ticket,
        read_only=False,
        open_world=True,
    ),
    Tool(
        "add_note",
        "Add note",
        "Add a note to a ticket. Notes are private (agents only) unless private is false.",
        _schema(
            {"ticket": TICKET_REF, "body": {"type": "string"}, "private": {"type": "boolean", "default": True}},
            ("ticket", "body"),
        ),
        tool_add_note,
        read_only=False,
    ),
    Tool(
        "search",
        "Search TaskFlow",
        "Search across tickets, problems, changes, releases, assets, people and solution articles.",
        _schema({"query": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 25}}, ("query",)),
        tool_search,
        read_only=True,
    ),
    Tool(
        "list_agents",
        "List agents",
        "List agents, optionally filtered by name or email.",
        _schema({"query": {"type": "string"}, "per_page": {"type": "integer", "minimum": 1, "maximum": 100}}),
        tool_list_agents,
        read_only=True,
    ),
    Tool(
        "list_groups",
        "List agent groups",
        "List agent groups (teams tickets are assigned to).",
        _schema({}),
        tool_list_groups,
        read_only=True,
    ),
    Tool(
        "get_dashboard",
        "Service desk dashboard",
        "Ticket counts, SLA health and workload from the agent dashboard.",
        _schema({}),
        tool_dashboard,
        read_only=True,
    ),
    Tool(
        "api_get",
        "Read any TaskFlow record",
        "Read-only GET of any TaskFlow /api/v2 path, for records without a dedicated tool: /problems, /changes, "
        "/releases, /assets, /solutions/articles, /reports/sla, /tickets/{id}/tasks, /tickets/{id}/time-entries, ...",
        _schema(
            {
                "path": {"type": "string", "description": "Path under /api/v2, e.g. /problems."},
                "params": {
                    "type": "object",
                    "description": 'Query parameters, e.g. {"page": 1, "q": "vpn"}.',
                    "additionalProperties": {"type": ["string", "number", "boolean"]},
                },
            },
            ("path",),
        ),
        tool_api_get,
        read_only=True,
    ),
    Tool(
        "describe_resources",
        "Describe TaskFlow resources",
        "Lists everything the connector can reach beyond tickets (problems, changes, releases, projects, work "
        "items, cycles, assets, catalog, knowledge base, groups, departments, teams, SLA, workflows, settings, "
        "...) with the operations and actions each supports. Give a resource to see its paths, actions and a "
        "live sample record (to learn field names) before creating or updating one.",
        _schema({"resource": RESOURCE_NAME}),
        tool_describe_resources,
        read_only=True,
    ),
    Tool(
        "list_records",
        "List records",
        "List records of any resource. Child resources need parent (e.g. work_items needs a project; tasks need "
        "a record such as INC-11).",
        _schema(
            {"resource": RESOURCE_NAME, "parent": PARENT, "parent_type": PARENT_TYPE, "params": PARAMS},
            ("resource",),
        ),
        tool_list_records,
        read_only=True,
    ),
    Tool(
        "get_record",
        "Get record",
        "Get one record of any resource by id, display ID (PRB-2, CHG-3, VENDO-9) or exact name.",
        _schema({"resource": RESOURCE_NAME, "id": RECORD_ID}, ("resource", "id")),
        tool_get_record,
        read_only=True,
    ),
    Tool(
        "create_record",
        "Create record",
        "Create a record of any resource (problem, change, release, project, work item, group, department, "
        "asset, article, SLA policy, ...). Refuses if one with the same or a near-same name already exists.",
        _schema(
            {"resource": RESOURCE_NAME, "data": DATA, "parent": PARENT, "parent_type": PARENT_TYPE, "force": FORCE},
            ("resource", "data"),
        ),
        tool_create_record,
        read_only=False,
    ),
    Tool(
        "update_record",
        "Update record",
        "Update fields of a record; only the fields in data change. One-record resources (settings, survey, "
        "me) need no id. Refuses a rename onto an existing name.",
        _schema(
            {"resource": RESOURCE_NAME, "id": RECORD_ID, "data": DATA, "force": FORCE},
            ("resource", "data"),
        ),
        tool_update_record,
        read_only=False,
        idempotent=True,
    ),
    Tool(
        "delete_record",
        "Delete record",
        "Delete a record. Tickets, problems, changes, releases and assets go to trash and can be restored; most "
        "configuration records are removed for good. Only when the user asked for it.",
        _schema({"resource": RESOURCE_NAME, "id": RECORD_ID}, ("resource",)),
        tool_delete_record,
        read_only=False,
        destructive=True,
    ),
    Tool(
        "record_action",
        "Run record action",
        "Run a named action on a resource: restore, request_approval, merge, watch, forward, apply_scenario, "
        "set_project, receive, relate, add_members, convert_to_agent, ... (describe_resources lists them).",
        _schema(
            {
                "resource": RESOURCE_NAME,
                "action": {"type": "string"},
                "id": RECORD_ID,
                "arg": {"type": "string", "description": "Second id some actions need (scenario, member, link)."},
                "data": DATA,
                "params": PARAMS,
            },
            ("resource", "action"),
        ),
        tool_record_action,
        read_only=False,
        open_world=True,
    ),
    Tool(
        "add_category",
        "Add category",
        "Add a category path to a category tree (default: ticket categories), reusing levels that already exist "
        'and refusing near-duplicates. e.g. path ["Software", "Business application", "Vendor Portal"].',
        _schema(
            {
                "path": {**STRINGS, "minItems": 1, "maxItems": 3},
                "entity": {"type": "string", "description": "ticket (default), problem, change, release, asset, ..."},
                "field": {"type": "string", "description": "Classification name, default category."},
                "force": FORCE,
            },
            ("path",),
        ),
        tool_add_category,
        read_only=False,
    ),
    Tool(
        "my_work",
        "My work (resume here)",
        "Start-of-session catch-up: everything assigned to you that is still open (tickets, project work "
        "items, tasks, problems, changes, releases, approvals waiting on you), each with the last session "
        "log so you can pick up where the previous session stopped.",
        _schema({"include_logs": {"type": "boolean", "default": True}}),
        tool_my_work,
        read_only=True,
    ),
    Tool(
        "log_progress",
        "Log session progress",
        "Leave a handoff on a ticket, work item, problem, change or release: a private note with done / next / "
        "blockers / files, so the next session knows where things stand. Next items become tasks on the "
        "record (no duplicates) and done items complete matching tasks. Optionally move the status "
        "(ticket/problem/change/release) or state (work item).",
        _schema(
            {
                "record": {"type": "string", "description": "INC-11, SR-4, VENDO-9, PRB-2, CHG-3, REL-1 or a UUID."},
                "record_type": PARENT_TYPE,
                "summary": {"type": "string", "description": "One line on where things stand."},
                "done": STRINGS,
                "next": STRINGS,
                "blockers": STRINGS,
                "files": {**STRINGS, "description": "Files, branches, commits, PRs or URLs touched."},
                "status": {"type": "string", "description": "New status, or work item state (e.g. in_progress)."},
                "sync_tasks": {"type": "boolean", "default": True},
            },
            ("record",),
        ),
        tool_log_progress,
        read_only=False,
    ),
]
TOOLS_BY_NAME = {t.name: t for t in TOOLS}


# -------------------------------------------------------------------- protocol


class Server:
    def __init__(self, client: TaskflowClient):
        self.client = client

    @staticmethod
    def _result(mid: Any, result: Any) -> dict:
        return {"jsonrpc": "2.0", "id": mid, "result": result}

    @staticmethod
    def _error(mid: Any, code: int, message: str) -> dict:
        return {"jsonrpc": "2.0", "id": mid, "error": {"code": code, "message": message}}

    def handle(self, msg: Any) -> dict | None:
        if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0" or not isinstance(msg.get("method"), str):
            if isinstance(msg, dict) and "method" not in msg:
                return None  # a response to a request we never send
            return self._error(msg.get("id") if isinstance(msg, dict) else None, -32600, "Invalid Request")
        method, mid, is_request = msg["method"], msg.get("id"), "id" in msg
        params = msg.get("params") or {}
        if method == "initialize":
            requested = params.get("protocolVersion")
            version = requested if requested in PROTOCOL_VERSIONS else PROTOCOL_VERSIONS[0]
            return self._result(
                mid,
                {
                    "protocolVersion": version,
                    "capabilities": {"tools": {"listChanged": False}},
                    "serverInfo": {"name": SERVER_NAME, "title": "TaskFlow Service Desk", "version": SERVER_VERSION},
                    "instructions": INSTRUCTIONS,
                },
            )
        if not is_request:
            return None  # notifications/initialized, notifications/cancelled, ...
        if method == "ping":
            return self._result(mid, {})
        if method == "tools/list":
            return self._result(mid, {"tools": [t.spec() for t in TOOLS]})
        if method == "tools/call":
            return self._call_tool(mid, params)
        return self._error(mid, -32601, f"Method not found: {method}")

    def _call_tool(self, mid: Any, params: dict) -> dict:
        tool = TOOLS_BY_NAME.get(params.get("name"))
        if tool is None:
            return self._error(mid, -32602, f"Unknown tool: {params.get('name')}")
        args = params.get("arguments") or {}
        if not isinstance(args, dict):
            return self._error(mid, -32602, "arguments must be an object")
        try:
            output = tool.handler(self.client, args)
        except ToolError as err:
            return self._result(mid, {"content": [{"type": "text", "text": str(err)}], "isError": True})
        except Exception as err:  # noqa: BLE001 - report, never crash the server
            log(f"{tool.name} failed:\n{traceback.format_exc()}")
            return self._result(
                mid, {"content": [{"type": "text", "text": f"Unexpected error in {tool.name}: {err}"}], "isError": True}
            )
        text = json.dumps(output, indent=2, ensure_ascii=False, default=str)
        return self._result(mid, {"content": [{"type": "text", "text": text}], "isError": False})


def serve(server: Server, stdin=None, stdout=None) -> None:
    stdin = stdin or sys.stdin.buffer
    stdout = stdout or sys.stdout.buffer
    while True:
        line = stdin.readline()
        if not line:
            return
        if not line.strip():
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            reply: Any = Server._error(None, -32700, "Parse error")
        else:
            if isinstance(msg, list):  # JSON-RPC batch (2025-03-26 clients)
                reply = [r for r in (server.handle(m) for m in msg) if r is not None] or None
            else:
                reply = server.handle(msg)
        if reply is not None:
            stdout.write(json.dumps(reply, ensure_ascii=False, separators=(",", ":")).encode("utf-8") + b"\n")
            stdout.flush()


def main() -> None:
    client = TaskflowClient(load_base_url(), load_api_key())
    if not client.api_key:
        log("no API key configured; tools will explain how to add one")
    log(f"serving {client.api}")
    serve(Server(client))


if __name__ == "__main__":
    main()
