import { memo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface DashboardHeaderProps {
  avatarUrl?: string | null;
  userName?: string | null;
  /** Minimal streak chip rendered inline beside the date. */
  streakSlot?: React.ReactNode;
  onAvatarClick: () => void;
}

export const DashboardHeader = memo(function DashboardHeader({
  avatarUrl,
  userName,
  streakSlot,
  onAvatarClick,
}: DashboardHeaderProps) {
  return (
    <div className="pb-1.5">
      <header className="relative flex items-center justify-between gap-3 pt-1">
        <button
          onClick={onAvatarClick}
          data-tutorial="profile-avatar"
          className="active:opacity-70 transition-opacity"
          aria-label="Edit profile"
        >
          <Avatar className="h-10 w-10">
            <AvatarImage src={avatarUrl ?? undefined} />
            <AvatarFallback
              className="text-note font-semibold"
              style={{ backgroundColor: "#162137", color: "#8C96B4" }}
            >
              {userName?.[0]?.toUpperCase() ?? "U"}
            </AvatarFallback>
          </Avatar>
        </button>
      </header>

      {/* Date, small caps Inter Light. Hugs the avatar row above (tight
          mt) so it reads as a unit; the wrapper's pb-1.5 + the parent
          space-y gap give it breathing room from the ring below. */}
      <div className="mt-2.5 pl-0.5 flex items-center justify-between gap-3">
        <p className="text-micro uppercase tracking-[0.15em] font-light text-muted-foreground/70">
          {new Date().toLocaleDateString("en-US", {
            weekday: "long",
            month: "short",
            day: "numeric",
          })}
        </p>
        {streakSlot}
      </div>
    </div>
  );
});

DashboardHeader.displayName = "DashboardHeader";
