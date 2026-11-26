'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Eye, EyeOff, KeyRound, Fingerprint, ShieldCheck, Copy, Download, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { parseJwt } from '@/lib/jwt';
import { useAuthStore } from '@/store/auth';
import { v2, parseApiError } from '@/lib/itsm/api';
import type { Me } from '@/lib/itsm/types';
import { AuthLayout } from '@/components/auth/auth-layout';
import { isUnverifiedError, ResendVerification } from '@/components/auth/email-flows';
import { signOutState } from '@/components/desk/session';
import { Btn, Field, TextInput } from '@/components/desk/kit';
import { celebrate } from '@/lib/theme';
import { createPasskey, defaultPasskeyName, passkeyErrorMessage, passkeysSupported, signWithPasskey } from '@/lib/passkeys';

/** Only same-origin relative paths are honored as post-login redirects. */
function safeNext(next: string | null): string | null {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/login')) return null;
  return next;
}

interface LoginResult {
  access_token?: string;
  refresh_token?: string;
  user?: { id: string; user_id: string; email: string; username: string; full_name: string; role: string; org_id: string };
  must_change_password?: boolean;
  must_set_security_questions?: boolean;
  recovery_codes?: string[];
  warning?: string;
  passkey_required?: boolean;
  passkey_setup_required?: boolean;
  email_code_required?: boolean;
  step_token?: string;
}

interface Ceremony {
  challenge_id: string;
  options: Record<string, any>;
}

type Stage = 'password' | 'passkey' | 'recovery' | 'setup' | 'codes';

function LoginForm() {
  const router = useRouter();
  const sp = useSearchParams();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [stage, setStage] = React.useState<Stage>('password');
  const [email, setEmail] = React.useState(() => sp.get('email') ?? '');
  const [password, setPassword] = React.useState('');
  const [show, setShow] = React.useState(false);
  const [error, setError] = React.useState('');
  const [unverified, setUnverified] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [step, setStep] = React.useState('');
  const [needsCode, setNeedsCode] = React.useState(false);
  const [emailCode, setEmailCode] = React.useState('');
  const [recovery, setRecovery] = React.useState('');
  const [pending, setPending] = React.useState<LoginResult | null>(null);
  const next = safeNext(sp.get('next'));
  React.useEffect(() => {
    signOutState.active = false;
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setError('');
    setUnverified(false);
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      const raw = e as { name?: string };
      const message = raw?.name && /Error$/.test(raw.name) && !(e as any).response ? passkeyErrorMessage(e) : parseApiError(e).message;
      setUnverified(isUnverifiedError(message));
      setError(message);
      if (/timed out\. Enter your email/i.test(message)) setStage('password');
    } finally {
      setBusy(false);
    }
  };

  /** Stores the session and goes to the right first page. */
  const finish = async (res: LoginResult) => {
    const access = res.access_token;
    if (!access || !res.user) {
      setError('Sign in failed. Please try again.');
      return;
    }
    const claims = parseJwt(access);
    const stamp = new Date().toISOString();
    setAuth(
      { ...res.user, id: res.user.id, org_id: claims?.org_id || res.user.org_id || '', role: claims?.role || res.user.role, created_at: stamp, updated_at: stamp },
      access,
      res.refresh_token ?? '',
    );
    if (res.warning) toast.warning(res.warning, { duration: 10000 });
    celebrate('big');
    if (claims?.role === 'super_admin') {
      router.replace('/admin/global');
      return;
    }
    if (res.must_set_security_questions) {
      if (res.must_change_password) localStorage.setItem('must_change_password', 'true');
      router.replace('/set-security-questions');
      return;
    }
    if (res.must_change_password) {
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
  };

  /** A response with tokens finishes; one with recovery codes shows them first. */
  const complete = async (res: LoginResult) => {
    if (res.recovery_codes?.length) {
      setPending(res);
      setStage('codes');
      return;
    }
    await finish(res);
  };

  const submitPassword = () =>
    run(async () => {
      const res = await v2.post<LoginResult>('/auth/login', { email: email.trim(), password });
      if (res.passkey_required && res.step_token) {
        setStep(res.step_token);
        setStage('passkey');
        if (passkeysSupported()) await passkeyStep(res.step_token);
        return;
      }
      if (res.passkey_setup_required && res.step_token) {
        setStep(res.step_token);
        setNeedsCode(!!res.email_code_required);
        setStage('setup');
        return;
      }
      await complete(res);
    });

  const passkeyStep = async (token: string) => {
    const ceremony = await v2.post<Ceremony>('/auth/passkey/options', { step_token: token });
    const credential = await signWithPasskey(ceremony.options);
    const res = await v2.post<LoginResult>('/auth/passkey/verify', { step_token: token, challenge_id: ceremony.challenge_id, credential });
    await complete(res);
  };

  /** Passwordless: any passkey saved for this site. */
  const passkeyOnly = () =>
    run(async () => {
      const ceremony = await v2.post<Ceremony>('/auth/passkey/options', {});
      const credential = await signWithPasskey(ceremony.options);
      const res = await v2.post<LoginResult>('/auth/passkey/verify', { challenge_id: ceremony.challenge_id, credential });
      await complete(res);
    });

  const setupPasskey = () =>
    run(async () => {
      if (needsCode && !/^\d{6}$/.test(emailCode.trim())) throw new Error('Enter the 6-digit code from the email.');
      const ceremony = await v2.post<Ceremony>('/auth/passkey/setup/options', { step_token: step, email_code: emailCode.trim() });
      const credential = await createPasskey(ceremony.options);
      const res = await v2.post<LoginResult>('/auth/passkey/setup/verify', {
        step_token: step,
        challenge_id: ceremony.challenge_id,
        credential,
        name: defaultPasskeyName(),
      });
      await complete(res);
    });

  const submitRecoveryCode = () =>
    run(async () => {
      const res = await v2.post<LoginResult>('/auth/recovery', { step_token: step, code: recovery.trim() });
      await complete(res);
    });

  const resendCode = () =>
    run(async () => {
      await v2.post('/auth/passkey/setup/code', { step_token: step });
      toast.success('A new code is on its way.');
    });

  const back = () => {
    setStage('password');
    setStep('');
    setError('');
    setEmailCode('');
    setRecovery('');
  };

  const notice = sp.get('expired') ? 'Your session expired. Please sign in again.' : sp.get('idle') ? 'You were signed out after a period of inactivity.' : sp.get('reset') ? 'Password updated. Sign in with your new password.' : null;

  const errorBox = error && !unverified && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>;
  const backLink = (
    <button type="button" onClick={back} className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-800">
      <ArrowLeft className="h-3.5 w-3.5" /> Use a different account
    </button>
  );

  if (stage === 'codes' && pending?.recovery_codes) {
    const codes = pending.recovery_codes;
    const text = `TaskFlow recovery codes for ${pending.user?.email ?? email}\nEach code works once.\n\n${codes.join('\n')}\n`;
    return (
      <AuthLayout title="Save your recovery codes" subtitle="If you lose your passkey, each of these codes lets you sign in once.">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-sm text-slate-800">
            {codes.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
          <div className="flex gap-2">
            <Btn
              variant="secondary"
              className="flex-1"
              onClick={() => {
                void navigator.clipboard.writeText(codes.join('\n'));
                toast.success('Copied');
              }}
            >
              <Copy className="h-4 w-4" /> Copy
            </Btn>
            <Btn
              variant="secondary"
              className="flex-1"
              onClick={() => {
                const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
                const a = document.createElement('a');
                a.href = url;
                a.download = 'taskflow-recovery-codes.txt';
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              <Download className="h-4 w-4" /> Download
            </Btn>
          </div>
          <p className="text-xs text-slate-500">Keep them somewhere safe, like a password manager. They will not be shown again; you can make new ones under Account security.</p>
          <Btn variant="primary" className="w-full" loading={busy} onClick={() => run(() => finish(pending))}>
            I saved my codes, continue
          </Btn>
        </div>
      </AuthLayout>
    );
  }

  if (stage === 'passkey') {
    return (
      <AuthLayout title="Confirm it's you" subtitle={`Use your passkey to finish signing in as ${email.trim()}.`}>
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg border border-blue-100 bg-blue-50 p-4 text-sm text-blue-900">
            <Fingerprint className="h-6 w-6 shrink-0" />
            Your browser will ask for your fingerprint, face, screen lock or security key.
          </div>
          {errorBox}
          <Btn variant="primary" className="w-full" loading={busy} onClick={() => run(() => passkeyStep(step))}>
            <KeyRound className="h-4 w-4" /> Use passkey
          </Btn>
          <div className="flex items-center justify-between">
            {backLink}
            <button type="button" onClick={() => { setError(''); setStage('recovery'); }} className="text-xs font-medium text-blue-600 hover:text-blue-700">
              Lost your passkey? Use a recovery code
            </button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  if (stage === 'recovery') {
    return (
      <AuthLayout title="Use a recovery code" subtitle="Enter one of the recovery codes you saved when you set up your passkey.">
        <form onSubmit={(e) => { e.preventDefault(); submitRecoveryCode(); }} className="space-y-4">
          <Field label="Recovery code">
            <TextInput autoFocus autoComplete="one-time-code" value={recovery} onChange={(e) => setRecovery(e.target.value)} placeholder="abcde-12345" className="font-mono" />
          </Field>
          {errorBox}
          <Btn type="submit" variant="primary" className="w-full" loading={busy} disabled={recovery.trim().length < 10}>
            Sign in
          </Btn>
          <div className="flex items-center justify-between">
            {backLink}
            <button type="button" onClick={() => { setError(''); setStage('passkey'); }} className="text-xs font-medium text-blue-600 hover:text-blue-700">
              Use passkey instead
            </button>
          </div>
          <p className="text-xs text-slate-500">No codes left? Your organization admin (or the platform admin) can reset your sign-in security.</p>
        </form>
      </AuthLayout>
    );
  }

  if (stage === 'setup') {
    return (
      <AuthLayout title="Set up a passkey" subtitle="Admin accounts sign in with a passkey as well as a password. It takes a few seconds.">
        <form onSubmit={(e) => { e.preventDefault(); setupPasskey(); }} className="space-y-4">
          <div className="flex items-start gap-3 rounded-lg border border-emerald-100 bg-emerald-50 p-4 text-sm text-emerald-900">
            <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
            <span>
              A passkey lives on your phone, computer or security key and can&apos;t be phished or guessed. You&apos;ll use your fingerprint, face or screen lock to sign in.
            </span>
          </div>
          {needsCode && (
            <Field label={`Code sent to ${email.trim()}`}>
              <TextInput autoFocus inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={emailCode} onChange={(e) => setEmailCode(e.target.value.replace(/\D/g, ''))} placeholder="123456" className="font-mono tracking-[0.4em]" />
            </Field>
          )}
          {!passkeysSupported() && <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">This browser can&apos;t create passkeys. Use an up-to-date Chrome, Safari, Edge or Firefox.</div>}
          {errorBox}
          <Btn type="submit" variant="primary" className="w-full" loading={busy} disabled={!passkeysSupported()}>
            <KeyRound className="h-4 w-4" /> Create passkey
          </Btn>
          <div className="flex items-center justify-between">
            {backLink}
            {needsCode && (
              <button type="button" onClick={resendCode} className="text-xs font-medium text-blue-600 hover:text-blue-700">
                Send a new code
              </button>
            )}
          </div>
        </form>
      </AuthLayout>
    );
  }

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
          if (!email.trim() || !password) {
            setError('Enter your email and password.');
            return;
          }
          submitPassword();
        }}
        className="space-y-4"
      >
        <Field label="Work email">
          <TextInput type="email" autoComplete="username webauthn" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" autoFocus={!email} />
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
        {errorBox}
        {unverified && (
          <div className="space-y-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
            <p>{error}</p>
            <ResendVerification email={email} className="w-full" />
          </div>
        )}
        <Btn type="submit" variant="primary" className="w-full" loading={busy}>
          Sign in
        </Btn>
        {passkeysSupported() && (
          <>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span className="h-px flex-1 bg-slate-200" /> or <span className="h-px flex-1 bg-slate-200" />
            </div>
            <Btn type="button" variant="secondary" className="w-full" loading={busy} onClick={passkeyOnly}>
              <KeyRound className="h-4 w-4" /> Sign in with a passkey
            </Btn>
          </>
        )}
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
