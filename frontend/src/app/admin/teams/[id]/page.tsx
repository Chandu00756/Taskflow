'use client';

import * as React from 'react';
import { useParams } from 'next/navigation';
import { LoadingBlock } from '@/components/desk/kit';
import { TeamDetail } from '@/components/admin/teams';

export default function TeamPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <React.Suspense fallback={<LoadingBlock />}>
      <TeamDetail id={id} />
    </React.Suspense>
  );
}
