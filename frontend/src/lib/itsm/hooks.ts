'use client';

import * as React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { v2 } from './api';
import { CHANGE_TYPES, labelize } from './format';
import type {
  AgentGroup, AssetType, BusinessHours, Department, Location, Me, Person, Role, Privilege, Vendor, Product, FormField, JobRole,
} from './types';

export function useMe() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isSuperAdmin = useAuthStore((s) => s.isSuperAdmin);
  return useQuery({
    queryKey: ['me'],
    queryFn: () => v2.get<Me>('/me'),
    enabled: isAuthenticated && !isSuperAdmin,
    staleTime: 60_000,
    retry: (count, err: unknown) => {
      const status = (err as { response?: { status?: number } })?.response?.status;
      return status !== 401 && status !== 403 && count < 2;
    },
  });
}

/** Returns a permission checker for the current user. */
export function useCan() {
  const { data } = useMe();
  return (privilege: string) => Boolean(data?.is_account_admin || data?.privileges?.includes(privilege));
}

const LOOKUP_STALE = 5 * 60_000;

export function useAgents() {
  return useQuery({
    queryKey: ['lookup', 'agents'],
    queryFn: () => v2.list<Person>('/agents', { per_page: 100 }).then((r) => r.items),
    staleTime: LOOKUP_STALE,
  });
}

export function useGroups() {
  return useQuery({ queryKey: ['lookup', 'groups'], queryFn: () => v2.items<AgentGroup>('/groups'), staleTime: LOOKUP_STALE });
}

export function useDepartments() {
  return useQuery({ queryKey: ['lookup', 'departments'], queryFn: () => v2.items<Department>('/departments'), staleTime: LOOKUP_STALE });
}

export function useLocations() {
  return useQuery({ queryKey: ['lookup', 'locations'], queryFn: () => v2.items<Location>('/locations'), staleTime: LOOKUP_STALE });
}

export function useRoles() {
  return useQuery({
    queryKey: ['lookup', 'roles'],
    queryFn: () => v2.get<{ items: Role[]; privileges: Privilege[] }>('/roles'),
    staleTime: LOOKUP_STALE,
  });
}

export function useAssetTypes() {
  return useQuery({ queryKey: ['lookup', 'asset-types'], queryFn: () => v2.items<AssetType>('/asset-types'), staleTime: LOOKUP_STALE });
}

export function useBusinessHours() {
  return useQuery({ queryKey: ['lookup', 'business-hours'], queryFn: () => v2.items<BusinessHours>('/business-hours'), staleTime: LOOKUP_STALE });
}

export function useVendors() {
  return useQuery({ queryKey: ['lookup', 'vendors'], queryFn: () => v2.items<Vendor>('/vendors'), staleTime: LOOKUP_STALE });
}

export function useProducts() {
  return useQuery({ queryKey: ['lookup', 'products'], queryFn: () => v2.items<Product>('/products'), staleTime: LOOKUP_STALE });
}

/** Job roles (designations) ordered from most senior. */
export function useJobRoles() {
  return useQuery({ queryKey: ['lookup', 'job-roles'], queryFn: () => v2.items<JobRole>('/job-roles'), staleTime: LOOKUP_STALE });
}

/** Job role options labelled with their level, e.g. "L4 · Vice President". */
export function useJobRoleOptions() {
  const roles = useJobRoles();
  return React.useMemo(() => (roles.data ?? []).map((r) => ({ value: r.id, label: `L${r.level} · ${r.name}` })), [roles.data]);
}

export function useFormFields(entity: 'ticket' | 'problem' | 'change' | 'release' | 'asset' | 'requester') {
  return useQuery({ queryKey: ['lookup', 'form-fields', entity], queryFn: () => v2.items<FormField>('/form-fields', { entity }), staleTime: LOOKUP_STALE });
}

export function useTicketFields() {
  return useFormFields('ticket');
}

/** Change types configured in Admin → Categories (built-in ones while loading). */
export function useChangeTypes() {
  const fields = useFormFields('change');
  return React.useMemo(() => {
    const list = fields.data?.find((f) => f.name === 'change_type')?.choices;
    const types = list?.length ? list : CHANGE_TYPES.map((t) => ({ value: t.value, label: t.label, requires_approval: t.value === 'major' || t.value === 'emergency' }));
    return {
      options: types.map((t) => ({ value: t.value, label: t.label || t.value })),
      label: (v: string) => types.find((t) => t.value === v)?.label || labelize(v),
      types,
    };
  }, [fields.data]);
}

/** Options of a flat admin-managed list on a form, e.g. business impact. */
export function useChoiceOptions(entity: 'ticket' | 'problem' | 'change', name: string) {
  const fields = useFormFields(entity);
  return React.useMemo(
    () => (fields.data?.find((f) => f.name === name && f.active)?.choices ?? []).map((c) => ({ value: c.value, label: c.label || c.value })),
    [fields.data, name]
  );
}

/** Invalidates every lookup cache (after admin changes). */
export function useInvalidateLookups() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['lookup'] });
}
