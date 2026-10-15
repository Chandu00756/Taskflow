'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, Check, CircleDot, Plus, Search, Tag, UserRound, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Cycle, UserBrief, WorkItemPriority, WorkItemState } from '@/lib/itsm/types';
import { WORK_ITEM_PRIORITIES, WORK_ITEM_STATES, fmtDay, toDayInput } from '@/lib/itsm/projects';
import { Avatar } from '@/components/desk/kit';
import { PriorityIcon, StateIcon } from './icons';

// ---------------------------------------------------------------------------
// Popover anchored to a trigger, rendered in a portal so scroll containers
// (board columns, drawers) never clip it.
// ---------------------------------------------------------------------------

function usePopover() {
  const [open, setOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const panelRef = React.useRef<HTMLDivElement>(null);
  const [pos, setPos] = React.useState<{ top: number; left: number; flip: boolean }>({ top: 0, left: 0, flip: false });

  const place = React.useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const flip = window.innerHeight - r.bottom < 300 && r.top > 300;
    const left = Math.min(r.left, window.innerWidth - 272);
    setPos({ top: flip ? r.top - 4 : r.bottom + 4, left: Math.max(8, left), flip });
  }, []);

  React.useEffect(() => {
    if (!open) return;
    place();
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || triggerRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      // Mark the key as handled so an enclosing panel stays open.
      e.preventDefault();
      setOpen(false);
    };
    const onScroll = (e: Event) => {
      if (panelRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', place);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', place);
    };
  }, [open, place]);

  return { open, setOpen, triggerRef, panelRef, pos };
}

function Panel({ pop, children, width = 256 }: { pop: ReturnType<typeof usePopover>; children: React.ReactNode; width?: number }) {
  if (!pop.open || typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={pop.panelRef}
      // Portals bubble React events to the card; keep clicks inside the menu.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{ position: 'fixed', top: pop.pos.top, left: pop.pos.left, width, transform: pop.pos.flip ? 'translateY(-100%)' : undefined }}
      className="menu-panel z-[60] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl"
    >
      {children}
    </div>,
    document.body
  );
}

const chipBase =
  'inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-white';
const fieldBase =
  'flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 disabled:cursor-default disabled:hover:bg-transparent';

type Variant = 'chip' | 'field' | 'icon';

function Trigger({
  pop, variant, disabled, children, label, className,
}: { pop: ReturnType<typeof usePopover>; variant: Variant; disabled?: boolean; children: React.ReactNode; label: string; className?: string }) {
  return (
    <button
      ref={pop.triggerRef}
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        pop.setOpen((v) => !v);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(variant === 'chip' && chipBase, variant === 'field' && fieldBase, variant === 'icon' && 'rounded p-0.5 hover:bg-slate-100', className)}
    >
      {children}
    </button>
  );
}

interface Opt {
  value: string;
  label: string;
  icon?: React.ReactNode;
  hint?: string;
}

function OptionList({ options, selected, onPick, searchable, placeholder = 'Search…', multi, footer }: {
  options: Opt[];
  selected: string[];
  onPick: (v: string) => void;
  searchable?: boolean;
  placeholder?: string;
  multi?: boolean;
  footer?: (q: string) => React.ReactNode;
}) {
  const [q, setQ] = React.useState('');
  const shown = options.filter((o) => !q || o.label.toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      {searchable && (
        <div className="flex items-center gap-2 border-b border-slate-100 px-2.5 py-2">
          <Search className="h-3.5 w-3.5 text-slate-400" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400" />
        </div>
      )}
      <ul className="max-h-64 overflow-y-auto py-1" role="listbox" aria-multiselectable={multi}>
        {shown.map((o) => {
          const active = selected.includes(o.value);
          return (
            <li key={o.value}>
              <button
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => onPick(o.value)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-50"
              >
                {o.icon}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint && <span className="text-xs text-slate-400">{o.hint}</span>}
                {active && <Check className="h-3.5 w-3.5 text-blue-600" />}
              </button>
            </li>
          );
        })}
        {shown.length === 0 && !footer && <li className="px-2.5 py-2 text-sm text-slate-400">No matches</li>}
      </ul>
      {footer?.(q)}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Property selects
// ---------------------------------------------------------------------------

export function StateSelect({ value, onChange, disabled, variant = 'chip' }: { value: WorkItemState; onChange: (v: WorkItemState) => void; disabled?: boolean; variant?: Variant }) {
  const pop = usePopover();
  const current = WORK_ITEM_STATES.find((s) => s.value === value);
  return (
    <>
      <Trigger pop={pop} variant={variant} disabled={disabled} label={`State: ${current?.label ?? value}`}>
        <StateIcon state={value} className={variant === 'chip' ? 'h-3.5 w-3.5' : undefined} />
        {variant !== 'icon' && <span className="truncate">{current?.label}</span>}
      </Trigger>
      <Panel pop={pop} width={200}>
        <OptionList
          options={WORK_ITEM_STATES.map((s) => ({ value: s.value, label: s.label, icon: <StateIcon state={s.value} /> }))}
          selected={[value]}
          onPick={(v) => {
            pop.setOpen(false);
            if (v !== value) onChange(v as WorkItemState);
          }}
        />
      </Panel>
    </>
  );
}

export function PrioritySelect({ value, onChange, disabled, variant = 'chip' }: { value: WorkItemPriority; onChange: (v: WorkItemPriority) => void; disabled?: boolean; variant?: Variant }) {
  const pop = usePopover();
  const current = WORK_ITEM_PRIORITIES.find((p) => p.value === value);
  return (
    <>
      <Trigger pop={pop} variant={variant} disabled={disabled} label={`Priority: ${current?.label ?? value}`}>
        <PriorityIcon priority={value} className={variant === 'chip' ? 'h-3.5 w-3.5' : undefined} />
        {variant !== 'icon' && <span className={cn('truncate', value === 'none' && variant === 'chip' && 'text-slate-400')}>{value === 'none' && variant === 'chip' ? 'Priority' : current?.label}</span>}
      </Trigger>
      <Panel pop={pop} width={190}>
        <OptionList
          options={WORK_ITEM_PRIORITIES.map((p) => ({ value: p.value, label: p.label, icon: <PriorityIcon priority={p.value} /> }))}
          selected={[value]}
          onPick={(v) => {
            pop.setOpen(false);
            if (v !== value) onChange(v as WorkItemPriority);
          }}
        />
      </Panel>
    </>
  );
}

export function AssigneeSelect({ value, onChange, members, disabled, variant = 'chip' }: {
  value: UserBrief | null;
  onChange: (id: string) => void;
  members: UserBrief[];
  disabled?: boolean;
  variant?: Variant;
}) {
  const pop = usePopover();
  const label = value ? `Assignee: ${value.name}` : 'Assignee';
  return (
    <>
      <Trigger pop={pop} variant={variant} disabled={disabled} label={label} className={variant === 'icon' ? 'rounded-full p-0' : undefined}>
        {value ? <Avatar name={value.name} src={value.avatar_url} size="xs" /> : <UserRound className="h-3.5 w-3.5 text-slate-400" />}
        {variant === 'field' && <span className={cn('truncate', !value && 'text-slate-400')}>{value?.name ?? 'Unassigned'}</span>}
        {variant === 'chip' && <span className={cn('truncate', !value && 'text-slate-400')}>{value?.name ?? 'Assignee'}</span>}
      </Trigger>
      <Panel pop={pop}>
        <OptionList
          searchable
          placeholder="Search members…"
          options={[
            { value: '', label: 'Unassigned', icon: <UserRound className="h-4 w-4 text-slate-400" /> },
            ...members.map((m) => ({ value: m.id, label: m.name, icon: <Avatar name={m.name} src={m.avatar_url} size="xs" />, hint: m.active === false ? 'inactive' : undefined })),
          ]}
          selected={[value?.id ?? '']}
          onPick={(v) => {
            pop.setOpen(false);
            if (v !== (value?.id ?? '')) onChange(v);
          }}
        />
      </Panel>
    </>
  );
}

export function CycleSelect({ value, onChange, cycles, disabled, variant = 'chip' }: {
  value: { id: string; name: string } | null;
  onChange: (id: string) => void;
  cycles: Cycle[];
  disabled?: boolean;
  variant?: Variant;
}) {
  const pop = usePopover();
  const open = cycles.filter((c) => c.status !== 'completed' || c.id === value?.id);
  return (
    <>
      <Trigger pop={pop} variant={variant} disabled={disabled} label={value ? `Cycle: ${value.name}` : 'Cycle'}>
        <CircleDot className={cn('h-3.5 w-3.5', value ? 'text-violet-600' : 'text-slate-400')} />
        {variant !== 'icon' && <span className={cn('truncate', !value && 'text-slate-400')}>{value?.name ?? (variant === 'field' ? 'No cycle' : 'Cycle')}</span>}
      </Trigger>
      <Panel pop={pop}>
        <OptionList
          searchable={cycles.length > 6}
          options={[
            { value: '', label: 'No cycle', icon: <CircleDot className="h-4 w-4 text-slate-300" /> },
            ...open.map((c) => ({ value: c.id, label: c.name, icon: <CircleDot className="h-4 w-4 text-violet-600" />, hint: c.status === 'current' ? 'current' : c.status === 'upcoming' ? 'upcoming' : undefined })),
          ]}
          selected={[value?.id ?? '']}
          onPick={(v) => {
            pop.setOpen(false);
            if (v !== (value?.id ?? '')) onChange(v);
          }}
        />
      </Panel>
    </>
  );
}

export function DateSelect({ value, onChange, label, disabled, variant = 'chip', tone }: {
  value: string | null;
  onChange: (v: string) => void;
  label: string;
  disabled?: boolean;
  variant?: Variant;
  tone?: 'overdue';
}) {
  const pop = usePopover();
  const [draft, setDraft] = React.useState(toDayInput(value));
  React.useEffect(() => setDraft(toDayInput(value)), [value, pop.open]);
  const text = value ? fmtDay(value, true) : label;
  return (
    <>
      <Trigger pop={pop} variant={variant} disabled={disabled} label={value ? `${label}: ${text}` : label}>
        <CalendarDays className={cn('h-3.5 w-3.5', tone === 'overdue' ? 'text-rose-600' : value ? 'text-slate-500' : 'text-slate-400')} />
        <span className={cn('truncate', !value && 'text-slate-400', tone === 'overdue' && 'text-rose-600')}>{text}</span>
      </Trigger>
      <Panel pop={pop} width={232}>
        <div className="space-y-2 p-3">
          <div className="text-xs font-medium text-slate-500">{label}</div>
          <input
            type="date"
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                pop.setOpen(false);
                onChange(draft);
              }
            }}
            className="h-9 w-full rounded-md border border-slate-300 px-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
          <div className="flex justify-between">
            <button
              type="button"
              onClick={() => {
                pop.setOpen(false);
                if (value) onChange('');
              }}
              className="text-xs text-slate-500 hover:text-rose-600"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => {
                pop.setOpen(false);
                if (draft !== toDayInput(value)) onChange(draft);
              }}
              className="rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
            >
              Apply
            </button>
          </div>
        </div>
      </Panel>
    </>
  );
}

export function LabelsSelect({ value, onChange, suggestions, disabled, variant = 'chip' }: {
  value: string[];
  onChange: (v: string[]) => void;
  suggestions: string[];
  disabled?: boolean;
  variant?: Variant;
}) {
  const pop = usePopover();
  const all = Array.from(new Set([...suggestions, ...value])).sort();
  const toggle = (l: string) => onChange(value.includes(l) ? value.filter((x) => x !== l) : [...value, l]);
  return (
    <>
      <Trigger pop={pop} variant={variant} disabled={disabled} label={value.length ? `Labels: ${value.join(', ')}` : 'Labels'} className={variant === 'field' ? 'h-auto min-h-8 flex-wrap py-1' : undefined}>
        <Tag className={cn('h-3.5 w-3.5 shrink-0', value.length ? 'text-slate-500' : 'text-slate-400')} />
        {variant === 'chip' && value.length > 0 && <span className="truncate">{value.length === 1 ? value[0] : `${value.length} labels`}</span>}
        {variant === 'field' &&
          (value.length ? (
            value.map((l) => (
              <span key={l} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                {l}
              </span>
            ))
          ) : (
            <span className="text-slate-400">No labels</span>
          ))}
      </Trigger>
      <Panel pop={pop}>
        <OptionList
          searchable
          multi
          placeholder="Search or create…"
          options={all.map((l) => ({ value: l, label: l, icon: <span className="h-2 w-2 rounded-full bg-slate-400" /> }))}
          selected={value}
          onPick={toggle}
          footer={(q) => {
            const name = q.trim().toLowerCase();
            if (!name || all.includes(name)) return null;
            return (
              <button type="button" onClick={() => toggle(name)} className="flex w-full items-center gap-2 border-t border-slate-100 px-2.5 py-2 text-left text-sm text-blue-700 hover:bg-slate-50">
                <Plus className="h-3.5 w-3.5" /> Create “{name}”
              </button>
            );
          }}
        />
      </Panel>
    </>
  );
}

export function ClearableChip({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex h-7 items-center gap-1 rounded-md border border-blue-200 bg-blue-50 pl-2 pr-1 text-xs text-blue-800">
      {children}
      <button type="button" onClick={onClear} aria-label="Remove filter" className="rounded p-0.5 hover:bg-blue-100">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
