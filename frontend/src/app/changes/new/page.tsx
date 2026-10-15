'use client';

import { RecordCreate } from '@/components/desk/itil';
import { changePayload, useChangeFields } from '@/components/desk/itil-config';

export default function NewChangePage() {
  const { properties, sections } = useChangeFields();
  return (
    <RecordCreate
      module="changes"
      title="New change"
      singular="Change"
      managePriv="changes.manage"
      sections={[...sections, { title: 'Properties', fields: properties.map((f) => ({ ...f, span: 1 as const })) }]}
      defaults={{ subject: '', description: '', status: 'open', change_type: 'standard', priority: '2', impact: '2', risk: '1', tags: [] }}
      toPayload={changePayload}
    />
  );
}
