import { memo, useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { localCache } from "@/lib/localCache";
import { logger } from "@/lib/logger";
import { triggerHaptic, triggerHapticSuccess } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

interface SleepLoggerProps {
  userId: string;
  compact?: boolean;
  className?: string;
}

const MIN_HOURS = 0;
const MAX_HOURS = 16;
const STEP = 0.5;
const DEFAULT_HOURS = 7.5;

const today = () => new Date().toISOString().split("T")[0];
const cacheKey = (date: string) => `sleep_log_${date}`;

export const SleepLogger = memo(function SleepLogger({ userId, compact, className }: SleepLoggerProps) {
  const navigate = useNavigate();
  const [hours, setHours] = useState(DEFAULT_HOURS);
  const [draftHours, setDraftHours] = useState(DEFAULT_HOURS);
  const [saved, setSaved] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Convex query for today's sleep row — reactive, no manual cache logic needed.
  const todayRow = useQuery(api.sleep_logs.listForUser, userId ? { limit: 7 } : "skip");
  const logSleepMut = useMutation(api.sleep_logs.logSleep);

  useEffect(() => {
    const date = today();
    const cached = localCache.get<number>(userId, cacheKey(date));
    if (cached !== null) {
      setHours(cached);
      setDraftHours(cached);
      setSaved(true);
    }
    if (todayRow) {
      const t = (todayRow as Array<any>).find((r) => r.date === date);
      if (t && typeof t.hours === "number") {
        setHours(t.hours);
        setDraftHours(t.hours);
        setSaved(true);
        localCache.set(userId, cacheKey(date), t.hours);
      }
    }
  }, [userId, todayRow]);

  const openSheet = () => {
    triggerHaptic(ImpactStyle.Light);
    setDraftHours(hours);
    setIsOpen(true);
  };

  const handleSave = useCallback(async () => {
    if (saving) return;
    const date = today();
    const newHours = draftHours;
    setSaving(true);
    // Optimistic update
    setHours(newHours);
    setSaved(true);
    setIsOpen(false);
    localCache.set(userId, cacheKey(date), newHours);
    // Also update the sleep_logs array cache so the Sleep chart page renders instantly
    const existing = localCache.get<{ date: string; hours: number }[]>(userId, "sleep_logs") ?? [];
    const idx = existing.findIndex((r) => r.date === date);
    const updated =
      idx >= 0
        ? existing.map((r, i) => (i === idx ? { ...r, hours: newHours } : r))
        : [...existing, { date, hours: newHours }].sort((a, b) => a.date.localeCompare(b.date));
    localCache.set(userId, "sleep_logs", updated);
    window.dispatchEvent(new Event("sleep-logged"));
    triggerHapticSuccess();

    try {
      await logSleepMut({ date, hours: newHours });
    } catch (err: any) {
      logger.error("SleepLogger: save failed", err);
    } finally {
      setSaving(false);
    }
  }, [userId, draftHours, saving]);

  const adjustDraft = (delta: number) => {
    triggerHaptic(ImpactStyle.Light);
    setDraftHours((h) => Math.min(MAX_HOURS, Math.max(MIN_HOURS, Math.round((h + delta) * 10) / 10)));
  };

  // Compact widget — square card matching the Weight metric card layout.
  const trigger = compact ? (
    <button
      type="button"
      className={cn("card-surface card-glow rounded-2xl p-3 aspect-square flex flex-col text-left active:scale-[0.98] transition-all w-full", className)}
      onClick={() => { triggerHaptic(ImpactStyle.Light); navigate("/sleep"); }}
    >
      {/* Header — eyebrow label only */}
      <span className="text-micro font-normal uppercase tracking-[0.08em] text-muted-foreground">
        SLEEP
      </span>

      {/* Value */}
      <div className="mt-2 flex items-baseline gap-1">
        {saved ? (
          <>
            <span className="font-display font-bold text-[40px] leading-none text-foreground tabular-nums">
              {hours}
            </span>
            <span className="text-note font-light text-muted-foreground">h</span>
          </>
        ) : (
          <span className="text-note font-medium text-muted-foreground">Tap to log</span>
        )}
      </div>

      <div className="flex-1" />

      {/* Footer — label left, chevron right */}
      <div className="flex items-center justify-between">
        <p className="text-micro text-muted-foreground">Last night</p>
        <Icon name="chevronForwardOutline" size={14} className="text-muted-foreground/40" />
      </div>
    </button>
  ) : (
    <button
      type="button"
      className="card-surface card-glow rounded-2xl p-3 sm:p-4 w-full flex items-center gap-3 active:scale-[0.98] transition-all duration-200 text-left"
      onClick={openSheet}
    >
      <Icon name="moonOutline" size={20} className="text-primary flex-shrink-0" />
      {saved ? (
        <>
          <span className="text-sm font-semibold flex-1">
            <span className="tabular-nums">{hours}</span>
            <span className="text-muted-foreground">h</span>
          </span>
          <Icon name="checkmarkOutline" size={16} className="text-func-recovery-green flex-shrink-0" />
        </>
      ) : (
        <>
          <span className="text-sm font-medium text-muted-foreground flex-1">Log Sleep</span>
          <Icon name="chevronForwardOutline" size={16} className="text-muted-foreground/40 flex-shrink-0" />
        </>
      )}
    </button>
  );

  return (
    <>
      {trigger}
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] [&>button]:hidden flex flex-col max-h-[85vh]"
        >
          <div className="flex justify-center pt-1 pb-2 shrink-0">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/25" aria-hidden />
          </div>
          {/* Header with always-visible Save pill on the right */}
          <div className="flex items-center justify-between px-1 pb-3 shrink-0 gap-2">
            <SheetHeader className="text-left flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <Icon name="moonOutline" size={16} className="text-primary" />
                <SheetTitle className="text-base font-semibold">Sleep</SheetTitle>
              </div>
              <p className="text-note text-muted-foreground truncate">
                How long did you sleep last night?
              </p>
            </SheetHeader>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="h-9 px-4 rounded-full bg-primary text-primary-foreground text-note font-semibold active:scale-[0.95] transition-transform disabled:opacity-40 flex-shrink-0"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            {/* Explicit close — Radix's X is suppressed via `[&>button]:hidden`,
                so without this the only dismiss is the drag handle. Matches
                CutPlanDialog's close-button pattern. */}
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Close sleep logger"
              className="h-9 w-9 rounded-full flex items-center justify-center text-muted-foreground/80 bg-muted/40 dark:bg-white/[0.06] border border-border/30 active:text-foreground active:bg-muted/60 transition-colors flex-shrink-0"
            >
              <Icon name="closeOutline" size={16} />
            </button>
          </div>

          {/* Big-typography stepper — feels deliberate, not cramped */}
          <div className="flex items-center justify-center gap-6 py-3 shrink-0">
            <button
              type="button"
              className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center active:bg-muted/70 active:scale-95 transition-all disabled:opacity-30"
              onClick={() => adjustDraft(-STEP)}
              disabled={draftHours <= MIN_HOURS}
              aria-label="Decrease hours"
            >
              <Icon name="removeOutline" size={20} />
            </button>
            <div className="flex items-baseline gap-1 min-w-[88px] justify-center">
              <span className="text-[44px] font-bold tabular-nums leading-none tracking-tight">
                {draftHours}
              </span>
              <span className="text-value text-muted-foreground font-medium">h</span>
            </div>
            <button
              type="button"
              className="h-12 w-12 rounded-full bg-muted/50 flex items-center justify-center active:bg-muted/70 active:scale-95 transition-all disabled:opacity-30"
              onClick={() => adjustDraft(STEP)}
              disabled={draftHours >= MAX_HOURS}
              aria-label="Increase hours"
            >
              <Icon name="addOutline" size={20} />
            </button>
          </div>

          {/* Quick-pick chips for common values */}
          <div className="flex flex-wrap justify-center gap-1.5 pb-3 shrink-0">
            {[6, 7, 7.5, 8, 8.5, 9].map((preset) => {
              const active = draftHours === preset;
              return (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    triggerHaptic(ImpactStyle.Light);
                    setDraftHours(preset);
                  }}
                  className={`px-3 h-8 rounded-full text-note font-medium tabular-nums transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/40 text-muted-foreground active:bg-muted/60"
                  }`}
                >
                  {preset}h
                </button>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
});
