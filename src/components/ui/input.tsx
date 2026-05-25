import * as React from "react";

import { cn } from "@/lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, size = 1, ...props }, ref) => {
    return (
      <input
        type={type}
        size={size}
        className={cn(
          "flex h-11 min-h-[44px] w-full rounded-md border border-input bg-background px-3 py-2.5 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 sm:h-10 sm:min-h-[40px] sm:py-2 sm:text-sm touch-target",
          className,
        )}
        ref={ref}
        {...props}
      />
    );
  },
);
Input.displayName = "Input";

export { Input };
