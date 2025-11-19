'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { Building2, Users, ShieldCheck, Sparkles } from 'lucide-react';
import { apiClient } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const orgRegisterSchema = z
  .object({
    // Organization details
    org_name: z.string().min(2, 'Organization name must be at least 2 characters'),
    org_description: z.string().optional(),
    
    // Org admin user details (person creating the org becomes admin)
    admin_full_name: z.string().min(2, 'Please enter your full name'),
    admin_email: z.string().email('Enter a valid email'),
    admin_password: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Include at least one uppercase letter')
      .regex(/[0-9]/, 'Include at least one number')
      .regex(/[^A-Za-z0-9]/, 'Include at least one symbol'),
    confirmPassword: z.string(),
  })
  .refine((data) => data.admin_password === data.confirmPassword, {
    message: 'Passwords must match',
    path: ['confirmPassword'],
  });

type OrgRegisterFormValues = z.infer<typeof orgRegisterSchema>;

export default function OrganizationRegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<'org' | 'admin'>('org');
  
  const {
    handleSubmit,
    register,
    formState: { errors },
    watch,
  } = useForm<OrgRegisterFormValues>({
    resolver: zodResolver(orgRegisterSchema),
    defaultValues: {
      org_name: '',
      org_description: '',
      admin_full_name: '',
      admin_email: '',
      admin_password: '',
      confirmPassword: '',
    },
  });

  const registerOrgMutation = useMutation({
    mutationFn: async (data: OrgRegisterFormValues) => {
      // Call backend API to create organization with admin user
      // Backend proto expects: org_name, description, admin_email, admin_password, admin_full_name
      return apiClient.post('/api/v1/organizations/register', {
        org_name: data.org_name,
        description: data.org_description || '',
        admin_email: data.admin_email,
        admin_password: data.admin_password,
        admin_full_name: data.admin_full_name,
      });
    },
    onSuccess: () => {
      toast.success('Organization created successfully! 🎉');
      toast.info('Please check your email to verify your account.');
      setTimeout(() => router.push('/login'), 2000);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create organization');
    },
  });

  const onSubmit = (values: OrgRegisterFormValues) => {
    registerOrgMutation.mutate(values);
  };

  const orgName = watch('org_name');

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-gradient-to-br from-[#F1F5F9] via-[#F8FAFC] to-[#EEF9FF]">
      <div className="absolute inset-0 -z-10">
        <div className="bg-aurora-soft absolute inset-0 opacity-70" />
      </div>

      <div className="relative mx-auto flex w-full max-w-6xl flex-1 flex-col items-center justify-center gap-12 px-6 py-16">
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-xs font-semibold uppercase tracking-[0.3em] text-emerald-500 shadow-lg">
            <Building2 className="h-4 w-4" /> Organization Setup
          </div>
          <h1 className="text-4xl font-semibold text-slate-900">Create Your Organization</h1>
          <p className="mt-2 text-slate-500">Set up your workspace and become the admin</p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="w-full max-w-2xl"
        >
          <div className="rounded-[44px] border border-white/70 bg-white/85 p-12 shadow-[0_45px_90px_-50px_rgba(56,189,248,0.5)] backdrop-blur-xl">
            {/* Progress Steps */}
            <div className="mb-8 flex items-center justify-center gap-4">
              <button
                type="button"
                onClick={() => setStep('org')}
                className={cn(
                  'flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition',
                  step === 'org'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                )}
              >
                <Building2 className="h-4 w-4" />
                Organization
              </button>
              <div className="h-px w-8 bg-slate-300" />
              <button
                type="button"
                onClick={() => setStep('admin')}
                className={cn(
                  'flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition',
                  step === 'admin'
                    ? 'bg-emerald-500 text-white'
                    : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                )}
              >
                <Users className="h-4 w-4" />
                Admin Account
              </button>
            </div>

            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <AnimatePresence mode="wait">
                {step === 'org' && (
                  <motion.div
                    key="org-step"
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="space-y-6"
                  >
                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                        Organization Name *
                      </label>
                      <Input
                        placeholder="Acme Corporation"
                        {...register('org_name')}
                        aria-invalid={Boolean(errors.org_name)}
                        className={cn(
                          'h-12 rounded-2xl border-slate-200 bg-white/85 px-4 text-sm text-slate-700 shadow-inner transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100',
                          errors.org_name && 'border-red-400 focus:ring-red-100'
                        )}
                      />
                      {errors.org_name && (
                        <span className="text-xs font-medium text-red-500">{errors.org_name.message}</span>
                      )}
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                        Description (Optional)
                      </label>
                      <textarea
                        placeholder="Tell us about your organization..."
                        {...register('org_description')}
                        rows={4}
                        className={cn(
                          'w-full rounded-2xl border border-slate-200 bg-white/85 px-4 py-3 text-sm text-slate-700 shadow-inner transition focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100'
                        )}
                      />
                    </div>

                    <Button
                      type="button"
                      onClick={() => setStep('admin')}
                      disabled={!orgName || orgName.length < 2}
                      className="h-12 w-full rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-[1.01]"
                    >
                      Continue to Admin Setup →
                    </Button>
                  </motion.div>
                )}

                {step === 'admin' && (
                  <motion.div
                    key="admin-step"
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -20 }}
                    className="space-y-6"
                  >
                    <div className="mb-4 rounded-2xl bg-emerald-50 p-4">
                      <p className="text-sm font-medium text-emerald-700">
                        <Building2 className="mb-1 inline h-4 w-4" /> Creating organization: <strong>{orgName}</strong>
                      </p>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                          Your Full Name *
                        </label>
                        <Input
                          placeholder="John Doe"
                          {...register('admin_full_name')}
                          aria-invalid={Boolean(errors.admin_full_name)}
                          className={cn(
                            'h-12 rounded-2xl border-slate-200 bg-white/85 px-4 text-sm text-slate-700 shadow-inner transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100',
                            errors.admin_full_name && 'border-red-400 focus:ring-red-100'
                          )}
                        />
                        {errors.admin_full_name && (
                          <span className="text-xs font-medium text-red-500">{errors.admin_full_name.message}</span>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                          Your Email *
                        </label>
                        <Input
                          type="email"
                          placeholder="admin@acme.com"
                          {...register('admin_email')}
                          aria-invalid={Boolean(errors.admin_email)}
                          className={cn(
                            'h-12 rounded-2xl border-slate-200 bg-white/85 px-4 text-sm text-slate-700 shadow-inner transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100',
                            errors.admin_email && 'border-red-400 focus:ring-red-100'
                          )}
                        />
                        {errors.admin_email && (
                          <span className="text-xs font-medium text-red-500">{errors.admin_email.message}</span>
                        )}
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div className="space-y-2">
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                          Password *
                        </label>
                        <Input
                          type="password"
                          placeholder="Strong password"
                          {...register('admin_password')}
                          aria-invalid={Boolean(errors.admin_password)}
                          className={cn(
                            'h-12 rounded-2xl border-slate-200 bg-white/85 px-4 text-sm text-slate-700 shadow-inner transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100',
                            errors.admin_password && 'border-red-400 focus:ring-red-100'
                          )}
                        />
                        {errors.admin_password && (
                          <span className="text-xs font-medium text-red-500">{errors.admin_password.message}</span>
                        )}
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                          Confirm Password *
                        </label>
                        <Input
                          type="password"
                          placeholder="Re-enter password"
                          {...register('confirmPassword')}
                          aria-invalid={Boolean(errors.confirmPassword)}
                          className={cn(
                            'h-12 rounded-2xl border-slate-200 bg-white/85 px-4 text-sm text-slate-700 shadow-inner transition focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100',
                            errors.confirmPassword && 'border-red-400 focus:ring-red-100'
                          )}
                        />
                        {errors.confirmPassword && (
                          <span className="text-xs font-medium text-red-500">{errors.confirmPassword.message}</span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-3 rounded-3xl bg-emerald-50/80 p-4 text-sm text-slate-600">
                      <ShieldCheck className="h-5 w-5 text-emerald-500" />
                      You will be set as the organization admin with full control
                    </div>

                    <div className="flex gap-3">
                      <Button
                        type="button"
                        onClick={() => setStep('org')}
                        variant="outline"
                        className="h-12 flex-1 rounded-2xl"
                      >
                        ← Back
                      </Button>
                      <Button
                        type="submit"
                        disabled={registerOrgMutation.isPending}
                        className="h-12 flex-1 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-500 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-[1.01]"
                      >
                        {registerOrgMutation.isPending ? 'Creating...' : 'Create Organization'}
                      </Button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </form>

            <div className="mt-8 text-center text-sm text-slate-500">
              <Link href="/register" className="font-semibold text-sky-500 hover:text-sky-600">
                ← Back to individual signup
              </Link>
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
