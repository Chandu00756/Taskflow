'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, KeyRound, Lock, MoreHorizontal, Plus, Power, Repeat, Unlock, UserX } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, Badge, Btn, Card, Drawer, EmptyState, LoadingBlock, Menu, MenuItem, Modal, PageHeader, Pagination, SearchInput, SelectBox, StatusBadge, Table, Td, Th, useConfirm } from '@/components/desk/kit';
import { SchemaForm, FieldSpec } from '@/components/desk/crud';
import { useDebounced, useDepartmentOptions, useGroupOptions } from '@/components/desk/pickers';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useCan, useLocations, useMe, useRoles } from '@/lib/itsm/hooks';
import { TIME_ZONES, timeAgo } from '@/lib/itsm/format';
import type { ListResponse, Person } from '@/lib/itsm/types';

export function PeopleAdmin({ agents }: { agents: boolean }) {
  const qc = useQueryClient();
  const confirm = useConfirm();
  const can = useCan();
  const { data: me } = useMe();
  const roles = useRoles();
  const groupOptions = useGroupOptions();
  const deptOptions = useDepartmentOptions();
  const locations = useLocations();
  const [q, setQ] = React.useState('');
  const [state, setState] = React.useState('active');
  const [filter, setFilter] = React.useState('');
  const [page, setPage] = React.useState(1);
  const term = useDebounced(q, 300);
  React.useEffect(() => setPage(1), [term, state, filter]);
  const path = agents ? '/agents' : '/requesters';
  const key = ['admin-people', path, term, state, filter, page];
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => v2.list<Person>(path, { q: term, state, page, per_page: 30, ...(agents ? { group_id: filter } : { department_id: filter }) }),
    placeholderData: (p) => p,
  });
  const [editing, setEditing] = React.useState<{ person: Person | null; values: Record<string, unknown> } | null>(null);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [secret, setSecret] = React.useState<{ email: string; password: string; title: string } | null>(null);
  const [converting, setConverting] = React.useState<Person | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['admin-people'] });
    qc.invalidateQueries({ queryKey: ['lookup'] });
  };
  const save = useMutation({
    mutationFn: () => {
      const v = { ...editing!.values };
      delete v.reporting_manager_id__label;
      return editing!.person
        ? v2.put<unknown>(`${path}/${editing!.person.id}`, v)
        : v2.post<unknown>(path, v);
    },
    onSuccess: (res) => {
      const r = res as { person?: Person; temporary_password?: string };
      if (!editing!.person && r.temporary_password) {
        setSecret({ email: String(editing!.values.email), password: r.temporary_password, title: `${agents ? 'Agent' : 'Requester'} created` });
      } else {
        toast.success(editing!.person ? 'Saved' : 'Invitation email queued');
      }
      setEditing(null);
      setErrors({});
      invalidate();
    },
    onError: (e) => {
      const err = parseApiError(e);
      setErrors(err.fields);
      toast.error(err.message);
    },
  });
  const act = useMutation({
    mutationFn: ({ person, action }: { person: Person; action: string; body?: unknown }) => v2.post<{ temporary_password?: string; message?: string }>(`/people/${person.id}/${action}`),
    onSuccess: (res, { person, action }) => {
      if (action === 'reset-password' && res.temporary_password) setSecret({ email: person.email, password: res.temporary_password, title: 'Password reset' });
      else toast.success(res.message ?? 'Done');
      invalidate();
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });

  const roleOptions = (roles.data?.items ?? []).map((r) => ({ value: r.id, label: r.name }));
  const fields: FieldSpec[] = [
    { name: 'name', label: 'Full name', required: true, span: 1 },
    { name: 'email', label: 'Email', type: 'email', required: true, span: 1 },
    { name: 'job_title', label: 'Job title', span: 1 },
    { name: 'phone', label: 'Phone', span: 1 },
    { name: 'mobile', label: 'Mobile', span: 1 },
    { name: 'time_zone', label: 'Time zone', type: 'select', span: 1, options: TIME_ZONES.map((t) => ({ value: t, label: t })) },
    { name: 'department_id', label: 'Department', type: 'select', span: 1, options: deptOptions },
    { name: 'location_id', label: 'Location', type: 'select', span: 1, options: (locations.data ?? []).map((l) => ({ value: l.id, label: l.name })) },
    { name: 'reporting_manager_id', label: 'Reporting manager', type: 'person', hint: 'Approves service requests that need manager approval' },
    ...(agents
      ? ([
          { name: 'role_ids', label: 'Roles', type: 'multiselect', options: roleOptions, hint: 'Privileges are the union of all roles' },
          { name: 'group_ids', label: 'Groups', type: 'multiselect', options: groupOptions },
          { name: 'ticket_scope', label: 'Ticket access', type: 'select', required: true, span: 1, options: [{ value: 'global', label: 'All tickets' }, { value: 'group', label: "Their groups' tickets" }, { value: 'restricted', label: 'Only assigned tickets' }] },
          { name: 'agent_type', label: 'Agent type', type: 'select', required: true, span: 1, options: [{ value: 'full_time', label: 'Full-time' }, { value: 'occasional', label: 'Occasional' }] },
          ...(me?.is_account_admin ? [{ name: 'is_account_admin', label: 'Account admin', type: 'toggle', description: 'Full access to every module, setting and billing' } as FieldSpec] : []),
          { name: 'signature', label: 'Signature', type: 'textarea', rows: 2 },
        ] as FieldSpec[])
      : ([
          { name: 'vip', label: 'VIP', type: 'toggle', description: 'Highlight this requester to agents' },
          { name: 'external_id', label: 'External ID', span: 1, hint: 'Employee ID or HRIS reference' },
          { name: 'address', label: 'Address', type: 'textarea', rows: 2 },
          { name: 'background', label: 'Background information', type: 'textarea', rows: 2, hint: 'Visible to agents only' },
        ] as FieldSpec[])),
  ];
  const toForm = (p: Person): Record<string, unknown> => ({
    name: p.name, email: p.email, job_title: p.job_title, phone: p.phone, mobile: p.mobile, time_zone: p.time_zone, department_id: p.department_id ?? '',
    location_id: p.location_id ?? '', reporting_manager_id: p.reporting_manager_id ?? '', reporting_manager_id__label: p.reporting_manager?.name,
    role_ids: p.role_ids, group_ids: p.groups.map((g) => g.id), ticket_scope: p.ticket_scope || 'global', agent_type: p.agent_type || 'full_time',
    is_account_admin: p.is_account_admin, signature: p.signature, vip: p.vip, external_id: p.external_id, address: p.address, background: p.background,
  });
  const defaults: Record<string, unknown> = agents
    ? { name: '', email: '', role_ids: roleOptions.filter((r) => r.label === 'SD Agent').map((r) => r.value), group_ids: [], ticket_scope: 'global', agent_type: 'full_time', is_account_admin: false }
    : { name: '', email: '', vip: false };

  const items = (data as ListResponse<Person> | undefined)?.items ?? [];
  const singular = agents ? 'Agent' : 'Requester';
  const manage = can('users.manage');
  return (
    <>
      <PageHeader
        title={agents ? 'Agents' : 'Requesters'}
        subtitle={agents ? 'People who work on tickets, problems, changes and assets.' : 'Employees and customers who raise tickets and request services.'}
        breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: agents ? 'Agents' : 'Requesters' }]}
        actions={manage && <Btn variant="primary" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setErrors({}); setEditing({ person: null, values: defaults }); }}>New {singular.toLowerCase()}</Btn>}
      />
      <Card padded={false}>
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <SearchInput value={q} onChange={setQ} placeholder="Search by name or email" className="w-full sm:w-72" />
          <SelectBox aria-label="State" value={state} onChange={setState} className="w-40" options={[{ value: 'active', label: 'Active' }, { value: 'deactivated', label: 'Deactivated' }, { value: 'all', label: 'All' }]} />
          <SelectBox aria-label={agents ? 'Group' : 'Department'} value={filter} onChange={setFilter} className="w-48" placeholder={agents ? 'Any group' : 'Any department'} options={agents ? groupOptions : deptOptions} />
        </div>
        {isLoading ? <LoadingBlock /> : error ? <p className="p-6 text-center text-sm text-rose-600">{parseApiError(error).message}</p> : items.length === 0 ? (
          <EmptyState title={`No ${agents ? 'agents' : 'requesters'} found`} />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Name</Th>
                {agents ? <Th>Roles</Th> : <Th>Department</Th>}
                {agents ? <Th>Groups</Th> : <Th>Reports to</Th>}
                <Th>Status</Th>
                <Th>Last sign in</Th>
                <Th className="w-14" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <Td>
                    <Link href={`/people/${p.id}`} className="flex items-center gap-2.5">
                      <Avatar name={p.name} src={p.avatar_url} size="sm" />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-slate-900 hover:text-blue-700">
                          {p.name}
                          {p.is_account_admin && <Badge className="ml-1.5 bg-violet-50 text-violet-700 ring-violet-600/20">Admin</Badge>}
                          {p.vip && <Badge className="ml-1.5 bg-amber-100 text-amber-800 ring-amber-600/20">VIP</Badge>}
                        </span>
                        <span className="block truncate text-xs text-slate-500">{p.email}{p.job_title ? ` · ${p.job_title}` : ''}</span>
                      </span>
                    </Link>
                  </Td>
                  <Td className="text-xs">{agents ? p.roles.map((r) => r.name).join(', ') || '—' : p.department?.name ?? '—'}</Td>
                  <Td className="text-xs">{agents ? p.groups.map((g) => g.name).join(', ') || '—' : p.reporting_manager?.name ?? '—'}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1">
                      {p.active ? <StatusBadge status="active" label="Active" /> : <StatusBadge status="cancelled" label="Deactivated" />}
                      {p.locked && <StatusBadge status="rejected" label="Locked" />}
                      {p.must_change_password && <StatusBadge status="pending" label="Invited" />}
                    </div>
                  </Td>
                  <Td className="text-xs text-slate-500">{p.last_login ? timeAgo(p.last_login) : 'Never'}</Td>
                  <Td>
                    {manage && (
                      <Menu trigger={() => <button aria-label="Actions" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"><MoreHorizontal className="h-4 w-4" /></button>}>
                        {(close) => (
                          <>
                            <MenuItem onClick={() => { close(); setErrors({}); setEditing({ person: p, values: toForm(p) }); }}>Edit</MenuItem>
                            {agents ? (
                              !p.is_account_admin && (
                                <MenuItem icon={<Repeat className="h-4 w-4" />} onClick={async () => { close(); if (await confirm({ title: `Convert ${p.name} to a requester?`, message: 'They lose agent access; their open tickets become unassigned.', confirmLabel: 'Convert' })) act.mutate({ person: p, action: 'convert-to-requester' }); }}>
                                  Convert to requester
                                </MenuItem>
                              )
                            ) : (
                              <MenuItem icon={<Repeat className="h-4 w-4" />} onClick={() => { close(); setConverting(p); }}>Convert to agent</MenuItem>
                            )}
                            <MenuItem icon={<KeyRound className="h-4 w-4" />} onClick={async () => { close(); if (await confirm({ title: `Reset password for ${p.name}?`, message: 'A temporary password is issued and they must choose a new one at next sign in. Existing sessions are signed out.', confirmLabel: 'Reset password' })) act.mutate({ person: p, action: 'reset-password' }); }}>
                              Reset password
                            </MenuItem>
                            {p.locked && <MenuItem icon={<Unlock className="h-4 w-4" />} onClick={() => { close(); act.mutate({ person: p, action: 'unlock' }); }}>Unlock account</MenuItem>}
                            {p.id !== me?.user.id && (
                              p.active ? (
                                <MenuItem danger icon={<Power className="h-4 w-4" />} onClick={async () => { close(); if (await confirm({ title: `Deactivate ${p.name}?`, message: 'They can no longer sign in. Their history is kept and open assignments are released.', danger: true, confirmLabel: 'Deactivate' })) act.mutate({ person: p, action: 'deactivate' }); }}>
                                  Deactivate
                                </MenuItem>
                              ) : (
                                <MenuItem icon={<Power className="h-4 w-4" />} onClick={() => { close(); act.mutate({ person: p, action: 'reactivate' }); }}>Reactivate</MenuItem>
                              )
                            )}
                            {!agents && (
                              <MenuItem danger icon={<UserX className="h-4 w-4" />} onClick={async () => { close(); if (await confirm({ title: `Forget ${p.name}?`, message: 'Personal data is permanently anonymized (GDPR right to be forgotten). Tickets are kept without identifying details. This cannot be undone.', danger: true, confirmLabel: 'Forget permanently' })) act.mutate({ person: p, action: 'forget' }); }}>
                                Forget (GDPR)
                              </MenuItem>
                            )}
                          </>
                        )}
                      </Menu>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {data && <Pagination page={data.page} perPage={data.per_page} total={data.total} onPage={setPage} />}
      </Card>

      <Drawer
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing?.person ? `Edit ${editing.person.name}` : `New ${singular.toLowerCase()}`}
        width="max-w-2xl"
        footer={<><Btn onClick={() => setEditing(null)}>Cancel</Btn><Btn variant="primary" loading={save.isPending} onClick={() => save.mutate()}>{editing?.person ? 'Save' : `Create ${singular.toLowerCase()}`}</Btn></>}
      >
        {editing && (
          <>
            {!editing.person && <p className="mb-4 rounded-md bg-blue-50 p-3 text-sm text-blue-800">They receive a temporary password and must choose their own at first sign in.</p>}
            <SchemaForm fields={fields} values={editing.values} onChange={(values) => setEditing({ ...editing, values })} errors={errors} />
          </>
        )}
      </Drawer>

      <ConvertDialog person={converting} onClose={() => setConverting(null)} roleOptions={roleOptions} groupOptions={groupOptions} onDone={invalidate} />

      <Modal open={!!secret} onClose={() => setSecret(null)} title={secret?.title ?? ''} size="sm" footer={<Btn variant="primary" onClick={() => setSecret(null)}>Done</Btn>}>
        <div className="space-y-3 text-sm">
          <p className="text-slate-600">Email delivery is not configured, so share these credentials securely. The password is shown only once.</p>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs text-slate-500">Email</div>
            <div className="font-medium">{secret?.email}</div>
            <div className="mt-2 text-xs text-slate-500">Temporary password</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono">{secret?.password}</code>
              <Btn size="xs" aria-label="Copy password" onClick={() => secret && navigator.clipboard.writeText(secret.password).then(() => toast.success('Copied'))}><Copy className="h-3.5 w-3.5" /></Btn>
            </div>
          </div>
          <p className="flex items-center gap-1.5 text-xs text-slate-500"><Lock className="h-3.5 w-3.5" /> They must choose a new password at first sign in.</p>
        </div>
      </Modal>
    </>
  );
}

function ConvertDialog({ person, onClose, roleOptions, groupOptions, onDone }: { person: Person | null; onClose: () => void; roleOptions: { value: string; label: string }[]; groupOptions: { value: string; label: string }[]; onDone: () => void }) {
  const [values, setValues] = React.useState<Record<string, unknown>>({ role_ids: [], group_ids: [] });
  React.useEffect(() => setValues({ role_ids: roleOptions.filter((r) => r.label === 'SD Agent').map((r) => r.value), group_ids: [] }), [person, roleOptions]);
  const convert = useMutation({
    mutationFn: () => v2.post(`/people/${person!.id}/convert-to-agent`, values),
    onSuccess: () => {
      toast.success(`${person?.name} is now an agent`);
      onClose();
      onDone();
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  return (
    <Modal open={!!person} onClose={onClose} title={`Convert ${person?.name ?? ''} to an agent`} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" loading={convert.isPending} onClick={() => convert.mutate()}>Convert</Btn></>}>
      <SchemaForm
        values={values}
        onChange={setValues}
        fields={[
          { name: 'role_ids', label: 'Roles', type: 'multiselect', options: roleOptions },
          { name: 'group_ids', label: 'Groups', type: 'multiselect', options: groupOptions },
        ]}
      />
    </Modal>
  );
}
