/**
 * ReviewSheet — full-height bottom sheet shown after the photo-first
 * shutter fires. Spec: 2026-05-19 round-card photo-first tracking,
 * §3.3 (layout), §3.5–§3.6 (CTAs), §4 (developing polaroid).
 *
 * Pure presentational: never calls a Convex mutation. The parent owns
 * the `fight_camp.create` + `uploadSessionMediaV2` pipeline; this
 * component only emits a `ReviewDecision` or fires `onDiscard()`.
 */
import { forwardRef, useCallback, useEffect, useMemo, useState } from "react";
import { ImpactStyle } from "@capacitor/haptics";
import { ArrowRight, ChevronDown, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { triggerHaptic } from "@/lib/haptics";
import { PolaroidCard } from "@/components/community/PolaroidCard";
import { tagsForPrimary } from "@/lib/sessionTypes";
import type { Id } from "../../../convex/_generated/dataModel";

/* ── Public API ─────────────────────────────────────────────────── */

export interface ReviewSheetDefaults {
  gymId: Id<"gyms"> | null;
  gymName: string | null;
  // Resolved gym logo URL from Convex storage. Optional in the data
  // model (gyms without a logo are valid), so `null` flows through
  // verbatim. Consumed only by the polaroid's bottom strip — not
  // round-tripped into `ReviewMeta` because the calendar row doesn't
  // need it (denormalised by the feed pipeline).
  gymLogoUrl: string | null;
  sessionType: string;
  /** Optional activity tag (Sparring, Drilling, …). Optional so callers
   *  that pre-date the two-level model still satisfy the shape. */
  sessionTag?: string | null;
  durationMinutes: number;
  intensity: string;
  intensityLevel: number;
  rpe: number;
}

export interface ReviewMeta {
  sessionType: string;
  /** Optional activity tag selected in the sheet. null ⇒ none. */
  sessionTag: string | null;
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

// Health → energy → red ramp, indexed to match INTENSITY_PRESETS. Inline
// hsl() values mirror the design tokens (health/hydration/energy/red) so
// the dot reads as a heat scale without pulling extra CSS vars.
const INTENSITY_DOT_COLORS: readonly string[] = [
  "hsl(152 69% 46%)", // Easy   — health green
  "hsl(199 89% 52%)", // Steady — hydration cyan
  "hsl(24 95% 56%)", // Hard   — energy amber
  "hsl(14 90% 55%)", // Battle — orange-red (energy↦red blend)
  "hsl(0 72% 55%)", // Max    — red
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
  const [sessionTag, setSessionTag] = useState<string | null>(
    defaults.sessionTag ?? null,
  );
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
    setSessionTag(defaults.sessionTag ?? null);
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
      reactionCounts: {},
      viewerReactions: [],
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
      sessionTag,
      durationMinutes,
      intensity: intensity.intensity,
      intensityLevel: intensity.level,
      rpe: intensity.rpe,
      caption: caption.trim(),
      gymId: defaults.gymId,
    };
  }, [sessionType, sessionTag, durationMinutes, intensityIdx, caption, defaults.gymId]);

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

  // Optional activity-tag options for the chosen primary. When the user
  // switches primary to a category the current tag doesn't belong to, drop
  // the tag so we never post a mismatched pair (e.g. "Sparring" on "S&C").
  const tagOptions = useMemo(() => tagsForPrimary(sessionType), [sessionType]);
  useEffect(() => {
    if (sessionTag && !tagOptions.some((t) => t.id === sessionTag)) {
      setSessionTag(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionType]);

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
          {/* Polaroid preview. Cap shrunk 260→240 to reclaim vertical
              budget (see SE math) — the ±4° developing shake also gets
              less perceived crowd with a smaller card.

              The polaroid frame (`bg-white p-4 pb-10` around an
              aspect-square image) extends ~56px below the wrapper's
              `aspect-square` box because PolaroidCard is positioned
              `absolute inset-0`. We reserve that overflow via
              `pb-14` (56px) on the outer wrapper so the gym banner
              below never visually collides with the polaroid frame
              or its ±4° developing shake. */}
          <div className="mx-auto mt-2 w-full max-w-[220px] pb-14">
            <div className="relative aspect-square w-full">
              <PolaroidCard
                post={previewPost}
                stackPosition={0}
                isTop
                rotationDeg={0}
                developing={developing}
                gymBrand={
                  defaults.gymName
                    ? { name: defaults.gymName, logoUrl: defaults.gymLogoUrl }
                    : undefined
                }
              />
            </div>
          </div>

          {/* Session summary stat card. One cohesive labeled card (Apple
              Fitness aesthetic) replacing the loose pill row. A slim full-
              width "Gym" header sits atop a 2×2 grid of tappable cells —
              each cell is a ChipPopover trigger reusing the exact same
              selection logic as the legacy pills.

              `mt-7` (28px) gives breathing room on top of the polaroid
              wrapper's reserved overflow (`pb-14`) so the polaroid's
              shadow + ±4° developing shake never visually touch the card. */}
          <div className="mt-7 rounded-2xl border border-border/50 bg-muted/40 dark:bg-white/[0.04] overflow-hidden">
            {/* Slim Gym header — static read of `gymName`, not editable. */}
            <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border/40">
              <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/60">
                Gym
              </span>
              <span className="text-[14px] font-semibold text-foreground/90 truncate ml-3">
                {gymLabel}
              </span>
            </div>

            {/* 2×2 grid of editable stat cells with hairline dividers.
                Each cell IS a ChipPopover trigger via `renderTrigger`. */}
            <div className="grid grid-cols-2">
              <ChipPopover
                label={sessionType}
                ariaLabel="Session type"
                disabled={submitting}
                renderTrigger={({ open }) => (
                  <StatCell
                    cellLabel="Discipline"
                    value={sessionType}
                    ariaLabel="Session type"
                    disabled={submitting}
                    open={open}
                    className="border-r border-b border-border/40"
                  />
                )}
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

              {tagOptions.length > 0 ? (
                <ChipPopover
                  label={sessionTag ?? "None"}
                  ariaLabel="Activity tag"
                  disabled={submitting}
                  renderTrigger={({ open }) => (
                    <StatCell
                      cellLabel="Activity"
                      value={sessionTag ?? "None"}
                      ariaLabel="Activity tag"
                      disabled={submitting}
                      open={open}
                      className="border-b border-border/40"
                    />
                  )}
                  renderContent={(close) => (
                    <ChipList
                      options={[
                        { value: "", label: "None" },
                        ...tagOptions.map((t) => ({ value: t.id, label: t.id })),
                      ]}
                      selected={sessionTag ?? ""}
                      onSelect={(value) => {
                        setSessionTag(value ? value : null);
                        close();
                      }}
                    />
                  )}
                />
              ) : (
                // Keep the 2×2 shape when no tags exist for this discipline:
                // render a disabled, greyed cell showing "—".
                <StatCell
                  cellLabel="Activity"
                  value="—"
                  ariaLabel="Activity tag (unavailable)"
                  disabled
                  muted
                  className="border-b border-border/40"
                />
              )}

              <ChipPopover
                label={`${durationMinutes} min`}
                ariaLabel="Duration"
                disabled={submitting}
                renderTrigger={({ open }) => (
                  <StatCell
                    cellLabel="Duration"
                    value={`${durationMinutes} min`}
                    ariaLabel="Duration"
                    disabled={submitting}
                    open={open}
                    className="border-r border-border/40"
                  />
                )}
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
                renderTrigger={({ open }) => (
                  <StatCell
                    cellLabel="Intensity"
                    value={activeIntensityLabel}
                    ariaLabel="Intensity"
                    disabled={submitting}
                    open={open}
                    dotColor={INTENSITY_DOT_COLORS[intensityIdx]}
                  />
                )}
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
              "mt-3 h-11 rounded-xs text-[15px]",
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
            className="w-full rounded-xs bg-primary text-primary-foreground text-[15px] font-semibold tracking-tight flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50 disabled:active:scale-100"
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
  /** Lighter treatment for the optional activity-tag chip so the two
   *  session levels read as visually distinct. Pill variant only. */
  secondary?: boolean;
  /** Optional custom trigger renderer. When supplied the popover renders
   *  this instead of the default pill button, letting the same open-state
   *  + content logic back a stat-grid cell. The returned node must accept
   *  ref/props from PopoverTrigger (it is wrapped in `asChild`), so render
   *  a single focusable element (e.g. a <button>). `open` lets the trigger
   *  reflect its expanded state; the click/keyboard wiring is handled by
   *  Radix. Default = the legacy pill. */
  renderTrigger?: (props: { label: string; open: boolean }) => React.ReactNode;
  renderContent: (close: () => void) => React.ReactNode;
}

// Chip/cell + popover panel. Each instance owns its own open-state so a
// selection in one dismisses only that popover. The trigger's visual
// presentation is pluggable via `renderTrigger`; the popover logic and
// content are identical across the pill and stat-cell forms.
function ChipPopover({
  label,
  ariaLabel,
  disabled,
  secondary = false,
  renderTrigger,
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
        {renderTrigger ? (
          renderTrigger({ label, open })
        ) : (
          <button
            type="button"
            aria-label={ariaLabel}
            disabled={disabled}
            className={cn(
              "rounded-full font-semibold flex items-center gap-1.5 active:scale-[0.97] transition-all",
              "disabled:opacity-50 disabled:active:scale-100",
              secondary
                ? "h-9 pl-3.5 pr-2.5 text-[12px] text-muted-foreground bg-muted/40 dark:bg-white/[0.05] border border-border/40"
                : "h-10 pl-4 pr-3 text-[13px] text-foreground/90 bg-primary/10 dark:bg-primary/15 border border-primary/30",
            )}
          >
            <span>{label}</span>
            <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-56 p-1.5 rounded-xs">
        {renderContent(() => setOpen(false))}
      </PopoverContent>
    </Popover>
  );
}

/* ── Stat-card cell ─────────────────────────────────────────────────
 * Tappable grid cell used as a ChipPopover trigger. Renders a small
 * uppercase label, a bold value (optionally prefixed with a colored
 * intensity dot), and a corner chevron to read as "tap to edit".
 * Hairline dividers are applied by the parent grid via border utilities.
 */
interface StatCellProps {
  cellLabel: string;
  value: string;
  ariaLabel: string;
  disabled?: boolean;
  /** Inline hsl() color for the leading dot (intensity ramp). */
  dotColor?: string;
  /** Visually muted (e.g. no activity tags available). */
  muted?: boolean;
  className?: string;
  open?: boolean;
}

const StatCell = forwardRef<HTMLButtonElement, StatCellProps>(function StatCell(
  { cellLabel, value, ariaLabel, disabled, dotColor, muted, className, open, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={ariaLabel}
      aria-expanded={open}
      disabled={disabled}
      className={cn(
        "relative flex flex-col items-start gap-1 px-3.5 py-3 text-left transition-colors",
        "active:scale-[0.98] active:bg-white/[0.02]",
        "disabled:opacity-60 disabled:active:scale-100 disabled:cursor-default",
        className,
      )}
      {...rest}
    >
      <span className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/60">
        {cellLabel}
      </span>
      <span
        className={cn(
          "flex items-center gap-1.5 text-[15px] font-semibold",
          muted ? "text-muted-foreground/50" : "text-foreground",
        )}
      >
        {dotColor && (
          <span
            aria-hidden
            className="h-2 w-2 rounded-full shrink-0"
            style={{ backgroundColor: dotColor }}
          />
        )}
        <span className="truncate">{value}</span>
      </span>
      <ChevronDown
        aria-hidden
        className="absolute top-2.5 right-2.5 h-3 w-3 text-muted-foreground/40"
      />
    </button>
  );
});

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
              "h-10 px-3 rounded-xs text-left text-[14px] font-medium transition-colors",
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
