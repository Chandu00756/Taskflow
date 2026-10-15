'use client';

import * as React from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, Download, FileUp, TriangleAlert } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { v2, parseApiError } from '@/lib/itsm/api';
import type { ImportRow } from '@/lib/itsm/types';
import { Badge, Btn, Modal, TextArea } from '@/components/desk/kit';

interface ImportResult {
  rows: ImportRow[];
  summary: { create: number; update: number; error: number };
  dry_run: boolean;
  columns: string[];
}

const TEMPLATE = {
  requesters: 'name,email,job_title,phone,mobile,unit,location,reporting_manager,vip,time_zone,language\nAda Lovelace,ada@example.com,Analyst,,,Finance,HQ,manager@example.com,no,Europe/London,en\n',
  agents: 'name,email,job_title,phone,mobile,unit,location,reporting_manager,vip,time_zone,language,groups,roles\nGrace Hopper,grace@example.com,Engineer,,,IT,HQ,,,America/New_York,en,Service Desk; Network Team,SD Agent\n',
};

function downloadText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvCell(s: string) {
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Bulk create or update people from CSV: check first, then import. */
export function ImportPeopleDialog({ open, agents, onClose, onDone }: { open: boolean; agents: boolean; onClose: () => void; onDone: () => void }) {
  const kind = agents ? 'agents' : 'requesters';
  const [csv, setCsv] = React.useState('');
  const [fileName, setFileName] = React.useState('');
  const [check, setCheck] = React.useState<ImportResult | null>(null);
  const [done, setDone] = React.useState<ImportResult | null>(null);
  const [error, setError] = React.useState('');
  const fileRef = React.useRef<HTMLInputElement>(null);
  React.useEffect(() => {
    if (open) {
      setCsv('');
      setFileName('');
      setCheck(null);
      setDone(null);
      setError('');
    }
  }, [open]);
  const run = useMutation({
    mutationFn: (dryRun: boolean) => v2.post<ImportResult>('/people/import', { kind, csv, dry_run: dryRun }),
    onSuccess: (r) => {
      setError('');
      if (r.dry_run) setCheck(r);
      else {
        setDone(r);
        onDone();
        toast.success(`${r.summary.create} created, ${r.summary.update} updated${r.summary.error ? `, ${r.summary.error} skipped` : ''}`);
      }
    },
    onError: (e) => {
      const err = parseApiError(e);
      setError(err.fields.csv ? `The file ${err.fields.csv}` : err.message);
    },
  });
  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) {
      setError('The file is larger than 2 MB. Split it into smaller files.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCsv(String(reader.result ?? ''));
      setFileName(f.name);
      setCheck(null);
    };
    reader.readAsText(f);
  };
  const result = done ?? check;
  const ready = check && check.summary.create + check.summary.update > 0;
  const credentials = (done?.rows ?? []).filter((r) => r.temporary_password);

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={`Import ${kind} from CSV`}
      footer={
        done ? (
          <Btn variant="primary" onClick={onClose}>Done</Btn>
        ) : (
          <>
            <Btn onClick={onClose}>Cancel</Btn>
            {!check ? (
              <Btn variant="primary" loading={run.isPending} disabled={!csv.trim()} onClick={() => run.mutate(true)}>Check file</Btn>
            ) : (
              <>
                <Btn onClick={() => setCheck(null)}>Edit</Btn>
                <Btn variant="primary" loading={run.isPending} disabled={!ready} onClick={() => run.mutate(false)}>
                  Import {check.summary.create + check.summary.update} {check.summary.create + check.summary.update === 1 ? 'person' : 'people'}
                </Btn>
              </>
            )}
          </>
        )
      }
    >
      {!result ? (
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Use one row per person. <strong>email</strong> is required; <strong>name</strong> is required for new people. Existing people (matched by email) are updated.
            Units can be given by name or code; managers by email; {agents ? 'separate several groups or roles with semicolons.' : 'vip accepts yes or no.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
            <Btn icon={<FileUp className="h-4 w-4" />} onClick={() => fileRef.current?.click()}>Choose CSV file</Btn>
            {fileName && <span className="text-sm text-slate-600">{fileName}</span>}
            <Btn variant="ghost" size="sm" icon={<Download className="h-4 w-4" />} onClick={() => downloadText(`${kind}-template.csv`, TEMPLATE[kind])} className="ml-auto">
              Download template
            </Btn>
          </div>
          <TextArea rows={9} value={csv} onChange={(e) => { setCsv(e.target.value); setFileName(''); }} placeholder={TEMPLATE[kind]} className="font-mono text-xs" aria-label="CSV content" />
          {error && <p className="flex items-center gap-1.5 text-sm text-rose-600"><TriangleAlert className="h-4 w-4" /> {error}</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {done ? <CheckCircle2 className="h-5 w-5 text-emerald-600" /> : null}
            <span className="font-medium text-slate-800">{done ? 'Import finished' : 'Ready to import'}</span>
            <Badge className="bg-emerald-50 text-emerald-700 ring-emerald-600/20">{result.summary.create} new</Badge>
            <Badge className="bg-sky-50 text-sky-700 ring-sky-600/20">{result.summary.update} updated</Badge>
            {result.summary.error > 0 && <Badge className="bg-rose-50 text-rose-700 ring-rose-600/20">{result.summary.error} with errors {done ? '(skipped)' : '(will be skipped)'}</Badge>}
          </div>
          {credentials.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900">
              <span>Email delivery is not configured. Download the temporary passwords now and share them securely; they are not shown again.</span>
              <Btn
                size="sm"
                icon={<Download className="h-4 w-4" />}
                onClick={() => downloadText(`${kind}-credentials.csv`, 'email,temporary_password\n' + credentials.map((r) => `${csvCell(r.email)},${csvCell(r.temporary_password ?? '')}`).join('\n') + '\n')}
              >
                Download passwords
              </Btn>
            </div>
          )}
          <div className="max-h-[50vh] overflow-auto rounded-md border border-slate-200">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2">Line</th>
                  <th className="px-3 py-2">Person</th>
                  <th className="px-3 py-2">Result</th>
                  <th className="px-3 py-2">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {result.rows.map((r) => (
                  <tr key={r.line} className={cn(r.action === 'error' && 'bg-rose-50/40')}>
                    <td className="px-3 py-1.5 text-xs text-slate-500">{r.line}</td>
                    <td className="px-3 py-1.5">
                      <div className="font-medium text-slate-900">{r.name || '—'}</div>
                      <div className="text-xs text-slate-500">{r.email || 'no email'}</div>
                    </td>
                    <td className="px-3 py-1.5">
                      <Badge
                        className={
                          r.action === 'create'
                            ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/20'
                            : r.action === 'update'
                              ? 'bg-sky-50 text-sky-700 ring-sky-600/20'
                              : 'bg-rose-50 text-rose-700 ring-rose-600/20'
                        }
                      >
                        {r.action === 'create' ? (done ? 'Created' : 'New') : r.action === 'update' ? (done ? 'Updated' : 'Update') : 'Error'}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5 text-xs text-rose-700">
                      {r.errors && Object.entries(r.errors).map(([k, v]) => <div key={k}>{k.replace(/_/g, ' ')}: {v}</div>)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <p className="text-sm text-rose-600">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
