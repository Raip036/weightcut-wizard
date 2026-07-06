// T17: ReadinessFlexSheet, the bottom-sheet trigger for the ReadinessFlexCard
// share template. Mirrors the existing share-trigger pattern (ShareCardDialog
// + useShareCard) but as a Sheet rather than a Dialog so the caption input
// composes naturally with the iOS keyboard. Owns:
//
//   1. Free-tier weekly rate-limit gate (1 card / ISO-week) keyed by user id
//      so multiple users on one device don't share quota.
//   2. Caption text input (optional, capped at 60 chars to match the card).
//   3. Scaled preview of the ReadinessFlexCard rendered to a hidden full-size
//      canvas off-screen, the same approach ShareCardDialog uses so the export
//      stays at 1080×1920 regardless of the on-screen preview width.
//   4. Share + Save-to-photos buttons backed by `useShareCard`.
//
// Spec reference: docs/superpowers/specs/2026-06-01-recovery-page-redesign-design.md
// §7.3.a.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Share2, Download, Loader2, Sparkles } from "lucide-react";
import { format, startOfWeek } from "date-fns";
import { useShareCard } from "@/hooks/useShareCard";
import { useSubscription } from "@/hooks/useSubscription";
import { useToast } from "@/hooks/use-toast";
import { ReadinessFlexCard, type ReadinessTone } from "./ReadinessFlexCard";
import type { AspectRatio } from "../templates/CardShell";

interface ReadinessFlexSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  date: Date;
  readiness: number;
  pillars: { recovery: number | null; body: number | null; load: number | null };
  tone: ReadinessTone;
  /** Display name / handle from UserContext, rendered on the watermark
   *  row when the user is on the free tier. Optional. */
  userHandle?: string;
}

// Render at full source size; the preview just scales it down. Mirrors the
// constants in ShareCardDialog so the export resolution stays consistent
// across the share-card family.
const CARD_W = 1080;
const CARD_H_STORY = 1920;
const ASPECT: AspectRatio = "story";

// Visible preview budget: keeps the Share / Save buttons above the iOS
// keyboard even when the caption input is focused.
const MAX_PREVIEW_H = 300;

const FREE_WEEKLY_LIMIT = 1;

// localStorage key: ISO date of the week's Monday, namespaced per user so
// signing in as a second account on the same device doesn't inherit the
// previous user's quota.
function weekKey(userId: string, today: Date): string {
  const weekStart = startOfWeek(today, { weekStartsOn: 1 });
  return `flex-card-week:${userId}:${format(weekStart, "yyyy-MM-dd")}`;
}

function readWeeklyCount(userId: string, today: Date): number {
  try {
    const raw = localStorage.getItem(weekKey(userId, today));
    const n = raw == null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function bumpWeeklyCount(userId: string, today: Date): void {
  try {
    const k = weekKey(userId, today);
    const next = readWeeklyCount(userId, today) + 1;
    localStorage.setItem(k, String(next));
  } catch {
    /* localStorage unavailable: fail open, no gate enforcement */
  }
}

export function ReadinessFlexSheet({
  open,
  onOpenChange,
  userId,
  date,
  readiness,
  pillars,
  tone,
  userHandle,
}: ReadinessFlexSheetProps) {
  const { isPremium, openPaywall } = useSubscription();
  const { toast } = useToast();
  const { cardRef, isCapturing, captureAndShare, captureAndDownload } = useShareCard();

  // Background variation: solid (default) or transparent (for overlaying the
  // card on a photo/story).
  const [transparent, setTransparent] = useState(false);

  // Recompute the gate on every open so a card shared in a previous app
  // session updates correctly. The user expects "I shared this morning,
  // tonight's locked" to hold even after a relaunch.
  const today = useMemo(() => new Date(), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const usedThisWeek = readWeeklyCount(userId, today);
  const locked = !isPremium && usedThisWeek >= FREE_WEEKLY_LIMIT;

  // Reset the background choice when the sheet closes.
  useEffect(() => {
    if (!open) setTransparent(false);
  }, [open]);

  // Preview scale: fit the source 1080×1920 card into the preview budget.
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ w: 200, h: MAX_PREVIEW_H, scale: 0.16 });

  const recalc = useCallback(() => {
    if (!wrapperRef.current) return;
    const containerW = wrapperRef.current.clientWidth;
    const scaleByW = containerW / CARD_W;
    const scaleByH = MAX_PREVIEW_H / CARD_H_STORY;
    const scale = Math.min(scaleByW, scaleByH);
    setDims({
      w: Math.round(CARD_W * scale),
      h: Math.round(CARD_H_STORY * scale),
      scale,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(recalc, 30);
    return () => clearTimeout(t);
  }, [open, recalc]);

  const handleShare = useCallback(async () => {
    if (locked) {
      // Defensive: the buttons are hidden when locked, but if a future
      // refactor ever wires Share directly, still refuse + surface paywall.
      toast({
        title: "Weekly limit reached",
        description: "Upgrade for unlimited flex cards.",
      });
      openPaywall("readiness_flex");
      return;
    }
    await captureAndShare(
      "I'm ready today.",
      `Readiness ${Math.round(readiness)}, built with FightCamp Wizard`,
      transparent,
      "readiness",
    );
    if (!isPremium) bumpWeeklyCount(userId, today);
  }, [
    captureAndShare,
    readiness,
    isPremium,
    userId,
    today,
    locked,
    openPaywall,
    toast,
    transparent,
  ]);

  const handleDownload = useCallback(async () => {
    if (locked) {
      toast({
        title: "Weekly limit reached",
        description: "Upgrade for unlimited flex cards.",
      });
      openPaywall("readiness_flex");
      return;
    }
    await captureAndDownload(`readiness-${format(date, "yyyy-MM-dd")}.png`, transparent, "readiness");
    if (!isPremium) bumpWeeklyCount(userId, today);
  }, [
    captureAndDownload,
    date,
    isPremium,
    userId,
    today,
    locked,
    openPaywall,
    toast,
    transparent,
  ]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl p-0 max-h-[92vh] overflow-y-auto"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)" }}
      >
        <SheetHeader className="px-5 pt-4 pb-2 text-left">
          <SheetTitle className="text-[18px] font-bold tracking-tight">
            Flex today
          </SheetTitle>
        </SheetHeader>

        <div className="px-5 pb-5 space-y-4">
          {locked ? (
            // ── Locked state ───────────────────────────────────────────
            // Free + already shared this week → swap the card preview /
            // CTA stack for an upgrade prompt. The card preview is hidden
            // entirely (vs greyed) because rendering it at scale during
            // an upsell wastes layout the upgrade copy needs.
            <div className="rounded-2xl border border-primary/30 p-4 bg-primary/5 flex flex-col items-center text-center gap-3">
              <Sparkles className="h-6 w-6 text-primary" aria-hidden />
              <div className="text-[14px] font-semibold text-foreground leading-snug max-w-[34ch]">
                You've used this week's free flex card.
              </div>
              <div className="text-[12px] text-muted-foreground leading-snug max-w-[34ch]">
                Upgrade for unlimited shares without the watermark.
              </div>
              <button
                type="button"
                onClick={() => openPaywall("readiness_flex")}
                className="mt-1 inline-flex items-center justify-center gap-2 h-9 px-5 rounded-full bg-primary text-primary-foreground text-[13px] font-semibold transition-opacity active:opacity-80"
              >
                Upgrade
              </button>
            </div>
          ) : (
            <>
              {/* ── Background toggle: solid / transparent ───────────── */}
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Background
                </span>
                <div className="inline-flex w-full rounded-full bg-muted p-1">
                  {([
                    { key: false, label: "Solid" },
                    { key: true, label: "Transparent" },
                  ] as const).map((opt) => (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => setTransparent(opt.key)}
                      className={`flex-1 h-8 rounded-full text-[12px] font-semibold transition-colors ${
                        transparent === opt.key
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Preview ──────────────────────────────────────────── */}
              <div ref={wrapperRef} className="w-full flex justify-center">
                <div
                  className="overflow-hidden rounded-xl border border-border/50"
                  style={{
                    width: dims.w,
                    height: dims.h,
                    // Transparent variant: show a sample backdrop so the
                    // see-through card is visible; solid renders on black.
                    background: transparent
                      ? "linear-gradient(160deg, #1e3a5f 0%, #0c1219 50%, #2a1414 100%)"
                      : "#000000",
                  }}
                >
                  <div
                    style={{
                      transform: `scale(${dims.scale})`,
                      transformOrigin: "top left",
                      width: CARD_W,
                      height: CARD_H_STORY,
                    }}
                  >
                    <ReadinessFlexCard
                      ref={cardRef}
                      date={date}
                      readiness={readiness}
                      pillars={pillars}
                      tone={tone}
                      userHandle={userHandle}
                      isPro={isPremium}
                      transparent={transparent}
                      aspect={ASPECT}
                    />
                  </div>
                </div>
              </div>

              {/* Free-tier counter: quiet hint, not a paywall blast. */}
              {!isPremium && (
                <div className="text-[11px] text-center text-muted-foreground/70">
                  {FREE_WEEKLY_LIMIT - usedThisWeek} of {FREE_WEEKLY_LIMIT} free
                  share{FREE_WEEKLY_LIMIT === 1 ? "" : "s"} left this week
                </div>
              )}

              {/* ── Action buttons ───────────────────────────────────── */}
              <div className="flex items-center justify-center gap-3 pt-1">
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={isCapturing}
                  className="inline-flex items-center justify-center gap-2 h-10 px-4 rounded-full bg-muted text-foreground text-[13px] font-semibold transition-opacity active:opacity-80 disabled:opacity-60"
                >
                  {isCapturing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Download className="h-3.5 w-3.5" />
                  )}
                  Save
                </button>
                <button
                  type="button"
                  onClick={handleShare}
                  disabled={isCapturing}
                  className="inline-flex items-center justify-center gap-2 h-10 px-6 rounded-full bg-primary text-primary-foreground text-[13px] font-semibold transition-opacity active:opacity-80 disabled:opacity-60"
                >
                  {isCapturing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Share2 className="h-3.5 w-3.5" />
                  )}
                  Share
                </button>
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
