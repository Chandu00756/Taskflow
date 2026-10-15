'use client';

import { RecordCreate } from '@/components/desk/itil';
import { releasePayload, useReleaseFields } from '@/components/desk/itil-config';

export default function NewReleasePage() {
  const { properties, sections } = useReleaseFields();
  return (
    <RecordCreate
      module="releases"
      title="New release"
      singular="Release"
      managePriv="releases.manage"
      sections={[...sections, { title: 'Properties', fields: properties.map((f) => ({ ...f, span: 1 as const })) }]}
      defaults={{ subject: '', description: '', status: 'open', release_type: 'standard', priority: '2', tags: [] }}
      toPayload={releasePayload}
    />
  );
}
