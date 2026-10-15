'use client';

import { RecordCreate } from '@/components/desk/itil';
import { problemPayload, useProblemFields } from '@/components/desk/itil-config';

export default function NewProblemPage() {
  const { properties, sections } = useProblemFields();
  return (
    <RecordCreate
      module="problems"
      title="New problem"
      singular="Problem"
      managePriv="problems.manage"
      sections={[...sections, { title: 'Properties', fields: properties.map((f) => ({ ...f, span: 1 as const })) }]}
      defaults={{ subject: '', description: '', status: 'open', priority: '2', impact: '2', tags: [], known_error: false }}
      toPayload={problemPayload}
    />
  );
}
