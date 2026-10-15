'use client';

import * as React from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { v2, parseApiError } from '@/lib/itsm/api';
import type { SearchResult } from '@/lib/itsm/types';
import { EmptyState, ErrorBlock, LoadingBlock, PageHeader, SearchInput } from './kit';
import { useDebounced } from './pickers';
import { SEARCH_TYPE_LABELS, searchIcon } from './shell';

/** Full search results grouped by record type, shared by the desk and the portal. */
export function SearchResults() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = React.useState(params.get('q') ?? '');
  const [type, setType] = React.useState(params.get('type') ?? '');
  const term = useDebounced(q.trim(), 300);
  React.useEffect(() => {
    const next = new URLSearchParams();
    if (term) next.set('q', term);
    if (type) next.set('type', type);
    router.replace(`${pathname}${next.toString() ? `?${next}` : ''}`, { scroll: false });
  }, [term, type, pathname, router]);

  const searchable = term.length >= 2 || /^#?\d+$/.test(term);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['search', term, 'full'],
    queryFn: () => v2.get<{ results: SearchResult[] }>('/search', { q: term, limit: 25 }),
    enabled: searchable,
  });
  const results = data?.results ?? [];
  const types = Array.from(new Set(results.map((r) => r.type)));
  const shown = type ? results.filter((r) => r.type === type) : results;
  const groups = Array.from(new Set(shown.map((r) => r.type))).map((t) => ({ type: t, items: shown.filter((r) => r.type === t) }));

  return (
    <div className="space-y-4">
      <PageHeader title="Search" subtitle={searchable ? `${results.length} result${results.length === 1 ? '' : 's'} for “${term}”` : 'Search across everything you can access.'} icon={<Search className="h-5 w-5" />} />
      <SearchInput value={q} onChange={setQ} placeholder="Search by keyword, ID (INC-12), person or email…" className="max-w-2xl" autoFocus />
      {types.length > 1 && (
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter by type">
          <TypeChip active={!type} onClick={() => setType('')} label={`All · ${results.length}`} />
          {types.map((t) => (
            <TypeChip key={t} active={type === t} onClick={() => setType(t)} label={`${SEARCH_TYPE_LABELS[t] ?? t} · ${results.filter((r) => r.type === t).length}`} />
          ))}
        </div>
      )}
      {!searchable ? (
        <EmptyState icon={<Search className="h-6 w-6" />} title="Type at least two characters" description="Try a ticket number like INC-12, a requester's name, an asset tag or a few words from a subject." />
      ) : isLoading ? (
        <LoadingBlock />
      ) : error ? (
        <ErrorBlock message={parseApiError(error).message} onRetry={() => refetch()} />
      ) : shown.length === 0 ? (
        <EmptyState icon={<Search className="h-6 w-6" />} title={`No results for “${term}”`} description="Check the spelling, try fewer words, or search by ID or email." />
      ) : (
        <div className="space-y-5">
          {groups.map((g) => {
            const Icon = searchIcon(g.type);
            return (
              <section key={g.type} className="card-panel overflow-hidden rounded-lg border border-slate-200 bg-white">
                <h2 className="flex items-center gap-2 border-b border-slate-100 bg-slate-50/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <Icon className="h-4 w-4" /> {SEARCH_TYPE_LABELS[g.type] ?? g.type}
                </h2>
                <ul className="divide-y divide-slate-100">
                  {g.items.map((r) => (
                    <li key={`${r.type}-${r.id}`}>
                      <Link href={r.url} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-slate-900">
                            {r.display_id && <span className="mr-2 font-mono text-xs text-slate-500">{r.display_id}</span>}
                            {r.title}
                          </span>
                          {r.subtitle && <span className="block truncate text-xs text-slate-500">{r.subtitle}</span>}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TypeChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn('rounded-full border px-3 py-1 text-xs font-medium', active ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}
    >
      {label}
    </button>
  );
}
