"use client";

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';

export default function AdminInvitesPage() {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [fullName, setFullName] = useState('');
  const [expires, setExpires] = useState(72);
  const [role, setRole] = useState<'member' | 'admin'>('member');
  const [devToken, setDevToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const { user } = useAuthStore();
  const orgId = user?.org_id || '';

  const createInvite = useMutation({
    mutationFn: () => api.invites.createInvite(orgId || '', { email, username, full_name: fullName, role, expires_hours: expires }),
    onSuccess: (res: any) => {
      toast.success('Invite created.');
      const token = res?.token || res?.data?.token;
      if (token) {
        setDevToken(token);
        // copy to clipboard where available
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
          navigator.clipboard.writeText(token).then(() => setCopied(true)).catch(() => setCopied(false));
        }
      } else {
        setDevToken(null);
        setCopied(false);
      }
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.message || 'Failed to create invite');
    },
  });

  const fetchInvites = useQuery({
    queryKey: ['invites', orgId],
    queryFn: () => api.invites.listInvites(orgId || ''),
    enabled: !!orgId,
  });

  const copyToken = async () => {
    if (!devToken) return;
    try {
      await navigator.clipboard.writeText(devToken);
      setCopied(true);
      toast.success('Copied invite token to clipboard');
    } catch (e) {
      toast.error('Failed to copy token');
    }
  };

  return (
    <div className="p-6">
      <h2 className="text-2xl font-semibold mb-4">Organization Invites</h2>

      <div className="mb-6 grid grid-cols-1 md:grid-cols-4 gap-3 max-w-2xl">
        <Input placeholder="user@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input placeholder="username" value={username} onChange={(e) => setUsername(e.target.value)} />
        <Input placeholder="Full name (optional)" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        <div className="flex space-x-2">
          <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as any)} className="rounded-md border px-3 py-2">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <Input placeholder="Expires hours" value={String(expires)} onChange={(e) => setExpires(Number(e.target.value))} />
          <Button onClick={() => createInvite.mutate()} disabled={createInvite.isPending || !email}>Create Invite</Button>
        </div>
      </div>

      {devToken && (
        <div className="mb-4 max-w-2xl">
          <label className="block text-sm font-medium text-slate-700">Dev invite token (shown only in development)</label>
          <div className="mt-2 flex items-center gap-2">
            <input aria-label="Dev invite token" readOnly value={devToken} className="flex-1 rounded-md border px-3 py-2 bg-slate-50 text-sm" />
            <Button onClick={copyToken}>{copied ? 'Copied' : 'Copy'}</Button>
            <Button variant="ghost" onClick={() => { setDevToken(null); setCopied(false); }}>Dismiss</Button>
          </div>
          <p className="text-xs text-slate-500 mt-1">Tokens are only returned in development. In production the invite will be emailed.</p>
        </div>
      )}

      <div className="max-w-3xl">
        <h3 className="text-lg font-medium mb-2">Invites</h3>
        <div className="space-y-2">
          {fetchInvites.isLoading && <p>Loading...</p>}
          {fetchInvites.data?.invites?.length === 0 && <p>No invites</p>}
          {fetchInvites.data?.invites?.map((iv: any) => (
            <div key={iv.invite_id} className="rounded-md border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-semibold">{iv.email}</div>
                  <div className="text-xs text-slate-500">{iv.full_name || iv.username || '—'}</div>
                </div>
                <div className="text-xs text-slate-500">Role: {iv.role} • Expires: {iv.expires_at}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
