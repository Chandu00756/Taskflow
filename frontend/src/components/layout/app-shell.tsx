"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bell, Home, ListTodo, Settings, UserRound, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/auth";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { AdvancedSearch } from "@/components/search/advanced-search";
import { useQueryClient } from "@tanstack/react-query";

interface AppShellProps {
  children: React.ReactNode;
  unreadNotifications?: number;
}

export function AppShell({ children, unreadNotifications = 0 }: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const queryClient = useQueryClient();

  const navItems = useMemo(
    () => [
      { href: "/dashboard", label: "Overview", icon: Home },
      { href: "/tasks", label: "Tasks", icon: ListTodo },
      { href: "/notifications", label: "Notifications", icon: Bell },
      { href: "/profile", label: "Profile", icon: UserRound },
      { href: "/settings", label: "Settings", icon: Settings, disabled: true },
    ],
    []
  );

  const handleLogout = () => {
    // Clear React Query cache to remove old user's data
    queryClient.clear();
    logout();
    router.push("/login");
  };

  const initials = user?.full_name
    ? user.full_name
        .split(" ")
        .map((part) => part.slice(0, 1))
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : user?.username.slice(0, 2).toUpperCase();

  return (
    <div className="relative min-h-screen overflow-hidden bg-gradient-to-br from-sky-50 via-white to-blue-50">
      {/* Animated background elements */}
      <div className="pointer-events-none absolute inset-0">
        <div className="bg-aurora absolute left-1/4 top-1/4 h-[600px] w-[600px] animate-aurora rounded-full opacity-20 blur-3xl" />
        <div className="absolute right-1/4 bottom-1/4 h-[500px] w-[500px] animate-aurora rounded-full bg-gradient-to-br from-emerald-200 to-sky-200 opacity-25 blur-3xl" />
      </div>
      
      <div className="relative mx-auto flex min-h-screen max-w-[1600px] gap-6 px-4 py-6 lg:px-10">
        <motion.aside
          layout
          transition={{ type: "spring", stiffness: 260, damping: 26 }}
          className={cn(
            "sticky top-6 z-30 hidden h-[calc(100vh-3rem)] flex-col overflow-y-auto rounded-[32px] border border-white/80 bg-white/90 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.15)] backdrop-blur-2xl md:flex scrollbar-hide",
            isSidebarCollapsed ? "w-[92px]" : "w-[280px]"
          )}
        >
          <div className="flex h-full flex-col">
            <div className="flex items-center justify-between px-6 pt-8 pb-6">
              <Link href="/dashboard" className="flex items-center gap-3">
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 via-sky-400 to-emerald-400 text-lg font-bold text-white shadow-lg">
                  TF
                </span>
                {!isSidebarCollapsed && (
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-slate-400">
                      TaskFlow
                    </p>
                    <p className="text-lg font-bold text-slate-900">
                      Command Center
                    </p>
                  </div>
                )}
              </Link>
              <button
                aria-label="Toggle sidebar"
                onClick={() => setIsSidebarCollapsed((prev) => !prev)}
                className="rounded-full bg-slate-100 p-2 text-slate-500 transition hover:text-slate-900"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.5}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d={
                      isSidebarCollapsed
                        ? "M19 12H5m7 7-7-7 7-7"
                        : "M5 12h14m-7-7 7 7-7 7"
                    }
                  />
                </svg>
              </button>
            </div>

            <nav className="flex-1 space-y-2 px-4">
              {navItems.map(({ href, label, icon: Icon, disabled }) => {
                const active = pathname.startsWith(href) && !disabled;
                return (
                  <Link
                    key={href}
                    href={disabled ? "#" : href}
                    aria-disabled={disabled}
                    className={cn(
                      "group flex cursor-pointer items-center gap-3 rounded-2xl px-4 py-3.5 text-sm font-semibold transition-all",
                      disabled && "pointer-events-none opacity-40",
                      active
                        ? "bg-gradient-to-r from-blue-500 via-sky-500 to-emerald-400 text-white shadow-lg shadow-blue-500/30"
                        : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    )}
                  >
                    <span
                      className={cn(
                        "relative flex h-9 w-9 items-center justify-center rounded-xl transition-all",
                        active
                          ? "bg-white/20 text-white shadow-sm"
                          : "bg-slate-100 text-slate-600 group-hover:bg-white"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {href === "/notifications" && unreadNotifications > 0 && (
                        <Badge
                          variant="destructive"
                          className="absolute -right-1 -top-1 h-5 min-w-[20px] animate-pulse rounded-full border-2 border-white text-[10px] font-bold shadow-lg"
                        >
                          {unreadNotifications}
                        </Badge>
                      )}
                    </span>
                    {!isSidebarCollapsed && <span>{label}</span>}
                  </Link>
                );
              })}
            </nav>

            <div className="px-6 pb-6">
              <div className="rounded-3xl bg-gradient-to-br from-blue-50 to-emerald-50 p-5 shadow-inner">
                <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-sky-600">
                  Productivity tip
                </p>
                <p className="mt-2 text-sm leading-relaxed text-slate-600">
                  Break tasks into subtasks and celebrate micro wins to keep momentum.
                </p>
              </div>

              {user && (
                <div className="mt-5 flex items-center gap-3 rounded-2xl border border-slate-100 bg-gradient-to-r from-slate-50 to-white p-4 shadow-sm">
                  <Avatar className="h-11 w-11 border-2 border-white shadow-md">
                    <AvatarFallback className="bg-gradient-to-br from-blue-500 to-emerald-400 text-sm font-bold text-white">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  {!isSidebarCollapsed && (
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="truncate text-sm font-bold text-slate-900">
                        {user.full_name || user.username}
                      </p>
                      <p className="truncate text-xs text-slate-500">{user.email}</p>
                      <button
                        onClick={handleLogout}
                        className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-sky-500 transition hover:text-sky-600 hover:underline"
                      >
                        <LogOut className="h-3.5 w-3.5" /> Sign out
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </motion.aside>

        <div className="flex w-full flex-1 flex-col gap-6">
          <header className="sticky top-6 z-20 flex flex-col gap-4 rounded-[32px] border border-white/80 bg-white/90 p-6 shadow-[0_20px_60px_-15px_rgba(0,0,0,0.15)] backdrop-blur-2xl">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h1 className="text-2xl font-semibold text-slate-900">
                  Hi {user?.full_name?.split(" ")[0] || user?.username},
                </h1>
                <p className="text-sm text-slate-500">
                  Here is a quick overview of what is happening across your workspace.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <AdvancedSearch
                  onResultSelect={(result) => {
                    // Navigate based on result type
                    if (result.type === 'task') {
                      router.push(`/tasks?id=${result.id}`);
                    } else if (result.type === 'user') {
                      router.push(`/profile/${result.id}`);
                    }
                  }}
                  className="hidden sm:block sm:w-96"
                />
                
                <Button
                  variant="ghost"
                  className="relative h-11 w-11 cursor-pointer rounded-2xl border border-white/60 bg-white/80 shadow-sm hover:shadow"
                  onClick={() => router.push("/notifications")}
                >
                  <Bell className="h-5 w-5 text-slate-500" />
                  <AnimatePresence>
                    {unreadNotifications > 0 && (
                      <motion.span
                        initial={{ scale: 0, opacity: 0 }}
                        animate={{ scale: 1, opacity: 1 }}
                        exit={{ scale: 0, opacity: 0 }}
                        className="absolute -top-1 -right-1 flex h-5 min-w-[22px] items-center justify-center rounded-full bg-gradient-to-r from-blue-500 to-emerald-400 text-[10px] font-semibold text-white"
                      >
                        {unreadNotifications}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </Button>
              </div>
            </div>
            <div className="sm:hidden">
              <AdvancedSearch
                onResultSelect={(result) => {
                  if (result.type === 'task') {
                    router.push(`/tasks?id=${result.id}`);
                  } else if (result.type === 'user') {
                    router.push(`/profile/${result.id}`);
                  }
                }}
              />
            </div>
          </header>

          <main className="flex-1 pb-6">
            <div className="flex flex-1 flex-col gap-6">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
