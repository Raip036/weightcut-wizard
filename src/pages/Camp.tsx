import { useNavigate } from "react-router-dom";
import { Calendar, Trophy, Dumbbell, BookOpen, TrendingDown, ChevronRight, Flag } from "lucide-react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useUser } from "@/contexts/UserContext";
import { isFighter } from "@/lib/goalType";

interface CampSection {
  title: string;
  description: string;
  url: string;
  icon: React.ElementType;
  fighterOnly?: boolean;
  primary?: boolean;
  utility?: boolean;
}

const sections: CampSection[] = [
  {
    title: "Training Calendar",
    description: "Schedule sessions, log training and track progress",
    url: "/training-calendar",
    icon: Calendar,
    primary: true,
  },
  {
    title: "Fight Camps",
    description: "Manage camps and plan your preparation phases",
    url: "/fight-camps",
    icon: Trophy,
    fighterOnly: true,
    primary: true,
  },
  {
    title: "Gym Tracker",
    description: "Log gym sessions, track exercises and monitor volume",
    url: "/gym",
    icon: Dumbbell,
  },
  {
    title: "Weight Cut Protocol",
    description: "Manage your cut and rehydration strategy for fight week",
    url: "/weight-cut",
    icon: TrendingDown,
    fighterOnly: true,
  },
  {
    title: "Training Library",
    description: "Browse drills, techniques and training resources",
    url: "/training-library",
    icon: BookOpen,
    utility: true,
  },
];

export default function Camp() {
  const navigate = useNavigate();
  const { profile, userId } = useUser();
  const goalType = (profile?.goal_type as "cutting" | "losing") ?? "cutting";
  const fighter = isFighter(goalType);

  const activeCamp = useQuery(
    api.fight_camp.getActiveCamp,
    userId ? {} : "skip",
  );

  const visible = sections.filter((s) => !s.fighterOnly || fighter);
  const actionSections = visible.filter((s) => !s.utility);
  const referenceSections = visible.filter((s) => s.utility);

  // Progress bar maths — start from camp _creationTime, end at fightDate.
  const campProgress = (() => {
    if (!activeCamp || activeCamp.isCompleted) return null;
    const startMs = activeCamp._creationTime;
    const fightMs = new Date(activeCamp.fightDate).getTime();
    const nowMs = Date.now();
    const totalDays = Math.max(1, Math.round((fightMs - startMs) / 86_400_000));
    const elapsed = Math.max(0, Math.round((nowMs - startMs) / 86_400_000));
    const daysLeft = Math.max(0, Math.round((fightMs - nowMs) / 86_400_000));
    const pct = Math.min(1, elapsed / totalDays);
    const fightLabel = new Date(activeCamp.fightDate).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
    return { totalDays, elapsed, daysLeft, pct, fightLabel };
  })();

  return (
    <div className="animate-page-in space-y-4 px-5 py-3 sm:p-5 md:p-6 w-full max-w-2xl mx-auto">
      {/* Page header */}
      <header className="pt-1">
        <p className="text-micro uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">Your</p>
        <h1 className="text-title font-semibold leading-tight">Camp</h1>
      </header>

      {/* ── Active camp banner ─────────────────────────────────────────── */}
      {activeCamp && !activeCamp.isCompleted && campProgress && (
        <button
          type="button"
          onClick={() => navigate("/fight-camps")}
          className="w-full text-left rounded-xs bg-primary/10 p-4 active:scale-[0.99] transition-transform"
        >
          {/* Top row: name + days left */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Flag className="h-3 w-3 text-primary shrink-0" />
                <p className="text-micro uppercase tracking-wider text-primary/80 font-semibold">
                  Active Camp
                </p>
              </div>
              <p className="text-value font-semibold leading-tight truncate">
                {activeCamp.name}
              </p>
            </div>
            <div className="text-center shrink-0 bg-primary/10 rounded-xs px-3 py-2">
              <p className="text-title font-bold tabular-nums text-primary leading-none">
                {campProgress.daysLeft}
              </p>
              <p className="text-micro uppercase tracking-wider text-primary/70 mt-0.5">
                days left
              </p>
            </div>
          </div>

          {/* Progress bar */}
          <div className="space-y-1.5">
            <div className="h-1.5 rounded-full bg-primary/15 overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-500"
                style={{ width: `${campProgress.pct * 100}%` }}
              />
            </div>
            <div className="flex justify-between">
              <p className="text-micro text-muted-foreground">
                Day {campProgress.elapsed} of {campProgress.totalDays}
              </p>
              <p className="text-micro text-muted-foreground">
                Fight: {campProgress.fightLabel}
              </p>
            </div>
          </div>
        </button>
      )}

      {/* ── Action sections ────────────────────────────────────────────── */}
      <div className="space-y-2">
        <p className="text-micro uppercase tracking-wider text-muted-foreground/60 font-semibold px-0.5">
          Training
        </p>
        <div className="space-y-2">
          {actionSections.map((section) => {
            const Icon = section.icon;
            return (
              <button
                key={section.url}
                type="button"
                onClick={() => navigate(section.url)}
                className={[
                  "w-full rounded-xs p-4 flex items-center gap-3.5 active:scale-[0.99] transition-all text-left",
                  section.primary ? "bg-primary/10" : "card-surface",
                ].join(" ")}
              >
                <div
                  className={[
                    "h-10 w-10 rounded-xs flex items-center justify-center flex-shrink-0",
                    section.primary ? "bg-primary/20" : "bg-muted/30",
                  ].join(" ")}
                >
                  <Icon
                    className={[
                      "h-5 w-5",
                      section.primary ? "text-primary" : "text-muted-foreground",
                    ].join(" ")}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <p
                    className={[
                      "text-body-sm leading-tight",
                      section.primary ? "font-bold text-foreground" : "font-semibold text-foreground",
                    ].join(" ")}
                  >
                    {section.title}
                  </p>
                  <p className="text-note text-muted-foreground leading-snug mt-0.5">
                    {section.description}
                  </p>
                </div>
                <ChevronRight
                  className={[
                    "h-4 w-4 flex-shrink-0",
                    section.primary ? "text-primary/60" : "text-muted-foreground/40",
                  ].join(" ")}
                />
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Reference sections ─────────────────────────────────────────── */}
      {referenceSections.length > 0 && (
        <div className="space-y-2">
          <p className="text-micro uppercase tracking-wider text-muted-foreground/60 font-semibold px-0.5">
            Reference
          </p>
          <div className="space-y-2">
            {referenceSections.map((section) => {
              const Icon = section.icon;
              return (
                <button
                  key={section.url}
                  type="button"
                  onClick={() => navigate(section.url)}
                  className="w-full rounded-xs bg-muted/10 p-4 flex items-center gap-3.5 active:scale-[0.99] transition-all text-left"
                >
                  <div className="h-10 w-10 rounded-xs bg-muted/20 flex items-center justify-center flex-shrink-0">
                    <Icon className="h-5 w-5 text-muted-foreground/70" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-body-sm font-semibold text-muted-foreground leading-tight">
                      {section.title}
                    </p>
                    <p className="text-note text-muted-foreground/60 leading-snug mt-0.5">
                      {section.description}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground/30 flex-shrink-0" />
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
