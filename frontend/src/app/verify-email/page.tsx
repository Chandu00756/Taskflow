'use client';

import * as React from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';
import { AuthLayout } from '@/components/auth/auth-layout';
import { ResendVerification } from '@/components/auth/email-flows';
import { Field, LinkBtn, TextInput } from '@/components/desk/kit';
import { v2, parseApiError } from '@/lib/itsm/api';
import { celebrate } from '@/lib/theme';

type State = { kind: 'checking' } | { kind: 'done'; message: string; email: string } | { kind: 'failed'; message: string };

function VerifyEmail() {
  const sp = useSearchParams();
  const token = sp.get('token') ?? '';
  const [state, setState] = React.useState<State>({ kind: 'checking' });
  const [email, setEmail] = React.useState('');
  const ran = React.useRef(false);

  React.useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setState({ kind: 'failed', message: 'This page needs the link from your verification email.' });
      return;
    }
    v2.post<{ message: string; email: string }>('/auth/verify-email', { token })
      .then((res) => {
        setState({ kind: 'done', message: res.message, email: res.email });
        celebrate('big');
      })
      .catch((e) => setState({ kind: 'failed', message: parseApiError(e).message }));
  }, [token]);

  return (
    <AuthLayout
      title="Verify your email"
      subtitle={state.kind === 'checking' ? 'Confirming your address…' : undefined}
      footer={
        <Link href="/login" className="font-medium text-blue-600 hover:text-blue-700">
          Back to sign in
        </Link>
      }
    >
      {state.kind === 'checking' && <div className="h-24 animate-pulse rounded-xl bg-slate-100" />}
      {state.kind === 'done' && (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
            <p>{state.message}</p>
          </div>
          <LinkBtn href={`/login?email=${encodeURIComponent(state.email)}`} variant="primary" className="w-full">
            Sign in
          </LinkBtn>
        </div>
      )}
      {state.kind === 'failed' && (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
            <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
            <p>{state.message}</p>
          </div>
          <Field label="Your email">
            <TextInput type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" />
          </Field>
          <ResendVerification email={email} label="Send a new link" className="w-full" />
        </div>
      )}
    </AuthLayout>
  );
}

export default function VerifyEmailPage() {
  return (
    <React.Suspense fallback={null}>
      <VerifyEmail />
    </React.Suspense>
  );
}
