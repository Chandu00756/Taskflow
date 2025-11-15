'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { Button } from './ui/button';
import { useState } from 'react';

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const isActive = (path: string) => pathname === path;

  if (!user) {
    return null;
  }

  return (
    <nav className="bg-white dark:bg-gray-800 shadow-sm border-b">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <Link href="/dashboard" className="text-xl font-bold text-primary">
                TaskFlow
              </Link>
            </div>
            <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
              <Link
                href="/dashboard"
                className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                  isActive('/dashboard')
                    ? 'border-primary text-gray-900 dark:text-white'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                Dashboard
              </Link>
              <Link
                href="/tasks"
                className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                  isActive('/tasks')
                    ? 'border-primary text-gray-900 dark:text-white'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                Tasks
              </Link>
              <Link
                href="/profile"
                className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium ${
                  isActive('/profile')
                    ? 'border-primary text-gray-900 dark:text-white'
                    : 'border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-300'
                }`}
              >
                Profile
              </Link>
            </div>
          </div>
          <div className="hidden sm:ml-6 sm:flex sm:items-center space-x-4">
            <div className="text-sm text-gray-700 dark:text-gray-300">
              Welcome, <span className="font-medium">{user.username}</span>
            </div>
            <Button variant="outline" size="sm" onClick={handleLogout}>
              Logout
            </Button>
          </div>
          <div className="flex items-center sm:hidden">
            <button
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="inline-flex items-center justify-center p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-primary"
            >
              <svg
                className="h-6 w-6"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d={isMobileMenuOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'}
                />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div className="sm:hidden">
          <div className="pt-2 pb-3 space-y-1">
            <Link
              href="/dashboard"
              className={`block pl-3 pr-4 py-2 border-l-4 text-base font-medium ${
                isActive('/dashboard')
                  ? 'border-primary text-primary bg-primary/10'
                  : 'border-transparent text-gray-600 hover:bg-gray-50 hover:border-gray-300 dark:text-gray-400 dark:hover:bg-gray-700'
              }`}
            >
              Dashboard
            </Link>
            <Link
              href="/tasks"
              className={`block pl-3 pr-4 py-2 border-l-4 text-base font-medium ${
                isActive('/tasks')
                  ? 'border-primary text-primary bg-primary/10'
                  : 'border-transparent text-gray-600 hover:bg-gray-50 hover:border-gray-300 dark:text-gray-400 dark:hover:bg-gray-700'
              }`}
            >
              Tasks
            </Link>
            <Link
              href="/profile"
              className={`block pl-3 pr-4 py-2 border-l-4 text-base font-medium ${
                isActive('/profile')
                  ? 'border-primary text-primary bg-primary/10'
                  : 'border-transparent text-gray-600 hover:bg-gray-50 hover:border-gray-300 dark:text-gray-400 dark:hover:bg-gray-700'
              }`}
            >
              Profile
            </Link>
          </div>
          <div className="pt-4 pb-3 border-t border-gray-200 dark:border-gray-700">
            <div className="flex items-center px-4">
              <div>
                <div className="text-base font-medium text-gray-800 dark:text-white">
                  {user.username}
                </div>
                <div className="text-sm font-medium text-gray-500 dark:text-gray-400">
                  {user.email}
                </div>
              </div>
            </div>
            <div className="mt-3 px-2">
              <Button variant="outline" className="w-full" onClick={handleLogout}>
                Logout
              </Button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
