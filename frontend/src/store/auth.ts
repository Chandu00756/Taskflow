'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User } from '@/lib/api/types';
import { getRoleFromToken } from '@/lib/jwt';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  actualRole: string | null; // The REAL role from JWT (not proto enum)
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  clearAuth: () => void;
  logout: () => void;
  isAuthenticated: boolean;
  isSuperAdmin: boolean; // Helper to check super admin status
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      actualRole: null,
      isAuthenticated: false,
      isSuperAdmin: false,
      setAuth: (user, accessToken, refreshToken) => {
        // Extract the REAL role from JWT token (not the proto enum from API response)
        const actualRole = getRoleFromToken(accessToken);
        const isSuperAdmin = actualRole === 'super_admin';
        
        console.log('setAuth called:', { 
          email: user?.email, 
          apiRole: user?.role,      // This is the proto enum (e.g., "USER_ROLE_MEMBER")
          jwtRole: actualRole,       // This is the real role (e.g., "super_admin")
          isSuperAdmin 
        });
        
        set({
          user,
          accessToken,
          refreshToken,
          actualRole,
          isSuperAdmin,
          isAuthenticated: true,
        });
      },
      clearAuth: () =>
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          actualRole: null,
          isSuperAdmin: false,
          isAuthenticated: false,
        }),
      logout: () =>
        set({
          user: null,
          accessToken: null,
          refreshToken: null,
          actualRole: null,
          isSuperAdmin: false,
          isAuthenticated: false,
        }),
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({
        user: state.user,
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        actualRole: state.actualRole,
        isSuperAdmin: state.isSuperAdmin,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);
