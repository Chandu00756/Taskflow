'use client';

import * as React from 'react';

export type ThemeId = 'glass' | 'classic' | 'dark' | 'crimson';

export interface ThemeInfo {
  id: ThemeId;
  name: string;
  description: string;
  /** Colors used for the picker preview: sidebar, accent, page, surface. */
  preview: { sidebar: string; accent: string; page: string; surface: string; text: string };
  confetti: string[];
}

export const THEMES: ThemeInfo[] = [
  {
    id: 'glass',
    name: 'Glass',
    description: 'Frosted glass panels over a soft aurora, with gradient accents. The original TaskFlow look, refined.',
    preview: { sidebar: 'rgba(255,255,255,0.7)', accent: 'linear-gradient(90deg,#3b82f6,#0ea5e9,#34d399)', page: 'linear-gradient(135deg,#e0f2fe,#f8fbff,#ecfeff)', surface: 'rgba(255,255,255,0.75)', text: '#0f172a' },
    confetti: ['#3b82f6', '#0ea5e9', '#34d399', '#a78bfa', '#f472b6', '#fbbf24'],
  },
  {
    id: 'classic',
    name: 'Classic',
    description: 'Clean, high-contrast service desk with a dark navigation rail.',
    preview: { sidebar: '#0f172a', accent: '#2563eb', page: '#f8fafc', surface: '#ffffff', text: '#0f172a' },
    confetti: ['#2563eb', '#10b981', '#f59e0b', '#64748b'],
  },
  {
    id: 'dark',
    name: 'Dark',
    description: 'Low-glare surfaces for late shifts and dim rooms.',
    preview: { sidebar: '#020617', accent: '#3b82f6', page: '#020617', surface: '#0f172a', text: '#f1f5f9' },
    confetti: ['#60a5fa', '#34d399', '#f472b6', '#facc15', '#c084fc'],
  },
  {
    id: 'crimson',
    name: 'Crimson',
    description: 'Warm neutrals with a deep crimson accent and ember highlights.',
    preview: { sidebar: 'linear-gradient(180deg,#450516,#7c1331)', accent: 'linear-gradient(90deg,#b01236,#ef3456)', page: 'linear-gradient(135deg,#fff1f2,#fffaf8,#fff7ed)', surface: '#ffffff', text: '#1c1917' },
    confetti: ['#d11a40', '#ef3456', '#f97316', '#fbbf24', '#fda4af'],
  },
];

export const DEFAULT_THEME: ThemeId = 'glass';
const THEME_KEY = 'tf-theme';
const CELEBRATE_KEY = 'tf-celebrations';
const THEME_EVENT = 'tf:theme';
const CELEBRATE_EVENT = 'tf:celebrate';

const IDS = THEMES.map((t) => t.id);

/**
 * Runs before React hydrates so the first paint already uses the saved theme.
 * It is a fixed string with no user input.
 */
export const THEME_BOOT_SCRIPT = `(function(){var t='${DEFAULT_THEME}';try{var s=localStorage.getItem('${THEME_KEY}');if(${JSON.stringify(IDS)}.indexOf(s)>=0)t=s;}catch(e){}document.documentElement.setAttribute('data-theme',t);document.documentElement.style.colorScheme=t==='dark'?'dark':'light';})();`;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: the choice lasts for this page only */
  }
}

export function currentTheme(): ThemeId {
  if (typeof document === 'undefined') return DEFAULT_THEME;
  const t = document.documentElement.getAttribute('data-theme') as ThemeId | null;
  return t && IDS.includes(t) ? t : DEFAULT_THEME;
}

export function applyTheme(id: ThemeId) {
  const root = document.documentElement;
  root.setAttribute('data-theme', id);
  root.style.colorScheme = id === 'dark' ? 'dark' : 'light';
}

export function setTheme(id: ThemeId) {
  applyTheme(id);
  write(THEME_KEY, id);
  window.dispatchEvent(new Event(THEME_EVENT));
}

function subscribeTheme(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === THEME_KEY && e.newValue && IDS.includes(e.newValue as ThemeId)) {
      applyTheme(e.newValue as ThemeId);
      cb();
    }
  };
  window.addEventListener(THEME_EVENT, cb);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(THEME_EVENT, cb);
    window.removeEventListener('storage', onStorage);
  };
}

export function useTheme(): [ThemeId, (id: ThemeId) => void] {
  const theme = React.useSyncExternalStore(subscribeTheme, currentTheme, () => DEFAULT_THEME);
  return [theme, setTheme];
}

export function themeInfo(id: ThemeId): ThemeInfo {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

// ---------------------------------------------------------------------------
// Celebrations (confetti)
// ---------------------------------------------------------------------------

export function celebrationsEnabled(): boolean {
  return read(CELEBRATE_KEY) !== 'off';
}

function subscribeCelebrations(cb: () => void) {
  window.addEventListener(THEME_EVENT, cb);
  return () => window.removeEventListener(THEME_EVENT, cb);
}

export function useCelebrations(): [boolean, (on: boolean) => void] {
  const on = React.useSyncExternalStore(subscribeCelebrations, celebrationsEnabled, () => true);
  const set = React.useCallback((v: boolean) => {
    write(CELEBRATE_KEY, v ? 'on' : 'off');
    window.dispatchEvent(new Event(THEME_EVENT));
  }, []);
  return [on, set];
}

export type CelebrationSize = 'small' | 'big';

/** Fires confetti for a win (ticket resolved, work item done…), unless turned off or reduced motion is preferred. */
export function celebrate(size: CelebrationSize = 'small') {
  if (typeof window === 'undefined' || !celebrationsEnabled()) return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  window.dispatchEvent(new CustomEvent(CELEBRATE_EVENT, { detail: { size } }));
}

export function onCelebrate(handler: (size: CelebrationSize) => void) {
  const fn = (e: Event) => handler(((e as CustomEvent).detail?.size as CelebrationSize) ?? 'small');
  window.addEventListener(CELEBRATE_EVENT, fn);
  return () => window.removeEventListener(CELEBRATE_EVENT, fn);
}
