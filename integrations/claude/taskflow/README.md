# TaskFlow for Claude

Connects Claude to the TaskFlow service desk so you can ask things like:

- "What's in my open queue? Anything overdue?"
- "Summarise INC-11 and the conversation so far."
- "Raise a High incident for user@example.com: vendor payout page shows the wrong total."
- "Assign INC-11 to me, set priority Urgent, and add a private note that I'm on it."
- "Reply to INC-11 saying the toggle was removed, then set it to pending."
- "Close INC-11 with resolution notes: offer pickup removed from vendor profile."

It is a small MCP server (`server/taskflow_mcp.py`, Python standard library only)
that calls the TaskFlow REST API (`/api/v2`) with your agent API key. Claude acts
as you, with your role's permissions, and every change lands in the TaskFlow
audit log.

## 1. Get an API key

In TaskFlow open **Profile → API key** and generate a key (agents only). Copy it.

Save it where the connector can read it, without putting it in shell history or
in any repository:

```bash
mkdir -p ~/.config/taskflow && chmod 700 ~/.config/taskflow
pbpaste > ~/.config/taskflow/api_key && chmod 600 ~/.config/taskflow/api_key
```

(Alternatively export `TASKFLOW_API_KEY` in the shell that starts Claude.
`TASKFLOW_URL` overrides the default `https://taskflow.portalvii.com`, e.g.
`http://localhost:8080` for a local stack.)

Regenerating the key in TaskFlow revokes the old one immediately.

## 2. Install in Claude Code (CLI, desktop Code tab, IDE)

```bash
claude plugin marketplace add /Users/chanduchitikam/Taskflow/integrations/claude
claude plugin install taskflow@taskflow
```

Or from inside a session: `/plugin marketplace add <path to integrations/claude>`
then `/plugin install taskflow@taskflow`. Restart the session, then run `/mcp`
to check that **taskflow** is connected. Ask "who am I in TaskFlow?" to test.

## 3. (Optional) Claude Desktop chat

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` and
restart Claude Desktop:

```json
{
  "mcpServers": {
    "taskflow": {
      "command": "/usr/bin/python3",
      "args": ["/Users/chanduchitikam/Taskflow/integrations/claude/taskflow/server/taskflow_mcp.py"]
    }
  }
}
```

The key is read from `~/.config/taskflow/api_key`.

## Tools

| Tool | What it does |
|---|---|
| `whoami` | The agent the key belongs to |
| `list_tickets` | Queues and filters: view (`my_open`, `unassigned`, `overdue`, …), status, priority, type, agent, group, tag, dates, text |
| `get_ticket` | One ticket with details and the full conversation |
| `create_ticket` | Raise an incident or service request (for you or a requester email), with department and project; refuses a duplicate of an open ticket |
| `update_ticket` | Status, priority, urgency, impact, type, assignee, group, department, category, tags, due date, subject, description, project link. After an edit to the description, resolution notes or CC it reads the ticket back and lists any field TaskFlow did not save under `not_saved` |
| `close_ticket` | Close or resolve with resolution notes (TaskFlow's closure checks still apply) |
| `reply_to_ticket` | Public reply; TaskFlow emails the requester |
| `add_note` | Private (default) or public note |
| `search` | Global search across tickets, problems, changes, assets, people, articles |
| `list_agents`, `list_groups` | Look up people and teams |
| `get_dashboard` | Agent dashboard numbers |
| `api_get` | Read-only access to any `/api/v2` path |
| `describe_resources` | Every other resource, what it supports, and a live sample record |
| `list_records`, `get_record` | Read any resource |
| `create_record` | Create any resource; refuses exact and near-duplicate names (`force` overrides) |
| `update_record` | Update any resource (only the fields sent change); refuses renames onto an existing name |
| `delete_record` | Delete (tickets, problems, changes, releases, assets go to trash; config records are removed) |
| `record_action` | Named actions: restore, request approval, merge, watch, forward, scenarios, project links, receive PO, relate assets, team members, convert/deactivate people, ... |
| `add_category` | Add a category / sub-category / item path, reusing existing levels |
| `my_work` | Start-of-session catch-up: your open tickets, work items, tasks, problems, changes, releases and approvals, each with the last session log |
| `log_progress` | Session handoff on a record: private note headed `[Session log]` with done / next / blockers / files (`my_work` also reads notes headed with the older marker); next items become tasks, done items complete them; optional status or state change |

Resources reachable through the generic tools: problems, changes (with
approvals and calendar), releases, approvals, tasks, time entries, notes,
conversations, associations, activities, projects, work items, cycles, modules,
asset types, assets, products, vendors, software, contracts, purchase orders,
service catalog, knowledge base, announcements, agents, requesters, people,
groups, departments, locations, teams, job roles, roles, on-call, settings,
business hours, SLA policies, workflows, scenarios, canned responses, form
fields, category trees, survey, email templates and outbox, audit log, reports,
and your own profile, availability and notifications.

Records can be named by display ID (`INC-11`, `PRB-2`, `VENDO-9`), exact name
(`Development Group`, project key `VENDO`), or UUID; agents by name, email or `me`.

Not exposed: sign-in, passwords, API keys and sessions; file uploads and
downloads; ticket purge; GDPR forget; admin password resets; platform (super
admin) endpoints. Claude Code asks before each tool call unless you allow it in
`/permissions`.

## Tests

```bash
uv run --no-project --with pytest -- python -m pytest integrations/claude/taskflow/tests -q
```

The tests start the real server process against a fake TaskFlow API; they never
touch the live site.
