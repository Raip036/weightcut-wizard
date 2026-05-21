/**
 * HealthSettingsCard — settings entry for Apple Health.
 *
 * Rendered inside `src/pages/Profile.tsx`. Shows:
 *   - Current connection state + tier badge (Watch / Phone / Not connected).
 *   - Last sync timestamp.
 *   - Per-metric granted / denied list (spec §10.2 partial-grant handling).
 *   - Connect button (opens the full-screen explainer sheet).
 *   - Disconnect button (calls `api.health.markDisconnected`; iOS doesn't
 *     let us programmatically revoke HealthKit so we surface a deep-link
 *     to iOS Settings via `healthKit.openHealthSettings()`).
 *   - Web build: shows "Only available in the iOS app" panel (spec §10.10).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { AnimatePresence, motion } from "motion/react";
import {
  CheckCircle2,
  ExternalLink,
  HeartPulse,
  Loader2,
  Settings,
  XCircle,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { logger } from "@/lib/logger";
import { healthKit } from "@/services/healthKit";
import { api } from "@/../convex/_generated/api";
import { useUser } from "@/contexts/UserContext";
import ErrorBoundary from "@/components/ErrorBoundary";

import { ConnectAppleHealthSheet } from "./ConnectAppleHealthSheet";

// Display-friendly labels mirror ConnectAppleHealthSheet's row list but
// keyed by Agent A's HealthMetric string values.
// ASSUMPTION: Agent A exports these exact metric names per spec §5.1.
const METRIC_LABELS: Record<string, string> = {
  hrv_sdnn: "Heart rate variability",
  resting_hr: "Resting heart rate",
  sleep_total: "Sleep duration",
  sleep_deep: "Deep sleep",
  sleep_rem: "REM sleep",
  sleep_core: "Core sleep",
  workout_minutes: "Workouts",
  active_energy_kcal: "Active energy",
  steps: "Steps",
  vo2_max: "VO2 Max",
  respiratory_rate: "Respiratory rate",
  wrist_temp_delta: "Wrist temperature",
  body_mass_kg: "Body mass",
};

type Tier = "tier_0" | "tier_1" | "tier_2" | null;

interface HealthSettingsCardProps {
  className?: string;
}

export function HealthSettingsCard({
  className,
}: HealthSettingsCardProps): JSX.Element {
  // Wrap the inner card in an ErrorBoundary so a future Convex/render error
  // here degrades into a small inline fallback instead of unwinding to the
  // page-level boundary (which crashes the entire Profile/Recovery screen).
  return (
    <ErrorBoundary fallback={<HealthCardErrorFallback className={className} />}>
      <HealthSettingsCardInner className={className} />
    </ErrorBoundary>
  );
}

function HealthSettingsCardInner({
  className,
}: HealthSettingsCardProps): JSX.Element {
  const { userId } = useUser();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [openingSettings, setOpeningSettings] = useState(false);

  // Skip the query until Convex auth has resolved a userId. Backend also
  // returns null on unauth, so the downstream code handles both cases.
  type TierInfo = {
    tier?: Tier;
    grantedMetrics?: string[];
    lastSyncAt?: number | null;
    connectedAt?: number | null;
  };
  const tierInfoRaw = useQuery(
    api.health.getTier,
    userId ? {} : "skip",
  ) as TierInfo | null | undefined;
  // Normalise both `null` (unauth from server) and `undefined` (loading /
  // skipped) into "no data yet" so the rest of the component just checks
  // optional fields.
  const tierInfo: TierInfo | undefined = tierInfoRaw ?? undefined;

  const markDisconnected = useMutation(api.health.markDisconnected);

  useEffect(() => {
    let mounted = true;
    healthKit
      .isAvailable()
      .then((ok) => {
        if (mounted) setAvailable(ok);
      })
      .catch(() => {
        if (mounted) setAvailable(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const tier: Tier = tierInfo?.tier ?? null;
  const grantedMetrics = useMemo(
    () => tierInfo?.grantedMetrics ?? [],
    [tierInfo?.grantedMetrics],
  );
  const connectedAt = tierInfo?.connectedAt ?? null;
  const lastSyncAt = tierInfo?.lastSyncAt ?? null;
  const isConnected = !!connectedAt;

  const tierBadge = useMemo(() => {
    if (!isConnected) return { label: "Not connected", tone: "muted" as const };
    if (tier === "tier_2") return { label: "Watch connected", tone: "good" as const };
    if (tier === "tier_1") return { label: "Phone only", tone: "warn" as const };
    return { label: "Syncing", tone: "muted" as const };
  }, [isConnected, tier]);

  const handleConnected = useCallback(() => {
    setSheetOpen(false);
  }, []);

  const handleDisconnect = useCallback(async () => {
    if (disconnecting) return;
    setDisconnecting(true);
    try {
      if (markDisconnected) {
        await markDisconnected({});
      }
    } catch (err) {
      logger.error("markDisconnected failed", err);
    } finally {
      setDisconnecting(false);
    }
  }, [disconnecting, markDisconnected]);

  const handleOpenHealthSettings = useCallback(async () => {
    if (openingSettings) return;
    setOpeningSettings(true);
    try {
      await healthKit.openHealthSettings();
    } catch (err) {
      logger.warn("openHealthSettings failed", err);
    } finally {
      setOpeningSettings(false);
    }
  }, [openingSettings]);

  // ─── Web / Android build (spec §10.10) ──────────────────────────
  if (available === false) {
    return (
      <Card
        className={cn(
          "rounded-xs border border-border/50 bg-card/60 p-4 space-y-2",
          className,
        )}
      >
        <div className="flex items-center gap-2">
          <HeartPulse className="h-4 w-4 text-func-danger-red" />
          <h3 className="text-[14px] font-semibold tracking-tight">
            Apple Health
          </h3>
        </div>
        <p className="text-[12px] leading-snug text-muted-foreground">
          Only available in the iOS app. Open FightCamp on your iPhone to
          link Apple Health.
        </p>
      </Card>
    );
  }

  return (
    <>
      <Card
        className={cn(
          "rounded-xs border border-border/50 bg-card/60 p-4 space-y-3",
          className,
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2">
            <HeartPulse className="h-4 w-4 text-func-danger-red" />
            <h3 className="text-[14px] font-semibold tracking-tight">
              Apple Health
            </h3>
          </div>
          <TierPill {...tierBadge} />
        </div>

        {isConnected ? (
          <ConnectedBody
            grantedMetrics={grantedMetrics}
            lastSyncAt={lastSyncAt}
            onOpenHealthSettings={handleOpenHealthSettings}
            openingSettings={openingSettings}
            onDisconnect={handleDisconnect}
            disconnecting={disconnecting}
          />
        ) : (
          <DisconnectedBody onConnect={() => setSheetOpen(true)} />
        )}
      </Card>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="bottom"
          className="h-[90dvh] rounded-t-2xl border-border/50 bg-background p-4"
        >
          <SheetTitle className="sr-only">Connect Apple Health</SheetTitle>
          <ConnectAppleHealthSheet
            context="settings"
            onConnected={handleConnected}
            onSkip={() => setSheetOpen(false)}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

// ─── Sub-components ────────────────────────────────────────────────────

function TierPill({
  label,
  tone,
}: {
  label: string;
  tone: "good" | "warn" | "muted";
}): JSX.Element {
  const cls =
    tone === "good"
      ? "bg-func-recovery-green/15 text-func-recovery-green border-func-recovery-green/30"
      : tone === "warn"
        ? "bg-func-warning-yellow/15 text-func-warning-yellow border-func-warning-yellow/30"
        : "bg-muted/40 text-muted-foreground border-border/50";
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-2 text-[10px] font-semibold uppercase tracking-wider",
        cls,
      )}
    >
      {label}
    </span>
  );
}

function DisconnectedBody({
  onConnect,
}: {
  onConnect: () => void;
}): JSX.Element {
  return (
    <div className="space-y-2.5">
      <p className="text-[12px] leading-snug text-muted-foreground">
        Read HRV, resting heart rate, sleep, workouts, and recovery signals
        from Apple Health so your Fight Form score reflects how you actually
        recover.
      </p>
      <Button
        onClick={onConnect}
        className="h-10 w-full rounded-xs bg-primary text-primary-foreground hover:opacity-90"
      >
        Connect Apple Health
      </Button>
    </div>
  );
}

function ConnectedBody({
  grantedMetrics,
  lastSyncAt,
  onOpenHealthSettings,
  openingSettings,
  onDisconnect,
  disconnecting,
}: {
  grantedMetrics: string[];
  lastSyncAt: number | null;
  onOpenHealthSettings: () => void;
  openingSettings: boolean;
  onDisconnect: () => void;
  disconnecting: boolean;
}): JSX.Element {
  const grantedSet = useMemo(
    () => new Set(grantedMetrics),
    [grantedMetrics],
  );
  const knownMetrics = Object.keys(METRIC_LABELS);
  // Show a compact list — only render rows we have a label for so a
  // newly-added Agent A metric without a label here just gets skipped
  // (rather than rendering a raw enum string).
  const rows = knownMetrics.map((key) => ({
    key,
    label: METRIC_LABELS[key],
    granted: grantedSet.has(key),
  }));

  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? rows : rows.slice(0, 5);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground">
        {formatLastSync(lastSyncAt)}
      </p>

      <ul className="space-y-1">
        <AnimatePresence initial={false}>
          {visible.map((row) => (
            <motion.li
              key={row.key}
              layout
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18 }}
              className="flex items-center justify-between gap-2 rounded-xs bg-background/40 px-2.5 py-1.5"
            >
              <span className="truncate text-[12px] font-medium">
                {row.label}
              </span>
              {row.granted ? (
                <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wider text-func-recovery-green">
                  <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} />
                  Granted
                </span>
              ) : (
                <button
                  type="button"
                  onClick={onOpenHealthSettings}
                  disabled={openingSettings}
                  className="inline-flex items-center gap-1 rounded-full border border-func-warning-yellow/40 bg-func-warning-yellow/10 px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-wider text-func-warning-yellow active:scale-[0.97] transition disabled:opacity-50"
                >
                  {openingSettings ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <XCircle className="h-3 w-3" strokeWidth={2.5} />
                  )}
                  Denied · Fix
                </button>
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>

      {rows.length > 5 && (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          className="text-[11.5px] font-medium text-primary/85 hover:text-primary"
        >
          {showAll ? "Show fewer metrics" : `Show all ${rows.length} metrics`}
        </button>
      )}

      <div className="flex flex-col gap-1.5 pt-1">
        <button
          type="button"
          onClick={onOpenHealthSettings}
          disabled={openingSettings}
          className="inline-flex items-center justify-center gap-1.5 rounded-xs border border-border/50 bg-muted/30 px-3 py-2 text-[12px] font-semibold text-foreground active:scale-[0.98] transition disabled:opacity-50"
        >
          <Settings className="h-3.5 w-3.5" />
          Manage in iOS Settings
          <ExternalLink className="h-3 w-3 text-muted-foreground" />
        </button>
        <button
          type="button"
          onClick={onDisconnect}
          disabled={disconnecting}
          className="h-9 text-[11.5px] font-medium text-muted-foreground hover:text-foreground active:scale-[0.98] transition disabled:opacity-50"
        >
          {disconnecting ? "Disconnecting…" : "Disconnect"}
        </button>
      </div>
    </div>
  );
}

function HealthCardErrorFallback({
  className,
}: {
  className?: string;
}): JSX.Element {
  return (
    <Card
      className={cn(
        "rounded-xs border border-border/50 bg-card/60 p-4 space-y-2",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <HeartPulse className="h-4 w-4 text-func-danger-red" />
        <h3 className="text-[14px] font-semibold tracking-tight">
          Apple Health
        </h3>
      </div>
      <p className="text-[12px] leading-snug text-muted-foreground">
        Couldn't load health data — pull to refresh.
      </p>
    </Card>
  );
}

function formatLastSync(ts: number | null): string {
  if (!ts) return "Connected — first sync pending.";
  const diffMs = Date.now() - ts;
  const mins = Math.round(diffMs / 60_000);
  if (mins < 1) return "Last synced just now.";
  if (mins < 60) return `Last synced ${mins}m ago.`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Last synced ${hours}h ago.`;
  const days = Math.round(hours / 24);
  return `Last synced ${days}d ago.`;
}
