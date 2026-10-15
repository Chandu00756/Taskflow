'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Toaster } from 'sonner';
import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth';
import { apiClient } from '@/lib/api';
import { useTheme } from '@/lib/theme';
import { Celebrations } from '@/components/theme/celebrations';

// Global query client instance
let globalQueryClient: QueryClient | null = null;

export function getQueryClient() {
  return globalQueryClient;
}

// Restores persisted auth tokens into the API client on load.
function AuthTokenRestorer() {
  const { accessToken, refreshToken } = useAuthStore();

  useEffect(() => {
    if (accessToken) apiClient.setAccessToken(accessToken);
    if (refreshToken) apiClient.setRefreshToken(refreshToken);
  }, [accessToken, refreshToken]);

  return null;
}

function ThemedToaster() {
  const [theme] = useTheme();
  return <Toaster richColors position="top-right" theme={theme === 'dark' ? 'dark' : 'light'} />;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => {
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          staleTime: 60 * 1000, // 1 minute
          retry: 1,
        },
      },
    });
    globalQueryClient = client;
    return client;
  });

  return (
    <QueryClientProvider client={queryClient}>
      {/* Aurora background used by the glass and crimson themes. */}
      <div className="theme-backdrop" aria-hidden />
      <AuthTokenRestorer />
      {children}
      <Celebrations />
      <ThemedToaster />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
