'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Clock } from 'lucide-react';
import { EmptyState, LoadingBlock, SearchInput } from '@/components/desk/kit';
import { CatalogIcon } from '@/components/desk/catalog-icon';
import { useDebounced } from '@/components/desk/pickers';
import { v2 } from '@/lib/itsm/api';
import { fmtMoney } from '@/lib/itsm/format';
import type { CatalogCategory, CatalogItem } from '@/lib/itsm/types';
import { cn } from '@/lib/utils';

export default function PortalCatalogPage() {
  const [category, setCategory] = React.useState('');
  const [q, setQ] = React.useState('');
  const term = useDebounced(q, 250);
  const { data, isLoading } = useQuery({
    queryKey: ['catalog', 'portal', category, term],
    queryFn: () => v2.get<{ categories: CatalogCategory[]; items: CatalogItem[] }>('/catalog', { portal: 1, category_id: category, q: term }),
  });
  return (
    <div>
      <h1 className="text-2xl font-semibold text-slate-900">Service catalog</h1>
      <p className="mt-1 text-sm text-slate-500">Request hardware, software, access and other services.</p>
      <div className="mt-6 flex flex-col gap-6 md:flex-row">
        <aside className="shrink-0 md:w-56">
          <SearchInput value={q} onChange={setQ} placeholder="Search services" />
          <nav className="mt-4 space-y-1">
            <button onClick={() => setCategory('')} className={cn('block w-full rounded-md px-3 py-2 text-left text-sm', !category ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600 hover:bg-slate-100')}>
              All services
            </button>
            {(data?.categories ?? []).map((c) => (
              <button key={c.id} onClick={() => setCategory(c.id)} className={cn('block w-full rounded-md px-3 py-2 text-left text-sm', category === c.id ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600 hover:bg-slate-100')}>
                {c.name}
              </button>
            ))}
          </nav>
        </aside>
        <div className="flex-1">
          {isLoading ? (
            <LoadingBlock />
          ) : (data?.items ?? []).length === 0 ? (
            <EmptyState title="No services found" description="Try a different search or category." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {data!.items.map((it) => (
                <Link key={it.id} href={`/portal/catalog/${it.id}`} className="group flex flex-col rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-blue-300 hover:shadow">
                  <span className="flex h-11 w-11 items-center justify-center rounded-lg bg-slate-100 text-slate-600 group-hover:bg-blue-600 group-hover:text-white">
                    <CatalogIcon name={it.icon} className="h-5 w-5" />
                  </span>
                  <div className="mt-3 font-semibold text-slate-900">{it.name}</div>
                  <div className="mt-1 flex-1 text-sm text-slate-500">{it.short_description}</div>
                  <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                    <span>{it.cost > 0 ? fmtMoney(it.cost) : 'No charge'}</span>
                    {it.delivery_hours > 0 && (
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" /> {it.delivery_hours >= 24 ? `${Math.round(it.delivery_hours / 24)} day(s)` : `${it.delivery_hours}h`}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
