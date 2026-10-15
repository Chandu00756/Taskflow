// Shared constants and helpers for projects and work items.
import type { WorkItem, WorkItemPriority, WorkItemState } from './types';

export const WORK_ITEM_STATES: { value: WorkItemState; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'Todo' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

export const WORK_ITEM_PRIORITIES: { value: WorkItemPriority; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'none', label: 'None' },
];

export const PROJECT_STATUSES = [
  { value: 'planned', label: 'Planned' },
  { value: 'active', label: 'Active' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'completed', label: 'Completed' },
];

export const PROJECT_COLORS = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2', '#ca8a04', '#4f46e5'];

export function stateLabel(s: string) {
  return WORK_ITEM_STATES.find((x) => x.value === s)?.label ?? s;
}

export function priorityLabel(p: string) {
  return WORK_ITEM_PRIORITIES.find((x) => x.value === p)?.label ?? p;
}

const PRIORITY_RANK: Record<WorkItemPriority, number> = { urgent: 0, high: 1, medium: 2, low: 3, none: 4 };

export function comparePriority(a: WorkItem, b: WorkItem) {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
}

/**
 * Work item dates are calendar days stored as midnight UTC, so they are
 * formatted in UTC to avoid shifting a day in western time zones.
 */
export function fmtDay(value?: string | null, withYear = false): string {
  if (!value) return '';
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
}

/** Formats a start/due pair the way boards show it: "Oct 15 – 17, 2026". */
export function fmtDayRange(start?: string | null, end?: string | null): string {
  if (start && end) {
    const s = new Date(start);
    const e = new Date(end);
    const sameMonth = s.getUTCFullYear() === e.getUTCFullYear() && s.getUTCMonth() === e.getUTCMonth();
    if (sameMonth && s.getUTCDate() === e.getUTCDate()) return fmtDay(end, true);
    if (sameMonth) return `${fmtDay(start)} – ${e.getUTCDate()}, ${e.getUTCFullYear()}`;
    return `${fmtDay(start)} – ${fmtDay(end, true)}`;
  }
  return fmtDay(start || end, true);
}

/**
 * The UTC calendar day (yyyy-mm-dd) of a stored date. The API may return
 * "2026-10-14T20:00:00-04:00" for Oct 15 UTC, so never slice the raw string.
 */
export function dayOf(value?: string | null): string {
  if (!value) return '';
  const d = new Date(value);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

/** yyyy-mm-dd for <input type="date">. */
export function toDayInput(value?: string | null): string {
  return dayOf(value);
}

/** Today's date as yyyy-mm-dd in UTC, matching how due dates are stored. */
export function todayDay(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isOverdue(w: Pick<WorkItem, 'due_date' | 'state'>): boolean {
  return !!w.due_date && w.state !== 'done' && w.state !== 'cancelled' && dayOf(w.due_date) < todayDay();
}

/** Sort order for a card dropped between two neighbours. */
export function sortBetween(before?: number, after?: number): number {
  if (before === undefined && after === undefined) return 65535;
  if (before === undefined) return (after as number) - 65535;
  if (after === undefined) return before + 65535;
  return (before + after) / 2;
}
