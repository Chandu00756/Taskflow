'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Download, Fingerprint, KeyRound, Pencil, RefreshCw, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Btn, LoadingBlock, Modal, TextInput, useConfirm } from '@/components/desk/kit';
import { v2, parseApiError } from '@/lib/itsm/api';
import { fmtDateTime, timeAgo } from '@/lib/itsm/format';
import { createPasskey, defaultPasskeyName, passkeyErrorMessage, passkeysSupported } from '@/lib/passkeys';

export interface PasskeyRow {
  id: string;
  name: string;
  synced: boolean;
  created_at: string;
  last_used_at?: string | null;
  last_used_ip?: string;
}

export interface AccountSecurity {
  email: string;
  role: string;
  passkeys: PasskeyRow[];
  passkey_required: boolean;
  recovery_codes_remaining: number;
  events: { action: string; summary: string; ip: string; created_at: string }[];
}

export function useAccountSecurity() {
  return useQuery({ queryKey: ['account-security'], queryFn: () => v2.get<AccountSecurity>('/account/security') });
}

/** Shows freshly generated recovery codes once, with copy and download. */
export function RecoveryCodesModal({ codes, email, onClose }: { codes: string[] | null; email: string; onClose: () => void }) {
  if (!codes) return null;
  const text = `TaskFlow recovery codes for ${email}\nEach code works once.\n\n${codes.join('\n')}\n`;
  return (
    <Modal
      open
      onClose={onClose}
      title="Save your recovery codes"
      footer={<Btn variant="primary" onClick={onClose}>I saved them</Btn>}
    >
      <p className="mb-3 text-sm text-slate-600">If you lose your passkeys, each code lets you sign in once. They won&apos;t be shown again.</p>
      <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-sm text-slate-800">
        {codes.map((c) => <span key={c}>{c}</span>)}
      </div>
      <div className="mt-3 flex gap-2">
        <Btn size="sm" onClick={() => { void navigator.clipboard.writeText(codes.join('\n')); toast.success('Copied'); }}>
          <Copy className="h-4 w-4" /> Copy
        </Btn>
        <Btn
          size="sm"
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
    </Modal>
  );
}

/** Passkeys and recovery codes for the signed-in person. */
export function PasskeysCard() {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const { data, isLoading, error } = useAccountSecurity();
  const [codes, setCodes] = React.useState<string[] | null>(null);
  const [renaming, setRenaming] = React.useState<PasskeyRow | null>(null);
  const [name, setName] = React.useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['account-security'] });

  const add = useMutation({
    mutationFn: async () => {
      const ceremony = await v2.post<{ challenge_id: string; options: Record<string, any> }>('/account/passkeys/options');
      const credential = await createPasskey(ceremony.options);
      return v2.post<{ recovery_codes?: string[] }>('/account/passkeys', { challenge_id: ceremony.challenge_id, credential, name: defaultPasskeyName() });
    },
    onSuccess: (res) => {
      toast.success('Passkey added');
      if (res.recovery_codes?.length) setCodes(res.recovery_codes);
      refresh();
    },
    onError: (e) => toast.error((e as any)?.response ? parseApiError(e).message : passkeyErrorMessage(e)),
  });

  const regenerate = useMutation({
    mutationFn: () => v2.post<{ recovery_codes: string[] }>('/account/recovery-codes'),
    onSuccess: (res) => {
      setCodes(res.recovery_codes);
      refresh();
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });

  const rename = useMutation({
    mutationFn: () => v2.put(`/account/passkeys/${renaming?.id}`, { name }),
    onSuccess: () => {
      setRenaming(null);
      refresh();
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });

  const remove = async (k: PasskeyRow) => {
    const ok = await confirm({ title: 'Remove passkey?', message: `"${k.name}" will no longer sign you in.`, confirmLabel: 'Remove', danger: true });
    if (!ok) return;
    try {
      await v2.del(`/account/passkeys/${k.id}`);
      toast.success('Passkey removed');
      refresh();
    } catch (e) {
      toast.error(parseApiError(e).message);
    }
  };

  if (isLoading) return <LoadingBlock />;
  if (error || !data) return <p className="text-sm text-rose-600">{parseApiError(error).message}</p>;

  const none = data.passkeys.length === 0;
  return (
    <div className="space-y-4 text-sm">
      {data.passkey_required ? (
        <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Your account is an admin account, so it always signs in with a passkey. Keep at least two (for example your phone and your laptop).</span>
        </div>
      ) : none ? (
        <div className="flex items-start gap-2 rounded-md border border-blue-100 bg-blue-50 p-3 text-blue-900">
          <Fingerprint className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Add a passkey to protect your account. After that you&apos;ll confirm every sign-in with your fingerprint, face or screen lock.</span>
        </div>
      ) : null}

      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
        {data.passkeys.map((k) => (
          <li key={k.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <KeyRound className="h-4 w-4 shrink-0 text-slate-400" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 font-medium text-slate-900">
                  <span className="truncate">{k.name}</span>
                  {k.synced && <Badge className="bg-slate-100 text-slate-600">synced</Badge>}
                </div>
                <div className="text-xs text-slate-500">
                  Added {fmtDateTime(k.created_at)} · {k.last_used_at ? `last used ${timeAgo(k.last_used_at)}${k.last_used_ip ? ` from ${k.last_used_ip}` : ''}` : 'never used'}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 gap-1">
              <Btn size="xs" variant="ghost" aria-label="Rename" onClick={() => { setRenaming(k); setName(k.name); }}>
                <Pencil className="h-3.5 w-3.5" />
              </Btn>
              <Btn size="xs" variant="ghost" aria-label="Remove" onClick={() => remove(k)}>
                <Trash2 className="h-3.5 w-3.5 text-rose-500" />
              </Btn>
            </div>
          </li>
        ))}
        {none && <li className="px-3 py-4 text-center text-xs text-slate-500">No passkeys yet.</li>}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <Btn variant="primary" size="sm" loading={add.isPending} disabled={!passkeysSupported()} onClick={() => add.mutate()}>
          <KeyRound className="h-4 w-4" /> Add a passkey
        </Btn>
        {!none && (
          <Btn size="sm" loading={regenerate.isPending} onClick={async () => {
            const ok = await confirm({ title: 'Generate new recovery codes?', message: 'Your current recovery codes will stop working.', confirmLabel: 'Generate' });
            if (ok) regenerate.mutate();
          }}>
            <RefreshCw className="h-4 w-4" /> New recovery codes
          </Btn>
        )}
      </div>
      {!none && (
        <div className={`flex items-center gap-2 text-xs ${data.recovery_codes_remaining <= 2 ? 'text-amber-700' : 'text-slate-500'}`}>
          {data.recovery_codes_remaining <= 2 && <ShieldAlert className="h-3.5 w-3.5" />}
          {data.recovery_codes_remaining} recovery code{data.recovery_codes_remaining === 1 ? '' : 's'} left.
        </div>
      )}
      {!passkeysSupported() && <p className="text-xs text-amber-700">This browser can&apos;t create passkeys.</p>}

      <RecoveryCodesModal codes={codes} email={data.email} onClose={() => setCodes(null)} />
      <Modal
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title="Rename passkey"
        size="sm"
        footer={<Btn variant="primary" loading={rename.isPending} onClick={() => rename.mutate()}>Save</Btn>}
      >
        <TextInput autoFocus value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
      </Modal>
    </div>
  );
}
