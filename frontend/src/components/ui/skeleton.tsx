import { cn } from "@/lib/utils";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn("animate-pulse rounded-2xl bg-gradient-to-r from-slate-200 via-slate-100 to-slate-200", className)}
      {...props}
    />
  );
}
