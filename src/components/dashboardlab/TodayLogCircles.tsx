// MOCKUP - dashboard redesign lab. Delete after sign-off.
import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { Scale, Utensils, Dumbbell, Moon, HeartPulse, Check } from "lucide-react";
import { triggerHapticSelection, triggerHapticSuccess } from "@/lib/haptics";

export interface TodayLogItem {
  key: string;
  label: string;
  icon: LucideIcon;
  done: boolean;
}

const DEFAULT_ITEMS: TodayLogItem[] = [
  { key: "weight", label: "Weight", icon: Scale, done: true },
  { key: "nutrition", label: "Nutrition", icon: Utensils, done: true },
  { key: "training", label: "Training", icon: Dumbbell, done: false },
  { key: "sleep", label: "Sleep", icon: Moon, done: false },
  { key: "wellness", label: "Wellness", icon: HeartPulse, done: true },
];

// Spring-y ease for the celebratory pop (overshoots slightly, settles).
const SPRING = "cubic-bezier(0.34, 1.56, 0.64, 1)";

interface TodayLogCirclesProps {
  initialItems?: TodayLogItem[];
  showEyebrow?: boolean;
  onToggle?: (key: string, done: boolean) => void;
}

export default function TodayLogCircles({
  initialItems = DEFAULT_ITEMS,
  showEyebrow = true,
  onToggle = () => {},
}: TodayLogCirclesProps) {
  const [items, setItems] = useState<TodayLogItem[]>(initialItems);
  const [celebrating, setCelebrating] = useState(false);
  const [poppingKey, setPoppingKey] = useState<string | null>(null);

  const doneCount = items.filter((i) => i.done).length;
  const allDone = doneCount === items.length;

  const wasAllDone = useRef(allDone);
  const celebrateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const popTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Rising edge: the moment the last circle completes the set.
  useEffect(() => {
    if (allDone && !wasAllDone.current) {
      setCelebrating(true);
      triggerHapticSuccess();
      if (celebrateTimer.current) clearTimeout(celebrateTimer.current);
      celebrateTimer.current = setTimeout(() => setCelebrating(false), 1300);
    }
    wasAllDone.current = allDone;
  }, [allDone]);

  useEffect(
    () => () => {
      if (celebrateTimer.current) clearTimeout(celebrateTimer.current);
      if (popTimer.current) clearTimeout(popTimer.current);
    },
    [],
  );

  const toggle = (key: string) => {
    const current = items.find((i) => i.key === key);
    const becomingDone = current ? !current.done : false;
    setItems((prev) =>
      prev.map((i) => (i.key === key ? { ...i, done: !i.done } : i)),
    );
    onToggle(key, becomingDone);

    triggerHapticSelection();
    if (becomingDone) {
      setPoppingKey(key);
      if (popTimer.current) clearTimeout(popTimer.current);
      popTimer.current = setTimeout(() => setPoppingKey(null), 460);
    }
  };

  return (
    <section className="relative">
      {/* scoped keyframes — throwaway, no global CSS touched */}
      <style>{`
        @keyframes tlPop {
          0% { transform: scale(1); }
          45% { transform: scale(1.16); }
          100% { transform: scale(1); }
        }
        @keyframes tlGlowBurst {
          0% { opacity: 0; transform: scale(0.7); }
          28% { opacity: 0.85; }
          100% { opacity: 0; transform: scale(1.5); }
        }
        @keyframes tlBannerIn {
          0% { opacity: 0; transform: translateY(5px) scale(0.94); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>

      {showEyebrow && (
        <div className="mb-3 flex items-center justify-between">
          <p className="section-header">TODAY&apos;S LOG</p>
          {allDone ? (
            <span
              className="flex items-center gap-1.5 text-[11px] font-semibold"
              style={{
                color: "hsl(var(--primary))",
                animation: celebrating ? `tlBannerIn 0.5s ${SPRING} both` : undefined,
              }}
            >
              <Check className="h-3.5 w-3.5" strokeWidth={3} />
              Today complete
            </span>
          ) : (
            <p className="text-[11px] text-muted-foreground">
              {doneCount}/{items.length} done
            </p>
          )}
        </div>
      )}

      <div className="relative flex items-start justify-between gap-2">
        {/* soft glow that expands behind the row when the set completes */}
        {celebrating && (
          <span
            aria-hidden
            className="pointer-events-none absolute left-1/2 top-7 -z-0 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              background:
                "radial-gradient(circle, hsl(var(--primary) / 0.40), transparent 65%)",
              animation: "tlGlowBurst 1.1s ease-out both",
            }}
          />
        )}

        {items.map(({ key, label, icon: Icon, done }, idx) => {
          const animation = celebrating
            ? `tlPop 0.5s ${SPRING} ${idx * 70}ms both`
            : poppingKey === key
              ? `tlPop 0.46s ${SPRING} both`
              : undefined;

          return (
            <button
              key={key}
              type="button"
              onClick={() => toggle(key)}
              className="card-press relative z-10 flex flex-1 flex-col items-center gap-2"
              aria-label={`${label}${done ? ", logged" : ", not logged"}`}
            >
              <span
                className="relative flex h-14 w-14 items-center justify-center rounded-full transition-all duration-300"
                style={{
                  ...(done
                    ? {
                        backgroundColor: "hsl(var(--primary))",
                        boxShadow:
                          "0 6px 18px -4px hsl(var(--primary) / 0.55), inset 0 1px 0 rgba(255,255,255,0.22)",
                      }
                    : {
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(0 0% 100% / 0.10)",
                      }),
                  animation,
                }}
              >
                <Icon
                  className="relative h-[22px] w-[22px]"
                  strokeWidth={done ? 2.4 : 2}
                  style={{ color: done ? "#fff" : "hsl(var(--muted-foreground))" }}
                />

                {done && (
                  <span
                    aria-hidden
                    className="absolute -right-0.5 -top-0.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-background"
                    style={{ backgroundColor: "hsl(var(--secondary))" }}
                  >
                    <Check className="h-2.5 w-2.5 text-white" strokeWidth={3.5} />
                  </span>
                )}
              </span>

              <span
                className="text-[11px] leading-none transition-colors duration-300"
                style={{
                  color: done
                    ? "hsl(var(--foreground) / 0.85)"
                    : "hsl(var(--muted-foreground))",
                }}
              >
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
