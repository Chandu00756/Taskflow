import * as React from "react";
import Image, { type ImageProps } from "next/image";

import { cn } from "@/lib/utils";

const Avatar = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "relative flex h-11 w-11 shrink-0 overflow-hidden rounded-full border border-slate-200 bg-gradient-to-br from-slate-100 via-white to-slate-200 text-slate-600",
        className
      )}
      {...props}
    />
  )
);
Avatar.displayName = "Avatar";

type AvatarImageProps = ImageProps & { alt?: string };

const AvatarImage = React.forwardRef<HTMLImageElement, AvatarImageProps>(
  ({ className, alt, width, height, sizes, ...props }, ref) => (
    <Image
      ref={ref}
      alt={alt ?? ""}
      className={cn("h-full w-full object-cover", className)}
      width={width ?? 44}
      height={height ?? 44}
      sizes={sizes ?? "44px"}
      {...props}
    />
  )
);
AvatarImage.displayName = "AvatarImage";

const AvatarFallback = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, children, ...props }, ref) => (
  <span
    ref={ref}
    className={cn(
      "flex h-full w-full items-center justify-center bg-slate-200 text-sm font-semibold text-slate-600",
      className
    )}
    {...props}
  >
    {children}
  </span>
));
AvatarFallback.displayName = "AvatarFallback";

export { Avatar, AvatarImage, AvatarFallback };
