import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { useQuery } from "convex/react";
import type { Id } from "@/../convex/_generated/dataModel";
import { api } from "@/../convex/_generated/api";
import { triggerHapticSuccess } from "@/lib/haptics";
import { MissionCard } from "./MissionCard";
import { LockedMissionCard } from "./LockedMissionCard";

// At most this many mission cards render at once — keeps the surface
// straightforward even when several disciplines have active missions.
const MAX_VISIBLE_MISSIONS = 4;

/**
 * Full-screen takeover celebration shown once when the user finishes their
 * LAST active mission. Mirrors the repo's existing motion-based confetti
 * pattern (deterministic fan-out) and honours reduced-motion. Auto-dismissal
 * is driven by the parent, which then reveals the empty missions state —
 * giving the "celebrate → smoothly settle back to empty" transition.
 */
function MissionsCompleteCelebration({ prefersReduced }: { prefersReduced: boolean | null }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => {
        const angle = (i / 30) * Math.PI * 2;
        const dist = 120 + (i % 6) * 34;
        return {
          id: i,
          dx: Math.cos(angle) * dist,
          dy: Math.sin(angle) * dist - 40,
          rot: (i * 61) % 360,
          size: 6 + (i % 3) * 3,
          color: ["#23C599", "#3B82F6", "#FAC146", "#F08439", "#9DE7D0"][i % 5],
        };
      }),
    [],
  );

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center px-8 bg-background/85 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      role="status"
      aria-live="polite"
    >
      {/* Confetti burst — skipped entirely under reduced-motion. */}
      {!prefersReduced && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden>
          <div className="relative">
            {pieces.map((p) => (
              <motion.span
                key={p.id}
                className="absolute rounded-[2px]"
                style={{ width: p.size, height: p.size * 1.4, background: p.color }}
                initial={{ x: 0, y: 0, opacity: 0, rotate: 0, scale: 0.6 }}
                animate={{ x: p.dx, y: p.dy, opacity: [0, 1, 1, 0], rotate: p.rot, scale: 1 }}
                transition={{ duration: 1.5, ease: [0.22, 1, 0.36, 1] }}
              />
            ))}
          </div>
        </div>
      )}

      <motion.div
        className="relative text-center"
        initial={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.7, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.92, y: -8 }}
        transition={
          prefersReduced
            ? { duration: 0.2 }
            : { type: "spring", stiffness: 360, damping: 22, mass: 0.7 }
        }
      >
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-func-recovery-green/15 ring-2 ring-func-recovery-green/40">
          <Icon name="trophyOutline" size={30} className="text-func-recovery-green" />
        </div>
        <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-func-recovery-green">
          Camp crushed
        </p>
        <h2 className="mt-1 text-2xl font-bold tracking-tight text-foreground">
          All missions done
        </h2>
        <p className="mt-2 text-[13px] text-muted-foreground leading-snug">
          Every drill ticked off. Log more sessions to unlock your next mission.
        </p>
      </motion.div>
    </motion.div>
  );
}

/**
 * Outer container for the Training Missions feature.
 *
 * States:
 *   - undefined (queries still resolving)  → null.
 *   - feature.isPro === false              → `<LockedMissionCard />`.
 *   - feature.isPro && missions.length 0   → empty state link.
 *   - missions.length > 0                  → up to MAX_VISIBLE_MISSIONS cards.
 *
 * When the user clears their LAST active mission (count → 0), a one-time
 * full-screen celebration plays, then smoothly settles into the empty state.
 */
export function MissionStack() {
  const feature = useQuery(api.training_missions.getMissionFeatureStatus);
  const missions = useQuery(api.training_missions.getActiveMissions);
  const prefersReduced = useReducedMotion();

  // Accordion state — only one mission card open at a time.
  const [expandedId, setExpandedId] = useState<
    Id<"training_missions"> | null | undefined
  >(undefined);

  // All-complete celebration: fire once when the active-mission count drops
  // from >0 to 0 (a real completion, not the initial empty load).
  const [celebrating, setCelebrating] = useState(false);
  const prevCountRef = useRef<number | null>(null);

  useEffect(() => {
    if (missions === undefined) return;
    const count = missions.length;
    const prev = prevCountRef.current;
    prevCountRef.current = count;
    if (prev != null && prev > 0 && count === 0) {
      setCelebrating(true);
      void triggerHapticSuccess();
    }
  }, [missions]);

  useEffect(() => {
    if (!celebrating) return;
    const t = setTimeout(() => setCelebrating(false), prefersReduced ? 1600 : 2600);
    return () => clearTimeout(t);
  }, [celebrating, prefersReduced]);

  if (feature === undefined || missions === undefined) return null;
  if (!feature.isPro) return <LockedMissionCard />;

  const visibleMissions = missions.slice(0, MAX_VISIBLE_MISSIONS);

  // Resolve which card is open, scoped to the visible set so the accordion
  // never points at a hidden (capped-off) mission.
  let effectiveExpandedId: Id<"training_missions"> | null;
  if (expandedId === undefined) {
    effectiveExpandedId = visibleMissions[0]?._id ?? null;
  } else if (expandedId === null) {
    effectiveExpandedId = null;
  } else if (visibleMissions.some((m) => m._id === expandedId)) {
    effectiveExpandedId = expandedId;
  } else {
    effectiveExpandedId = visibleMissions[0]?._id ?? null;
  }

  return (
    <>
      {missions.length === 0 ? (
        <Link
          to="/training-calendar"
          className="relative block w-full rounded-2xl card-surface border border-primary/20 overflow-hidden p-4"
        >
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-gradient-to-br from-primary/[0.04] to-transparent"
          />
          <div className="relative flex items-start gap-3">
            <div className="h-10 w-10 flex items-center justify-center flex-shrink-0">
              <Icon name="listOutline" size={20} className="text-primary" aria-hidden />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-body-sm font-semibold text-foreground leading-tight">
                Training Missions
              </p>
              <p className="text-note text-muted-foreground leading-snug mt-0.5">
                Log a session with notes. Your first mission will appear here.
              </p>
            </div>
          </div>
        </Link>
      ) : (
        <div className="space-y-2">
          {visibleMissions.map((m) => {
            const isOpen = m._id === effectiveExpandedId;
            return (
              <MissionCard
                key={m._id}
                mission={m}
                expanded={isOpen}
                onToggle={() => setExpandedId(isOpen ? null : m._id)}
              />
            );
          })}
        </div>
      )}

      <AnimatePresence>
        {celebrating && <MissionsCompleteCelebration prefersReduced={prefersReduced} />}
      </AnimatePresence>
    </>
  );
}
