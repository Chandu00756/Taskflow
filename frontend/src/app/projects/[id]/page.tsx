'use client';

import * as React from 'react';
import Link from 'next/link';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { CalendarDays, Check, ChevronRight, Columns3, Filter, List, Lock, Plus, SlidersHorizontal, Table2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { parseApiError } from '@/lib/itsm/api';
import { useCan, useMe } from '@/lib/itsm/hooks';
import type { WorkItem, WorkItemState } from '@/lib/itsm/types';
import { WORK_ITEM_PRIORITIES, WORK_ITEM_STATES, comparePriority, dayOf, stateLabel } from '@/lib/itsm/projects';
import { Avatar, Btn, ErrorBlock, LoadingBlock, SearchInput, Tabs } from '@/components/desk/kit';
import { useDebounced } from '@/components/desk/pickers';
import { PriorityIcon, StateIcon } from '@/components/projects/icons';
import { ClearableChip } from '@/components/projects/properties';
import { Board } from '@/components/projects/board';
import { CalendarLayout, ListLayout, TableLayout } from '@/components/projects/layouts';
import { WorkItemPeek } from '@/components/projects/peek';
import { CreateWorkItemModal, CyclesView, ProjectSettings } from '@/components/projects/forms';
import { ModulesView } from '@/components/projects/modules';
import { DEFAULT_DISPLAY, DISPLAY_LABELS, type CardContext, type DisplayProps } from '@/components/projects/work-item-card';
import { useCreateWorkItem, useCycles, useModules, useProject, useProjectLabels, useUpdateWorkItem, useWorkItems, type WorkItemPatch } from '@/components/projects/hooks';

type Layout = 'list' | 'board' | 'calendar' | 'table';
type Order = 'manual' | 'priority' | 'due_date' | 'created' | 'updated';

interface ViewPrefs {
  layout: Layout;
  display: DisplayProps;
  order: Order;
  showSubItems: boolean;
  states: WorkItemState[];
  collapsed: string[];
}

const DEFAULT_PREFS: ViewPrefs = {
  layout: 'board',
  display: DEFAULT_DISPLAY,
  order: 'manual',
  showSubItems: true,
  states: ['backlog', 'todo', 'in_progress', 'done', 'cancelled'],
  collapsed: [],
};

const LAYOUTS: { value: Layout; label: string; icon: React.ElementType }[] = [
  { value: 'list', label: 'List', icon: List },
  { value: 'board', label: 'Board', icon: Columns3 },
  { value: 'calendar', label: 'Calendar', icon: CalendarDays },
  { value: 'table', label: 'Table', icon: Table2 },
];

const ORDERS: { value: Order; label: string }[] = [
  { value: 'manual', label: 'Manual' },
  { value: 'priority', label: 'Priority' },
  { value: 'due_date', label: 'Due date' },
  { value: 'created', label: 'Newest first' },
  { value: 'updated', label: 'Last updated' },
];

/** View preferences are a per-browser convenience, so storage failures are ignored. */
function useViewPrefs(projectId: string) {
  const storageKey = `project-view:${projectId}`;
  const [prefs, setPrefs] = React.useState<ViewPrefs>(DEFAULT_PREFS);
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as Partial<ViewPrefs>;
        setPrefs({ ...DEFAULT_PREFS, ...saved, display: { ...DEFAULT_DISPLAY, ...saved.display } });
      }
    } catch {
      /* ignore */
    }
  }, [storageKey]);
  const update = React.useCallback(
    (p: Partial<ViewPrefs>) =>
      setPrefs((cur) => {
        const next = { ...cur, ...p };
        try {
          localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          /* ignore */
        }
        return next;
      }),
    [storageKey]
  );
  return [prefs, update] as const;
}

interface Filters {
  assignee: string;
  priority: string[];
  cycle: string;
  label: string;
  module?: string;
}

const NO_FILTERS: Filters = { assignee: '', priority: [], cycle: '', label: '' };

function sortItems(items: WorkItem[], order: Order) {
  const list = [...items];
  switch (order) {
    case 'priority':
      return list.sort((a, b) => comparePriority(a, b) || a.sort_order - b.sort_order);
    case 'due_date':
      return list.sort((a, b) => (dayOf(a.due_date) || '9999').localeCompare(dayOf(b.due_date) || '9999') || a.sort_order - b.sort_order);
    case 'created':
      return list.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    case 'updated':
      return list.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
    default:
      return list.sort((a, b) => a.sort_order - b.sort_order || a.number - b.number);
  }
}

function ProjectPage() {
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const can = useCan();
  const { data: me } = useMe();
  const project = useProject(id);
  const cycles = useCycles(id);
  const modules = useModules(id);
  const labels = useProjectLabels(id);
  const [prefs, setPrefs] = useViewPrefs(id);
  const [q, setQ] = React.useState('');
  const term = useDebounced(q.trim(), 250);
  const [filters, setFilters] = React.useState<Filters>(() => ({ ...NO_FILTERS, cycle: params.get('cycle') ?? '' }));
  const [creating, setCreating] = React.useState(false);
  const tab = params.get('tab') ?? 'items';
  const openItem = params.get('item');

  const items = useWorkItems(id, {
    q: term,
    priority: filters.priority,
    assignee_id: filters.assignee,
    cycle_id: filters.cycle,
    label: filters.label,
    module_id: filters.module,
    parent_id: prefs.showSubItems ? undefined : 'none',
  });
  const update = useUpdateWorkItem(id);
  const create = useCreateWorkItem(id);

  const setParam = React.useCallback(
    (changes: Record<string, string | null>) => {
      const sp = new URLSearchParams(params.toString());
      Object.entries(changes).forEach(([k, v]) => (v ? sp.set(k, v) : sp.delete(k)));
      const qs = sp.toString();
      router.replace(qs ? `/projects/${id}?${qs}` : `/projects/${id}`, { scroll: false });
    },
    [params, router, id]
  );

  const onOpen = React.useCallback((itemId: string) => setParam({ item: itemId }), [setParam]);
  const onPatch = React.useCallback((w: WorkItem, patch: WorkItemPatch) => update.mutate({ id: w.id, patch }), [update]);
  const sorted = React.useMemo(() => sortItems(items.data ?? [], prefs.order), [items.data, prefs.order]);

  if (project.isLoading) return <LoadingBlock />;
  if (project.error || !project.data) return <ErrorBlock message={project.error ? parseApiError(project.error).message : 'Project not found'} />;
  const p = project.data;
  const ctx: CardContext = { project: p, cycles: cycles.data ?? [], labels: labels.data ?? [], display: prefs.display, onPatch, onOpen };
  const states = WORK_ITEM_STATES.map((s) => s.value).filter((s) => prefs.states.includes(s));
  const toggleCollapse = (s: string) => setPrefs({ collapsed: prefs.collapsed.includes(s) ? prefs.collapsed.filter((x) => x !== s) : [...prefs.collapsed, s] });
  // New items inherit the active filters so they stay visible after creation.
  const filterAssignee = filters.assignee === 'me' ? me?.user.id : filters.assignee === 'none' ? undefined : filters.assignee || undefined;
  const quickAdd = (state: WorkItemState, title: string) =>
    create.mutateAsync({
      title,
      state,
      cycle_id: filters.cycle && filters.cycle !== 'none' ? filters.cycle : undefined,
      assignee_id: filterAssignee && p.member_ids.includes(filterAssignee) ? filterAssignee : undefined,
      priority: filters.priority.length === 1 ? filters.priority[0] : undefined,
      labels: filters.label ? [filters.label] : undefined,
      module_ids: filters.module ? [filters.module] : undefined,
    });
  const activeFilters = !!(filters.assignee || filters.priority.length || filters.cycle || filters.label || filters.module);
  const memberName = (uid: string) => p.members.find((m) => m.id === uid)?.name ?? 'Member';
  const cycleName = (cid: string) => cycles.data?.find((c) => c.id === cid)?.name ?? 'Cycle';

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3">
        <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
          <Link href="/projects" className="text-slate-500 hover:text-slate-800">Projects</Link>
          <ChevronRight className="h-4 w-4 text-slate-300" />
          <span className="inline-flex h-6 items-center rounded px-1.5 text-[11px] font-semibold text-white" style={{ background: p.color || '#2563eb' }}>{p.key}</span>
          <span className="truncate font-semibold text-slate-900">{p.name}</span>
          {p.visibility === 'private' && <Lock className="h-3.5 w-3.5 text-slate-400" aria-label="Private project" />}
          {p.archived && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-medium text-amber-800">Archived</span>}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <div className="hidden -space-x-1.5 sm:flex" aria-label={`${p.members.length} members`}>
            {p.members.slice(0, 4).map((m) => (
              <span key={m.id} title={m.name} className="rounded-full ring-2 ring-slate-50"><Avatar name={m.name} src={m.avatar_url} size="xs" /></span>
            ))}
          </div>
          {p.can_edit && tab === 'items' && (
            <Btn variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>Add work item</Btn>
          )}
        </div>
      </div>

      <Tabs
        value={tab}
        onChange={(t) => setParam({ tab: t === 'items' ? null : t, item: null })}
        tabs={[
          { value: 'items', label: 'Work items', count: p.total_items },
          { value: 'cycles', label: 'Cycles' },
          { value: 'modules', label: 'Modules' },
          ...(p.can_manage ? [{ value: 'settings', label: 'Settings' }] : []),
        ]}
      />

      {tab === 'cycles' && (
        <CyclesView
          project={p}
          onShowItems={(cid) => {
            setFilters({ ...NO_FILTERS, cycle: cid });
            setParam({ tab: null });
          }}
        />
      )}
      {tab === 'modules' && (
        <ModulesView
          project={p}
          onShowItems={(mid) => {
            setFilters({ ...NO_FILTERS, module: mid });
            setParam({ tab: null });
          }}
        />
      )}
      {tab === 'settings' && <ProjectSettings project={p} canDelete={can('projects.manage')} />}

      {tab === 'items' && (
        <>
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={q} onChange={setQ} placeholder="Search by title or ID…" className="w-full sm:w-64" />
            <div className="flex items-center rounded-md border border-slate-200 bg-white p-0.5" role="radiogroup" aria-label="Layout">
              {LAYOUTS.map((l) => (
                <button
                  key={l.value}
                  role="radio"
                  aria-checked={prefs.layout === l.value}
                  aria-label={`${l.label} layout`}
                  title={l.label}
                  onClick={() => setPrefs({ layout: l.value })}
                  className={cn('rounded p-1.5 text-slate-500 hover:text-slate-800', prefs.layout === l.value && 'bg-slate-100 text-slate-900')}
                >
                  <l.icon className="h-4 w-4" />
                </button>
              ))}
            </div>
            <FilterMenu filters={filters} setFilters={setFilters} ctx={ctx} />
            <DisplayMenu prefs={prefs} setPrefs={setPrefs} />
            {items.isFetching && !items.isLoading && <span className="text-xs text-slate-400">Updating…</span>}
            <span className="ml-auto text-xs text-slate-500">{sorted.length} work item{sorted.length === 1 ? '' : 's'}</span>
          </div>
          {activeFilters && (
            <div className="flex flex-wrap items-center gap-1.5">
              {filters.assignee && (
                <ClearableChip onClear={() => setFilters({ ...filters, assignee: '' })}>
                  Assignee: {filters.assignee === 'me' ? 'Me' : filters.assignee === 'none' ? 'Unassigned' : memberName(filters.assignee)}
                </ClearableChip>
              )}
              {filters.priority.map((pr) => (
                <ClearableChip key={pr} onClear={() => setFilters({ ...filters, priority: filters.priority.filter((x) => x !== pr) })}>
                  <PriorityIcon priority={pr} className="h-3 w-3" /> {WORK_ITEM_PRIORITIES.find((x) => x.value === pr)?.label}
                </ClearableChip>
              ))}
              {filters.cycle && <ClearableChip onClear={() => setFilters({ ...filters, cycle: '' })}>Cycle: {filters.cycle === 'none' ? 'No cycle' : cycleName(filters.cycle)}</ClearableChip>}
              {filters.label && <ClearableChip onClear={() => setFilters({ ...filters, label: '' })}>Label: {filters.label}</ClearableChip>}
              {filters.module && <ClearableChip onClear={() => setFilters({ ...filters, module: '' })}>Module: {modules.data?.find((m) => m.id === filters.module)?.name ?? 'Module'}</ClearableChip>}
              <button onClick={() => setFilters(NO_FILTERS)} className="text-xs text-slate-500 hover:text-slate-800">Clear all</button>
            </div>
          )}

          {items.isLoading ? (
            <LoadingBlock />
          ) : items.error ? (
            <ErrorBlock message={parseApiError(items.error).message} onRetry={() => items.refetch()} />
          ) : prefs.layout === 'board' ? (
            <Board items={sorted} ctx={ctx} states={states} manualOrder={prefs.order === 'manual'} collapsed={prefs.collapsed} onToggleCollapse={toggleCollapse} onQuickAdd={quickAdd} />
          ) : prefs.layout === 'list' ? (
            <ListLayout items={sorted} ctx={ctx} states={states} collapsed={prefs.collapsed} onToggleCollapse={toggleCollapse} onQuickAdd={quickAdd} />
          ) : prefs.layout === 'calendar' ? (
            <CalendarLayout items={sorted} ctx={ctx} />
          ) : (
            <TableLayout items={sorted.filter((w) => states.includes(w.state))} ctx={ctx} />
          )}
        </>
      )}

      <CreateWorkItemModal
        open={creating}
        onClose={() => setCreating(false)}
        project={p}
        cycles={cycles.data ?? []}
        labels={labels.data ?? []}
        defaults={filters.cycle && filters.cycle !== 'none' ? { cycle: cycles.data?.find((c) => c.id === filters.cycle) ?? null } : undefined}
      />
      {openItem && (
        <WorkItemPeek id={openItem} project={p} cycles={cycles.data ?? []} labels={labels.data ?? []} onClose={() => setParam({ item: null })} onOpen={onOpen} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Toolbar menus
// ---------------------------------------------------------------------------

function useDropdown() {
  const [open, setOpen] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);
  return { open, setOpen, ref };
}

function MenuRow({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" role="menuitemcheckbox" aria-checked={active} onClick={onClick} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50">
      <span className={cn('flex h-4 w-4 items-center justify-center rounded border', active ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300')}>{active && <Check className="h-3 w-3" />}</span>
      {children}
    </button>
  );
}

function MenuSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-slate-100 px-1.5 py-1.5 last:border-0">
      <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{title}</div>
      {children}
    </div>
  );
}

function FilterMenu({ filters, setFilters, ctx }: { filters: Filters; setFilters: (f: Filters) => void; ctx: CardContext }) {
  const dd = useDropdown();
  const count = (filters.assignee ? 1 : 0) + filters.priority.length + (filters.cycle ? 1 : 0) + (filters.label ? 1 : 0);
  const pick = (k: 'assignee' | 'cycle' | 'label', v: string) => setFilters({ ...filters, [k]: filters[k] === v ? '' : v });
  return (
    <div ref={dd.ref} className="relative">
      <Btn size="sm" icon={<Filter className="h-4 w-4" />} onClick={() => dd.setOpen(!dd.open)} aria-expanded={dd.open}>
        Filters{count > 0 && <span className="rounded-full bg-blue-600 px-1.5 text-[11px] text-white">{count}</span>}
      </Btn>
      {dd.open && (
        <div role="menu" className="menu-panel absolute left-0 z-40 mt-1 max-h-[70vh] w-64 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl">
          <MenuSection title="Assignee">
            <MenuRow active={filters.assignee === 'me'} onClick={() => pick('assignee', 'me')}>Assigned to me</MenuRow>
            <MenuRow active={filters.assignee === 'none'} onClick={() => pick('assignee', 'none')}>Unassigned</MenuRow>
            {ctx.project.members.map((m) => (
              <MenuRow key={m.id} active={filters.assignee === m.id} onClick={() => pick('assignee', m.id)}>
                <Avatar name={m.name} src={m.avatar_url} size="xs" /> <span className="truncate">{m.name}</span>
              </MenuRow>
            ))}
          </MenuSection>
          <MenuSection title="Priority">
            {WORK_ITEM_PRIORITIES.map((pr) => (
              <MenuRow
                key={pr.value}
                active={filters.priority.includes(pr.value)}
                onClick={() => setFilters({ ...filters, priority: filters.priority.includes(pr.value) ? filters.priority.filter((x) => x !== pr.value) : [...filters.priority, pr.value] })}
              >
                <PriorityIcon priority={pr.value} /> {pr.label}
              </MenuRow>
            ))}
          </MenuSection>
          {ctx.cycles.length > 0 && (
            <MenuSection title="Cycle">
              <MenuRow active={filters.cycle === 'none'} onClick={() => pick('cycle', 'none')}>No cycle</MenuRow>
              {ctx.cycles.map((c) => (
                <MenuRow key={c.id} active={filters.cycle === c.id} onClick={() => pick('cycle', c.id)}>
                  <span className="truncate">{c.name}</span>
                  {c.status === 'current' && <span className="ml-auto text-[11px] text-violet-600">current</span>}
                </MenuRow>
              ))}
            </MenuSection>
          )}
          {ctx.labels.length > 0 && (
            <MenuSection title="Label">
              {ctx.labels.map((l) => (
                <MenuRow key={l} active={filters.label === l} onClick={() => pick('label', l)}>{l}</MenuRow>
              ))}
            </MenuSection>
          )}
        </div>
      )}
    </div>
  );
}

function DisplayMenu({ prefs, setPrefs }: { prefs: ViewPrefs; setPrefs: (p: Partial<ViewPrefs>) => void }) {
  const dd = useDropdown();
  return (
    <div ref={dd.ref} className="relative">
      <Btn size="sm" icon={<SlidersHorizontal className="h-4 w-4" />} onClick={() => dd.setOpen(!dd.open)} aria-expanded={dd.open}>Display</Btn>
      {dd.open && (
        <div role="menu" className="menu-panel absolute left-0 z-40 mt-1 max-h-[70vh] w-72 overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-xl sm:left-auto sm:right-0">
          <MenuSection title="Order by">
            {ORDERS.map((o) => (
              <MenuRow key={o.value} active={prefs.order === o.value} onClick={() => setPrefs({ order: o.value })}>{o.label}</MenuRow>
            ))}
          </MenuSection>
          <MenuSection title="Show states">
            {WORK_ITEM_STATES.map((s) => (
              <MenuRow
                key={s.value}
                active={prefs.states.includes(s.value)}
                onClick={() => {
                  const next = prefs.states.includes(s.value) ? prefs.states.filter((x) => x !== s.value) : [...prefs.states, s.value];
                  if (next.length) setPrefs({ states: next });
                }}
              >
                <StateIcon state={s.value} /> {stateLabel(s.value)}
              </MenuRow>
            ))}
          </MenuSection>
          <MenuSection title="Options">
            <MenuRow active={prefs.showSubItems} onClick={() => setPrefs({ showSubItems: !prefs.showSubItems })}>Show sub-work items</MenuRow>
          </MenuSection>
          <MenuSection title="Properties">
            {(Object.keys(DISPLAY_LABELS) as (keyof DisplayProps)[]).map((k) => (
              <MenuRow key={k} active={prefs.display[k]} onClick={() => setPrefs({ display: { ...prefs.display, [k]: !prefs.display[k] } })}>{DISPLAY_LABELS[k]}</MenuRow>
            ))}
          </MenuSection>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <React.Suspense fallback={<LoadingBlock />}>
      <ProjectPage />
    </React.Suspense>
  );
}
