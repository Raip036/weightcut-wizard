// T18: ComebackSheet — bottom-sheet trigger for the ComebackCard share
// template. Mirrors ReadinessFlexSheet's shape (caption input, scaled
// preview, Share / Save buttons backed by useShareCard) so the entire
// share-card-trigger family stays uniform.
//
// Owns:
//   1. Free-tier monthly rate-limit gate (1 card / calendar month) keyed
//      by user id so multiple users on one device don't share quota.
//   2. Caption text input (optional, capped at 80 chars to match the card).
//   3. Scaled preview of the ComebackCard rendered to a hidden full-size
//      canvas off-screen — same approach as ReadinessFlexSheet so the
//      export stays at 1080×1920 regardless of preview width.
//   4. Share + Save buttons via `useShareCard`.
//
// Spec reference: docs/superpowers/specs/2026-06-01-recovery-page-redesign-design.md
// §7.3.b.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Share2, Download, Loader2, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { useShareCard } from "@/hooks/useShareCard";
import { useSubscription } from "@/hooks/useSubscription";
import { useToast } from "@/hooks/use-toast";
import { ComebackCard } from "./ComebackCard";
import type { AspectRatio } from "../templates/CardShell";

interface ComebackSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  oldDate: Date;
  oldScore: number;
  newDate: Date;
  newScore: number;
  protocolsCompleted: number;
  /** Display name / handle from UserContext. Free-tier only. */
  userHandle?: string;
}

// Mirrors ShareCardDialog / ReadinessFlexSheet — source-size 1080×1920
// rendered off-screen, scaled into the preview budget.
const CARD_W = 1080;
const CARD_H_STORY = 1920;
const ASPECT: AspectRatio = "story";

const MAX_PREVIEW_H = 300;

const CAPTION_MAX = 80;
const FREE_MONTHLY_LIMIT = 1;

// localStorage key — "YYYY-MM" of today's month, namespaced per user so
// account-switching on one device doesn't inherit the previous user's
// quota. Spec §7.3.b mandates the exact shape: `comeback-card-month:${userId}:${YYYY-MM}`.
function monthKey(userId: string, today: Date): string {
  return `comeback-card-month:${userId}:${format(today, "yyyy-MM")}`;
}

function readMonthlyCount(userId: string, today: Date): number {
  try {
    const raw = localStorage.getItem(monthKey(userId, today));
    const n = raw == null ? 0 : Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function bumpMonthlyCount(userId: string, today: Date): void {
  try {
    const k = monthKey(userId, today);
    const next = readMonthlyCount(userId, today) + 1;
    localStorage.setItem(k, String(next));
  } catch {
    /* localStorage unavailable — fail open, no gate enforcement */
  }
}

export function ComebackSheet({
  open,
  onOpenChange,
  userId,
  oldDate,
  oldScore,
  newDate,
  newScore,
  protocolsCompleted,
  userHandle,
}: ComebackSheetProps) {
  const { isPremium, openPaywall } = useSubscription();
  const { toast } = useToast();
  const { cardRef, isCapturing, captureAndShare, captureAndDownload } = useShareCard();

  const [caption, setCaption] = useState("");

  // Recompute the gate on every open so a card shared earlier this month
  // updates correctly across relaunches. Same pattern as ReadinessFlexSheet.
  const today = useMemo(() => new Date(), [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const usedThisMonth = readMonthlyCount(userId, today);
  const locked = !isPremium && usedThisMonth >= FREE_MONTHLY_LIMIT;

  // Clear caption on close so it doesn't bleed into the next open. Preserve
  // mid-session so an accidental blur doesn't lose typing.
  useEffect(() => {
    if (!open) setCaption("");
  }, [open]);

  // Preview scale — fit the 1080×1920 source into the preview budget.
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

  const deltaCopy = `+${Math.round(newScore - oldScore)} in 48h`;

  const handleShare = useCallback(async () => {
    if (locked) {
      // Defensive — buttons are hidden when locked, but if a future
      // refactor wires Share directly, still refuse + surface paywall.
      toast({
        title: "Monthly limit reached",
        description: "Upgrade for unlimited comeback cards.",
      });
      openPaywall();
      return;
    }
    await captureAndShare(
      "Comeback.",
      `${deltaCopy} — built with FightCamp Wizard`,
    );
    if (!isPremium) bumpMonthlyCount(userId, today);
  }, [
    captureAndShare,
    deltaCopy,
    isPremium,
    userId,
    today,
    locked,
    openPaywall,
    toast,
  ]);

  const handleDownload = useCallback(async () => {
    if (locked) {
      toast({
        title: "Monthly limit reached",
        description: "Upgrade for unlimited comeback cards.",
      });
      openPaywall();
      return;
    }
    await captureAndDownload(`comeback-${format(newDate, "yyyy-MM-dd")}.png`);
    if (!isPremium) bumpMonthlyCount(userId, today);
  }, [
    captureAndDownload,
    newDate,
    isPremium,
    userId,
    today,
    locked,
    openPaywall,
    toast,
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
            Share your comeback
          </SheetTitle>
        </SheetHeader>

        <div className="px-5 pb-5 space-y-4">
          {locked ? (
            // ── Locked state ───────────────────────────────────────────
            // Free + already shared this month → swap card preview / CTA
            // for an upgrade prompt. Card is hidden (not greyed) so the
            // upgrade copy gets the real estate it needs.
            <div className="rounded-2xl border border-primary/30 p-4 bg-primary/5 flex flex-col items-center text-center gap-3">
              <Sparkles className="h-6 w-6 text-primary" aria-hidden />
              <div className="text-[14px] font-semibold text-foreground leading-snug max-w-[34ch]">
                You've used this month's free comeback card.
              </div>
              <div className="text-[12px] text-muted-foreground leading-snug max-w-[34ch]">
                Upgrade for unlimited shares without the watermark.
              </div>
              <button
                type="button"
                onClick={openPaywall}
                className="mt-1 inline-flex items-center justify-center gap-2 h-9 px-5 rounded-full bg-primary text-primary-foreground text-[13px] font-semibold transition-opacity active:opacity-80"
              >
                Upgrade
              </button>
            </div>
          ) : (
            <>
              {/* ── Caption input ────────────────────────────────────── */}
              <div className="space-y-1.5">
                <label
                  htmlFor="comeback-caption"
                  className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground"
                >
                  Caption (optional)
                </label>
                <Textarea
                  id="comeback-caption"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value.slice(0, CAPTION_MAX))}
                  maxLength={CAPTION_MAX}
                  rows={2}
                  placeholder="I was cooked Sunday. Back in the lab."
                  className="resize-none text-[14px]"
                />
                <div className="text-[10px] text-muted-foreground/70 text-right tabular-nums">
                  {caption.length}/{CAPTION_MAX}
                </div>
              </div>

              {/* ── Preview ──────────────────────────────────────────── */}
              <div ref={wrapperRef} className="w-full flex justify-center">
                <div
                  className="overflow-hidden rounded-xl border border-border/50 bg-black"
                  style={{ width: dims.w, height: dims.h }}
                >
                  <div
                    style={{
                      transform: `scale(${dims.scale})`,
                      transformOrigin: "top left",
                      width: CARD_W,
                      height: CARD_H_STORY,
                    }}
                  >
                    <ComebackCard
                      ref={cardRef}
                      oldDate={oldDate}
                      oldScore={oldScore}
                      newDate={newDate}
                      newScore={newScore}
                      protocolsCompleted={protocolsCompleted}
                      caption={caption || undefined}
                      userHandle={userHandle}
                      isPro={isPremium}
                      aspect={ASPECT}
                    />
                  </div>
                </div>
              </div>

              {/* Free-tier counter — quiet hint, not a paywall blast. */}
              {!isPremium && (
                <div className="text-[11px] text-center text-muted-foreground/70">
                  {FREE_MONTHLY_LIMIT - usedThisMonth} of {FREE_MONTHLY_LIMIT} free
                  share{FREE_MONTHLY_LIMIT === 1 ? "" : "s"} left this month
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
