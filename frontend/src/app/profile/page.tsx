'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Palette, ShieldCheck, UserRound } from 'lucide-react';
import { toast } from 'sonner';
import { DeskShell, FullPageSpinner } from '@/components/desk/shell';
import { PortalShell } from '@/components/portal/shell';
import { Avatar, Badge, Btn, Card, Field, LinkBtn, PageHeader, SelectBox, TextArea, TextInput, useConfirm } from '@/components/desk/kit';
import { useHydrated } from '@/components/desk/session';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useMe } from '@/lib/itsm/hooks';
import { TIME_ZONES, fmtDateTime, timeAgo } from '@/lib/itsm/format';
import { useAuthStore } from '@/store/auth';
import { AppearanceSettings } from '@/components/theme/theme-picker';

function ProfileContent() {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const confirm = useConfirm();
  const [form, setForm] = React.useState({ name: '', job_title: '', phone: '', mobile: '', time_zone: '', language: '', signature: '' });
  React.useEffect(() => {
    if (me) setForm({ name: me.user.name, job_title: me.user.job_title, phone: me.user.phone, mobile: me.user.mobile, time_zone: me.user.time_zone, language: me.user.language || 'en', signature: me.user.signature });
  }, [me]);
  const save = useMutation({
    mutationFn: () => v2.put('/me', form),
    onSuccess: () => {
      toast.success('Profile updated');
      qc.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const apiKey = useQuery({ queryKey: ['api-key'], queryFn: () => v2.get<{ api_key: { prefix: string; created_at: string; last_used_at: string | null } | null }>('/me/api-key'), enabled: !!me?.is_agent });
  const [newKey, setNewKey] = React.useState<string | null>(null);
  const regen = useMutation({
    mutationFn: () => v2.post<{ key: string }>('/me/api-key'),
    onSuccess: (r) => {
      setNewKey(r.key);
      qc.invalidateQueries({ queryKey: ['api-key'] });
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const revoke = useMutation({
    mutationFn: () => v2.del('/me/api-key'),
    onSuccess: () => {
      setNewKey(null);
      qc.invalidateQueries({ queryKey: ['api-key'] });
      toast.success('API key revoked');
    },
  });
  if (!me) return null;
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));
  const tzOptions = Array.from(new Set([...TIME_ZONES, form.time_zone].filter(Boolean))).map((t) => ({ value: t, label: t }));
  return (
    <>
      <PageHeader title="Profile & security" subtitle="Manage how you appear to others and keep your account secure." />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card title={<span className="flex items-center gap-2"><UserRound className="h-4 w-4 text-slate-400" />Profile</span>}>
          <div className="mb-5 flex items-center gap-4">
            <Avatar name={me.user.name} src={me.user.avatar_url} size="lg" />
            <div>
              <div className="text-base font-semibold text-slate-900">{me.user.name}</div>
              <div className="text-sm text-slate-500">{me.user.email}</div>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <Badge className="bg-slate-100 text-slate-700 ring-slate-500/20">{me.organization.name}</Badge>
                <Badge className={me.is_agent ? 'bg-blue-50 text-blue-700 ring-blue-600/20' : 'bg-slate-100 text-slate-700 ring-slate-500/20'}>{me.is_account_admin ? 'Account admin' : me.is_agent ? 'Agent' : 'Requester'}</Badge>
                {me.user.roles.map((r) => <Badge key={r.id} className="bg-violet-50 text-violet-700 ring-violet-600/20">{r.name}</Badge>)}
              </div>
            </div>
          </div>
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate();
            }}
          >
            <Field label="Full name" required><TextInput value={form.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="Job title"><TextInput value={form.job_title} onChange={(e) => set('job_title', e.target.value)} /></Field>
            <Field label="Work phone"><TextInput value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
            <Field label="Mobile"><TextInput value={form.mobile} onChange={(e) => set('mobile', e.target.value)} /></Field>
            <Field label="Time zone"><SelectBox value={form.time_zone} onChange={(v) => set('time_zone', v)} placeholder="Organization default" options={tzOptions} /></Field>
            <Field label="Language"><SelectBox value={form.language} onChange={(v) => set('language', v)} options={[{ value: 'en', label: 'English' }, { value: 'es', label: 'Español' }, { value: 'fr', label: 'Français' }, { value: 'de', label: 'Deutsch' }]} /></Field>
            {me.is_agent && (
              <Field label="Email signature" hint="Inserted into replies with one click" className="sm:col-span-2">
                <TextArea value={form.signature} onChange={(e) => set('signature', e.target.value)} rows={3} />
              </Field>
            )}
            <div className="flex justify-end sm:col-span-2">
              <Btn type="submit" variant="primary" loading={save.isPending}>Save profile</Btn>
            </div>
          </form>
        </Card>
        <div className="space-y-5">
          <Card title={<span className="flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-slate-400" />Security</span>}>
            <div className="space-y-4 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-slate-900">Password</div>
                  <div className="text-xs text-slate-500">Changing it signs out your other sessions.</div>
                </div>
                <LinkBtn href="/change-password" size="sm">Change</LinkBtn>
              </div>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-slate-900">Security questions</div>
                  <div className="text-xs text-slate-500">{me.has_security_questions ? 'Set — used for self-service password reset.' : 'Not set — you cannot reset your password yourself.'}</div>
                </div>
                <LinkBtn href="/set-security-questions" size="sm">{me.has_security_questions ? 'Update' : 'Set up'}</LinkBtn>
              </div>
              <div className="rounded-md bg-slate-50 p-3 text-xs text-slate-600">
                Last sign in: {me.user.last_login ? `${timeAgo(me.user.last_login)} (${fmtDateTime(me.user.last_login)})` : '—'}
              </div>
            </div>
          </Card>
          {me.is_agent && (
            <Card title={<span className="flex items-center gap-2"><KeyRound className="h-4 w-4 text-slate-400" />API key</span>}>
              <p className="mb-3 text-sm text-slate-600">
                Use with HTTP Basic auth (<code className="rounded bg-slate-100 px-1 text-xs">key:X</code>) to call <code className="rounded bg-slate-100 px-1 text-xs">/api/v2</code> as yourself.
              </p>
              {newKey && (
                <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 p-3">
                  <div className="mb-1 text-xs font-semibold text-amber-900">Copy your key now — it will not be shown again.</div>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 break-all rounded bg-white px-2 py-1 font-mono text-xs">{newKey}</code>
                    <Btn size="xs" aria-label="Copy key" onClick={() => navigator.clipboard.writeText(newKey).then(() => toast.success('Copied'))}><Copy className="h-3.5 w-3.5" /></Btn>
                  </div>
                </div>
              )}
              {apiKey.data?.api_key ? (
                <div className="space-y-3 text-sm">
                  <div className="text-slate-700">Active key <code className="font-mono text-xs">{apiKey.data.api_key.prefix}…</code> · last used {apiKey.data.api_key.last_used_at ? timeAgo(apiKey.data.api_key.last_used_at) : 'never'}</div>
                  <div className="flex gap-2">
                    <Btn size="sm" onClick={async () => (await confirm({ title: 'Regenerate API key?', message: 'Integrations using the current key will stop working.', confirmLabel: 'Regenerate' })) && regen.mutate()}>Regenerate</Btn>
                    <Btn size="sm" variant="ghost" onClick={() => revoke.mutate()}>Revoke</Btn>
                  </div>
                </div>
              ) : (
                <Btn size="sm" variant="primary" loading={regen.isPending} onClick={() => regen.mutate()}>Generate API key</Btn>
              )}
            </Card>
          )}
          <Card title="Quick links">
            <ul className="space-y-1.5 text-sm">
              <li><Link className="text-blue-700 hover:underline" href={me.is_agent ? '/notifications' : '/portal/notifications'}>Notifications</Link></li>
              <li><Link className="text-blue-700 hover:underline" href={me.is_agent ? '/tickets?view=raised_by_me' : '/portal/tickets'}>Tickets I raised</Link></li>
              {me.is_agent && <li><Link className="text-blue-700 hover:underline" href="/me/tasks">My tasks</Link></li>}
            </ul>
          </Card>
        </div>
      </div>
      <section id="appearance" className="mt-5 scroll-mt-24">
        <Card title={<span className="flex items-center gap-2"><Palette className="h-4 w-4 text-slate-400" />Appearance</span>}>
          <AppearanceSettings />
        </Card>
      </section>
    </>
  );
}

export default function ProfilePage() {
  const hydrated = useHydrated();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const { data: me } = useMe();
  if (!hydrated) return <FullPageSpinner />;
  if (isAuthenticated && me && !me.is_agent) {
    return (
      <PortalShell>
        <ProfileContent />
      </PortalShell>
    );
  }
  return (
    <DeskShell requireAgent={false}>
      <ProfileContent />
    </DeskShell>
  );
}
