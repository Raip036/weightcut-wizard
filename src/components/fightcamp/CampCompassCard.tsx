// T14: CampCompassCard — UI surface for the Sunday weekly AI recovery report
// ("Camp Compass"). The Recovery page itself is free; THIS card is Pro-gated.
//
// States:
//   • subscription resolving / query in-flight → skeleton.
//   • free user                                → amber-border locked preview
//                                                with blurred faux-bullets +
//                                                "Unlock — Pro" CTA. Tap routes
//                                                to the existing paywall via
//                                                `useSubscription().openPaywall`.
//   • pro user, report present                 → verdict (large semibold), a
//                                                "Where you broke down" prose
//                                                block, a "Next 7 days" list
//                                                with day-formatted rows, and
//                                                an optional "Camp arc"
//                                                section. Tapping the card
//                                                opens a bottom sheet with the
//                                                same content laid out larger.
//   • pro user, no report yet                  → informational "Your first
//                                                report drops Sunday at 8pm."
//                                                — no CTA.
//
// Data wiring is self-contained: the component owns its `useQuery` against
// `api.recoveryReports.getCurrentForUser` so callers only need to pass the
// auth'd `userId` (or `null` while it resolves).
import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { Icon } from "@/components/ui/Icon";
import { Skeleton } from "@/components/ui/skeleton-loader";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useSubscription } from "@/hooks/useSubscription";
import { triggerHapticSelection } from "@/lib/haptics";

interface CampCompassCardProps {
  userId: string | null;
  className?: string;
}

interface NextWeekAction {
  dayIso: string;
  action: string;
}

interface RecoveryReport {
  _id: string;
  weekStartIso: string;
  verdict: string;
  breakdown: string;
  nextWeekActions: NextWeekAction[];
  campArc?: string;
  createdAt: number;
}

const SECTION_LABEL =
  "text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground/70";

// "Mon · Jun 3" from "2026-06-03". Falls back to the raw ISO if parsing fails.
function formatDayLabel(iso: string): string {
  try {
    // Parse as a local date — splitting on "-" avoids the UTC offset gotcha
    // that `new Date("2026-06-03")` triggers (it's interpreted as UTC midnight
    // and can show the previous day for negative-offset timezones).
    const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
    if (!y || !m || !d) return iso;
    const date = new Date(y, m - 1, d);
    const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
    const monthDay = date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    return `${weekday} · ${monthDay}`;
  } catch {
    return iso;
  }
}

// "week of Jun 3" from "2026-06-03". Same UTC caveat as above.
function formatWeekOfLabel(iso: string): string {
  try {
    const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
    if (!y || !m || !d) return iso;
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

// ── Skeleton ───────────────────────────────────────────────────────────
function CampCompassSkeleton() {
  return (
    <div className="card-surface rounded-2xl border border-border/50 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-4 w-4 rounded" />
      </div>
      <Skeleton className="h-6 w-3/4" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  );
}

// ── Free / locked preview ─────────────────────────────────────────────
function LockedCompass({
  onUpgrade,
  className,
  prefersReduced,
}: {
  onUpgrade: () => void;
  className: string;
  prefersReduced: boolean | null;
}) {
  // Faux bullets with redacted headers — kept short so the blur reads as
  // intentional copy redaction rather than broken content.
  const fauxBullets = [
    "Verdict ░░░░░░░░░",
    "Where you broke down ░░░░░░░",
    "Next week's play ░░░░░░",
  ];

  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 24, stiffness: 240 }}
      className={`relative card-surface rounded-2xl border border-amber-400/30 bg-amber-400/[0.03] p-5 overflow-hidden ${className}`}
    >
      <div className="absolute top-3 right-3 text-amber-400/80">
        <Icon name="lockClosedOutline" size={14} aria-label="Pro feature" />
      </div>

      <div className={SECTION_LABEL}>Sunday report · Pro</div>
      <h3 className="mt-1.5 text-[17px] font-bold tracking-tight text-foreground">
        Your Sunday Report
      </h3>

      <div
        aria-hidden
        className="mt-3 space-y-2"
        style={{ filter: "blur(4px)", userSelect: "none" }}
      >
        {fauxBullets.map((line, i) => (
          <div
            key={i}
            className="flex items-start gap-2 text-[13px] text-muted-foreground leading-snug"
          >
            <span className="text-muted-foreground/60">·</span>
            <span>{line}</span>
          </div>
        ))}
      </div>

      <p className="mt-3 text-[12px] text-muted-foreground leading-snug">
        Weekly AI recap of your camp — where you broke down and what to fix.
      </p>

      <button
        type="button"
        onClick={() => {
          triggerHapticSelection();
          onUpgrade();
        }}
        className="mt-4 w-full min-h-[44px] rounded-xs bg-primary text-primary-foreground px-4 py-2.5 text-[13px] font-semibold inline-flex items-center justify-center gap-1.5 active:scale-[0.98] transition-transform"
      >
        <Icon name="lockClosedOutline" size={14} />
        Unlock — Pro
      </button>
    </motion.div>
  );
}

// ── Pro empty state ───────────────────────────────────────────────────
function EmptyCompass({
  className,
  prefersReduced,
}: {
  className: string;
  prefersReduced: boolean | null;
}) {
  return (
    <motion.div
      initial={prefersReduced ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", damping: 24, stiffness: 240 }}
      className={`card-surface rounded-2xl border border-border/50 p-5 ${className}`}
    >
      <div className={SECTION_LABEL}>Sunday report</div>
      <h3 className="mt-1.5 text-[17px] font-bold tracking-tight text-foreground">
        Sunday Report
      </h3>
      <p className="mt-2 text-[13px] text-muted-foreground leading-snug">
        Your first report drops Sunday at 8pm.
      </p>
    </motion.div>
  );
}

// ── Shared body (used by card + full sheet) ───────────────────────────
function ReportBody({
  report,
  expanded,
}: {
  report: RecoveryReport;
  expanded: boolean;
}) {
  // In the compact card we cap the actions at 3 (per spec); the sheet
  // shows the full list. The action returns at most 3 in current spec
  // but we cap defensively.
  const actions = expanded
    ? report.nextWeekActions
    : report.nextWeekActions.slice(0, 3);

  return (
    <div className="space-y-4">
      <p
        className={`${expanded ? "text-[18px]" : "text-[16px]"} font-semibold leading-snug text-foreground`}
      >
        {report.verdict}
      </p>

      <div>
        <div className={SECTION_LABEL}>Where you broke down</div>
        <p
          className={`mt-1.5 ${expanded ? "text-[14px]" : "text-[13px]"} text-foreground/85 leading-relaxed`}
        >
          {report.breakdown}
        </p>
      </div>

      {actions.length > 0 && (
        <div>
          <div className={SECTION_LABEL}>Next 7 days</div>
          <ul className="mt-1.5 divide-y divide-border/40 rounded-md border border-border/30 overflow-hidden">
            {actions.map((a, i) => (
              <li
                key={`${a.dayIso}-${i}`}
                className="flex items-start gap-3 px-3 py-2.5"
              >
                <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground/80 w-[88px] tabular-nums">
                  {formatDayLabel(a.dayIso)}
                </span>
                <span
                  className={`flex-1 ${expanded ? "text-[14px]" : "text-[13px]"} text-foreground leading-snug`}
                >
                  {a.action}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {report.campArc && (
        <div>
          <div className={SECTION_LABEL}>Camp arc</div>
          <p
            className={`mt-1.5 ${expanded ? "text-[14px]" : "text-[13px]"} text-foreground/85 leading-relaxed`}
          >
            {report.campArc}
          </p>
        </div>
      )}
    </div>
  );
}

// ── Pro filled card ────────────────────────────────────────────────────
function FilledCompass({
  report,
  className,
  prefersReduced,
}: {
  report: RecoveryReport;
  className: string;
  prefersReduced: boolean | null;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <>
      <motion.div
        initial={prefersReduced ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: "spring", damping: 22, stiffness: 260 }}
        className={className}
      >
        <button
          type="button"
          onClick={() => {
            triggerHapticSelection();
            setSheetOpen(true);
          }}
          aria-label="Open full Sunday report"
          className="w-full text-left card-surface rounded-2xl border border-border/50 p-5 active:scale-[0.995] transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <div className="flex items-center justify-between mb-3">
            <div className={SECTION_LABEL}>
              Sunday Report · week of {formatWeekOfLabel(report.weekStartIso)}
            </div>
            <Icon
              name="chevronForwardOutline"
              size={14}
              className="text-muted-foreground/60"
            />
          </div>
          <ReportBody report={report} expanded={false} />
        </button>
      </motion.div>

      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-3xl p-0 max-h-[92vh] overflow-y-auto [&>button]:hidden"
          style={{
            paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)",
          }}
        >
          <VisuallyHidden>
            <SheetTitle>Sunday Report</SheetTitle>
          </VisuallyHidden>
          <div className="flex justify-center pt-2 pb-1">
            <div
              className="w-10 h-1 rounded-full bg-muted-foreground/25"
              aria-hidden
            />
          </div>
          <div className="flex items-center justify-between px-5 pt-2 pb-3">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80">
                Camp Compass
              </p>
              <h2 className="text-[19px] font-bold tracking-tight">
                Week of {formatWeekOfLabel(report.weekStartIso)}
              </h2>
            </div>
            <button
              type="button"
              onClick={() => setSheetOpen(false)}
              aria-label="Close"
              className="h-9 w-9 rounded-full bg-muted/40 flex items-center justify-center text-muted-foreground active:bg-muted/60 transition"
            >
              <Icon name="closeOutline" size={16} />
            </button>
          </div>
          <div className="px-5 pb-5">
            <ReportBody report={report} expanded={true} />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

// ── Outer ──────────────────────────────────────────────────────────────
export function CampCompassCard({ userId, className = "" }: CampCompassCardProps) {
  const prefersReduced = useReducedMotion();
  const { isPremium, isSubscriptionResolved, openPaywall } = useSubscription();

  // Self-contained reactive query. Cast through `any` matches the spec —
  // the function is freshly added in T13 and the typed `api` surface may
  // not have it on every editor's typecheck cache yet.
  const report = useQuery(
    (api as any).recoveryReports?.getCurrentForUser,
    userId ? {} : "skip",
  ) as RecoveryReport | null | undefined;

  // Loading: subscription unresolved OR (Pro user with query in flight).
  // For free users we don't need the report to render the locked state,
  // so we paint as soon as subscription resolves.
  if (!isSubscriptionResolved) {
    return <CampCompassSkeleton />;
  }

  if (!isPremium) {
    return (
      <LockedCompass
        onUpgrade={openPaywall}
        className={className}
        prefersReduced={prefersReduced}
      />
    );
  }

  // Pro user — wait on the query before deciding empty vs filled.
  if (report === undefined) {
    return <CampCompassSkeleton />;
  }

  if (report === null) {
    return <EmptyCompass className={className} prefersReduced={prefersReduced} />;
  }

  return (
    <FilledCompass
      report={report}
      className={className}
      prefersReduced={prefersReduced}
    />
  );
}
