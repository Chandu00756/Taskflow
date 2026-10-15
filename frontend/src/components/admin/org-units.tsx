'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Box, Briefcase, Building2, ChevronDown, ChevronRight, GitBranch, ListTree, Network, Pencil, Plus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useCan, useDepartments, useLocations } from '@/lib/itsm/hooks';
import type { Department, ListResponse, Person, UnitKind } from '@/lib/itsm/types';
import { Avatar, Badge, Btn, Card, EmptyState, Field, LoadingBlock, Modal, PageHeader, SearchInput, SelectBox, TagInput, TextArea, TextInput, Toggle, useConfirm } from '@/components/desk/kit';
import { PersonPicker } from '@/components/desk/pickers';

export const UNIT_KINDS: { value: UnitKind; label: string; icon: React.ElementType; tone: string }[] = [
  { value: 'company', label: 'Company', icon: Building2, tone: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20' },
  { value: 'division', label: 'Division', icon: Network, tone: 'bg-violet-50 text-violet-700 ring-violet-600/20' },
  { value: 'business_unit', label: 'Business unit', icon: Briefcase, tone: 'bg-sky-50 text-sky-700 ring-sky-600/20' },
  { value: 'department', label: 'Department', icon: Users, tone: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
  { value: 'unit', label: 'Unit', icon: Box, tone: 'bg-amber-50 text-amber-800 ring-amber-600/20' },
];

export function unitKind(kind: string) {
  return UNIT_KINDS.find((k) => k.value === kind) ?? UNIT_KINDS[3];
}

function descendantsOf(units: Department[], id: string): Set<string> {
  const out = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const u of units) {
      if (u.parent_id && out.has(u.parent_id) && !out.has(u.id)) {
        out.add(u.id);
        grew = true;
      }
    }
  }
  return out;
}

export function OrgUnitsAdmin() {
  const can = useCan();
  const manage = can('users.manage');
  const { data: units = [], isLoading } = useDepartments();
  const [selected, setSelected] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState<Set<string>>(new Set());
  const [view, setView] = React.useState<'tree' | 'chart'>('tree');
  const [q, setQ] = React.useState('');
  const [editing, setEditing] = React.useState<{ unit: Department | null; parentId?: string } | null>(null);
  React.useEffect(() => {
    if (!selected && units.length) setSelected(units[0].id);
  }, [units, selected]);

  const visible = React.useMemo(() => {
    if (q) {
      const term = q.toLowerCase();
      return units.filter((u) => `${u.name} ${u.code}`.toLowerCase().includes(term));
    }
    const hidden = new Set<string>();
    units.forEach((u) => {
      if (u.parent_id && (collapsed.has(u.parent_id) || hidden.has(u.parent_id))) hidden.add(u.id);
    });
    return units.filter((u) => !hidden.has(u.id));
  }, [units, collapsed, q]);
  const current = units.find((u) => u.id === selected) ?? null;
  const totalPeople = units.filter((u) => !u.parent_id).reduce((n, u) => n + u.total_members, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Organization units"
        subtitle="Model your company as a tree of divisions, business units and departments. People belong to one unit; unit heads see their unit's tickets and approve requests."
        breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Org units' }]}
        icon={<Network className="h-5 w-5" />}
        actions={
          <>
            <div className="flex rounded-md border border-slate-200 bg-white p-0.5" role="radiogroup" aria-label="View">
              {([['tree', 'Tree', ListTree], ['chart', 'Org chart', GitBranch]] as const).map(([v, label, Icon]) => (
                <button key={v} role="radio" aria-checked={view === v} onClick={() => setView(v)} className={cn('flex items-center gap-1.5 whitespace-nowrap rounded px-2.5 py-1 text-xs font-medium text-slate-600', view === v && 'bg-slate-100 text-slate-900')}>
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>
            {manage && <Btn variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ unit: null })}>Add unit</Btn>}
          </>
        }
      />
      {isLoading ? (
        <LoadingBlock />
      ) : units.length === 0 ? (
        <EmptyState
          icon={<Network className="h-6 w-6" />}
          title="No units yet"
          description="Start with your company, then add divisions and departments beneath it."
          action={manage ? <Btn variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ unit: null })}>Add your company</Btn> : undefined}
        />
      ) : view === 'chart' ? (
        <OrgChart units={units} onSelect={(id) => { setSelected(id); setView('tree'); }} />
      ) : (
        <div className="grid gap-5 xl:grid-cols-[340px_minmax(0,1fr)]">
          <Card padded={false} className="self-start">
            <div className="border-b border-slate-100 p-3">
              <SearchInput value={q} onChange={setQ} placeholder="Find a unit…" />
              <div className="mt-2 flex justify-between text-xs text-slate-500">
                <span>{units.length} units · {totalPeople} people</span>
                {!q && (
                  <button className="hover:text-slate-800" onClick={() => setCollapsed(collapsed.size ? new Set() : new Set(units.filter((u) => u.child_count > 0).map((u) => u.id)))}>
                    {collapsed.size ? 'Expand all' : 'Collapse all'}
                  </button>
                )}
              </div>
            </div>
            <ul role="tree" aria-label="Organization units" className="max-h-[65vh] overflow-y-auto py-1">
              {visible.map((u) => {
                const kind = unitKind(u.kind);
                const open = !collapsed.has(u.id);
                return (
                  <li key={u.id} role="treeitem" aria-selected={selected === u.id} aria-expanded={u.child_count ? open : undefined}>
                    <div
                      className={cn('flex cursor-pointer items-center gap-1.5 py-1.5 pr-3 text-sm', selected === u.id ? 'bg-blue-50 text-blue-900' : 'text-slate-700 hover:bg-slate-50')}
                      style={{ paddingLeft: q ? 12 : 8 + u.depth * 18 }}
                      onClick={() => setSelected(u.id)}
                    >
                      {!q && u.child_count > 0 ? (
                        <button
                          aria-label={open ? `Collapse ${u.name}` : `Expand ${u.name}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setCollapsed((s) => {
                              const n = new Set(s);
                              if (n.has(u.id)) n.delete(u.id);
                              else n.add(u.id);
                              return n;
                            });
                          }}
                          className="rounded p-0.5 text-slate-400 hover:bg-slate-200"
                        >
                          {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                        </button>
                      ) : (
                        <span className="w-[18px]" />
                      )}
                      <kind.icon className="h-4 w-4 shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1 truncate">{u.name}</span>
                      {u.code && <span className="rounded bg-slate-100 px-1 font-mono text-[10px] text-slate-500">{u.code}</span>}
                      <span className="w-8 text-right text-xs text-slate-400" title={`${u.total_members} people including sub-units`}>{u.total_members}</span>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
          {current ? (
            <UnitDetail unit={current} units={units} manage={manage} onSelect={setSelected} onEdit={(u) => setEditing({ unit: u })} onAddChild={(id) => setEditing({ unit: null, parentId: id })} />
          ) : (
            <EmptyState title="Select a unit" />
          )}
        </div>
      )}
      <UnitForm open={!!editing} unit={editing?.unit ?? null} parentId={editing?.parentId} units={units} onClose={() => setEditing(null)} onSaved={(id) => setSelected(id)} />
    </div>
  );
}

function UnitDetail({ unit, units, manage, onSelect, onEdit, onAddChild }: {
  unit: Department;
  units: Department[];
  manage: boolean;
  onSelect: (id: string) => void;
  onEdit: (u: Department) => void;
  onAddChild: (id: string) => void;
}) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [kind, setKind] = React.useState<'requesters' | 'agents'>('requesters');
  const [deep, setDeep] = React.useState(true);
  const k = unitKind(unit.kind);
  const children = units.filter((u) => u.parent_id === unit.id);
  const people = useQuery({
    queryKey: ['unit-people', unit.id, kind, deep],
    queryFn: () => v2.list<Person>(`/${kind}`, { department_id: unit.id, include_children: deep ? 'true' : undefined, per_page: 50 }),
  });
  const del = useMutation({
    mutationFn: () => v2.del<{ members_moved: number }>(`/departments/${unit.id}`),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['lookup', 'departments'] });
      toast.success(`${unit.name} deleted${r.members_moved ? `; ${r.members_moved} people moved up` : ''}`);
      onSelect(unit.parent_id ?? '');
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  return (
    <div className="space-y-5">
      <Card>
        <nav aria-label="Unit path" className="mb-2 flex flex-wrap items-center gap-1 text-xs text-slate-500">
          {unit.path.map((p) => (
            <React.Fragment key={p.id}>
              <button className="hover:text-blue-700" onClick={() => onSelect(p.id)}>{p.name}</button>
              <ChevronRight className="h-3 w-3" />
            </React.Fragment>
          ))}
          <span className="text-slate-700">{unit.name}</span>
        </nav>
        <div className="flex flex-wrap items-start gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><k.icon className="h-5 w-5" /></span>
          {/* The minimum width makes the action buttons wrap below the name instead of covering it. */}
          <div className="min-w-[12rem] flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="break-words text-lg font-semibold text-slate-900">{unit.name}</h2>
              <Badge className={k.tone}>{k.label}</Badge>
              {unit.code && <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs text-slate-600">{unit.code}</span>}
            </div>
            {unit.description && <p className="mt-1 text-sm text-slate-600">{unit.description}</p>}
          </div>
          {manage && (
            <div className="flex flex-wrap gap-2">
              <Btn size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => onAddChild(unit.id)}>Sub-unit</Btn>
              <Btn size="sm" icon={<Pencil className="h-4 w-4" />} onClick={() => onEdit(unit)}>Edit</Btn>
              <Btn
                size="sm"
                variant="ghost"
                aria-label={`Delete ${unit.name}`}
                icon={<Trash2 className="h-4 w-4 text-rose-600" />}
                onClick={async () => {
                  const target = unit.path.length ? unit.path[unit.path.length - 1].name : 'no unit';
                  if (await confirm({ title: `Delete ${unit.name}?`, message: `Its ${unit.member_count} people and ${unit.child_count} sub-units move to ${target}. Tickets and assets keep working.`, confirmLabel: 'Delete unit', danger: true })) del.mutate();
                }}
              />
            </div>
          )}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3 text-center">
          {[
            ['People here', unit.member_count],
            ['Including sub-units', unit.total_members],
            ['Sub-units', unit.child_count],
          ].map(([label, n]) => (
            <div key={label as string} className="rounded-lg bg-slate-50 px-3 py-2">
              <div className="text-lg font-semibold text-slate-900">{n}</div>
              <div className="text-xs text-slate-500">{label}</div>
            </div>
          ))}
        </div>
        <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Info label="Head">{unit.head ? <PersonLink id={unit.head.id} name={unit.head.name} src={unit.head.avatar_url} /> : '—'}</Info>
          <Info label="Prime contact">{unit.prime_user ? <PersonLink id={unit.prime_user.id} name={unit.prime_user.name} src={unit.prime_user.avatar_url} /> : '—'}</Info>
          <Info label="Default location">{unit.location?.name ?? '—'}</Info>
          <Info label="Cost center">{unit.cost_center || '—'}</Info>
          <Info label="Email">{unit.email || '—'}</Info>
          <Info label="Email domains">{unit.domains.length ? unit.domains.join(', ') : '—'}</Info>
        </dl>
      </Card>

      {children.length > 0 && (
        <Card title="Sub-units">
          <ul className="grid gap-2 sm:grid-cols-2">
            {children.map((c) => {
              const ck = unitKind(c.kind);
              return (
                <li key={c.id}>
                  <button onClick={() => onSelect(c.id)} className="flex w-full items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-blue-300">
                    <ck.icon className="h-4 w-4 text-slate-400" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{c.name}</span>
                    <span className="text-xs text-slate-500">{c.total_members} people</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card
        title={`People${people.data ? ` · ${people.data.total}` : ''}`}
        actions={
          <div className="flex items-center gap-3">
            <Toggle checked={deep} onChange={setDeep} label="Include sub-units" />
            <SelectBox aria-label="Person type" value={kind} onChange={(v) => setKind(v as 'requesters' | 'agents')} options={[{ value: 'requesters', label: 'Requesters' }, { value: 'agents', label: 'Agents' }]} className="w-36" />
          </div>
        }
      >
        {people.isLoading ? (
          <LoadingBlock />
        ) : (people.data?.items ?? []).length === 0 ? (
          <p className="py-4 text-center text-sm text-slate-500">No {kind} in this unit{deep ? ' or its sub-units' : ''}.</p>
        ) : (
          <>
            <ul className="divide-y divide-slate-100">
              {(people.data as ListResponse<Person>).items.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2">
                  <Avatar name={p.name} src={p.avatar_url} size="sm" />
                  <div className="min-w-0 flex-1">
                    <Link href={`/people/${p.id}`} className="text-sm font-medium text-slate-900 hover:text-blue-700">{p.name}</Link>
                    <div className="truncate text-xs text-slate-500">{[p.job_title, p.email].filter(Boolean).join(' · ')}</div>
                  </div>
                  {p.department && p.department.id !== unit.id && <span className="text-xs text-slate-500">{p.department.name}</span>}
                </li>
              ))}
            </ul>
            {(people.data?.total ?? 0) > 50 && (
              <Link href={`/admin/${kind}?department_id=${unit.id}${deep ? '&include_children=true' : ''}`} className="mt-3 block text-sm text-blue-700 hover:underline">
                View all {people.data?.total} {kind}
              </Link>
            )}
          </>
        )}
      </Card>
    </div>
  );
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-900">{children}</dd>
    </div>
  );
}

function PersonLink({ id, name, src }: { id: string; name: string; src?: string }) {
  return (
    <Link href={`/people/${id}`} className="inline-flex items-center gap-1.5 hover:text-blue-700">
      <Avatar name={name} src={src} size="xs" /> {name}
    </Link>
  );
}

function UnitForm({ open, unit, parentId, units, onClose, onSaved }: {
  open: boolean;
  unit: Department | null;
  parentId?: string;
  units: Department[];
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const qc = useQueryClient();
  const locations = useLocations();
  const blank = { name: '', kind: 'department', parent_id: '', code: '', cost_center: '', email: '', head_user_id: '', prime_user_id: '', location_id: '', domains: [] as string[], description: '' };
  const [v, setV] = React.useState(blank);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (!open) return;
    setErrors({});
    if (unit) {
      setV({ name: unit.name, kind: unit.kind, parent_id: unit.parent_id ?? '', code: unit.code, cost_center: unit.cost_center, email: unit.email,
        head_user_id: unit.head_user_id ?? '', prime_user_id: unit.prime_user_id ?? '', location_id: unit.location_id ?? '', domains: unit.domains, description: unit.description });
    } else {
      const parent = units.find((u) => u.id === parentId);
      const next = parent ? UNIT_KINDS[Math.min(UNIT_KINDS.findIndex((k) => k.value === parent.kind) + 1, UNIT_KINDS.length - 1)].value : units.length ? 'department' : 'company';
      setV({ ...blank, parent_id: parentId ?? '', kind: next, location_id: parent?.location_id ?? '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, unit, parentId]);
  const blocked = unit ? descendantsOf(units, unit.id) : new Set<string>();
  const save = useMutation({
    mutationFn: () => (unit ? v2.put<Department>(`/departments/${unit.id}`, v) : v2.post<Department>('/departments', v)),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['lookup', 'departments'] });
      toast.success(unit ? 'Unit saved' : 'Unit created');
      onSaved(d.id);
      onClose();
    },
    onError: (e) => {
      const err = parseApiError(e);
      setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, x]) => [k, String(x)])));
      if (!Object.keys(err.fields).length) toast.error(err.message);
    },
  });
  const set = (p: Partial<typeof v>) => setV((x) => ({ ...x, ...p }));
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={unit ? `Edit ${unit.name}` : 'New unit'}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" loading={save.isPending} disabled={!v.name.trim()} onClick={() => save.mutate()}>{unit ? 'Save' : 'Create unit'}</Btn>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required error={errors.name} className="sm:col-span-2">
          <TextInput autoFocus value={v.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. Finance" />
        </Field>
        <Field label="Type" error={errors.kind}>
          <SelectBox value={v.kind} onChange={(kind) => set({ kind })} options={UNIT_KINDS.map((k) => ({ value: k.value, label: k.label }))} />
        </Field>
        <Field label="Parent unit" error={errors.parent_id}>
          <SelectBox
            value={v.parent_id}
            onChange={(parent_id) => set({ parent_id })}
            placeholder="None (top level)"
            options={units.filter((u) => !blocked.has(u.id)).map((u) => ({ value: u.id, label: `${'— '.repeat(u.depth)}${u.name}` }))}
          />
        </Field>
        <Field label="Code" hint="Short identifier, used in imports" error={errors.code}>
          <TextInput value={v.code} onChange={(e) => set({ code: e.target.value.toUpperCase() })} placeholder="FIN" className="font-mono uppercase" />
        </Field>
        <Field label="Cost center" error={errors.cost_center}>
          <TextInput value={v.cost_center} onChange={(e) => set({ cost_center: e.target.value })} placeholder="CC-4100" />
        </Field>
        <Field label="Unit head" hint="Sees the unit's tickets and approves requests" error={errors.head_user_id}>
          <PersonPicker value={v.head_user_id} onChange={(id) => set({ head_user_id: id ?? '' })} initialLabel={unit?.head?.name} />
        </Field>
        <Field label="Prime contact" error={errors.prime_user_id}>
          <PersonPicker value={v.prime_user_id} onChange={(id) => set({ prime_user_id: id ?? '' })} initialLabel={unit?.prime_user?.name} />
        </Field>
        <Field label="Default location" error={errors.location_id}>
          <SelectBox value={v.location_id} onChange={(location_id) => set({ location_id })} placeholder="None" options={(locations.data ?? []).map((l) => ({ value: l.id, label: l.name }))} />
        </Field>
        <Field label="Unit email" error={errors.email}>
          <TextInput type="email" value={v.email} onChange={(e) => set({ email: e.target.value })} placeholder="finance@example.com" />
        </Field>
        <div className="sm:col-span-2">
          <span className="mb-1 block text-[13px] font-medium text-slate-700">Email domains</span>
          <TagInput value={v.domains} onChange={(domains) => set({ domains })} placeholder="finance.example.com" />
          <span className={cn('mt-1 block text-xs', errors.domains ? 'text-rose-600' : 'text-slate-500')}>
            {errors.domains ?? 'New requesters with these email domains are placed in this unit automatically.'}
          </span>
        </div>
        <Field label="Description" className="sm:col-span-2">
          <TextArea rows={2} value={v.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
      </div>
    </Modal>
  );
}

/** Top-down org chart; wide trees scroll horizontally. */
function OrgChart({ units, onSelect }: { units: Department[]; onSelect: (id: string) => void }) {
  const roots = units.filter((u) => !u.parent_id);
  return (
    <Card padded={false}>
      <div className="overflow-x-auto p-6">
        <div className="flex min-w-max justify-center gap-10">
          {roots.map((r) => (
            <ChartNode key={r.id} unit={r} units={units} onSelect={onSelect} />
          ))}
        </div>
      </div>
    </Card>
  );
}

function ChartNode({ unit, units, onSelect }: { unit: Department; units: Department[]; onSelect: (id: string) => void }) {
  const children = units.filter((u) => u.parent_id === unit.id);
  const k = unitKind(unit.kind);
  return (
    <div className="flex flex-col items-center">
      <button onClick={() => onSelect(unit.id)} className="card-panel w-52 rounded-xl border border-slate-200 bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow">
        <div className="flex items-center gap-2">
          <k.icon className="h-4 w-4 text-slate-400" />
          <span className="truncate text-sm font-semibold text-slate-900">{unit.name}</span>
        </div>
        <div className="mt-1.5 flex items-center gap-2 text-xs text-slate-500">
          {unit.head ? <><Avatar name={unit.head.name} src={unit.head.avatar_url} size="xs" /><span className="truncate">{unit.head.name}</span></> : <span>No head</span>}
          <span className="ml-auto whitespace-nowrap">{unit.total_members} people</span>
        </div>
      </button>
      {children.length > 0 && (
        <>
          <div className="h-5 w-px bg-slate-300" />
          <div className="flex">
            {children.map((c, i) => (
              // Each child draws its half of the connector so widths can differ.
              <div key={c.id} className="relative flex flex-col items-center px-3">
                {i > 0 && <div className="absolute left-0 right-1/2 top-0 h-px bg-slate-300" />}
                {i < children.length - 1 && <div className="absolute left-1/2 right-0 top-0 h-px bg-slate-300" />}
                <div className="h-5 w-px bg-slate-300" />
                <ChartNode unit={c} units={units} onSelect={onSelect} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
