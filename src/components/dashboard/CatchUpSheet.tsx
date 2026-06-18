import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { useReducedMotion } from "motion/react";
import { api } from "@/../convex/_generated/api";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from "@/components/ui/drawer";
import { triggerHapticSuccess } from "@/lib/haptics";
import { Icon } from "@/components/ui/Icon";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────────────────────

type Pillar = "weight" | "training" | "sleep" | "wellness" | "nutrition";

interface CatchUpData {
  date: string;
  missing: readonly Pillar[];
  suggestedSleepHours: number | null;
  lastWeightKg: number | null;
}

interface Props {
  targetDate: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onEmpty?: () => void;
}

// ── Per-pillar row components ─────────────────────────────────────────────────

function PillarRow({
  children,
  label,
  icon,
}: {
  children: React.ReactNode;
  label: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 border-b border-border/30 last:border-b-0">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <span className="text-sm font-medium text-foreground">{label}</span>
      </div>
      <div className="flex items-center gap-2 shrink-0">{children}</div>
    </div>
  );
}

function SkipButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs text-muted-foreground/60 hover:text-muted-foreground px-2 py-1 rounded-md transition-colors"
      aria-label="Skip"
    >
      Skip
    </button>
  );
}

function ActionChip({
  label,
  onClick,
  pending,
}: {
  label: string;
  onClick: () => void;
  pending?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={pending}
      className={cn(
        "inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors",
        "bg-func-recovery-green/15 text-func-recovery-green border border-func-recovery-green/25",
        "active:bg-func-recovery-green/25 disabled:opacity-50",
      )}
      style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" } as React.CSSProperties}
    >
      {pending ? (
        <Icon name="refreshOutline" size={11} className="animate-spin" />
      ) : (
        <Icon name="checkmarkOutline" size={11} />
      )}
      {label}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CatchUpSheet({ targetDate, open, onOpenChange, onEmpty }: Props) {
  const prefersReduced = useReducedMotion();

  const data = useQuery(
    api.fightFormScore.catchUpSuggestions,
    open ? { date: targetDate } : "skip",
  ) as CatchUpData | null | undefined;

  const logSleep = useMutation(api.sleep_logs.logSleep);
  const logWeight = useMutation(api.weight_logs.logWeight);
  const setSkip = useMutation(api.markedSkips.setSkip);
  const createCalendarEntry = useMutation(api.fight_camp.createCalendarEntry);

  // Local pending states for async actions
  const [sleepPending, setSleepPending] = useState(false);
  const [weightPending, setWeightPending] = useState(false);
  const [restPending, setRestPending] = useState(false);
  const [skipPending, setSkipPending] = useState<Partial<Record<Pillar, boolean>>>({});

  // Weight input state (user must type/confirm — never written silently)
  const [weightInput, setWeightInput] = useState<string>(() =>
    data?.lastWeightKg != null ? String(data.lastWeightKg) : "",
  );

  // Keep weight input in sync with the query's suggestion when it first loads
  const weightInitRef = useRef(false);
  useEffect(() => {
    if (!weightInitRef.current && data?.lastWeightKg != null) {
      setWeightInput(String(data.lastWeightKg));
      weightInitRef.current = true;
    }
  }, [data?.lastWeightKg]);

  // Reset init guard when sheet closes so next open re-syncs
  useEffect(() => {
    if (!open) {
      weightInitRef.current = false;
      setWeightInput("");
    }
  }, [open]);

  // "All caught up" local state — shown briefly before auto-close
  const [allCaughtUp, setAllCaughtUp] = useState(false);
  const allCaughtUpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // When data resolves with 0 missing, notify parent
  useEffect(() => {
    if (!open || data === undefined) return; // still loading
    if (data === null) return; // unauthenticated — do nothing
    if (data.missing.length === 0) {
      setAllCaughtUp(true);
      allCaughtUpTimerRef.current = setTimeout(() => {
        onEmpty?.();
      }, prefersReduced ? 0 : 1400);
    } else {
      setAllCaughtUp(false);
    }
    return () => {
      if (allCaughtUpTimerRef.current) clearTimeout(allCaughtUpTimerRef.current);
    };
  }, [open, data, onEmpty, prefersReduced]);

  // ── Action handlers ─────────────────────────────────────────────────────

  const handleSleepConfirm = async () => {
    setSleepPending(true);
    try {
      await logSleep({ date: targetDate, hours: data?.suggestedSleepHours ?? 7 });
      await triggerHapticSuccess();
    } finally {
      setSleepPending(false);
    }
  };

  const handleWeightSave = async () => {
    const parsed = parseFloat(weightInput);
    if (!Number.isFinite(parsed) || isNaN(parsed)) return;
    setWeightPending(true);
    try {
      await logWeight({ date: targetDate, weightKg: parsed });
      await triggerHapticSuccess();
    } finally {
      setWeightPending(false);
    }
  };

  const handleRestDay = async () => {
    setRestPending(true);
    try {
      await createCalendarEntry({
        date: targetDate,
        sessionType: "Rest",
        intensity: "Rest",
        durationMinutes: 0,
        rpe: 0,
      });
      await triggerHapticSuccess();
    } finally {
      setRestPending(false);
    }
  };

  const handleSkip = async (pillar: "sleep" | "weight" | "wellness" | "nutrition") => {
    setSkipPending((prev) => ({ ...prev, [pillar]: true }));
    try {
      await setSkip({ date: targetDate, pillar });
    } finally {
      setSkipPending((prev) => ({ ...prev, [pillar]: false }));
    }
  };

  // ── Render ──────────────────────────────────────────────────────────────

  const missing = data?.missing ?? [];
  const isLoading = data === undefined;

  const weightInputValid =
    weightInput !== "" && Number.isFinite(parseFloat(weightInput)) && !isNaN(parseFloat(weightInput));

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className="scroll-touch"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
      >
        <DrawerHeader className="text-left pb-1">
          <DrawerTitle className="text-base font-bold">Yesterday in 10 seconds</DrawerTitle>
          <DrawerDescription className="text-sm text-muted-foreground mt-0.5">
            {allCaughtUp
              ? "All caught up ✓"
              : isLoading
                ? "Loading…"
                : missing.length === 0
                  ? "All caught up ✓"
                  : `${missing.length} pillar${missing.length === 1 ? "" : "s"} to tidy up`}
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 pb-2">
          {/* All caught-up state */}
          {(allCaughtUp || (!isLoading && missing.length === 0)) && (
            <div className="flex items-center justify-center gap-2 py-6 text-func-recovery-green">
              <Icon name="checkmarkCircle" size={22} />
              <span className="text-sm font-semibold">Yesterday is fully logged</span>
            </div>
          )}

          {/* Pillar rows */}
          {!allCaughtUp && missing.length > 0 && (
            <div className="rounded-2xl border border-border/40 bg-card/60 px-3 py-1 mb-3">
              {(missing as Pillar[]).map((pillar) => {
                if (pillar === "sleep") {
                  const suggested = data?.suggestedSleepHours ?? 7;
                  return (
                    <PillarRow
                      key="sleep"
                      label="Sleep"
                      icon={<Icon name="moonOutline" size={16} />}
                    >
                      <SkipButton onClick={() => void handleSkip("sleep")} />
                      <ActionChip
                        label={`Slept ~${suggested}h? Confirm`}
                        onClick={() => void handleSleepConfirm()}
                        pending={sleepPending}
                      />
                    </PillarRow>
                  );
                }

                if (pillar === "weight") {
                  return (
                    <PillarRow
                      key="weight"
                      label="Weight"
                      icon={<Icon name="speedometerOutline" size={16} />}
                    >
                      <SkipButton onClick={() => void handleSkip("weight")} />
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          value={weightInput}
                          onChange={(e) => setWeightInput(e.target.value)}
                          placeholder={data?.lastWeightKg != null ? String(data.lastWeightKg) : "kg"}
                          min={30}
                          max={250}
                          step={0.1}
                          className={cn(
                            "w-16 rounded-md border border-border/50 bg-muted/30 px-2 py-1 text-xs text-center",
                            "focus:outline-none focus:ring-1 focus:ring-primary/50",
                          )}
                          aria-label="Weight in kg"
                        />
                        <button
                          type="button"
                          onClick={() => void handleWeightSave()}
                          disabled={!weightInputValid || weightPending}
                          className={cn(
                            "inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors",
                            "bg-func-recovery-green/15 text-func-recovery-green border border-func-recovery-green/25",
                            "active:bg-func-recovery-green/25 disabled:opacity-40",
                          )}
                          style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" } as React.CSSProperties}
                        >
                          {weightPending ? (
                            <Icon name="refreshOutline" size={11} className="animate-spin" />
                          ) : (
                            <Icon name="saveOutline" size={11} />
                          )}
                          Save
                        </button>
                      </div>
                    </PillarRow>
                  );
                }

                if (pillar === "training") {
                  return (
                    <PillarRow
                      key="training"
                      label="Training"
                      icon={<Icon name="barbellOutline" size={16} />}
                    >
                      <Link
                        to={`/training-calendar?date=${targetDate}`}
                        onClick={() => onOpenChange(false)}
                        className={cn(
                          "inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors",
                          "bg-muted/40 text-foreground/80 border border-border/40",
                          "active:bg-muted/60",
                        )}
                      >
                        Open
                      </Link>
                      <button
                        type="button"
                        onClick={() => void handleRestDay()}
                        disabled={restPending}
                        className={cn(
                          "inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors",
                          "bg-func-recovery-green/15 text-func-recovery-green border border-func-recovery-green/25",
                          "active:bg-func-recovery-green/25 disabled:opacity-40",
                        )}
                        style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" } as React.CSSProperties}
                      >
                        {restPending ? (
                          <Icon name="refreshOutline" size={11} className="animate-spin" />
                        ) : (
                          <Icon name="moonOutline" size={11} />
                        )}
                        Rest day
                      </button>
                    </PillarRow>
                  );
                }

                if (pillar === "wellness") {
                  return (
                    <PillarRow
                      key="wellness"
                      label="Wellness"
                      icon={<Icon name="heartOutline" size={16} />}
                    >
                      <SkipButton onClick={() => void handleSkip("wellness")} />
                      <Link
                        to={`/recovery/check-in?date=${targetDate}`}
                        onClick={() => onOpenChange(false)}
                        className={cn(
                          "inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors",
                          "bg-func-recovery-green/15 text-func-recovery-green border border-func-recovery-green/25",
                          "active:bg-func-recovery-green/25",
                        )}
                      >
                        <Icon name="openOutline" size={11} />
                        Open
                      </Link>
                    </PillarRow>
                  );
                }

                if (pillar === "nutrition") {
                  return (
                    <PillarRow
                      key="nutrition"
                      label="Nutrition"
                      icon={<Icon name="restaurantOutline" size={16} />}
                    >
                      <SkipButton onClick={() => void handleSkip("nutrition")} />
                      <Link
                        to={`/nutrition?date=${targetDate}`}
                        onClick={() => onOpenChange(false)}
                        className={cn(
                          "inline-flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors",
                          "bg-func-recovery-green/15 text-func-recovery-green border border-func-recovery-green/25",
                          "active:bg-func-recovery-green/25",
                        )}
                      >
                        <Icon name="openOutline" size={11} />
                        Open
                      </Link>
                    </PillarRow>
                  );
                }

                return null;
              })}
            </div>
          )}

          {/* Loading skeleton */}
          {isLoading && (
            <div className="space-y-3 py-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 rounded-xl bg-muted/30 animate-pulse" />
              ))}
            </div>
          )}

          {/* "Not now" dismiss button */}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="w-full mt-1 py-3 text-sm text-muted-foreground/70 hover:text-muted-foreground transition-colors"
          >
            Not now
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
