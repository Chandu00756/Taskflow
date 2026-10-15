'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { RecordDetail } from '@/components/desk/itil';
import { releasePayload, releaseToForm, useReleaseFields } from '@/components/desk/itil-config';
import { Card, PriorityBadge, StatusBadge, Badge } from '@/components/desk/kit';
import { fmtDateTime, labelize } from '@/lib/itsm/format';
import type { Change, Release } from '@/lib/itsm/types';

type ReleaseData = { release: Release; changes: Change[] };

export default function ReleasePage() {
  const { id } = useParams<{ id: string }>();
  const { properties, sections } = useReleaseFields();
  return (
    <RecordDetail<Release>
      id={id}
      cfg={{
        module: 'releases',
        singular: 'Release',
        managePriv: 'releases.manage',
        fetchPath: (x) => `/releases/${x}`,
        extract: (d) => (d as ReleaseData).release,
        title: (r) => r.subject,
        displayId: (r) => r.display_id,
        badges: (r) => (
          <>
            <StatusBadge status={r.status} />
            <Badge className="bg-slate-100 text-slate-700 ring-slate-500/20">{labelize(r.release_type)}</Badge>
            <PriorityBadge priority={r.priority} />
          </>
        ),
        topContent: (_r, d) => {
          const changes = (d as ReleaseData).changes;
          return (
            <Card title={`Changes in this release (${changes.length})`} className="mb-5" padded={false}>
              {changes.length === 0 ? (
                <p className="px-4 py-6 text-center text-sm text-slate-400">Attach changes by setting their release, or link them under Associations.</p>
              ) : (
                <ul className="divide-y divide-slate-100">
                  {changes.map((c) => (
                    <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                      <Link href={`/changes/${c.id}`} className="min-w-0 flex-1 truncate text-sm text-slate-800 hover:text-blue-700">
                        <span className="mr-2 font-mono text-xs text-slate-500">{c.display_id}</span>
                        {c.subject}
                      </Link>
                      <span className="text-xs text-slate-500">{fmtDateTime(c.planned_start)}</span>
                      <StatusBadge status={c.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          );
        },
        propertyFields: properties,
        sections,
        toForm: (r) => releaseToForm(r as unknown as Record<string, unknown>),
        toPayload: releasePayload,
        associationTypes: ['change', 'ticket', 'asset'],
        isDeleted: (r) => r.is_deleted,
      }}
    />
  );
}
