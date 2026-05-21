import { memo, useMemo, useRef, useState } from "react";
import { Trash2 } from "lucide-react";
import { motion, useMotionValue, useReducedMotion } from "motion/react";
import { useUser } from "@/contexts/UserContext";
import { useGymAnnouncements, type GymAnnouncement } from "@/hooks/coach/useGymAnnouncements";
import { FightOfferCard } from "@/components/coach/FightOfferCard";

interface Props {
  /** Gym ids the user is a member of — used to scope realtime channels. */
  gymIds: string[];
}

const DELETE_THRESHOLD = -80;

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const AnnouncementCard = memo(function AnnouncementCard({
  a,
  onDismiss,
}: {
  a: GymAnnouncement;
  onDismiss: () => void;
}) {
  const prefersReducedMotion = useReducedMotion();
  const dragX = useMotionValue(0);
  const [isDragging, setIsDragging] = useState(false);
  const crossedRef = useRef(false);
  const canSwipe = !prefersReducedMotion;

  return (
    <div className="relative overflow-hidden rounded-xs">
      {/* Red trash background revealed during drag */}
      {canSwipe && isDragging && (
        <div className="absolute inset-0 flex items-center justify-end bg-destructive/90 rounded-xs px-5">
          <Trash2 className="h-4 w-4 text-destructive-foreground" />
        </div>
      )}
      <motion.div
        className="relative"
        style={{ x: canSwipe ? dragX : undefined }}
        drag={canSwipe ? "x" : false}
        dragConstraints={{ left: -120, right: 0 }}
        dragElastic={0.1}
        dragSnapToOrigin
        onDragStart={() => {
          crossedRef.current = false;
          setIsDragging(true);
        }}
        onDrag={() => {
          crossedRef.current = dragX.get() < DELETE_THRESHOLD;
        }}
        onDragEnd={() => {
          setIsDragging(false);
          if (dragX.get() < DELETE_THRESHOLD) onDismiss();
        }}
        transition={{ type: "spring", damping: 28, stiffness: 320 }}
      >
        {a.kind === "fight_offer" && a.fight_offer ? (
          <FightOfferCard announcement={a} offer={a.fight_offer} />
        ) : (
          <div className="card-surface rounded-xs border border-border p-3">
            <div className="flex items-baseline justify-between gap-2 mb-1">
              <p className="text-[12px] font-semibold truncate">{a.sender_name}</p>
              <span className="text-[10px] text-muted-foreground tabular-nums flex-shrink-0">
                {relativeTime(a.created_at)}
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground/80 mb-1.5">
              {a.gym_name}
              {!a.is_broadcast && (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-primary/10 text-primary text-[9px] uppercase tracking-wider font-semibold">
                  For you
                </span>
              )}
            </p>
            {a.body && (
              <p className="text-[13px] text-foreground/90 leading-snug whitespace-pre-wrap break-words">
                {a.body}
              </p>
            )}
            {a.media_url && (
              <div className="mt-2 rounded-xs overflow-hidden bg-muted/30 border border-border/40">
                {a.media_kind === "video" ? (
                  <video
                    src={a.media_url}
                    controls
                    playsInline
                    preload="metadata"
                    className="w-full max-h-[320px] object-contain bg-black"
                  />
                ) : (
                  <img
                    src={a.media_url}
                    alt=""
                    className="w-full max-h-[320px] object-contain"
                  />
                )}
              </div>
            )}
          </div>
        )}
      </motion.div>
    </div>
  );
});

export function AnnouncementsSection({ gymIds }: Props) {
  const { userId } = useUser();
  const { announcements, loading, dismiss } = useGymAnnouncements(userId, gymIds);

  const visible = useMemo(() => announcements.slice(0, 50), [announcements]);

  if (loading && announcements.length === 0) return null;
  if (announcements.length === 0) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between px-1">
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
          Announcements
        </p>
        <span className="text-[10px] text-muted-foreground/60 tabular-nums">
          {visible.length}
          {announcements.length > visible.length ? ` of ${announcements.length}` : ""}
        </span>
      </div>
      {/* Scrollable container — keeps the section from dominating the page
          when many announcements pile up. Swipe-left to dismiss any row. */}
      <div
        className="max-h-[60vh] overflow-y-auto overscroll-contain space-y-2 pr-0.5 scrollbar-hide"
        style={{ scrollSnapType: "y proximity", WebkitOverflowScrolling: "touch" }}
      >
        {visible.map((a) => (
          <div key={a.id} style={{ scrollSnapAlign: "start" }}>
            <AnnouncementCard a={a} onDismiss={() => dismiss(a)} />
          </div>
        ))}
      </div>
    </section>
  );
}
