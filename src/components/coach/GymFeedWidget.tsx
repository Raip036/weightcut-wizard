/**
 * Coach-dashboard preview widget for the gym social feed. Renders a
 * horizontal-scrolling row of the 6 most-recent media posts from one gym;
 * tapping any thumbnail (or the "See all →" link) opens the full
 * TikTok-style swiper at `/gym-feed`.
 *
 * Visibility is gated by `gym_members.feedVisibleOnDashboard` — the coach
 * has to opt in from gym settings, so this widget only renders for gyms
 * the coach has marked. The parent (`CoachDashboard.tsx`) reads the flag
 * off the membership row and conditionally mounts this component.
 */
import { useQuery } from "convex/react";
import { useNavigate } from "react-router-dom";
import { Play, Users } from "lucide-react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";

interface GymFeedWidgetProps {
  gymId: Id<"gyms">;
  gymName: string;
}

export function GymFeedWidget({ gymId, gymName }: GymFeedWidgetProps) {
  const navigate = useNavigate();
  const posts = useQuery(api.gymFeed.recentForCoachWidget, { gymId, limit: 6 });

  // While loading, render a stable-height skeleton so the rest of the
  // coach dashboard doesn't jump when posts arrive.
  if (posts === undefined) {
    return (
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
            Gym feed
          </h3>
        </div>
        <div className="flex gap-2 overflow-x-auto scrollbar-hide">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 w-24 rounded-xs bg-muted/30 animate-pulse shrink-0" />
          ))}
        </div>
      </section>
    );
  }

  // Empty state — keep the row but show a friendly nudge so the coach
  // knows the widget is wired even though nobody's posted yet.
  if (posts.length === 0) {
    return (
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
            Gym feed · {gymName}
          </h3>
        </div>
        <div className="card-surface rounded-xs border border-border/40 px-4 py-5 text-center">
          <Users className="h-5 w-5 text-muted-foreground/40 mx-auto mb-1.5" />
          <p className="text-[13px] text-foreground">No posts yet</p>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Your athletes' training media will show up here.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[12px] font-semibold uppercase tracking-wider text-muted-foreground">
          Gym feed · {gymName}
        </h3>
        <button
          type="button"
          onClick={() => navigate(`/gym-feed?gym=${gymId}`)}
          className="text-[11px] font-semibold text-primary active:opacity-70"
        >
          See all →
        </button>
      </div>
      <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1">
        {posts.map((post) => (
          <button
            key={post.id}
            type="button"
            onClick={() => navigate(`/gym-feed?gym=${gymId}`)}
            className="relative h-24 w-24 rounded-xs overflow-hidden shrink-0 active:scale-[0.97] transition-transform bg-muted/40"
            aria-label="Open gym feed"
          >
            {post.url ? (
              post.kind === "video" ? (
                <>
                  <video
                    src={post.url}
                    className="w-full h-full object-cover"
                    muted
                    playsInline
                    preload="metadata"
                  />
                  <div className="absolute inset-0 flex items-center justify-center bg-black/15">
                    <div className="h-6 w-6 rounded-full bg-black/55 backdrop-blur flex items-center justify-center">
                      <Play className="h-3 w-3 text-white fill-white" />
                    </div>
                  </div>
                </>
              ) : (
                <img src={post.url} alt="" className="w-full h-full object-cover" loading="lazy" />
              )
            ) : null}
          </button>
        ))}
      </div>
    </section>
  );
}
