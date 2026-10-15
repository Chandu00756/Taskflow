'use client';

import * as React from 'react';
import { LoadingBlock } from '@/components/desk/kit';
import { SearchResults } from '@/components/desk/search-results';

export default function SearchPage() {
  return (
    <React.Suspense fallback={<LoadingBlock />}>
      <SearchResults />
    </React.Suspense>
  );
}
