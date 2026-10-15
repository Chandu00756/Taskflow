'use client';

import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FolderPlus } from 'lucide-react';
import { toast } from 'sonner';
import { CrudPage } from '@/components/desk/crud';
import { Btn, Modal, TextInput } from '@/components/desk/kit';
import { PLACEHOLDER_HELP } from '@/components/admin/editors';
import { useGroupOptions } from '@/components/desk/pickers';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useCan } from '@/lib/itsm/hooks';
import type { CannedResponse } from '@/lib/itsm/types';

export default function CannedResponsesPage() {
  const qc = useQueryClient();
  const can = useCan();
  const groups = useGroupOptions();
  const data = useQuery({ queryKey: ['canned'], queryFn: () => v2.get<{ folders: { id: string; name: string }[]; items: CannedResponse[] }>('/canned-responses') });
  const folders = data.data?.folders ?? [];
  const [folderOpen, setFolderOpen] = React.useState(false);
  const [folderName, setFolderName] = React.useState('');
  const addFolder = useMutation({
    mutationFn: () => v2.post('/canned-folders', { name: folderName }),
    onSuccess: () => { setFolderOpen(false); setFolderName(''); qc.invalidateQueries({ queryKey: ['canned'] }); toast.success('Folder created'); },
    onError: (e) => toast.error(parseApiError(e).message),
  });
  const visOptions = can('settings.manage') ? [{ value: 'all', label: 'All agents' }, { value: 'groups', label: 'Selected groups' }, { value: 'me', label: 'Only me' }] : [{ value: 'me', label: 'Only me' }];
  return (
    <>
      <CrudPage<CannedResponse>
        title="Canned responses"
        subtitle="Reusable replies. Insert them from the reply box on any ticket."
        singular="Canned response"
        breadcrumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Canned responses' }]}
        listPath="/canned-responses"
        queryKey={['canned', 'list']}
        fetcher={async () => (await v2.get<{ items: CannedResponse[] }>('/canned-responses')).items}
        searchable={(r, q) => r.title.toLowerCase().includes(q) || r.content.toLowerCase().includes(q)}
        headerActions={can('settings.manage') && <Btn size="sm" icon={<FolderPlus className="h-4 w-4" />} onClick={() => setFolderOpen(true)}>New folder</Btn>}
        columns={[
          { label: 'Title', render: (r) => <span className="font-medium text-slate-900">{r.title}</span> },
          { label: 'Folder', render: (r) => folders.find((f) => f.id === r.folder_id)?.name ?? '—' },
          { label: 'Preview', render: (r) => <span className="line-clamp-2 text-xs text-slate-500">{r.content}</span> },
          { label: 'Visibility', render: (r) => (r.visibility === 'me' ? 'Only me' : r.visibility === 'all' ? 'All agents' : 'Groups') },
        ]}
        fields={[
          { name: 'title', label: 'Title', required: true, span: 1 },
          { name: 'folder_id', label: 'Folder', type: 'select', span: 1, options: folders.map((f) => ({ value: f.id, label: f.name })) },
          { name: 'content', label: 'Content', type: 'textarea', rows: 8, required: true, hint: `Placeholders: ${PLACEHOLDER_HELP}` },
          { name: 'visibility', label: 'Available to', type: 'select', required: true, span: 1, options: visOptions },
          { name: 'group_ids', label: 'Groups', type: 'multiselect', options: groups, show: (v) => v.visibility === 'groups' },
        ]}
        defaults={{ title: '', folder_id: folders[0]?.id ?? '', content: '', visibility: 'me', group_ids: [] }}
        toForm={(r) => ({ title: r.title, folder_id: r.folder_id ?? '', content: r.content, visibility: r.visibility, group_ids: r.group_ids ?? [] })}
        drawerWidth="max-w-2xl"
      />
      <Modal open={folderOpen} onClose={() => setFolderOpen(false)} title="New folder" size="sm" footer={<><Btn onClick={() => setFolderOpen(false)}>Cancel</Btn><Btn variant="primary" loading={addFolder.isPending} onClick={() => addFolder.mutate()}>Create</Btn></>}>
        <TextInput autoFocus value={folderName} onChange={(e) => setFolderName(e.target.value)} placeholder="Folder name" />
      </Modal>
    </>
  );
}
