'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { XCircle } from 'lucide-react';
import { AuthLayout, PasswordRules, passwordValid } from '@/components/auth/auth-layout';
import { Btn, Field, LinkBtn, TextInput } from '@/components/desk/kit';
import { v2, parseApiError } from '@/lib/itsm/api';

function ResetPassword() {
  const router = useRouter();
  const sp = useSearchParams();
  const token = sp.get('token') ?? '';
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState('');

  const check = useQuery({
    queryKey: ['reset-link', token],
    queryFn: () => v2.post<{ email: string }>('/auth/forgot/email/check', { token }),
    enabled: !!token,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const reset = useMutation({
    mutationFn: () => v2.post('/auth/forgot/email/reset', { token, new_password: password }),
    onSuccess: () => router.replace(`/login?reset=1${check.data ? `&email=${encodeURIComponent(check.data.email)}` : ''}`),
    onError: (e) => setError(parseApiError(e).message),
  });

  const invalid = !token || check.isError;
  return (
    <AuthLayout
      title="Choose a new password"
      subtitle={check.data ? `For ${check.data.email}` : undefined}
      footer={
        <Link href="/login" className="font-medium text-blue-600 hover:text-blue-700">
          Back to sign in
        </Link>
      }
    >
      {invalid ? (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
            <p>{token ? parseApiError(check.error).message : 'This page needs the link from your password reset email.'}</p>
          </div>
          <LinkBtn href="/forgot-password" variant="primary" className="w-full">
            Request a new link
          </LinkBtn>
        </div>
      ) : check.isPending ? (
        <div className="h-40 animate-pulse rounded-xl bg-slate-100" />
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError('');
            if (!passwordValid(password, {})) return setError('Choose a password with at least 8 characters.');
            if (password !== confirm) return setError('Passwords do not match.');
            reset.mutate();
          }}
        >
          <input type="email" autoComplete="username" value={check.data?.email ?? ''} readOnly hidden />
          <Field label="New password">
            <TextInput type="password" autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <PasswordRules password={password} />
          </Field>
          <Field label="Confirm new password">
            <TextInput type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {error && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
          <Btn type="submit" variant="primary" className="w-full" loading={reset.isPending}>
            Set new password
          </Btn>
          <p className="text-xs text-slate-500">Changing your password signs you out on every device.</p>
        </form>
      )}
    </AuthLayout>
  );
}

export default function ResetPasswordPage() {
  return (
    <React.Suspense fallback={null}>
      <ResetPassword />
    </React.Suspense>
  );
}
