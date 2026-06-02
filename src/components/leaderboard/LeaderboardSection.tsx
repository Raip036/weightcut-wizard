import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  DisciplineFilterTabs,
  type DisciplineFilter,
} from "./DisciplineFilterTabs";
import { PodiumHero } from "./PodiumHero";
import { RankedList } from "./RankedList";
import { MyRankFooter } from "./MyRankFooter";
import { useUser } from "@/contexts/UserContext";

const FILTER_TO_DISCIPLINE: Record<DisciplineFilter, string | undefined> = {
  All: undefined,
  BJJ: "BJJ",
  Boxing: "Boxing",
  "Muay Thai": "Muay Thai",
  Wrestling: "Wrestling",
  Sparring: "Sparring",
  Strength: "Strength",
  Run: "Run",
};

function SkeletonRow() {
  return <div className="h-12 animate-pulse rounded-xs bg-card/40" />;
}

export function LeaderboardSection({
  gymId,
  viewer,
  onRowClick,
}: {
  gymId: Id<"gyms">;
  viewer: "coach" | "athlete";
  onRowClick?: (userId: string) => void;
}) {
  const [filter, setFilter] = useState<DisciplineFilter>("All");
  const { userId } = useUser();
  const data = useQuery(api.gymLeaderboard.weekly, {
    gymId,
    discipline: FILTER_TO_DISCIPLINE[filter],
  });
  // Snapshot scope is gym+filter so the deltas reflect "movement under the
  // currently filtered view" rather than mixing across disciplines.
  const snapshotScope = `${gymId}:${filter}`;
  // Coaches view the gym but don't compete; only highlight a viewer when the
  // viewer is an athlete with a real userId.
  const viewerUserId = viewer === "athlete" ? userId : null;

  // Loading state
  if (data === undefined) {
    return (
      <section className="space-y-3">
        <DisciplineFilterTabs value={filter} onChange={setFilter} />
        <div className="space-y-2">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      </section>
    );
  }

  // Caller opted out
  if (data === null) {
    return (
      <section className="glass-card rounded-xs border border-border/50 p-4 text-sm text-muted-foreground">
        Enable data sharing in this gym's settings to see the leaderboard.
      </section>
    );
  }

  const { podium, ranks, myRank, totalRankedFighters } = data;

  // Empty — copy is viewer-aware. The athlete-side copy nudges them to
  // log a session ("be the first"); the coach-side copy explains the
  // gym's state factually instead, since a coach can't post training
  // for the leaderboard themselves.
  if (totalRankedFighters === 0) {
    const emptyCopy =
      filter === "All"
        ? viewer === "coach"
          ? "No training data from your fighters yet this week. Once they start logging sessions, rankings will appear here."
          : "Be the first to train this week."
        : viewer === "coach"
          ? `No ${filter} sessions logged by your fighters this week.`
          : `No ${filter} training logged this week.`;
    return (
      <section className="space-y-3">
        <DisciplineFilterTabs value={filter} onChange={setFilter} />
        <div className="glass-card rounded-xs border border-border/50 p-4 text-center text-sm text-muted-foreground">
          {emptyCopy}
        </div>
      </section>
    );
  }

  const showPodium = totalRankedFighters >= 3;

  return (
    <section className="space-y-3">
      <DisciplineFilterTabs value={filter} onChange={setFilter} />
      {showPodium ? (
        <PodiumHero
          podium={podium}
          viewerUserId={viewerUserId}
          disciplineLabel={filter}
        />
      ) : (
        // Aspirational empty podium — silhouette of #2 / #1 / #3 slots with
        // an invite CTA. Reads as "the trophy is waiting for you and your
        // teammates" rather than a dead "need N more fighters" line.
        <PlaceholderPodium viewer={viewer} />
      )}
      <RankedList
        ranks={ranks}
        onRowClick={onRowClick}
        snapshotScope={snapshotScope}
        viewerUserId={viewerUserId}
      />
      {viewer === "athlete" && myRank ? (
        <MyRankFooter myRank={myRank} podium={podium} />
      ) : null}
    </section>
  );
}

function PlaceholderPodium({ viewer }: { viewer: "coach" | "athlete" }) {
  const navigate =
    typeof window !== "undefined"
      ? (path: string) => {
          window.location.assign(path);
        }
      : () => {};
  return (
    <div className="glass-card rounded-xs border border-border/50 p-4 text-center">
      <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/80">
        This week's podium
      </p>
      {/* Silhouette steps — #2 / #1 / #3 ordering mirrors the real PodiumHero */}
      <div className="mt-3 flex items-end justify-center gap-2.5">
        <PodiumSlot rank={2} height={48} />
        <PodiumSlot rank={1} height={66} />
        <PodiumSlot rank={3} height={36} />
      </div>
      <p className="mt-3 text-[12px] text-muted-foreground leading-snug max-w-[28ch] mx-auto">
        {viewer === "coach"
          ? "Once 3+ fighters log this week, your podium appears here."
          : "Bring 2 more fighters into your gym to fill the podium."}
      </p>
      {viewer === "athlete" && (
        <button
          type="button"
          onClick={() => navigate("/my-gym")}
          className="mt-3 inline-flex items-center gap-1 h-10 px-4 rounded-xs bg-primary text-primary-foreground text-[13px] font-semibold active:scale-[0.98] transition-transform"
        >
          Invite a teammate →
        </button>
      )}
    </div>
  );
}

function PodiumSlot({ rank, height }: { rank: 1 | 2 | 3; height: number }) {
  const isTop = rank === 1;
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className={`h-10 w-10 rounded-full border-2 border-dashed flex items-center justify-center ${
        isTop ? "border-primary/40 text-primary/70" : "border-muted-foreground/30 text-muted-foreground/50"
      }`}>
        <span className="text-[11px] font-bold tabular-nums">#{rank}</span>
      </div>
      <div
        className={`w-16 rounded-t-lg ${isTop ? "bg-primary/15 border border-primary/25" : "bg-muted/40 border border-border/40"}`}
        style={{ height }}
        aria-hidden
      />
    </div>
  );
}
