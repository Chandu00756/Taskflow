import axios, { AxiosInstance, AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import { API_CONFIG } from './config';
import { useAuthStore } from '@/store/auth';

type RetriableConfig = InternalAxiosRequestConfig & { _retry?: boolean };

// Endpoints that must never trigger a token refresh loop.
const AUTH_PATHS = ['/api/v1/auth/login', '/api/v1/auth/register', '/api/v2/auth/'];

class APIClient {
  private client: AxiosInstance;
  private refreshing: Promise<string | null> | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_CONFIG.BASE_URL,
      timeout: API_CONFIG.TIMEOUT,
      headers: { 'Content-Type': 'application/json' },
    });
    this.setupInterceptors();
  }

  private setupInterceptors() {
    this.client.interceptors.request.use((config) => {
      const token = this.getAccessToken();
      if (token && config.headers && !config.headers.Authorization) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const original = error.config as RetriableConfig | undefined;
        const url = original?.url ?? '';
        const isAuthCall = AUTH_PATHS.some((p) => url.includes(p));
        if (error.response?.status === 401 && original && !original._retry && !isAuthCall) {
          original._retry = true;
          const token = await this.refreshAccessToken();
          if (token) {
            original.headers.Authorization = `Bearer ${token}`;
            return this.client(original);
          }
          this.handleSessionExpired();
        }
        return Promise.reject(error);
      }
    );
  }

  /** Rotates tokens once even when many requests fail concurrently. */
  private refreshAccessToken(): Promise<string | null> {
    if (this.refreshing) return this.refreshing;
    const refreshToken = this.getRefreshToken();
    if (!refreshToken) return Promise.resolve(null);
    this.refreshing = axios
      .post(`${API_CONFIG.BASE_URL}/api/v2/auth/refresh`, { refresh_token: refreshToken }, { timeout: API_CONFIG.TIMEOUT })
      .then((res) => {
        const { access_token, refresh_token } = res.data ?? {};
        if (!access_token) return null;
        this.setTokens(access_token, refresh_token);
        return access_token as string;
      })
      .catch(() => null)
      .finally(() => {
        this.refreshing = null;
      });
    return this.refreshing;
  }

  private handleSessionExpired() {
    this.clearTokens();
    try {
      useAuthStore.getState().logout();
    } catch {
      // store unavailable during SSR
    }
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      window.location.href = `/login?expired=1&next=${next}`;
    }
  }

  // ---------------------------------------------------------------------------
  // Token management (the zustand auth store is the source of truth)
  // ---------------------------------------------------------------------------

  setTokens(access: string, refresh?: string) {
    try {
      useAuthStore.getState().setTokens(access, refresh);
    } catch {
      // ignore outside the browser
    }
  }

  setAccessToken(token: string) {
    this.setTokens(token);
  }

  setRefreshToken(token: string) {
    try {
      const state = useAuthStore.getState();
      if (state.accessToken) state.setTokens(state.accessToken, token);
    } catch {
      // ignore
    }
  }

  getAccessToken(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return useAuthStore.getState().accessToken;
    } catch {
      return null;
    }
  }

  getRefreshToken(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return useAuthStore.getState().refreshToken;
    } catch {
      return null;
    }
  }

  clearTokens() {
    if (typeof window !== 'undefined') {
      // Legacy keys from earlier releases.
      localStorage.removeItem('access_token');
      localStorage.removeItem('refresh_token');
    }
  }

  // ---------------------------------------------------------------------------
  // HTTP helpers returning the response body
  // ---------------------------------------------------------------------------

  async get<T>(url: string, config: AxiosRequestConfig = {}) {
    const response = await this.client.get<T>(url, config);
    return response.data;
  }

  async post<T>(url: string, data?: unknown, config: AxiosRequestConfig = {}) {
    const response = await this.client.post<T>(url, data, config);
    return response.data;
  }

  async put<T>(url: string, data?: unknown, config: AxiosRequestConfig = {}) {
    const response = await this.client.put<T>(url, data, config);
    return response.data;
  }

  async patch<T>(url: string, data?: unknown, config: AxiosRequestConfig = {}) {
    const response = await this.client.patch<T>(url, data, config);
    return response.data;
  }

  async delete<T>(url: string, config: AxiosRequestConfig = {}) {
    const response = await this.client.delete<T>(url, config);
    return response.data;
  }
}

export const apiClient = new APIClient();
