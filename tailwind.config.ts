import type { Config } from "tailwindcss";

export default {
  future: {
    hoverOnlyWhenSupported: true,
  },
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  safelist: [
    { pattern: /^ff-ring-ribbon-[1-4]$/ },
    { pattern: /^ff-ring-particle-(lg|sm|md)$/ },
    { pattern: /^ff-ring-wisp-[0-4]$/ },
  ],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: {
        DEFAULT: "1rem",
        sm: "1.5rem",
        md: "2rem",
        lg: "2.5rem",
        xl: "3rem",
      },
      screens: {
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1280px",
        "2xl": "1400px",
      },
    },
    screens: {
      xs: "475px",
      sm: "640px",
      md: "768px",
      lg: "1024px",
      xl: "1280px",
      "2xl": "1400px",
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          foreground: "hsl(var(--success-foreground))",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          foreground: "hsl(var(--warning-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        chart: {
          "1": "hsl(var(--chart-1))",
          "2": "hsl(var(--chart-2))",
          "3": "hsl(var(--chart-3))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
        energy: "hsl(var(--energy))",
        health: "hsl(var(--health))",
        hydration: "hsl(var(--hydration))",
        recovery: "hsl(var(--recovery))",

        /* Design System v1 — Brand palette (Figma "Branding" file).
           CSS vars store space-separated RGB triplets; wrapping in
           `rgb(var(--x) / <alpha-value>)` lets Tailwind's `/N` opacity
           modifier work (e.g. `bg-brand-spirit-blue/20`). */
        brand: {
          "spirit-blue":  "rgb(var(--brand-spirit-blue) / <alpha-value>)",
          "wizard-lilac": "rgb(var(--brand-wizard-lilac) / <alpha-value>)",
          "dream-cyan":   "rgb(var(--brand-dream-cyan) / <alpha-value>)",
          "night-indigo": "rgb(var(--brand-night-indigo) / <alpha-value>)",
          void:           "rgb(var(--brand-void) / <alpha-value>)",
        },
        /* Design System v1 — Functional palette (status, macros). */
        func: {
          "danger-red":     "rgb(var(--func-danger-red) / <alpha-value>)",
          "warning-yellow": "rgb(var(--func-warning-yellow) / <alpha-value>)",
          "recovery-green": "rgb(var(--func-recovery-green) / <alpha-value>)",
          "carbs-orange":   "rgb(var(--func-carbs-orange) / <alpha-value>)",
          "fats-purple":    "rgb(var(--func-fats-purple) / <alpha-value>)",
          "protein-blue":   "rgb(var(--func-protein-blue) / <alpha-value>)",
          "hydration-cyan": "rgb(var(--func-hydration-cyan) / <alpha-value>)",
        },
        /* Design System v1 — Neutral scale. */
        neutral: {
          100:  "rgb(var(--neutral-100) / <alpha-value>)",
          200:  "rgb(var(--neutral-200) / <alpha-value>)",
          400:  "rgb(var(--neutral-400) / <alpha-value>)",
          500:  "rgb(var(--neutral-500) / <alpha-value>)",
          700:  "rgb(var(--neutral-700) / <alpha-value>)",
          800:  "rgb(var(--neutral-800) / <alpha-value>)",
          900:  "rgb(var(--neutral-900) / <alpha-value>)",
          1000: "rgb(var(--neutral-1000) / <alpha-value>)",
        },
      },
      fontFamily: {
        /* Body / UI default — Inter (Design System v1). Satoshi is no longer
           in the fallback chain so all body text renders as Inter. The
           three share-card components that still hardcode
           fontFamily="Satoshi..." inline keep working because their
           @font-face is loaded in index.css. */
        sans: ["Inter", "SF Pro Text", "-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif"],
        /* Display — Sora. Use via `font-display` for Display 1/2 + Heading 1/2. */
        display: ["Sora", "SF Pro Display", "-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif"],
      },
      /* Design System v1 — Type scale (Figma).
         Use as `text-display-1`, `text-heading-1`, `text-body`, etc.
         Each value is [size, { lineHeight }]. */
      fontSize: {
        "display-1":  ["40px", { lineHeight: "48px", letterSpacing: "-0.02em" }],
        "display-2":  ["32px", { lineHeight: "40px", letterSpacing: "-0.02em" }],
        "heading-1":  ["24px", { lineHeight: "32px", letterSpacing: "-0.01em" }],
        "heading-2":  ["20px", { lineHeight: "28px", letterSpacing: "-0.01em" }],
        "subheading": ["16px", { lineHeight: "24px" }],
        "body":       ["16px", { lineHeight: "24px" }],
        "caption":    ["12px", { lineHeight: "16px" }],
        "overline":   ["10px", { lineHeight: "14px", letterSpacing: "0.08em" }],
        /* ── App UI scale (5-step) ─────────────────────────────────────
           Fills the gaps in the design system for compact mobile UI:
           micro → note → body-sm → value → title                      */
        "micro":    ["11px", { lineHeight: "16px", letterSpacing: "0.03em" }],
        "note":     ["13px", { lineHeight: "20px" }],
        "body-sm":  ["15px", { lineHeight: "22px" }],
        "value":    ["18px", { lineHeight: "24px", letterSpacing: "-0.01em" }],
        "title":    ["22px", { lineHeight: "28px", letterSpacing: "-0.01em" }],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        /* Design System v1 — radius scale */
        xs: "var(--radius-xs)",   /*  8px */
        s:  "var(--radius-s)",    /* 12px */
        m:  "var(--radius-m)",    /* 16px */
        l:  "var(--radius-l)",    /* 20px */
        xl: "var(--radius-xl)",   /* 24px */
        pill: "var(--radius-full)", /* 999px */
      },
      /* Design System v1 — Brand + functional palette, exposed as Tailwind
         color shortcuts so components can use `bg-brand-spirit-blue`,
         `text-func-recovery-green`, `border-neutral-700`, etc. without
         reaching for arbitrary values. */
      backgroundImage: {
        "gradient-aurora": "var(--gradient-aurora)",
        "gradient-cosmic": "var(--gradient-cosmic)",
        "gradient-mystic": "var(--gradient-mystic)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        /* Crystal-glass progress bar shimmer — sweeps a translucent
           highlight across the filled portion. Used by
           src/components/ui/progress.tsx. */
        "progress-shimmer": {
          "0%":   { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(200%)" },
        },
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
        "msg-bounce-in": {
          "0%": { opacity: "0", transform: "scale(0.85) translateY(8px)" },
          "50%": { opacity: "1", transform: "scale(1.02) translateY(-2px)" },
          "70%": { transform: "scale(0.98) translateY(1px)" },
          "100%": { opacity: "1", transform: "scale(1) translateY(0)" },
        },
        typing: {
          "0%, 60%, 100%": { opacity: "0.35", transform: "translateY(0)" },
          "30%": { opacity: "1", transform: "translateY(-3px)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        marquee: "marquee 12s linear infinite",
        "msg-bounce-in": "msg-bounce-in 0.35s cubic-bezier(0.34, 1.56, 0.64, 1) both",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
