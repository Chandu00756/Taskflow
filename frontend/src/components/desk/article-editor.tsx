'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { v2, parseApiError } from '@/lib/itsm/api';
import type { Article, KBCategory } from '@/lib/itsm/types';
import { toDateInput } from '@/lib/itsm/format';
import { Btn, Card, Field, PageHeader, SelectBox, TagInput, TextArea, TextInput, Tabs } from './kit';
import { Markdown } from './markdown';
import { AttachmentInput } from './forms';

export function ArticleEditor({ article }: { article?: Article }) {
  const router = useRouter();
  const qc = useQueryClient();
  const tree = useQuery({ queryKey: ['kb-tree'], queryFn: () => v2.items<KBCategory>('/solutions') });
  const [form, setForm] = React.useState({
    title: article?.title ?? '',
    body: article?.body ?? '',
    folder_id: article?.folder_id ?? '',
    article_type: article?.article_type ?? 'permanent',
    tags: article?.tags ?? [],
    keywords: article?.keywords ?? '',
    review_date: toDateInput(article?.review_date),
  });
  const [files, setFiles] = React.useState<{ id: string; name: string; size: number }[]>([]);
  const [view, setView] = React.useState('write');
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    if (!form.folder_id && tree.data?.[0]?.folders[0]) setForm((f) => ({ ...f, folder_id: tree.data![0].folders[0].id }));
  }, [tree.data, form.folder_id]);
  const save = useMutation({
    mutationFn: (status: 'draft' | 'published') => {
      const body = { ...form, status, review_date: form.review_date || undefined, attachment_ids: files.map((f) => f.id) };
      return article ? v2.put<Article>(`/solutions/articles/${article.id}`, body) : v2.post<Article>('/solutions/articles', body);
    },
    onSuccess: (a, status) => {
      toast.success(status === 'published' ? 'Article published' : 'Draft saved');
      qc.invalidateQueries({ queryKey: ['kb-articles'] });
      qc.invalidateQueries({ queryKey: ['kb-tree'] });
      qc.invalidateQueries({ queryKey: ['kb-article', a.id] });
      router.push(`/solutions/${a.id}`);
    },
    onError: (e) => {
      const err = parseApiError(e);
      setErrors(err.fields);
      toast.error(err.message);
    },
  });
  const folderOptions = (tree.data ?? []).flatMap((c) => c.folders.map((f) => ({ value: f.id, label: `${c.name} › ${f.name}${f.visibility === 'agents' ? ' (agents only)' : ''}` })));
  const set = (k: keyof typeof form, v: string | string[]) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <>
      <PageHeader
        title={article ? 'Edit article' : 'New article'}
        breadcrumbs={[{ label: 'Solutions', href: '/solutions' }, { label: article ? article.title : 'New' }]}
        actions={
          <>
            <Btn onClick={() => router.back()}>Cancel</Btn>
            <Btn loading={save.isPending && save.variables === 'draft'} onClick={() => save.mutate('draft')}>Save as draft</Btn>
            <Btn variant="primary" loading={save.isPending && save.variables === 'published'} onClick={() => save.mutate('published')}>Publish</Btn>
          </>
        }
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <Card>
          <div className="space-y-4">
            <Field label="Title" required error={errors.title}>
              <TextInput value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. How to connect to the VPN" />
            </Field>
            <Tabs value={view} onChange={setView} tabs={[{ value: 'write', label: 'Write' }, { value: 'preview', label: 'Preview' }]} />
            {view === 'write' ? (
              <Field hint="Markdown supported: ## headings, **bold**, lists, `code`, [links](https://…)" error={errors.body}>
                <TextArea value={form.body} onChange={(e) => set('body', e.target.value)} rows={20} className="font-mono text-[13px]" />
              </Field>
            ) : (
              <div className="min-h-[300px] rounded-md border border-slate-200 p-4">
                <Markdown text={form.body} />
              </div>
            )}
            <AttachmentInput value={files} onChange={setFiles} />
          </div>
        </Card>
        <Card title="Settings">
          <div className="space-y-3">
            <Field label="Folder" required error={errors.folder_id}>
              <SelectBox value={form.folder_id} onChange={(v) => set('folder_id', v)} options={folderOptions} />
            </Field>
            <Field label="Type">
              <SelectBox value={form.article_type} onChange={(v) => set('article_type', v)} options={[{ value: 'permanent', label: 'Permanent solution' }, { value: 'workaround', label: 'Workaround' }]} />
            </Field>
            <Field label="Tags">
              <TagInput value={form.tags} onChange={(v) => set('tags', v)} />
            </Field>
            <Field label="Search keywords" hint="Extra words people might search for">
              <TextInput value={form.keywords} onChange={(e) => set('keywords', e.target.value)} />
            </Field>
            <Field label="Review by" hint="Reminds you to keep the article current">
              <TextInput type="date" value={form.review_date} onChange={(e) => set('review_date', e.target.value)} />
            </Field>
          </div>
        </Card>
      </div>
    </>
  );
}
