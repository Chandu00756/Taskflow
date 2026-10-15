'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarOff, Camera, Laptop, LogOut, Smartphone, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { apiClient } from '@/lib/api/client';
import { v2, parseApiError } from '@/lib/itsm/api';
import { fmtDateTime, timeAgo, toLocalInput, fromLocalInput } from '@/lib/itsm/format';
import type { Me, NotificationPref, SessionInfo } from '@/lib/itsm/types';
import { useAuthStore } from '@/store/auth';
import { Avatar, Badge, Btn, Card, Field, LoadingBlock, TextArea, TextInput, useConfirm } from '@/components/desk/kit';
import { PersonPicker } from '@/components/desk/pickers';

// ---------------------------------------------------------------------------
// Profile picture
// ---------------------------------------------------------------------------

/** Center-crops and scales an image file to a 256px square data URL. */
async function squareImage(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('That file is not an image we can read.'));
      i.src = url;
    });
    const size = 256;
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Your browser cannot process images.');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, size, size);
    // PNG keeps transparency; everything else becomes a compact JPEG.
    return file.type === 'image/png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.9);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function AvatarUploader({ me }: { me: Me }) {
  const qc = useQueryClient();
  const input = React.useRef<HTMLInputElement>(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['me'] });
    qc.invalidateQueries({ queryKey: ['lookup'] });
  };
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (!file.type.startsWith('image/')) throw new Error('Choose a PNG, JPEG, WebP or GIF image.');
      if (file.size > 15 * 1024 * 1024) throw new Error('Choose an image smaller than 15 MB.');
      return v2.put('/me/avatar', { data_url: await squareImage(file) });
    },
    onSuccess: () => {
      toast.success('Profile picture updated');
      refresh();
    },
    onError: (e) => toast.error(e instanceof Error && !('response' in e) ? e.message : parseApiError(e).message),
  });
  const remove = useMutation({
    mutationFn: () => v2.del('/me/avatar'),
    onSuccess: () => {
      toast.success('Profile picture removed');
      refresh();
    },
  });
  return (
    <div className="flex items-center gap-4">
      <button
        type="button"
        onClick={() => input.current?.click()}
        className="group relative rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2"
        aria-label="Change profile picture"
      >
        <Avatar name={me.user.name} src={me.user.avatar_url} size="xl" />
        <span className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 text-white opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">
          <Camera className="h-5 w-5" />
        </span>
      </button>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload.mutate(f);
          e.target.value = '';
        }}
      />
      <div className="space-y-1.5">
        <div className="flex gap-2">
          <Btn size="sm" loading={upload.isPending} onClick={() => input.current?.click()}>{me.user.avatar_url ? 'Change photo' : 'Upload photo'}</Btn>
          {me.user.avatar_url && <Btn size="sm" variant="ghost" icon={<Trash2 className="h-4 w-4" />} loading={remove.isPending} onClick={() => remove.mutate()}>Remove</Btn>}
        </div>
        <p className="text-xs text-slate-500">Square photos look best. We crop and resize it for you.</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Out of office
// ---------------------------------------------------------------------------

export function OutOfOfficeCard({ me }: { me: Me }) {
  const qc = useQueryClient();
  const u = me.user;
  const scheduled = !!(u.ooo_start && u.ooo_end && new Date(u.ooo_end) > new Date());
  const [editing, setEditing] = React.useState(false);
  const [v, setV] = React.useState({ start: '', end: '', delegate_id: '', message: '' });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  React.useEffect(() => {
    const start = u.ooo_start ? toLocalInput(u.ooo_start) : toLocalInput(new Date().toISOString());
    const end = u.ooo_end ? toLocalInput(u.ooo_end) : toLocalInput(new Date(Date.now() + 7 * 864e5).toISOString());
    setV({ start, end, delegate_id: u.ooo_delegate_id ?? '', message: u.ooo_message ?? '' });
  }, [u.ooo_start, u.ooo_end, u.ooo_delegate_id, u.ooo_message, editing]);
  const save = useMutation({
    mutationFn: () => v2.put<Me>('/me/out-of-office', { ...v, start: fromLocalInput(v.start), end: fromLocalInput(v.end) }),
    onSuccess: (m) => {
      qc.setQueryData(['me'], m);
      setEditing(false);
      setErrors({});
      toast.success('Out of office saved');
    },
    onError: (e) => {
      const err = parseApiError(e);
      setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, x]) => [k, String(x)])));
      if (!Object.keys(err.fields).length) toast.error(err.message);
    },
  });
  const clear = useMutation({
    mutationFn: () => v2.del<Me>('/me/out-of-office'),
    onSuccess: (m) => {
      qc.setQueryData(['me'], m);
      toast.success('Welcome back! Out of office turned off.');
    },
  });
  return (
    <Card title={<span className="flex items-center gap-2"><CalendarOff className="h-4 w-4 text-slate-400" />Out of office</span>}>
      {!editing ? (
        <div className="space-y-3 text-sm">
          {scheduled ? (
            <div className={cn('rounded-md px-3 py-2', u.out_of_office ? 'bg-amber-50 text-amber-900' : 'bg-slate-50 text-slate-700')}>
              <div className="font-medium">{u.out_of_office ? 'You are out of office' : 'Scheduled'}</div>
              <div className="text-xs">{fmtDateTime(u.ooo_start)} – {fmtDateTime(u.ooo_end)}</div>
              {u.ooo_delegate && <div className="mt-1 text-xs">Approvals go to {u.ooo_delegate.name}</div>}
              {u.ooo_message && <div className="mt-1 text-xs italic">“{u.ooo_message}”</div>}
            </div>
          ) : (
            <p className="text-slate-600">
              While you are away {me.is_agent ? 'round-robin skips you and ' : ''}approval requests go to a delegate you choose.
            </p>
          )}
          <div className="flex gap-2">
            <Btn size="sm" variant={scheduled ? 'secondary' : 'primary'} onClick={() => setEditing(true)}>{scheduled ? 'Edit' : 'Set out of office'}</Btn>
            {scheduled && <Btn size="sm" variant="ghost" loading={clear.isPending} onClick={() => clear.mutate()}>Turn off</Btn>}
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="From" error={errors.start}><TextInput type="datetime-local" value={v.start} onChange={(e) => setV({ ...v, start: e.target.value })} /></Field>
            <Field label="Until" error={errors.end}><TextInput type="datetime-local" value={v.end} onChange={(e) => setV({ ...v, end: e.target.value })} /></Field>
          </div>
          <Field label="Delegate approvals to" hint="Optional. They receive approval requests meant for you." error={errors.delegate_id}>
            <PersonPicker value={v.delegate_id} onChange={(id) => setV({ ...v, delegate_id: id ?? '' })} initialLabel={u.ooo_delegate?.name} />
          </Field>
          <Field label="Message" error={errors.message}>
            <TextArea rows={2} maxLength={500} value={v.message} onChange={(e) => setV({ ...v, message: e.target.value })} placeholder="Back on Monday. For urgent issues contact the service desk." />
          </Field>
          <div className="flex gap-2">
            <Btn size="sm" variant="primary" loading={save.isPending} onClick={() => save.mutate()}>Save</Btn>
            <Btn size="sm" onClick={() => setEditing(false)}>Cancel</Btn>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Notification preferences
// ---------------------------------------------------------------------------

export function NotificationPreferences() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['notification-prefs'], queryFn: () => v2.items<NotificationPref>('/me/notification-preferences') });
  const save = useMutation({
    mutationFn: (patch: Record<string, { in_app?: boolean; email?: boolean }>) => v2.put<{ items: NotificationPref[] }>('/me/notification-preferences', patch),
    onMutate: async (patch) => {
      const prev = qc.getQueryData<NotificationPref[]>(['notification-prefs']);
      qc.setQueryData<NotificationPref[]>(['notification-prefs'], (old) =>
        old?.map((p) => (patch[p.key] ? { ...p, ...patch[p.key] } : p))
      );
      return { prev };
    },
    onError: (e, _p, ctx) => {
      qc.setQueryData(['notification-prefs'], ctx?.prev);
      toast.error(parseApiError(e).message);
    },
    onSuccess: (r) => qc.setQueryData(['notification-prefs'], r.items),
  });
  if (isLoading) return <LoadingBlock />;
  const prefs = data ?? [];
  const groups = Array.from(new Set(prefs.map((p) => p.group)));
  const allOn = prefs.every((p) => p.in_app);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">Choose what reaches you. Requesters always receive updates about their own tickets by email.</p>
        <Btn size="sm" variant="ghost" onClick={() => save.mutate(Object.fromEntries(prefs.map((p) => [p.key, { in_app: !allOn }])))}>
          {allOn ? 'Mute all in-app' : 'Turn all in-app on'}
        </Btn>
      </div>
      {groups.map((g) => (
        <section key={g}>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{g}</h3>
          <div className="overflow-hidden rounded-lg border border-slate-200">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Event</th>
                  <th className="w-24 px-3 py-2 font-medium">In-app</th>
                  <th className="w-24 px-3 py-2 font-medium">Email</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {prefs.filter((p) => p.group === g).map((p) => (
                  <tr key={p.key}>
                    <td className="px-3 py-2 text-slate-800">{p.label}</td>
                    <td className="px-3 py-2 text-center">
                      <input type="checkbox" className="h-4 w-4 rounded border-slate-300" aria-label={`${p.label} in-app`} checked={p.in_app} onChange={(e) => save.mutate({ [p.key]: { in_app: e.target.checked } })} />
                    </td>
                    <td className="px-3 py-2 text-center">
                      {p.email_available ? (
                        <input type="checkbox" className="h-4 w-4 rounded border-slate-300" aria-label={`${p.label} email`} checked={p.email} onChange={(e) => save.mutate({ [p.key]: { email: e.target.checked } })} />
                      ) : (
                        <span className="text-xs text-slate-400" title="No email is sent for this event">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function describeAgent(ua: string): { label: string; mobile: boolean } {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : /curl|python|Go-http/i.test(ua) ? 'API client' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return { label: os ? `${browser} on ${os}` : browser, mobile: /Mobile|iPhone|Android/.test(ua) };
}

export function SessionsCard() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const setTokens = useAuthStore((s) => s.setTokens);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['sessions', refreshToken],
    queryFn: async () => {
      const hash = refreshToken && crypto?.subtle ? await sha256Hex(refreshToken) : '';
      const res = await apiClient.get<{ items: SessionInfo[] }>('/api/v2/me/sessions', { headers: hash ? { 'X-Session-Hash': hash } : {} });
      return res.items;
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => v2.del(`/me/sessions/${id}`),
    onSuccess: () => {
      toast.success('Session signed out');
      qc.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const others = useMutation({
    mutationFn: () => v2.post<{ access_token: string; refresh_token: string }>('/me/sessions/sign-out-others'),
    onSuccess: (t) => {
      setTokens(t.access_token, t.refresh_token);
      apiClient.setAccessToken(t.access_token);
      apiClient.setRefreshToken(t.refresh_token);
      toast.success('Signed out of every other session');
      qc.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const sessions = data ?? [];
  return (
    <div className="space-y-3">
      {isLoading ? (
        <LoadingBlock />
      ) : error ? (
        <p className="text-sm text-rose-600">
          Could not load your sessions: {parseApiError(error).message}{' '}
          <button className="underline" onClick={() => refetch()}>Try again</button>
        </p>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-slate-500">No tracked sessions yet. Sessions appear here after you sign in.</p>
      ) : (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
          {sessions.map((s) => {
            const d = describeAgent(s.user_agent);
            const Icon = d.mobile ? Smartphone : Laptop;
            return (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                <Icon className="h-5 w-5 shrink-0 text-slate-400" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-slate-900">
                    {d.label}
                    {s.current && <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-600/20">This device</Badge>}
                  </div>
                  <div className="text-xs text-slate-500" title={fmtDateTime(s.created_at)}>
                    {s.ip || 'Unknown IP'} · signed in {timeAgo(s.created_at)}
                  </div>
                </div>
                {!s.current && (
                  <Btn size="xs" variant="ghost" loading={revoke.isPending && revoke.variables === s.id} onClick={() => revoke.mutate(s.id)}>Sign out</Btn>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <Btn
        size="sm"
        icon={<LogOut className="h-4 w-4" />}
        loading={others.isPending}
        onClick={async () => {
          if (await confirm({ title: 'Sign out everywhere else?', message: 'Every other browser and phone signed in to your account is signed out immediately. You stay signed in here, and API keys keep working.', confirmLabel: 'Sign out others', danger: true })) others.mutate();
        }}
      >
        Sign out of all other sessions
      </Btn>
    </div>
  );
}
