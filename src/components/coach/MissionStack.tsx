import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { useQuery } from "convex/react";
import type { Id } from "@/../convex/_generated/dataModel";
import { api } from "@/../convex/_generated/api";
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
 * Each individual mission card now shows its own full-screen completion
 * celebration when its last item is ticked, so there is no stack-level
 * all-cleared takeover here (that would double up on the card's).
 */
export function MissionStack() {
  const feature = useQuery(api.training_missions.getMissionFeatureStatus);
  const missions = useQuery(api.training_missions.getActiveMissions);

  // Accordion state — only one mission card open at a time.
  const [expandedId, setExpandedId] = useState<
    Id<"training_missions"> | null | undefined
  >(undefined);

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

  if (missions.length === 0) {
    return (
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
    );
  }

  return (
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
  );
}
