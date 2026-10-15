import * as React from 'react';

// A deliberately small Markdown renderer that produces React elements
// directly. Raw HTML is never interpreted, so user content cannot inject
// markup or scripts. Supports headings, paragraphs, lists, block quotes,
// fenced code, inline code, bold, italic and safe links.

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Order matters: code spans first so their contents are not formatted.
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|(\[[^\]]+\]\([^)\s]+\))|(https?:\/\/[^\s<]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyPrefix}-${i++}`;
    if (m[1]) {
      out.push(
        <code key={key} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-rose-700">
          {tok.slice(1, -1)}
        </code>
      );
    } else if (m[2]) {
      out.push(<strong key={key}>{renderInline(tok.slice(2, -2), key)}</strong>);
    } else if (m[3]) {
      out.push(<em key={key}>{renderInline(tok.slice(1, -1), key)}</em>);
    } else if (m[4]) {
      const label = tok.slice(1, tok.indexOf(']'));
      const href = tok.slice(tok.indexOf('(') + 1, -1);
      out.push(
        SAFE_URL.test(href) ? (
          <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow" className="text-blue-600 underline hover:text-blue-700">
            {label}
          </a>
        ) : (
          label
        )
      );
    } else if (m[5]) {
      const url = tok.replace(/[).,;:!?]+$/, '');
      out.push(
        <a key={key} href={url} target="_blank" rel="noopener noreferrer nofollow" className="break-all text-blue-600 underline hover:text-blue-700">
          {url}
        </a>
      );
      if (url.length < tok.length) out.push(tok.slice(url.length));
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function withBreaks(lines: string[], key: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push(<br key={`${key}-br-${i}`} />);
    out.push(...renderInline(line, `${key}-${i}`));
  });
  return out;
}

export function Markdown({ text, className }: { text?: string | null; className?: string }) {
  const blocks = React.useMemo(() => parseBlocks(text ?? ''), [text]);
  if (!text || !text.trim()) {
    return <p className="text-sm italic text-slate-400">No description provided.</p>;
  }
  return <div className={className ?? 'space-y-3 text-sm leading-relaxed text-slate-800'}>{blocks}</div>;
}

function parseBlocks(src: string): React.ReactNode[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  const out: React.ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    const key = `b${k++}`;
    if (!line.trim()) {
      i++;
      continue;
    }
    if (line.startsWith('```')) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) code.push(lines[i++]);
      i++;
      out.push(
        <pre key={key} className="overflow-x-auto rounded-md bg-slate-900 p-3 font-mono text-xs text-slate-100">
          {code.join('\n')}
        </pre>
      );
      continue;
    }
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const cls = ['text-lg font-semibold', 'text-base font-semibold', 'text-sm font-semibold', 'text-sm font-semibold'][level - 1];
      out.push(
        React.createElement(`h${level + 1}`, { key, className: `${cls} text-slate-900` }, renderInline(h[2], key))
      );
      i++;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ''));
      out.push(
        <ul key={key} className="list-disc space-y-1 pl-5">
          {items.map((it, j) => (
            <li key={j}>{renderInline(it, `${key}-${j}`)}</li>
          ))}
        </ul>
      );
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ''));
      out.push(
        <ol key={key} className="list-decimal space-y-1 pl-5">
          {items.map((it, j) => (
            <li key={j}>{renderInline(it, `${key}-${j}`)}</li>
          ))}
        </ol>
      );
      continue;
    }
    if (line.startsWith('>')) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith('>')) quote.push(lines[i++].replace(/^>\s?/, ''));
      out.push(
        <blockquote key={key} className="border-l-4 border-slate-200 pl-3 text-slate-600">
          {withBreaks(quote, key)}
        </blockquote>
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\s*[-*]\s|\s*\d+[.)]\s|>)/.test(lines[i])) para.push(lines[i++]);
    if (para.length === 0) {
      para.push(lines[i++]);
    }
    out.push(
      <p key={key} className="whitespace-pre-wrap break-words">
        {withBreaks(para, key)}
      </p>
    );
  }
  return out;
}
