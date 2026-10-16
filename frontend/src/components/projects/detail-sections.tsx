'use client';

import * as React from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, ChevronDown, ExternalLink, GitBranch, Link2, Loader2, Paperclip, Plus, Search, Trash2, Ticket, X } from 'lucide-react';
import { toast } from 'sonner';
import { v2, uploadAttachment, parseApiError, downloadFile } from '@/lib/itsm/api';
import { fmtBytes, timeAgo } from '@/lib/itsm/format';
import type { Attachment, Project, RelationType, WebLink, WorkItem } from '@/lib/itsm/types';
import { Avatar, Btn, FloatingPanel, Menu, MenuItem, Modal, StatusBadge, TextInput, useConfirm } from '@/components/desk/kit';
import { AttachmentThumb, isPreviewable, Lightbox } from '@/components/desk/lightbox';
import { cn } from '@/lib/utils';
import { StateIcon } from './icons';
import { useModules, useWorkItems } from './hooks';

const RELATION_LABEL: Record<RelationType, string> = {
  blocks: 'Blocking',
  blocked_by: 'Blocked by',
  relates_to: 'Relates to',
  duplicate_of: 'Duplicate of',
  duplicated_by: 'Duplicated by',
};

/** Writes a fresh work item detail into the cache after a related change. */
function useSetDetail(id: string, projectId: string) {
  const qc = useQueryClient();
  return (w: WorkItem) => {
    qc.setQueryData(['work-item', id], (old: WorkItem | undefined) => ({ ...(old ?? w), ...w }));
    qc.invalidateQueries({ queryKey: ['work-items', projectId] });
  };
}

/** Uploads files and attaches them to the work item. */
export function useAttachFiles(item: WorkItem, projectId: string) {
  const setDetail = useSetDetail(item.id, projectId);
  const [busy, setBusy] = React.useState(false);
  const attach = async (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []);
    if (!list.length) return;
    setBusy(true);
    try {
      const ids: string[] = [];
      for (const f of list) {
        if (f.size > 15 * 1024 * 1024) {
          toast.error(`${f.name} is larger than 15 MB`);
          continue;
        }
        try {
          ids.push((await uploadAttachment(f)).id);
        } catch (e) {
          toast.error(`${f.name}: ${parseApiError(e).message}`);
        }
      }
      if (ids.length) setDetail(await v2.post<WorkItem>(`/work-items/${item.id}/attachments`, { attachment_ids: ids }));
    } catch (e) {
      toast.error(parseApiError(e).message);
    } finally {
      setBusy(false);
    }
  };
  return { attach, busy };
}

/** Plane-style action bar under the description. */
export function DetailToolbar({ item, project, onAddSubItem, onAddLink, onAttach, attaching }: {
  item: WorkItem;
  project: Project;
  onAddSubItem: () => void;
  onAddLink: () => void;
  onAttach: () => void;
  attaching: boolean;
}) {
  const [relating, setRelating] = React.useState<RelationType | null>(null);
  const editable = !!item.can_edit;
  if (!editable) return null;
  return (
    <div className="inline-flex flex-wrap items-center gap-0.5 rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
      <button type="button" onClick={onAddSubItem} className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-slate-700 hover:bg-slate-100">
        <GitBranch className="h-4 w-4" /> Add sub-work item
      </button>
      <span className="mx-1 h-5 w-px bg-slate-200" />
      <Menu
        align="left"
        trigger={() => (
          <span className="flex items-center gap-1 rounded-md px-2 py-1.5 text-sm text-slate-700 hover:bg-slate-100" title="Add a relation" aria-label="Add a relation">
            <Link2 className="h-4 w-4" /> Relation <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
          </span>
        )}
      >
        {(close) => (
          <>
            {(['relates_to', 'blocks', 'blocked_by', 'duplicate_of'] as RelationType[]).map((t) => (
              <MenuItem key={t} onClick={() => { close(); setRelating(t); }}>{RELATION_LABEL[t]}…</MenuItem>
            ))}
          </>
        )}
      </Menu>
      <button type="button" onClick={onAddLink} title="Add a link" aria-label="Add a link" className="rounded-md p-2 text-slate-600 hover:bg-slate-100">
        <ExternalLink className="h-4 w-4" />
      </button>
      <button type="button" onClick={onAttach} title="Attach files or images" aria-label="Attach files or images" className="rounded-md p-2 text-slate-600 hover:bg-slate-100">
        {attaching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Paperclip className="h-4 w-4" />}
      </button>
      {relating && <RelationPicker item={item} project={project} type={relating} onClose={() => setRelating(null)} />}
    </div>
  );
}

function RelationPicker({ item, project, type, onClose }: { item: WorkItem; project: Project; type: RelationType; onClose: () => void }) {
  const [q, setQ] = React.useState('');
  const { data = [], isFetching } = useWorkItems(project.id, { q });
  const setDetail = useSetDetail(item.id, project.id);
  const taken = new Set([item.id, ...(item.relations ?? []).map((r) => r.item.id)]);
  const choose = async (targetId: string) => {
    try {
      setDetail(await v2.post<WorkItem>(`/work-items/${item.id}/relations`, { type, target_id: targetId }));
      toast.success('Relation added');
      onClose();
    } catch (e) {
      toast.error(parseApiError(e).message);
    }
  };
  return (
    <Modal open onClose={onClose} title={`${RELATION_LABEL[type]}…`}>
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <TextInput autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search work items by title or ID" className="pl-8" />
      </div>
      <ul className="max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200">
        {data.filter((w) => !taken.has(w.id)).slice(0, 50).map((w) => (
          <li key={w.id}>
            <button type="button" onClick={() => choose(w.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50">
              <StateIcon state={w.state} />
              <span className="text-xs text-slate-500">{w.display_id}</span>
              <span className="truncate text-sm text-slate-800">{w.title}</span>
            </button>
          </li>
        ))}
        {!isFetching && data.filter((w) => !taken.has(w.id)).length === 0 && <li className="px-3 py-6 text-center text-sm text-slate-500">No other work items found</li>}
      </ul>
    </Modal>
  );
}

/** Attachments with image thumbnails; click to view full size. */
export function AttachmentsSection({ item, project, onAttach, attaching }: { item: WorkItem; project: Project; onAttach: () => void; attaching: boolean }) {
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [open, setOpen] = React.useState<number | null>(null);
  const [collapsed, setCollapsed] = React.useState(false);
  const atts = item.attachments ?? [];
  const previews = atts.filter(isPreviewable);
  const remove = async (a: Attachment) => {
    if (!(await confirm({ title: `Remove ${a.name}?`, message: 'The file is deleted for everyone.', danger: true, confirmLabel: 'Remove' }))) return;
    try {
      await v2.del(`/attachments/${a.id}`);
      qc.invalidateQueries({ queryKey: ['work-item', item.id] });
      qc.invalidateQueries({ queryKey: ['work-items', project.id] });
    } catch (e) {
      toast.error(parseApiError(e).message);
    }
  };
  if (!atts.length && !item.can_edit) return null;
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <button type="button" onClick={() => setCollapsed((c) => !c)} className="flex items-center gap-1.5 text-sm font-semibold text-slate-800">
          Attachments <span className="text-xs font-normal text-slate-500">{atts.length}</span>
          <ChevronDown className={cn('h-3.5 w-3.5 text-slate-400 transition', collapsed && '-rotate-90')} />
        </button>
        {item.can_edit && (
          <button type="button" onClick={onAttach} aria-label="Attach files" className="ml-auto rounded p-1 text-slate-500 hover:bg-slate-100">
            {attaching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </button>
        )}
      </div>
      {!collapsed && (
        <>
          {previews.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-2">
              {previews.map((a, i) => <AttachmentThumb key={a.id} a={a} onOpen={() => setOpen(i)} />)}
            </div>
          )}
          {atts.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">Drop files here or use the paperclip to attach screenshots and documents.</p>
          ) : (
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {atts.map((a) => (
                <li key={a.id} className="group flex items-center gap-3 px-3 py-2">
                  <Paperclip className="h-4 w-4 shrink-0 text-slate-400" />
                  <button
                    type="button"
                    onClick={() => (isPreviewable(a) ? setOpen(previews.indexOf(a)) : downloadFile(`/attachments/${a.id}`, a.name).catch((e) => toast.error(parseApiError(e).message)))}
                    className="min-w-0 truncate text-sm text-slate-800 hover:text-blue-700 hover:underline"
                  >
                    {a.name}
                  </button>
                  <span className="shrink-0 text-xs text-slate-400">{fmtBytes(a.size)}</span>
                  <span className="ml-auto shrink-0 text-xs text-slate-400" title={a.created_at}>{timeAgo(a.created_at)}</span>
                  {item.can_edit && (
                    <button type="button" onClick={() => remove(a)} aria-label={`Remove ${a.name}`} className="shrink-0 rounded p-1 text-slate-400 opacity-0 hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {open !== null && <Lightbox items={previews} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </section>
  );
}

/** Web links on the work item. */
export function LinksSection({ item, project, adding, onAdding }: { item: WorkItem; project: Project; adding: boolean; onAdding: (v: boolean) => void }) {
  const setDetail = useSetDetail(item.id, project.id);
  const [url, setUrl] = React.useState('');
  const [title, setTitle] = React.useState('');
  const links = item.web_links ?? [];
  const save = async (next: WebLink[]) => {
    try {
      setDetail(await v2.put<WorkItem>(`/work-items/${item.id}`, { web_links: next }));
      return true;
    } catch (e) {
      toast.error(parseApiError(e).message);
      return false;
    }
  };
  if (!links.length && !adding) return null;
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-slate-800">Links <span className="text-xs font-normal text-slate-500">{links.length}</span></h3>
      <ul className="space-y-1">
        {links.map((l, i) => (
          <li key={`${l.url}-${i}`} className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-50">
            <ExternalLink className="h-4 w-4 shrink-0 text-slate-400" />
            <a href={l.url} target="_blank" rel="noopener noreferrer" className="min-w-0 truncate text-sm text-blue-700 hover:underline">{l.title || l.url}</a>
            {l.title && <span className="min-w-0 truncate text-xs text-slate-400">{l.url}</span>}
            {item.can_edit && (
              <button type="button" onClick={() => save(links.filter((_, j) => j !== i))} aria-label="Remove link" className="ml-auto rounded p-1 text-slate-400 opacity-0 hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100">
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {adding && (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!url.trim()) return;
            const u = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
            if (await save([...links, { url: u, title: title.trim() }])) {
              setUrl('');
              setTitle('');
              onAdding(false);
            }
          }}
        >
          <TextInput autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" className="h-8 min-w-[14rem] flex-1" aria-label="Link URL" />
          <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" className="h-8 w-48" aria-label="Link title" />
          <Btn size="sm" type="submit" variant="primary">Add</Btn>
          <Btn size="sm" variant="ghost" onClick={() => onAdding(false)}>Cancel</Btn>
        </form>
      )}
    </section>
  );
}

/** Blocking / blocked by / relates to / duplicate relations. */
export function RelationsSection({ item, project, onOpen }: { item: WorkItem; project: Project; onOpen: (id: string) => void }) {
  const setDetail = useSetDetail(item.id, project.id);
  const rels = item.relations ?? [];
  if (!rels.length) return null;
  const groups = (Object.keys(RELATION_LABEL) as RelationType[]).map((t) => [t, rels.filter((r) => r.type === t)] as const).filter(([, l]) => l.length);
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-slate-800">Relations</h3>
      <div className="space-y-2">
        {groups.map(([t, list]) => (
          <div key={t}>
            <div className={cn('mb-1 text-xs font-medium', t === 'blocked_by' ? 'text-rose-600' : t === 'blocks' ? 'text-amber-600' : 'text-slate-500')}>{RELATION_LABEL[t]}</div>
            <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {list.map((r) => (
                <li key={r.link_id} className="group flex items-center gap-2 px-3 py-1.5">
                  <StateIcon state={r.item.state as WorkItem['state']} />
                  <button type="button" onClick={() => onOpen(r.item.id)} className="flex min-w-0 items-center gap-2 text-left">
                    <span className="text-xs text-slate-500">{r.item.display_id}</span>
                    <span className="truncate text-sm text-slate-800">{r.item.title}</span>
                  </button>
                  {item.can_edit && (
                    <button
                      type="button"
                      aria-label="Remove relation"
                      onClick={() => v2.del<WorkItem>(`/work-items/${item.id}/relations/${r.link_id}`).then(setDetail, (e) => toast.error(parseApiError(e).message))}
                      className="ml-auto rounded p-1 text-slate-400 opacity-0 hover:bg-rose-50 hover:text-rose-600 group-hover:opacity-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Tickets linked to this work item; the tracked one follows its status. */
export function LinkedTickets({ item }: { item: WorkItem }) {
  const tickets = item.tickets ?? [];
  if (!tickets.length) return null;
  return (
    <section>
      <h3 className="mb-2 text-sm font-semibold text-slate-800">Tickets</h3>
      <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
        {tickets.map((t) => (
          <li key={t.id} className="flex items-center gap-2 px-3 py-2">
            <Ticket className="h-4 w-4 shrink-0 text-slate-400" />
            <Link href={`/tickets/${t.id}`} className="flex min-w-0 items-center gap-2 hover:underline">
              <span className="text-xs text-slate-500">{t.display_id}</span>
              <span className="truncate text-sm text-slate-800">{t.subject}</span>
            </Link>
            {t.tracked && <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700" title="This ticket's project status follows this work item">Synced</span>}
            <span className="ml-auto shrink-0"><StatusBadge status={t.status} /></span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Multi-select of the project's modules. */
export function ModulesSelect({ item, project, disabled, onChange }: { item: WorkItem; project: Project; disabled?: boolean; onChange: (ids: string[]) => void }) {
  const { data: modules = [] } = useModules(project.id);
  const ref = React.useRef<HTMLButtonElement>(null);
  const [open, setOpen] = React.useState(false);
  const close = React.useCallback(() => setOpen(false), []);
  const selected = item.module_ids ?? [];
  const names = (item.modules ?? []).map((m) => m.name);
  return (
    <>
      <button
        ref={ref}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-slate-700 hover:bg-slate-100 disabled:cursor-default disabled:hover:bg-transparent"
      >
        {names.length ? <span className="truncate">{names.join(', ')}</span> : <span className="text-slate-400">Add modules</span>}
      </button>
      <FloatingPanel anchorRef={ref} open={open} onClose={close} minWidth={240}>
        <div className="max-h-64 overflow-y-auto py-1">
          {modules.length === 0 && <p className="px-3 py-2 text-sm text-slate-500">No modules yet. Create them on the project&apos;s Modules tab.</p>}
          {modules.map((m) => {
            const on = selected.includes(m.id);
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onChange(on ? selected.filter((x) => x !== m.id) : [...selected, m.id])}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-slate-50"
              >
                <span className={cn('flex h-4 w-4 items-center justify-center rounded border text-[10px]', on ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300')}>{on ? '✓' : ''}</span>
                <span className="truncate">{m.name}</span>
              </button>
            );
          })}
        </div>
      </FloatingPanel>
    </>
  );
}

/** Subscribe / unsubscribe with the current subscribers' avatars. */
export function SubscribeButton({ item, project }: { item: WorkItem; project: Project }) {
  const setDetail = useSetDetail(item.id, project.id);
  const [busy, setBusy] = React.useState(false);
  const subs = item.subscribers ?? [];
  return (
    <div className="flex items-center overflow-hidden rounded-md border border-slate-200">
      {subs.length > 0 && (
        <span className="flex -space-x-1.5 px-2" title={subs.map((s) => s.name).join(', ')}>
          {subs.slice(0, 3).map((s) => <Avatar key={s.id} name={s.name} src={s.avatar_url} size="xs" />)}
          {subs.length > 3 && <span className="pl-2 text-xs text-slate-500">+{subs.length - 3}</span>}
        </span>
      )}
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setDetail(item.subscribed ? await v2.del<WorkItem>(`/work-items/${item.id}/subscribe`) : await v2.post<WorkItem>(`/work-items/${item.id}/subscribe`));
          } catch (e) {
            toast.error(parseApiError(e).message);
          } finally {
            setBusy(false);
          }
        }}
        className="flex items-center gap-1.5 border-l border-slate-200 px-2.5 py-1 text-sm text-slate-700 hover:bg-slate-50 first:border-l-0"
      >
        {item.subscribed ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        {item.subscribed ? 'Unsubscribe' : 'Subscribe'}
      </button>
    </div>
  );
}
