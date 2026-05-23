import { useState } from "react";
import { Link } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import { useQuery } from "convex/react";
import type { Id } from "@/../convex/_generated/dataModel";
import { api } from "@/../convex/_generated/api";
import { MissionCard } from "./MissionCard";
import { LockedMissionCard } from "./LockedMissionCard";

/**
 * Outer container for the Training Missions feature. Lives in the slot
 * previously occupied by the legacy `<TrainingCoachWidget />` on `/camp`.
 *
 * States:
 *   - undefined (queries still resolving)  → null  (parent renders a
 *     skeleton via Suspense/its own loaders; an extra spinner here would
 *     just add jitter while Convex returns).
 *   - feature.isPro === false              → `<LockedMissionCard />`
 *   - feature.isPro && missions.length 0   → empty state with a link to
 *     the training calendar.
 *   - missions.length > 0                  → one `<MissionCard />` per
 *     active mission, ordered server-side by lastActivityAt desc.
 */
export function MissionStack() {
  const feature = useQuery(api.training_missions.getMissionFeatureStatus);
  const missions = useQuery(api.training_missions.getActiveMissions);

  // Accordion state — only one mission card open at a time so the screen
  // doesn't clutter when many disciplines are in flight.
  //
  // Three-state semantics so a user-initiated collapse isn't immediately
  // undone by the "default to top mission" fallback:
  //   - `undefined` → user hasn't interacted yet → default to top mission
  //   - `null`      → user explicitly collapsed everything → keep collapsed
  //   - Id<...>     → user explicitly opened that mission
  const [expandedId, setExpandedId] = useState<
    Id<"training_missions"> | null | undefined
  >(undefined);

  if (feature === undefined || missions === undefined) return null;
  if (!feature.isPro) return <LockedMissionCard />;

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
            <Icon
              name="listOutline"
              size={20}
              className="text-primary"
              aria-hidden
            />
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

  // Resolve which card is open:
  //   - first visit (`undefined`)        → top mission
  //   - explicit collapse (`null`)       → nothing open, respect user intent
  //   - explicit Id pointing at a real
  //     mission                          → that one
  //   - explicit Id whose mission was
  //     since removed                    → fall back to top so we don't
  //                                        leave the user stuck on an
  //                                        invisible ghost
  let effectiveExpandedId: Id<"training_missions"> | null;
  if (expandedId === undefined) {
    effectiveExpandedId = missions[0]?._id ?? null;
  } else if (expandedId === null) {
    effectiveExpandedId = null;
  } else if (missions.some((m) => m._id === expandedId)) {
    effectiveExpandedId = expandedId;
  } else {
    effectiveExpandedId = missions[0]?._id ?? null;
  }

  return (
    <div className="space-y-2">
      {missions.map((m) => {
        const isOpen = m._id === effectiveExpandedId;
        return (
          <MissionCard
            key={m._id}
            mission={m}
            expanded={isOpen}
            // Compare against the visually-resolved state, not the raw
            // `expandedId` — otherwise a first click on the auto-defaulted
            // top card writes the same id and leaves the card stuck open.
            onToggle={() => setExpandedId(isOpen ? null : m._id)}
          />
        );
      })}
    </div>
  );
}
