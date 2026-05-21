import { format, isSameDay } from "date-fns";
import { triggerHapticSelection } from "@/lib/haptics";

interface CalendarMonthGridProps {
  daysInMonth: Date[];
  selectedDate: Date;
  sessions: { date: string }[];
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
          const hasSession = sessions.some(s => s.date === dateStr);
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
              {hasSession && (
                <div className="absolute bottom-1 w-1 h-1 rounded-full bg-primary" />
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
