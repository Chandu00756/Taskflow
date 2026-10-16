import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The TaskFlow mark: a "T" whose stem flows into an arrow — work moving
 * forward. Same artwork as app/icon.svg (the browser tab icon).
 */
export function LogoMark({ size = 32, className, title, animated = false }: { size?: number; className?: string; title?: string; animated?: boolean }) {
  const id = React.useId().replace(/:/g, '');
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={cn('shrink-0', className)}
    >
      <defs>
        <linearGradient id={`tf-bg-${id}`} x1="4" y1="2" x2="60" y2="62" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#4F46E5" />
          <stop offset="0.5" stopColor="#0EA5E9" />
          <stop offset="1" stopColor="#10B981" />
          {animated && <animateTransform attributeName="gradientTransform" type="rotate" values="0 32 32;360 32 32" dur="14s" repeatCount="indefinite" />}
        </linearGradient>
        <radialGradient id={`tf-glow-${id}`} cx="16" cy="10" r="44" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".32" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="18" fill={`url(#tf-bg-${id})`} />
      <rect width="64" height="64" rx="18" fill={`url(#tf-glow-${id})`} />
      <g fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" strokeWidth="6">
        {/* Animated: a 7s loop. The T writes itself in, a pulse of light runs
            down into the arrow, then the mark flows out and writes itself again. */}
        <path d="M13 16h30" pathLength={1} className={animated ? 'tf-draw' : undefined} />
        <path d="M28 16v10c0 9 5.5 15 14.5 15H51" pathLength={1} className={animated ? 'tf-draw tf-draw-2' : undefined} />
        <path d="M44 33.5 51.5 41 44 48.5" pathLength={1} className={animated ? 'tf-draw tf-draw-3' : undefined} />
      </g>
      {animated && (
        <path d="M28 16v10c0 9 5.5 15 14.5 15H51" pathLength={1} fill="none" stroke="#e0f2fe" strokeWidth="3.6" strokeLinecap="round" className="tf-pulse" style={{ filter: 'drop-shadow(0 0 3px rgba(255,255,255,.9))' }} />
      )}
    </svg>
  );
}

/** Mark plus "TaskFlow" wordmark, with an optional line underneath. */
export function Logo({ size = 'md', subtitle, className }: { size?: 'sm' | 'md' | 'lg'; subtitle?: string; className?: string }) {
  const mark = { sm: 28, md: 36, lg: 48 }[size];
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark size={mark} className="drop-shadow-[0_6px_14px_rgba(37,99,235,0.35)]" />
      <span className="leading-tight">
        <span className={cn('block font-semibold tracking-tight text-slate-900', size === 'lg' ? 'text-2xl' : size === 'md' ? 'text-lg' : 'text-base')}>
          Task<GradientWord>Flow</GradientWord>
        </span>
        {subtitle && <span className="block text-[11px] font-medium uppercase tracking-[0.18em] text-slate-500">{subtitle}</span>}
      </span>
    </span>
  );
}

/**
 * Gradient text with the gradient set inline, so the word stays visible even
 * before stylesheets load; a solid colour shows where clipping is unsupported.
 */
export function GradientWord({ children, shine = false, className }: { children: React.ReactNode; shine?: boolean; className?: string }) {
  return (
    <span
      className={cn('tf-gradient-word inline-block', shine && 'tf-shine', className)}
      style={{
        color: '#0ea5e9',
        backgroundImage: 'linear-gradient(90deg, #4f46e5, #0ea5e9, #10b981, #0ea5e9, #4f46e5)',
        backgroundSize: '200% 100%',
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
      }}
    >
      {children}
    </span>
  );
}
