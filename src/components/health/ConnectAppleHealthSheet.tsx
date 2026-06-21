/**
 * ConnectAppleHealthSheet — full-screen explainer + permission trigger.
 *
 * Shown:
 *   1. From the onboarding wizard step (`ConnectHealthStep.tsx`).
 *   2. From the settings entry card (`HealthSettingsCard.tsx`) when the
 *      user taps Connect.
 *
 * Lists every metric we'd like to read with a one-line "why" each (spec
 * §3.2). The footer line is verbatim from the spec.
 *
 * Behaviour:
 *   - On mount, calls `healthKit.isAvailable()`. If false (e.g. web build
 *     or Android), shows a single "Only available in the iOS app" panel
 *     and disables the Connect button.
 *   - Tapping Connect fires `healthKit.requestPermissions()` for all 14
 *     metrics (HEALTH_METRICS from `@/services/healthKit`). On success
 *     calls `api.health.setHealthKitConnected` with the granted set, then
 *     fires the parent's `onConnected` callback.
 *   - Tapping Skip / close fires the parent's `onSkip` callback (the
 *     onboarding wrapper records the prompt-shown timestamp; the settings
 *     wrapper simply dismisses).
 */

import { useCallback, useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { motion } from "motion/react";
import {
  Activity,
  Footprints,
  Heart,
  HeartPulse,
  Moon,
  Scale,
  Thermometer,
  TrendingUp,
  Wind,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
// Typed wrapper around the native HealthKit plugin. Methods documented in spec §4.
import { HEALTH_METRICS, HealthKitTimeoutError, healthKit } from "@/services/healthKit";
import { forceNextHealthKitSync, runHealthKitSync } from "@/services/healthKitSync";
// Agent B's Convex API. Path is `api.health.setHealthKitConnected`.
// Typed once Agent B's codegen lands; treated as any here so this file
// compiles ahead of that without forcing a circular install order.
import { api } from "@/../convex/_generated/api";

// ─── Explainer rows (spec §3.2) ────────────────────────────────────────

interface MetricRow {
  icon: JSX.Element;
  label: string;
  why: string;
}

const METRIC_ROWS: MetricRow[] = [
  {
    icon: <HeartPulse className="h-4 w-4 text-func-danger-red" strokeWidth={2.2} />,
    label: "Heart rate variability (HRV)",
    why: "Best single signal for nervous-system recovery.",
  },
  {
    icon: <Heart className="h-4 w-4 text-func-danger-red" strokeWidth={2.2} />,
    label: "Resting heart rate",
    why: "Detects elevated baseline from poor recovery or illness.",
  },
  {
    icon: <Moon className="h-4 w-4 text-indigo-300" strokeWidth={2.2} />,
    label: "Sleep stages",
    why: "Real sleep duration & quality, not bedtime estimates.",
  },
  {
    icon: <Activity className="h-4 w-4 text-func-recovery-green" strokeWidth={2.2} />,
    label: "Active workouts",
    why: "Confirms training load vs. what you logged.",
  },
  {
    icon: <Footprints className="h-4 w-4 text-func-warning-yellow" strokeWidth={2.2} />,
    label: "Steps & active energy",
    why: "Daily activity baseline.",
  },
  {
    icon: <TrendingUp className="h-4 w-4 text-func-hydration-cyan" strokeWidth={2.2} />,
    label: "VO2 Max",
    why: "Aerobic fitness trajectory across the camp.",
  },
  {
    icon: <Thermometer className="h-4 w-4 text-func-carbs-orange" strokeWidth={2.2} />,
    label: "Wrist temperature",
    why: "Early sickness / overtraining flag.",
  },
  {
    icon: <Wind className="h-4 w-4 text-sky-300" strokeWidth={2.2} />,
    label: "Respiratory rate",
    why: "Secondary recovery signal.",
  },
  {
    icon: <Scale className="h-4 w-4 text-func-fats-purple" strokeWidth={2.2} />,
    label: "Body mass",
    why: "Reads weight from connected smart scales automatically.",
  },
];

// Verbatim from spec §3.2 footer.
const FOOTER_TEXT =
  "You can change these any time in iOS Settings → Health → Data Access → FightCamp.";

export interface ConnectAppleHealthSheetProps {
  /** Where the sheet is mounted — drives the skip button copy only. */
  context?: "onboarding" | "settings";
  /** Called after a successful permission grant + Convex write. */
  onConnected?: (grantedMetrics: string[]) => void;
  /** Called when the user dismisses without connecting. */
  onSkip?: () => void;
  className?: string;
}

export function ConnectAppleHealthSheet({
  context = "settings",
  onConnected,
  onSkip,
  className,
}: ConnectAppleHealthSheetProps): JSX.Element {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // When true, surface an "Open Apple Health" deep-link so the user can
  // grant access manually after the in-app permission sheet failed/timed out.
  const [showHealthAppFallback, setShowHealthAppFallback] = useState(false);

  const setHealthKitConnected = useMutation(api.health.setHealthKitConnected);
  const insertHealthSamples = useMutation(api.health.insertSamples);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const ok = await healthKit.isAvailable();
        if (mounted) setAvailable(ok);
      } catch (err) {
        logger.warn("healthKit.isAvailable failed", err);
        if (mounted) setAvailable(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const handleConnect = useCallback(async () => {
    if (connecting) return;
    setError(null);
    setShowHealthAppFallback(false);
    setConnecting(true);
    try {
      // Real typed API: requestPermissions resolves to a PermissionResult
      // ({ granted, perMetric }). `granted` is the overall flag; `perMetric`
      // carries the per-metric authorization status we persist.
      const { granted, perMetric } =
        await healthKit.requestPermissions(HEALTH_METRICS);
      const grantedMetrics = perMetric
        .filter((s) => s.granted)
        .map((s) => s.metric);

      if (!granted) {
        // The native sheet never presented/settled. Don't persist — point
        // the user at the Apple Health app to grant access manually.
        setError(
          "Couldn't open the Health permission sheet. You can grant access in the Apple Health app.",
        );
        setShowHealthAppFallback(true);
        return;
      }

      // Persist to Convex so the score engine and other surfaces can
      // pick up the new tier. Failure here is non-fatal for the UX —
      // the user can retry from settings.
      try {
        if (setHealthKitConnected) {
          await setHealthKitConnected({ grantedMetrics });
        }
      } catch (mutErr) {
        logger.error("setHealthKitConnected failed", mutErr);
      }

      // Kick off the first sync immediately so the user sees data within
      // seconds of granting permission. Force-bypass the 60s throttle —
      // a brand-new connect is exactly when we want the user to see
      // numbers populating the tier card, not "first sync pending."
      // Fire-and-forget — `onConnected` should not wait on the network.
      forceNextHealthKitSync();
      runHealthKitSync(insertHealthSamples, { force: true }).catch((err) => {
        logger.error("post-connect HealthKit sync failed", err);
      });

      // Register the app for background HealthKit deliveries. Best-effort:
      // if the plugin can't register (older OS, denied, no entitlement)
      // we just log and move on — the foreground sync still works.
      healthKit.enableBackgroundDelivery(HEALTH_METRICS).catch((err) => {
        logger.error("enableBackgroundDelivery failed", err);
      });

      onConnected?.(grantedMetrics);
    } catch (err) {
      if (err instanceof HealthKitTimeoutError) {
        setError(
          "Couldn't open Apple Health. The permission screen didn't respond. Open the Apple Health app to grant access, then return here.",
        );
        setShowHealthAppFallback(true);
      } else {
        logger.error("HealthKit permission request failed", err);
        setError(
          "Couldn't open the Health permission sheet. Open iOS Settings → Health → Data Access to grant access.",
        );
      }
    } finally {
      setConnecting(false);
    }
  }, [connecting, onConnected, setHealthKitConnected, insertHealthSamples]);

  const skipLabel = context === "onboarding" ? "Skip for now" : "Not now";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.32, ease: "easeOut" }}
      className={cn(
        "flex h-full min-h-0 flex-col gap-4 text-foreground",
        className,
      )}
    >
      {/* ── Header ───────────────────────────────────────────────── */}
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xs border border-border/50 bg-card/60">
          <HeartPulse
            className="h-6 w-6 text-func-danger-red"
            strokeWidth={2.2}
            aria-hidden
          />
        </div>
        <div className="min-w-0 flex-1 pt-1">
          <h2 className="text-[20px] font-bold leading-tight tracking-tight">
            Connect Apple Health
          </h2>
          <p className="mt-1 text-[12.5px] leading-snug text-muted-foreground">
            Read-only access. Powers your Fight Form score with real recovery
            data: HRV, sleep, workouts, and more.
          </p>
        </div>
      </div>

      {/* ── Metric list ──────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-y-auto -mx-1 px-1">
        {available === false ? (
          <UnavailablePanel />
        ) : (
          <ul className="space-y-1.5">
            {METRIC_ROWS.map((row) => (
              <li
                key={row.label}
                className="flex items-start gap-3 rounded-xs card-surface px-3 py-2.5"
              >
                <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xs bg-background/60">
                  {row.icon}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold leading-tight">
                    {row.label}
                  </p>
                  <p className="mt-0.5 text-[11.5px] leading-snug text-muted-foreground">
                    {row.why}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p className="mt-3 rounded-xs border border-func-warning-yellow/40 bg-func-warning-yellow/10 px-3 py-2 text-[11.5px] text-amber-200">
            {error}
          </p>
        )}

        <p className="mt-4 px-1 text-[11px] leading-snug text-muted-foreground/80">
          {FOOTER_TEXT}
        </p>
      </div>

      {/* ── Footer actions ───────────────────────────────────────── */}
      <div className="flex flex-col gap-2 pt-1">
        <Button
          onClick={handleConnect}
          disabled={connecting || available === false}
          className="no-tap-select h-12 w-full rounded-xs bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {connecting
            ? "Opening Health…"
            : available === false
              ? "Unavailable on this device"
              : "Connect"}
        </Button>
        {showHealthAppFallback && (
          <button
            type="button"
            onClick={() => {
              void healthKit.openHealthSettings();
            }}
            className="h-10 w-full text-[13px] font-medium text-muted-foreground hover:text-foreground active:scale-[0.98] transition"
          >
            Open Apple Health
          </button>
        )}
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            disabled={connecting}
            className="h-10 w-full text-[13px] font-medium text-muted-foreground hover:text-foreground active:scale-[0.98] transition disabled:opacity-50"
          >
            {skipLabel}
          </button>
        )}
      </div>
    </motion.div>
  );
}

/**
 * Edge case (spec §10.10): non-Capacitor / Android build. HealthKit
 * isn't reachable so we render a single placeholder panel that explains
 * the situation. The Connect button stays visible but is disabled by
 * the parent — using `available === false` from `isAvailable()`.
 */
function UnavailablePanel(): JSX.Element {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xs card-surface px-4 py-8 text-center">
      <HeartPulse
        className="h-7 w-7 text-muted-foreground/60"
        strokeWidth={1.8}
        aria-hidden
      />
      <p className="text-[13px] font-semibold">Only available in the iOS app</p>
      <p className="max-w-[28ch] text-[11.5px] leading-snug text-muted-foreground">
        Open FightCamp on your iPhone to link Apple Health. Your account picks
        up the data automatically.
      </p>
    </div>
  );
}
