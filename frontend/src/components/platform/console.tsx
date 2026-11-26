'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, Ban, Building2, CheckCircle2, KeyRound, LogOut, MailCheck, ShieldAlert, ShieldCheck, Trash2, Unlock, UserCheck, UserX, XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Btn, Card, DefList, Drawer, EmptyState, ErrorBlock, LoadingBlock, Modal, SearchInput, Stat, Table, Td, TextInput, Th, useConfirm } from '@/components/desk/kit';
import { apiClient } from '@/lib/api';
import { v2, parseApiError } from '@/lib/itsm/api';
import { fmtDateTime, timeAgo } from '@/lib/itsm/format';
import { cn } from '@/lib/utils';
import { SignupsChart, type SignupDay } from './signups-chart';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Overview {
  organizations: { total: number; suspended: number };
  users: { total: number; unverified: number; active_7d: number; active_30d: number; never_signed_in: number; locked: number; deactivated: number; new_24h: number; new_7d: number; suspicious: number };
  security: { admins: number; admins_with_passkey: number; passkeys: number };
  tickets: { total: number; open: number };
  email: { queued: number; failed_24h: number; sent_24h: number };
  signups: SignupDay[];
}

export interface Account {
  id: string;
  email: string;
  username: string;
  full_name: string;
  role: string;
  org_id?: string | null;
  org_name?: string | null;
  is_active: boolean;
  locked: boolean;
  email_verification_pending: boolean;
  has_logged_in: boolean;
  signup_ip?: string | null;
  last_login?: string | null;
  created_at: string;
  passkeys: number;
  status: 'active' | 'locked' | 'deactivated' | 'unverified';
  flags: string[];
  risk_score: number;
}

interface Organization {
  id: string;
  name: string;
  domain?: string | null;
  member_count: number;
  agent_count: number;
  ticket_count: number;
  open_tickets: number;
  last_login?: string | null;
  created_at: string;
  status: 'active' | 'suspended';
}

interface Check { key: string; label: string; ok: boolean; detail: string }
interface SecurityEvent { id: string; org_name?: string | null; actor_email?: string | null; action: string; summary: string; ip: string; created_at: string }
interface AuditRow { id: string; action: string; summary: string; ip: string; created_at: string }

const FLAG_LABELS: Record<string, string> = {
  unverified_24h: 'Unverified > 24h',
  unverified: 'Unverified',
  disposable_email: 'Throwaway email',
  never_signed_in: 'Never signed in',
  link_in_name: 'Link in name',
  random_looking_name: 'Random-looking name',
  same_ip_burst: 'Many sign-ups from one IP',
  signup_burst: 'Sign-up burst',
};

const roleLabel = (r: string) => ({ super_admin: 'Super admin', org_admin: 'Org admin', admin: 'Org admin' } as Record<string, string>)[r] ?? 'Member';

function RiskBadge({ score }: { score: number }) {
  const tone = score >= 70 ? 'bg-rose-100 text-rose-700' : score >= 50 ? 'bg-amber-100 text-amber-800' : score > 0 ? 'bg-slate-100 text-slate-600' : 'bg-emerald-50 text-emerald-700';
  const label = score >= 70 ? 'High' : score >= 50 ? 'Medium' : score > 0 ? 'Low' : 'None';
  return <Badge className={tone}>{label} · {score}</Badge>;
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    active: 'bg-emerald-50 text-emerald-700', unverified: 'bg-amber-50 text-amber-800', locked: 'bg-orange-50 text-orange-700',
    deactivated: 'bg-slate-100 text-slate-500', suspended: 'bg-rose-50 text-rose-700',
  };
  return <Badge className={map[status] ?? 'bg-slate-100 text-slate-600'}>{status}</Badge>;
}

const errMsg = (e: unknown) => parseApiError(e).message;

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export function OverviewSection({ go }: { go: (section: string, filter?: string) => void }) {
  const overview = useQuery({ queryKey: ['platform-overview'], queryFn: () => v2.get<Overview>('/platform/overview'), refetchInterval: 60_000 });
  const posture = useQuery({ queryKey: ['platform-posture'], queryFn: () => v2.get<{ checks: Check[] }>('/platform/security/posture') });
  if (overview.isLoading) return <LoadingBlock />;
  if (overview.error || !overview.data) return <ErrorBlock message={errMsg(overview.error)} onRetry={() => overview.refetch()} />;
  const o = overview.data;
  const coverage = o.security.admins ? Math.round((o.security.admins_with_passkey / o.security.admins) * 100) : 100;
  const failing = posture.data?.checks.filter((c) => !c.ok) ?? [];
  return (
    <div className="space-y-5">
      {(o.users.suspicious > 0 || failing.length > 0) && (
        <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              {o.users.suspicious > 0 && <><b>{o.users.suspicious}</b> account{o.users.suspicious === 1 ? '' : 's'} look fake. </>}
              {failing.length > 0 && <><b>{failing.length}</b> security setting{failing.length === 1 ? ' needs' : 's need'} attention.</>}
            </span>
          </div>
          <div className="flex gap-2">
            {o.users.suspicious > 0 && <Btn size="sm" onClick={() => go('accounts', 'suspicious')}>Review accounts</Btn>}
            {failing.length > 0 && <Btn size="sm" onClick={() => go('security')}>Open security</Btn>}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Organizations" value={o.organizations.total} hint={`${o.organizations.suspended} suspended`} icon={<Building2 className="h-4 w-4" />} />
        <Stat label="People" value={o.users.total} hint={`${o.users.active_7d} active this week · ${o.users.new_7d} new`} />
        <Stat label="Look fake" value={o.users.suspicious} tone={o.users.suspicious ? 'rose' : 'emerald'} hint={`${o.users.unverified} never verified their email`} />
        <Stat label="Admin passkeys" value={`${coverage}%`} tone={coverage === 100 ? 'emerald' : 'amber'} hint={`${o.security.admins_with_passkey} of ${o.security.admins} admins`} icon={<KeyRound className="h-4 w-4" />} />
        <Stat label="Open tickets" value={o.tickets.open} hint={`${o.tickets.total} in total`} />
        <Stat label="Never signed in" value={o.users.never_signed_in} hint="accounts that were never used" />
        <Stat label="Locked / deactivated" value={`${o.users.locked} / ${o.users.deactivated}`} />
        <Stat label="Email, last 24h" value={o.email.sent_24h} tone={o.email.failed_24h ? 'rose' : 'slate'} hint={`${o.email.failed_24h} failed · ${o.email.queued} queued`} />
      </div>
      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Sign-ups, last 30 days" className="xl:col-span-2">
          <SignupsChart days={o.signups} />
        </Card>
        <Card title="Security checklist">
          {posture.isLoading ? <LoadingBlock /> : <PostureList checks={posture.data?.checks ?? []} compact />}
        </Card>
      </div>
    </div>
  );
}

function PostureList({ checks, compact }: { checks: Check[]; compact?: boolean }) {
  return (
    <ul className="space-y-2.5 text-sm">
      {checks.map((c) => (
        <li key={c.key} className="flex items-start gap-2">
          {c.ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
          <div>
            <div className={cn('font-medium', c.ok ? 'text-slate-800' : 'text-amber-900')}>{c.label}</div>
            {(!compact || !c.ok) && <div className="text-xs text-slate-500">{c.detail}</div>}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Account review
// ---------------------------------------------------------------------------

const FILTERS = [
  { id: 'suspicious', label: 'Look fake' },
  { id: 'unverified', label: 'Unverified' },
  { id: 'never_signed_in', label: 'Never signed in' },
  { id: 'admins_no_passkey', label: 'Admins without passkey' },
  { id: 'admins', label: 'Admins' },
  { id: 'locked', label: 'Locked' },
  { id: 'deactivated', label: 'Deactivated' },
  { id: '', label: 'Everyone' },
];

export function AccountsSection({ filter, setFilter, orgFilter, clearOrg }: { filter: string; setFilter: (f: string) => void; orgFilter?: { id: string; name: string } | null; clearOrg: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [q, setQ] = React.useState('');
  const [debounced, setDebounced] = React.useState('');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [open, setOpen] = React.useState<string | null>(null);
  React.useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const list = useQuery({
    queryKey: ['platform-accounts', filter, debounced, orgFilter?.id],
    queryFn: () => v2.get<{ items: Account[]; total: number }>('/platform/accounts', { filter, q: debounced, org_id: orgFilter?.id, sort: 'risk' }),
  });
  React.useEffect(() => setSelected(new Set()), [filter, debounced, orgFilter?.id]);
  const items = list.data?.items ?? [];
  const deletable = (a: Account) => a.role !== 'super_admin' && (a.email_verification_pending || !a.has_logged_in);

  const purge = useMutation({
    mutationFn: (ids: string[]) => v2.post<{ deleted: number; results: { email: string; result: string; reason?: string }[] }>('/platform/accounts/purge', { ids }),
    onSuccess: (res) => {
      const skipped = res.results.filter((r) => r.result === 'skipped');
      toast.success(`Deleted ${res.deleted} account${res.deleted === 1 ? '' : 's'}`);
      if (skipped.length) toast.warning(`${skipped.length} kept: ${skipped.slice(0, 3).map((s) => `${s.email} (${s.reason})`).join('; ')}`, { duration: 10000 });
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['platform-accounts'] });
      qc.invalidateQueries({ queryKey: ['platform-overview'] });
      qc.invalidateQueries({ queryKey: ['platform-orgs'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });

  const toggle = (id: string) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const selectable = items.filter(deletable);
  const allSelected = selectable.length > 0 && selectable.every((a) => selected.has(a.id));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button key={f.id} type="button" onClick={() => setFilter(f.id)}
            className={cn('rounded-full border px-3 py-1 text-xs font-medium transition', filter === f.id ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300')}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <SearchInput value={q} onChange={setQ} placeholder="Search email, name or organization" className="w-full sm:w-80" />
          {orgFilter && <Badge className="bg-blue-50 text-blue-700">{orgFilter.name} <button type="button" onClick={clearOrg} aria-label="Clear organization filter" className="ml-1">×</button></Badge>}
        </div>
        <Btn variant="danger" size="sm" disabled={!selected.size} loading={purge.isPending}
          onClick={async () => {
            const ok = await confirm({
              title: `Delete ${selected.size} account${selected.size === 1 ? '' : 's'}?`,
              message: 'They are removed permanently, with their empty organizations. Accounts that verified and signed in, or that have tickets, are kept; deactivate those instead.',
              confirmLabel: 'Delete', danger: true,
            });
            if (ok) purge.mutate(Array.from(selected));
          }}>
          <Trash2 className="h-4 w-4" /> Delete selected ({selected.size})
        </Btn>
      </div>
      <Card padded={false}>
        {list.isLoading ? <LoadingBlock /> : list.error ? <ErrorBlock message={errMsg(list.error)} /> : items.length === 0 ? (
          <EmptyState title="No accounts here" description={filter === 'suspicious' ? 'Nothing looks fake right now.' : 'Try another filter.'} icon={<ShieldCheck className="h-6 w-6" />} />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <thead>
                <tr>
                  <Th className="w-8">
                    <input type="checkbox" aria-label="Select all removable" checked={allSelected}
                      onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((a) => a.id)))} />
                  </Th>
                  <Th>Account</Th><Th>Organization</Th><Th>Risk</Th><Th>Status</Th><Th>Passkeys</Th><Th>Created</Th><Th>Last sign-in</Th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(a.id)}>
                    <Td>
                      <span onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select ${a.email}`} disabled={!deletable(a)} checked={selected.has(a.id)} onChange={() => toggle(a.id)} />
                      </span>
                    </Td>
                    <Td>
                      <div className="font-medium text-slate-900">{a.full_name || a.username}</div>
                      <div className="text-xs text-slate-500">{a.email} · {roleLabel(a.role)}</div>
                      {a.flags.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {a.flags.map((f) => <span key={f} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{FLAG_LABELS[f] ?? f}</span>)}
                        </div>
                      )}
                    </Td>
                    <Td className="max-w-[180px] truncate text-slate-600">{a.org_name ?? '—'}</Td>
                    <Td><RiskBadge score={a.risk_score} /></Td>
                    <Td><StatusPill status={a.status} /></Td>
                    <Td className="tabular-nums">{a.passkeys}</Td>
                    <Td className="whitespace-nowrap text-slate-600">{timeAgo(a.created_at)}</Td>
                    <Td className="whitespace-nowrap text-slate-600">{a.last_login ? timeAgo(a.last_login) : 'never'}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
      <p className="text-xs text-slate-500">{list.data?.total ?? 0} account(s). Only accounts that never verified or never signed in, and have no tickets, can be deleted.</p>
      <AccountDrawer id={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function AccountDrawer({ id, onClose }: { id: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const detail = useQuery({
    queryKey: ['platform-user', id],
    enabled: !!id,
    queryFn: () => v2.get<{ user: Account; passkeys: { id: string; name: string; created_at: string; last_used_at?: string | null }[]; sessions: { id: string; created_at: string; ip: string; user_agent: string }[]; events: AuditRow[]; footprint: number }>(`/platform/users/${id}`),
  });
  const act = useMutation({
    mutationFn: ({ path }: { path: string; done: string }) => v2.post(`/platform/users/${id}/${path}`),
    onSuccess: (_r, v) => {
      toast.success(v.done);
      qc.invalidateQueries({ queryKey: ['platform-user', id] });
      qc.invalidateQueries({ queryKey: ['platform-accounts'] });
      qc.invalidateQueries({ queryKey: ['platform-overview'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const run = async (path: string, done: string, title: string, message: string, danger = false) => {
    if (await confirm({ title, message, confirmLabel: 'Continue', danger })) act.mutate({ path, done });
  };
  const d = detail.data;
  const u = d?.user;
  const isSuper = u?.role === 'super_admin';
  return (
    <Drawer open={!!id} onClose={onClose} title={u ? u.full_name || u.email : 'Account'} width="max-w-2xl">
      {detail.isLoading || !d || !u ? <LoadingBlock /> : (
        <div className="space-y-5 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={u.status} /> <RiskBadge score={u.risk_score} /> <Badge className="bg-slate-100 text-slate-700">{roleLabel(u.role)}</Badge>
          </div>
          {u.flags.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-amber-900">
              <div className="mb-1 font-medium">Why this account is flagged</div>
              <ul className="list-inside list-disc text-xs">{u.flags.map((f) => <li key={f}>{FLAG_LABELS[f] ?? f}</li>)}</ul>
            </div>
          )}
          <DefList items={[
            { label: 'Email', value: u.email },
            { label: 'Organization', value: u.org_name ?? '—' },
            { label: 'Created', value: fmtDateTime(u.created_at) },
            { label: 'Last sign-in', value: u.last_login ? fmtDateTime(u.last_login) : 'never' },
            { label: 'Sign-up IP', value: u.signup_ip ?? '—' },
            { label: 'Tickets and replies', value: d.footprint },
          ]} />
          {!isSuper && (
            <div className="flex flex-wrap gap-2">
              {u.email_verification_pending && <Btn size="sm" loading={act.isPending} onClick={() => run('verify-email', 'Email marked verified', 'Mark email as verified?', 'Only do this when you know the address belongs to this person.')}><MailCheck className="h-4 w-4" /> Verify email</Btn>}
              {u.locked && <Btn size="sm" loading={act.isPending} onClick={() => act.mutate({ path: 'unlock', done: 'Unlocked' })}><Unlock className="h-4 w-4" /> Unlock</Btn>}
              {u.is_active ? (
                <Btn size="sm" loading={act.isPending} onClick={() => run('deactivate', 'Deactivated', 'Deactivate this account?', 'They are signed out everywhere and cannot sign in until reactivated.', true)}><UserX className="h-4 w-4" /> Deactivate</Btn>
              ) : (
                <Btn size="sm" loading={act.isPending} onClick={() => act.mutate({ path: 'reactivate', done: 'Reactivated' })}><UserCheck className="h-4 w-4" /> Reactivate</Btn>
              )}
              <Btn size="sm" loading={act.isPending} onClick={() => run('sign-out', 'Signed out everywhere', 'Sign out everywhere?', 'Every session of this person ends now.')}><LogOut className="h-4 w-4" /> Sign out everywhere</Btn>
              {d.passkeys.length > 0 && (
                <Btn size="sm" loading={act.isPending} onClick={() => run('reset-passkeys', 'Passkeys reset', 'Reset sign-in security?', 'Removes all passkeys and recovery codes and signs them out. At their next sign-in they set up a new passkey after confirming a code sent to their email. Use this when someone lost their devices.', true)}>
                  <KeyRound className="h-4 w-4" /> Reset passkeys
                </Btn>
              )}
            </div>
          )}
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Passkeys ({d.passkeys.length})</h3>
            {d.passkeys.length === 0 ? <p className="text-xs text-slate-500">None.</p> : (
              <ul className="space-y-1">{d.passkeys.map((k) => <li key={k.id} className="flex justify-between text-xs"><span>{k.name}</span><span className="text-slate-500">{k.last_used_at ? `used ${timeAgo(k.last_used_at)}` : 'never used'}</span></li>)}</ul>
            )}
          </section>
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Active sessions ({d.sessions.length})</h3>
            {d.sessions.length === 0 ? <p className="text-xs text-slate-500">None.</p> : (
              <ul className="space-y-1">{d.sessions.map((s) => <li key={s.id} className="text-xs text-slate-600">{fmtDateTime(s.created_at)} · {s.ip || 'unknown IP'} · <span className="text-slate-400">{s.user_agent.slice(0, 60)}</span></li>)}</ul>
            )}
          </section>
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Activity</h3>
            {d.events.length === 0 ? <p className="text-xs text-slate-500">Nothing recorded.</p> : (
              <ul className="space-y-1.5">{d.events.map((e) => <li key={e.id} className="text-xs"><span className="text-slate-800">{e.summary}</span> <span className="text-slate-400">· {timeAgo(e.created_at)}{e.ip ? ` · ${e.ip}` : ''}</span></li>)}</ul>
            )}
          </section>
        </div>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Organizations
// ---------------------------------------------------------------------------

export function OrganizationsSection({ showMembers }: { showMembers: (org: { id: string; name: string }) => void }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [q, setQ] = React.useState('');
  const [open, setOpen] = React.useState<string | null>(null);
  const list = useQuery({ queryKey: ['platform-orgs'], queryFn: () => v2.items<Organization>('/platform/organizations') });
  const suspend = useMutation({
    mutationFn: ({ id, on }: { id: string; on: boolean }) => v2.post(`/platform/organizations/${id}/${on ? 'suspend' : 'activate'}`),
    onSuccess: () => {
      toast.success('Updated');
      qc.invalidateQueries({ queryKey: ['platform-orgs'] });
      qc.invalidateQueries({ queryKey: ['platform-org'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const items = (list.data ?? []).filter((o) => !q || o.name.toLowerCase().includes(q.toLowerCase()) || (o.domain ?? '').includes(q.toLowerCase()));
  return (
    <div className="space-y-4">
      <SearchInput value={q} onChange={setQ} placeholder="Search organizations" className="w-full sm:w-80" />
      <Card padded={false}>
        {list.isLoading ? <LoadingBlock /> : list.error ? <ErrorBlock message={errMsg(list.error)} /> : (
          <div className="overflow-x-auto">
            <Table>
              <thead><tr><Th>Organization</Th><Th>Status</Th><Th>People</Th><Th>Tickets</Th><Th>Last activity</Th><Th>Created</Th><Th /></tr></thead>
              <tbody>
                {items.map((o) => (
                  <tr key={o.id} className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(o.id)}>
                    <Td><div className="font-medium text-slate-900">{o.name}</div><div className="text-xs text-slate-500">{o.domain || 'no domain'}</div></Td>
                    <Td><StatusPill status={o.status} /></Td>
                    <Td className="tabular-nums">{o.member_count} <span className="text-xs text-slate-400">({o.agent_count} agents)</span></Td>
                    <Td className="tabular-nums">{o.ticket_count} <span className="text-xs text-slate-400">({o.open_tickets} open)</span></Td>
                    <Td className="whitespace-nowrap text-slate-600">{o.last_login ? timeAgo(o.last_login) : 'never'}</Td>
                    <Td className="whitespace-nowrap text-slate-600">{timeAgo(o.created_at)}</Td>
                    <Td>
                      <span onClick={(e) => e.stopPropagation()}>
                        <Btn size="xs" variant="ghost" onClick={async () => {
                          const on = o.status !== 'suspended';
                          if (await confirm({ title: on ? `Suspend ${o.name}?` : `Reactivate ${o.name}?`, message: on ? 'Every member is signed out and cannot sign in.' : 'Members can sign in again.', confirmLabel: on ? 'Suspend' : 'Reactivate', danger: on }))
                            suspend.mutate({ id: o.id, on });
                        }}>
                          {o.status === 'suspended' ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Ban className="h-3.5 w-3.5 text-rose-500" />}
                        </Btn>
                      </span>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
      <OrgDrawer id={open} onClose={() => setOpen(null)} showMembers={showMembers} />
    </div>
  );
}

function OrgDrawer({ id, onClose, showMembers }: { id: string | null; onClose: () => void; showMembers: (org: { id: string; name: string }) => void }) {
  const qc = useQueryClient();
  const [deleting, setDeleting] = React.useState(false);
  const [confirmName, setConfirmName] = React.useState('');
  const detail = useQuery({
    queryKey: ['platform-org', id],
    enabled: !!id,
    queryFn: () => v2.get<{ organization: { id: string; name: string; domain?: string | null; is_suspended: boolean; created_at: string }; members: Account[]; events: AuditRow[]; data: Record<string, number>; deletable: boolean }>(`/platform/organizations/${id}`),
  });
  const remove = useMutation({
    mutationFn: () => apiClient.delete(`/api/v2/platform/organizations/${id}`, { data: { confirm_name: confirmName } }),
    onSuccess: () => {
      toast.success('Organization deleted');
      setDeleting(false);
      setConfirmName('');
      onClose();
      qc.invalidateQueries({ queryKey: ['platform-orgs'] });
      qc.invalidateQueries({ queryKey: ['platform-overview'] });
      qc.invalidateQueries({ queryKey: ['platform-accounts'] });
    },
    onError: (e) => toast.error(errMsg(e)),
  });
  const d = detail.data;
  return (
    <Drawer open={!!id} onClose={onClose} title={d?.organization.name ?? 'Organization'} width="max-w-2xl">
      {detail.isLoading || !d ? <LoadingBlock /> : (
        <div className="space-y-5 text-sm">
          <DefList items={[
            { label: 'Status', value: <StatusPill status={d.organization.is_suspended ? 'suspended' : 'active'} /> },
            { label: 'Domain', value: d.organization.domain || '—' },
            { label: 'Created', value: fmtDateTime(d.organization.created_at) },
            { label: 'Records', value: Object.entries(d.data).map(([k, v]) => `${v} ${k}`).join(' · ') },
          ]} />
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">People ({d.members.length})</h3>
              <Btn size="xs" variant="ghost" onClick={() => { showMembers({ id: d.organization.id, name: d.organization.name }); onClose(); }}>Open in account review</Btn>
            </div>
            <ul className="divide-y divide-slate-100 rounded border border-slate-200">
              {d.members.slice(0, 25).map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
                  <span><span className="font-medium text-slate-800">{m.full_name || m.username}</span> <span className="text-slate-500">{m.email} · {roleLabel(m.role)}</span></span>
                  <span className="flex items-center gap-1.5"><StatusPill status={m.status} />{m.passkeys > 0 && <KeyRound className="h-3.5 w-3.5 text-emerald-600" aria-label="has a passkey" />}</span>
                </li>
              ))}
            </ul>
          </section>
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Recent activity</h3>
            {d.events.length === 0 ? <p className="text-xs text-slate-500">Nothing recorded.</p> : (
              <ul className="space-y-1.5">{d.events.slice(0, 15).map((e) => <li key={e.id} className="text-xs"><span className="text-slate-800">{e.summary}</span> <span className="text-slate-400">· {timeAgo(e.created_at)}</span></li>)}</ul>
            )}
          </section>
          <section className="rounded-md border border-rose-200 p-3">
            <h3 className="mb-1 font-medium text-rose-700">Delete organization</h3>
            {d.deletable ? (
              <>
                <p className="mb-2 text-xs text-slate-600">Removes the organization and all {d.members.length} of its people permanently. Use it for fake or abandoned sign-ups.</p>
                <Btn size="sm" variant="danger" onClick={() => setDeleting(true)}><Trash2 className="h-4 w-4" /> Delete…</Btn>
              </>
            ) : (
              <p className="text-xs text-slate-600">This organization has tickets, assets or other records, so it can&apos;t be deleted. Suspend it instead.</p>
            )}
          </section>
          <Modal open={deleting} onClose={() => setDeleting(false)} title="Delete organization" size="sm"
            footer={<Btn variant="danger" loading={remove.isPending} disabled={confirmName !== d.organization.name} onClick={() => remove.mutate()}>Delete permanently</Btn>}>
            <p className="mb-2 text-sm text-slate-600">Type <b>{d.organization.name}</b> to confirm.</p>
            <TextInput autoFocus value={confirmName} onChange={(e) => setConfirmName(e.target.value)} />
          </Modal>
        </div>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------
// Security
// ---------------------------------------------------------------------------

export function SecuritySection() {
  const posture = useQuery({ queryKey: ['platform-posture'], queryFn: () => v2.get<{ checks: Check[] }>('/platform/security/posture') });
  const [action, setAction] = React.useState('');
  const events = useQuery({ queryKey: ['platform-events', action], queryFn: () => v2.items<SecurityEvent>('/platform/security/events', { action: action ? `${action}%` : undefined }) });
  const kinds = [
    { id: '', label: 'All' }, { id: 'security.', label: 'Sign-in & passkeys' }, { id: 'platform.', label: 'Platform admin' },
    { id: 'organization.', label: 'Organizations' }, { id: 'user.', label: 'Account changes' },
  ];
  return (
    <div className="grid gap-5 xl:grid-cols-3">
      <Card title="Security checklist">
        {posture.isLoading ? <LoadingBlock /> : <PostureList checks={posture.data?.checks ?? []} />}
      </Card>
      <Card title="Security events" className="xl:col-span-2" padded={false}>
        <div className="flex flex-wrap gap-1.5 border-b border-slate-100 px-4 py-3">
          {kinds.map((k) => (
            <button key={k.id} type="button" onClick={() => setAction(k.id)}
              className={cn('rounded-full border px-2.5 py-0.5 text-xs', action === k.id ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 text-slate-600')}>{k.label}</button>
          ))}
        </div>
        {events.isLoading ? <LoadingBlock /> : (events.data ?? []).length === 0 ? <EmptyState title="No events yet" /> : (
          <div className="max-h-[560px] overflow-auto">
            <Table>
              <thead><tr><Th>When</Th><Th>What</Th><Th>Who</Th><Th>Organization</Th><Th>IP</Th></tr></thead>
              <tbody>
                {(events.data ?? []).map((e) => (
                  <tr key={e.id}>
                    <Td className="whitespace-nowrap text-slate-500" >{timeAgo(e.created_at)}</Td>
                    <Td><div className="text-slate-800">{e.summary}</div><div className="text-[10px] text-slate-400">{e.action}</div></Td>
                    <Td className="text-slate-600">{e.actor_email ?? '—'}</Td>
                    <Td className="text-slate-600">{e.org_name ?? 'Platform'}</Td>
                    <Td className="text-slate-500">{e.ip}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Health
// ---------------------------------------------------------------------------

export function HealthSection() {
  const h = useQuery({
    queryKey: ['platform-health'],
    refetchInterval: 15_000,
    queryFn: () => v2.get<{ database: { ok: boolean; latency_ms: number; size: string; connections: number; pool: Record<string, number> }; service: { uptime_seconds: number; go_version: string; goroutines: number; memory_mb: number; environment: string }; checked_at: string }>('/platform/health'),
  });
  if (h.isLoading) return <LoadingBlock />;
  if (h.error || !h.data) return <ErrorBlock message={errMsg(h.error)} onRetry={() => h.refetch()} />;
  const { database: db, service: s } = h.data;
  const up = s.uptime_seconds;
  const uptime = up > 86400 ? `${Math.floor(up / 86400)}d ${Math.floor((up % 86400) / 3600)}h` : up > 3600 ? `${Math.floor(up / 3600)}h ${Math.floor((up % 3600) / 60)}m` : `${Math.floor(up / 60)}m`;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Database" value={db.ok ? 'Up' : 'Down'} tone={db.ok ? 'emerald' : 'rose'} hint={`${db.latency_ms.toFixed(1)} ms round trip`} icon={db.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />} />
        <Stat label="Database size" value={db.size} hint={`${db.connections} connections`} />
        <Stat label="Service uptime" value={uptime} hint={`${s.environment} · ${s.go_version}`} />
        <Stat label="Service memory" value={`${s.memory_mb} MB`} hint={`${s.goroutines} goroutines`} />
      </div>
      <Card title="Connection pool">
        <DefList items={Object.entries(db.pool).map(([k, v]) => ({ label: k.replace('_', ' '), value: v }))} />
      </Card>
      <p className="text-xs text-slate-500">Measured live by the service desk service · refreshed every 15 seconds · last check {fmtDateTime(h.data.checked_at)}.</p>
    </div>
  );
}
