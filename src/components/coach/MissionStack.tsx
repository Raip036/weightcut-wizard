import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, useReducedMotion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { useQuery } from "convex/react";
import type { Id } from "@/../convex/_generated/dataModel";
import { api } from "@/../convex/_generated/api";
import { triggerHapticSuccess } from "@/lib/haptics";
import { CompleteCelebration } from "@/components/motion";
import { MissionCard } from "./MissionCard";
import { LockedMissionCard } from "./LockedMissionCard";

// At most this many mission cards render at once — keeps the surface
// straightforward even when several disciplines have active missions.
const MAX_VISIBLE_MISSIONS = 4;

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
        {celebrating && (
          <CompleteCelebration
            prefersReduced={prefersReduced}
            eyebrow="Camp crushed"
            title="All missions done"
            subtitle="Every drill ticked off. Log more sessions to unlock your next mission."
          />
        )}
      </AnimatePresence>
    </>
  );
}
