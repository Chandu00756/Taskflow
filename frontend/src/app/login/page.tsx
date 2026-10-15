'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import { authAPI } from '@/lib/api';
import { parseJwt } from '@/lib/jwt';
import { useAuthStore } from '@/store/auth';
import { v2, parseApiError } from '@/lib/itsm/api';
import type { Me } from '@/lib/itsm/types';
import { AuthLayout } from '@/components/auth/auth-layout';
import { isUnverifiedError, ResendVerification } from '@/components/auth/email-flows';
import { signOutState } from '@/components/desk/session';
import { Btn, Field, TextInput } from '@/components/desk/kit';
import { celebrate } from '@/lib/theme';

/** Only same-origin relative paths are honored as post-login redirects. */
function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/login')) return null;
  return next;
}

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const setAuth = useAuthStore((s) => s.setAuth);
  const setTokens = useAuthStore((s) => s.setTokens);
  const [email, setEmail] = React.useState(() => sp.get('email') ?? '');
  const [password, setPassword] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [error, setError] = React.useState('');
  const [unverified, setUnverified] = React.useState(false);
  const next = safeNext(sp.get('next'));
  React.useEffect(() => {
    signOutState.active = false;
  }, []);

  const login = useMutation({
    mutationFn: () => authAPI.login({ email: email.trim(), password }),
    onSuccess: async (data) => {
      const raw = data as unknown as Record<string, unknown>;
      const access = (raw.access_token || raw.accessToken) as string | undefined;
      const refresh = (raw.refresh_token || raw.refreshToken) as string | undefined;
      if (!access) {
        setError('Sign in failed. Please try again.');
        return;
      }
      const claims = parseJwt(access);
      celebrate('big');
      setAuth({ ...data.user, id: (data.user as unknown as { user_id?: string }).user_id ?? data.user.id, org_id: claims?.org_id || '', role: claims?.role || '' }, access, refresh ?? '');
      // Exchange the sign-in refresh token once so this device appears under
      // "Active sessions" and can be signed out remotely.
      if (refresh) {
        try {
          const pair = await v2.post<{ access_token: string; refresh_token: string }>('/auth/refresh', { refresh_token: refresh });
          setTokens(pair.access_token, pair.refresh_token);
        } catch {
          /* keep the sign-in tokens */
        }
      }
      if (claims?.role === 'super_admin') {
        router.replace('/admin/global');
        return;
      }
      if (raw.must_set_security_questions || raw.mustSetSecurityQuestions) {
        if (raw.must_change_password || raw.mustChangePassword) localStorage.setItem('must_change_password', 'true');
        router.replace('/set-security-questions');
        return;
      }
      if (raw.must_change_password || raw.mustChangePassword) {
        router.replace('/change-password');
        return;
      }
      try {
        const me = await v2.get<Me>('/me');
        toast.success(`Welcome back, ${me.user.name.split(' ')[0]}`);
        router.replace(next ?? (me.is_agent ? '/dashboard' : '/portal'));
      } catch {
        router.replace(next ?? '/dashboard');
      }
    },
    onError: (e) => {
      const message = parseApiError(e).message;
      setUnverified(isUnverifiedError(message));
      setError(message);
    },
  });

  const notice = sp.get('expired') ? 'Your session expired. Please sign in again.' : sp.get('idle') ? 'You were signed out after a period of inactivity.' : sp.get('reset') ? 'Password updated. Sign in with your new password.' : null;

  return (
    <AuthLayout
      title="Sign in"
      subtitle="Use your work email to access the service desk."
      footer={
        <>
          New to TaskFlow?{' '}
          <Link href="/register/organization" className="font-medium text-blue-600 hover:text-blue-700">
            Create an organization
          </Link>
        </>
      }
    >
      {notice && <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800">{notice}</div>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          setUnverified(false);
          if (!email.trim() || !password) {
            setError('Enter your email and password.');
            return;
          }
          login.mutate();
        }}
        className="space-y-4"
      >
        <Field label="Work email">
          <TextInput type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoFocus={!email} />
        </Field>
        <Field
          label={
            <span className="flex items-center justify-between">
              Password
              <Link href="/forgot-password" className="text-xs font-medium text-blue-600 hover:text-blue-700">
                Forgot password?
              </Link>
            </span>
          }
        >
          <div className="relative">
            <TextInput type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="pr-10" autoFocus={!!email} />
            <button type="button" aria-label={show ? 'Hide password' : 'Show password'} onClick={() => setShow((v) => !v)} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700">
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </Field>
        {error && !unverified && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
        {unverified && (
          <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
            <p>{error}</p>
            <ResendVerification email={email} className="w-full" />
          </div>
        )}
        <Btn type="submit" variant="primary" className="w-full" loading={login.isPending}>
          Sign in
        </Btn>
      </form>
    </AuthLayout>
  );
}

export default function LoginPage() {
  return (
    <React.Suspense fallback={null}>
      <LoginForm />
    </React.Suspense>
  );
}
