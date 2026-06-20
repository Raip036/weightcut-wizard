// Protocol Changes Lab — /protocol-lab — THROWAWAY preview of the rehydration
// plan refinements (plain phase names, neutral "Fuel up" markers, bottom
// meal-ideas box, walkout fast-carb hint). Renders the REAL RehydrationTimeline
// with data from the REAL buildRehydrationHourlyPlan algorithm. Delete this
// file + the /protocol-lab route in App.tsx once reviewed.
import { useMemo } from "react";
import {
  RehydrationTimeline,
  type RehydrationAnchor,
} from "@/components/protocol/RehydrationTimeline";
import { buildRehydrationHourlyPlan } from "@/../convex/_shared/weightProtocolMath";

function PhoneFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-[11px] font-bold uppercase tracking-[0.18em] text-func-recovery-green">
        {label}
      </span>
      <div
        className="dark relative overflow-hidden rounded-[40px] border-[10px] border-black shadow-2xl"
        style={{ width: 372, height: 780, background: "hsl(0 0% 6%)" }}
      >
        <div
          className="h-full overflow-y-auto overscroll-contain px-5 py-5 scrollbar-hide text-foreground"
          style={{ background: "hsl(0 0% 6%)" }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export default function ProtocolChangesLab() {
  const nextDay = useMemo(
    () =>
      buildRehydrationHourlyPlan({
        deficitLitres: 3,
        hoursUntilFight: 28,
        sleepStartHour: 23,
        sleepEndHour: 7,
        weighInClockHour: 17,
        bodyMassKg: 80,
      }),
    [],
  );
  const sameDay = useMemo(
    () =>
      buildRehydrationHourlyPlan({
        deficitLitres: 3,
        hoursUntilFight: 3,
        sleepStartHour: null,
        sleepEndHour: null,
        weighInClockHour: 11,
        bodyMassKg: 80,
      }),
    [],
  );

  return (
    <div className="dark min-h-screen w-full bg-background text-foreground">
      <header className="border-b border-border/40 px-6 py-6">
        <p className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70 font-semibold">
          Rehydration plan · refinements
        </p>
        <h1 className="mt-1 text-[22px] font-bold font-display">Rehydration preview</h1>
        <p className="mt-1.5 max-w-2xl text-[13px] text-muted-foreground leading-snug">
          Real component + real algorithm. Phase cards are titled by their bold
          hour range (Sleep &amp; Walkout keep a small label); meal rows show a centered
          MEAL pill + carb target (no prescribed dish); a Meal ideas box + foods-to-avoid
          sits at the bottom, and Walkout has a fast-carb hint. Expand the phase cards.
        </p>
      </header>

      <div className="flex flex-wrap items-start justify-center gap-8 px-6 py-10">
        <PhoneFrame label="Next-day · 28h (sleep block)">
          <RehydrationTimeline
            anchors={nextDay.hours as RehydrationAnchor[]}
            gapHours={28}
            totalLitresTarget={nextDay.totalLitresScheduled}
            deficitTooLarge={nextDay.deficitTooLarge}
          />
        </PhoneFrame>
        <PhoneFrame label="Same-day · 3h (shortfall)">
          <RehydrationTimeline
            anchors={sameDay.hours as RehydrationAnchor[]}
            gapHours={3}
            totalLitresTarget={sameDay.totalLitresScheduled}
            deficitTooLarge={sameDay.deficitTooLarge}
          />
        </PhoneFrame>
      </div>
    </div>
  );
}
