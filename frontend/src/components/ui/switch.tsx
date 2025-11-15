import * as React from "react";

import { cn } from "@/lib/utils";

export interface SwitchProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  checked?: boolean;
}

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(
  ({ checked = false, className, onClick, ...props }, ref) => {
    return (
      <button
        type="button"
  role="switch"
  aria-checked={checked ? 'true' : 'false'}
        ref={ref}
        onClick={onClick}
        className={cn(
          "relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border border-slate-200 bg-white/80 p-0.5 transition focus:outline-none focus:ring-2 focus:ring-sky-200",
          checked && "border-sky-300 bg-gradient-to-r from-sky-400 to-emerald-400",
          className
        )}
        {...props}
      >
        <span
          className={cn(
            "inline-block h-5 w-5 transform rounded-full bg-white shadow transition",
            checked ? "translate-x-5" : "translate-x-0"
          )}
        />
      </button>
    );
  }
);

Switch.displayName = "Switch";
