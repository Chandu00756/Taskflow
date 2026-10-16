'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery } from '@tanstack/react-query';
import { XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { AuthLayout, PasswordRules, passwordValid } from '@/components/auth/auth-layout';
import { Btn, Field, TextInput } from '@/components/desk/kit';
import { v2, parseApiError } from '@/lib/itsm/api';
import { celebrate } from '@/lib/theme';

function Activate() {
  const router = useRouter();
  const sp = useSearchParams();
  const token = sp.get('token') ?? '';
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState('');

  const check = useQuery({
    queryKey: ['activate-link', token],
    queryFn: () => v2.post<{ email: string; name: string; organization: string }>('/auth/activate/check', { token }),
    enabled: !!token,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const activate = useMutation({
    mutationFn: () => v2.post<{ message: string; email: string }>('/auth/activate', { token, new_password: password }),
    onSuccess: (res) => {
      celebrate('big');
      toast.success(res.message);
      router.replace(`/login?email=${encodeURIComponent(res.email)}`);
    },
    onError: (e) => setError(parseApiError(e).message),
  });

  const info = check.data;
  return (
    <AuthLayout
      title={info ? `Welcome, ${info.name.split(' ')[0]}` : 'Activate your account'}
      subtitle={info ? `Choose a password to join ${info.organization || 'TaskFlow'} as ${info.email}.` : undefined}
      footer={
        <Link href="/login" className="font-medium text-blue-600 hover:text-blue-700">
          Back to sign in
        </Link>
      }
    >
      {!token || check.isError ? (
        <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
          <p>{token ? parseApiError(check.error).message : 'This page needs the link from your invitation email.'}</p>
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
            activate.mutate();
          }}
        >
          <input type="email" autoComplete="username" value={info?.email ?? ''} readOnly hidden />
          <Field label="Password">
            <TextInput type="password" autoFocus autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <PasswordRules password={password} />
          </Field>
          <Field label="Confirm password">
            <TextInput type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {error && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
          <Btn type="submit" variant="primary" className="w-full" loading={activate.isPending}>
            Activate account
          </Btn>
          <p className="text-xs text-slate-500">Activating confirms that {info?.email} belongs to you.</p>
        </form>
      )}
    </AuthLayout>
  );
}

export default function ActivatePage() {
  return (
    <React.Suspense fallback={null}>
      <Activate />
    </React.Suspense>
  );
}
