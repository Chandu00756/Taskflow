'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User } from '@/lib/api/types';
import { getRoleFromToken } from '@/lib/jwt';

interface AuthState {
  user: User | null;
  accessToken: string | null;
  refreshToken: string | null;
  actualRole: string | null; // role claim from the JWT (super_admin, org_admin, agent, member…)
  isAuthenticated: boolean;
  isSuperAdmin: boolean;
  setAuth: (user: User, accessToken: string, refreshToken: string) => void;
  setTokens: (accessToken: string, refreshToken?: string) => void;
  clearAuth: () => void;
  logout: () => void;
}

const signedOut = {
  user: null,
  accessToken: null,
  refreshToken: null,
  actualRole: null,
  isSuperAdmin: false,
  isAuthenticated: false,
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      ...signedOut,
      setAuth: (user, accessToken, refreshToken) => {
        const actualRole = getRoleFromToken(accessToken);
        set({
          user,
          accessToken,
          refreshToken,
          actualRole,
          isSuperAdmin: actualRole === 'super_admin',
          isAuthenticated: true,
        });
      },
      setTokens: (accessToken, refreshToken) =>
        set((state) => {
          const actualRole = getRoleFromToken(accessToken) ?? state.actualRole;
          return {
            accessToken,
            refreshToken: refreshToken ?? state.refreshToken,
            actualRole,
            isSuperAdmin: actualRole === 'super_admin',
            isAuthenticated: true,
            user: state.user ? { ...state.user, role: actualRole ?? state.user.role } : state.user,
          };
        }),
      clearAuth: () => set(signedOut),
      logout: () => set(signedOut),
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
