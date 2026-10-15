'use client';

import * as React from 'react';
import Link from 'next/link';
import { ChevronRight, Eye, Network } from 'lucide-react';
import type { OrgContext, Person } from '@/lib/itsm/types';
import { Avatar, Card } from './kit';

/** Where a person sits: unit path, reporting line, direct reports, teams and groups. */
export function OrgCard({ person, org, title = 'Organization', linkPeople = true }: { person: Person; org: OrgContext; title?: string; linkPeople?: boolean }) {
  // The chain runs from the direct manager upwards; show it top-down.
  const chain = [...org.manager_chain].reverse();
  const PersonRow = ({ id, name, src, sub }: { id: string; name: string; src?: string; sub?: string }) => {
    const body = (
      <>
        <Avatar name={name} src={src} size="xs" />
        <span className="truncate">{name}</span>
        {sub && <span className="truncate text-xs text-slate-400">{sub}</span>}
      </>
    );
    return linkPeople ? (
      <Link href={`/people/${id}`} className="flex min-w-0 items-center gap-2 rounded px-1 py-0.5 text-sm text-slate-800 hover:bg-slate-50 hover:text-blue-700">{body}</Link>
    ) : (
      <span className="flex min-w-0 items-center gap-2 px-1 py-0.5 text-sm text-slate-800">{body}</span>
    );
  };
  return (
    <Card title={<span className="flex items-center gap-2"><Network className="h-4 w-4 text-slate-400" />{title}</span>}>
      <div className="space-y-4 text-sm">
        <section>
          <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Unit</h4>
          {org.unit_path.length ? (
            <div className="flex flex-wrap items-center gap-1 text-slate-700">
              {org.unit_path.map((u, i) => (
                <React.Fragment key={u.id}>
                  {i > 0 && <ChevronRight className="h-3 w-3 text-slate-400" />}
                  <span className={i === org.unit_path.length - 1 ? 'font-medium text-slate-900' : ''}>{u.name}</span>
                </React.Fragment>
              ))}
            </div>
          ) : (
            <span className="text-slate-400">Not in a unit</span>
          )}
        </section>
        <section>
          <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Reporting line</h4>
          {chain.length ? (
            <ol className="space-y-0.5">
              {chain.map((m, i) => (
                <li key={m.id} style={{ paddingLeft: i * 12 }}>
                  <PersonRow id={m.id} name={m.name} src={m.avatar_url} sub={m.job_title} />
                </li>
              ))}
              <li style={{ paddingLeft: chain.length * 12 }} className="flex items-center gap-2 px-1 py-0.5 font-medium text-slate-900">
                <Avatar name={person.name} src={person.avatar_url} size="xs" /> {person.name}
              </li>
            </ol>
          ) : (
            <span className="text-slate-400">No manager set</span>
          )}
        </section>
        {org.direct_reports.length > 0 && (
          <section>
            <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Direct reports · {org.direct_reports.length}</h4>
            <ul className="max-h-48 space-y-0.5 overflow-y-auto">
              {org.direct_reports.map((r) => (
                <li key={r.id}><PersonRow id={r.id} name={r.name} src={r.avatar_url} sub={r.job_title} /></li>
              ))}
            </ul>
          </section>
        )}
        <section>
          <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Teams</h4>
          {org.teams.length ? (
            <div className="flex flex-wrap gap-1.5">
              {org.teams.map((t) => <span key={t.id} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">{t.name}</span>)}
            </div>
          ) : (
            <span className="text-slate-400">No teams</span>
          )}
        </section>
        {person.is_agent && (
          <section>
            <h4 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Agent groups</h4>
            <div className="flex flex-wrap gap-1.5">
              {person.groups.map((g) => <span key={g.id} className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{g.name}</span>)}
              {person.observer_of.map((g) => (
                <span key={g.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600" title="Observer: sees the group's tickets, never auto-assigned">
                  <Eye className="h-3 w-3" /> {g.name}
                </span>
              ))}
              {person.groups.length + person.observer_of.length === 0 && <span className="text-slate-400">No groups</span>}
            </div>
            {person.roles.length > 0 && <p className="mt-2 text-xs text-slate-500">Roles: {person.roles.map((r) => r.name).join(', ')}</p>}
          </section>
        )}
      </div>
    </Card>
  );
}
