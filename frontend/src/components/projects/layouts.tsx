'use client';

import * as React from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkItem, WorkItemState } from '@/lib/itsm/types';
import { WORK_ITEM_STATES, dayOf, fmtDay, isOverdue, todayDay } from '@/lib/itsm/projects';
import { timeAgo } from '@/lib/itsm/format';
import { EmptyState, Table, Td, Th } from '@/components/desk/kit';
import { StateIcon } from './icons';
import { AssigneeSelect, CycleSelect, DateSelect, LabelsSelect, PrioritySelect, StateSelect } from './properties';
import { WorkItemProperties, type CardContext } from './work-item-card';
import { QuickAdd } from './board';

// ---------------------------------------------------------------------------
// List: rows grouped by state
// ---------------------------------------------------------------------------

export function ListLayout({ items, ctx, states, collapsed, onToggleCollapse, onQuickAdd }: {
  items: WorkItem[];
  ctx: CardContext;
  states: WorkItemState[];
  collapsed: string[];
  onToggleCollapse: (state: string) => void;
  onQuickAdd: (state: WorkItemState, title: string) => Promise<unknown>;
}) {
  const [adding, setAdding] = React.useState<string | null>(null);
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
      {states.map((s) => {
        const rows = items.filter((w) => w.state === s);
        const label = WORK_ITEM_STATES.find((x) => x.value === s)?.label ?? s;
        const isCollapsed = collapsed.includes(s);
        return (
          <section key={s} aria-label={label}>
            <header className="flex items-center gap-2 border-b border-slate-200 bg-slate-50/80 px-3 py-2">
              <button onClick={() => onToggleCollapse(s)} aria-expanded={!isCollapsed} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-slate-100">
                <ChevronDown className={cn('h-4 w-4 text-slate-400 transition-transform', isCollapsed && '-rotate-90')} />
                <StateIcon state={s} />
                <span className="text-sm font-semibold text-slate-800">{label}</span>
                <span className="text-xs text-slate-500">{rows.length}</span>
              </button>
              {ctx.project.can_edit && (
                <button onClick={() => setAdding(s)} aria-label={`Add to ${label}`} className="ml-auto rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                  <Plus className="h-4 w-4" />
                </button>
              )}
            </header>
            {!isCollapsed && (
              <div>
                {rows.map((w) => (
                  <div
                    key={w.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => ctx.onOpen(w.id)}
                    onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && ctx.onOpen(w.id)}
                    className="flex cursor-pointer items-center gap-3 border-b border-slate-100 px-3 py-2 outline-none hover:bg-slate-50 focus-visible:bg-blue-50"
                  >
                    <StateSelect variant="icon" value={w.state} disabled={!ctx.project.can_edit} onChange={(state) => ctx.onPatch(w, { state })} />
                    <span className="w-[72px] shrink-0 text-xs font-medium text-slate-500">{w.display_id}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-900">
                      {w.title}
                      {w.parent && <span className="ml-2 text-xs text-slate-400">· {w.parent.display_id}</span>}
                    </span>
                    <WorkItemProperties item={w} ctx={ctx} hideState className="hidden flex-nowrap justify-end lg:flex" />
                  </div>
                ))}
                {ctx.project.can_edit && (
                  <div className="border-b border-slate-100 px-2 py-1">
                    <QuickAdd open={adding === s} onOpenChange={(v) => setAdding(v ? s : null)} onCreate={(t) => onQuickAdd(s, t)} />
                  </div>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table: one row per work item with every property as a column
// ---------------------------------------------------------------------------

export function TableLayout({ items, ctx }: { items: WorkItem[]; ctx: CardContext }) {
  const { project, cycles, labels, onPatch } = ctx;
  const editable = project.can_edit;
  if (items.length === 0) return <EmptyState title="No work items match these filters" />;
  return (
    <Table>
      <thead>
        <tr>
          <Th className="w-24">ID</Th>
          <Th>Title</Th>
          <Th>State</Th>
          <Th>Priority</Th>
          <Th>Assignee</Th>
          <Th>Start</Th>
          <Th>Due</Th>
          <Th>Cycle</Th>
          <Th>Labels</Th>
          <Th>Updated</Th>
        </tr>
      </thead>
      <tbody>
        {items.map((w) => (
          <tr key={w.id} className="hover:bg-slate-50">
            <Td className="whitespace-nowrap text-xs font-medium text-slate-500">{w.display_id}</Td>
            <Td>
              <button onClick={() => ctx.onOpen(w.id)} className="max-w-[360px] truncate text-left text-sm font-medium text-slate-900 hover:text-blue-700">
                {w.title}
              </button>
            </Td>
            <Td><StateSelect value={w.state} disabled={!editable} onChange={(state) => onPatch(w, { state })} /></Td>
            <Td><PrioritySelect value={w.priority} disabled={!editable} onChange={(priority) => onPatch(w, { priority })} /></Td>
            <Td><AssigneeSelect value={w.assignee} members={project.members} disabled={!editable} onChange={(assignee_id) => onPatch(w, { assignee_id })} /></Td>
            <Td><DateSelect label="Start date" value={w.start_date} disabled={!editable} onChange={(start_date) => onPatch(w, { start_date })} /></Td>
            <Td><DateSelect label="Due date" value={w.due_date} tone={isOverdue(w) ? 'overdue' : undefined} disabled={!editable} onChange={(due_date) => onPatch(w, { due_date })} /></Td>
            <Td><CycleSelect value={w.cycle} cycles={cycles} disabled={!editable} onChange={(cycle_id) => onPatch(w, { cycle_id })} /></Td>
            <Td><LabelsSelect value={w.labels} suggestions={labels} disabled={!editable} onChange={(l) => onPatch(w, { labels: l })} /></Td>
            <Td className="whitespace-nowrap text-xs text-slate-500">{timeAgo(w.updated_at)}</Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

// ---------------------------------------------------------------------------
// Calendar: month grid by due date (or start date when no due date)
// ---------------------------------------------------------------------------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dayKey(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function CalendarLayout({ items, ctx }: { items: WorkItem[]; ctx: CardContext }) {
  const [month, setMonth] = React.useState(() => {
    const t = new Date();
    return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1));
  });
  const byDay = React.useMemo(() => {
    const m = new Map<string, WorkItem[]>();
    items.forEach((w) => {
      const d = dayOf(w.due_date || w.start_date);
      if (!d) return;
      m.set(d, [...(m.get(d) ?? []), w]);
    });
    return m;
  }, [items]);
  const unscheduled = items.filter((w) => !w.due_date && !w.start_date).length;
  const first = new Date(month);
  first.setUTCDate(1 - month.getUTCDay());
  const days = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(first);
    d.setUTCDate(first.getUTCDate() + i);
    return d;
  });
  const today = todayDay();
  const shift = (n: number) => setMonth((m) => new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + n, 1)));
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
        <h3 className="text-sm font-semibold text-slate-800">{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' })}</h3>
        <div className="ml-auto flex items-center gap-1">
          <button onClick={() => shift(-1)} aria-label="Previous month" className="rounded p-1 text-slate-500 hover:bg-slate-100"><ChevronLeft className="h-4 w-4" /></button>
          <button
            onClick={() => {
              const t = new Date();
              setMonth(new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)));
            }}
            className="rounded px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100"
          >
            Today
          </button>
          <button onClick={() => shift(1)} aria-label="Next month" className="rounded p-1 text-slate-500 hover:bg-slate-100"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50 text-center text-xs font-medium text-slate-500">
        {WEEKDAYS.map((d) => (
          <div key={d} className="py-1.5">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const key = dayKey(d);
          const list = byDay.get(key) ?? [];
          const inMonth = d.getUTCMonth() === month.getUTCMonth();
          return (
            <div key={key} className={cn('min-h-[108px] border-b border-r border-slate-100 p-1.5', !inMonth && 'bg-slate-50/60')}>
              <div className={cn('mb-1 flex h-5 w-5 items-center justify-center rounded-full text-[11px]', key === today ? 'bg-blue-600 font-semibold text-white' : inMonth ? 'text-slate-600' : 'text-slate-400')}>
                {d.getUTCDate()}
              </div>
              <div className="space-y-1">
                {list.slice(0, 3).map((w) => (
                  <button
                    key={w.id}
                    onClick={() => ctx.onOpen(w.id)}
                    title={`${w.display_id} ${w.title}${w.due_date ? ` · due ${fmtDay(w.due_date)}` : ''}`}
                    className={cn('flex w-full items-center gap-1 truncate rounded border px-1.5 py-0.5 text-left text-[11px]', isOverdue(w) ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50')}
                  >
                    <StateIcon state={w.state} className="h-3 w-3" />
                    <span className="truncate">{w.title}</span>
                  </button>
                ))}
                {list.length > 3 && <div className="px-1 text-[11px] text-slate-500">+{list.length - 3} more</div>}
              </div>
            </div>
          );
        })}
      </div>
      {unscheduled > 0 && <div className="px-3 py-2 text-xs text-slate-500">{unscheduled} work item{unscheduled === 1 ? '' : 's'} without dates are not shown on the calendar.</div>}
    </div>
  );
}
