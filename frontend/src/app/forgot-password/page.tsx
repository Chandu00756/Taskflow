'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { MailCheck } from 'lucide-react';
import { AuthLayout, PasswordRules, passwordValid } from '@/components/auth/auth-layout';
import { useAuthConfig } from '@/components/auth/email-flows';
import { Btn, Field, TextInput } from '@/components/desk/kit';
import { v2, parseApiError } from '@/lib/itsm/api';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [step, setStep] = React.useState<'email' | 'answers' | 'sent'>('email');
  const [sentMessage, setSentMessage] = React.useState('');
  const config = useAuthConfig();
  const emailReset = !!config.data?.email_enabled;
  const [email, setEmail] = React.useState('');
  const [questions, setQuestions] = React.useState<string[]>([]);
  const [answers, setAnswers] = React.useState<string[]>([]);
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState('');

  const lookup = useMutation({
    mutationFn: () => v2.post<{ questions: string[] }>('/auth/forgot/questions', { email: email.trim() }),
    onSuccess: (res) => {
      setQuestions(res.questions);
      setAnswers(res.questions.map(() => ''));
      setStep('answers');
      setError('');
    },
    onError: (e) => setError(parseApiError(e).message),
  });
  const sendLink = useMutation({
    mutationFn: () => v2.post<{ message: string }>('/auth/forgot/email', { email: email.trim() }),
    onSuccess: (res) => {
      setSentMessage(res.message);
      setStep('sent');
      setError('');
    },
    onError: (e) => setError(parseApiError(e).message),
  });
  const reset = useMutation({
    mutationFn: () => v2.post('/auth/forgot/reset', { email: email.trim(), new_password: password, answers: questions.map((q, i) => ({ question: q, answer: answers[i] })) }),
    onSuccess: () => router.replace('/login?reset=1'),
    onError: (e) => setError(parseApiError(e).message),
  });

  return (
    <AuthLayout
      title="Reset your password"
      subtitle={
        step === 'email'
          ? emailReset
            ? 'We will email you a link to choose a new password.'
            : 'Answer your security questions to choose a new password.'
          : step === 'sent'
            ? undefined
            : `Answer the questions you set for ${email}.`
      }
      footer={
        <Link href="/login" className="font-medium text-blue-600 hover:text-blue-700">
          Back to sign in
        </Link>
      }
    >
      {step === 'sent' ? (
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-900">
            <MailCheck className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
            <div>
              <p className="font-medium">Check your inbox</p>
              <p className="mt-1">{sentMessage}</p>
              <p className="mt-2 text-blue-800/80">Nothing there after a few minutes? Check your spam folder or try again.</p>
            </div>
          </div>
          <Btn variant="secondary" className="w-full" onClick={() => setStep('email')}>
            Use a different email
          </Btn>
        </div>
      ) : step === 'email' ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError('');
            if (!email.trim()) return;
            if (emailReset) sendLink.mutate();
            else lookup.mutate();
          }}
        >
          <Field label="Work email">
            <TextInput type="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" />
          </Field>
          {error && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
          <Btn type="submit" variant="primary" className="w-full" loading={sendLink.isPending || lookup.isPending} disabled={config.isPending}>
            {emailReset ? 'Email me a reset link' : 'Continue'}
          </Btn>
          {emailReset && (
            <Btn
              variant="ghost"
              className="w-full"
              loading={lookup.isPending}
              onClick={() => {
                setError('');
                if (email.trim()) lookup.mutate();
                else setError('Enter your email first.');
              }}
            >
              Answer my security questions instead
            </Btn>
          )}
        </form>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setError('');
            if (answers.some((a) => !a.trim())) return setError('Answer every question.');
            if (!passwordValid(password, {})) return setError('Choose a password with at least 8 characters.');
            if (password !== confirm) return setError('Passwords do not match.');
            reset.mutate();
          }}
        >
          {questions.map((q, i) => (
            <Field key={q} label={q}>
              <TextInput value={answers[i]} onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? e.target.value : a)))} autoComplete="off" />
            </Field>
          ))}
          <Field label="New password">
            <TextInput type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <PasswordRules password={password} />
          </Field>
          <Field label="Confirm new password">
            <TextInput type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
          </Field>
          {error && <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
          <Btn type="submit" variant="primary" className="w-full" loading={reset.isPending}>
            Reset password
          </Btn>
        </form>
      )}
    </AuthLayout>
  );
}
