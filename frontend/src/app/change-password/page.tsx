'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AuthLayout, PasswordRules, passwordValid } from '@/components/auth/auth-layout';
import { Btn, Field, TextInput } from '@/components/desk/kit';
import { useHydrated, useSignOut } from '@/components/desk/session';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useMe } from '@/lib/itsm/hooks';
import { useAuthStore } from '@/store/auth';
import type { TokenPair } from '@/lib/itsm/types';

export default function ChangePasswordPage() {
  const router = useRouter();
  const hydrated = useHydrated();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setTokens = useAuthStore((s) => s.setTokens);
  const qc = useQueryClient();
  const signOut = useSignOut();
  const { data: me } = useMe();
  const [current, setCurrent] = React.useState('');
  const [next, setNext] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (hydrated && !isAuthenticated) router.replace('/login');
  }, [hydrated, isAuthenticated, router]);

  const policy = {
    minLength: me?.settings.password_min_length ?? 8,
    upper: me?.settings.password_require_upper,
    number: me?.settings.password_require_number,
    special: me?.settings.password_require_special,
  };
  const change = useMutation({
    mutationFn: () => v2.post<TokenPair>('/me/password', { current_password: current, new_password: next }),
    onSuccess: async (tokens) => {
      setTokens(tokens.access_token, tokens.refresh_token);
      localStorage.removeItem('must_change_password');
      await qc.invalidateQueries({ queryKey: ['me'] });
      toast.success('Password updated');
      router.replace(me?.is_agent ? '/dashboard' : '/portal');
    },
    onError: (e) => {
      const err = parseApiError(e);
      setErrors(err.fields);
      if (!Object.keys(err.fields).length) toast.error(err.message);
    },
  });

  const forced = me?.user.must_change_password;
  return (
    <AuthLayout
      title={forced ? 'Choose a new password' : 'Change password'}
      subtitle={forced ? 'Your account uses a temporary password. Set a permanent one to continue.' : 'Signing in elsewhere will require the new password.'}
      footer={
        <button onClick={() => (forced ? signOut() : router.back())} className="font-medium text-blue-600 hover:text-blue-700">
          {forced ? 'Sign out' : 'Cancel'}
        </button>
      }
    >
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const errs: Record<string, string> = {};
          if (!current) errs.current_password = 'Enter your current password';
          if (!passwordValid(next, policy)) errs.new_password = 'Password does not meet the requirements';
          if (next !== confirm) errs.confirm = 'Passwords do not match';
          setErrors(errs);
          if (!Object.keys(errs).length) change.mutate();
        }}
      >
        <Field label={forced ? 'Temporary password' : 'Current password'} error={errors.current_password && `${errors.current_password.startsWith('is') ? 'Current password ' : ''}${errors.current_password}`}>
          <TextInput type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="New password" error={errors.new_password && `${errors.new_password.startsWith('must') ? 'Password ' : ''}${errors.new_password}`}>
          <TextInput type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          <PasswordRules password={next} {...policy} />
        </Field>
        <Field label="Confirm new password" error={errors.confirm}>
          <TextInput type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        </Field>
        <Btn type="submit" variant="primary" className="w-full" loading={change.isPending}>
          Update password
        </Btn>
      </form>
    </AuthLayout>
  );
}
