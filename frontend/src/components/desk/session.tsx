'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { v2 } from '@/lib/itsm/api';

/** Set during an explicit sign-out so auth guards don't add a ?next= redirect. */
export const signOutState = { active: false };

export function useHydrated() {
  const [hydrated, setHydrated] = React.useState(false);
  React.useEffect(() => setHydrated(true), []);
  return hydrated;
}

export function useSignOut() {
  const router = useRouter();
  const qc = useQueryClient();
  return React.useCallback(
    async (reason?: string) => {
      signOutState.active = true;
      const refresh = useAuthStore.getState().refreshToken;
      if (refresh) {
        try {
          await v2.post('/auth/logout', { refresh_token: refresh });
        } catch {
          // best effort
        }
      }
      useAuthStore.getState().logout();
      qc.clear();
      router.replace(reason ? `/login?${reason}=1` : '/login');
    },
    [router, qc]
  );
}

/** Signs the user out after a period without keyboard or pointer activity. */
export function useIdleLogout(minutes: number | undefined) {
  const signOut = useSignOut();
  React.useEffect(() => {
    if (!minutes || minutes <= 0) return;
    const limit = minutes * 60_000;
    let last = Date.now();
    const bump = () => {
      last = Date.now();
    };
    const events = ['mousemove', 'keydown', 'mousedown', 'touchstart', 'scroll'];
    events.forEach((e) => window.addEventListener(e, bump, { passive: true }));
    const timer = setInterval(() => {
      if (Date.now() - last > limit) signOut('idle');
    }, 30_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, bump));
      clearInterval(timer);
    };
  }, [minutes, signOut]);
}
