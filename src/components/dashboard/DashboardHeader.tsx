import { memo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

interface DashboardHeaderProps {
  avatarUrl?: string | null;
  userName?: string | null;
  daysUntilTarget: number;
  onAvatarClick: () => void;
}

export const DashboardHeader = memo(function DashboardHeader({
  avatarUrl,
  userName,
  daysUntilTarget,
  onAvatarClick,
}: DashboardHeaderProps) {
  return (
    <>
      <header className="relative flex items-center justify-between gap-3 pt-1">
        <button
          onClick={onAvatarClick}
          className="active:opacity-70 transition-opacity"
          aria-label="Edit profile"
        >
          <Avatar className="h-10 w-10">
            <AvatarImage src={avatarUrl ?? undefined} />
            <AvatarFallback
              className="text-note font-semibold"
              style={{ backgroundColor: '#162137', color: '#8C96B4' }}
            >
              {userName?.[0]?.toUpperCase() ?? 'U'}
            </AvatarFallback>
          </Avatar>
        </button>

        {daysUntilTarget > 0 && (
          <div
            className="flex items-center h-10 px-3 rounded-xs"
            style={{
              background: 'rgba(0, 5, 19, 0.6)',
              backdropFilter: 'blur(20px) saturate(160%)',
              WebkitBackdropFilter: 'blur(20px) saturate(160%)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <p className="text-note font-semibold tabular-nums whitespace-nowrap text-foreground">
              {daysUntilTarget} days left until weigh-in
            </p>
          </div>
        )}
      </header>

      {/* Date — small caps Inter Light, with breathing room from the
          top row above. */}
      <div className="pt-1">
        <p className="text-micro uppercase tracking-[0.15em] font-light text-muted-foreground/70">
          {new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
        </p>
      </div>
    </>
  );
});

DashboardHeader.displayName = "DashboardHeader";
