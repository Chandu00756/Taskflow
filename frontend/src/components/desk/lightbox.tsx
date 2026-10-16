'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, Download, FileText, ImageOff, X, ZoomIn, ZoomOut } from 'lucide-react';
import { toast } from 'sonner';
import { apiClient } from '@/lib/api';
import { downloadFile, parseApiError } from '@/lib/itsm/api';
import { fmtBytes } from '@/lib/itsm/format';
import type { Attachment } from '@/lib/itsm/types';
import { cn } from '@/lib/utils';

/** Images (and PDFs) open in the viewer; other files download. */
export const isImage = (a: Pick<Attachment, 'content_type'>) => (a.content_type || '').startsWith('image/');
export const isPdf = (a: Pick<Attachment, 'content_type'>) => a.content_type === 'application/pdf';
export const isPreviewable = (a: Pick<Attachment, 'content_type'>) => isImage(a) || isPdf(a);

// Attachments need the signed-in session, so previews are fetched as blobs and
// kept for the rest of the visit.
const blobCache = new Map<string, Promise<string>>();

export function attachmentUrl(id: string): Promise<string> {
  let p = blobCache.get(id);
  if (!p) {
    p = apiClient.get<Blob>(`/api/v2/attachments/${id}`, { responseType: 'blob' }).then((b) => URL.createObjectURL(b as Blob));
    p.catch(() => blobCache.delete(id));
    blobCache.set(id, p);
  }
  return p;
}

export function useAttachmentUrl(id: string | null) {
  const [state, setState] = React.useState<{ url?: string; error?: boolean }>({});
  React.useEffect(() => {
    if (!id) return;
    let live = true;
    setState({});
    attachmentUrl(id).then(
      (url) => live && setState({ url }),
      () => live && setState({ error: true })
    );
    return () => {
      live = false;
    };
  }, [id]);
  return state;
}

/** Thumbnail tile for an image or PDF attachment. */
export function AttachmentThumb({ a, onOpen, size = 'md' }: { a: Attachment; onOpen: () => void; size?: 'sm' | 'md' }) {
  const img = isImage(a);
  const { url, error } = useAttachmentUrl(img ? a.id : null);
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${a.name} · ${fmtBytes(a.size)}`}
      className={cn('group relative overflow-hidden rounded-lg border border-slate-200 bg-slate-50 text-left transition hover:border-blue-400 hover:shadow', size === 'md' ? 'h-24 w-32' : 'h-16 w-20')}
    >
      {img ? (
        url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={a.name} className="h-full w-full object-cover transition group-hover:scale-[1.03]" />
        ) : error ? (
          <span className="flex h-full items-center justify-center text-slate-400"><ImageOff className="h-5 w-5" /></span>
        ) : (
          <span className="block h-full w-full animate-pulse bg-slate-100" />
        )
      ) : (
        <span className="flex h-full flex-col items-center justify-center gap-1 text-rose-600">
          <FileText className="h-6 w-6" />
          <span className="text-[10px] font-semibold uppercase">PDF</span>
        </span>
      )}
      <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-1 pt-3 text-[10px] text-white opacity-0 transition group-hover:opacity-100">{a.name}</span>
    </button>
  );
}

/** Full-screen viewer for image and PDF attachments, with arrow-key navigation. */
export function Lightbox({ items, index, onIndex, onClose }: { items: Attachment[]; index: number; onIndex: (i: number) => void; onClose: () => void }) {
  const a = items[index];
  const { url, error } = useAttachmentUrl(a?.id ?? null);
  const [zoom, setZoom] = React.useState(false);
  React.useEffect(() => setZoom(false), [index]);
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      } else if (e.key === 'ArrowRight' && items.length > 1) onIndex((index + 1) % items.length);
      else if (e.key === 'ArrowLeft' && items.length > 1) onIndex((index - 1 + items.length) % items.length);
    };
    // Capture so the viewer closes before panels underneath react to Escape.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [index, items.length, onClose, onIndex]);
  if (!a || typeof document === 'undefined') return null;
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`Preview of ${a.name}`} className="fixed inset-0 z-[90] flex flex-col bg-black/85 backdrop-blur-sm" onMouseDown={onClose}>
      <div className="flex items-center gap-3 px-4 py-3 text-sm text-white/90" onMouseDown={(e) => e.stopPropagation()}>
        <span className="min-w-0 truncate font-medium">{a.name}</span>
        <span className="shrink-0 text-white/50">{fmtBytes(a.size)}</span>
        {items.length > 1 && <span className="shrink-0 text-white/50">{index + 1} / {items.length}</span>}
        <div className="ml-auto flex items-center gap-1">
          {isImage(a) && (
            <button type="button" onClick={() => setZoom((z) => !z)} aria-label={zoom ? 'Fit to screen' : 'Zoom in'} className="rounded p-2 hover:bg-white/10">
              {zoom ? <ZoomOut className="h-5 w-5" /> : <ZoomIn className="h-5 w-5" />}
            </button>
          )}
          <button type="button" onClick={() => downloadFile(`/attachments/${a.id}`, a.name).catch((e) => toast.error(parseApiError(e).message))} aria-label="Download" className="rounded p-2 hover:bg-white/10">
            <Download className="h-5 w-5" />
          </button>
          <button type="button" onClick={onClose} aria-label="Close preview" className="rounded p-2 hover:bg-white/10">
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
      <div className={cn('relative flex min-h-0 flex-1 items-center justify-center px-14 pb-6', zoom && 'overflow-auto')}>
        {items.length > 1 && (
          <button type="button" onMouseDown={(e) => e.stopPropagation()} onClick={() => onIndex((index - 1 + items.length) % items.length)} aria-label="Previous" className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
            <ChevronLeft className="h-6 w-6" />
          </button>
        )}
        {error ? (
          <p className="text-sm text-white/80">This file could not be loaded.</p>
        ) : !url ? (
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-white/30 border-t-white" />
        ) : isImage(a) ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt={a.name}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => setZoom((z) => !z)}
            className={cn('select-none rounded shadow-2xl', zoom ? 'max-w-none cursor-zoom-out' : 'max-h-full max-w-full cursor-zoom-in object-contain')}
          />
        ) : (
          <iframe src={url} title={a.name} onMouseDown={(e) => e.stopPropagation()} className="h-full w-full max-w-5xl rounded bg-white" />
        )}
        {items.length > 1 && (
          <button type="button" onMouseDown={(e) => e.stopPropagation()} onClick={() => onIndex((index + 1) % items.length)} aria-label="Next" className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20">
            <ChevronRight className="h-6 w-6" />
          </button>
        )}
      </div>
    </div>,
    document.body
  );
}
