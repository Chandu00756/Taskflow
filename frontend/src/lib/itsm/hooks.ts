'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/auth';
import { v2 } from './api';
import type {
  AgentGroup, AssetType, BusinessHours, Department, Location, Me, Person, Role, Privilege, Vendor, Product, FormField,
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

export function useTicketFields() {
  return useQuery({ queryKey: ['lookup', 'form-fields', 'ticket'], queryFn: () => v2.items<FormField>('/form-fields', { entity: 'ticket' }), staleTime: LOOKUP_STALE });
}

/** Invalidates every lookup cache (after admin changes). */
export function useInvalidateLookups() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['lookup'] });
}
