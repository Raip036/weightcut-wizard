import { Link } from "react-router-dom";
import { ImpactStyle } from "@capacitor/haptics";
import { Scale, Dumbbell, Moon, Heart, Utensils } from "lucide-react";
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
  { key: "weight", label: "Weight", href: "/weight", Icon: Scale },
  { key: "training", label: "Training", href: "/training-calendar", Icon: Dumbbell },
  { key: "sleep", label: "Sleep", href: "/sleep", Icon: Moon },
  { key: "wellness", label: "Wellness", href: "/recovery", Icon: Heart },
  { key: "meals", label: "Meals", href: "/nutrition", Icon: Utensils },
];

export default function TodayStrip({ adherence, mealsLoggedToday }: Props) {
  const logged: Record<PillKey, boolean> = {
    weight: adherence.weight,
    training: adherence.training,
    sleep: adherence.sleep,
    wellness: adherence.wellnessCheckin,
    meals: mealsLoggedToday,
  };
  const allSet = PILLS.every((p) => logged[p.key]);

  return (
    <div
      className={cn(
        "flex items-stretch gap-1.5 w-full",
        allSet && "border-b border-primary/40 pb-1",
      )}
    >
      {PILLS.map(({ key, label, href, Icon }) => {
        const isLogged = logged[key];
        return (
          <Link
            key={key}
            to={href}
            onClick={() => { void triggerHaptic(ImpactStyle.Light); }}
            className={cn(
              "flex-1 min-h-[44px] rounded-md flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 transition-colors",
              isLogged
                ? "bg-primary/15 border border-primary/30 text-foreground"
                : "border border-border text-muted-foreground active:bg-muted/40",
            )}
            aria-label={`${label}${isLogged ? " logged" : " not logged"}`}
          >
            <Icon
              className={cn(
                "h-4 w-4",
                isLogged ? "text-primary" : "text-muted-foreground",
              )}
              strokeWidth={2.2}
            />
            <span className="text-[10px] font-semibold leading-none">
              {label}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

export { TodayStrip };
