'use client';

import * as React from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, Mail, RefreshCw, Send, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { v2, parseApiError } from '@/lib/itsm/api';

interface EmailStatus {
  configured: boolean;
  host: string;
  port: string;
  user: string;
  from: string;
  public_url: string;
  email_verification: boolean;
  last_24h: Record<'queued' | 'sending' | 'sent' | 'failed' | 'skipped', number>;
  recent: { to: string; subject: string; status: string; attempts: number; last_error: string; org_name?: string | null; created_at: string; sent_at?: string | null }[];
}

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  sent: 'default',
  queued: 'secondary',
  sending: 'secondary',
  failed: 'destructive',
  skipped: 'outline',
};

/** Platform console: outgoing mail settings, a live test send and recent deliveries. */
export function EmailDeliveryPanel({ defaultTo }: { defaultTo?: string }) {
  const [to, setTo] = React.useState(defaultTo ?? '');
  const [result, setResult] = React.useState<{ ok: boolean; message: string } | null>(null);
  const status = useQuery({ queryKey: ['platform-email'], queryFn: () => v2.get<EmailStatus>('/platform/email'), refetchInterval: 15_000 });
  const test = useMutation({
    mutationFn: () => v2.post<{ message: string }>('/platform/email/test', { to: to.trim() }),
    onSuccess: (res) => {
      setResult({ ok: true, message: res.message });
      toast.success('Test email sent');
      status.refetch();
    },
    onError: (e) => setResult({ ok: false, message: parseApiError(e).message }),
  });
  const s = status.data;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" /> Outgoing email
          </CardTitle>
          <Button variant="ghost" size="sm" onClick={() => status.refetch()} aria-label="Refresh email status">
            <RefreshCw className={`h-4 w-4 ${status.isFetching ? 'animate-spin' : ''}`} />
          </Button>
        </CardHeader>
        <CardContent className="space-y-5">
          {status.isError && <p className="text-sm text-rose-600">{parseApiError(status.error).message}</p>}
          {s && (
            <>
              <div className={`flex items-start gap-3 rounded-lg border p-4 text-sm ${s.configured ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
                {s.configured ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />}
                <div>
                  <p className="font-medium">{s.configured ? 'Email sending is configured' : 'Email sending is off'}</p>
                  <p className="mt-1">
                    {s.configured
                      ? `New sign-ups ${s.email_verification ? 'must verify their email before signing in' : 'can sign in without verifying their email'}. Password reset links are available.`
                      : 'No mail server is set, so notifications, welcome emails, verification and reset links are not sent. Add the SMTP_* settings to the server .env and restart itsm-service and user-service.'}
                  </p>
                </div>
              </div>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                {[
                  ['Mail server', s.host ? `${s.host}:${s.port}` : '—'],
                  ['Sign-in user', s.user || '—'],
                  ['Sender (From)', s.from || '—'],
                  ['Links point to', s.public_url],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-slate-500">{k}</dt>
                    <dd className="font-medium text-slate-900 break-all">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="flex flex-wrap gap-2 text-xs">
                {(['sent', 'queued', 'sending', 'failed', 'skipped'] as const).map((k) => (
                  <Badge key={k} variant={statusVariant[k]}>
                    {k}: {s.last_24h[k] ?? 0}
                  </Badge>
                ))}
                <span className="self-center text-slate-500">in the last 24 hours</span>
              </div>
            </>
          )}
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              setResult(null);
              if (to.trim()) test.mutate();
            }}
          >
            <Input type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="Send a test email to…" aria-label="Test email recipient" className="sm:max-w-sm" />
            <Button type="submit" disabled={test.isPending || !to.trim()}>
              <Send className="mr-2 h-4 w-4" />
              {test.isPending ? 'Sending…' : 'Send test email'}
            </Button>
          </form>
          {result && (
            <p className={`rounded-md border px-3 py-2 text-sm break-words ${result.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-rose-200 bg-rose-50 text-rose-800'}`}>{result.message}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recent emails</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead className="border-b bg-slate-50 text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-4 py-3">To</th>
                <th className="px-4 py-3">Subject</th>
                <th className="px-4 py-3">Organization</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Queued</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {(s?.recent ?? []).map((r, i) => (
                <tr key={`${r.created_at}-${i}`} className="align-top">
                  <td className="px-4 py-3 break-all">{r.to}</td>
                  <td className="px-4 py-3">{r.subject}</td>
                  <td className="px-4 py-3 text-slate-500">{r.org_name || 'Platform'}</td>
                  <td className="px-4 py-3">
                    <Badge variant={statusVariant[r.status] ?? 'outline'}>{r.status}</Badge>
                    {r.last_error && <p className="mt-1 max-w-xs text-xs text-rose-600 break-words">{r.last_error}</p>}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-slate-500">{new Date(r.created_at).toLocaleString()}</td>
                </tr>
              ))}
              {s && s.recent.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    No emails yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
