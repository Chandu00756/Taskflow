'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import type { ConfettiProps } from 'react-confetti';
import { currentTheme, onCelebrate, themeInfo, type CelebrationSize } from '@/lib/theme';

const Confetti = dynamic<ConfettiProps>(() => import('react-confetti'), { ssr: false });

const PIECES: Record<CelebrationSize, number> = { small: 160, big: 420 };

/** Renders a one-shot confetti burst whenever celebrate() is called anywhere in the app. */
export function Celebrations() {
  const [burst, setBurst] = React.useState<{ id: number; size: CelebrationSize } | null>(null);
  const [viewport, setViewport] = React.useState({ width: 0, height: 0 });

  React.useEffect(
    () =>
      onCelebrate((size) => {
        setViewport({ width: window.innerWidth, height: window.innerHeight });
        setBurst({ id: Date.now(), size });
      }),
    []
  );

  if (!burst) return null;
  const { width, height } = viewport;
  const big = burst.size === 'big';
  // Pieces spawn almost at once and launch upward, then fall: a burst rather than a drizzle.
  const source = big ? { x: width * 0.1, y: height * 0.7, w: width * 0.8, h: 0 } : { x: width / 2 - 140, y: height * 0.55, w: 280, h: 0 };
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[70]">
      <Confetti
        key={burst.id}
        width={width}
        height={height}
        recycle={false}
        numberOfPieces={PIECES[burst.size]}
        tweenDuration={big ? 400 : 200}
        gravity={0.32}
        initialVelocityX={{ min: big ? -14 : -9, max: big ? 14 : 9 }}
        initialVelocityY={{ min: big ? -26 : -20, max: big ? -12 : -9 }}
        colors={themeInfo(currentTheme()).confetti}
        confettiSource={source}
        onConfettiComplete={() => setBurst((b) => (b?.id === burst.id ? null : b))}
      />
    </div>
  );
}
