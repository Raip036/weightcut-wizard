import { useState, useRef, useEffect, type CSSProperties } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { ShareButton } from "@/components/share/ShareButton";
import { ShareCardDialog } from "@/components/share/ShareCardDialog";
import { FightFormScoreCard } from "@/components/share/cards/FightFormScoreCard";
import { FightFormTrendSparkline } from "./FightFormTrendSparkline";
import { type TrendPoint } from "./FightFormSubScoreTile";
import { Icon, type IonIconName } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";
import { triggerHapticSelection } from "@/lib/haptics";
import { useUser } from "@/contexts/UserContext";
import type {
  FightFormLabel,
  FightFormState,
  ScoringPhase,
  SubScoreKey,
  SubScore as SubScoreType,
} from "@/scoring/types";

type SubScore = {
  value: number;
  weight: number;
  reason: string;
  // Optional sub-score metadata (e.g. weightCut surfaces targetKg / currentKg
  // for richer rendering). Sibling agent G is adding this to the canonical
  // `SubScore` type in `src/scoring/types.ts`; the local mirror tolerates it
  // either way.
  meta?: Record<string, number | string>;
};
export type FightFormTrendPoint = { date: string; score: number; state: FightFormState };

type Cap = { ruleId: string; cap: number };

export type LoggedTodayMap = {
  training: boolean;
  sleep: boolean;
  weight: boolean;
  wellness: boolean;
  meals: boolean;
};

type Props = {
  open: boolean;
  onClose: () => void;
  score: number;
  label: string;
  phase: string | null;
  daysToFight: number | null;
  campAge: { weeksAhead: number } | null;
  subScores: Record<string, SubScore> | null;
  topDriver: string | null;
  topLimiter: string | null;
  appliedCeiling: Cap | null;
  /**
   * Optional list of ALL currently-active ceilings (not just the tightest).
   * When provided and length > 1, the sheet renders a multi-cap section.
   * When omitted or length <= 1, falls back to the single `appliedCeiling`.
   */
  activeCeilings?: Cap[] | null;
  trend?: FightFormTrendPoint[] | null;
  // Optional decoration props — all degrade cleanly when missing.
  // `yesterdaySubScores` powers delta chips; `subScoreTrend` powers
  // inline sparklines + the expanded drill-down chart; `loggedToday`
  // drives the calibration teaser's ✓ chips; `calibration` populates
  // the "Unlocks in N days" headline.
  yesterdaySubScores?: Record<string, number>;
  subScoreTrend?: Record<string, TrendPoint[]>;
  loggedToday?: LoggedTodayMap;
  calibration?: { current: number; needed: number };
};

const CEILING_LABEL: Record<string, string> = {
  weight_cut_dangerous: "Aggressive weight loss",
  sleep_debt: "Sleep debt over 10h",
  training_spike: "Training load spike",
};

function ceilingLabel(ruleId: string): string {
  return CEILING_LABEL[ruleId] ?? ruleId;
}

const LABEL_ACCENT: Record<string, { stroke: string; fill: string }> = {
  sharp: { stroke: "stroke-func-recovery-green", fill: "fill-func-recovery-green" },
  sharpening: { stroke: "stroke-func-warning-yellow", fill: "fill-func-warning-yellow" },
  off_pace: { stroke: "stroke-func-carbs-orange", fill: "fill-func-carbs-orange" },
  at_risk: { stroke: "stroke-func-danger-red", fill: "fill-func-danger-red" },
};

const SUBSCORE_LABEL: Record<string, string> = {
  trainingLoad: "Training Load",
  sleep: "Sleep",
  weightCut: "Weight Cut",
  wellness: "Wellness",
  nutritionAdherence: "Nutrition",
};

// Icon per sub-score. Matched to TodayStrip where possible so the same
// signal reads consistently across the dashboard chrome and this sheet.
const SUBSCORE_ICON: Record<string, IonIconName> = {
  trainingLoad: "barbellOutline",
  sleep: "moonOutline",
  weightCut: "speedometerOutline",
  wellness: "heartOutline",
  nutritionAdherence: "restaurantOutline",
};

// Maps a sub-score key → the corresponding `loggedToday` boolean, so the
// calibration teaser can show ✓/Not yet without the parent having to remap.
const SUBSCORE_TO_LOGGED: Record<string, keyof LoggedTodayMap> = {
  trainingLoad: "training",
  sleep: "sleep",
  weightCut: "weight",
  wellness: "wellness",
  nutritionAdherence: "meals",
};

// Routes used by placeholder ("Log to unlock") cards in the carousel.
// Mirrors the top entry of each LIMITER_ACTIONS list so placeholder taps
// route the user straight to the page they need to log on.
const SUBSCORE_LOG_ROUTE: Record<string, string> = {
  trainingLoad: "/training-calendar",
  sleep: "/sleep",
  weightCut: "/weight",
  wellness: "/recovery/check-in",
  recovery: "/recovery",
};

const LABEL_DISPLAY: Record<string, string> = {
  sharp: "Sharp",
  sharpening: "Sharpening",
  off_pace: "Off Pace",
  at_risk: "At Risk",
};

// Sub-score categories rendered as locked rows in the calibration teaser
// and as the canonical ordering for the unlocked tile grid. Single source
// of truth so the teaser and the unlocked grid stay in sync.
//
// `nutritionAdherence` is intentionally excluded — nutrition currently
// carries weight 0 in the composite (the engine no longer scores meal
// adherence as part of fight form). It's still tracked in TodayStrip,
// just not shown in this breakdown.
const SUBSCORE_ORDER: string[] = [
  "trainingLoad",
  "sleep",
  "weightCut",
  "wellness",
];

// ─── Limiter action card ───────────────────────────────────────────────────
// Three concrete, tappable actions per limiter category. Each entry routes
// to the page the user would naturally use to actually move that
// sub-score. No AI — these are hardcoded so they're always available.
type LimiterAction = { label: string; route: string };

const LIMITER_ACTIONS: Record<string, LimiterAction[]> = {
  trainingLoad: [
    { label: "Log today's session", route: "/training-calendar" },
    { label: "Add a recovery day", route: "/training-calendar" },
  ],
  sleep: [
    { label: "Set a wind-down alarm", route: "/sleep" },
    { label: "Log last night's sleep", route: "/sleep" },
  ],
  weightCut: [
    { label: "Log this morning's weight", route: "/weight" },
    { label: "Check your weekly pace", route: "/weight" },
  ],
  wellness: [
    { label: "Do today's 4-tap check-in", route: "/recovery/check-in" },
    { label: "Walk for 20 minutes", route: "/recovery" },
  ],
  nutritionAdherence: [
    { label: "Log today's meals", route: "/nutrition" },
    { label: "Hit your protein target", route: "/nutrition" },
  ],
};

// Tier → bar fill color for the HOW contribution bar in the drill-down.
// Mirrors the TIER_BADGE palette in FightFormSubScoreTile.tsx so the
// expanded panel reads as a natural extension of its parent tile.
type SubScoreTier = "gold" | "silver" | "bronze" | "building";

function subScoreTier(value: number): SubScoreTier {
  if (value >= 80) return "gold";
  if (value >= 60) return "silver";
  if (value >= 40) return "bronze";
  return "building";
}

const TIER_BAR: Record<SubScoreTier, string> = {
  gold: "bg-amber-300",
  silver: "bg-slate-200",
  bronze: "bg-orange-300",
  building: "bg-muted-foreground/60",
};

/**
 * Safety-net copy when the engine returns no `reason` string. Kept
 * intentionally generic — the engine now owns the descriptive text per
 * sub-score and this only fires if `reason` is empty/missing.
 */
function fallbackSummary(value: number): string {
  if (value >= 80) return "Looking strong.";
  if (value >= 60) return "Holding steady.";
  if (value >= 40) return "Needs some attention.";
  return "Pulling your score down.";
}

function campPaceCopy(weeksAhead: number): string {
  if (weeksAhead === 0) return "On schedule";
  const n = Math.abs(weeksAhead);
  const unit = n === 1 ? "week" : "weeks";
  return weeksAhead > 0
    ? `${n.toFixed(0)} ${unit} ahead of schedule`
    : `${n.toFixed(0)} ${unit} behind schedule`;
}

function phaseCopy(phase: string | null): string | null {
  if (!phase) return null;
  if (phase === "fightWeek") return "Fight week";
  if (phase === "peak") return "Peak phase";
  if (phase === "build") return "Build phase";
  return phase;
}

export function FightFormScoreSheet(p: Props) {
  const [shareOpen, setShareOpen] = useState(false);
  const [shareVariant, setShareVariant] = useState<"dark" | "transparent">("dark");
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const navigate = useNavigate();
  const { userId } = useUser();
  // Active camp name is threaded into the shareable card so the rendered
  // image identifies which camp the score belongs to. Skip until userId
  // resolves, matching the pattern used in Dashboard / Camp / Goals.
  const activeCamp = useQuery(api.fight_camp.getActiveCamp, userId ? {} : "skip");

  // Subtle pulse on the composite score whenever it changes between
  // renders. `prevScoreRef` tracks the last value we drew; when it
  // differs we toggle `scorePulseOn` for one animation cycle (600ms,
  // matching the .score-pulse keyframe in index.css). The first render
  // never pulses (otherwise the sheet would always animate on open).
  const prevScoreRef = useRef<number | null>(null);
  const [scorePulseOn, setScorePulseOn] = useState(false);
  useEffect(() => {
    if (prevScoreRef.current !== null && prevScoreRef.current !== p.score) {
      setScorePulseOn(true);
      const t = window.setTimeout(() => setScorePulseOn(false), 650);
      prevScoreRef.current = p.score;
      return () => window.clearTimeout(t);
    }
    prevScoreRef.current = p.score;
  }, [p.score]);

  // Resolve the cap list — see the prop docs above.
  const caps: Cap[] =
    p.activeCeilings && p.activeCeilings.length > 0
      ? p.activeCeilings
      : p.appliedCeiling
        ? [p.appliedCeiling]
        : [];
  const tightestRuleId =
    caps.length === 0
      ? null
      : caps.reduce((min, c) => (c.cap < min.cap ? c : min), caps[0]).ruleId;

  const isCalibrating = !p.subScores || Object.keys(p.subScores).length === 0;
  const limiterActions = p.topLimiter ? LIMITER_ACTIONS[p.topLimiter] ?? null : null;

  const handleActionTap = (route: string) => {
    p.onClose();
    navigate(route);
  };

  // Calibration headline string. Inlined IIFE was the original site — pulled
  // out so the JSX below stays readable.
  const calibHeadline = (() => {
    if (!p.calibration) return "Calibrating your score";
    const remaining = Math.max(0, p.calibration.needed - p.calibration.current);
    if (remaining === 0) return "Computing your first score…";
    if (remaining === 1) return "Unlocks in 1 day";
    return `Unlocks in ${remaining} days`;
  })();

  // Sub-score → accent for the share/trend sparkline. Same lookup is hit
  // both in the drill-down chart and the 14-day overall chart.
  const accent = LABEL_ACCENT[p.label];
  const accentForLabel = accent ? `${accent.stroke} ${accent.fill}` : undefined;

  return (
    <Sheet open={p.open} onOpenChange={(v) => !v && p.onClose()}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto">
        {/* Title is absolutely centered on the sheet itself; share button
            floats over the left edge and the Sheet's built-in close X floats
            over the right. */}
        <SheetHeader className="relative flex items-center justify-center min-h-9 space-y-0">
          <SheetTitle className="text-2xl text-center">Fight Form Score</SheetTitle>
          <div className="absolute left-0 top-1/2 -translate-y-1/2">
            <ShareButton onClick={() => { setShareVariant("dark"); setShareOpen(true); }} />
          </div>
        </SheetHeader>

        <div className="mt-4 flex flex-col items-center text-center">
          <span
            className={cn(
              "display-number text-7xl leading-none inline-block",
              scorePulseOn && "score-pulse",
            )}
          >
            {p.score}
          </span>
          <div className="section-header mt-2">{LABEL_DISPLAY[p.label] ?? p.label}</div>
          {p.campAge && (
            <div className="text-xs text-muted-foreground mt-2">
              {campPaceCopy(p.campAge.weeksAhead)}
            </div>
          )}
          {phaseCopy(p.phase) && p.daysToFight != null && (
            <div className="text-xs text-muted-foreground">
              {phaseCopy(p.phase)} · {p.daysToFight} days to fight
            </div>
          )}
        </div>

        {/* Limiter focus card — pinned beneath the headline so the user
            sees the most actionable thing first. Only shown in unlocked
            (subScores present) state; the calibration teaser owns the
            screen otherwise. */}
        {!isCalibrating && p.topLimiter && limiterActions && (
          <div className="mt-5 rounded-xs border border-primary/20 bg-primary/5 px-3 py-3">
            <div className="flex items-center gap-1.5 mb-2">
              <span className="text-[10px] uppercase tracking-wide font-semibold text-primary/80">
                Focus
              </span>
              <span className="text-body-sm font-semibold text-foreground">
                {SUBSCORE_LABEL[p.topLimiter] ?? p.topLimiter}
              </span>
            </div>
            <ul className="space-y-1">
              {limiterActions.map((action) => (
                <li key={action.label}>
                  <button
                    type="button"
                    onClick={() => handleActionTap(action.route)}
                    className="w-full flex items-center justify-between gap-2 rounded-xs px-2 py-2 text-left text-body-sm text-foreground/90 active:bg-primary/10 transition-colors"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <Icon name="arrowForwardOutline" size={14} className="text-primary shrink-0" />
                      <span className="truncate">{action.label}</span>
                    </span>
                    <Icon name="chevronForwardOutline" size={12} className="text-muted-foreground/60 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {caps.length > 0 && (
          <div className="mt-6 space-y-2 rounded-xs border border-func-warning-yellow/30 bg-func-warning-yellow/[0.05] px-3 py-2.5">
            <div className="section-header text-func-warning-yellow">
              {caps.length === 1
                ? "Score capped"
                : `Score capped by ${caps.length} rules`}
            </div>
            <ul className="space-y-1.5">
              {caps
                .slice()
                .sort((a, b) => a.cap - b.cap)
                .map((c) => {
                  const isTightest = c.ruleId === tightestRuleId;
                  return (
                    <li
                      key={c.ruleId}
                      className="flex items-center justify-between text-xs"
                    >
                      <span
                        className={
                          isTightest && caps.length > 1
                            ? "font-semibold text-foreground"
                            : "text-foreground/85"
                        }
                      >
                        {ceilingLabel(c.ruleId)}
                        {isTightest && caps.length > 1 && (
                          <span className="ml-1.5 text-[10px] uppercase tracking-wide font-semibold text-func-warning-yellow">
                            Tightest
                          </span>
                        )}
                      </span>
                      <span className="display-number text-sm tabular-nums">
                        cap {c.cap}
                      </span>
                    </li>
                  );
                })}
            </ul>
          </div>
        )}

        {/* ─── Calibration (locked) state ────────────────────────────── */}
        {isCalibrating && (
          <div className="mt-6 space-y-3">
            <div className="rounded-xs border border-sky-400/20 bg-sky-400/[0.05] px-3 py-3 text-center">
              <p className="text-body-sm font-semibold text-foreground">{calibHeadline}</p>
              <p className="text-micro text-muted-foreground mt-1 leading-snug">
                Log any 3 days of signals to unlock your score. We'll then
                show your daily breakdown across these 5 areas.
              </p>
            </div>

            <ul className="space-y-1.5">
              {SUBSCORE_ORDER.map((key) => {
                const loggedKey = SUBSCORE_TO_LOGGED[key];
                const logged = p.loggedToday ? p.loggedToday[loggedKey] : false;
                return (
                  <li
                    key={key}
                    className="flex items-center gap-2.5 rounded-xs border border-border/40 bg-muted/20 px-3 py-2.5 opacity-80"
                  >
                    <Icon
                      name={SUBSCORE_ICON[key] ?? "ellipseOutline"}
                      size={16}
                      className="text-muted-foreground shrink-0"
                    />
                    <span className="flex-1 text-body-sm font-medium text-foreground/80">
                      {SUBSCORE_LABEL[key] ?? key}
                    </span>
                    {p.loggedToday && (
                      <span
                        className={cn(
                          "text-[10px] font-semibold px-1.5 py-0.5 rounded-full border leading-none",
                          logged
                            ? "text-func-recovery-green bg-func-recovery-green/10 border-func-recovery-green/30"
                            : "text-muted-foreground bg-muted/30 border-border/40",
                        )}
                      >
                        {logged ? "Logged today ✓" : "Not yet"}
                      </span>
                    )}
                    <Icon
                      name="lockClosedOutline"
                      size={14}
                      className="text-muted-foreground/60 shrink-0"
                    />
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {/* ─── Unlocked state — horizontal carousel ──────────────────── */}
        {!isCalibrating && p.subScores && (
          <SubScoreCarousel
            subScores={p.subScores}
            yesterdaySubScores={p.yesterdaySubScores}
            subScoreTrend={p.subScoreTrend}
            onTap={(key) => {
              triggerHapticSelection();
              setExpandedKey(key);
            }}
            onNavigate={handleActionTap}
          />
        )}

        {/* Overall 14-day trend — now lives below the primary content.
            In the locked state this is the main signal the user has; in
            the unlocked state it's a supporting reference, hence pushed
            down after the tile grid + drill-down. */}
        {p.trend && p.trend.length > 0 && (
          <div className="mt-6 space-y-2">
            <div className="section-header">14-day trend</div>
            <div className="h-12">
              <FightFormTrendSparkline points={p.trend} accentClass={accentForLabel} />
            </div>
          </div>
        )}

      </SheetContent>

      <ShareCardDialog
        open={shareOpen}
        onOpenChange={(v) => { setShareOpen(v); if (v) setShareVariant("dark"); }}
        transparent={shareVariant === "transparent"}
        showSwipeHint
        title="Share Fight Form Score"
        shareTitle="Fight Form Score"
        shareText={`My Fight Form Score is ${p.score}: ${LABEL_DISPLAY[p.label] ?? p.label}`}
      >
        {({ cardRef, aspect, transparent }) => {
          let touchStartX = 0;
          const flash = (el: HTMLElement | null) => {
            if (!el) return;
            el.classList.remove("share-variant-flash");
            void el.offsetWidth;
            el.classList.add("share-variant-flash");
          };
          const labelBtnStyle = (v: "dark" | "transparent"): CSSProperties => ({
            background: "none", border: "none", padding: 0, cursor: "pointer",
            fontSize: 12, fontWeight: 600,
            color: shareVariant === v ? "#ffffff" : "rgba(255,255,255,0.35)",
            transition: "color 0.2s",
          });
          return (
            <div
              onTouchStart={(e) => { touchStartX = e.touches[0].clientX; }}
              onTouchEnd={(e) => {
                const delta = e.changedTouches[0].clientX - touchStartX;
                if (Math.abs(delta) > 40) {
                  setShareVariant((v) => v === "dark" ? "transparent" : "dark");
                  flash(e.currentTarget as HTMLElement);
                }
              }}
            >
              <FightFormScoreCard
                ref={cardRef}
                score={p.score}
                label={(p.label as FightFormLabel) ?? "off_pace"}
                phase={(p.phase as ScoringPhase | null) ?? null}
                daysToFight={p.daysToFight}
                campAge={p.campAge}
                subScores={p.subScores as Record<SubScoreKey, SubScoreType> | null}
                campName={activeCamp?.name ?? null}
                aspect={aspect}
                transparent={transparent}
              />
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, marginTop: 10 }}>
                <button onClick={() => setShareVariant("dark")} style={labelBtnStyle("dark")}>
                  Dark
                </button>
                <div style={{ display: "flex", gap: 6 }}>
                  {(["dark", "transparent"] as const).map((v) => (
                    <button
                      key={v}
                      onClick={() => setShareVariant(v)}
                      aria-label={`${v} style`}
                      style={{
                        width: 8, height: 8, borderRadius: 4, border: "none", padding: 0,
                        cursor: "pointer",
                        background: shareVariant === v ? "#ffffff" : "rgba(255,255,255,0.3)",
                        transition: "background 0.2s",
                      }}
                    />
                  ))}
                </div>
                <button onClick={() => setShareVariant("transparent")} style={labelBtnStyle("transparent")}>
                  Transparent
                </button>
              </div>
            </div>
          );
        }}
      </ShareCardDialog>

      {/* Sub-score drill-down dialog — opened from the carousel above.
          Centred modal rather than a nested bottom sheet so the parent
          Sheet's scroll position is preserved on close. */}
      <SubScoreDialog
        subKey={expandedKey}
        sub={expandedKey && p.subScores ? p.subScores[expandedKey] ?? null : null}
        trend={expandedKey ? p.subScoreTrend?.[expandedKey] ?? null : null}
        accentClass={accentForLabel}
        onClose={() => setExpandedKey(null)}
        onAction={handleActionTap}
      />
    </Sheet>
  );
}

/* ─── Sub-score carousel ─────────────────────────────────────────────── */

interface SubScoreCarouselProps {
  subScores: Record<string, SubScore>;
  yesterdaySubScores?: Record<string, number>;
  subScoreTrend?: Record<string, TrendPoint[]>;
  onTap: (key: string) => void;
  onNavigate: (route: string) => void;
}

function SubScoreCarousel({
  subScores,
  yesterdaySubScores,
  subScoreTrend,
  onTap,
  onNavigate,
}: SubScoreCarouselProps) {
  // Always show the 4 core sub-scores so a fresh-start user with no
  // logged data still sees what they need to log to unlock signal.
  // `recovery` is appended only when actively contributing (weight > 0);
  // `nutritionAdherence` is intentionally excluded.
  // Active sub-scores (weight > 0) sort first by value ascending so the
  // most actionable lands in the lead slot, then placeholders trail.
  const candidates = [...SUBSCORE_ORDER];
  if (subScores.recovery && subScores.recovery.weight > 0) {
    candidates.push("recovery");
  }
  const ordered = candidates
    .filter((k) => !!subScores[k])
    .sort((a, b) => {
      const aActive = subScores[a].weight > 0 ? 1 : 0;
      const bActive = subScores[b].weight > 0 ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      return subScores[a].value - subScores[b].value;
    });

  const railRef = useRef<HTMLDivElement>(null);
  const [activeIdx, setActiveIdx] = useState(0);
  useEffect(() => {
    const el = railRef.current;
    if (!el) return;
    const onScroll = () => {
      const cards = el.querySelectorAll<HTMLButtonElement>("[data-subscore-card]");
      if (cards.length === 0) return;
      const center = el.scrollLeft + el.clientWidth / 2;
      let best = 0;
      let bestDist = Infinity;
      cards.forEach((c, i) => {
        const cardCenter = c.offsetLeft + c.offsetWidth / 2;
        const d = Math.abs(cardCenter - center);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      });
      setActiveIdx(best);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  }, [ordered.length]);

  return (
    <div className="mt-6 space-y-2" data-tutorial="fight-form-driving-section">
      <div className="section-header px-1">What's driving your score</div>
      <div
        ref={railRef}
        className="flex gap-2 overflow-x-auto -mx-5 px-5 pb-1 snap-x snap-mandatory [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ scrollPaddingLeft: "1.25rem", scrollPaddingRight: "1.25rem" }}
      >
        {ordered.map((key) => {
          const sub = subScores[key];
          if (sub.weight === 0) {
            return (
              <SubScorePlaceholderCard
                key={key}
                subKey={key}
                onNavigate={onNavigate}
              />
            );
          }
          return (
            <SubScoreCard
              key={key}
              subKey={key}
              sub={sub}
              yesterdayValue={yesterdaySubScores?.[key]}
              trend={subScoreTrend?.[key]}
              onTap={onTap}
            />
          );
        })}
      </div>
      {/* Active-card dots indicator — 5 cards is past the "obvious it
          scrolls" threshold so we surface a count. Active dot widens
          to a pill so position is glanceable. */}
      {ordered.length > 1 && (
        <div className="flex items-center justify-center gap-1.5 pt-0.5">
          {ordered.map((_, i) => (
            <span
              key={i}
              aria-hidden
              className={cn(
                "h-1.5 rounded-full transition-all",
                i === activeIdx ? "w-4 bg-foreground" : "w-1.5 bg-muted-foreground/30",
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Sub-score card (carousel item) ─────────────────────────────────── */

interface SubScoreCardProps {
  subKey: string;
  sub: SubScore;
  yesterdayValue: number | undefined;
  trend: TrendPoint[] | undefined;
  onTap: (key: string) => void;
}

/**
 * One card in the horizontal carousel. The `weightCut` variant swaps
 * the generic "{value} / 100" hero for a target → current → delta
 * block when the engine surfaces `meta.targetKg` + `meta.currentKg`;
 * otherwise it falls through to the standard layout so paused /
 * no-data states don't render empty fields.
 */
function SubScoreCard({
  subKey,
  sub,
  yesterdayValue,
  trend,
  onTap,
}: SubScoreCardProps) {
  const delta = yesterdayValue !== undefined ? sub.value - yesterdayValue : null;
  const tier = subScoreTier(sub.value);

  const wcTarget =
    subKey === "weightCut" && typeof sub.meta?.targetKg === "number"
      ? (sub.meta.targetKg as number)
      : null;
  const wcCurrent =
    subKey === "weightCut" && typeof sub.meta?.currentKg === "number"
      ? (sub.meta.currentKg as number)
      : null;
  const isWcRich = wcTarget != null && wcCurrent != null;
  const wcDelta = isWcRich ? wcCurrent! - wcTarget! : 0;
  // Signed-delta color: behind plan (positive) = red, on target band
  // (|d| ≤ 0.3) = green, slightly ahead (-0.5..0) = green, very ahead
  // (< -0.5) = amber. Mirrors the engine's grading bands.
  const wcDeltaColor = !isWcRich
    ? ""
    : wcDelta > 0.3
      ? "text-func-danger-red"
      : wcDelta >= -0.5
        ? "text-func-recovery-green"
        : "text-func-warning-yellow";
  const wcDeltaLabel = !isWcRich
    ? ""
    : Math.abs(wcDelta) <= 0.3
      ? "On target"
      : wcDelta > 0
        ? `+${wcDelta.toFixed(1)} kg off`
        : `${wcDelta.toFixed(1)} kg ahead`;

  return (
    <button
      type="button"
      data-subscore-card
      onClick={() => onTap(subKey)}
      className="snap-center shrink-0 w-[78%] rounded-2xl border border-border/40 bg-muted/15 px-4 py-3.5 text-left active:scale-[0.99] transition-transform"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon
            name={SUBSCORE_ICON[subKey] ?? "ellipseOutline"}
            size={14}
            className="text-foreground shrink-0"
          />
          <span className="text-body-sm font-semibold truncate">
            {SUBSCORE_LABEL[subKey] ?? subKey}
          </span>
        </div>
        {delta !== null && (
          <span
            className={cn(
              "text-[10px] font-semibold tabular-nums shrink-0",
              delta > 0
                ? "text-func-recovery-green"
                : delta < 0
                  ? "text-func-danger-red"
                  : "text-muted-foreground",
            )}
          >
            {delta > 0 ? "+" : ""}{delta}
          </span>
        )}
      </div>

      {isWcRich ? (
        <div className="mt-2.5">
          <div className="flex items-end gap-2 tabular-nums">
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none mb-1">
                Target
              </span>
              <span className="display-number text-xl leading-none">
                {wcTarget!.toFixed(1)}
              </span>
            </div>
            <Icon
              name="arrowForwardOutline"
              size={14}
              className="text-muted-foreground/70 mb-1 shrink-0"
            />
            <div className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground leading-none mb-1">
                You
              </span>
              <span className="display-number text-xl leading-none">
                {wcCurrent!.toFixed(1)}
              </span>
            </div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
              kg
            </span>
          </div>
          <div className={cn("mt-1.5 text-xs font-semibold tabular-nums", wcDeltaColor)}>
            {wcDeltaLabel}
          </div>
        </div>
      ) : (
        <div className="mt-2 flex items-end gap-2">
          <span className="display-number text-3xl leading-none tabular-nums">
            {sub.value}
          </span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
            / 100
          </span>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden">
          <div
            className={cn("h-full rounded-full", TIER_BAR[tier])}
            style={{ width: `${Math.max(0, Math.min(100, sub.value))}%` }}
          />
        </div>
        {isWcRich && (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground tabular-nums shrink-0">
            {sub.value} / 100
          </span>
        )}
      </div>

      {trend && trend.length >= 2 && (
        <div className="mt-2 h-8">
          <FightFormTrendSparkline
            points={trend.map((pt) => ({
              date: pt.date,
              score: pt.value,
              state: "ok" as FightFormState,
            }))}
          />
        </div>
      )}
    </button>
  );
}

/* ─── Sub-score placeholder card (carousel item, no data) ───────────── */

interface SubScorePlaceholderCardProps {
  subKey: string;
  onNavigate: (route: string) => void;
}

/**
 * Rendered in place of `SubScoreCard` when a sub-score has weight 0
 * (no data logged yet). Muted, dashed-border CTA that routes the user
 * straight to the relevant logging page instead of opening the
 * drill-down dialog.
 */
function SubScorePlaceholderCard({
  subKey,
  onNavigate,
}: SubScorePlaceholderCardProps) {
  const route = SUBSCORE_LOG_ROUTE[subKey] ?? "/";
  return (
    <button
      type="button"
      data-subscore-card
      onClick={() => onNavigate(route)}
      className="snap-center shrink-0 w-[78%] rounded-2xl border border-dashed border-border/60 bg-muted/10 px-4 py-3.5 text-left opacity-60 active:scale-[0.99] transition-transform"
    >
      <div className="flex items-center gap-1.5 min-w-0">
        <Icon
          name={SUBSCORE_ICON[subKey] ?? "ellipseOutline"}
          size={14}
          className="text-muted-foreground shrink-0"
        />
        <span className="text-body-sm font-semibold truncate text-foreground/80">
          {SUBSCORE_LABEL[subKey] ?? subKey}
        </span>
      </div>
      <div className="mt-3 text-body-sm font-semibold text-foreground/90">
        Log to unlock
      </div>
      <div className="mt-2 flex items-center gap-1 text-[11px] font-semibold text-primary">
        <span>Tap to log</span>
        <Icon name="arrowForwardOutline" size={12} className="shrink-0" />
      </div>
    </button>
  );
}

/* ─── Sub-score drill-down dialog ────────────────────────────────────── */

interface SubScoreDialogProps {
  subKey: string | null;
  sub: SubScore | null;
  trend: TrendPoint[] | null;
  accentClass?: string;
  onClose: () => void;
  onAction: (route: string) => void;
}

function SubScoreDialog({
  subKey,
  sub,
  trend,
  accentClass,
  onClose,
  onAction,
}: SubScoreDialogProps) {
  const open = !!subKey && !!sub;
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md p-5 gap-3">
        {subKey && sub && (
          <SubScoreDialogBody
            subKey={subKey}
            sub={sub}
            trend={trend}
            accentClass={accentClass}
            onAction={onAction}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function SubScoreDialogBody({
  subKey,
  sub,
  trend,
  accentClass,
  onAction,
}: {
  subKey: string;
  sub: SubScore;
  trend: TrendPoint[] | null;
  accentClass?: string;
  onAction: (route: string) => void;
}) {
  const tier = subScoreTier(sub.value);
  const contribution = sub.value * sub.weight;
  const fillPct = Math.max(0, Math.min(100, sub.value));
  const subActions = LIMITER_ACTIONS[subKey] ?? null;
  return (
    <>
      <DialogTitle className="flex items-center gap-2 text-base">
        <Icon
          name={SUBSCORE_ICON[subKey] ?? "ellipseOutline"}
          size={16}
          className="text-foreground shrink-0"
        />
        <span className="truncate">{SUBSCORE_LABEL[subKey] ?? subKey}</span>
        <span className="ml-auto display-number text-2xl tabular-nums">
          {sub.value}
        </span>
      </DialogTitle>
      <DialogDescription className="text-foreground/85 leading-snug">
        {sub.reason && sub.reason.trim().length > 0
          ? sub.reason
          : fallbackSummary(sub.value)}
      </DialogDescription>

      {sub.weight > 0 && (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div
              className="flex-1 h-1.5 rounded-full bg-muted/40 overflow-hidden"
              aria-hidden
            >
              <div
                className={cn("h-full rounded-full", TIER_BAR[tier])}
                style={{ width: `${fillPct}%` }}
              />
            </div>
            <span className="text-micro font-semibold tabular-nums text-foreground/90 shrink-0">
              +{contribution.toFixed(1)} pts
            </span>
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70 font-medium">
            Contribution to score
          </div>
        </div>
      )}

      {trend && trend.length >= 2 && (
        <div className="h-16 rounded-xs bg-background/40 p-2">
          <FightFormTrendSparkline
            points={trend.map((pt) => ({
              date: pt.date,
              score: pt.value,
              state: "ok" as FightFormState,
            }))}
            accentClass={accentClass}
          />
        </div>
      )}

      {subActions && subActions.length > 0 && (
        <div className="space-y-2">
          <div className="section-header">What you can do</div>
          <ul className="space-y-1">
            {subActions.map((action) => (
              <li key={action.label}>
                <button
                  type="button"
                  onClick={() => onAction(action.route)}
                  className="w-full flex items-center justify-between gap-2 rounded-xs px-2 py-2 text-left text-body-sm text-foreground/90 active:bg-primary/10 transition-colors"
                >
                  <span className="flex items-center gap-2 min-w-0">
                    <Icon
                      name="arrowForwardOutline"
                      size={14}
                      className="text-primary shrink-0"
                    />
                    <span className="truncate">{action.label}</span>
                  </span>
                  <Icon
                    name="chevronForwardOutline"
                    size={12}
                    className="text-muted-foreground/60 shrink-0"
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
