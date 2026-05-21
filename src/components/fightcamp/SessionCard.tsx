import { memo, useMemo, useState } from "react";
import { Moon, Check, Image as ImageIcon, ChevronDown, Edit2, Trash2, Eye } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getSessionColor, COLOR_PALETTE } from "@/lib/sessionColors";
import { decodeRunMeta } from "@/lib/runMeta";
import { triggerHapticSelection } from "@/lib/haptics";

interface TrainingCalendarRow {
  id: string;
  user_id: string;
  date: string;
  session_type: string;
  duration_minutes: number;
  rpe: number;
  intensity: string;
  intensity_level: number | null;
  bodyweight: number | null;
  fatigue_level: number | null;
  soreness_level: number | null;
  sleep_hours: number | null;
  sleep_quality: string | null;
  mobility_done: boolean | null;
  notes: string | null;
  media_url: string | null;
  created_at: string | null;
}

interface SessionCardProps {
  session: TrainingCalendarRow;
  customColors: Record<string, string>;
  userId: string | null;
  /** Opens the full SessionDetailDrawer (legacy, for media gallery + heavy details). */
  onView: (session: TrainingCalendarRow) => void;
  onColorChange: (sessionType: string, color: string) => void;
  /** Optional inline-expand actions. If both are passed, the inline expand
   *  shows Edit/Delete buttons. Otherwise falls back to a "View details" link. */
  onEdit?: (session: TrainingCalendarRow) => void;
  onDelete?: (session: TrainingCalendarRow) => void;
}

export const SessionCard = memo(function SessionCard({
  session,
  customColors,
  userId,
  onView,
  onColorChange,
  onEdit,
  onDelete,
}: SessionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isRest = session.session_type === "Rest";
  const isRun = session.session_type === "Run";
  const sessionColor = getSessionColor(session.session_type, customColors);
  const intensityDisplay =
    session.intensity_level ?? (session.intensity === "high" ? 5 : session.intensity === "moderate" ? 3 : 1);
  const { meta: runMeta, notes: cleanNotes } = useMemo(
    () => (isRun ? decodeRunMeta(session.notes) : { meta: null, notes: session.notes ?? "" }),
    [isRun, session.notes],
  );

  const hasMedia = !!session.media_url;
  const hasNotes = !!(isRun ? cleanNotes : session.notes);
  const hasSoreness = (session.soreness_level ?? 0) > 0;
  const hasSleep = (session.sleep_hours ?? 0) > 0;

  // Resolve the primary 3 stats by session type.
  const primaryStats = isRest
    ? [
        { label: "Sleep", value: session.sleep_quality ?? "—", sub: "" },
        { label: "Fatigue", value: session.fatigue_level ?? "—", sub: "/10" },
        { label: "Mobility", value: session.mobility_done ? "Done" : "—", sub: "" },
      ]
    : isRun && runMeta
    ? [
        { label: "Distance", value: runMeta.distance, sub: runMeta.unit },
        { label: "Time", value: runMeta.time ?? "—", sub: "" },
        { label: "Pace", value: runMeta.pace ?? "—", sub: runMeta.pace ? `/${runMeta.unit}` : "" },
      ]
    : [
        { label: "Duration", value: session.duration_minutes, sub: "min" },
        { label: "RPE", value: session.rpe, sub: "/10" },
        { label: "Intensity", value: intensityDisplay, sub: "/5" },
      ];

  const handleToggle = () => {
    triggerHapticSelection();
    setExpanded((v) => !v);
  };

  return (
    <div className="rounded-xs card-surface border border-border/40 overflow-hidden">
      {/* Main row — color tile + body + chevron */}
      <button
        onClick={handleToggle}
        className="w-full flex items-stretch gap-3 px-3 py-3 text-left active:bg-muted/20 transition-colors"
        aria-expanded={expanded}
      >
        {/* Left tile — photo thumbnail when media exists, solid color
            fallback otherwise. Tap opens the color picker either way; the
            colored ring around the photo keeps the session-type color
            recognisable without re-introducing the letter overlay on top
            of an arbitrary image. */}
        <Popover>
          <PopoverTrigger asChild>
            {hasMedia ? (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => e.stopPropagation()}
                className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xs overflow-hidden ring-2"
                style={{ borderColor: sessionColor, boxShadow: `inset 0 0 0 2px ${sessionColor}` }}
                aria-label={`${session.session_type} photo, tap to change color`}
              >
                <img
                  src={session.media_url!}
                  alt={`${session.session_type} session`}
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
                {/* Tiny type-letter chip in the bottom-right corner so the
                    session type is still legible at a glance. */}
                <span
                  className="absolute bottom-0 right-0 px-1 py-px text-[8px] font-black uppercase tracking-tight text-white/95 leading-none rounded-tl-md"
                  style={{ backgroundColor: sessionColor }}
                >
                  {session.session_type.charAt(0)}
                </span>
              </span>
            ) : (
              <span
                role="button"
                tabIndex={0}
                onClick={(e) => e.stopPropagation()}
                className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-xs ring-1 ring-white/[0.06]"
                style={{ backgroundColor: sessionColor }}
                aria-label={`${session.session_type} color tile, tap to change`}
              >
                <span className="text-[12px] font-black uppercase tracking-tight text-white/95">
                  {session.session_type.charAt(0)}
                </span>
              </span>
            )}
          </PopoverTrigger>
          <PopoverContent className="w-auto p-3" side="bottom" align="start" onClick={(e) => e.stopPropagation()}>
            <div className="grid grid-cols-4 gap-2">
              {COLOR_PALETTE.map((color) => (
                <button
                  key={color}
                  className="w-8 h-8 rounded-full flex items-center justify-center ring-1 ring-white/10 hover:scale-110 transition-transform"
                  style={{ backgroundColor: color }}
                  onClick={() => { if (userId) onColorChange(session.session_type, color); }}
                >
                  {sessionColor === color && <Check className="w-4 h-4 text-white" />}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

        {/* Body */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-[14px] font-semibold text-foreground truncate">
              {session.session_type}
            </p>
            {hasMedia && <ImageIcon className="w-3 h-3 text-foreground/50 shrink-0" />}
          </div>
          <div className="mt-1 flex items-baseline gap-3 tabular-nums">
            {primaryStats.map((s, idx) => (
              <div key={idx} className="flex items-baseline gap-1">
                <span
                  className="text-[15px] font-bold leading-none"
                  style={idx === 1 && !isRest ? { color: sessionColor } : undefined}
                >
                  {s.value}
                </span>
                {s.sub && <span className="text-[10px] font-medium text-foreground/50">{s.sub}</span>}
              </div>
            ))}
          </div>
          {/* Secondary pills */}
          {!isRest && (hasSoreness || hasSleep) && (
            <div className="mt-1 flex items-center gap-2">
              {hasSoreness && (
                <span className="inline-flex items-center gap-1 rounded-full bg-func-danger-red/10 ring-1 ring-func-danger-red/25 px-1.5 py-0.5 text-[10px] font-bold text-func-danger-red">
                  Sore {session.soreness_level}/10
                </span>
              )}
              {hasSleep && (
                <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 ring-1 ring-indigo-500/25 px-1.5 py-0.5 text-[10px] font-bold text-indigo-300">
                  <Moon className="h-2.5 w-2.5" />
                  {session.sleep_hours}h
                </span>
              )}
            </div>
          )}
        </div>

        {/* Chevron */}
        <motion.span
          className="shrink-0 self-center text-muted-foreground/40"
          animate={{ rotate: expanded ? 180 : 0 }}
          transition={{ duration: 0.18 }}
        >
          <ChevronDown className="h-4 w-4" />
        </motion.span>
      </button>

      {/* Inline expand — stat grid + media + notes + edit/delete */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden border-t border-border/30"
          >
            <div className="px-3 py-3 space-y-3">
              {/* Big stat grid */}
              <div className="grid grid-cols-3 gap-2">
                {primaryStats.map((s, idx) => (
                  <div
                    key={idx}
                    className="rounded-xs bg-muted/20 px-2 py-2.5 text-center"
                  >
                    <p
                      className="display-number text-[20px] font-black tabular-nums leading-none"
                      style={idx === 1 && !isRest ? { color: sessionColor } : { color: "hsl(var(--foreground))" }}
                    >
                      {s.value}
                    </p>
                    <p className="mt-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                      {s.label}{s.sub ? ` ${s.sub}` : ""}
                    </p>
                  </div>
                ))}
              </div>

              {/* Soreness + sleep row */}
              {!isRest && (hasSoreness || hasSleep) && (
                <div className="flex items-center gap-2">
                  {hasSoreness && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-func-danger-red/10 ring-1 ring-func-danger-red/25 px-2 py-0.5 text-[11px] font-semibold text-func-danger-red">
                      Soreness {session.soreness_level}/10
                    </span>
                  )}
                  {hasSleep && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-indigo-500/10 ring-1 ring-indigo-500/25 px-2 py-0.5 text-[11px] font-semibold text-indigo-300">
                      <Moon className="h-3 w-3" />
                      {session.sleep_hours}h sleep
                    </span>
                  )}
                </div>
              )}

              {/* Media (preview only — full gallery in the detail drawer) */}
              {hasMedia && (
                <button
                  onClick={(e) => { e.stopPropagation(); onView(session); }}
                  className="block w-full text-left"
                  aria-label="View media gallery"
                >
                  <div className="relative aspect-[16/9] w-full overflow-hidden rounded-xs bg-muted/30">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={session.media_url!}
                      alt="Session media"
                      className="h-full w-full object-cover"
                      loading="lazy"
                    />
                    <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur">
                      <Eye className="h-3 w-3" /> View all
                    </span>
                  </div>
                </button>
              )}

              {/* Notes */}
              {hasNotes && (
                <div className="rounded-xs bg-muted/20 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">Notes</p>
                  <p className="mt-1 text-[12px] text-foreground/90 leading-snug whitespace-pre-wrap">
                    {isRun ? cleanNotes : session.notes}
                  </p>
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-1.5 pt-1">
                {onEdit ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); onEdit(session); }}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-xs bg-muted/40 border border-border/40 text-[12px] font-semibold active:scale-[0.97] transition"
                  >
                    <Edit2 className="h-3.5 w-3.5" /> Edit
                  </button>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); onView(session); }}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-xs bg-muted/40 border border-border/40 text-[12px] font-semibold active:scale-[0.97] transition"
                  >
                    <Eye className="h-3.5 w-3.5" /> Details
                  </button>
                )}
                {onDelete && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onDelete(session); }}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 h-9 rounded-xs bg-destructive/10 border border-destructive/30 text-[12px] font-semibold text-destructive active:scale-[0.97] transition"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
