'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DndContext, DragOverlay, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { v2, parseApiError } from '@/lib/itsm/api';
import { fmtDateTime, shortDue, timeAgo } from '@/lib/itsm/format';
import type { Ticket } from '@/lib/itsm/types';
import { Avatar, PriorityBadge, SLABadge } from './kit';
import { celebrate } from '@/lib/theme';

const STATUS_DOT: Record<string, string> = {
  open: 'bg-blue-500',
  pending: 'bg-amber-500',
  resolved: 'bg-emerald-500',
  closed: 'bg-slate-400',
};

/** Kanban view of tickets grouped by status; dropping a card changes its status. */
export function TicketBoard({ items, statuses, canEdit }: { items: Ticket[]; statuses: { value: string; label: string }[]; canEdit: boolean }) {
  const qc = useQueryClient();
  // Optimistic status overrides until the list refetches.
  const [moved, setMoved] = React.useState<Record<string, string>>({});
  const [activeId, setActiveId] = React.useState<string | null>(null);
  React.useEffect(() => setMoved({}), [items]);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));

  const move = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => v2.put(`/tickets/${id}`, { status }),
    onError: (e, vars) => {
      setMoved((m) => {
        const next = { ...m };
        delete next[vars.id];
        return next;
      });
      toast.error(parseApiError(e).message);
    },
    onSuccess: (_d, vars) => {
      toast.success(`Moved to ${statuses.find((s) => s.value === vars.status)?.label ?? vars.status}`);
      if (vars.status === 'resolved' || vars.status === 'closed') celebrate();
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['tickets'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const statusOf = (t: Ticket) => moved[t.id] ?? t.status;
  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const id = String(e.active.id);
    const target = e.over ? String(e.over.id) : null;
    const t = items.find((x) => x.id === id);
    if (!t || !target || target === statusOf(t)) return;
    setMoved((m) => ({ ...m, [id]: target }));
    move.mutate({ id, status: target });
  };
  const active = activeId ? items.find((t) => t.id === activeId) : undefined;
  const known = new Set(statuses.map((s) => s.value));
  const columns = [...statuses, ...Array.from(new Set(items.map((t) => t.status).filter((s) => !known.has(s)))).map((s) => ({ value: s, label: s }))];

  return (
    <DndContext sensors={sensors} onDragStart={(e) => setActiveId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      <div className="flex h-[calc(100vh-260px)] min-h-[420px] gap-3 overflow-x-auto p-3">
        {columns.map((s) => {
          const list = items.filter((t) => statusOf(t) === s.value);
          return (
            <Column key={s.value} status={s.value} label={s.label} count={list.length}>
              {list.map((t) => (
                <DraggableTicket key={t.id} ticket={t} disabled={!canEdit} hidden={t.id === activeId} />
              ))}
            </Column>
          );
        })}
      </div>
      <DragOverlay dropAnimation={null}>{active ? <TicketCard ticket={active} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({ status, label, count, children }: { status: string; label: string; count: number; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section aria-label={`${label} tickets`} className={cn('flex w-[300px] shrink-0 flex-col rounded-lg bg-slate-100/70', isOver && 'bg-blue-50 ring-2 ring-blue-200')}>
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <span className={cn('h-2.5 w-2.5 rounded-full', STATUS_DOT[status] ?? 'bg-violet-500')} />
        <h3 className="text-sm font-semibold text-slate-800">{label}</h3>
        <span className="text-xs text-slate-500">{count}</span>
      </header>
      <div ref={setNodeRef} className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        {children}
        {count === 0 && <div className="rounded-md border border-dashed border-slate-300 px-3 py-6 text-center text-xs text-slate-400">Drop tickets here</div>}
      </div>
    </section>
  );
}

function DraggableTicket({ ticket, disabled, hidden }: { ticket: Ticket; disabled: boolean; hidden: boolean }) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({ id: ticket.id, disabled });
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Translate.toString(transform) }} className={cn(hidden && 'opacity-40')} {...attributes} {...listeners}>
      <TicketCard ticket={ticket} />
    </div>
  );
}

function TicketCard({ ticket: t, overlay }: { ticket: Ticket; overlay?: boolean }) {
  const router = useRouter();
  const done = t.status === 'resolved' || t.status === 'closed';
  return (
    <div
      onClick={() => router.push(`/tickets/${t.id}`)}
      className={cn('cursor-pointer rounded-lg border border-slate-200 bg-white p-3 shadow-sm hover:border-slate-300 hover:shadow', overlay && 'w-[280px] rotate-1 shadow-xl ring-1 ring-blue-200')}
    >
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase', t.type === 'incident' ? 'bg-rose-50 text-rose-700' : 'bg-violet-50 text-violet-700')}>
          {t.type === 'incident' ? 'INC' : 'SR'}
        </span>
        <span className="font-medium">{t.display_id}</span>
        <span className="ml-auto" title={fmtDateTime(t.created_at)}>{timeAgo(t.created_at)}</span>
      </div>
      <Link href={`/tickets/${t.id}`} onClick={(e) => e.stopPropagation()} className="mt-1 line-clamp-2 block text-sm font-medium leading-snug text-slate-900 hover:text-blue-700">
        {t.subject}
      </Link>
      <div className="mt-1 truncate text-xs text-slate-500">{t.requester?.name ?? 'Unknown requester'}{t.group ? ` · ${t.group.name}` : ''}</div>
      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <PriorityBadge priority={t.priority} compact />
        {!done && <SLABadge state={t.sla_state} />}
        {!done && t.due_by && <span className="text-[11px] text-slate-500" title={fmtDateTime(t.due_by)}>{shortDue(t.due_by)}</span>}
        <span className="ml-auto">{t.responder ? <span title={t.responder.name}><Avatar name={t.responder.name} src={t.responder.avatar_url} size="xs" /></span> : <span className="text-[11px] text-slate-400">Unassigned</span>}</span>
      </div>
    </div>
  );
}
