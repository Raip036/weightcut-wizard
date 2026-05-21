import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { motion, LayoutGroup } from "motion/react";
import { triggerHapticSelection } from "@/lib/haptics";
import FightWeek from "./FightWeek";
import Hydration from "./Hydration";

const tabs = [
  { key: "plan" as const, label: "Fight Plan" },
  { key: "rehydration" as const, label: "Rehydration" },
];

export default function WeightCut() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialTab = searchParams.get("tab") === "rehydration" ? "rehydration" : "plan";
  const [tab, setTab] = useState<"plan" | "rehydration">(initialTab);

  const switchTab = (t: "plan" | "rehydration") => {
    if (tab === t) return;
    setTab(t);
    triggerHapticSelection();
    setSearchParams(t === "plan" ? {} : { tab: t }, { replace: true });
  };

  return (
    <div className="animate-page-in px-5 py-3 sm:p-5 md:p-6 max-w-7xl mx-auto space-y-3 pb-20 md:pb-6">
      {/* iOS-native segmented control with sliding pill */}
      <LayoutGroup id="weight-cut-tab">
        <div role="tablist" className="relative flex bg-muted/40 dark:bg-white/[0.06] rounded-xs p-1 border border-border/30">
          {tabs.map((t) => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={active}
                onClick={() => switchTab(t.key)}
                className="relative flex-1 h-10 rounded-xs text-[14px] font-semibold active:scale-[0.98] transition-transform"
              >
                {active && (
                  <motion.div
                    layoutId="weight-cut-tab-pill"
                    className="absolute inset-0 rounded-xs bg-background shadow-sm ring-1 ring-border/30"
                    transition={{ type: "spring", damping: 28, stiffness: 380 }}
                  />
                )}
                <motion.span
                  className="relative z-10"
                  animate={{ color: active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))" }}
                  transition={{ duration: 0.18 }}
                >
                  {t.label}
                </motion.span>
              </button>
            );
          })}
        </div>
      </LayoutGroup>

      {/* Tab content */}
      {tab === "plan" ? <FightWeek /> : <Hydration />}
    </div>
  );
}
