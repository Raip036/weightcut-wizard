import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/* Design System v1 — Button palette (Figma BUTTONS section, node 67:655).
 *  - default   = Primary    | Spirit Blue solid, distinct hover/pressed shades
 *  - secondary = Secondary  | Void surface with solid 1px neutral-100 border
 *  - outline   = Tertiary   | Void surface with 0.5px translucent border
 *  - cta       = Gradient CTA | 4-stop brand gradient (blue → lilac → pink → orange)
 *  - destructive            | Danger Red
 *  - ghost                  | transparent with neutral hover
 *  - link                   | inline Spirit Blue
 *
 *  All variants render text at neutral-200 (#DEDEF7) per the Figma spec.
 *  Mobile touch-target sizes (h-11 = 44px) are preserved over Figma's
 *  visual 34px since 44px is Apple's recommended minimum for tap.
 *  Disabled opacity dropped from 0.5 → 0.4 to match Figma's disabled state. */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xs text-sm ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 touch-target touch-action-manipulation",
  {
    variants: {
      variant: {
        default:
          "bg-brand-spirit-blue text-neutral-200 font-semibold hover:bg-[#5078F5] active:bg-[#2A4ACC]",
        destructive:
          "bg-func-danger-red text-white font-semibold hover:bg-func-danger-red/90 active:bg-func-danger-red/80",
        outline:
          "bg-brand-void text-neutral-200 font-light border-[0.5px] border-[rgba(226,229,242,0.5)] hover:border-neutral-100 hover:bg-neutral-900",
        secondary:
          "bg-brand-void text-neutral-200 font-normal border border-neutral-100 hover:bg-neutral-900 active:bg-neutral-1000",
        ghost:
          "text-neutral-200 font-medium hover:bg-neutral-800 active:bg-neutral-900",
        link:
          "text-brand-spirit-blue font-medium underline-offset-4 hover:underline active:text-brand-spirit-blue/80",
        cta:
          "bg-gradient-cta text-neutral-200 font-semibold shadow-[0_4px_16px_-2px_rgba(139,126,234,0.35)] hover:brightness-110 active:brightness-95",
      },
      size: {
        default: "h-11 min-h-[44px] px-4 py-2.5 sm:h-10 sm:min-h-[40px] sm:py-2",
        sm: "h-10 min-h-[44px] rounded-xs px-3 py-2 sm:h-9 sm:min-h-[36px]",
        lg: "h-12 min-h-[44px] rounded-xs px-6 py-3 sm:h-11 sm:px-8",
        icon: "h-11 w-11 min-h-[44px] min-w-[44px] sm:h-10 sm:w-10 sm:min-h-[40px] sm:min-w-[40px]",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
