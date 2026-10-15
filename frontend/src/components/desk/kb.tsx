'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BookOpen, Eye, FolderOpen, Lock, ThumbsDown, ThumbsUp } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { v2, parseApiError } from '@/lib/itsm/api';
import type { Article, Attachment, KBCategory } from '@/lib/itsm/types';
import { fmtDate, timeAgo } from '@/lib/itsm/format';
import { Card, EmptyState, ErrorBlock, LoadingBlock, Pagination, SearchInput, StatusBadge } from './kit';
import { Markdown } from './markdown';
import { AttachmentList } from './forms';
import { useDebounced } from './pickers';

export function KBBrowser({ basePath, agent = false, actions }: { basePath: string; agent?: boolean; actions?: React.ReactNode }) {
  const [folder, setFolder] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [q, setQ] = React.useState('');
  const [page, setPage] = React.useState(1);
  const term = useDebounced(q, 300);
  React.useEffect(() => setPage(1), [folder, term, status]);
  const tree = useQuery({ queryKey: ['kb-tree'], queryFn: () => v2.items<KBCategory>('/solutions') });
  const articles = useQuery({
    queryKey: ['kb-articles', folder, term, status, page],
    queryFn: () => v2.list<Article>('/solutions/articles', { folder_id: folder, q: term, status, page, per_page: 20 }),
    placeholderData: (p) => p,
  });
  const folderName = tree.data?.flatMap((c) => c.folders).find((f) => f.id === folder)?.name;
  return (
    <div className="flex flex-col gap-6 md:flex-row">
      <aside className="shrink-0 md:w-64">
        <SearchInput value={q} onChange={setQ} placeholder="Search articles" />
        <nav className="mt-4 space-y-4">
          <button onClick={() => setFolder('')} className={cn('block w-full rounded-md px-3 py-1.5 text-left text-sm', !folder ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600 hover:bg-slate-100')}>
            All articles
          </button>
          {(tree.data ?? []).map((cat) => (
            <div key={cat.id}>
              <div className="px-3 text-xs font-semibold uppercase tracking-wide text-slate-400">{cat.name}</div>
              <div className="mt-1 space-y-0.5">
                {cat.folders.map((f) => (
                  <button
                    key={f.id}
                    onClick={() => setFolder(f.id)}
                    className={cn('flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm', folder === f.id ? 'bg-blue-50 font-medium text-blue-700' : 'text-slate-600 hover:bg-slate-100')}
                  >
                    <FolderOpen className="h-4 w-4 shrink-0 opacity-60" />
                    <span className="flex-1 truncate">{f.name}</span>
                    {agent && f.visibility === 'agents' && <Lock className="h-3 w-3 text-slate-400" />}
                    <span className="text-xs text-slate-400">{f.article_count}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </nav>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">{folderName ?? (term ? `Results for “${term}”` : 'All articles')}</h2>
          <div className="flex items-center gap-2">
            {agent && (
              <div className="flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
                {[['', 'All'], ['published', 'Published'], ['draft', 'Drafts']].map(([v, l]) => (
                  <button key={v} onClick={() => setStatus(v)} className={cn('rounded px-2 py-1', status === v ? 'bg-slate-100 font-medium text-slate-900' : 'text-slate-500')}>
                    {l}
                  </button>
                ))}
              </div>
            )}
            {actions}
          </div>
        </div>
        <Card padded={false}>
          {articles.isLoading ? (
            <LoadingBlock />
          ) : (articles.data?.items ?? []).length === 0 ? (
            <EmptyState icon={<BookOpen className="h-6 w-6" />} title="No articles found" description={term ? 'Try different keywords.' : 'Articles published here will help people solve issues on their own.'} />
          ) : (
            <ul className="divide-y divide-slate-100">
              {articles.data!.items.map((a) => (
                <li key={a.id}>
                  <Link href={`${basePath}/${a.id}`} className="block px-4 py-3.5 hover:bg-slate-50">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900">{a.title}</span>
                      {agent && a.status === 'draft' && <StatusBadge status="draft" />}
                      {a.article_type === 'workaround' && <span className="rounded bg-amber-50 px-1.5 text-[11px] font-medium text-amber-800">Workaround</span>}
                    </div>
                    <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{excerpt(a.body)}</p>
                    <div className="mt-1 flex items-center gap-3 text-xs text-slate-400">
                      <span>{a.folder?.name}</span>
                      <span>Updated {timeAgo(a.updated_at)}</span>
                      <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" />{a.views}</span>
                      <span className="inline-flex items-center gap-1"><ThumbsUp className="h-3 w-3" />{a.thumbs_up}</span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {articles.data && <Pagination page={articles.data.page} perPage={articles.data.per_page} total={articles.data.total} onPage={setPage} />}
        </Card>
      </div>
    </div>
  );
}

function excerpt(body: string) {
  return body.replace(/[#*`>\[\]()_-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 220);
}

export function ArticleView({ id, basePath, agent = false, actions }: { id: string; basePath: string; agent?: boolean; actions?: React.ReactNode }) {
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['kb-article', id],
    queryFn: () => v2.get<{ article: Article; attachments: Attachment[]; related: Article[] }>(`/solutions/articles/${id}`),
  });
  const [voted, setVoted] = React.useState<boolean | null>(null);
  const vote = useMutation({
    mutationFn: (helpful: boolean) => v2.post(`/solutions/articles/${id}/vote`, { helpful }),
    onSuccess: (_d, helpful) => {
      setVoted(helpful);
      qc.invalidateQueries({ queryKey: ['kb-article', id] });
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const router = useRouter();
  if (isLoading) return <LoadingBlock />;
  if (error || !data) return <ErrorBlock message={parseApiError(error).message} onRetry={() => router.back()} />;
  const a = data.article;
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <article className="min-w-0">
        <Link href={basePath} className="text-sm text-blue-600 hover:underline">
          ← Knowledge base
        </Link>
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <h1 className="text-2xl font-semibold text-slate-900">{a.title}</h1>
          {actions}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
          {agent && <StatusBadge status={a.status} />}
          {a.article_type === 'workaround' && <span className="rounded bg-amber-50 px-1.5 py-0.5 font-medium text-amber-800">Workaround</span>}
          <span>{a.folder?.name}</span>·<span>Updated {fmtDate(a.updated_at)}</span>
          {a.author && <>· <span>by {a.author.name}</span></>}
          ·<span>{a.views} views</span>
        </div>
        <Card className="mt-5">
          <Markdown text={a.body} className="space-y-4 text-[15px] leading-7 text-slate-800" />
          <AttachmentList items={data.attachments} />
          {a.tags.length > 0 && (
            <div className="mt-5 flex flex-wrap gap-1.5">
              {a.tags.map((t) => (
                <span key={t} className="rounded bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
                  {t}
                </span>
              ))}
            </div>
          )}
        </Card>
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
          {voted === null ? (
            <>
              <span className="text-sm text-slate-700">Was this article helpful?</span>
              <button onClick={() => vote.mutate(true)} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1 text-sm hover:border-emerald-300 hover:bg-emerald-50">
                <ThumbsUp className="h-4 w-4" /> Yes
              </button>
              <button onClick={() => vote.mutate(false)} className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-1 text-sm hover:border-rose-300 hover:bg-rose-50">
                <ThumbsDown className="h-4 w-4" /> No
              </button>
              <span className="ml-auto text-xs text-slate-400">
                {a.thumbs_up} found this helpful
              </span>
            </>
          ) : voted ? (
            <span className="text-sm text-emerald-700">Thanks! Glad it helped.</span>
          ) : (
            <span className="text-sm text-slate-700">
              Sorry about that.{' '}
              {!agent && (
                <Link href="/portal/new" className="font-medium text-blue-600">
                  Raise a ticket
                </Link>
              )}{' '}
              and we&apos;ll help you directly.
            </span>
          )}
        </div>
      </article>
      <aside>
        {data.related.length > 0 && (
          <Card title="Related articles">
            <ul className="space-y-2">
              {data.related.map((r) => (
                <li key={r.id}>
                  <Link href={`${basePath}/${r.id}`} className="text-sm text-blue-700 hover:underline">
                    {r.title}
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </aside>
    </div>
  );
}
