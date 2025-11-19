'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { Toaster } from 'sonner';
import { ThemeProvider } from 'next-themes';
import { useState, useEffect } from 'react';
import { useAuthStore } from '@/store/auth';
import { apiClient } from '@/lib/api';

// Global query client instance
let globalQueryClient: QueryClient | null = null;

export function getQueryClient() {
  return globalQueryClient;
}

// Component to restore auth tokens on app load
function AuthTokenRestorer() {
  const { accessToken, refreshToken, isAuthenticated } = useAuthStore();
  
  useEffect(() => {
    console.log('🔐 AuthTokenRestorer - checking tokens...', { 
      hasAccessToken: !!accessToken, 
      hasRefreshToken: !!refreshToken,
      isAuthenticated 
    });
    
    // Restore tokens to API client on mount if they exist in store
    if (accessToken) {
      apiClient.setAccessToken(accessToken);
      console.log('🔐 Restored access token to API client');
    }
    if (refreshToken) {
      apiClient.setRefreshToken(refreshToken);
      console.log('🔐 Restored refresh token to API client');
    }
  }, [accessToken, refreshToken, isAuthenticated]); // Re-run when tokens change
  
  return null;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () => {
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
    }
  );

  // Force remove dark class on mount
  useEffect(() => {
    document.documentElement.classList.remove('dark');
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('theme', 'light');
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} forcedTheme="light">
        <AuthTokenRestorer />
        {children}
        <Toaster richColors position="top-right" />
      </ThemeProvider>
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  );
}
