// Display helpers shared by the agent workspace and the self-service portal.

export const PRIORITIES = [
  { value: 1, label: 'Low', color: 'bg-emerald-100 text-emerald-700 ring-emerald-600/20', dot: 'bg-emerald-500' },
  { value: 2, label: 'Medium', color: 'bg-sky-100 text-sky-700 ring-sky-600/20', dot: 'bg-sky-500' },
  { value: 3, label: 'High', color: 'bg-amber-100 text-amber-800 ring-amber-600/20', dot: 'bg-amber-500' },
  { value: 4, label: 'Urgent', color: 'bg-rose-100 text-rose-700 ring-rose-600/20', dot: 'bg-rose-500' },
];

export const LEVELS = [
  { value: 1, label: 'Low' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'High' },
];

export const RISKS = [
  { value: 1, label: 'Low' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'High' },
  { value: 4, label: 'Very high' },
];

export function priorityMeta(p: number) {
  return PRIORITIES.find((x) => x.value === p) ?? PRIORITIES[1];
}

export const TICKET_STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'pending', label: 'Pending' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'closed', label: 'Closed' },
];

export const TICKET_SOURCES = [
  { value: 'portal', label: 'Portal' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'chat', label: 'Chat' },
  { value: 'walkup', label: 'Walk-up' },
  { value: 'slack', label: 'Slack' },
  { value: 'ms_teams', label: 'MS Teams' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'api', label: 'API' },
];

export const CHANGE_STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'planning', label: 'Planning' },
  { value: 'awaiting_approval', label: 'Awaiting approval' },
  { value: 'pending_release', label: 'Pending release' },
  { value: 'pending_review', label: 'Pending review' },
  { value: 'closed', label: 'Closed' },
];

export const CHANGE_TYPES = [
  { value: 'minor', label: 'Minor' },
  { value: 'standard', label: 'Standard' },
  { value: 'major', label: 'Major' },
  { value: 'emergency', label: 'Emergency' },
];

export const PROBLEM_STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'change_requested', label: 'Change requested' },
  { value: 'closed', label: 'Closed' },
];

export const RELEASE_STATUSES = [
  { value: 'open', label: 'Open' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'incomplete', label: 'Incomplete' },
  { value: 'completed', label: 'Completed' },
];

export const ASSET_STATES = [
  { value: 'in_use', label: 'In use' },
  { value: 'in_stock', label: 'In stock' },
  { value: 'in_repair', label: 'In repair' },
  { value: 'missing', label: 'Missing' },
  { value: 'retired', label: 'Retired' },
  { value: 'disposed', label: 'Disposed' },
];

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  pending: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  resolved: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  closed: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  planning: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
  awaiting_approval: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  pending_release: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  pending_review: 'bg-cyan-50 text-cyan-700 ring-cyan-600/20',
  change_requested: 'bg-violet-50 text-violet-700 ring-violet-600/20',
  on_hold: 'bg-slate-100 text-slate-700 ring-slate-500/20',
  in_progress: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  incomplete: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  completed: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  in_use: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  in_stock: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  in_repair: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  missing: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  retired: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  disposed: 'bg-slate-100 text-slate-500 ring-slate-500/20',
  requested: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  approved: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  rejected: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  cancelled: 'bg-slate-100 text-slate-500 ring-slate-500/20',
  not_requested: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  active: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  draft: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  published: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  expired: 'bg-rose-50 text-rose-700 ring-rose-600/20',
  scheduled: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  terminated: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  pending_approval: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  ordered: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  partially_received: 'bg-amber-50 text-amber-800 ring-amber-600/20',
  received: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  delivered: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  queued: 'bg-sky-50 text-sky-700 ring-sky-600/20',
  sent: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  skipped: 'bg-slate-100 text-slate-600 ring-slate-500/20',
  failed: 'bg-rose-50 text-rose-700 ring-rose-600/20',
};

export function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? 'bg-slate-100 text-slate-700 ring-slate-500/20';
}

export function labelize(value: string | null | undefined): string {
  if (!value) return '—';
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function initials(name?: string | null): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '?';
}

const AVATAR_COLORS = ['bg-sky-600', 'bg-violet-600', 'bg-emerald-600', 'bg-amber-600', 'bg-rose-600', 'bg-indigo-600', 'bg-teal-600', 'bg-fuchsia-600'];

export function avatarColor(seed?: string | null): string {
  if (!seed) return 'bg-slate-500';
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

export function fmtDate(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDateTime(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

export function timeAgo(value?: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  const diff = (Date.now() - d.getTime()) / 1000;
  const abs = Math.abs(diff);
  const suffix = diff >= 0 ? 'ago' : 'from now';
  if (abs < 45) return diff >= 0 ? 'just now' : 'in a moment';
  const units: [number, string][] = [
    [60, 'minute'],
    [3600, 'hour'],
    [86400, 'day'],
    [604800, 'week'],
    [2629800, 'month'],
    [31557600, 'year'],
  ];
  let unit = 'minute';
  let size = 60;
  for (const [s, u] of units) {
    if (abs >= s) {
      unit = u;
      size = s;
    }
  }
  const n = Math.max(1, Math.round(abs / size));
  return `${n} ${unit}${n > 1 ? 's' : ''} ${suffix}`;
}

export function fmtMinutes(m: number): string {
  if (!m) return '0m';
  const h = Math.floor(m / 60);
  const r = m % 60;
  return h ? `${h}h ${r.toString().padStart(2, '0')}m` : `${r}m`;
}

export function fmtMoney(v: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(v || 0);
  } catch {
    return `$${(v || 0).toFixed(2)}`;
  }
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Converts an ISO date into the value expected by <input type="datetime-local">. */
export function toLocalInput(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Converts a datetime-local input value to an ISO string (or empty). */
export function fromLocalInput(value: string): string {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toISOString();
}

export function toDateInput(value?: string | null): string {
  if (!value) return '';
  return value.slice(0, 10);
}

export const SLA_LABELS: Record<string, { label: string; color: string }> = {
  on_track: { label: 'On track', color: 'text-emerald-700 bg-emerald-50' },
  due_soon: { label: 'Due soon', color: 'text-amber-800 bg-amber-50' },
  overdue: { label: 'Overdue', color: 'text-rose-700 bg-rose-50' },
  paused: { label: 'SLA paused', color: 'text-slate-600 bg-slate-100' },
  met: { label: 'SLA met', color: 'text-emerald-700 bg-emerald-50' },
  violated: { label: 'SLA violated', color: 'text-rose-700 bg-rose-50' },
  none: { label: 'No SLA', color: 'text-slate-500 bg-slate-50' },
};

export const TIME_ZONES = [
  'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Sao_Paulo',
  'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Madrid', 'Africa/Johannesburg', 'Asia/Dubai',
  'Asia/Kolkata', 'Asia/Singapore', 'Asia/Shanghai', 'Asia/Tokyo', 'Australia/Sydney', 'Pacific/Auckland',
];

/** Compact due label for tables: "in 3h", "2d overdue". */
export function shortDue(value?: string | null): string {
  if (!value) return '—';
  const diff = new Date(value).getTime() - Date.now();
  const abs = Math.abs(diff) / 60000;
  const unit = abs < 60 ? `${Math.max(1, Math.round(abs))}m` : abs < 1440 ? `${Math.round(abs / 60)}h` : `${Math.round(abs / 1440)}d`;
  return diff >= 0 ? `in ${unit}` : `${unit} overdue`;
}
