'use client';

import * as React from 'react';

/*
 * Bot protection for the self-service sign-up forms.
 *
 * - Renders a Cloudflare Turnstile challenge when the server publishes a site
 *   key (GET /auth/config → turnstile_site_key). Its token goes to the gateway
 *   in the X-Captcha-Token header and is verified there.
 * - Renders a hidden "website" field that people never see or fill in; form
 *   fillers that do are refused by the gateway (X-Signup-Trap).
 */

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id?: string) => void;
    };
  }
}

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
let scriptPromise: Promise<void> | null = null;

function loadTurnstile(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SCRIPT_SRC;
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      s.onerror = () => {
        scriptPromise = null;
        reject(new Error('Could not load the verification check'));
      };
      document.head.appendChild(s);
    });
  }
  return scriptPromise;
}

export interface SignupShield {
  /** The widget and hidden trap field; place it inside the form. */
  element: React.ReactNode;
  /** Headers to send with the sign-up request. */
  headers: () => Record<string, string>;
  /** False while a configured challenge has not been passed yet. */
  ready: boolean;
  /** Turnstile tokens work once: call after every failed attempt. */
  reset: () => void;
}

export function useSignupShield(siteKey: string | undefined): SignupShield {
  // A state-backed ref so the widget renders whenever its box mounts (the
  // organization form shows it on its second step).
  const [box, setBox] = React.useState<HTMLDivElement | null>(null);
  const widget = React.useRef<string | null>(null);
  const [token, setToken] = React.useState('');
  const [trap, setTrap] = React.useState('');
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    if (!siteKey || !box) return;
    let cancelled = false;
    loadTurnstile()
      .then(() => {
        if (cancelled || !window.turnstile || widget.current) return;
        widget.current = window.turnstile.render(box, {
          sitekey: siteKey,
          theme: 'auto',
          action: 'signup',
          callback: (t: string) => {
            setToken(t);
            setError('');
          },
          'expired-callback': () => setToken(''),
          'error-callback': () => {
            setToken('');
            setError('The verification check could not load. Refresh the page and try again.');
          },
        });
      })
      .catch((e: Error) => setError(e.message));
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey, box]);

  const reset = React.useCallback(() => {
    setToken('');
    if (widget.current && window.turnstile) window.turnstile.reset(widget.current);
  }, []);

  const headers = React.useCallback(() => {
    const h: Record<string, string> = {};
    if (token) h['X-Captcha-Token'] = token;
    if (trap) h['X-Signup-Trap'] = trap;
    return h;
  }, [token, trap]);

  const element = (
    <>
      {/* Hidden from people and assistive tech; only bots fill it in. */}
      <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
        <label>
          Website
          <input type="text" name="website" tabIndex={-1} autoComplete="off" value={trap} onChange={(e) => setTrap(e.target.value)} />
        </label>
      </div>
      {siteKey ? (
        <div className="space-y-1">
          <div ref={setBox} className="min-h-[65px]" />
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
      ) : null}
    </>
  );

  return { element, headers, ready: !siteKey || !!token, reset };
}
