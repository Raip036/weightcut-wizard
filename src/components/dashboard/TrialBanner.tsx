// TrialBanner — Dashboard trial-status banner (Path B: auto-renew aware).
//
// Premium blue wizard-aurora style (see reference_aurora_wizard_loader). Renders
// null unless the user is in a state worth surfacing, so it can sit high on the
// Dashboard without cluttering when idle. All states open the native RevenueCat
// paywall via openPaywall().
//
// States (derived from RC display-only signals + the server profile):
//   renewing  — trial active, auto-renew ON, on monthly → transparency + annual upsell
//   wontRenew — trial active, auto-renew OFF (cancelled) → the real "save" moment
//   lapsed    — lapsed to free (server-armed pro_ended_pending_at) → win-back
//
// Disappear logic: an upgrade flips tier → renewing/wontRenew stop matching and
// it unmounts. renewing + lapsed are dismissible-for-session; wontRenew is
// sticky. Hidden entirely for annual auto-renewers and never-subscribed users.
import { useState } from "react";
import { motion } from "motion/react";
import { X } from "lucide-react";
import { WizardAuroraBackground } from "@/components/onboarding/WizardAuroraBackground";
import { useSubscription } from "@/hooks/useSubscription";
import { useProfile } from "@/contexts/UserContext";
import wizard from "@/assets/wizard_3D.png";

const BLUE = "217 91% 58%";
const hsl = (a = 1) => `hsl(${BLUE} / ${a})`;
const CTA_CLASS = "bg-primary text-primary-foreground shadow-[0_0_16px_hsl(217_91%_58%/0.5)]";

type Variant = "renewing" | "wontRenew" | "lapsed";

function formatDate(d: Date | null): string {
  if (!d) return "soon";
  try {
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  } catch {
    return "soon";
  }
}

function daysLeftFrom(d: Date | null): number {
  if (!d) return 0;
  return Math.max(0, Math.ceil((d.getTime() - Date.now()) / 86_400_000));
}

export function TrialBanner() {
  const {
    isPremium,
    rawTier,
    isTrialActive,
    willRenew,
    isSubscriptionResolved,
    expiresAt,
    trialEndsAt,
    openPaywall,
  } = useSubscription();
  const { profile } = useProfile();

  const [dismissed, setDismissed] = useState<Record<string, boolean>>(() => {
    try {
      return {
        renewing: sessionStorage.getItem("wcw_trialbanner_dismissed_renewing") === "1",
        lapsed: sessionStorage.getItem("wcw_trialbanner_dismissed_lapsed") === "1",
      };
    } catch {
      return {};
    }
  });

  if (!isSubscriptionResolved) return null;

  // Derive the state. Order matters: trial states first, then lapse.
  let variant: Variant | null = null;
  if (isPremium && isTrialActive) {
    if (willRenew === false) variant = "wontRenew";
    else if (rawTier === "premium_monthly") variant = "renewing"; // annual upsell only worth it on monthly
    // annual auto-renewing trial → nothing to nudge, stays null
  } else if (!isPremium && (profile?.pro_ended_pending_at ?? null) != null) {
    variant = "lapsed";
  }
  if (!variant) return null;

  // renewing + lapsed are dismissible-for-session; wontRenew is sticky.
  const dismissible = variant === "renewing" || variant === "lapsed";
  if (dismissible && dismissed[variant]) return null;

  const endDate = expiresAt ?? trialEndsAt ?? null;
  const days = daysLeftFrom(endDate);
  const dateStr = formatDate(endDate);

  const CFG: Record<Variant, { title: string; sub: string; cta: string; intensity: "subtle" | "full" }> = {
    renewing: {
      title: `Pro trial · ${days} ${days === 1 ? "day" : "days"} left`,
      sub: `Renews automatically on ${dateStr}`,
      cta: "Go Annual",
      intensity: "subtle",
    },
    wontRenew: {
      title: "Trial won't renew",
      sub: `Pro ends ${dateStr}. Keep your cut plan`,
      cta: "Keep Pro",
      intensity: "full",
    },
    lapsed: {
      title: "Pro trial ended",
      sub: "You're on the free tier",
      cta: "Reactivate",
      intensity: "full",
    },
  };
  const cfg = CFG[variant];

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDismissed((d) => ({ ...d, [variant!]: true }));
    try {
      sessionStorage.setItem(`wcw_trialbanner_dismissed_${variant}`, "1");
    } catch {
      /* privacy mode — ignore */
    }
  };

  return (
    <motion.button
      type="button"
      onClick={openPaywall}
      initial={{ opacity: 0, y: 16, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: "spring", damping: 22, stiffness: 280 }}
      className="relative flex w-full items-center gap-2.5 overflow-hidden rounded-2xl border border-primary/20 card-surface px-3 py-2 text-left active:scale-[0.99]"
      aria-label={`${cfg.title}. ${cfg.sub}. ${cfg.cta}.`}
    >
      <WizardAuroraBackground intensity={cfg.intensity} radialGlow />

      {/* Haloed, bobbing wizard mascot. */}
      <div className="relative z-10 grid h-9 w-9 shrink-0 place-items-center">
        <span
          aria-hidden
          className="absolute inset-0 rounded-full"
          style={{ background: `radial-gradient(circle, ${hsl(0.45)} 0%, ${hsl(0.12)} 45%, transparent 70%)` }}
        />
        <motion.img
          src={wizard}
          alt=""
          draggable={false}
          className="relative h-7 w-7 object-contain"
          style={{ filter: `drop-shadow(0 0 8px ${hsl(0.5)})` }}
          animate={{ y: [0, -3, 0] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <div className="relative z-10 min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold text-white leading-tight">{cfg.title}</p>
        <p className="text-[11.5px] text-white/60 leading-snug truncate">{cfg.sub}</p>
      </div>

      <span className={`relative z-10 shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold ${CTA_CLASS}`}>
        {cfg.cta}
      </span>

      {dismissible && (
        <span
          role="button"
          tabIndex={0}
          aria-label="Dismiss"
          onClick={handleDismiss}
          className="relative z-10 -mr-1 grid h-6 w-6 shrink-0 place-items-center rounded-full text-white/40 active:scale-90"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.4} />
        </span>
      )}
    </motion.button>
  );
}

export default TrialBanner;
