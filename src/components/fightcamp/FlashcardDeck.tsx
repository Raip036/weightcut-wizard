import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { Check, RotateCw, Trophy, X } from "lucide-react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { triggerHaptic, triggerHapticSuccess } from "@/lib/haptics";
import { logger } from "@/lib/logger";
import { Flashcard } from "./Flashcard";

// The `training_summary_cards` API surface is built by a sibling agent; the
// generated types may not include it yet, so we narrow to the minimum we
// need locally. Once Convex regenerates, this can be swapped for
// `Doc<"training_summary_cards">` directly.
export interface FlashcardRow {
  _id: Id<"training_summary_cards"> | string;
  sport: string;
  front: string;
  back: string;
  cue?: string;
  intervalDays?: number;
  dueAt?: number;
  reviews?: number;
  lapses?: number;
}

interface FlashcardDeckProps {
  cards: FlashcardRow[];
  /** When true, hide Got/Forgot — the deck is purely for browsing a past week. */
  readOnly?: boolean;
}

export function FlashcardDeck({ cards, readOnly = false }: FlashcardDeckProps) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [pending, setPending] = useState(false);
  // Burst animation state — fires a transient green check overlay every
  // time the user taps "Got it". `burstKey` re-keys the overlay node so
  // the CSS animation replays cleanly on repeat presses.
  const [burstKey, setBurstKey] = useState(0);
  const [showBurst, setShowBurst] = useState(false);
  const burstTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (burstTimerRef.current) clearTimeout(burstTimerRef.current);
    },
    [],
  );

  // The backend may not be deployed yet in dev; cast through `any` and fall
  // back to a benign mutation (deleteSummary) so `useMutation(undefined)`
  // doesn't blow up if `convex/training_summary_cards.ts` hasn't been
  // regenerated into the api types yet. We only invoke the mutation when
  // the real one is present (see `cardApis?.recallCard` guard below).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cardApis = (api as any).training_summary_cards as undefined | Record<string, unknown>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fallbackMut = (api as any).fight_camp.deleteSummary;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recallCardMut = useMutation((cardApis?.recallCard as any) ?? fallbackMut);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const forgetCardMut = useMutation((cardApis?.forgetCard as any) ?? fallbackMut);
  const recallCard = cardApis?.recallCard ? recallCardMut : null;
  const forgetCard = cardApis?.forgetCard ? forgetCardMut : null;

  // Clamp the index in case the deck shrinks (e.g. a card was reviewed and
  // moved out via getDueToday subscription).
  useEffect(() => {
    if (currentIndex > cards.length) {
      setCurrentIndex(cards.length);
      setIsFlipped(false);
    }
  }, [cards.length, currentIndex]);

  // Reset flip state whenever the active card changes.
  useEffect(() => {
    setIsFlipped(false);
  }, [currentIndex]);

  if (cards.length === 0) {
    return null;
  }

  const isComplete = currentIndex >= cards.length;
  const current = !isComplete ? cards[currentIndex] : null;

  const advance = () => {
    setCurrentIndex(idx => idx + 1);
  };

  const handleGot = async () => {
    if (!current || pending) return;
    setPending(true);

    // Fire the burst overlay + success haptic immediately so the user
    // feels the reward the instant they tap. Mutation runs in parallel.
    setBurstKey((k) => k + 1);
    setShowBurst(true);
    void triggerHapticSuccess();
    if (burstTimerRef.current) clearTimeout(burstTimerRef.current);
    burstTimerRef.current = setTimeout(() => setShowBurst(false), 550);

    try {
      if (recallCard) {
        await recallCard({ cardId: current._id as Id<"training_summary_cards"> });
      }
    } catch (err) {
      logger.error("recallCard failed", err);
    }
    // Let the burst breathe before swapping in the next card — the
    // dopamine moment is the animation, so don't cut it short.
    await new Promise((r) => setTimeout(r, 380));
    setPending(false);
    advance();
  };

  const handleForgot = async () => {
    if (!current || pending) return;
    setPending(true);
    try {
      if (forgetCard) {
        await forgetCard({ cardId: current._id as Id<"training_summary_cards"> });
      }
      void triggerHaptic();
    } catch (err) {
      logger.error("forgetCard failed", err);
    } finally {
      setPending(false);
      advance();
    }
  };

  if (isComplete) {
    return (
      <div className="space-y-3">
        <div
          className="card-surface rounded-xs border border-border/60 px-5 py-6 flex flex-col items-center justify-center gap-3"
          style={{ minHeight: "200px" }}
        >
          <div className="h-10 w-10 rounded-full bg-primary/15 flex items-center justify-center">
            <Trophy className="h-5 w-5 text-primary" />
          </div>
          <p className="text-body-sm font-semibold text-foreground">All cards reviewed!</p>
          <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-primary/15 border border-primary/30 text-[10px] uppercase tracking-wider font-bold text-primary">
            Deck complete
          </span>
          <button
            type="button"
            onClick={() => {
              setCurrentIndex(0);
              setIsFlipped(false);
            }}
            className="inline-flex items-center gap-1.5 text-note font-medium text-primary hover:text-primary/80 transition-colors px-2 py-2 rounded-xs min-h-[44px]"
          >
            <RotateCw className="h-3.5 w-3.5" />
            Back to top
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="relative space-y-3">
      {current ? (
        <Flashcard
          front={current.front}
          back={current.back}
          cue={current.cue}
          sport={current.sport}
          isFlipped={isFlipped}
          onFlip={() => setIsFlipped(f => !f)}
        />
      ) : null}

      {/* Progress dots — "{n} of {total}" + tap-targets-be-damned tiny dots */}
      <div className="flex items-center justify-center gap-2">
        <span className="text-micro uppercase tracking-wider text-muted-foreground/70 font-bold tabular-nums">
          {currentIndex + 1} of {cards.length}
        </span>
        <div className="flex items-center gap-1">
          {cards.map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 w-1.5 rounded-full transition-colors",
                i === currentIndex
                  ? "bg-primary"
                  : i < currentIndex
                    ? "bg-muted-foreground/40"
                    : "bg-muted-foreground/15"
              )}
            />
          ))}
        </div>
      </div>

      {/* Action buttons appear only after the user has flipped to the answer. */}
      {!readOnly && isFlipped && current ? (
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={handleForgot}
            disabled={pending}
            className={cn(
              "min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xs border border-border/60 bg-muted/30 text-foreground text-note font-bold transition-colors active:bg-muted/50 disabled:opacity-50"
            )}
          >
            <X className="h-4 w-4" />
            Forgot
          </button>
          <button
            type="button"
            onClick={handleGot}
            disabled={pending}
            className={cn(
              "min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xs bg-func-recovery-green text-background text-note font-bold",
              "transition-transform active:scale-95 disabled:opacity-50",
              "shadow-[0_0_0_0_hsl(var(--func-recovery-green)/0.4)]",
            )}
          >
            <Check className="h-4 w-4" strokeWidth={3} />
            Got it
          </button>
        </div>
      ) : null}

      {/* Burst overlay — fires on every Got it tap. Animates a green check
          ring zooming up + a pulsing halo so the user gets a sharp dopamine
          confirmation before the next card slides in. */}
      {showBurst ? (
        <div
          key={burstKey}
          className="pointer-events-none absolute inset-0 flex items-center justify-center z-20"
          aria-hidden
        >
          <div className="relative animate-in zoom-in-50 fade-in duration-300 ease-out">
            <span className="absolute inset-0 rounded-full bg-func-recovery-green/40 animate-ping" />
            <div className="relative h-24 w-24 rounded-full bg-func-recovery-green flex items-center justify-center shadow-2xl">
              <Check className="h-12 w-12 text-background" strokeWidth={3.5} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
