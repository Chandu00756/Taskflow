import { AxiosError } from 'axios';
import { apiClient } from '@/lib/api/client';
import type { ApiFieldErrors, ListResponse } from './types';

const V2 = '/api/v2';

type Params = Record<string, string | number | boolean | undefined | null>;

function qs(params?: Params): string {
  if (!params) return '';
  const sp = new URLSearchParams();
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  });
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export const v2 = {
  get: <T>(path: string, params?: Params) => apiClient.get<T>(`${V2}${path}${qs(params)}`),
  post: <T>(path: string, body?: unknown) => apiClient.post<T>(`${V2}${path}`, body ?? {}),
  put: <T>(path: string, body?: unknown) => apiClient.put<T>(`${V2}${path}`, body ?? {}),
  del: <T>(path: string) => apiClient.delete<T>(`${V2}${path}`),
  list: <T>(path: string, params?: Params) => apiClient.get<ListResponse<T>>(`${V2}${path}${qs(params)}`),
  items: <T>(path: string, params?: Params) =>
    apiClient.get<{ items: T[] }>(`${V2}${path}${qs(params)}`).then((r) => r.items ?? []),
};

/** Uploads a file and returns the pending attachment id. */
export async function uploadAttachment(file: File): Promise<{ id: string; name: string; size: number }> {
  const form = new FormData();
  form.append('file', file);
  return apiClient.post(`${V2}/attachments`, form, { headers: { 'Content-Type': 'multipart/form-data' } });
}

/** Downloads a protected file through the API with the caller's token. */
export async function downloadFile(path: string, filename: string) {
  const blob = await apiClient.get<Blob>(`${V2}${path}`, { responseType: 'blob' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface ParsedApiError {
  status?: number;
  message: string;
  fields: ApiFieldErrors;
}

/** Normalizes errors from both the v1 (gRPC gateway) and v2 APIs. */
export function parseApiError(err: unknown): ParsedApiError {
  const ax = err as AxiosError<{ message?: string; errors?: ApiFieldErrors; error?: string }>;
  const data = ax?.response?.data;
  const fields = (data && typeof data === 'object' && data.errors) || {};
  let message = (data && typeof data === 'object' && (data.message || data.error)) || ax?.message || 'Something went wrong';
  if (ax?.response?.status === 422 && Object.keys(fields).length) {
    const [k, v] = Object.entries(fields)[0];
    message = `${humanize(k)} ${v}`;
  }
  if (!ax?.response && ax?.message === 'Network Error') {
    message = 'Cannot reach the server. Check your connection and try again.';
  }
  return { status: ax?.response?.status, message: String(message), fields };
}

function humanize(key: string): string {
  const k = key.replace(/^fields\./, '').replace(/_/g, ' ');
  return k.charAt(0).toUpperCase() + k.slice(1);
}
