'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Boxes, CalendarRange, ListChecks, Pencil, Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { v2, parseApiError } from '@/lib/itsm/api';
import { fmtDay, toDayInput } from '@/lib/itsm/projects';
import type { Project, ProjectModule } from '@/lib/itsm/types';
import { Avatar, Badge, Btn, Card, EmptyState, Field, LoadingBlock, Modal, SelectBox, TextArea, TextInput, useConfirm } from '@/components/desk/kit';
import { cn } from '@/lib/utils';
import { useModules } from './hooks';

const STATUSES: { value: ProjectModule['status']; label: string; tone: string }[] = [
  { value: 'backlog', label: 'Backlog', tone: 'bg-slate-100 text-slate-600 ring-slate-500/20' },
  { value: 'planned', label: 'Planned', tone: 'bg-sky-50 text-sky-700 ring-sky-600/20' },
  { value: 'in_progress', label: 'In progress', tone: 'bg-amber-50 text-amber-700 ring-amber-600/20' },
  { value: 'paused', label: 'Paused', tone: 'bg-violet-50 text-violet-700 ring-violet-600/20' },
  { value: 'completed', label: 'Completed', tone: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20' },
  { value: 'cancelled', label: 'Cancelled', tone: 'bg-rose-50 text-rose-700 ring-rose-600/20' },
];

type Draft = { name: string; description: string; status: string; lead_id: string; start_date: string; target_date: string };

/** Project modules: feature areas or epics that group work items. */
export function ModulesView({ project, onShowItems }: { project: Project; onShowItems: (moduleId: string) => void }) {
  const { data: modules = [], isLoading } = useModules(project.id);
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [editing, setEditing] = React.useState<{ module?: ProjectModule; d: Draft } | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const refresh = () => qc.invalidateQueries({ queryKey: ['modules', project.id] });
  const save = useMutation({
    mutationFn: () => (editing!.module ? v2.put(`/modules/${editing!.module.id}`, editing!.d) : v2.post(`/projects/${project.id}/modules`, editing!.d)),
    onSuccess: () => {
      toast.success(editing!.module ? 'Module saved' : 'Module created');
      setEditing(null);
      setErrors({});
      refresh();
    },
    onError: (e) => {
      const err = parseApiError(e);
      setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, v]) => [k, String(v)])));
      toast.error(err.message);
    },
  });
  const remove = useMutation({
    mutationFn: (m: ProjectModule) => v2.del(`/modules/${m.id}`),
    onSuccess: () => {
      toast.success('Module deleted');
      refresh();
      qc.invalidateQueries({ queryKey: ['work-items', project.id] });
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const blank: Draft = { name: '', description: '', status: 'planned', lead_id: '', start_date: '', target_date: '' };
  const memberOptions = [{ value: '', label: 'No lead' }, ...project.members.map((m) => ({ value: m.id, label: m.name }))];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Group work items into features or epics and track their progress.</p>
        {project.can_edit && <Btn variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing({ d: blank })}>New module</Btn>}
      </div>
      {isLoading ? (
        <LoadingBlock />
      ) : modules.length === 0 ? (
        <EmptyState icon={<Boxes className="h-6 w-6" />} title="No modules yet" description="Create a module, then add work items to it from their Modules property." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {modules.map((m) => {
            const pct = m.total ? Math.round((m.done / m.total) * 100) : 0;
            const st = STATUSES.find((s) => s.value === m.status) ?? STATUSES[0];
            return (
              <Card key={m.id} className="flex flex-col">
                <div className="flex items-start gap-2">
                  <Boxes className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-900">{m.name}</div>
                    {m.description && <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{m.description}</p>}
                  </div>
                  <Badge className={st.tone}>{st.label}</Badge>
                </div>
                <div className="mt-4">
                  <div className="mb-1 flex justify-between text-xs text-slate-500">
                    <span>{m.done} of {m.total} done</span>
                    <span>{pct}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-slate-200">
                    <div className={cn('h-full rounded-full', pct === 100 ? 'bg-emerald-500' : 'bg-blue-500')} style={{ width: `${pct}%` }} />
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                  {m.lead && <span className="flex items-center gap-1.5"><Avatar name={m.lead.name} src={m.lead.avatar_url} size="xs" />{m.lead.name}</span>}
                  {(m.start_date || m.target_date) && (
                    <span className="flex items-center gap-1"><CalendarRange className="h-3.5 w-3.5" />{m.start_date ? fmtDay(m.start_date) : '…'} – {m.target_date ? fmtDay(m.target_date) : '…'}</span>
                  )}
                </div>
                <div className="mt-auto flex items-center gap-1 pt-4">
                  <Btn size="sm" variant="ghost" icon={<ListChecks className="h-4 w-4" />} onClick={() => onShowItems(m.id)}>Show work items</Btn>
                  {project.can_edit && (
                    <>
                      <button type="button" aria-label={`Edit ${m.name}`} onClick={() => setEditing({ module: m, d: { name: m.name, description: m.description, status: m.status, lead_id: m.lead_id ?? '', start_date: toDayInput(m.start_date), target_date: toDayInput(m.target_date) } })} className="ml-auto rounded p-1.5 text-slate-500 hover:bg-slate-100"><Pencil className="h-4 w-4" /></button>
                      <button
                        type="button"
                        aria-label={`Delete ${m.name}`}
                        onClick={async () => {
                          if (await confirm({ title: `Delete ${m.name}?`, message: 'Its work items stay in the project; only the module is removed.', danger: true, confirmLabel: 'Delete' })) remove.mutate(m);
                        }}
                        className="rounded p-1.5 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.module ? `Edit ${editing.module.name}` : 'New module'}
        footer={
          <>
            <Btn onClick={() => setEditing(null)}>Cancel</Btn>
            <Btn variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{editing?.module ? 'Save' : 'Create module'}</Btn>
          </>
        }
      >
        {editing && (
          <div className="space-y-3">
            <Field label="Name" required error={errors.name}>
              <TextInput autoFocus value={editing.d.name} onChange={(e) => setEditing({ ...editing, d: { ...editing.d, name: e.target.value } })} placeholder="e.g. Rider portal home page" />
            </Field>
            <Field label="Description">
              <TextArea rows={3} value={editing.d.description} onChange={(e) => setEditing({ ...editing, d: { ...editing.d, description: e.target.value } })} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Status" error={errors.status}>
                <SelectBox value={editing.d.status} onChange={(status) => setEditing({ ...editing, d: { ...editing.d, status } })} options={STATUSES.map((s) => ({ value: s.value, label: s.label }))} />
              </Field>
              <Field label="Lead" error={errors.lead_id}>
                <SelectBox value={editing.d.lead_id} onChange={(lead_id) => setEditing({ ...editing, d: { ...editing.d, lead_id } })} options={memberOptions} />
              </Field>
              <Field label="Start date" error={errors.start_date}>
                <TextInput type="date" value={editing.d.start_date} onChange={(e) => setEditing({ ...editing, d: { ...editing.d, start_date: e.target.value } })} />
              </Field>
              <Field label="Target date" error={errors.target_date}>
                <TextInput type="date" value={editing.d.target_date} onChange={(e) => setEditing({ ...editing, d: { ...editing.d, target_date: e.target.value } })} />
              </Field>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
