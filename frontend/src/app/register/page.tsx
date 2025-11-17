'use client';

import { useMemo, useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import dynamic from 'next/dynamic';
import type { ConfettiProps } from 'react-confetti';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { UserPlus, ShieldCheck, Sparkles } from 'lucide-react';
import { authAPI, invitesAPI } from '@/lib/api';
import { parseJwt } from '@/lib/jwt';
import { useAuthStore } from '@/store/auth';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const Confetti = dynamic<ConfettiProps>(() => import('react-confetti'), { ssr: false });

const registerSchema = z
  .object({
    full_name: z.string().min(2, 'Please enter your full name'),
    username: z.string().min(3, 'Username must be at least 3 characters'),
    email: z.string().email('Enter a valid email'),
    password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Include at least one uppercase letter')
      .regex(/[0-9]/, 'Include at least one number')
      .regex(/[^A-Za-z0-9]/, 'Include at least one symbol'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords must match',
    path: ['confirmPassword'],
  });

type RegisterFormValues = z.infer<typeof registerSchema>;

const tips = [
  'Invite teammates instantly after onboarding',
  'Enable AI summaries for daily standups',
  'Sync your calendar for predictive planning',
  'Offline access keeps tasks available anywhere',
];

const passwordDescriptors = ['Weak', 'Fair', 'Solid', 'Strong', 'Elite'];

function scorePassword(password: string) {
  let score = 0;
  if (!password) return { score, label: passwordDescriptors[0] };
  const checks = [
    password.length >= 8,
    /[A-Z]/.test(password),
    /[0-9]/.test(password),
    /[^A-Za-z0-9]/.test(password),
    password.length >= 14,
  ];
  score = checks.filter(Boolean).length;
  return {
    score,
    label: passwordDescriptors[Math.min(score, passwordDescriptors.length - 1)],
  };
}

export default function RegisterPage() {
  const router = useRouter();
  const [showCelebration, setShowCelebration] = useState(false);
  const {
    handleSubmit,
    register,
    watch,
    formState: { errors },
  } = useForm<RegisterFormValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      full_name: '',
      username: '',
      email: '',
      password: '',
      confirmPassword: '',
    },
  });

  const passwordValue = watch('password');
  const passwordScore = useMemo(() => scorePassword(passwordValue), [passwordValue]);

  const { setAuth } = useAuthStore();

  const registerMutation = useMutation({
    mutationFn: authAPI.register,
    onSuccess: async (data: any, variables: any) => {
      toast.success('Account created! Logging you in...');
      setShowCelebration(true);
      // Automatically login to obtain tokens and org claims
      try {
        const loginResp: any = await authAPI.login({ email: (variables as any).email, password: (variables as any).password });
        const access = loginResp.access_token;
        const refresh = loginResp.refresh_token;
        const parsed = typeof window !== 'undefined' ? parseJwt(access) : null;
        const userWithClaims = {
          ...loginResp.user,
          org_id: parsed?.org_id || parsed?.orgId || '',
          role: parsed?.role || '',
        };
        setAuth(userWithClaims, access, refresh);
        setTimeout(() => router.push('/dashboard'), 1200);
      } catch (e: any) {
        // fallback: redirect to login
        setTimeout(() => router.push('/login'), 1200);
      }
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Registration failed');
    },
  });

  // invite accept mutation
  const acceptMutation = useMutation({
    mutationFn: (data: any) => invitesAPI.acceptInvite(data),
    onSuccess: () => {
      toast.success('Invite accepted! Redirecting to login.');
      setTimeout(() => router.push('/login'), 1200);
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to accept invite');
    },
  });

  const [tokenParam, setTokenParam] = useState('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const sp = new URLSearchParams(window.location.search);
      const t = sp.get('token') || '';
      setTokenParam(t);
    }
  }, []);

  const onSubmit = (values: RegisterFormValues) => {
    const { confirmPassword, ...payload } = values;
    if (tokenParam) {
      // Accept invite flow
      const acceptPayload = {
        token: tokenParam,
        password: values.password,
        username: values.username,
        full_name: values.full_name,
      };
      // Use mutateAsync so we can login immediately after accept
      acceptMutation
        .mutateAsync(acceptPayload)
        .then((res: any) => {
          // accept returns created user; now login using email from response and provided password
          const email = res?.user?.email;
          if (email) {
            authAPI.login({ email, password: values.password }).then((loginResp: any) => {
              const access = loginResp.access_token;
              const refresh = loginResp.refresh_token;
              const parsed = typeof window !== 'undefined' ? parseJwt(access) : null;
              const userWithClaims = {
                ...loginResp.user,
                org_id: parsed?.org_id || parsed?.orgId || '',
                role: parsed?.role || '',
              };
              setAuth(userWithClaims, access, refresh);
              router.push('/dashboard');
            });
          } else {
            router.push('/login');
          }
        })
        .catch(() => {
          // handled by mutation onError
        });
    } else {
      registerMutation.mutate(payload, {
        onSuccess: (data: any) => {
          // store org_id and role from token
          const access = data.access_token;
          const parsed = typeof window !== 'undefined' ? parseJwt(access) : null;
          const userWithClaims = {
            ...data.user,
            org_id: parsed?.org_id || parsed?.orgId || '',
            role: parsed?.role || '',
          };
          // set auth via store directly to avoid circular import; use localStorage for now
          if (typeof window !== 'undefined') {
            localStorage.setItem('access_token', access);
            localStorage.setItem('refresh_token', data.refresh_token);
            localStorage.setItem('auth_user', JSON.stringify(userWithClaims));
          }
        },
      });
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-gradient-to-br from-[#F1F5F9] via-[#F8FAFC] to-[#EEF9FF]">
      <AnimatePresence>
        {showCelebration && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none fixed inset-0 z-40">
            <Confetti recycle={false} numberOfPieces={420} gravity={0.21} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute inset-0 -z-10">
        <div className="bg-aurora-soft absolute inset-0 opacity-70" />
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.1, ease: 'easeOut' }}
          className="pointer-events-none absolute left-10 top-10 hidden h-40 w-40 rounded-3xl bg-white/70 shadow-2xl blur-2xl xl:block"
        />
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1.1, delay: 0.2, ease: 'easeOut' }}
          className="pointer-events-none absolute bottom-16 right-20 hidden h-52 w-52 rounded-full bg-gradient-to-br from-sky-200 to-emerald-200 shadow-2xl blur-2xl xl:block"
        />
      </div>

      <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-12 px-6 py-16 text-center lg:grid lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-20 lg:px-10 lg:text-left">
        <motion.div
          initial={{ opacity: 0, x: -60 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.9, ease: 'easeOut' }}
          className="flex max-w-xl flex-col items-center gap-8 text-center lg:items-start lg:text-left"
        >
          <div className="inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-sky-500 shadow-lg">
            <Sparkles className="h-4 w-4" /> beta 2.5 with AI presets
          </div>
          <h1 className="text-5xl font-semibold leading-tight text-slate-900">
            Create a workspace that feels tailor-made for how your team executes.
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-slate-500">
            Join thousands of product teams using TaskFlow to orchestrate their entire delivery pipeline with predictive insights, fluid collaboration, and offline-ready experiences.
          </p>

          <div className="grid w-full gap-4 sm:grid-cols-2">
            {tips.map((tip, index) => (
              <motion.div
                key={tip}
                whileHover={{ translateY: -4 }}
                className="rounded-3xl border border-white/70 bg-white/80 p-4 shadow-lg"
              >
                <div className="flex items-start gap-3">
                  <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-emerald-400 text-[11px] font-semibold text-white shadow">
                    {(index + 1).toString().padStart(2, '0')}
                  </span>
                  <p className="text-sm font-medium leading-relaxed text-slate-600">{tip}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, x: 60 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.9, ease: 'easeOut', delay: 0.1 }}
          className="relative w-full max-w-lg text-left"
        >
          <div className="absolute inset-0 -z-10 animate-aurora rounded-[44px] bg-gradient-to-br from-white via-sky-200/60 to-emerald-200/70 blur-3xl" />
          <div className="rounded-[44px] border border-white/70 bg-white/85 p-12 shadow-[0_45px_90px_-50px_rgba(56,189,248,0.5)] backdrop-blur-xl">
            <header className="mb-8 space-y-3 text-center">
              <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-4 py-1 text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
                Secure onboarding
              </span>
              <h2 className="text-3xl font-semibold text-slate-900">Let’s craft your account</h2>
              <p className="text-sm text-slate-500">
                Personalize your workspace and invite collaborators the moment you land inside.
              </p>
            </header>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Full name
                  </label>
                  <Input
                    placeholder="Jordan Williams"
                    autoComplete="name"
                    {...register('full_name')}
                    aria-invalid={Boolean(errors.full_name)}
                    className={cn(
                      'h-12 rounded-2xl border-slate-200 bg-white/85 px-4 text-sm text-slate-700 shadow-inner transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100',
                      errors.full_name && 'border-red-400 focus:ring-red-100'
                    )}
                  />
                  {errors.full_name && (
                    <span className="text-xs font-medium text-red-500">{errors.full_name.message}</span>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Username
                  </label>
                  <Input
                    placeholder="jordan.w"
                    autoComplete="username"
                    {...register('username')}
                    aria-invalid={Boolean(errors.username)}
                    className={cn(
                      'h-12 rounded-2xl border-slate-200 bg-white/85 px-4 text-sm text-slate-700 shadow-inner transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100',
                      errors.username && 'border-red-400 focus:ring-red-100'
                    )}
                  />
                  {errors.username && (
                    <span className="text-xs font-medium text-red-500">{errors.username.message}</span>
                  )}
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Email address
                </label>
                <Input
                  placeholder="you@team.co"
                  autoComplete="email"
                  {...register('email')}
                  aria-invalid={Boolean(errors.email)}
                  className={cn(
                    'h-12 rounded-2xl border-slate-200 bg-white/85 px-4 text-sm text-slate-700 shadow-inner transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100',
                    errors.email && 'border-red-400 focus:ring-red-100'
                  )}
                />
                {errors.email && (
                  <span className="text-xs font-medium text-red-500">{errors.email.message}</span>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Password
                  </label>
                  <Input
                    type="password"
                    placeholder="Create a strong password"
                    autoComplete="new-password"
                    {...register('password')}
                    aria-invalid={Boolean(errors.password)}
                    className={cn(
                      'h-12 rounded-2xl border-slate-200 bg-white/85 px-4 text-sm text-slate-700 shadow-inner transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100',
                      errors.password && 'border-red-400 focus:ring-red-100'
                    )}
                  />
                  <div className="space-y-1">
                    <div className="flex h-2 gap-1 rounded-full bg-slate-100 p-[2px]">
                      {Array.from({ length: 5 }).map((_, index) => (
                        <div
                          key={index}
                          className={cn(
                            'flex-1 rounded-full transition-colors',
                            index < passwordScore.score
                              ? 'bg-gradient-to-r from-sky-400 to-emerald-400'
                              : 'bg-slate-200'
                          )}
                        />
                      ))}
                    </div>
                    <p className="text-xs font-medium text-slate-500">
                      Strength: <span className="text-sky-500">{passwordScore.label}</span>
                    </p>
                  </div>
                  {errors.password && (
                    <span className="text-xs font-medium text-red-500">{errors.password.message}</span>
                  )}
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Confirm password
                  </label>
                  <Input
                    type="password"
                    placeholder="Re-enter password"
                    autoComplete="new-password"
                    {...register('confirmPassword')}
                    aria-invalid={Boolean(errors.confirmPassword)}
                    className={cn(
                      'h-12 rounded-2xl border-slate-200 bg-white/85 px-4 text-sm text-slate-700 shadow-inner transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100',
                      errors.confirmPassword && 'border-red-400 focus:ring-red-100'
                    )}
                  />
                  {errors.confirmPassword && (
                    <span className="text-xs font-medium text-red-500">{errors.confirmPassword.message}</span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3 rounded-3xl bg-slate-50/80 p-4 text-sm text-slate-500">
                <ShieldCheck className="h-5 w-5 text-emerald-500" />
                Your credentials are encrypted in transit and at rest. Enable 2FA from your profile once inside.
              </div>

              <Button
                type="submit"
                disabled={registerMutation.isPending}
                className="group relative flex h-12 w-full items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-r from-blue-500 via-sky-500 to-emerald-400 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-[1.01] focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:cursor-not-allowed disabled:opacity-75"
              >
                {registerMutation.isPending ? (
                  <motion.span
                    initial={{ opacity: 0.6 }}
                    animate={{ opacity: 1 }}
                    transition={{ repeat: Infinity, duration: 1.3, ease: 'easeInOut' }}
                    className="flex items-center gap-2"
                  >
                    <span className="spinner-gradient h-5 w-5" />
                    Setting up workspace
                  </motion.span>
                ) : (
                  <span className="flex items-center gap-2">
                    Launch onboarding
                    <UserPlus className="h-4 w-4" />
                  </span>
                )}
              </Button>

              <p className="text-center text-sm text-slate-500">
                Already synced with TaskFlow?{' '}
                <Link href="/login" className="font-semibold text-sky-500 hover:text-sky-600">
                  Sign in
                </Link>
              </p>
            </form>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
