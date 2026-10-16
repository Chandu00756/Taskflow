'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, X } from 'lucide-react';
import { v2 } from '@/lib/itsm/api';
import type { Person } from '@/lib/itsm/types';
import { cn } from '@/lib/utils';
import { Avatar, FloatingPanel } from './kit';
import { useAgents, useGroups, useDepartments } from '@/lib/itsm/hooks';

/** Searchable picker over agents and/or requesters. */
export function PersonPicker({ value, onChange, kind = 'all', placeholder = 'Search people…', allowClear = true, className, initialLabel }: {
  value: string | null | undefined;
  onChange: (id: string | null, person?: Person) => void;
  kind?: 'agents' | 'requesters' | 'all';
  placeholder?: string;
  allowClear?: boolean;
  className?: string;
  initialLabel?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [label, setLabel] = React.useState<string | undefined>(initialLabel);
  const ref = React.useRef<HTMLDivElement>(null);
  const close = React.useCallback(() => setOpen(false), []);
  const debounced = useDebounced(q, 200);
  const { data, isFetching } = useQuery({
    queryKey: ['people-search', kind, debounced],
    enabled: open,
    queryFn: async () => {
      const params = { q: debounced, per_page: 20 };
      if (kind === 'agents') return (await v2.list<Person>('/agents', params)).items;
      if (kind === 'requesters') return (await v2.list<Person>('/requesters', params)).items;
      const [a, r] = await Promise.all([v2.list<Person>('/agents', params), v2.list<Person>('/requesters', params)]);
      return [...a.items, ...r.items];
    },
  });
  const agents = useAgents();
  React.useEffect(() => {
    if (initialLabel) setLabel(initialLabel);
  }, [initialLabel]);
  React.useEffect(() => {
    if (value && !label) {
      const hit = agents.data?.find((a) => a.id === value);
      if (hit) setLabel(hit.name);
    }
    if (!value) setLabel(undefined);
  }, [value, label, agents.data]);
  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-md border border-slate-300 bg-white px-3 text-left text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
      >
        <span className={cn('flex min-w-0 items-center gap-2', !value && 'text-slate-400')}>
          {value && label && <Avatar name={label} size="xs" />}
          <span className="truncate">{value ? label ?? 'Selected' : placeholder}</span>
        </span>
        <span className="flex items-center gap-1">
          {value && allowClear && (
            <span
              role="button"
              aria-label="Clear"
              onClick={(e) => {
                e.stopPropagation();
                onChange(null);
                setLabel(undefined);
              }}
              className="rounded p-0.5 text-slate-400 hover:text-slate-700"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
          <ChevronDown className="h-4 w-4 text-slate-400" />
        </span>
      </button>
      <FloatingPanel anchorRef={ref} open={open} onClose={close}>
        <div className="border-b border-slate-100 p-2">
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name or email…" className="w-full rounded border border-slate-200 px-2 py-1.5 text-sm focus:outline-none" />
        </div>
        <div className="max-h-64 overflow-y-auto py-1">
          {isFetching && !data && <div className="px-3 py-2 text-sm text-slate-500">Searching…</div>}
          {data?.length === 0 && <div className="px-3 py-2 text-sm text-slate-500">No people found</div>}
          {data?.map((p) => (
            <button
              type="button"
              key={p.id}
              onClick={() => {
                onChange(p.id, p);
                setLabel(p.name);
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-slate-50"
            >
              <Avatar name={p.name} src={p.avatar_url} size="sm" />
              <span className="min-w-0">
                <span className="block truncate text-sm text-slate-800">{p.name}</span>
                <span className="block truncate text-xs text-slate-500">
                  {p.email}
                  {p.is_agent ? ' · Agent' : ''}
                </span>
              </span>
            </button>
          ))}
        </div>
      </FloatingPanel>
    </div>
  );
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = React.useState(value);
  React.useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Options for selects backed by cached lookups. */
export function useAgentOptions() {
  const { data } = useAgents();
  return React.useMemo(() => (data ?? []).filter((a) => a.active).map((a) => ({ value: a.id, label: a.name })), [data]);
}

export function useGroupOptions() {
  const { data } = useGroups();
  return React.useMemo(() => (data ?? []).map((g) => ({ value: g.id, label: g.name })), [data]);
}

export function useDepartmentOptions() {
  const { data } = useDepartments();
  // Units arrive in tree order; indent children so the hierarchy reads in selects.
  return React.useMemo(() => (data ?? []).map((d) => ({ value: d.id, label: `${'— '.repeat(d.depth ?? 0)}${d.name}` })), [data]);
}
