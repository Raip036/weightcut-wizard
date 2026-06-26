// T19: FightWeekFormSheet, the bottom-sheet trigger for the FightWeekFormCard
// share template. Mirrors ReadinessFlexSheet / ComebackSheet (scaled
// preview, Share + Save buttons backed by useShareCard) so the entire
// share-card-trigger family stays uniform.
//
// Differences vs the siblings:
//   - NO caption input. The card is the artifact; nothing to customize.
//   - NO rate limit. Fight week is an event, not a recurring action; the
//     toast already only fires once per camp (idempotency lives in the
//     useFightWeekTrigger hook). Watermark + handle are still gated on
//     subscription so Pro export stays clean.
//
// Spec reference: docs/superpowers/specs/2026-06-01-recovery-page-redesign-design.md
// §7.3.c.
import { useCallback, useEffect, useRef, useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Share2, Download, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useShareCard } from "@/hooks/useShareCard";
import { useSubscription } from "@/hooks/useSubscription";
import { FightWeekFormCard } from "./FightWeekFormCard";
import type { AspectRatio } from "../templates/CardShell";

interface FightWeekFormSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** ISO-resolved fight date, passed straight through to the card. */
  fightDate: Date;
  /** 0-7 inclusive; how many days until the fight. */
  daysOut: number;
  /** Oldest to newest; up to 5 entries. Nulls render as dim empty bars. */
  last5Days: Array<{ date: Date; score: number | null }>;
  /** Opponent display name / handle from the active camp. Optional;
   *  card omits the "vs …" piece gracefully when absent. */
  opponentHandle?: string;
  /** "@pratik", derived in the dashboard from UserContext. Free-tier only. */
  userHandle?: string;
}

// Source-size render at 1080×1920 to match the rest of the share-card
// family. The preview scales down, the export captures full size.
const CARD_W = 1080;
const CARD_H_STORY = 1920;
const ASPECT: AspectRatio = "story";

const MAX_PREVIEW_H = 300;

export function FightWeekFormSheet({
  open,
  onOpenChange,
  fightDate,
  daysOut,
  last5Days,
  opponentHandle,
  userHandle,
}: FightWeekFormSheetProps) {
  const { isPremium } = useSubscription();
  const { cardRef, isCapturing, captureAndShare, captureAndDownload } = useShareCard();

  // Preview scale: fit the 1080×1920 source into the preview budget.
  // Same pattern as ReadinessFlexSheet / ComebackSheet.
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

  const shareTitle = "Fight week.";
  const shareText =
    daysOut <= 0
      ? "Fight day. Form locked in, built with FightCamp Wizard"
      : `${daysOut} days out. Form locked in, built with FightCamp Wizard`;

  const handleShare = useCallback(async () => {
    await captureAndShare(shareTitle, shareText, undefined, "fightweek");
  }, [captureAndShare, shareText]);

  const handleDownload = useCallback(async () => {
    await captureAndDownload(`fight-week-${format(fightDate, "yyyy-MM-dd")}.png`, undefined, "fightweek");
  }, [captureAndDownload, fightDate]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl p-0 max-h-[92vh] overflow-y-auto"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)" }}
      >
        <SheetHeader className="px-5 pt-4 pb-2 text-left">
          <SheetTitle className="text-[18px] font-bold tracking-tight">
            Share your form curve
          </SheetTitle>
        </SheetHeader>

        <div className="px-5 pb-5 space-y-4">
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
                <FightWeekFormCard
                  ref={cardRef}
                  fightDate={fightDate}
                  daysOut={daysOut}
                  last5Days={last5Days}
                  opponentHandle={opponentHandle}
                  userHandle={userHandle}
                  isPro={isPremium}
                  aspect={ASPECT}
                />
              </div>
            </div>
          </div>

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
        </div>
      </SheetContent>
    </Sheet>
  );
}
