'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Sparkles, Trash2, UserMinus, Users2, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useCan, useDepartments, useLocations } from '@/lib/itsm/hooks';
import type { ListResponse, Team, TeamCondition, TeamRules, UserBrief } from '@/lib/itsm/types';
import { Avatar, Badge, Btn, Card, EmptyState, ErrorBlock, Field, LoadingBlock, Modal, PageHeader, Pagination, SearchInput, SelectBox, TextArea, TextInput, useConfirm } from '@/components/desk/kit';
import { PersonPicker, useDebounced } from '@/components/desk/pickers';

const TEAM_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#ca8a04', '#4f46e5'];

const FIELDS: { value: string; label: string }[] = [
  { value: 'unit', label: 'Org unit' },
  { value: 'location', label: 'Location' },
  { value: 'reporting_manager', label: 'Reporting manager' },
  { value: 'job_title', label: 'Job title' },
  { value: 'email_domain', label: 'Email domain' },
  { value: 'person_type', label: 'Person type' },
  { value: 'vip', label: 'VIP' },
];

const OPERATORS: Record<string, { value: string; label: string }[]> = {
  unit: [{ value: 'within', label: 'is or is under' }, { value: 'is', label: 'is exactly' }, { value: 'is_not', label: 'is not' }],
  location: [{ value: 'is', label: 'is' }, { value: 'is_not', label: 'is not' }],
  reporting_manager: [{ value: 'is', label: 'is' }, { value: 'is_not', label: 'is not' }],
  job_title: [{ value: 'contains', label: 'contains' }, { value: 'is', label: 'is' }],
  email_domain: [{ value: 'is', label: 'is' }, { value: 'is_not', label: 'is not' }],
  person_type: [{ value: 'is', label: 'is' }],
  vip: [{ value: 'is', label: 'is' }],
};

export function TeamsAdmin() {
  const can = useCan();
  const router = useRouter();
  const [q, setQ] = React.useState('');
  const [creating, setCreating] = React.useState(false);
  const term = useDebounced(q.trim(), 250);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['teams', term], queryFn: () => v2.items<Team>('/teams', { q: term || undefined }) });
  const teams = data ?? [];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Teams"
        subtitle="Cross-functional groups of people. Pick members by hand, or let rules keep membership up to date as people join, move or leave."
        breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Teams' }]}
        icon={<Users2 className="h-5 w-5" />}
        actions={can('users.manage') && <Btn variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>New team</Btn>}
      />
      <SearchInput value={q} onChange={setQ} placeholder="Search teams…" className="max-w-sm" />
      {isLoading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={parseApiError(error).message} onRetry={() => refetch()} />
      ) : teams.length === 0 ? (
        <EmptyState icon={<Users2 className="h-6 w-6" />} title={term ? `No teams match “${term}”` : 'No teams yet'} description="Create a team for a squad, committee or anyone who works together." />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {teams.map((t) => (
            <Link key={t.id} href={`/admin/teams/${t.id}`} className="card-panel group rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-blue-300">
              <div className="flex items-start gap-3">
                <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ background: t.color }} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold text-slate-900 group-hover:text-blue-700">{t.name}</div>
                  <div className="truncate text-xs text-slate-500">{t.unit?.name ?? 'No owning unit'}</div>
                </div>
                <Badge className={t.kind === 'dynamic' ? 'bg-violet-50 text-violet-700 ring-violet-600/20' : 'bg-slate-100 text-slate-600 ring-slate-500/20'}>
                  {t.kind === 'dynamic' ? 'Rule-based' : 'Static'}
                </Badge>
              </div>
              {t.description && <p className="mt-2 line-clamp-2 text-sm text-slate-600">{t.description}</p>}
              <div className="mt-3 flex items-center justify-between">
                <div className="flex -space-x-1.5">
                  {t.preview.map((p) => (
                    <span key={p.id} className="rounded-full ring-2 ring-white"><Avatar name={p.name} src={p.avatar_url} size="xs" /></span>
                  ))}
                </div>
                <span className="text-xs text-slate-500">{t.member_count} member{t.member_count === 1 ? '' : 's'}</span>
              </div>
              {t.lead && <div className="mt-2 text-xs text-slate-500">Lead: {t.lead.name}</div>}
            </Link>
          ))}
        </div>
      )}
      <TeamForm open={creating} team={null} onClose={() => setCreating(false)} onSaved={(t, rules) => router.push(`/admin/teams/${t.id}${rules ? '?setup=rules' : ''}`)} />
    </div>
  );
}

function TeamForm({ open, team, onClose, onSaved }: { open: boolean; team: Team | null; onClose: () => void; onSaved: (t: Team, wantsRules: boolean) => void }) {
  const qc = useQueryClient();
  const units = useDepartments();
  const [v, setV] = React.useState({ name: '', description: '', kind: 'static', color: TEAM_COLORS[0], lead_user_id: '', unit_id: '', email: '' });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (!open) return;
    setErrors({});
    setV(team
      ? { name: team.name, description: team.description, kind: team.kind, color: team.color, lead_user_id: team.lead_user_id ?? '', unit_id: team.unit_id ?? '', email: team.email }
      : { name: '', description: '', kind: 'static', color: TEAM_COLORS[0], lead_user_id: '', unit_id: '', email: '' });
  }, [open, team]);
  const save = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { ...v };
      if (!team && v.kind === 'dynamic') body.kind = 'static'; // rules are added on the next screen
      return team ? v2.put<Team>(`/teams/${team.id}`, body) : v2.post<Team>('/teams', body);
    },
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      qc.invalidateQueries({ queryKey: ['team', t.id] });
      toast.success(team ? 'Team saved' : 'Team created');
      onSaved(t, !team && v.kind === 'dynamic');
      onClose();
    },
    onError: (e) => setErrors(Object.fromEntries(Object.entries(parseApiError(e).fields).map(([k, x]) => [k, String(x)]))),
  });
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={team ? 'Team settings' : 'New team'}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" loading={save.isPending} disabled={!v.name.trim()} onClick={() => save.mutate()}>{team ? 'Save' : 'Create team'}</Btn>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Name" required error={errors.name}>
          <TextInput autoFocus value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Month-end close" />
        </Field>
        {!team && (
          <div>
            <span className="mb-1 block text-[13px] font-medium text-slate-700">Membership</span>
            <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
              {[
                { value: 'static', title: 'Pick members', text: 'Add and remove people yourself.' },
                { value: 'dynamic', title: 'Rule-based', text: 'Members follow rules such as unit, location or job title.' },
              ].map((o) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={v.kind === o.value}
                  onClick={() => set({ kind: o.value })}
                  className={cn('rounded-lg border p-3 text-left', v.kind === o.value ? 'border-blue-500 ring-2 ring-blue-500/20' : 'border-slate-200 hover:border-slate-300')}
                >
                  <div className="text-sm font-medium text-slate-900">{o.title}</div>
                  <div className="text-xs text-slate-500">{o.text}</div>
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Team lead" error={errors.lead_user_id}>
            <PersonPicker value={v.lead_user_id} onChange={(id) => set({ lead_user_id: id ?? '' })} initialLabel={team?.lead?.name} />
          </Field>
          <Field label="Owning unit" error={errors.unit_id}>
            <SelectBox value={v.unit_id} onChange={(unit_id) => set({ unit_id })} placeholder="None" options={(units.data ?? []).map((u) => ({ value: u.id, label: `${'— '.repeat(u.depth)}${u.name}` }))} />
          </Field>
          <Field label="Team email" error={errors.email}>
            <TextInput type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} placeholder="team@example.com" />
          </Field>
          <div>
            <span className="mb-1 block text-[13px] font-medium text-slate-700">Color</span>
            <div className="flex flex-wrap gap-1.5">
              {TEAM_COLORS.map((c) => (
                <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={v.color === c} onClick={() => set({ color: c })} className={cn('h-7 w-7 rounded-full ring-offset-2', v.color === c && 'ring-2 ring-slate-900')} style={{ background: c }} />
              ))}
            </div>
          </div>
        </div>
        <Field label="Description">
          <TextArea rows={2} value={v.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

export function TeamDetail({ id }: { id: string }) {
  const qc = useQueryClient();
  const router = useRouter();
  const confirm = useConfirm();
  const can = useCan();
  const manage = can('users.manage');
  const { data: team, isLoading, error } = useQuery({ queryKey: ['team', id], queryFn: () => v2.get<Team>(`/teams/${id}`) });
  const [editing, setEditing] = React.useState(false);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['team', id] });
    qc.invalidateQueries({ queryKey: ['team-members', id] });
    qc.invalidateQueries({ queryKey: ['teams'] });
  };
  const del = useMutation({
    mutationFn: () => v2.del(`/teams/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['teams'] });
      toast.success('Team deleted');
      router.push('/admin/teams');
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  if (isLoading) return <LoadingBlock />;
  if (error || !team) return <ErrorBlock message={error ? parseApiError(error).message : 'Team not found'} />;
  return (
    <div className="space-y-5">
      <PageHeader
        title={<span className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: team.color }} />{team.name}</span>}
        subtitle={[team.kind === 'dynamic' ? 'Rule-based team' : 'Static team', team.unit?.name, team.lead ? `Lead: ${team.lead.name}` : null].filter(Boolean).join(' · ')}
        breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Teams', href: '/admin/teams' }, { label: team.name }]}
        actions={
          manage && (
            <>
              <Btn size="sm" onClick={() => setEditing(true)}>Settings</Btn>
              <Btn
                size="sm"
                variant="ghost"
                aria-label="Delete team"
                icon={<Trash2 className="h-4 w-4 text-rose-600" />}
                onClick={async () => {
                  if (await confirm({ title: `Delete ${team.name}?`, message: 'People stay in the organization; only the team is removed.', confirmLabel: 'Delete team', danger: true })) del.mutate();
                }}
              />
            </>
          )
        }
      />
      {team.description && <p className="-mt-2 text-sm text-slate-600">{team.description}</p>}
      {team.kind === 'dynamic' ? (
        <RulesEditor team={team} manage={manage} onSaved={refresh} />
      ) : (
        <StaticMembersHint team={team} manage={manage} onSaved={refresh} />
      )}
      <MembersList team={team} manage={manage && team.kind === 'static'} onChanged={refresh} />
      <TeamForm open={editing} team={team} onClose={() => setEditing(false)} onSaved={refresh} />
    </div>
  );
}

function StaticMembersHint({ team, manage, onSaved }: { team: Team; manage: boolean; onSaved: () => void }) {
  // A team created as rule-based arrives with ?setup=rules to define its rules.
  const params = useSearchParams();
  const [converting, setConverting] = React.useState(params.get('setup') === 'rules');
  if (converting) {
    return <RulesEditor team={{ ...team, kind: 'dynamic', rules: { match: 'all', conditions: [] } }} manage={manage} onSaved={onSaved} converting onCancel={() => setConverting(false)} />;
  }
  if (!manage) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-slate-300 px-4 py-3 text-sm text-slate-600">
      <span>Members are picked by hand. Switch to rules to keep membership in sync with your org structure.</span>
      <Btn size="sm" icon={<Sparkles className="h-4 w-4" />} onClick={() => setConverting(true)}>Use rules instead</Btn>
    </div>
  );
}

function RulesEditor({ team, manage, onSaved, converting, onCancel }: { team: Team; manage: boolean; onSaved: () => void; converting?: boolean; onCancel?: () => void }) {
  const units = useDepartments();
  const locations = useLocations();
  const [rules, setRules] = React.useState<TeamRules>(team.rules.conditions.length ? team.rules : { match: 'all', conditions: [{ field: 'unit', operator: 'within', value: '' }] });
  const [error, setError] = React.useState('');
  const complete = rules.conditions.every((c) => c.value.trim() !== '');
  const debounced = useDebounced(JSON.stringify(rules), 400);
  const preview = useQuery({
    queryKey: ['team-preview', debounced],
    queryFn: () => v2.post<{ total: number; sample: UserBrief[] }>('/teams/preview', JSON.parse(debounced)),
    enabled: complete && rules.conditions.length > 0,
    retry: false,
  });
  const save = useMutation({
    mutationFn: () => v2.put(`/teams/${team.id}`, { kind: 'dynamic', rules }),
    onSuccess: () => {
      toast.success('Rules saved');
      setError('');
      onSaved();
      onCancel?.();
    },
    onError: (e) => setError(parseApiError(e).fields.rules ? String(parseApiError(e).fields.rules) : parseApiError(e).message),
  });
  const update = (i: number, patch: Partial<TeamCondition>) =>
    setRules((r) => ({ ...r, conditions: r.conditions.map((c, j) => (j === i ? { ...c, ...patch } : c)) }));
  const valueControl = (c: TeamCondition, i: number) => {
    switch (c.field) {
      case 'unit':
        return <SelectBox aria-label="Unit" value={c.value} onChange={(value) => update(i, { value })} placeholder="Choose a unit" options={(units.data ?? []).map((u) => ({ value: u.id, label: `${'— '.repeat(u.depth)}${u.name}` }))} />;
      case 'location':
        return <SelectBox aria-label="Location" value={c.value} onChange={(value) => update(i, { value })} placeholder="Choose a location" options={(locations.data ?? []).map((l) => ({ value: l.id, label: l.name }))} />;
      case 'reporting_manager':
        return <PersonPicker value={c.value} onChange={(id) => update(i, { value: id ?? '' })} placeholder="Choose a manager…" />;
      case 'person_type':
        return <SelectBox aria-label="Person type" value={c.value} onChange={(value) => update(i, { value })} placeholder="Choose" options={[{ value: 'agent', label: 'Agent' }, { value: 'requester', label: 'Requester' }]} />;
      case 'vip':
        return <SelectBox aria-label="VIP" value={c.value} onChange={(value) => update(i, { value })} placeholder="Choose" options={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]} />;
      default:
        return <TextInput aria-label="Value" value={c.value} onChange={(e) => update(i, { value: e.target.value })} placeholder={c.field === 'email_domain' ? 'example.com' : 'e.g. engineer'} />;
    }
  };
  return (
    <Card title={converting ? 'Switch to rule-based membership' : 'Membership rules'}>
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-sm text-slate-700">
          Include people who match
          <SelectBox aria-label="Match" value={rules.match} onChange={(m) => setRules((r) => ({ ...r, match: m as 'all' | 'any' }))} options={[{ value: 'all', label: 'all' }, { value: 'any', label: 'any' }]} className="w-24" />
          of these conditions
        </div>
        {rules.conditions.map((c, i) => (
          <div key={i} className="grid items-center gap-2 sm:grid-cols-[170px_160px_minmax(0,1fr)_36px]">
            <SelectBox aria-label="Field" value={c.field} onChange={(field) => update(i, { field, operator: OPERATORS[field][0].value, value: '' })} options={FIELDS} disabled={!manage} />
            <SelectBox aria-label="Operator" value={c.operator} onChange={(operator) => update(i, { operator })} options={OPERATORS[c.field] ?? []} disabled={!manage} />
            {valueControl(c, i)}
            {manage && (
              <button aria-label="Remove condition" onClick={() => setRules((r) => ({ ...r, conditions: r.conditions.filter((_, j) => j !== i) }))} className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        ))}
        {manage && (
          <Btn size="sm" variant="ghost" icon={<Plus className="h-4 w-4" />} onClick={() => setRules((r) => ({ ...r, conditions: [...r.conditions, { field: 'job_title', operator: 'contains', value: '' }] }))}>
            Add condition
          </Btn>
        )}
        <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm">
          {!complete ? (
            <span className="text-slate-500">Fill in every condition to preview the members.</span>
          ) : preview.isFetching ? (
            <span className="text-slate-500">Counting…</span>
          ) : preview.error ? (
            <span className="text-rose-600">{parseApiError(preview.error).fields.rules ? String(parseApiError(preview.error).fields.rules) : parseApiError(preview.error).message}</span>
          ) : preview.data ? (
            <>
              <span className="font-medium text-slate-800">{preview.data.total} {preview.data.total === 1 ? 'person matches' : 'people match'}</span>
              <span className="flex -space-x-1.5">
                {preview.data.sample.map((p) => (
                  <span key={p.id} className="rounded-full ring-2 ring-white" title={p.name}><Avatar name={p.name} src={p.avatar_url} size="xs" /></span>
                ))}
              </span>
            </>
          ) : null}
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        {manage && (
          <div className="flex gap-2">
            <Btn variant="primary" size="sm" loading={save.isPending} disabled={!complete || rules.conditions.length === 0} onClick={() => save.mutate()}>Save rules</Btn>
            {converting && <Btn size="sm" onClick={onCancel}>Keep picking members by hand</Btn>}
          </div>
        )}
      </div>
    </Card>
  );
}

function MembersList({ team, manage, onChanged }: { team: Team; manage: boolean; onChanged: () => void }) {
  const confirm = useConfirm();
  const [q, setQ] = React.useState('');
  const [page, setPage] = React.useState(1);
  const term = useDebounced(q.trim(), 250);
  React.useEffect(() => setPage(1), [term]);
  const { data, isLoading } = useQuery({
    queryKey: ['team-members', team.id, term, page],
    queryFn: () => v2.list<UserBrief>(`/teams/${team.id}/members`, { q: term || undefined, page, per_page: 25 }),
    placeholderData: (p) => p,
  });
  const add = useMutation({
    mutationFn: (userId: string) => v2.post(`/teams/${team.id}/members`, { user_ids: [userId] }),
    onSuccess: () => {
      toast.success('Member added');
      onChanged();
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => v2.del(`/teams/${team.id}/members/${userId}`),
    onSuccess: () => onChanged(),
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const items = (data as ListResponse<UserBrief> | undefined)?.items ?? [];
  return (
    <Card
      title={`Members · ${team.member_count}`}
      actions={manage && <PersonPicker value={null} onChange={(id) => id && add.mutate(id)} placeholder="Add a person…" className="w-64" allowClear={false} />}
      padded={false}
    >
      <div className="border-b border-slate-100 p-3">
        <SearchInput value={q} onChange={setQ} placeholder="Search members…" className="max-w-xs" />
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : items.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-500">{team.kind === 'dynamic' ? 'Nobody matches these rules yet.' : 'No members yet. Add people with the picker above.'}</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-2">
              <Avatar name={p.name} src={p.avatar_url} size="sm" />
              <div className="min-w-0 flex-1">
                <Link href={`/people/${p.id}`} className="text-sm font-medium text-slate-900 hover:text-blue-700">{p.name}</Link>
                <div className="truncate text-xs text-slate-500">{[p.job_title, p.email].filter(Boolean).join(' · ')}</div>
              </div>
              {team.lead_user_id === p.id && <Badge className="bg-blue-50 text-blue-700 ring-blue-600/20">Lead</Badge>}
              {p.is_agent && <Badge className="bg-slate-100 text-slate-600 ring-slate-500/20">Agent</Badge>}
              {manage && (
                <button
                  aria-label={`Remove ${p.name}`}
                  onClick={async () => {
                    if (await confirm({ title: `Remove ${p.name} from ${team.name}?`, confirmLabel: 'Remove' })) remove.mutate(p.id);
                  }}
                  className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                >
                  <UserMinus className="h-4 w-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {data && data.total > 25 && <Pagination page={page} perPage={25} total={data.total} onPage={setPage} />}
    </Card>
  );
}
