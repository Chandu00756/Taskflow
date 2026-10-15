'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AssetNav, assetPayload, inheritedFields, useAssetFields } from '@/components/desk/assets';
import { SchemaForm, FieldSpec } from '@/components/desk/crud';
import { Btn, Card, LoadingBlock, PageHeader } from '@/components/desk/kit';
import { v2, parseApiError } from '@/lib/itsm/api';
import { useAssetTypes } from '@/lib/itsm/hooks';
import type { Asset } from '@/lib/itsm/types';

export default function NewAssetPage() {
  const router = useRouter();
  const types = useAssetTypes();
  const { main, assignment, procurement } = useAssetFields(types.data ?? []);
  const [values, setValues] = React.useState<Record<string, unknown>>({ state: 'in_stock', impact: 'low', usage_type: 'permanent', tags: [] });
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const typeFields = inheritedFields(types.data ?? [], String(values.asset_type_id ?? ''));
  const specFields: FieldSpec[] = typeFields.map((f) => ({
    name: `tf_${f.name}`,
    label: f.label,
    type: f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : f.type === 'dropdown' ? 'select' : f.type === 'checkbox' ? 'checkbox' : f.type === 'paragraph' ? 'textarea' : 'text',
    options: (f.choices ?? []).map((c) => ({ value: c, label: c })),
    span: 1,
  }));
  const create = useMutation({
    mutationFn: () => v2.post<Asset>('/assets', assetPayload(values, typeFields.map((f) => f.name))),
    onSuccess: (a) => {
      toast.success(`${a.name} created`);
      router.push(`/assets/${a.id}`);
    },
    onError: (e) => {
      const err = parseApiError(e);
      setErrors(err.fields);
      toast.error(err.message);
    },
  });
  if (types.isLoading) return <LoadingBlock />;
  return (
    <>
      <PageHeader title="New asset" breadcrumbs={[{ label: 'Assets', href: '/assets' }, { label: 'New' }]} />
      <AssetNav />
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <Card title="General">
          <SchemaForm fields={main} values={values} onChange={setValues} errors={errors} />
        </Card>
        {specFields.length > 0 && (
          <Card title="Specifications">
            <SchemaForm fields={specFields} values={values} onChange={setValues} errors={errors} />
          </Card>
        )}
        <Card title="Assignment">
          <SchemaForm fields={assignment} values={values} onChange={setValues} errors={errors} />
        </Card>
        <Card title="Procurement">
          <SchemaForm fields={procurement} values={values} onChange={setValues} errors={errors} />
        </Card>
        <div className="flex justify-end gap-2">
          <Btn onClick={() => router.back()}>Cancel</Btn>
          <Btn type="submit" variant="primary" loading={create.isPending}>
            Create asset
          </Btn>
        </div>
      </form>
    </>
  );
}
