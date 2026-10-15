'use client';

import * as React from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Maximize2, Minimize2, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WorkItem, WorkItemState } from '@/lib/itsm/types';
import { WORK_ITEM_STATES, sortBetween } from '@/lib/itsm/projects';
import { StateIcon } from './icons';
import { WorkItemCard, type CardContext } from './work-item-card';
import type { WorkItemPatch } from './hooks';

type Columns = Record<string, string[]>;

const COL_PREFIX = 'col:';

function group(items: WorkItem[], states: WorkItemState[]): Columns {
  const cols: Columns = {};
  states.forEach((s) => (cols[s] = []));
  items.forEach((w) => cols[w.state]?.push(w.id));
  return cols;
}

export function Board({ items, ctx, states, manualOrder, collapsed, onToggleCollapse, onQuickAdd }: {
  items: WorkItem[];
  ctx: CardContext;
  states: WorkItemState[];
  manualOrder: boolean;
  collapsed: string[];
  onToggleCollapse: (state: string) => void;
  onQuickAdd: (state: WorkItemState, title: string) => Promise<unknown>;
}) {
  const byId = React.useMemo(() => new Map(items.map((w) => [w.id, w])), [items]);
  const [columns, setColumns] = React.useState<Columns>(() => group(items, states));
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const startState = React.useRef<string | null>(null);
  const editable = ctx.project.can_edit;

  React.useEffect(() => {
    if (!activeId) setColumns(group(items, states));
  }, [items, states, activeId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    })
  );

  const containerOf = (id: string): string | undefined => {
    if (id.startsWith(COL_PREFIX)) return id.slice(COL_PREFIX.length);
    return Object.keys(columns).find((k) => columns[k].includes(id));
  };

  const onDragStart = (e: DragStartEvent) => {
    const id = String(e.active.id);
    setActiveId(id);
    startState.current = containerOf(id) ?? null;
  };

  const onDragOver = (e: DragOverEvent) => {
    if (!e.over) return;
    const activeKey = String(e.active.id);
    const overKey = String(e.over.id);
    const from = containerOf(activeKey);
    const to = containerOf(overKey);
    if (!from || !to || from === to) return;
    setColumns((cols) => {
      const fromList = cols[from].filter((id) => id !== activeKey);
      const toList = [...cols[to]];
      const overIndex = toList.indexOf(overKey);
      toList.splice(overIndex >= 0 ? overIndex : toList.length, 0, activeKey);
      return { ...cols, [from]: fromList, [to]: toList };
    });
  };

  const onDragEnd = (e: DragEndEvent) => {
    const id = String(e.active.id);
    const item = byId.get(id);
    setActiveId(null);
    if (!e.over || !item) {
      setColumns(group(items, states));
      return;
    }
    const container = containerOf(String(e.over.id)) ?? containerOf(id);
    if (!container) return;
    let list = columns[container];
    const overIndex = list.indexOf(String(e.over.id));
    const activeIndex = list.indexOf(id);
    if (activeIndex >= 0 && overIndex >= 0 && activeIndex !== overIndex) {
      list = arrayMove(list, activeIndex, overIndex);
      setColumns((cols) => ({ ...cols, [container]: list }));
    }
    const patch: WorkItemPatch = {};
    if (container !== item.state) patch.state = container;
    if (manualOrder) {
      const i = list.indexOf(id);
      const before = i > 0 ? byId.get(list[i - 1])?.sort_order : undefined;
      const after = i < list.length - 1 ? byId.get(list[i + 1])?.sort_order : undefined;
      const order = sortBetween(before, after);
      const sameSpot = container === item.state && (activeIndex === overIndex || overIndex < 0);
      if (!sameSpot || patch.state) patch.sort_order = order;
    }
    if (Object.keys(patch).length) ctx.onPatch(item, patch);
  };

  const activeItem = activeId ? byId.get(activeId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setActiveId(null);
        setColumns(group(items, states));
      }}
    >
      <div className="flex h-[calc(100vh-230px)] min-h-[440px] gap-3 overflow-x-auto pb-3">
        {states.map((s) => (
          <Column
            key={s}
            state={s}
            ids={columns[s] ?? []}
            byId={byId}
            ctx={ctx}
            editable={editable}
            collapsed={collapsed.includes(s)}
            onToggle={() => onToggleCollapse(s)}
            onQuickAdd={(title) => onQuickAdd(s, title)}
            isDropTarget={!!activeId && startState.current !== s && containerOf(activeId) === s}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>{activeItem ? <WorkItemCard item={activeItem} ctx={ctx} overlay className="w-[300px]" /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({ state, ids, byId, ctx, editable, collapsed, onToggle, onQuickAdd, isDropTarget }: {
  state: WorkItemState;
  ids: string[];
  byId: Map<string, WorkItem>;
  ctx: CardContext;
  editable: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onQuickAdd: (title: string) => Promise<unknown>;
  isDropTarget: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: COL_PREFIX + state });
  const label = WORK_ITEM_STATES.find((x) => x.value === state)?.label ?? state;
  const [adding, setAdding] = React.useState(false);

  if (collapsed) {
    return (
      <div
        ref={setNodeRef}
        className={cn('flex w-11 shrink-0 flex-col items-center gap-3 rounded-lg bg-slate-100/70 py-3', isOver && 'bg-blue-50 ring-2 ring-blue-300')}
      >
        <button onClick={onToggle} aria-label={`Expand ${label}`} title={`Expand ${label}`} className="rounded p-1 text-slate-500 hover:bg-white">
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
        <StateIcon state={state} />
        <span className="text-xs text-slate-500">{ids.length}</span>
        <span className="text-sm font-medium text-slate-700 [writing-mode:vertical-rl]">{label}</span>
      </div>
    );
  }

  return (
    <section
      aria-label={`${label} column`}
      className={cn('flex w-[310px] shrink-0 flex-col rounded-lg bg-slate-100/70 transition-colors', (isOver || isDropTarget) && 'bg-blue-50/80 ring-2 ring-blue-200')}
    >
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <StateIcon state={state} />
        <h3 className="text-sm font-semibold text-slate-800">{label}</h3>
        <span className="text-xs text-slate-500">{ids.length}</span>
        <div className="ml-auto flex items-center gap-0.5">
          <button onClick={onToggle} aria-label={`Collapse ${label}`} title="Collapse" className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700">
            <Minimize2 className="h-3.5 w-3.5" />
          </button>
          {editable && (
            <button onClick={() => setAdding(true)} aria-label={`Add to ${label}`} title={`Add to ${label}`} className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-700">
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
      </header>
      <div ref={setNodeRef} className="flex min-h-[60px] flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {ids.map((id) => {
            const item = byId.get(id);
            return item ? <SortableCard key={id} item={item} ctx={ctx} disabled={!editable} /> : null;
          })}
        </SortableContext>
        {editable && <QuickAdd open={adding} onOpenChange={setAdding} onCreate={onQuickAdd} />}
      </div>
    </section>
  );
}

function SortableCard({ item, ctx, disabled }: { item: WorkItem; ctx: CardContext; disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled });
  return (
    <WorkItemCard
      ref={setNodeRef}
      item={item}
      ctx={ctx}
      dragging={isDragging}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      aria-label={`${item.display_id} ${item.title}`}
      aria-roledescription="draggable work item"
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) {
          ctx.onOpen(item.id);
          return;
        }
        listeners?.onKeyDown?.(e);
      }}
    />
  );
}

/** Inline "New work item" row: Enter creates and keeps the field open for the next one. */
export function QuickAdd({ open, onOpenChange, onCreate, className }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (title: string) => Promise<unknown>;
  className?: string;
}) {
  const [title, setTitle] = React.useState('');
  const [busy, setBusy] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  if (!open) {
    return (
      <button
        onClick={() => onOpenChange(true)}
        className={cn('flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm text-slate-600 hover:bg-white hover:text-slate-900', className)}
      >
        <Plus className="h-4 w-4" /> New work item
      </button>
    );
  }
  const submit = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await onCreate(t);
      setTitle('');
    } catch {
      // The error toast is shown by the mutation; keep the title for a retry.
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  };
  return (
    <div className={cn('rounded-lg border border-blue-300 bg-white p-2 shadow-sm', className)}>
      <input
        ref={inputRef}
        autoFocus
        value={title}
        // readOnly (not disabled) keeps keyboard focus while saving.
        readOnly={busy}
        aria-busy={busy}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            submit();
          }
          if (e.key === 'Escape') {
            setTitle('');
            onOpenChange(false);
          }
        }}
        onBlur={() => {
          if (!title.trim()) onOpenChange(false);
        }}
        placeholder="Work item title"
        aria-label="New work item title"
        className="w-full bg-transparent px-1 py-1 text-sm outline-none placeholder:text-slate-400"
      />
      <div className="mt-1 px-1 text-[11px] text-slate-400">Press Enter to add, Esc to close</div>
    </div>
  );
}
