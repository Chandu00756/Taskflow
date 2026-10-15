'use client';

import * as React from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { CrudPage } from '@/components/desk/crud';
import { Badge, Btn, Checkbox } from '@/components/desk/kit';
import { useRoles } from '@/lib/itsm/hooks';
import { v2, parseApiError } from '@/lib/itsm/api';
import type { Privilege, Role } from '@/lib/itsm/types';

function PrivilegeMatrix({ value, onChange, privileges }: { value: string[]; onChange: (v: string[]) => void; privileges: Privilege[] }) {
  const groups = Array.from(new Set(privileges.map((p) => p.group)));
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g}>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">{g}</div>
          <div className="space-y-1.5">
            {privileges.filter((p) => p.group === g).map((p) => (
              <Checkbox key={p.key} checked={value.includes(p.key)} onChange={(on) => onChange(on ? [...value, p.key] : value.filter((x) => x !== p.key))} label={p.label} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function RolesPage() {
  const roles = useRoles();
  const qc = useQueryClient();
  const privileges = roles.data?.privileges ?? [];
  const clone = useMutation({
    mutationFn: (r: Role) => v2.post<Role>('/roles', { name: `${r.name} (copy)`, description: r.description, privileges: r.privileges }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['admin-roles'] });
      qc.invalidateQueries({ queryKey: ['lookup', 'roles'] });
      toast.success(`Created ${r.name}`);
    },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  return (
    <CrudPage<Role>
      title="Roles & permissions"
      subtitle="Agents get the combined privileges of all their roles. Account admins always have full access."
      singular="Role"
      breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Roles' }]}
      listPath="/roles"
      queryKey={['admin-roles']}
      fetcher={async () => (await v2.get<{ items: Role[] }>('/roles')).items}
      columns={[
        { label: 'Role', render: (r) => <div><div className="font-medium text-slate-900">{r.name} {r.is_default && <Badge className="ml-1 bg-slate-100 text-slate-600 ring-slate-500/20">Default</Badge>}</div><div className="text-xs text-slate-500">{r.description}</div></div> },
        { label: 'Privileges', render: (r) => `${r.privileges.length} of ${privileges.length}` },
        { label: 'Agents', render: (r) => (r.agent_count ? <Link className="text-blue-700 hover:underline" href={`/admin/agents?role_id=${r.id}`}>{r.agent_count}</Link> : 0) },
      ]}
      rowActions={(r) => (
        <Btn size="xs" variant="ghost" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => clone.mutate(r)} aria-label={`Clone ${r.name}`}>
          Clone
        </Btn>
      )}
      deletePath={(r) => (r.is_default ? null : `/roles/${r.id}`)}
      fields={[
        { name: 'name', label: 'Name', required: true },
        { name: 'description', label: 'Description', type: 'textarea', rows: 2 },
        { name: 'privileges', label: 'Privileges', type: 'custom', render: (v, onChange) => <PrivilegeMatrix value={(v as string[]) ?? []} onChange={onChange} privileges={privileges} /> },
      ]}
      defaults={{ name: '', description: '', privileges: [] }}
      toForm={(r) => ({ name: r.name, description: r.description, privileges: r.privileges })}
      drawerWidth="max-w-xl"
    />
  );
}
