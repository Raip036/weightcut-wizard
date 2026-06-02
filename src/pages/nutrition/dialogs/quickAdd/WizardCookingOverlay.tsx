import { useEffect, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Sparkles } from "lucide-react";
import wizardImg from "@/assets/thoughtful_wizard.png";

interface WizardCookingOverlayProps {
  /** User's typed meal description, shown below the wizard for context. */
  description: string;
  /** Optional cancel handler — renders a small "Cancel" affordance below. */
  onCancel?: () => void;
}

const CAPTIONS = [
  "Reading your meal…",
  "Picking ingredients…",
  "Calculating macros…",
  "Almost ready…",
] as const;
const CAPTION_INTERVAL_MS = 1600;

const INGREDIENTS = ["🍗", "🍚", "🥦", "🫒", "🥚"] as const;
const INGREDIENT_INTERVAL_MS = 700;

/** Position + delay tuple for the rim sparkles. */
const SPARKLE_POSITIONS: Array<{ className: string; delay: number; size: number }> = [
  { className: "absolute -top-2 left-4", delay: 0, size: 14 },
  { className: "absolute -top-3 right-6", delay: 0.6, size: 16 },
  { className: "absolute top-1 right-2", delay: 1.1, size: 12 },
  { className: "absolute -top-1 left-1/2 -translate-x-1/2", delay: 0.3, size: 14 },
];

/**
 * Wizard cooking-pot loading overlay for the text-only "Add a meal" path.
 *
 * Layout (top → bottom):
 *   - Wizard mascot (3D render), gently stirring (±3° rotation)
 *   - Stylized cauldron with glowing interior + cycling ingredient emojis
 *   - 4 sparkles twinkling around the pot's rim at staggered delays
 *   - Caption rotator (cross-fade between 4 strings)
 *   - User's description, italicized + 2-line clamp
 *   - Optional ghost Cancel button
 *
 * Respects `useReducedMotion`: rotation is disabled, ingredient/caption
 * transitions become instant fades, but the loops still progress so the user
 * has a sense of activity.
 */
export function WizardCookingOverlay({ description, onCancel }: WizardCookingOverlayProps): JSX.Element {
  const prefersReduced = useReducedMotion();
  const [captionIdx, setCaptionIdx] = useState(0);
  const [ingredientIdx, setIngredientIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(
      () => setCaptionIdx((s) => (s + 1) % CAPTIONS.length),
      CAPTION_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(
      () => setIngredientIdx((s) => (s + 1) % INGREDIENTS.length),
      INGREDIENT_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, []);

  const fadeDuration = prefersReduced ? 0 : 0.35;

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-6 px-4">
      {/* Wizard mascot — subtle stirring rotation. */}
      <motion.img
        src={wizardImg}
        alt="Wizard cooking your meal"
        className="w-[130px] h-[130px] object-contain select-none pointer-events-none"
        draggable={false}
        animate={prefersReduced ? undefined : { rotate: [-3, 3, -3] }}
        transition={
          prefersReduced
            ? undefined
            : { duration: 2, ease: "easeInOut", repeat: Infinity }
        }
        style={{ transformOrigin: "50% 80%" }}
      />

      {/* Cauldron — relative anchor for sparkles + glow + ingredient. */}
      <div className="relative">
        {/* Sparkles around the rim, twinkling independently. `z-20` keeps
            them painted IN FRONT of the pot body (which sits at the default
            stacking level) — otherwise, as earlier siblings, they'd render
            behind it. `drop-shadow` makes them pop against the pot glow. */}
        {SPARKLE_POSITIONS.map((s, i) => (
          <motion.div
            key={i}
            aria-hidden
            className={`${s.className} z-20 text-amber-300 drop-shadow-[0_0_6px_rgba(251,191,36,0.55)]`}
            animate={prefersReduced ? { opacity: 0.7 } : { opacity: [0.2, 1, 0.2], scale: [0.85, 1.05, 0.85] }}
            transition={
              prefersReduced
                ? { duration: 0 }
                : { duration: 1.8, ease: "easeInOut", repeat: Infinity, delay: s.delay }
            }
          >
            <Sparkles size={s.size} strokeWidth={2.25} />
          </motion.div>
        ))}

        {/* Pot body. */}
        <div
          className="relative w-[180px] h-[110px] rounded-2xl overflow-hidden ring-1 ring-border/60 bg-gradient-to-b from-card to-background shadow-inner"
        >
          {/* Pulsing internal glow (primary → amber). */}
          <motion.div
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse at 50% 75%, hsl(var(--primary) / 0.55) 0%, rgb(251 191 36 / 0.35) 40%, transparent 75%)",
            }}
            animate={prefersReduced ? { opacity: 0.6 } : { opacity: [0.5, 0.95, 0.5] }}
            transition={
              prefersReduced
                ? { duration: 0 }
                : { duration: 2, ease: "easeInOut", repeat: Infinity }
            }
          />

          {/* Ingredient cycling inside the pot. */}
          <div className="absolute inset-0 flex items-center justify-center">
            <AnimatePresence mode="wait">
              <motion.span
                key={ingredientIdx}
                className="text-4xl"
                initial={{ opacity: 0, y: prefersReduced ? 0 : -8, scale: prefersReduced ? 1 : 0.85 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: prefersReduced ? 0 : 10, scale: prefersReduced ? 1 : 0.85 }}
                transition={{ duration: fadeDuration, ease: "easeOut" }}
              >
                {INGREDIENTS[ingredientIdx]}
              </motion.span>
            </AnimatePresence>
          </div>

          {/* Rim highlight to read as a pot. */}
          <div
            aria-hidden
            className="absolute top-0 inset-x-0 h-2 bg-gradient-to-b from-foreground/15 to-transparent"
          />
        </div>
      </div>

      {/* Caption rotator. */}
      <div className="h-5 flex items-center justify-center" aria-live="polite">
        <AnimatePresence mode="wait">
          <motion.p
            key={captionIdx}
            className="text-[14px] font-medium text-foreground text-center"
            initial={{ opacity: 0, y: prefersReduced ? 0 : 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: prefersReduced ? 0 : -4 }}
            transition={{ duration: fadeDuration, ease: "easeOut" }}
          >
            {CAPTIONS[captionIdx]}
          </motion.p>
        </AnimatePresence>
      </div>

      {/* User's typed description, quoted + truncated. */}
      {description.trim().length > 0 && (
        <p className="text-[12px] italic text-muted-foreground text-center max-w-[260px] line-clamp-2">
          “{description}”
        </p>
      )}

      {/* Optional cancel affordance. */}
      {onCancel && (
        <button
          type="button"
          onClick={onCancel}
          className="mt-1 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          Cancel
        </button>
      )}
    </div>
  );
}
