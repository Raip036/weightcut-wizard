import { Link } from "react-router-dom";
import { ImpactStyle } from "@capacitor/haptics";
import { Scale, Dumbbell, Moon, Heart, Utensils, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { triggerHaptic } from "@/lib/haptics";

export type Adherence = {
  weight: boolean;
  training: boolean;
  sleep: boolean;
  wellnessCheckin: boolean;
};

type Props = {
  adherence: Adherence;
  mealsLoggedToday: boolean;
};

type PillKey = "weight" | "training" | "sleep" | "wellness" | "meals";

const PILLS: Array<{
  key: PillKey;
  label: string;
  href: string;
  Icon: typeof Scale;
}> = [
  { key: "weight",   label: "Weight",   href: "/weight",            Icon: Scale    },
  { key: "training", label: "Training", href: "/training-calendar", Icon: Dumbbell },
  { key: "sleep",    label: "Sleep",    href: "/sleep",             Icon: Moon     },
  { key: "wellness", label: "Wellness", href: "/recovery",          Icon: Heart    },
  { key: "meals",    label: "Meals",    href: "/nutrition",         Icon: Utensils },
];

export default function TodayStrip({ adherence, mealsLoggedToday }: Props) {
  const logged: Record<PillKey, boolean> = {
    weight:   adherence.weight,
    training: adherence.training,
    sleep:    adherence.sleep,
    wellness: adherence.wellnessCheckin,
    meals:    mealsLoggedToday,
  };

  const doneCount = PILLS.filter((p) => logged[p.key]).length;
  const total = PILLS.length;
  const allSet = doneCount === total;

  return (
    <div className="card-surface rounded-xs px-3 pt-3 pb-4 space-y-2.5">
      {/* Header row — label + count */}
      <div className="flex items-center justify-between">
        <p className="font-display text-note font-semibold">Today's log</p>
        <p className={cn(
          "text-note font-semibold tabular-nums",
          allSet ? "text-func-recovery-green" : "text-muted-foreground",
        )}>
          {doneCount} / {total}
          {allSet && <Check className="inline h-3.5 w-3.5 ml-1 mb-0.5" strokeWidth={3} />}
        </p>
      </div>

      {/* Progress bar */}
      <div className="h-2 w-full rounded-full bg-muted/50 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all duration-500",
            allSet ? "bg-func-recovery-green" : "bg-primary",
          )}
          style={{ width: `${(doneCount / total) * 100}%` }}
        />
      </div>

      {/* Pills */}
      <div className="flex items-stretch gap-1.5 w-full">
        {PILLS.map(({ key, label, href, Icon }) => {
          const isLogged = logged[key];
          return (
            <Link
              key={key}
              to={href}
              onClick={() => { void triggerHaptic(ImpactStyle.Light); }}
              className={cn(
                "relative flex-1 min-h-[52px] rounded-md flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 transition-colors",
                isLogged
                  ? "bg-primary text-primary-foreground border border-primary"
                  : "border border-border/60 text-muted-foreground active:bg-muted/40",
              )}
              aria-label={`${label}${isLogged ? " logged" : " not logged"}`}
            >
              <Icon
                className={cn(
                  "h-4 w-4",
                  isLogged ? "text-primary-foreground" : "text-muted-foreground",
                )}
                strokeWidth={2.2}
              />
              <span
                className={cn(
                  "text-[10px] font-semibold leading-none",
                  isLogged ? "text-primary-foreground" : "text-muted-foreground",
                )}
              >
                {label}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export { TodayStrip };
