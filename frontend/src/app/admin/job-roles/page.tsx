'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { GitBranch, ListOrdered, Network, Pencil, Plus, Trash2, UsersRound } from 'lucide-react';
import { toast } from 'sonner';
import { SchemaForm, type FieldSpec } from '@/components/desk/crud';
import { Badge, Btn, Card, EmptyState, LinkBtn, LoadingBlock, Modal, PageHeader, useConfirm } from '@/components/desk/kit';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useCan, useInvalidateLookups, useJobRoles } from '@/lib/itsm/hooks';
import type { JobRole } from '@/lib/itsm/types';
import { cn } from '@/lib/utils';

function LevelBadge({ level }: { level: number }) {
  const tone = level <= 2 ? 'bg-violet-50 text-violet-700 ring-violet-600/20' : level <= 6 ? 'bg-blue-50 text-blue-700 ring-blue-600/20' : level <= 9 ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' : 'bg-slate-100 text-slate-600 ring-slate-500/20';
  return <Badge className={cn('tabular-nums', tone)}>L{level}</Badge>;
}

function descendants(roles: JobRole[], id: string): Set<string> {
  const out = new Set<string>();
  const walk = (pid: string) => roles.filter((r) => r.parent_id === pid).forEach((r) => { if (!out.has(r.id)) { out.add(r.id); walk(r.id); } });
  walk(id);
  return out;
}

type Editing = { role?: JobRole; values: Record<string, unknown> };

export default function JobRolesPage() {
  const can = useCan();
  const manage = can('users.manage');
  const confirm = useConfirm();
  const invalidate = useInvalidateLookups();
  const q = useJobRoles();
  const roles = React.useMemo(() => q.data ?? [], [q.data]);
  const [view, setView] = React.useState<'tree' | 'ladder'>('tree');
  const [editing, setEditing] = React.useState<Editing | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () => {
      const v = { ...editing!.values, level: Number(editing!.values.level) || undefined, parent_id: editing!.values.parent_id || '' };
      return editing!.role ? v2.put(`/job-roles/${editing!.role.id}`, v) : v2.post('/job-roles', v);
    },
    onSuccess: () => {
      toast.success(editing!.role ? 'Job role saved' : 'Job role added');
      setEditing(null);
      setErrors({});
      invalidate();
    },
    onError: (e) => {
      const err = parseApiError(e);
      setErrors(err.fields);
      toast.error(err.message);
    },
  });
  const remove = useMutation({
    mutationFn: (r: JobRole) => v2.del(`/job-roles/${r.id}`),
    onSuccess: () => {
      toast.success('Job role deleted');
      invalidate();
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });

  const openNew = (parent?: JobRole) =>
    setEditing({ values: { name: '', description: '', parent_id: parent?.id ?? '', level: parent ? parent.level + 1 : roles.length ? Math.max(...roles.map((r) => r.level)) + 1 : 1 } });
  const openEdit = (r: JobRole) => setEditing({ role: r, values: { name: r.name, description: r.description, parent_id: r.parent_id ?? '', level: r.level } });
  const askDelete = async (r: JobRole) => {
    const parent = roles.find((x) => x.id === r.parent_id);
    const below = roles.filter((x) => x.parent_id === r.id).length;
    const parts = [
      r.people_count ? `${r.people_count} ${r.people_count === 1 ? 'person loses' : 'people lose'} this job role (their job title stays).` : '',
      below ? `${below} role${below === 1 ? '' : 's'} reporting to it will report to ${parent?.name ?? 'nobody'} instead.` : '',
    ].filter(Boolean);
    if (await confirm({ title: `Delete ${r.name}?`, message: parts.join(' ') || 'Nobody has this job role.', danger: true, confirmLabel: 'Delete' })) remove.mutate(r);
  };

  const excluded = editing?.role ? new Set([editing.role.id, ...Array.from(descendants(roles, editing.role.id))]) : new Set<string>();
  const fields: FieldSpec[] = [
    { name: 'name', label: 'Name', required: true, placeholder: 'e.g. Senior Vice President' },
    { name: 'parent_id', label: 'Reports to', type: 'select', span: 1, options: roles.filter((r) => !excluded.has(r.id)).map((r) => ({ value: r.id, label: `L${r.level} · ${r.name}` })), hint: 'Leave empty for a top-level role' },
    { name: 'level', label: 'Level', type: 'number', span: 1, required: true, hint: '1 is the most senior; must be below the role it reports to' },
    { name: 'description', label: 'Description', type: 'textarea', rows: 2 },
  ];

  const row = (r: JobRole, depth: number) => (
    <div className="group flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-slate-50" style={{ paddingLeft: depth * 24 + 8 }}>
      <LevelBadge level={r.level} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-slate-900">{r.name}</div>
        {r.description && <div className="truncate text-xs text-slate-500">{r.description}</div>}
      </div>
      <span className="flex items-center gap-1 text-xs text-slate-500" title="Active people with this job role">
        <UsersRound className="h-3.5 w-3.5" />
        {r.people_count}
      </span>
      {manage && (
        <span className="flex items-center opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
          <button type="button" title="Add a role that reports to this one" aria-label={`Add a role below ${r.name}`} onClick={() => openNew(r)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-blue-600"><Plus className="h-4 w-4" /></button>
          <button type="button" title="Edit" aria-label={`Edit ${r.name}`} onClick={() => openEdit(r)} className="rounded p-1.5 text-slate-500 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button>
          <button type="button" title="Delete" aria-label={`Delete ${r.name}`} onClick={() => askDelete(r)} className="rounded p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
        </span>
      )}
    </div>
  );

  const tree = (parentId: string | null, depth: number): React.ReactNode =>
    roles
      .filter((r) => (r.parent_id ?? null) === parentId || (parentId === null && r.parent_id && !roles.some((x) => x.id === r.parent_id)))
      .map((r) => (
        <div key={r.id} className={cn(depth > 0 && 'border-l border-slate-200')} style={depth > 0 ? { marginLeft: 18 } : undefined}>
          {row(r, 0)}
          {tree(r.id, depth + 1)}
        </div>
      ));

  const levels = Array.from(new Set(roles.map((r) => r.level))).sort((a, b) => a - b);

  return (
    <>
      <PageHeader
        title="Job roles & hierarchy"
        subtitle="Designations from the top of the company down. People get a job role and a reporting manager, which build the people org chart."
        icon={<Network className="h-5 w-5" />}
        breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Job roles' }]}
        actions={
          <>
            <LinkBtn href="/people/org-chart" icon={<GitBranch className="h-4 w-4" />}>People org chart</LinkBtn>
            {manage && <Btn variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => openNew()}>Add job role</Btn>}
          </>
        }
      />
      <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
        {([['tree', 'Hierarchy', GitBranch], ['ladder', 'By level', ListOrdered]] as const).map(([v, label, Icon]) => (
          <button key={v} type="button" onClick={() => setView(v)} className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm', view === v ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50')}>
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>
      {q.isLoading ? (
        <LoadingBlock />
      ) : roles.length === 0 ? (
        <EmptyState title="No job roles yet" description="Add your first designation, such as Chief Executive Officer." />
      ) : view === 'tree' ? (
        <Card>{tree(null, 0)}</Card>
      ) : (
        <div className="space-y-4">
          {levels.map((l) => (
            <Card key={l} title={<span className="flex items-center gap-2"><LevelBadge level={l} /> Level {l}</span>}>
              {roles.filter((r) => r.level === l).map((r) => (
                <div key={r.id}>{row(r, 0)}</div>
              ))}
            </Card>
          ))}
        </div>
      )}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.role ? `Edit ${editing.role.name}` : 'Add job role'}
        footer={
          <>
            <Btn onClick={() => setEditing(null)}>Cancel</Btn>
            <Btn variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Btn>
          </>
        }
      >
        {editing && (
          <SchemaForm
            fields={fields}
            values={editing.values}
            onChange={(v) => {
              // Picking who a role reports to suggests the next level down.
              if (v.parent_id !== editing.values.parent_id && !editing.role) {
                const p = roles.find((r) => r.id === v.parent_id);
                if (p) v = { ...v, level: p.level + 1 };
              }
              setEditing({ ...editing, values: v });
            }}
            errors={errors}
          />
        )}
      </Modal>
    </>
  );
}
