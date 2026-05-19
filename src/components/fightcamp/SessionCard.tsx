import { memo, useMemo } from "react";
import { Moon, Check, Image } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getSessionColor, COLOR_PALETTE } from "@/lib/sessionColors";
import { decodeRunMeta } from "@/lib/runMeta";
// Local row type — mirrors the shape produced by TrainingCalendar.tsx's queryMonth() mapper.
interface TrainingCalendarRow {
  id: string;
  user_id: string;
  date: string;
  session_type: string;
  duration_minutes: number;
  rpe: number;
  intensity: string;
  intensity_level: number | null;
  bodyweight: number | null;
  fatigue_level: number | null;
  soreness_level: number | null;
  sleep_hours: number | null;
  sleep_quality: string | null;
  mobility_done: boolean | null;
  notes: string | null;
  media_url: string | null;
  created_at: string | null;
}

interface SessionCardProps {
  session: TrainingCalendarRow;
  customColors: Record<string, string>;
  userId: string | null;
  onView: (session: TrainingCalendarRow) => void;
  onColorChange: (sessionType: string, color: string) => void;
}

export const SessionCard = memo(function SessionCard({ session, customColors, userId, onView, onColorChange }: SessionCardProps) {
  const isRest = session.session_type === 'Rest';
  const isRun = session.session_type === 'Run';
  const sessionColor = getSessionColor(session.session_type, customColors);
  const intensityDisplay = session.intensity_level
    ?? (session.intensity === 'high' ? 5 : session.intensity === 'moderate' ? 3 : 1);
  const { meta: runMeta, notes: cleanNotes } = useMemo(
    () => isRun ? decodeRunMeta(session.notes) : { meta: null, notes: session.notes ?? "" },
    [isRun, session.notes]
  );

  return (
    <div
      className="rounded-2xl bg-muted/15 px-3.5 py-3 cursor-pointer active:bg-muted/25 transition-colors"
      onClick={() => onView(session)}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Popover>
            <PopoverTrigger asChild>
              <button
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: sessionColor }}
                onClick={(e) => e.stopPropagation()}
              />
            </PopoverTrigger>
            <PopoverContent className="w-auto p-3" side="bottom" align="start" onClick={(e) => e.stopPropagation()}>
              <div className="grid grid-cols-4 gap-2">
                {COLOR_PALETTE.map(color => (
                  <button key={color} className="w-8 h-8 rounded-full flex items-center justify-center ring-1 ring-white/10 hover:scale-110 transition-transform" style={{ backgroundColor: color }}
                    onClick={() => { if (userId) onColorChange(session.session_type, color); }}>
                    {sessionColor === color && <Check className="w-4 h-4 text-white drop-shadow-md" />}
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <span className="text-[13px] font-semibold text-foreground">{session.session_type}</span>
        </div>
        {session.media_url && <Image className="w-3.5 h-3.5 text-foreground/50" />}
      </div>

      {/* Stats row */}
      {isRest ? (
        <div className="flex items-center gap-4">
          {session.sleep_quality && (
            <div>
              <p className="text-[10px] text-foreground/60">Sleep</p>
              <p className="text-[17px] font-bold tabular-nums text-foreground">{session.sleep_quality}</p>
            </div>
          )}
          {session.fatigue_level != null && (
            <div>
              <p className="text-[10px] text-foreground/60">Fatigue</p>
              <p className="text-[17px] font-bold tabular-nums text-foreground">{session.fatigue_level}<span className="text-[11px] font-normal text-foreground/50">/10</span></p>
            </div>
          )}
          {session.mobility_done && (
            <div>
              <p className="text-[10px] text-foreground/60">Mobility</p>
              <div className="flex items-center gap-1 mt-0.5">
                <Check className="w-3.5 h-3.5 text-green-400" />
                <span className="text-[13px] font-medium text-green-400">Done</span>
              </div>
            </div>
          )}
        </div>
      ) : isRun && runMeta ? (
        <div className="flex items-center gap-4">
          <div>
            <p className="text-[10px] text-foreground/60">Distance</p>
            <p className="text-[17px] font-bold tabular-nums text-foreground">{runMeta.distance}<span className="text-[11px] font-normal text-foreground/50 ml-0.5">{runMeta.unit}</span></p>
          </div>
          {runMeta.time && (
            <div>
              <p className="text-[10px] text-foreground/60">Time</p>
              <p className="text-[17px] font-bold tabular-nums" style={{ color: sessionColor }}>{runMeta.time}</p>
            </div>
          )}
          {runMeta.pace && (
            <div>
              <p className="text-[10px] text-foreground/60">Pace</p>
              <p className="text-[17px] font-bold tabular-nums text-foreground">{runMeta.pace}<span className="text-[11px] font-normal text-foreground/50 ml-0.5">/{runMeta.unit}</span></p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-4">
          <div>
            <p className="text-[10px] text-foreground/60">Duration</p>
            <p className="text-[17px] font-bold tabular-nums text-foreground">{session.duration_minutes}<span className="text-[11px] font-normal text-foreground/50 ml-0.5">min</span></p>
          </div>
          <div>
            <p className="text-[10px] text-foreground/60">RPE</p>
            <p className="text-[17px] font-bold tabular-nums" style={{ color: sessionColor }}>{session.rpe}<span className="text-[11px] font-normal text-foreground/50">/10</span></p>
          </div>
          <div>
            <p className="text-[10px] text-foreground/60">Intensity</p>
            <p className="text-[17px] font-bold tabular-nums text-foreground">{intensityDisplay}<span className="text-[11px] font-normal text-foreground/50">/5</span></p>
          </div>
        </div>
      )}

      {/* Secondary pills */}
      {!isRest && ((session.soreness_level ?? 0) > 0 || (session.sleep_hours ?? 0) > 0) && (
        <div className="flex items-center gap-1.5 mt-2">
          {(session.soreness_level ?? 0) > 0 && (
            <span className="text-[11px] font-medium text-red-400/80">Sore {session.soreness_level}/10</span>
          )}
          {(session.soreness_level ?? 0) > 0 && (session.sleep_hours ?? 0) > 0 && <span className="text-foreground/15">·</span>}
          {(session.sleep_hours ?? 0) > 0 && (
            <span className="text-[11px] font-medium text-indigo-400/80">
              <Moon className="w-3 h-3 inline -mt-0.5 mr-0.5" />{session.sleep_hours}h
            </span>
          )}
        </div>
      )}

      {/* Notes */}
      {(isRun ? cleanNotes : session.notes) && (
        <p className="mt-2 text-[12px] text-foreground/60 line-clamp-2 leading-relaxed">
          {isRun ? cleanNotes : session.notes}
        </p>
      )}
    </div>
  );
});
