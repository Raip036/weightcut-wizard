import { cn } from "@/lib/utils";
import { disciplineToken, disciplineLabel } from "@/lib/coachColors";

interface FlashcardProps {
  front: string;
  back: string;
  cue?: string;
  sport: string;
  isFlipped: boolean;
  onFlip: () => void;
}

/**
 * Single flashcard with a CSS-3D flip animation.
 *
 * The outer button establishes a 3D perspective; the inner div carries the
 * `transform-style: preserve-3d` so its two child faces (`backface-visibility:
 * hidden`) sit on opposite sides of the rotation. Tap anywhere on the card
 * flips it via the parent-controlled `isFlipped` prop.
 */
export function Flashcard({ front, back, cue, sport, isFlipped, onFlip }: FlashcardProps) {
  const token = disciplineToken(sport);
  const label = disciplineLabel(sport);
  // Flat pill: muted surface, no gradient. The discipline identity is
  // carried only via the TEXT colour (matches the discipline's session
  // colour) so the label still reads as e.g. red for Muay Thai without
  // any neon glow.
  const pillStyle = {
    backgroundColor: "hsl(var(--muted) / 0.4)",
    color: `hsl(var(${token}))`,
    borderColor: "hsl(var(--border))",
  } as const;

  return (
    <button
      type="button"
      onClick={onFlip}
      aria-pressed={isFlipped}
      aria-label={isFlipped ? "Flip to question" : "Flip to answer"}
      className="block w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 rounded-xs"
      style={{ perspective: "1200px", minHeight: "200px" }}
    >
      <div
        className={cn(
          "relative w-full transition-transform duration-500 ease-[cubic-bezier(0.32,0.72,0,1)]"
        )}
        style={{
          transformStyle: "preserve-3d",
          transform: isFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
          height: "200px",
        }}
      >
        {/* FRONT FACE — the recall prompt */}
        <div
          className="absolute inset-0 card-surface rounded-xs border border-border/60 px-5 py-5 flex flex-col"
          style={{ backfaceVisibility: "hidden", WebkitBackfaceVisibility: "hidden" }}
        >
          <span
            className="self-start inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider"
            style={pillStyle}
          >
            {label}
          </span>
          <div className="flex-1 flex items-center justify-center px-2">
            <p className="text-body-sm font-semibold leading-snug text-foreground text-center">
              {front}
            </p>
          </div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-bold text-center">
            Tap to flip
          </p>
        </div>

        {/* BACK FACE — the answer + optional mnemonic cue */}
        <div
          className="absolute inset-0 card-surface rounded-xs border border-border/60 px-5 py-5 flex flex-col"
          style={{
            backfaceVisibility: "hidden",
            WebkitBackfaceVisibility: "hidden",
            transform: "rotateY(180deg)",
          }}
        >
          <span
            className="self-start inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider"
            style={pillStyle}
          >
            {label}
          </span>
          <div className="flex-1 flex flex-col items-center justify-center gap-2 px-2">
            <p className="text-body-sm text-foreground leading-snug text-center">{back}</p>
            {cue ? (
              <span
                className="inline-flex items-center px-2.5 py-1 rounded-full border text-[10px] uppercase tracking-wider font-bold"
                style={pillStyle}
              >
                {cue}
              </span>
            ) : null}
          </div>
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground/60 font-bold text-center">
            Tap to flip back
          </p>
        </div>
      </div>
    </button>
  );
}
