'use client';

import { useEffect, useMemo, useState } from 'react';
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
import { authAPI, apiClient } from '@/lib/api';
import { parseJwt, isSuperAdmin, isOrgAdmin } from '@/lib/jwt';
import { useAuthStore } from '@/store/auth';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const Confetti = dynamic<ConfettiProps>(() => import('react-confetti'), { ssr: false });

const loginSchema = z.object({
  email: z.string().email('Enter a valid email'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  rememberMe: z.boolean().optional(),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const router = useRouter();
  const { setAuth, isAuthenticated } = useAuthStore();
  const [showCelebration, setShowCelebration] = useState(false);
  const {
    handleSubmit,
    register,
    formState: { errors },
  } = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: '',
      password: '',
      rememberMe: true,
    },
  });

  // Don't auto-redirect here - let the login mutation handle role-based routing
  // This prevents the race condition where we redirect to /dashboard before checking role

  const loginMutation = useMutation({
    mutationFn: authAPI.login,
    onSuccess: (data) => {
      console.log('Login success! Data:', data);
      
      // set auth and extract org_id + role from access token
      // Handle both camelCase (accessToken) and snake_case (access_token) from API
      const access = (data as any).accessToken || data.access_token;
      const refresh = (data as any).refreshToken || data.refresh_token;
      const mustChangePassword = (data as any).mustChangePassword || (data as any).must_change_password || false;
      const mustSetSecurityQuestions = (data as any).mustSetSecurityQuestions || (data as any).must_set_security_questions || false;
      
      console.log('Tokens extracted:', { hasAccess: !!access, hasRefresh: !!refresh });
      console.log('Security flags:', { mustChangePassword, mustSetSecurityQuestions });
      
      if (!access) {
        console.error('No access token in response!', data);
        toast.error('Login failed - no access token');
        return;
      }
      
      const parsed = typeof window !== 'undefined' ? parseJwt(access) : null;
      const userWithClaims = {
        ...data.user,
        org_id: parsed?.org_id || '',
        role: parsed?.role || '',
      };

      // Save tokens FIRST before navigation to prevent race condition
      apiClient.setAccessToken(access);
      apiClient.setRefreshToken(refresh);
      setAuth(userWithClaims, access, refresh);
      
      // Store flags in localStorage for SetSecurityQuestions page
      if (mustChangePassword) {
        localStorage.setItem('must_change_password', 'true');
      }
      if (mustSetSecurityQuestions) {
        localStorage.setItem('must_set_security_questions', 'true');
      }
      
      console.log('Auth set successfully');
      
      // PRIORITY 1: Security questions (applies to ALL users, one-time)
      if (mustSetSecurityQuestions) {
        toast.info('Please set up your security questions', { duration: 3000 });
        router.push('/set-security-questions');
        return;
      }
      
      // PRIORITY 2: Password change (new users with temp password)
      if (mustChangePassword) {
        toast.info('Please change your temporary password', { duration: 3000 });
        router.push('/change-password');
        return;
      }
      
      // Check user role from JWT token (not API response which has proto enum)
      const isSuperAdminUser = isSuperAdmin(access);
      const isOrgAdminUser = isOrgAdmin(access);
      
      if (isSuperAdminUser) {
        // Super admin goes directly to global admin portal - no delay to avoid dashboard flash
        toast.success('Welcome back, Super Admin! 🔐');
        router.push('/admin/global');
      } else {
        // All org users (including org_admin, team_lead, member) go to dashboard
        // The dashboard will route them appropriately
        toast.success('Welcome back! ✨');
        setShowCelebration(true);
        setTimeout(() => {
          router.push('/dashboard');
        }, 1200);
      }
    },
    onError: (error: any) => {
      console.error('Login mutation error:', error);
      console.error('Error response:', error?.response);
      toast.error(error.response?.data?.message || 'Login failed');
    },
  });

  const isPending = loginMutation.isPending;

  const gradients = useMemo(
    () => [
      'from-blue-300/60 via-sky-200/60 to-white/60',
      'from-emerald-200/70 via-white/75 to-sky-200/70',
    ],
    []
  );

  const onSubmit = (values: LoginFormValues) => {
    loginMutation.mutate({ email: values.email, password: values.password });
  };

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-gradient-to-br from-[#E0F2FE] via-[#F8FBFF] to-[#ECFEFF]">
      <AnimatePresence>
        {showCelebration && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="pointer-events-none fixed inset-0 z-50">
            <Confetti recycle={false} numberOfPieces={380} gravity={0.25} />
          </motion.div>
        )}
      </AnimatePresence>

      <div className="absolute inset-0 -z-10">
        <motion.div
          aria-hidden
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
          className="bg-aurora pointer-events-none absolute left-1/2 top-1/3 h-[600px] w-[600px] -translate-x-1/2 rounded-full opacity-60 blur-3xl"
        />
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-[0.04]" />
      </div>

      <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-12 px-6 py-16 text-center lg:grid lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-20 lg:px-10 lg:text-left">
        <div className="hidden max-w-xl flex-col items-center gap-8 text-center lg:flex lg:items-start lg:text-left">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.15 }}
            className="inline-flex items-center gap-2 rounded-full bg-white/70 px-5 py-2 text-sm font-medium text-sky-500 shadow-lg"
          >
            <span className="h-2 w-2 rounded-full bg-emerald-400" />
            AI assisted productivity insights
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.25 }}
            className="text-5xl font-semibold leading-tight text-slate-900 lg:text-left"
          >
            Elevate your workflow with a dashboard that feels intelligent and intuitive.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.35 }}
            className="text-lg leading-relaxed text-slate-500 lg:text-left"
          >
            TaskFlow automatically learns your focus patterns, highlights priorities, and celebrates progress with immersive micro-interactions.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.45 }}
          >
            <ul className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              {[
                'Predictive scheduling suggestions',
                'Glassmorphism visuals with depth',
                'Live activity pulse for teams',
                'Offline-ready progressive experience',
              ].map((feature, index) => (
                <li
                  key={feature}
                  className="flex items-start gap-3 rounded-2xl border border-white/70 bg-white/40 p-4 text-sm text-slate-600 shadow-sm backdrop-blur-sm"
                >
                  <motion.span
                    className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-emerald-400 text-[11px] font-semibold text-white shadow-sm"
                    whileHover={{ scale: 1.05 }}
                    transition={{ duration: 0.2 }}
                  >
                    {(index + 1).toString().padStart(2, '0')}
                  </motion.span>
                  <span className="text-sm font-medium leading-relaxed text-slate-600 lg:text-left">
                    {feature}
                  </span>
                </li>
              ))}
            </ul>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="relative w-full max-w-lg text-left"
        >
          <div className="absolute inset-0 -z-10 animate-aurora rounded-[40px] bg-gradient-to-br from-sky-200 via-white to-emerald-200 blur-3xl" />
          <div className="group rounded-[40px] border border-white/70 bg-white/80 p-10 shadow-[0_40px_80px_-40px_rgba(14,116,144,0.45)] backdrop-blur-xl">
            <div className="mb-8">
              <div className="inline-flex items-center gap-3 rounded-full bg-sky-50 px-4 py-2 text-sm font-medium text-sky-500">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-emerald-400 text-white shadow-lg">
                  TF
                </span>
                TaskFlow Portal
              </div>
              <h2 className="mt-6 text-3xl font-semibold text-slate-900">Welcome back</h2>
              <p className="mt-2 text-sm text-slate-500">
                Enter your credentials to access the command center.
              </p>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Email address
                </label>
                <Input
                  type="email"
                  placeholder="you@example.com"
                  autoComplete="email"
                  aria-invalid={Boolean(errors.email)}
                  {...register('email')}
                  className={cn(
                    'h-12 rounded-2xl border-slate-200 bg-white/80 px-4 text-sm text-slate-700 shadow-inner transition focus:border-sky-400 focus:ring-2 focus:ring-sky-200',
                    errors.email && 'border-red-400 focus:ring-red-100'
                  )}
                />
                {errors.email && (
                  <span className="text-xs font-medium text-red-500">{errors.email.message}</span>
                )}
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                  Password
                </label>
                <Input
                  type="password"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  aria-invalid={Boolean(errors.password)}
                  {...register('password')}
                  className={cn(
                    'h-12 rounded-2xl border-slate-200 bg-white/80 px-4 text-sm text-slate-700 shadow-inner transition focus:border-sky-400 focus:ring-2 focus:ring-sky-200',
                    errors.password && 'border-red-400 focus:ring-red-100'
                  )}
                />
                {errors.password && (
                  <span className="text-xs font-medium text-red-500">{errors.password.message}</span>
                )}
              </div>

              <label className="flex items-center gap-3 text-sm text-slate-500">
                <input
                  type="checkbox"
                  defaultChecked
                  className="h-4 w-4 rounded border border-slate-300 text-sky-500 focus:ring-sky-200"
                  {...register('rememberMe')}
                />
                Remember me on this device
              </label>

              <Button
                type="submit"
                disabled={isPending}
                className="relative flex h-12 w-full items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-r from-blue-500 via-sky-500 to-emerald-400 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-[1.01] focus:outline-none focus:ring-2 focus:ring-sky-200 disabled:cursor-not-allowed disabled:opacity-80"
              >
                {isPending ? (
                  <motion.span
                    className="flex items-center gap-2"
                    initial={{ opacity: 0.6 }}
                    animate={{ opacity: 1 }}
                    transition={{ repeat: Infinity, duration: 1.2, ease: 'easeInOut' }}
                  >
                    <span className="spinner-gradient h-5 w-5" />
                    Authenticating
                  </motion.span>
                ) : (
                  <span className="flex items-center gap-2">
                    Enter workspace
                    <motion.span
                      initial={{ x: 0 }}
                      animate={{ x: [0, 6, 0] }}
                      transition={{ repeat: Infinity, duration: 1.6, ease: 'easeInOut' }}
                    >
                      →
                    </motion.span>
                  </span>
                )}
              </Button>
            </form>

            <div className="mt-8 space-y-6 text-center text-sm text-slate-500">
              <p>
                New to TaskFlow?{' '}
                <Link href="/register" className="font-semibold text-sky-500 hover:text-sky-600">
                  Create an account
                </Link>
              </p>
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.25em] text-slate-400">
                <span className="h-px flex-1 bg-gradient-to-r from-white via-slate-200 to-white" />
                <span className="px-3">secure login</span>
                <span className="h-px flex-1 bg-gradient-to-r from-white via-slate-200 to-white" />
              </div>
              <div className="grid gap-2 text-xs text-slate-400">
                <span>2FA ready • Session timeout protection • Smart captcha</span>
              </div>
            </div>
          </div>

          <div className="pointer-events-none absolute -right-10 top-16 hidden h-24 w-24 rounded-3xl bg-white/70 shadow-2xl blur-xl lg:block" />
          <div className="pointer-events-none absolute -left-10 bottom-10 hidden h-20 w-20 rounded-full bg-gradient-to-br from-emerald-300 to-blue-300 opacity-70 blur-2xl lg:block" />
        </motion.div>
      </div>
    </div>
  );
}
