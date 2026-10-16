'use client';

import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { CircleDot, ImagePlus, Loader2, Paperclip, Pencil, Plus, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { v2, parseApiError, uploadAttachment } from '@/lib/itsm/api';
import { fmtBytes } from '@/lib/itsm/format';
import { useAgents, useMe } from '@/lib/itsm/hooks';
import type { Cycle, Project, UserBrief, WorkItem, WorkItemPriority, WorkItemState } from '@/lib/itsm/types';
import { PROJECT_COLORS, PROJECT_STATUSES, fmtDay, toDayInput } from '@/lib/itsm/projects';
import { Badge, Btn, Card, EmptyState, Field, LoadingBlock, Modal, MultiSelect, SelectBox, TextArea, TextInput, Toggle, useConfirm } from '@/components/desk/kit';
import { AssigneeSelect, CycleSelect, DateSelect, LabelsSelect, PrioritySelect, StateSelect } from './properties';
import { useCreateWorkItem, useCycles, useModules, useWorkItems } from './hooks';
import { celebrate } from '@/lib/theme';

// ---------------------------------------------------------------------------
// New work item
// ---------------------------------------------------------------------------

interface Draft {
  title: string;
  description: string;
  state: WorkItemState;
  priority: WorkItemPriority;
  assignee: UserBrief | null;
  start_date: string | null;
  due_date: string | null;
  cycle: { id: string; name: string } | null;
  labels: string[];
  module_ids: string[];
  parent_id: string;
  estimate: string;
}

type PendingFile = { id: string; name: string; size: number; preview?: string };

/** Uploads files right away so they can be attached when the item is created. */
function usePendingFiles() {
  const [files, setFiles] = React.useState<PendingFile[]>([]);
  const [busy, setBusy] = React.useState(0);
  const add = async (list: FileList | File[] | null) => {
    const arr = Array.from(list ?? []);
    if (!arr.length) return;
    setBusy((b) => b + arr.length);
    for (const f of arr) {
      try {
        if (f.size > 15 * 1024 * 1024) throw new Error('larger than 15 MB');
        const res = await uploadAttachment(f);
        const preview = f.type.startsWith('image/') ? URL.createObjectURL(f) : undefined;
        setFiles((x) => [...x, { id: res.id, name: res.name || f.name || 'pasted-image.png', size: res.size, preview }]);
      } catch (e) {
        toast.error(`${f.name || 'File'}: ${e instanceof Error && !('response' in e) ? e.message : parseApiError(e).message}`);
      } finally {
        setBusy((b) => b - 1);
      }
    }
  };
  return { files, setFiles, add, busy: busy > 0 };
}

export function CreateWorkItemModal({ open, onClose, project, cycles, labels, defaults, onCreated }: {
  open: boolean;
  onClose: () => void;
  project: Project;
  cycles: Cycle[];
  labels: string[];
  defaults?: Partial<Draft>;
  onCreated?: (item: WorkItem) => void;
}) {
  const blank = React.useCallback(
    (): Draft => ({ title: '', description: '', state: 'todo', priority: 'none', assignee: null, start_date: null, due_date: null, cycle: null, labels: [], module_ids: [], parent_id: '', estimate: '', ...defaults }),
    [defaults]
  );
  const [d, setD] = React.useState<Draft>(blank);
  const [more, setMore] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const create = useCreateWorkItem(project.id);
  const modules = useModules(open ? project.id : '');
  const parents = useWorkItems(open ? project.id : '', {});
  const pending = usePendingFiles();
  const fileRef = React.useRef<HTMLInputElement>(null);
  const { setFiles } = pending;
  React.useEffect(() => {
    if (open) {
      setD(blank());
      setErrors({});
      setFiles([]);
    }
  }, [open, blank, setFiles]);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const submit = () => {
    if (!d.title.trim()) {
      setErrors({ title: 'is required' });
      return;
    }
    create.mutate(
      {
        title: d.title.trim(),
        description: d.description,
        state: d.state,
        priority: d.priority,
        assignee_id: d.assignee?.id ?? '',
        start_date: d.start_date ?? '',
        due_date: d.due_date ?? '',
        cycle_id: d.cycle?.id ?? '',
        labels: d.labels,
        module_ids: d.module_ids,
        parent_id: d.parent_id,
        ...(d.estimate.trim() ? { estimate: Number(d.estimate) } : {}),
        attachment_ids: pending.files.map((f) => f.id),
      },
      {
        onSuccess: (item) => {
          toast.success(`${item.display_id} created`);
          onCreated?.(item);
          if (more) {
            setD({ ...blank(), state: d.state, cycle: d.cycle, assignee: d.assignee, module_ids: d.module_ids });
            setErrors({});
            pending.setFiles([]);
          } else onClose();
        },
        onError: (e) => setErrors(Object.fromEntries(Object.entries(parseApiError(e).fields).map(([k, v]) => [k, String(v)]))),
      }
    );
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={
        <span className="flex items-center gap-2">
          <span className="rounded px-1.5 py-0.5 text-xs font-semibold text-white" style={{ background: project.color }}>{project.key}</span>
          New work item
        </span>
      }
      footer={
        <div className="flex w-full items-center justify-between">
          <Toggle checked={more} onChange={setMore} label="Create more" />
          <div className="flex gap-2">
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn variant="primary" loading={create.isPending} onClick={submit}>Create work item</Btn>
          </div>
        </div>
      }
    >
      <div className="space-y-3">
        <Field label="Title" required error={errors.title}>
          <TextInput
            autoFocus
            value={d.title}
            invalid={!!errors.title}
            onChange={(e) => set({ title: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && submit()}
            placeholder="What needs to be done?"
          />
        </Field>
        <Field label="Description" hint="Markdown is supported. Paste a screenshot to attach it.">
          <TextArea
            rows={5}
            value={d.description}
            onChange={(e) => set({ description: e.target.value })}
            onPaste={(e) => {
              const imgs = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith('image/'));
              if (imgs.length) {
                e.preventDefault();
                pending.add(imgs);
              }
            }}
            placeholder="Add details, acceptance criteria or links"
          />
        </Field>
        <div className="flex flex-wrap gap-1.5" aria-label="Properties">
          <StateSelect value={d.state} onChange={(state) => set({ state })} />
          <PrioritySelect value={d.priority} onChange={(priority) => set({ priority })} />
          <AssigneeSelect value={d.assignee} members={project.members} onChange={(id) => set({ assignee: project.members.find((m) => m.id === id) ?? null })} />
          <DateSelect label="Start date" value={d.start_date} onChange={(v) => set({ start_date: v || null })} />
          <DateSelect label="Due date" value={d.due_date} onChange={(v) => set({ due_date: v || null })} />
          {cycles.length > 0 && <CycleSelect value={d.cycle} cycles={cycles} onChange={(id) => set({ cycle: cycles.find((c) => c.id === id) ?? null })} />}
          <LabelsSelect value={d.labels} suggestions={labels} onChange={(l) => set({ labels: l })} />
          <button type="button" onClick={() => fileRef.current?.click()} className="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 hover:bg-slate-50">
            {pending.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImagePlus className="h-3.5 w-3.5" />} Attach
          </button>
          <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => { pending.add(e.target.files); e.target.value = ''; }} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Modules">
            <MultiSelect value={d.module_ids} onChange={(module_ids) => set({ module_ids })} options={(modules.data ?? []).map((m) => ({ value: m.id, label: m.name }))} placeholder={(modules.data ?? []).length ? 'Add to modules' : 'No modules yet'} />
          </Field>
          <Field label="Parent">
            <SelectBox value={d.parent_id} onChange={(parent_id) => set({ parent_id })} placeholder="None" options={[{ value: '', label: 'None' }, ...(parents.data ?? []).map((w) => ({ value: w.id, label: `${w.display_id} · ${w.title}` }))]} />
          </Field>
          <Field label="Estimate (points)">
            <TextInput type="number" min={0} max={1000} value={d.estimate} onChange={(e) => set({ estimate: e.target.value })} placeholder="—" />
          </Field>
        </div>
        {pending.files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {pending.files.map((f) => (
              <span key={f.id} className="group relative inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1 pr-2 text-xs text-slate-700">
                {f.preview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={f.preview} alt={f.name} className="h-12 w-16 rounded object-cover" />
                ) : (
                  <Paperclip className="ml-1 h-4 w-4 text-slate-400" />
                )}
                <span className="max-w-[10rem] truncate">{f.name}</span>
                <span className="text-slate-400">{fmtBytes(f.size)}</span>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => pending.setFiles((x) => x.filter((y) => y.id !== f.id))} className="rounded p-0.5 text-slate-400 hover:text-rose-600">
                  <X className="h-3.5 w-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        {Object.entries(errors)
          .filter(([k]) => k !== 'title')
          .map(([k, v]) => (
            <p key={k} className="text-xs text-rose-600">{k.replace(/_id$/, '').replace(/_/g, ' ')} {v}</p>
          ))}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Project create / settings
// ---------------------------------------------------------------------------

interface ProjectDraft {
  name: string;
  key: string;
  description: string;
  color: string;
  status: string;
  visibility: string;
  lead_id: string;
  member_ids: string[];
  start_date: string;
  end_date: string;
}

function suggestKey(name: string) {
  let k = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (k && !/^[A-Z]/.test(k)) k = 'P' + k;
  return k.slice(0, 5);
}

function draftFrom(p?: Project): ProjectDraft {
  return {
    name: p?.name ?? '',
    key: p?.key ?? '',
    description: p?.description ?? '',
    color: p?.color ?? PROJECT_COLORS[0],
    status: p?.status ?? 'active',
    visibility: p?.visibility ?? 'public',
    lead_id: p?.lead_id ?? '',
    member_ids: p?.member_ids ?? [],
    start_date: toDayInput(p?.start_date),
    end_date: toDayInput(p?.end_date),
  };
}

function ProjectFields({ d, set, errors, keyTouched, onKeyTouched }: {
  d: ProjectDraft;
  set: (p: Partial<ProjectDraft>) => void;
  errors: Record<string, string>;
  keyTouched: boolean;
  onKeyTouched: () => void;
}) {
  const agents = useAgents();
  const options = (agents.data ?? []).filter((a) => a.active).map((a) => ({ value: a.id, label: a.name }));
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
      <Field label="Project name" required error={errors.name}>
        <TextInput
          autoFocus
          value={d.name}
          invalid={!!errors.name}
          onChange={(e) => set({ name: e.target.value, ...(keyTouched ? {} : { key: suggestKey(e.target.value) }) })}
          placeholder="e.g. Website relaunch"
        />
      </Field>
      <Field label="Identifier" required error={errors.key} hint="Prefix for work item IDs">
        <TextInput
          value={d.key}
          invalid={!!errors.key}
          maxLength={10}
          onChange={(e) => {
            onKeyTouched();
            set({ key: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') });
          }}
          placeholder="KAIRV"
          className="font-mono uppercase"
        />
      </Field>
      <Field label="Description" className="sm:col-span-2">
        <TextArea rows={3} value={d.description} onChange={(e) => set({ description: e.target.value })} placeholder="What is this project about?" />
      </Field>
      <div className="sm:col-span-2">
        <span className="mb-1 block text-[13px] font-medium text-slate-700">Color</span>
        <div className="flex gap-2">
          {PROJECT_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => set({ color: c })}
              aria-label={`Color ${c}`}
              aria-pressed={d.color === c}
              className={cn('h-7 w-7 rounded-full ring-offset-2 transition', d.color === c && 'ring-2 ring-slate-900')}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>
      <Field label="Status">
        <SelectBox value={d.status} onChange={(status) => set({ status })} options={PROJECT_STATUSES} />
      </Field>
      <Field label="Visibility" error={errors.visibility}>
        <SelectBox value={d.visibility} onChange={(visibility) => set({ visibility })} options={[{ value: 'public', label: 'Public' }, { value: 'private', label: 'Private' }]} />
      </Field>
      <Field label="Project lead" error={errors.lead_id} className="sm:col-span-2">
        <SelectBox value={d.lead_id} onChange={(lead_id) => set({ lead_id })} options={options} placeholder="No lead" />
      </Field>
      <div className="sm:col-span-2">
        <span className="mb-1 block text-[13px] font-medium text-slate-700">Members</span>
        <MultiSelect value={d.member_ids} onChange={(member_ids) => set({ member_ids })} options={options} placeholder="Add agents who work on this project" />
        <span className="mt-1 block text-xs text-slate-500">
          {d.visibility === 'private' ? 'Only members can see a private project.' : 'Every agent can view a public project; members can create and edit work items.'}
        </span>
        {errors.member_ids && <span className="mt-1 block text-xs text-rose-600">{errors.member_ids}</span>}
      </div>
      <Field label="Start date" error={errors.start_date}>
        <TextInput type="date" value={d.start_date} onChange={(e) => set({ start_date: e.target.value })} />
      </Field>
      <Field label="Target date" error={errors.end_date}>
        <TextInput type="date" value={d.end_date} onChange={(e) => set({ end_date: e.target.value })} />
      </Field>
    </div>
  );
}

function fieldErrors(e: unknown) {
  return Object.fromEntries(Object.entries(parseApiError(e).fields).map(([k, v]) => [k, String(v)]));
}

export function CreateProjectModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const myId = me?.user.id ?? '';
  const [d, setD] = React.useState<ProjectDraft>(() => draftFrom());
  const [keyTouched, setKeyTouched] = React.useState(false);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (open) {
      // The creator leads the project by default.
      setD({ ...draftFrom(), lead_id: myId, member_ids: myId ? [myId] : [] });
      setKeyTouched(false);
      setErrors({});
    }
  }, [open, myId]);
  const create = useMutation({
    mutationFn: () => v2.post<Project>('/projects', { ...d, key: d.key || undefined }),
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success(`Project ${p.name} created`);
      celebrate('big');
      onClose();
      router.push(`/projects/${p.id}`);
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      if (!Object.keys(parseApiError(e).fields).length) toast.error(parseApiError(e).message);
    },
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="New project"
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" loading={create.isPending} disabled={!d.name.trim()} onClick={() => create.mutate()}>Create project</Btn>
        </>
      }
    >
      <ProjectFields d={d} set={(p) => setD((x) => ({ ...x, ...p }))} errors={errors} keyTouched={keyTouched} onKeyTouched={() => setKeyTouched(true)} />
    </Modal>
  );
}

export function ProjectSettings({ project, canDelete }: { project: Project; canDelete: boolean }) {
  const qc = useQueryClient();
  const router = useRouter();
  const confirm = useConfirm();
  const [d, setD] = React.useState<ProjectDraft>(() => draftFrom(project));
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => setD(draftFrom(project)), [project]);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['project', project.id] });
    qc.invalidateQueries({ queryKey: ['projects'] });
    qc.invalidateQueries({ queryKey: ['work-items', project.id] });
  };
  const save = useMutation({
    mutationFn: (body: Partial<ProjectDraft> & { archived?: boolean }) => v2.put<Project>(`/projects/${project.id}`, body),
    onSuccess: (_p, body) => {
      setErrors({});
      refresh();
      toast.success(body.archived === undefined ? 'Project settings saved' : body.archived ? 'Project archived' : 'Project restored');
    },
    onError: (e) => {
      setErrors(fieldErrors(e));
      toast.error(parseApiError(e).message);
    },
  });
  const remove = useMutation({
    mutationFn: () => v2.del(`/projects/${project.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['projects'] });
      toast.success('Project deleted');
      router.push('/projects');
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  if (!project.can_manage) {
    return <EmptyState title="Only the project lead or a project administrator can change these settings" />;
  }
  return (
    <div className="max-w-3xl space-y-5">
      <Card title="Project details">
        <ProjectFields d={d} set={(p) => setD((x) => ({ ...x, ...p }))} errors={errors} keyTouched onKeyTouched={() => undefined} />
        <div className="mt-4 flex justify-end">
          <Btn variant="primary" loading={save.isPending} onClick={() => save.mutate(d)}>Save changes</Btn>
        </div>
      </Card>
      <Card title="Danger zone">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-slate-800">{project.archived ? 'Restore project' : 'Archive project'}</div>
              <div className="text-sm text-slate-500">
                {project.archived ? 'Make the project editable again and show it in the project list.' : 'Archived projects are read-only and hidden from the project list.'}
              </div>
            </div>
            <Btn
              onClick={async () => {
                if (project.archived || (await confirm({ title: `Archive ${project.name}?`, message: 'Work items stay available read-only. You can restore the project at any time.', confirmLabel: 'Archive' }))) {
                  save.mutate({ archived: !project.archived });
                }
              }}
            >
              {project.archived ? 'Restore' : 'Archive'}
            </Btn>
          </div>
          {canDelete && (
            <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-4">
              <div>
                <div className="text-sm font-medium text-rose-700">Delete project</div>
                <div className="text-sm text-slate-500">Permanently removes the project, its {project.total_items} work items, comments and cycles.</div>
              </div>
              <Btn
                variant="danger"
                icon={<Trash2 className="h-4 w-4" />}
                loading={remove.isPending}
                onClick={async () => {
                  if (await confirm({ title: `Delete ${project.name}?`, message: 'This cannot be undone.', confirmLabel: 'Delete project', danger: true })) remove.mutate();
                }}
              >
                Delete
              </Btn>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cycles
// ---------------------------------------------------------------------------

const CYCLE_GROUPS: { status: Cycle['status']; label: string }[] = [
  { status: 'current', label: 'Current' },
  { status: 'upcoming', label: 'Upcoming' },
  { status: 'draft', label: 'Draft' },
  { status: 'completed', label: 'Completed' },
];

export function CyclesView({ project, onShowItems }: { project: Project; onShowItems: (cycleId: string) => void }) {
  const { data: cycles = [], isLoading } = useCycles(project.id);
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [editing, setEditing] = React.useState<Cycle | 'new' | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => v2.del(`/cycles/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cycles', project.id] });
      qc.invalidateQueries({ queryKey: ['work-items', project.id] });
      toast.success('Cycle deleted');
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  if (isLoading) return <LoadingBlock />;
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">Cycles are time-boxed iterations. Plan work into a cycle and track its progress.</p>
        {project.can_edit && <Btn variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setEditing('new')}>New cycle</Btn>}
      </div>
      {cycles.length === 0 ? (
        <EmptyState title="No cycles yet" description="Create a cycle to plan a sprint of work." icon={<CircleDot className="h-6 w-6" />} />
      ) : (
        CYCLE_GROUPS.map((g) => {
          const list = cycles.filter((c) => c.status === g.status);
          if (!list.length) return null;
          return (
            <section key={g.status}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{g.label}</h3>
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
                {list.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-4 px-4 py-3">
                    <CircleDot className={cn('h-5 w-5', c.status === 'current' ? 'text-violet-600' : 'text-slate-400')} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <button onClick={() => onShowItems(c.id)} className="truncate text-sm font-medium text-slate-900 hover:text-blue-700">{c.name}</button>
                        {c.status === 'current' && <Badge className="bg-violet-100 text-violet-700 ring-violet-600/20">In progress</Badge>}
                      </div>
                      <div className="text-xs text-slate-500">
                        {c.start_date ? `${fmtDay(c.start_date)} – ${fmtDay(c.end_date, true)}` : 'No dates'}
                        {c.description && <span> · {c.description}</span>}
                      </div>
                    </div>
                    <div className="flex w-56 items-center gap-2">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
                        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${c.progress}%` }} />
                      </div>
                      <span className="w-24 text-right text-xs text-slate-500">{c.done}/{c.total} done</span>
                    </div>
                    <Btn size="xs" onClick={() => onShowItems(c.id)}>Work items</Btn>
                    {project.can_edit && (
                      <div className="flex gap-1">
                        <button onClick={() => setEditing(c)} aria-label={`Edit ${c.name}`} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><Pencil className="h-4 w-4" /></button>
                        <button
                          onClick={async () => {
                            if (await confirm({ title: `Delete ${c.name}?`, message: 'Its work items stay in the project without a cycle.', confirmLabel: 'Delete', danger: true })) remove.mutate(c.id);
                          }}
                          aria-label={`Delete ${c.name}`}
                          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
      <CycleModal project={project} cycle={editing === 'new' ? null : editing} open={editing !== null} onClose={() => setEditing(null)} />
    </div>
  );
}

function CycleModal({ project, cycle, open, onClose }: { project: Project; cycle: Cycle | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [start, setStart] = React.useState('');
  const [end, setEnd] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (!open) return;
    setName(cycle?.name ?? '');
    setDescription(cycle?.description ?? '');
    setStart(toDayInput(cycle?.start_date));
    setEnd(toDayInput(cycle?.end_date));
    setErrors({});
  }, [open, cycle]);
  const save = useMutation({
    mutationFn: () => {
      const body = { name, description, start_date: start, end_date: end };
      return cycle ? v2.put(`/cycles/${cycle.id}`, body) : v2.post(`/projects/${project.id}/cycles`, body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cycles', project.id] });
      toast.success(cycle ? 'Cycle updated' : 'Cycle created');
      onClose();
    },
    onError: (e) => setErrors(fieldErrors(e)),
  });
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={cycle ? 'Edit cycle' : 'New cycle'}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" loading={save.isPending} disabled={!name.trim()} onClick={() => save.mutate()}>{cycle ? 'Save' : 'Create cycle'}</Btn>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required error={errors.name} className="sm:col-span-2">
          <TextInput autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Sprint 12" />
        </Field>
        <Field label="Start date" error={errors.start_date}>
          <TextInput type="date" value={start} onChange={(e) => setStart(e.target.value)} />
        </Field>
        <Field label="End date" error={errors.end_date}>
          <TextInput type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
        </Field>
        <Field label="Goal" className="sm:col-span-2">
          <TextArea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What should this cycle achieve?" />
        </Field>
      </div>
    </Modal>
  );
}
