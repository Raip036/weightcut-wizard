import { format, isSameDay } from "date-fns";
import { triggerHapticSelection } from "@/lib/haptics";
import { Icon } from "@/components/ui/Icon";

interface CalendarMonthGridProps {
  daysInMonth: Date[];
  selectedDate: Date;
  // `session_type` is optional so existing callers passing the minimal
  // `{ date }[]` shape still type-check. When present, rest-only days
  // render the moon marker instead of the primary session dot.
  sessions: { date: string; session_type?: string }[];
  onSelectDate: (day: Date) => void;
}

export function CalendarMonthGrid({ daysInMonth, selectedDate, sessions, onSelectDate }: CalendarMonthGridProps) {
  return (
    <>
      <div className="grid grid-cols-7 gap-1 text-center mb-2">
        {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, i) => (
          <div key={i} className="text-xs font-semibold text-muted-foreground">{day}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {Array.from({ length: daysInMonth[0].getDay() }).map((_, i) => (
          <div key={`empty-${i}`} />
        ))}
        {daysInMonth.map((day) => {
          const dateStr = format(day, 'yyyy-MM-dd');
          const entries = sessions.filter(s => s.date === dateStr);
          const hasRealSession = entries.some(s => s.session_type !== "Rest");
          const restOnly = !hasRealSession && entries.some(s => s.session_type === "Rest");
          const hasSession = entries.length > 0;
          const isSelected = isSameDay(day, selectedDate);
          const isToday = isSameDay(day, new Date());

          return (
            <div
              key={day.toISOString()}
              className="aspect-square flex flex-col items-center justify-center relative touch-target"
              onClick={() => { onSelectDate(day); triggerHapticSelection(); }}
            >
              <div className={`
                w-8 h-8 flex items-center justify-center rounded-full text-sm font-medium transition-all
                ${isSelected ? 'bg-primary text-primary-foreground' : 'hover:bg-accent'}
                ${isToday && !isSelected ? 'text-primary font-bold' : ''}
              `}>
                {format(day, 'd')}
              </div>
              {restOnly ? (
                <div
                  className={`absolute bottom-1 inline-flex items-center justify-center ${
                    isSelected ? "text-primary-foreground/70" : "text-muted-foreground/60"
                  }`}
                  aria-hidden
                >
                  <Icon name="moonOutline" size={8} />
                </div>
              ) : hasSession && (
                <div className="absolute bottom-1 w-1 h-1 rounded-full bg-primary" />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
