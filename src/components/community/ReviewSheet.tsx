/**
 * ReviewSheet — full-height bottom sheet shown after the photo-first
 * shutter fires. Spec: 2026-05-19 round-card photo-first tracking,
 * §3.3 (layout), §3.5–§3.6 (CTAs), §4 (developing polaroid).
 *
 * Pure presentational: never calls a Convex mutation. The parent owns
 * the `fight_camp.create` + `uploadSessionMediaV2` pipeline; this
 * component only emits a `ReviewDecision` or fires `onDiscard()`.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ImpactStyle } from "@capacitor/haptics";
import { ArrowRight, ChevronDown, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { triggerHaptic } from "@/lib/haptics";
import { PolaroidCard } from "@/components/community/PolaroidCard";
import type { Id } from "../../../convex/_generated/dataModel";

/* ── Public API ─────────────────────────────────────────────────── */

export interface ReviewSheetDefaults {
  gymId: Id<"gyms"> | null;
  gymName: string | null;
  sessionType: string;
  durationMinutes: number;
  intensity: string;
  intensityLevel: number;
  rpe: number;
}

export interface ReviewMeta {
  sessionType: string;
  durationMinutes: number;
  intensity: string;
  intensityLevel: number;
  rpe: number;
  caption: string;
  gymId: Id<"gyms"> | null;
}

export type ReviewDecision =
  | { kind: "post"; meta: ReviewMeta } // post to gym feed
  | { kind: "private"; meta: ReviewMeta }; // log only (private)

export interface ReviewSheetProps {
  open: boolean;
  photoBlob: Blob | null;
  defaults: ReviewSheetDefaults;
  onSubmit: (decision: ReviewDecision) => Promise<void>;
  onDiscard: () => void;
  developing?: boolean;
}

/* ── Chip option tables — mirror QuickLogDialog so the photo-first flow
 *    doesn't drift from the legacy long-press path. Duplicated rather
 *    than imported to keep this lazy chunk small. ─────────────────── */

const SESSION_TYPES = ["BJJ", "Muay Thai", "Boxing", "Wrestling", "Sparring", "Strength", "Run"] as const;

const DURATION_OPTIONS = [15, 30, 45, 60, 75, 90, 120] as const;

interface IntensityPreset {
  label: string;
  level: number;
  intensity: string;
  rpe: number;
}

const INTENSITY_PRESETS: readonly IntensityPreset[] = [
  { label: "Easy", level: 1, intensity: "low", rpe: 3 },
  { label: "Steady", level: 2, intensity: "low", rpe: 5 },
  { label: "Hard", level: 3, intensity: "moderate", rpe: 7 },
  { label: "Battle", level: 4, intensity: "high", rpe: 8 },
  { label: "Max", level: 5, intensity: "high", rpe: 10 },
] as const;

/* ── Component ──────────────────────────────────────────────────── */

export function ReviewSheet({
  open,
  photoBlob,
  defaults,
  onSubmit,
  onDiscard,
  developing,
}: ReviewSheetProps): JSX.Element {
  // Local editable state, seeded from `defaults` on each open→true edge.
  // Intensity is tracked by index so a single source drives the four
  // derived fields (label / level / intensity / rpe).
  const [sessionType, setSessionType] = useState<string>(defaults.sessionType);
  const [durationMinutes, setDurationMinutes] = useState<number>(
    defaults.durationMinutes,
  );
  const [intensityIdx, setIntensityIdx] = useState<number>(() =>
    initialIntensityIdx(defaults),
  );
  const [caption, setCaption] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset only on open→true so a parent re-query mid-session doesn't
  // clobber the user's chip overrides.
  useEffect(() => {
    if (!open) return;
    setSessionType(defaults.sessionType);
    setDurationMinutes(defaults.durationMinutes);
    setIntensityIdx(initialIntensityIdx(defaults));
    setCaption("");
    setSubmitting(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Blob → object URL with strict revoke discipline (covers unmount and
  // photoBlob change).
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!photoBlob) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(photoBlob);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [photoBlob]);

  // PolaroidCard expects a `FeedPost`. For a not-yet-posted preview we
  // stub one — the polaroid only uses these as keys + shared-element
  // ids; nothing is persisted.
  const previewPost = useMemo(
    () => ({
      id: "preview" as unknown as Id<"session_media">,
      createdAt: Date.now(),
      kind: "photo" as const,
      url: previewUrl,
      caption: caption.trim() || null,
      author: {
        userId: "preview-user" as unknown as Id<"users">,
        displayName: "You",
        avatarUrl: null,
      },
      session: null,
      likeCount: 0,
      commentCount: 0,
      viewerLiked: false,
      thumbDataUrl: null,
      thumbUrl: null,
      width: null,
      height: null,
    }),
    [previewUrl, caption],
  );

  /* ── Submit helpers ── */
  const buildMeta = useCallback((): ReviewMeta => {
    const intensity = INTENSITY_PRESETS[intensityIdx];
    return {
      sessionType,
      durationMinutes,
      intensity: intensity.intensity,
      intensityLevel: intensity.level,
      rpe: intensity.rpe,
      caption: caption.trim(),
      gymId: defaults.gymId,
    };
  }, [sessionType, durationMinutes, intensityIdx, caption, defaults.gymId]);

  const submit = useCallback(
    async (kind: ReviewDecision["kind"]) => {
      if (submitting) return;
      setSubmitting(true);
      try {
        if (kind === "post") void triggerHaptic(ImpactStyle.Medium);
        await onSubmit({ kind, meta: buildMeta() } as ReviewDecision);
      } finally {
        setSubmitting(false);
      }
    },
    [submitting, onSubmit, buildMeta],
  );

  // Enter in the caption submits the primary CTA.
  const handleCaptionKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        void submit("post");
      }
    },
    [submit],
  );

  const handleDiscard = useCallback(() => {
    if (submitting) return;
    void triggerHaptic(ImpactStyle.Light);
    onDiscard();
  }, [submitting, onDiscard]);

  const activeIntensityLabel = INTENSITY_PRESETS[intensityIdx]?.label ?? "Steady";
  const gymLabel = defaults.gymName ?? "No gym set";

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        // Treat any outside-driven close as a discard so the parent has
        // a single place to free the photo blob.
        if (!next) handleDiscard();
      }}
    >
      <SheetContent
        side="bottom"
        hideClose
        className={cn(
          "flex flex-col gap-0 p-0 h-[100dvh] max-h-[100dvh] rounded-t-3xl",
          "border-t border-border/50 bg-background text-foreground",
        )}
        style={{
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        }}
      >
        {/* Drag handle + visually-hidden title for a11y. */}
        <div className="shrink-0 px-6 pt-3">
          <div className="flex justify-center pb-2">
            <div aria-hidden className="h-1 w-10 rounded-full bg-muted-foreground/25" />
          </div>
          <SheetHeader className="sr-only">
            <SheetTitle>Review session</SheetTitle>
          </SheetHeader>
        </div>

        {/* Body — sized so everything fits one screen on iPhone SE+.
            `overflow-y-auto` stays so the iOS keyboard can scroll the
            caption input into view if it covers it. */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 pb-2">
          {/* Polaroid preview. Tighter cap (260px square) keeps the
              gym/chips/caption visible above the CTA without scrolling. */}
          <div className="mx-auto mt-2 w-full max-w-[260px]">
            <div className="relative aspect-square w-full">
              <PolaroidCard
                post={previewPost}
                stackPosition={0}
                isTop
                rotationDeg={0}
                developing={developing}
              />
            </div>
          </div>

          {/* Gym banner — static read of `gymName`, not editable in v1. */}
          <div
            className={cn(
              "mt-3 flex items-center justify-between rounded-2xl px-4 py-2.5",
              "bg-muted/40 dark:bg-white/[0.04] border border-border/40",
            )}
          >
            <span className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/70">
              Gym
            </span>
            <span className="text-[14px] font-semibold text-foreground/90 truncate ml-3">
              {gymLabel}
            </span>
          </div>

          {/* "Tap to edit" hint above chips — the chevrons reinforce
              it visually, but a one-liner removes any doubt. */}
          <div className="mt-3 mb-1.5 flex items-center justify-between px-1">
            <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-muted-foreground/60">
              Session
            </span>
            <span className="text-[10px] uppercase tracking-[0.12em] font-medium text-muted-foreground/50">
              Tap to edit
            </span>
          </div>

          {/* Chips — each shows a ChevronDown to read as a dropdown,
              not a static badge. */}
          <div className="flex flex-wrap gap-2">
            <ChipPopover
              label={sessionType}
              ariaLabel="Session type"
              disabled={submitting}
              renderContent={(close) => (
                <ChipList
                  options={SESSION_TYPES.map((t) => ({ value: t, label: t }))}
                  selected={sessionType}
                  onSelect={(value) => {
                    setSessionType(value);
                    close();
                  }}
                />
              )}
            />
            <ChipPopover
              label={`${durationMinutes} min`}
              ariaLabel="Duration"
              disabled={submitting}
              renderContent={(close) => (
                <ChipList
                  options={DURATION_OPTIONS.map((d) => ({
                    value: d,
                    label: `${d} min`,
                  }))}
                  selected={durationMinutes}
                  onSelect={(value) => {
                    setDurationMinutes(value);
                    close();
                  }}
                />
              )}
            />
            <ChipPopover
              label={activeIntensityLabel}
              ariaLabel="Intensity"
              disabled={submitting}
              renderContent={(close) => (
                <ChipList
                  options={INTENSITY_PRESETS.map((p, i) => ({
                    value: i,
                    label: p.label,
                  }))}
                  selected={intensityIdx}
                  onSelect={(value) => {
                    setIntensityIdx(value);
                    close();
                  }}
                />
              )}
            />
          </div>

          {/* Single-line caption — Enter submits primary CTA. */}
          <Input
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onKeyDown={handleCaptionKeyDown}
            placeholder="Add a caption (optional)"
            autoComplete="off"
            autoCapitalize="sentences"
            spellCheck
            maxLength={140}
            disabled={submitting}
            className={cn(
              "mt-3 h-11 rounded-2xl text-[15px]",
              "bg-muted/40 dark:bg-white/[0.04] border-border/30",
            )}
          />
        </div>

        {/* CTA stack — pinned. The primary button gets extra top padding
            (pt-5) so it sits noticeably lower on the screen, separated
            from the form. Log-only + Discard share a horizontal row to
            save vertical space (Log-only left, Discard right). */}
        <div className="shrink-0 px-5 pt-5 pb-3 space-y-3">
          <button
            type="button"
            onClick={() => void submit("post")}
            disabled={submitting}
            style={{ height: 52 }}
            className="w-full rounded-2xl bg-primary text-primary-foreground text-[15px] font-semibold tracking-tight flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50 disabled:active:scale-100"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
                Posting…
              </>
            ) : (
              <>
                Log &amp; post to gym
                <ArrowRight className="h-4 w-4" aria-hidden />
              </>
            )}
          </button>
          <div className="flex items-center justify-between px-2">
            <button
              type="button"
              onClick={() => void submit("private")}
              disabled={submitting}
              className="h-9 px-2 -ml-2 text-[13px] font-semibold text-foreground/80 active:opacity-70 transition-opacity disabled:opacity-50"
            >
              Log only
            </button>
            <button
              type="button"
              onClick={handleDiscard}
              disabled={submitting}
              className="h-9 px-2 -mr-2 text-[13px] font-medium text-muted-foreground/70 active:text-foreground/90 transition-colors disabled:opacity-50"
            >
              Discard
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/* ── Internal building blocks ───────────────────────────────────── */

interface ChipPopoverProps {
  label: string;
  ariaLabel: string;
  disabled?: boolean;
  renderContent: (close: () => void) => React.ReactNode;
}

// Pill-shaped chip + popover panel. Each chip owns its own open-state
// so a selection in one dismisses only that popover.
function ChipPopover({
  label,
  ariaLabel,
  disabled,
  renderContent,
}: ChipPopoverProps): JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (disabled) return;
        if (next) void triggerHaptic(ImpactStyle.Light);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={ariaLabel}
          disabled={disabled}
          className={cn(
            "h-10 pl-4 pr-3 rounded-full text-[13px] font-semibold text-foreground/90",
            "bg-primary/10 dark:bg-primary/15 border border-primary/30",
            "flex items-center gap-1.5 active:scale-[0.97] transition-all",
            "disabled:opacity-50 disabled:active:scale-100",
          )}
        >
          <span>{label}</span>
          <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-56 p-1.5 rounded-2xl">
        {renderContent(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

interface ChipListProps<T extends string | number> {
  options: ReadonlyArray<{ value: T; label: string }>;
  selected: T;
  onSelect: (value: T) => void;
}

// Vertical popover-list. Generic over `value` so the one component
// drives session-type (string), duration (number), and intensity-idx
// (number) chips.
function ChipList<T extends string | number>({
  options,
  selected,
  onSelect,
}: ChipListProps<T>): JSX.Element {
  return (
    <div className="flex flex-col">
      {options.map((opt) => {
        const active = opt.value === selected;
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => {
              void triggerHaptic(ImpactStyle.Light);
              onSelect(opt.value);
            }}
            aria-pressed={active}
            className={cn(
              "h-10 px-3 rounded-xl text-left text-[14px] font-medium transition-colors",
              active
                ? "bg-primary/15 text-foreground"
                : "text-foreground/80 hover:bg-muted/40 dark:hover:bg-white/[0.05]",
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────────────── */

// Map smart-default intensity fields onto a preset index. Prefer level
// match (deterministic), fall back to intensity-string, else "Steady".
function initialIntensityIdx(defaults: ReviewSheetDefaults): number {
  const byLevel = INTENSITY_PRESETS.findIndex(
    (p) => p.level === defaults.intensityLevel,
  );
  if (byLevel !== -1) return byLevel;
  const byString = INTENSITY_PRESETS.findIndex(
    (p) => p.intensity === defaults.intensity,
  );
  if (byString !== -1) return byString;
  return 1;
}
