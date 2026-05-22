import { Link } from "react-router-dom";
import { ImpactStyle } from "@capacitor/haptics";
import { Icon, type IonIconName } from "@/components/ui/Icon";
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
  icon: IonIconName;
}> = [
  { key: "weight",   label: "Weight",   href: "/weight",            icon: "speedometerOutline" },
  { key: "training", label: "Training", href: "/training-calendar", icon: "barbellOutline"    },
  { key: "sleep",    label: "Sleep",    href: "/sleep",             icon: "moonOutline"       },
  { key: "wellness", label: "Wellness", href: "/recovery",          icon: "heartOutline"      },
  { key: "meals",    label: "Meals",    href: "/nutrition",         icon: "restaurantOutline" },
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
    <div className="card-surface card-glow rounded-2xl px-3 pt-3 pb-4 space-y-2.5">
      {/* Header row — label + count */}
      <div className="flex items-center justify-between">
        <p className="font-display text-note font-semibold">Today's log</p>
        <p className={cn(
          "text-note font-semibold tabular-nums",
          allSet ? "text-func-recovery-green" : "text-muted-foreground",
        )}>
          {doneCount} / {total}
          {allSet && <Icon name="checkmarkOutline" size={14} className="inline ml-1 mb-0.5" />}
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
        {PILLS.map(({ key, label, href, icon }) => {
          const isLogged = logged[key];
          // Send users straight into the dedicated full-screen check-in
          // when wellness isn't done yet; once logged, route back to the
          // recovery dashboard so they can review their stats.
          const finalHref =
            key === "wellness" && !isLogged ? "/recovery/check-in" : href;
          return (
            <Link
              key={key}
              to={finalHref}
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
                name={icon}
                size={16}
                className={isLogged ? "text-primary-foreground" : "text-muted-foreground"}
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
