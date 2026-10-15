'use client';

import { useParams } from 'next/navigation';
import { RecordDetail } from '@/components/desk/itil';
import { problemPayload, problemToForm, useProblemFields } from '@/components/desk/itil-config';
import { PriorityBadge, StatusBadge, Badge } from '@/components/desk/kit';
import type { Problem } from '@/lib/itsm/types';

export default function ProblemPage() {
  const { id } = useParams<{ id: string }>();
  const { properties, sections } = useProblemFields();
  return (
    <RecordDetail<Problem>
      id={id}
      cfg={{
        module: 'problems',
        singular: 'Problem',
        managePriv: 'problems.manage',
        fetchPath: (x) => `/problems/${x}`,
        extract: (d) => d as Problem,
        title: (p) => p.subject,
        displayId: (p) => p.display_id,
        badges: (p) => (
          <>
            <StatusBadge status={p.status} />
            <PriorityBadge priority={p.priority} />
            {p.known_error && <Badge className="bg-amber-50 text-amber-800 ring-amber-600/20">Known error</Badge>}
            <span className="text-xs text-slate-500">{p.incident_count} linked incident(s)</span>
          </>
        ),
        propertyFields: properties,
        sections,
        toForm: (p) => problemToForm(p as unknown as Record<string, unknown>),
        toPayload: problemPayload,
        associationTypes: ['ticket', 'change', 'asset'],
        isDeleted: (p) => p.is_deleted,
      }}
    />
  );
}
