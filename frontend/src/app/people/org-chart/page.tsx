'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, GitBranch, Search } from 'lucide-react';
import { Avatar, Badge, Card, EmptyState, ErrorBlock, LinkBtn, LoadingBlock, PageHeader, SelectBox, TextInput } from '@/components/desk/kit';
import { useDepartmentOptions } from '@/components/desk/pickers';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useCan } from '@/lib/itsm/hooks';
import type { OrgChartPerson } from '@/lib/itsm/types';
import { cn } from '@/lib/utils';

type Tree = Map<string | null, OrgChartPerson[]>;

function PersonCard({ p, reports, open, onToggle, highlight }: { p: OrgChartPerson; reports: number; open: boolean; onToggle: () => void; highlight: boolean }) {
  return (
    <div id={`person-${p.id}`} className={cn('card-panel relative w-56 rounded-xl border bg-white p-3 shadow-sm transition', highlight ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-slate-200 hover:border-blue-300')}>
      <Link href={`/people/${p.id}`} className="flex items-center gap-2.5">
        <Avatar name={p.name} src={p.avatar_url} size="md" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-slate-900">{p.name}</span>
          <span className="block truncate text-xs text-slate-500">{p.job_title || p.job_role?.name || (p.is_agent ? 'Agent' : 'Requester')}</span>
        </span>
      </Link>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-slate-500">
        {p.job_role && <Badge className="bg-blue-50 text-blue-700 ring-blue-600/20">L{p.job_role.level}</Badge>}
        <span className="truncate">{p.department?.name ?? ''}</span>
      </div>
      {reports > 0 && (
        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? `Hide ${p.name}'s reports` : `Show ${p.name}'s ${reports} reports`}
          className="absolute -bottom-3 left-1/2 flex h-6 -translate-x-1/2 items-center gap-0.5 rounded-full border border-slate-200 bg-white px-2 text-[11px] font-medium text-slate-600 shadow-sm hover:text-blue-600"
        >
          {reports}
          {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      )}
    </div>
  );
}

function Node({ p, tree, depth, expanded, toggle, highlight }: { p: OrgChartPerson; tree: Tree; depth: number; expanded: Record<string, boolean>; toggle: (id: string) => void; highlight: string | null }) {
  const kids = tree.get(p.id) ?? [];
  const open = expanded[p.id] ?? depth < 2;
  return (
    <div className="flex flex-col items-center">
      <PersonCard p={p} reports={kids.length} open={open} onToggle={() => toggle(p.id)} highlight={highlight === p.id} />
      {open && kids.length > 0 && (
        <>
          <div className="h-6 w-px bg-slate-300" />
          <div className="flex">
            {kids.map((c, i) => (
              // Each child draws its half of the connector so widths can differ.
              <div key={c.id} className="relative flex flex-col items-center px-3">
                {i > 0 && <div className="absolute left-0 right-1/2 top-0 h-px bg-slate-300" />}
                {i < kids.length - 1 && <div className="absolute left-1/2 right-0 top-0 h-px bg-slate-300" />}
                <div className="h-5 w-px bg-slate-300" />
                <Node p={c} tree={tree} depth={depth + 1} expanded={expanded} toggle={toggle} highlight={highlight} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function PeopleOrgChartPage() {
  const can = useCan();
  const deptOptions = useDepartmentOptions();
  const [dept, setDept] = React.useState('');
  const [agentsOnly, setAgentsOnly] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});
  const [highlight, setHighlight] = React.useState<string | null>(null);
  const q = useQuery({ queryKey: ['org-chart-people', dept], queryFn: () => v2.items<OrgChartPerson>('/org-chart/people', dept ? { department_id: dept } : undefined) });

  const people = React.useMemo(() => {
    const all = q.data ?? [];
    if (!agentsOnly) return all;
    const keep = new Set(all.filter((p) => p.is_agent).map((p) => p.id));
    return all.filter((p) => keep.has(p.id)).map((p) => (p.manager_id && keep.has(p.manager_id) ? p : { ...p, manager_id: null }));
  }, [q.data, agentsOnly]);
  const tree = React.useMemo(() => {
    const t: Tree = new Map();
    people.forEach((p) => t.set(p.manager_id, [...(t.get(p.manager_id) ?? []), p]));
    return t;
  }, [people]);
  const roots = (tree.get(null) ?? []).filter((p) => (tree.get(p.id) ?? []).length > 0);
  const unplaced = (tree.get(null) ?? []).filter((p) => (tree.get(p.id) ?? []).length === 0);

  const find = () => {
    const needle = query.trim().toLowerCase();
    if (!needle) return;
    const hit = people.find((p) => p.name.toLowerCase().includes(needle) || p.email.toLowerCase().includes(needle));
    if (!hit) return setHighlight(null);
    // Open every manager above the person, then scroll to them.
    const byId = new Map(people.map((p) => [p.id, p]));
    const open: Record<string, boolean> = {};
    for (let m = hit.manager_id; m; m = byId.get(m)?.manager_id ?? null) open[m] = true;
    setExpanded((e) => ({ ...e, ...open }));
    setHighlight(hit.id);
    setTimeout(() => document.getElementById(`person-${hit.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' }), 60);
  };

  return (
    <>
      <PageHeader
        title="People org chart"
        subtitle="Reporting lines across the organization, ordered by job role seniority."
        icon={<GitBranch className="h-5 w-5" />}
        actions={can('users.manage') ? <LinkBtn href="/admin/job-roles">Job roles</LinkBtn> : undefined}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form
          className="relative"
          onSubmit={(e) => {
            e.preventDefault();
            find();
          }}
        >
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <TextInput value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a person and press Enter" className="w-72 pl-8" aria-label="Find a person" />
        </form>
        <SelectBox aria-label="Org unit" value={dept} onChange={setDept} className="w-56" placeholder="All org units" options={[{ value: '', label: 'All org units' }, ...deptOptions]} />
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <input type="checkbox" checked={agentsOnly} onChange={(e) => setAgentsOnly(e.target.checked)} /> Agents only
        </label>
        <span className="text-xs text-slate-500">{people.length} people</span>
      </div>
      {q.isLoading ? (
        <LoadingBlock />
      ) : q.isError ? (
        <ErrorBlock message={parseApiError(q.error).message} onRetry={() => q.refetch()} />
      ) : people.length === 0 ? (
        <EmptyState title="Nobody to show" description="Add people, or choose a different org unit." />
      ) : (
        <div className="space-y-5">
          {roots.length > 0 ? (
            <Card padded={false}>
              <div className="overflow-x-auto p-6 pb-8">
                <div className="flex min-w-max justify-center gap-10">
                  {roots.map((r) => (
                    <Node key={r.id} p={r} tree={tree} depth={0} expanded={expanded} toggle={(id) => setExpanded((e) => ({ ...e, [id]: !(e[id] ?? true) }))} highlight={highlight} />
                  ))}
                </div>
              </div>
            </Card>
          ) : (
            <Card>
              <p className="text-sm text-slate-600">Nobody has a reporting manager yet. Set <strong>Reporting manager</strong> (and a <strong>Job role</strong>) on agents and requesters to build the chart.</p>
            </Card>
          )}
          {unplaced.length > 0 && (
            <Card title={`Not in a reporting line (${unplaced.length})`}>
              <p className="mb-3 text-xs text-slate-500">These people have no manager and nobody reports to them.</p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {unplaced.map((p) => (
                  <PersonCard key={p.id} p={p} reports={0} open={false} onToggle={() => undefined} highlight={highlight === p.id} />
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </>
  );
}
