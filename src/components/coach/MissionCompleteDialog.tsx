import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "@/components/ui/Icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { celebrateSuccess } from "@/lib/haptics";
import { disciplineToken, disciplineLabel } from "@/lib/coachColors";
import { cn } from "@/lib/utils";

interface MissionCompleteDialogProps {
  /** Controls dialog visibility. */
  open: boolean;
  /** Called when the user dismisses the dialog. */
  onOpenChange: (open: boolean) => void;
  /** Title of the just-completed mission. */
  missionTitle: string;
  /** Sport key (matches fight_camp_calendar.sessionType). */
  sport: string;
  /** Total XP awarded by this tick (item + completion bonus). Defaults to 0. */
  xpAwarded?: number;
  /** Whether this tick pushed the user into a higher discipline level. */
  leveledUp?: boolean;
}

/**
 * Celebration modal fired the instant the final item in a mission is
 * checked off. Plays a success haptic on open and gives the user two
 * obvious exits — view the calendar to log the next session (which will
 * trigger the next mission's generation server-side) or just dismiss.
 */
export function MissionCompleteDialog({
  open,
  onOpenChange,
  missionTitle,
  sport,
  xpAwarded = 0,
  leveledUp = false,
}: MissionCompleteDialogProps) {
  const navigate = useNavigate();
  const token = disciplineToken(sport);
  const label = disciplineLabel(sport);

  // Fire the success haptic exactly when the dialog opens. Repeated
  // opens (e.g. parent re-renders) won't double-fire because the effect
  // depends on `open`.
  useEffect(() => {
    if (open) celebrateSuccess();
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <div className="flex flex-col items-center text-center gap-3 pt-2">
          {/* Trophy + coloured ring so the celebration carries the
              discipline's identity rather than a generic primary blue.
              On a level-up we punch the ring opacity up to make the moment
              feel weightier without introducing a new colour. */}
          <div
            className="h-14 w-14 rounded-full flex items-center justify-center"
            style={{
              backgroundColor: `hsl(var(${token}) / ${leveledUp ? 0.32 : 0.18})`,
            }}
          >
            <span style={{ color: `hsl(var(${token}))` }}>
              <Icon name="trophyOutline" size={28} />
            </span>
          </div>

          <span
            className={cn(
              "inline-flex items-center h-6 px-2.5 rounded-full",
              "text-[11px] font-bold uppercase tracking-wider",
            )}
            style={{
              backgroundColor: `hsl(var(${token}) / 0.15)`,
              color: `hsl(var(${token}))`,
            }}
          >
            {label}
          </span>

          {/* XP splash — only shown when the backend actually awarded XP. */}
          {xpAwarded > 0 && (
            <span
              className="inline-flex items-center h-6 px-2.5 rounded-full text-[11px] font-bold uppercase tracking-wider tabular-nums"
              style={{
                backgroundColor: `hsl(var(${token}) / 0.18)`,
                color: `hsl(var(${token}))`,
              }}
            >
              +{xpAwarded} XP
            </span>
          )}

          <DialogTitle className="text-xl font-bold">
            {leveledUp ? "Level Up! 🎉" : "Mission Complete!"}
          </DialogTitle>

          <p className="text-body-sm font-semibold text-foreground leading-snug">
            {missionTitle}
          </p>

          <DialogDescription className="text-note text-muted-foreground leading-relaxed">
            Log your next session to start your next mission.
          </DialogDescription>
        </div>

        <div className="flex flex-col gap-2 pt-2">
          <Button
            type="button"
            variant="default"
            className="w-full"
            onClick={() => {
              onOpenChange(false);
              navigate("/training-calendar");
            }}
          >
            View calendar
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
