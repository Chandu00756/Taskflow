'use client';

import * as React from 'react';
import { GitFork, Link2, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Cycle, Project, WorkItem } from '@/lib/itsm/types';
import { isOverdue } from '@/lib/itsm/projects';
import { AssigneeSelect, CycleSelect, DateSelect, LabelsSelect, PrioritySelect, StateSelect } from './properties';
import type { WorkItemPatch } from './hooks';

export interface DisplayProps {
  state: boolean;
  priority: boolean;
  assignee: boolean;
  start_date: boolean;
  due_date: boolean;
  labels: boolean;
  cycle: boolean;
  counts: boolean;
}

export const DEFAULT_DISPLAY: DisplayProps = {
  state: true,
  priority: true,
  assignee: true,
  start_date: true,
  due_date: true,
  labels: true,
  cycle: true,
  counts: true,
};

export const DISPLAY_LABELS: Record<keyof DisplayProps, string> = {
  state: 'State',
  priority: 'Priority',
  assignee: 'Assignee',
  start_date: 'Start date',
  due_date: 'Due date',
  labels: 'Labels',
  cycle: 'Cycle',
  counts: 'Sub-items, links and comments',
};

export interface CardContext {
  project: Project;
  cycles: Cycle[];
  labels: string[];
  display: DisplayProps;
  onPatch: (item: WorkItem, patch: WorkItemPatch) => void;
  onOpen: (id: string) => void;
}

/** The editable property chips shown on cards, rows and the table. */
export function WorkItemProperties({ item, ctx, className, hideState }: { item: WorkItem; ctx: CardContext; className?: string; hideState?: boolean }) {
  const { display, project, cycles, labels, onPatch } = ctx;
  const editable = project.can_edit;
  const overdue = isOverdue(item);
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {display.state && !hideState && <StateSelect value={item.state} disabled={!editable} onChange={(state) => onPatch(item, { state })} />}
      {display.priority && <PrioritySelect value={item.priority} disabled={!editable} onChange={(priority) => onPatch(item, { priority })} />}
      {display.start_date && (item.start_date || editable) && (
        <DateSelect label="Start date" value={item.start_date} disabled={!editable} onChange={(start_date) => onPatch(item, { start_date })} />
      )}
      {display.due_date && (item.due_date || editable) && (
        <DateSelect label="Due date" value={item.due_date} disabled={!editable} tone={overdue ? 'overdue' : undefined} onChange={(due_date) => onPatch(item, { due_date })} />
      )}
      {display.assignee && (
        <AssigneeSelect variant="icon" value={item.assignee} members={project.members} disabled={!editable} onChange={(assignee_id) => onPatch(item, { assignee_id })} />
      )}
      {display.cycle && (item.cycle || (editable && cycles.length > 0)) && (
        <CycleSelect variant={item.cycle ? 'chip' : 'icon'} value={item.cycle} cycles={cycles} disabled={!editable} onChange={(cycle_id) => onPatch(item, { cycle_id })} />
      )}
      {display.labels && (item.labels.length > 0 || editable) && (
        <LabelsSelect variant="chip" value={item.labels} suggestions={labels} disabled={!editable} onChange={(l) => onPatch(item, { labels: l })} />
      )}
      {display.counts && item.sub_items > 0 && (
        <span className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 px-2 text-xs text-slate-600" title={`${item.sub_items_done} of ${item.sub_items} sub-items done`}>
          <GitFork className="h-3.5 w-3.5 text-slate-400" />
          {item.sub_items_done}/{item.sub_items}
        </span>
      )}
      {display.counts && item.links > 0 && (
        <span className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 px-2 text-xs text-slate-600" title={`${item.links} linked records`}>
          <Link2 className="h-3.5 w-3.5 text-slate-400" />
          {item.links}
        </span>
      )}
      {display.counts && item.comments > 0 && (
        <span className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 px-2 text-xs text-slate-600" title={`${item.comments} comments`}>
          <MessageSquare className="h-3.5 w-3.5 text-slate-400" />
          {item.comments}
        </span>
      )}
    </div>
  );
}

export const WorkItemCard = React.forwardRef<HTMLDivElement, { item: WorkItem; ctx: CardContext; dragging?: boolean; overlay?: boolean } & React.HTMLAttributes<HTMLDivElement>>(
  function WorkItemCard({ item, ctx, dragging, overlay, className, ...rest }, ref) {
    return (
      <div
        ref={ref}
        role="button"
        tabIndex={0}
        aria-label={`${item.display_id} ${item.title}`}
        onClick={() => ctx.onOpen(item.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.target === e.currentTarget) ctx.onOpen(item.id);
        }}
        className={cn(
          'group cursor-pointer rounded-lg border border-slate-200 bg-white p-3 text-left shadow-sm outline-none transition-shadow hover:border-slate-300 hover:shadow focus-visible:ring-2 focus-visible:ring-blue-500',
          dragging && 'opacity-40',
          overlay && 'rotate-1 cursor-grabbing shadow-xl ring-1 ring-blue-200',
          className
        )}
        {...rest}
      >
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="font-medium tracking-wide">{item.display_id}</span>
          {item.parent && (
            <span className="truncate text-slate-400" title={`Sub-item of ${item.parent.display_id} ${item.parent.title}`}>
              · {item.parent.display_id}
            </span>
          )}
        </div>
        <div className="mt-1 line-clamp-3 text-sm font-medium leading-snug text-slate-900">{item.title}</div>
        <WorkItemProperties item={item} ctx={ctx} hideState={false} className="mt-2.5" />
      </div>
    );
  }
);
