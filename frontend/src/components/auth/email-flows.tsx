'use client';

import * as React from 'react';
import { useQuery } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Btn } from '@/components/desk/kit';
import { v2, parseApiError } from '@/lib/itsm/api';

export interface AuthConfig {
  email_enabled: boolean;
  email_verification: boolean;
}

/** Which email features (verification links, reset links) the server has turned on. */
export function useAuthConfig() {
  return useQuery({
    queryKey: ['auth-config'],
    queryFn: () => v2.get<AuthConfig>('/auth/config'),
    staleTime: 5 * 60_000,
    retry: 1,
  });
}

/** True when an error from sign-in means the address still needs verifying. */
export function isUnverifiedError(message: string): boolean {
  return /verify your email/i.test(message);
}

/** Asks the server for a fresh verification link; the answer never reveals whether the account exists. */
export async function sendVerificationLink(email: string): Promise<void> {
  await v2.post('/auth/verify-email/send', { email: email.trim() });
}

/** Button that resends the verification link, with a cooldown matching the server's one-per-minute limit. */
export function ResendVerification({ email, label = 'Resend verification email', className }: { email: string; label?: string; className?: string }) {
  const [busy, setBusy] = React.useState(false);
  const [wait, setWait] = React.useState(0);
  React.useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
  return (
    <Btn
      variant="secondary"
      className={className}
      loading={busy}
      disabled={wait > 0 || !email.trim()}
      onClick={async () => {
        setBusy(true);
        try {
          await sendVerificationLink(email);
          toast.success(`If ${email.trim()} still needs verifying, a new link is on its way.`);
          setWait(60);
        } catch (e) {
          toast.error(parseApiError(e).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {wait > 0 ? `Resend available in ${wait}s` : label}
    </Btn>
  );
}

/** Shown after sign-up when the new account must confirm its email before signing in. */
export function CheckInbox({ email, children }: { email: string; children?: React.ReactNode }) {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
        <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
        <div>
          <p className="font-medium">Check your inbox</p>
          <p className="mt-1">
            We sent a verification link to <span className="font-semibold">{email}</span>. Open it to activate your account, then sign in. The link expires in 48 hours.
          </p>
          <p className="mt-2 text-blue-800/80">Nothing there? Check your spam folder, or send a new link.</p>
        </div>
      </div>
      <ResendVerification email={email} className="w-full" />
      {children}
    </div>
  );
}
