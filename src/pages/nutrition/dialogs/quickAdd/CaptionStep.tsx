/**
 * CaptionStep — "Add detail" gate between photo capture and scan.
 *
 * After the user snaps a photo, BEFORE the scanning animation fires, they
 * land here. The captured image is rendered as a large square preview, a
 * textarea lets them add optional context ("2 scoops rice, grilled chicken
 * with marinade"), and an "Analyze →" CTA fires the AI flow. A
 * top-left "Retake" link clears the photo and goes back to the camera tile.
 *
 * Caption is optional — tapping Analyze with an empty textarea still works
 * and passes "" up to the analyze handler.
 *
 * Keyboard-aware: pads the bottom with the keyboard height so the Analyze
 * button never gets covered, and scrolls the textarea to viewport center
 * on focus.
 */
import { useEffect, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { triggerHapticSelection } from "@/lib/haptics";
import { useKeyboardAware } from "@/hooks/useKeyboardAware";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";

interface CaptionStepProps {
  /** Base64-encoded image data (no data: prefix) — passed up unchanged on Analyze. */
  imageBase64: string;
  /** Display URL for the preview (can be a `data:image/jpeg;base64,...` URL or object URL). */
  imagePreviewUrl: string;
  /** Current caption value (lifted to parent so it survives mode swaps). */
  description: string;
  /** Setter for the caption — parent stores in the shared aiMeal description. */
  onDescriptionChange: (next: string) => void;
  /** User confirmed — fire the analyze flow with the current description (may be ""). */
  onAnalyze: (description: string) => void;
  /** User wants to retake the photo — parent should re-open the camera. */
  onRetake: () => void;
  /** Optional extra angles of the same meal (multi-view accuracy boost). */
  extraPhotos?: string[];
  /** Capture another angle — appends to extraPhotos (max 2). */
  onAddAngle?: () => void;
  /** Remove a previously-added angle by index. */
  onRemoveAngle?: (idx: number) => void;
  /** Optional toast callback for voice-input errors. */
  onToast?: (args: { title: string; description?: string; variant?: "default" | "destructive" }) => void;
}

export function CaptionStep({
  imageBase64: _imageBase64,
  imagePreviewUrl,
  description,
  onDescriptionChange,
  onAnalyze,
  onRetake,
  extraPhotos = [],
  onAddAngle,
  onRemoveAngle,
  onToast,
}: CaptionStepProps) {
  const prefersReduced = useReducedMotion();
  const { keyboardHeight } = useKeyboardAware();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea up to ~4 lines as the user types. Resets to the
  // base height on each keystroke so deletions also shrink it.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const maxHeight = 6 * 24; // ~6 lines of 24px line-height as a safety ceiling
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [description]);

  // Voice input (reuse the same Web Speech hook as DescribeRow). Mic only
  // appears when the browser/runtime supports it; appends to the caption
  // rather than replacing it so the user can mix typing + dictation.
  const {
    isListening,
    isSupported: voiceSupported,
    startListening,
    stopListening,
    interimText,
  } = useSpeechRecognition({
    onTranscript: (text: string) =>
      onDescriptionChange(description ? `${description} ${text}` : text),
    onError: (error: string) =>
      onToast?.({ title: "Voice Input", description: error, variant: "destructive" }),
  });

  const handleAnalyze = () => {
    if (isListening) stopListening();
    triggerHapticSelection();
    onAnalyze(description.trim());
  };

  const handleRetake = () => {
    if (isListening) stopListening();
    triggerHapticSelection();
    onRetake();
  };

  const handleVoiceToggle = () => {
    triggerHapticSelection();
    if (isListening) stopListening();
    else startListening();
  };

  const handleFocus = () => {
    // Wait one frame so the keyboard begins its animation and visualViewport
    // resizes; then nudge the textarea to viewport center.
    requestAnimationFrame(() => {
      setTimeout(() => {
        textareaRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 200);
    });
  };

  return (
    <motion.div
      key="caption"
      initial={prefersReduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.22 }}
      className="px-5 pt-1 pb-5 space-y-4"
      style={{ paddingBottom: `${keyboardHeight}px` }}
    >
      {/* ── Retake link ─────────────────────────────────────────── */}
      <button
        type="button"
        onClick={handleRetake}
        className="inline-flex items-center gap-1 text-[13px] font-semibold text-muted-foreground active:text-foreground -ml-1 px-1 py-0.5 rounded-md transition-colors"
        aria-label="Retake photo"
      >
        <Icon name="chevronBackOutline" size={14} />
        Retake
      </button>

      {/* ── Photo preview ───────────────────────────────────────── */}
      <div className="relative w-full rounded-2xl overflow-hidden bg-muted/20" style={{ aspectRatio: "1 / 1" }}>
        <img
          src={imagePreviewUrl}
          alt="Captured meal"
          className="absolute inset-0 w-full h-full object-cover"
        />
        {/* Subtle bottom vignette so any UI we add on top reads cleanly. */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none bg-gradient-to-t from-black/15 via-transparent to-transparent"
        />
      </div>

      {/* ── Extra angles (optional, multi-view accuracy) ────────── */}
      {onAddAngle && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            {extraPhotos.map((p, i) => (
              <div key={i} className="relative">
                <img
                  src={`data:image/jpeg;base64,${p}`}
                  alt={`Angle ${i + 2}`}
                  className="h-12 w-12 rounded-xl object-cover border border-border/40"
                />
                <button
                  type="button"
                  onClick={() => onRemoveAngle?.(i)}
                  aria-label={`Remove angle ${i + 2}`}
                  className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-black/70 flex items-center justify-center backdrop-blur active:scale-95 transition-transform"
                >
                  <Icon name="closeOutline" size={11} className="text-white" />
                </button>
              </div>
            ))}
            {extraPhotos.length < 2 && (
              <button
                type="button"
                onClick={() => {
                  triggerHapticSelection();
                  onAddAngle();
                }}
                aria-label="Add another angle"
                className="h-12 w-12 rounded-xl border border-dashed border-border/60 bg-muted/20 flex items-center justify-center text-muted-foreground active:bg-muted/40 transition-colors"
              >
                <Icon name="addOutline" size={20} />
              </button>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground/70 px-0.5">
            {extraPhotos.length === 0
              ? "Add a side angle for sharper portion accuracy"
              : "Multiple angles help size portions more accurately"}
          </p>
        </div>
      )}

      {/* ── Hint label + textarea + voice mic ───────────────────── */}
      <div className="space-y-2">
        <p className="text-[10px] font-semibold tracking-[0.08em] uppercase text-muted-foreground/70">
          Add detail (optional)
        </p>
        <div className="flex items-start gap-2">
          <textarea
            ref={textareaRef}
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            onFocus={handleFocus}
            placeholder={
              isListening ? "Listening…" : "e.g. 2 scoops rice, grilled chicken, marinade..."
            }
            rows={2}
            className={`flex-1 min-w-0 min-h-[64px] resize-none rounded-2xl bg-muted/40 dark:bg-white/[0.06] border border-border/30 text-[15px] leading-[1.5] text-foreground placeholder:text-muted-foreground/50 px-4 py-3 outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all ${
              isListening ? "ring-2 ring-func-danger-red/40" : ""
            }`}
            aria-label="Add detail about your meal (optional)"
          />
          {voiceSupported && (
            <button
              type="button"
              onClick={handleVoiceToggle}
              aria-label={isListening ? "Stop voice input" : "Voice input"}
              aria-pressed={isListening}
              className={`shrink-0 inline-flex items-center justify-center h-11 w-11 mt-0 rounded-2xl border border-border/40 transition-all active:scale-[0.96] ${
                isListening
                  ? "bg-func-danger-red/15 text-func-danger-red animate-pulse"
                  : "bg-muted/40 text-muted-foreground active:bg-muted/60"
              }`}
            >
              <Icon name={isListening ? "micOffOutline" : "micOutline"} size={18} />
            </button>
          )}
        </div>
        {isListening && interimText && (
          <p className="text-[12px] text-muted-foreground/70 italic px-1">{interimText}</p>
        )}
        <p className="text-[12px] text-muted-foreground/70 px-1">
          Helps the AI nail portion + ingredients
        </p>
      </div>

      {/* ── Analyze CTA ─────────────────────────────────────────── */}
      <button
        type="button"
        onClick={handleAnalyze}
        className="w-full h-12 rounded-2xl text-[15px] font-semibold bg-primary text-primary-foreground active:scale-[0.98] transition-transform"
      >
        <span className="inline-flex items-center gap-1.5">
          Analyze
          <Icon name="arrowForwardOutline" size={16} />
        </span>
      </button>
    </motion.div>
  );
}
