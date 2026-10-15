# TaskFlow Service Desk (ITSM)

TaskFlow ships a full IT service management suite on top of its multi-tenant
task platform: incidents and service requests with SLAs, problem / change /
release management, a CMDB with procurement, a service catalog, a knowledge
base, automation, analytics, and a self-service portal for employees.

This document covers what the product does, how it is built, how to run and
operate it, and how to verify it.

---

## 1. Feature map

| Area | Capabilities |
|---|---|
| **Tickets** (incidents & service requests) | List and Kanban board layouts (drag a card to change status; closure rules still apply), per-org numbering (`INC-12`, `SR-13`, prefixes configurable), status (Open / Pending / Resolved / Closed + custom statuses), priority, urgency × impact, source, requester, agent, group, department, 3-level category, tags, CC, custom fields, attachments, parent/child, merge, spam & trash with restore/purge, bulk update/resolve/close/delete, watchers, CSV export, saved views (My open, Unassigned, Overdue, Due today, Pending, Watching, Spam, Trash…) |
| **Conversations** | Public replies, private/public notes with @notify, forwards, canned responses with placeholders, signatures, "send and set as" status, attachments, Markdown rendering (safe — no raw HTML) |
| **SLA management** | SLA policies matched by type / source / group / department / category, per-priority response & resolution targets, business-hours vs calendar time, business-hours calendars with holidays per group, timers paused while Pending (or custom "pause SLA" statuses), recompute on priority/group change, first-response & resolution escalation, unassigned-ticket escalation |
| **Automation** | Workflow Automator (on create / on update, ALL/ANY conditions incl. `changed_to`/`changed_from`, 17 action types incl. email, notes, tags, routing), scenario automations (one-click macros), round-robin assignment honoring agent availability |
| **Problem management** | Problems from incidents, root cause / impact / symptoms / workaround, known errors, linked incidents/changes/assets |
| **Change management** | Change types (minor / standard / major / emergency), risk & impact, planning (reason, impact, rollout, backout), CAB approvals (people or whole group), approval gating for major/emergency changes, change calendar, schedule-conflict detection (overlapping windows + shared assets) |
| **Release management** | Releases bundling changes, build/test plans, completion guard until changes are implemented |
| **Projects** | Projects with key-prefixed work items (`KAIRV-12`), Board / List / Calendar / Table layouts, drag-and-drop between states (Backlog, Todo, In Progress, Done, Cancelled) and manual ordering, inline quick add, priority, assignee, start & due dates, labels, estimates, sub-work items, cycles (sprints) with progress, comments with attachments, activity history, links to tickets and other records ("Create project work item" from a ticket), filters and display options, "Assigned to me" across projects, public / private projects with member-based editing, archive & delete |
| **Tasks & time** | Tasks on any record with assignee/group/due date, "My tasks", time entries (billable flag) with start/stop timers |
| **Assets / CMDB** | Asset type hierarchy with inherited type-specific fields, states, impact, assignment history, CI relationships (depends on, runs on, hosted on…), upstream impact analysis, linked tickets/changes, CSV export |
| **Procurement & licensing** | Vendors, products, contracts (lease / maintenance / warranty / license) with renewal reminders & auto-renew, software catalog with installations vs. licenses compliance, purchase orders with tax/discount/shipping and receiving that creates in-stock assets |
| **Service catalog** | Categories, items with custom request forms, cost, delivery time, visibility by department, approvals (reporting manager, department head, specific people), fulfilment group/agent, requested-item stages |
| **Knowledge base** | Categories → folders with visibility (everyone / signed-in / departments / agents only), draft/publish, permanent vs workaround articles, tags, keywords, review dates, views & helpful votes, full-text search, ticket deflection suggestions |
| **Approvals** | Unified inbox for agents and requesters; any rejection rejects, all approvals approve; service requests move to fulfilment automatically |
| **Self-service portal** | Branded home, report an issue (with live article suggestions), request a service, my tickets, reply / close / reopen, CSAT rating, knowledge base, approvals, notifications |
| **Engagement** | Announcements (scheduled, by audience), CSAT surveys with feedback, in-app notifications, email notifications with editable templates and a delivery log |
| **Analytics** | Dashboard (unresolved / overdue / due today / unassigned, created-vs-resolved trend, SLA compliance, average response & resolution, CSAT, leaderboard), reports for ticket volume, SLA by priority, agent performance (incl. time logged), group performance, CSAT distribution, asset inventory |
| **Organization** | Org units (OUs) as a tree: company → division → business unit → department → unit, with heads, prime contacts, codes, cost centers, default locations and email domains that place new requesters automatically; org chart view; deleting a unit moves its people and sub-units up. Teams with hand-picked members or rule-based membership (unit incl. sub-units, location, manager, job title, email domain, person type, VIP) with live preview. Location hierarchy. Unit-restricted catalog items and KB folders include sub-units |
| **Account & people** | Agents & requesters (create with temporary password, edit, convert agent ⇄ requester, deactivate / reactivate, reset password, unlock, GDPR forget), filters by unit (with sub-units), location, team, group, role and status, bulk actions (move unit, location, manager, teams, VIP, deactivate), CSV import with dry-run preview and CSV export, manager chain and direct reports, agent groups with leaders, members and observers, roles with 18 privileges (clone, agent counts), on-call schedules, helpdesk settings (branding & logo, time zone, portal permissions, ticket prefixes, custom statuses, auto-close), security policy (password complexity, idle sign-out), API keys, audit log |
| **Sign-up & recovery** | Email verification for self-service sign-ups (turns on automatically once email is configured; a company's email domain is attached to its organization only after the admin verifies), password reset by a single-use emailed link (1 hour) or security questions, "your password was changed" notices, sign-in page resend of the verification link |
| **Personal settings** | Profile picture, contact details and signature, out of office with an approval delegate (round-robin skips you), per-event notification preferences (in-app and email), active sessions with remote sign-out and "sign out of all other sessions", my organization (unit, reporting line, direct reports, teams, groups) |
| **Search** | Global search (⌘K) with keyboard navigation and a full results page; finds tickets by number with any prefix, subject, description, category, tags, requester, agent, group or conversation text; problems, changes, releases and assets by ID; work items, articles, services and people |
| **Appearance** | Per-user themes: Glass (default — frosted panels over an animated aurora, gradient accents), Classic, Dark and Crimson; confetti celebrations on sign-in, resolved tickets, finished work items and submitted requests (can be turned off; always off with reduced motion) |
| **Integrations** | REST API under `/api/v2` (Bearer JWT or Freshservice-style API key via HTTP Basic `key:X`), inbound email webhook that creates tickets and threads replies (`[INC-12]` in the subject) |

---

## 2. Architecture

```
Browser ──► Next.js web app (:3000)
              │  /api/*  (same-origin rewrite)
              ▼
           API gateway (:8080)  ── CORS allow-list, rate limiting, security headers,
              │                    strips client identity headers, verifies JWTs
     ┌────────┼──────────────┬─────────────────┬──────────────┐
     ▼        ▼              ▼                 ▼              ▼
  user-svc  task-svc   notification-svc    org-svc      itsm-svc (:8090, REST /api/v2)
  (gRPC)    (gRPC)     (gRPC)              (gRPC)       tickets, ITIL, CMDB, catalog, KB,
     │        │              │                 │         SLA engine, automation, workers
     └────────┴──────────────┴─────────────────┴──────────────┘
                                   PostgreSQL (+ Redis)
```

* **itsm-service** (`services/itsm`) is a plain Go `net/http` service using GORM.
  All of its tables are prefixed `itsm_` and migrated automatically on start.
  It shares the `users`, `organizations` and `notifications` tables with the
  platform services.
* **Identity**: every service derives the caller from a *verified* JWT. The
  gateway strips any `X-User-Id` / `X-Role` / `X-Org-Id` / `Grpc-Metadata-*`
  headers sent by clients; gRPC services run `auth.UnaryIdentityInterceptor`,
  which discards identity metadata and rebuilds it from the token. The ITSM
  service additionally reloads the user from the database (cached 20s), so
  deactivation, role changes and password resets take effect immediately.
* **Authorization**: agent privileges come from roles (`settings.manage`,
  `users.manage`, `tickets.manage`, `assets.manage`, …). Org admins
  (`org_admin`) are account admins with every privilege. Requesters only see
  their own tickets (plus their department's when they head it and the setting
  is on). Agents can be scoped to all / group / assigned tickets.
* **Tenancy**: every ITSM query is scoped to the caller's organization; the
  org-service enforces tenant ownership for teams, projects, groups and
  workspaces through an authorization interceptor.
* **Background workers** run inside the ITSM service every `WORKER_INTERVAL`
  (default 60s) under a Postgres advisory lock, so only one replica works at a
  time: SLA escalation, unassigned-ticket escalation, auto-close of resolved
  tickets, contract expiry reminders & auto-renewal, email delivery with retry,
  and cleanup of stale uploads, sessions and old email logs.
* **Email** is queued in an outbox (`itsm_email_outbox`) and delivered over
  SMTP (STARTTLS on 587, implicit TLS on 465) by the shared `pkg/mailer`
  package. New mail is sent within seconds; rows are claimed with
  `SKIP LOCKED` so a message is never sent twice, and failures retry with
  back-off up to five times. `SMTP_FROM` may include a display name
  (`TaskFlow <support@example.com>`). Without `SMTP_HOST`, messages are
  logged and marked `skipped`, and admin flows return temporary passwords
  directly so accounts can still be onboarded. The platform console's
  **Email** tab shows the settings, delivery counts and recent failures, and
  sends a live test message.

### Roles out of the box

| Role | Highlights |
|---|---|
| Account Admin / Admin | Everything |
| SD Supervisor | Tickets incl. delete/spam, problems, knowledge, catalog, announcements, reports |
| SD Agent | Work tickets; view problems, changes, releases, assets; reports |
| Problem Manager | + manage problems |
| Change Manager | + manage changes and releases |
| Asset Manager | Assets, CMDB, contracts, software, purchase orders |

New organizations are seeded with these roles, default business hours and SLA
policy, agent groups, a ticket category tree, CMDB type hierarchy, catalog
items, knowledge base folders and articles, canned responses, a sample
workflow and scenario, email templates and a CSAT survey.

---

## 3. Running it

### Docker Compose

```bash
cp .env.example .env          # set JWT_SECRET, SUPER_ADMIN_PASSWORD, SMTP_* …
docker compose up -d --build  # postgres, redis, all services, gateway, prometheus, grafana
docker compose --profile web up -d --build web   # optional: containerized web app on :3000
```

Or run the web app locally with `cd frontend && npm install && npm run dev`.

* Agent workspace: `http://localhost:3000/dashboard`
* Self-service portal: `http://localhost:3000/portal`
* Platform console (super admin): `http://localhost:3000/admin/global`

Create an organization from **Create an organization** on the sign-in page; the
first person becomes the account admin. To load demo data:

```bash
python3 scripts/seed_demo.py --base http://localhost:8080
```

### Kubernetes

Manifests live in `deployments/k8s` (`itsm-service.yaml`, `org-service.yaml`,
gateway wiring, HPA). Replace every value in the `app-secrets` Secret before
deploying, set `PUBLIC_URL` and `CORS_ALLOWED_ORIGINS` in the ConfigMap, and
put the gateway behind TLS (`TRUST_PROXY_HEADERS=true` when a load balancer sets
`X-Forwarded-For`).

### Configuration reference

| Variable | Default | Purpose |
|---|---|---|
| `JWT_SECRET` | dev value | **Required** outside development; shared by all services |
| `ENVIRONMENT` | `development` | Non-development refuses the default JWT secret |
| `SUPER_ADMIN_EMAIL` / `SUPER_ADMIN_PASSWORD` | `admin@taskflow.com` / – | Platform admin bootstrap (dev has a built-in fallback) |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000,…` | Comma list of browser origins allowed by the gateway |
| `RATE_LIMIT_RPS` / `RATE_LIMIT_BURST` | 50 / 100 | Per-client-IP gateway limits |
| `TRUST_PROXY_HEADERS` | `false` | Use `X-Forwarded-For` for client IPs |
| `ITSM_SERVICE_URL` | `http://localhost:8090` | Gateway → ITSM service |
| `PUBLIC_URL` | `http://localhost:3000` | Links in emails |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` | – | Outgoing email (user and ITSM services) |
| `EMAIL_VERIFICATION` | `auto` | Self-service sign-ups must verify their email: `auto` (only when email is configured), `required` or `off`. Set the same value on the user and ITSM services |
| `MAX_UPLOAD_MB` | 15 | Attachment size limit |
| `WORKER_INTERVAL` / `DISABLE_WORKERS` | `60s` / `false` | Background jobs |
| `DB_LOG_QUERIES` | `false` | Log SQL (never in production — statements contain personal data) |

Per-organization settings (branding, password policy, idle sign-out, portal
permissions, ticket prefixes, custom statuses, auto-close, inbound email key)
are managed in **Admin → Account & helpdesk**.

### Inbound email

Configure your email provider's inbound-parse webhook to POST JSON
`{"from": "Name <user@x.com>", "subject": "...", "text": "...", "cc": []}` to the
URL shown in **Admin → Account & helpdesk → Email**. New senders become
requesters (configurable); subjects containing `[INC-12]` add a reply to that
ticket.

---

## 4. API

All endpoints are under `/api/v2` on the gateway and return JSON. Lists return
`{items, total, page, per_page}`; validation errors return HTTP 422 with
`{"message": "...", "errors": {"field": "reason"}}`.

Authentication: `Authorization: Bearer <access token>` from
`POST /api/v1/auth/login`, refreshed with `POST /api/v2/auth/refresh`
(rotating refresh tokens with reuse detection), or an agent API key:
`Authorization: Basic base64("<key>:X")`.

Public account endpoints (no token): `GET /auth/config` (which email features
are on), `POST /auth/verify-email/send` and `POST /auth/verify-email`
(sign-up verification), `POST /auth/forgot/email`,
`POST /auth/forgot/email/check` and `POST /auth/forgot/email/reset` (reset by
emailed link), `POST /auth/forgot/questions` and `POST /auth/forgot/reset`
(security questions). Requests for links never reveal whether an account
exists and are limited to one email a minute and five an hour per account.
Sign-in for an unverified account fails with HTTP 400 and a message asking the
user to verify, but only after the correct password.

| Resource | Endpoints |
|---|---|
| Me | `GET/PUT /me`, `POST /me/password`, `GET/POST/DELETE /me/api-key`, `PUT /me/availability`, `GET /me/notifications`, `POST /me/notifications/read`, `GET /me/tasks` |
| Tickets | `GET/POST /tickets`, `GET/PUT/DELETE /tickets/{id}`, `POST /tickets/{id}/reply|forward|notes|merge|spam|unspam|restore|rating|watch`, `DELETE /tickets/{id}/purge`, `POST /tickets/bulk`, `GET /tickets/export`, `POST /tickets/{id}/scenarios/{scenario_id}` |
| Shared record APIs (`tickets`, `problems`, `changes`, `releases`) | `/{module}/{id}/conversations`, `/notes`, `/tasks`, `/time-entries`, `/activities`, `/associations`, `/attachments` |
| ITIL | `/problems`, `/changes` (+ `/calendar`, `/{id}/approvals`), `/releases`, `/approvals` |
| Assets | `/asset-types`, `/assets` (+ `/export`, `/{id}/relationships`, `/{id}/impact`), `/products`, `/vendors`, `/software` (+ installations), `/contracts`, `/purchase-orders` (+ `/{id}/receive`) |
| Catalog & KB | `/catalog`, `/catalog/items/{id}/request`, `/solutions`, `/solutions/articles`, `/solutions/suggest` |
| People | `/agents`, `/requesters`, `/people/{id}` (+ `convert-to-agent`, `convert-to-requester`, `deactivate`, `reactivate`, `reset-password`, `unlock`, `forget`), `/groups`, `/departments`, `/locations`, `/roles`, `/oncall` |
| Admin | `/settings`, `/business-hours`, `/sla-policies`, `/workflows`, `/scenarios`, `/canned-responses`, `/form-fields`, `/announcements`, `/survey`, `/email-templates`, `/email-outbox`, `/audit-logs` |
| Insights | `GET /dashboard`, `GET /reports/{ticket-volume|sla|agent-performance|group-performance|csat|assets}`, `GET /search` |
| Organization | `GET/POST /departments` (org units; `kind`, `parent_id`, `code`, `cost_center`, `location_id`, `domains`), `PUT/DELETE /departments/{id}`, `GET/POST /teams`, `POST /teams/preview`, `GET/PUT/DELETE /teams/{id}`, `GET/POST /teams/{id}/members`, `DELETE /teams/{id}/members/{user_id}`, `POST /people/bulk`, `POST /people/import` (`kind`, `csv`, `dry_run`), `GET /people/export?kind=` |
| Personal | `PUT/DELETE /me/avatar`, `PUT/DELETE /me/out-of-office`, `GET/PUT /me/notification-preferences`, `GET /me/sessions`, `DELETE /me/sessions/{id}`, `POST /me/sessions/sign-out-others`; avatars are served at `GET /avatars/{user_id}` |
| Projects | `GET/POST /projects`, `GET/PUT/DELETE /projects/{id}`, `GET/POST /projects/{id}/work-items` (filters: `state`, `priority`, `assignee_id` (`me`/`none`), `cycle_id`, `label`, `parent_id`, `q`), `GET/PUT/DELETE /work-items/{id}`, `GET/POST /projects/{id}/cycles`, `PUT/DELETE /cycles/{id}`, `GET /me/work-items`, plus the shared record APIs under `/work-items/{id}/…` |
| Platform (super admin only) | `GET /platform/organizations`, `POST /platform/organizations/{id}/suspend|activate`, `GET /platform/users?q=&org_id=`, `POST /platform/users/{id}/deactivate|reactivate|unlock` |

Suspending an organization blocks sign-in, token refresh and every `/api/v2`
call for its members immediately and revokes their refresh sessions; already
issued access tokens for the legacy `/api/v1` task APIs stay valid until they
expire (24 h). Every platform action is written to the organization's audit log.

---

## 5. Security notes

Fixes made while building the service desk (all covered by tests):

* **Identity spoofing (critical)** — the gateway forwarded client `X-Role` /
  `X-User-Id` headers as gRPC metadata, so an unauthenticated request with
  `X-Role: super_admin` could list every user or delete organizations. Client
  identity headers are now stripped and services only trust verified JWTs.
* **Missing authorization** — the org-service and notification-service had no
  checks; any caller could manage another tenant's teams/projects or read
  anyone's notifications. Both now enforce tenant and ownership rules.
* **Account takeover** — `AdminResetPassword` returned a new temporary password
  to any caller, and `SetSecurityQuestions` let anyone set another user's
  questions and password. Both now require the right caller.
* Org-admin role checks never matched real org admins (`org_admin` vs `admin`),
  breaking user management; the super-admin check compared against the wrong
  role.
* Account lockout is now 15 minutes after 5 failures (was permanent), refresh
  tokens rotate with reuse detection, password changes revoke older tokens,
  deactivated users are blocked at sign-in and on every API call.
* The platform console called a suspend endpoint that never existed and showed
  no status; organization suspension and platform-level user deactivation /
  unlock are now real, enforced at sign-in, refresh and on every API call.
* CORS no longer reflects arbitrary origins with credentials; security headers
  (`X-Frame-Options`, `nosniff`, referrer and permissions policy) are set on the
  gateway and web app; per-IP rate limiting is enabled.
* SQL statement logging (which included password hashes) is opt-in; the
  hard-coded super-admin password is replaced by environment configuration.
* CSV exports neutralize spreadsheet formula injection; attachments are served
  as downloads with a sandboxing CSP; Markdown is rendered without raw HTML.

---

## 6. Verification

```bash
go vet ./... && go test ./...                         # unit tests (SLA calendar, rules, policies, auth, gateway…)
cd frontend && npm run type-check && npm run lint && npm run build
python3 scripts/itsm_smoke_test.py --base http://localhost:8080   # ~370 end-to-end checks
```

Set `SMOKE_SUPER_EMAIL` and `SMOKE_SUPER_PASSWORD` (or `SMOKE_SUPER_TOKEN`) to
include the platform-console checks (organization suspension, user
deactivation, email status); without them that section is skipped.

When the server sends email, point it at a local catch-all SMTP server that
writes one `.eml` file per message and pass `--mail-dir <folder>`: the test
then follows the real verification and reset links and checks welcome,
notification and test emails (~410 checks). Without `--mail-dir`, sign-up
verification is completed through the platform console instead.

The smoke test registers a throwaway organization and exercises account
management, tickets, SLAs, workflows, approvals, the catalog, knowledge base,
problem/change/release management, assets, procurement, analytics, tenant
isolation and token lifecycle. It never touches existing organizations.
