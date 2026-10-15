'use client';

import { cn } from '@/lib/utils';
import type { WorkItemPriority, WorkItemState } from '@/lib/itsm/types';

/** Plane-style state glyphs: dashed backlog, empty todo, half-filled in progress, check for done. */
export function StateIcon({ state, className }: { state: WorkItemState | string; className?: string }) {
  const cls = cn('h-4 w-4 shrink-0', className);
  switch (state) {
    case 'backlog':
      return (
        <svg viewBox="0 0 16 16" className={cls} aria-hidden>
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="2.2 2.2" />
        </svg>
      );
    case 'todo':
      return (
        <svg viewBox="0 0 16 16" className={cls} aria-hidden>
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="#94a3b8" strokeWidth="1.5" />
        </svg>
      );
    case 'in_progress':
      return (
        <svg viewBox="0 0 16 16" className={cls} aria-hidden>
          <circle cx="8" cy="8" r="6.25" fill="none" stroke="#f59e0b" strokeWidth="1.5" />
          <path d="M8 3.5 A4.5 4.5 0 0 1 8 12.5 Z" fill="#f59e0b" />
        </svg>
      );
    case 'done':
      return (
        <svg viewBox="0 0 16 16" className={cls} aria-hidden>
          <circle cx="8" cy="8" r="7" fill="#16a34a" />
          <path d="M5 8.2 7.1 10.3 11 6.2" fill="none" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'cancelled':
      return (
        <svg viewBox="0 0 16 16" className={cls} aria-hidden>
          <circle cx="8" cy="8" r="7" fill="#94a3b8" />
          <path d="M5.8 5.8l4.4 4.4M10.2 5.8l-4.4 4.4" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      );
    default:
      return <span className={cls} />;
  }
}

/** Signal-bar priority glyphs with a red alert square for urgent. */
export function PriorityIcon({ priority, className }: { priority: WorkItemPriority | string; className?: string }) {
  const cls = cn('h-4 w-4 shrink-0', className);
  if (priority === 'urgent') {
    return (
      <svg viewBox="0 0 16 16" className={cls} aria-hidden>
        <rect x="1.5" y="1.5" width="13" height="13" rx="3" fill="#dc2626" />
        <path d="M8 4.5v4.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" />
        <circle cx="8" cy="11.4" r="1" fill="#fff" />
      </svg>
    );
  }
  if (priority === 'none' || !priority) {
    return (
      <svg viewBox="0 0 16 16" className={cls} aria-hidden>
        <path d="M3 8h10" stroke="#94a3b8" strokeWidth="1.6" strokeLinecap="round" strokeDasharray="2 2.5" />
      </svg>
    );
  }
  const level = priority === 'high' ? 3 : priority === 'medium' ? 2 : 1;
  const color = priority === 'high' ? '#ea580c' : priority === 'medium' ? '#ca8a04' : '#2563eb';
  return (
    <svg viewBox="0 0 16 16" className={cls} aria-hidden>
      {[0, 1, 2].map((i) => (
        <rect key={i} x={2.5 + i * 4} y={10 - i * 3} width="3" height={4 + i * 3} rx="0.8" fill={i < level ? color : '#cbd5e1'} />
      ))}
    </svg>
  );
}
