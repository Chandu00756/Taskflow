'use client';

import * as React from 'react';
import { Check, PartyPopper } from 'lucide-react';
import { cn } from '@/lib/utils';
import { THEMES, celebrate, useCelebrations, useTheme, type ThemeInfo } from '@/lib/theme';
import { Toggle } from '@/components/desk/kit';

/** A miniature of the app chrome in a theme's colors. */
function Preview({ t, small }: { t: ThemeInfo; small?: boolean }) {
  const p = t.preview;
  return (
    <div aria-hidden className={cn('flex overflow-hidden rounded-md border border-black/10', small ? 'h-8 w-12' : 'h-20 w-full')} style={{ background: p.page }}>
      <div className={cn('shrink-0', small ? 'w-3' : 'w-1/4')} style={{ background: p.sidebar }}>
        {!small && (
          <div className="space-y-1.5 p-1.5">
            <div className="h-1.5 rounded-full" style={{ background: p.accent }} />
            <div className="h-1.5 w-3/4 rounded-full opacity-40" style={{ background: p.text }} />
            <div className="h-1.5 w-2/3 rounded-full opacity-40" style={{ background: p.text }} />
          </div>
        )}
      </div>
      <div className={cn('flex-1', small ? 'p-1' : 'space-y-1.5 p-2')}>
        <div className={cn('rounded', small ? 'h-2' : 'h-3')} style={{ background: p.surface }} />
        <div className={cn('rounded', small ? 'mt-1 h-3' : 'h-8')} style={{ background: p.surface }}>
          {!small && <div className="m-1.5 h-1.5 w-1/3 rounded-full" style={{ background: p.accent }} />}
        </div>
      </div>
    </div>
  );
}

/** Compact swatches for the account menu. */
export function ThemeSwatches() {
  const [theme, setTheme] = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-4 gap-1.5">
      {THEMES.map((t) => (
        <button
          key={t.id}
          role="radio"
          aria-checked={theme === t.id}
          title={t.name}
          onClick={() => setTheme(t.id)}
          className={cn('flex flex-col items-center gap-1 rounded-md p-1 text-[11px] text-slate-600 hover:bg-slate-100', theme === t.id && 'bg-slate-100 font-semibold text-slate-900')}
        >
          <span className="relative">
            <Preview t={t} small />
            {theme === t.id && (
              <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-white">
                <Check className="h-3 w-3" />
              </span>
            )}
          </span>
          {t.name}
        </button>
      ))}
    </div>
  );
}

/** Full appearance settings for the profile page. */
export function AppearanceSettings() {
  const [theme, setTheme] = useTheme();
  const [celebrations, setCelebrations] = useCelebrations();
  return (
    <div className="space-y-5">
      <div role="radiogroup" aria-label="Theme" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {THEMES.map((t) => {
          const active = theme === t.id;
          return (
            <button
              key={t.id}
              role="radio"
              aria-checked={active}
              onClick={() => setTheme(t.id)}
              className={cn(
                'rounded-xl border p-3 text-left transition hover:border-slate-300',
                active ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-slate-200'
              )}
            >
              <Preview t={t} />
              <div className="mt-2.5 flex items-center gap-1.5">
                <span className="text-sm font-semibold text-slate-900">{t.name}</span>
                {t.id === 'glass' && <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">Default</span>}
                {active && <Check className="ml-auto h-4 w-4 text-blue-600" />}
              </div>
              <p className="mt-1 text-xs leading-relaxed text-slate-500">{t.description}</p>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
        <Toggle
          checked={celebrations}
          onChange={setCelebrations}
          label="Celebrations"
          description="Confetti when you sign in, resolve a ticket or finish a work item. Always off when your system asks for reduced motion."
        />
        <button
          type="button"
          disabled={!celebrations}
          onClick={() => celebrate('big')}
          className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-40"
        >
          <PartyPopper className="h-4 w-4" /> Preview
        </button>
      </div>
      <p className="text-xs text-slate-500">Your theme is saved in this browser and applies to the service desk, the portal and the sign-in pages.</p>
    </div>
  );
}
