import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Icon, type IonIconName } from "@/components/ui/Icon";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

interface RecoveryHelpSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * One bottom-sheet explainer covering everything on the Recovery page so the
 * user has a single discoverable home for "what does this mean?". Replaces
 * the old bottom accordion. Structure:
 *   1. How to read this page: actionable, 3-4 sentences
 *   2. Glossary: one row per metric; tap to expand the math
 *
 * Plain English throughout; no em-dashes; no jargon in the headline copy.
 */

type GlossaryItem = {
  key: string;
  icon: IonIconName;
  color: string;
  bg: string;
  title: string;
  summary: string;               // plain meaning, one sentence
  details: string;               // tap-to-expand technical detail
  states?: { label: string; meaning: string; color: string }[];
};

const GLOSSARY: GlossaryItem[] = [
  {
    key: "readiness",
    icon: "heartOutline",
    color: "text-func-recovery-green",
    bg: "bg-func-recovery-green/10",
    title: "Readiness",
    summary: "How prepared your body is to train today, scored 0 to 100. Higher is better.",
    details: "Combines your wellness check-in (sleep, fatigue, soreness, stress), your training load balance, recent recovery patterns, and your logging consistency. It's smoothed across the last few days so one bad night doesn't tank it.",
    states: [
      { label: "Peaked",     meaning: "80+",      color: "text-func-recovery-green" },
      { label: "Ready",      meaning: "55 to 79", color: "text-brand-spirit-blue" },
      { label: "Recovering", meaning: "35 to 54", color: "text-func-warning-yellow" },
      { label: "Strained",   meaning: "under 35", color: "text-func-danger-red" },
    ],
  },
  {
    key: "strain",
    icon: "flameOutline",
    color: "text-func-carbs-orange",
    bg: "bg-func-carbs-orange/10",
    title: "Strain",
    summary: "How hard your training was today, on a 0 to 21 scale. Higher means tougher.",
    details: "Calculated from how long you trained, how hard it felt (RPE), and the type of session. The scale has diminishing returns at the top, so getting from 18 to 20 is way harder than 8 to 10. Mirrors how real fatigue piles up.",
    states: [
      { label: "Light",   meaning: "0 to 7",   color: "text-func-recovery-green" },
      { label: "Moderate", meaning: "8 to 13", color: "text-brand-spirit-blue" },
      { label: "Hard",    meaning: "14 to 17", color: "text-func-warning-yellow" },
      { label: "All Out", meaning: "18 to 21", color: "text-func-danger-red" },
    ],
  },
  {
    key: "ot",
    icon: "shieldOutline",
    color: "text-func-danger-red",
    bg: "bg-func-danger-red/10",
    title: "Overtraining risk",
    summary: "Tracks whether you're piling on too much, too fast.",
    details: "Flags include sudden training spikes, sustained high effort, climbing soreness, and dropping sleep. Multiple flags compound. A good wellness check-in (you actually feel fine) softens the score by one tier.",
    states: [
      { label: "Low",      meaning: "0 to 30",  color: "text-func-recovery-green" },
      { label: "Moderate", meaning: "31 to 60", color: "text-func-warning-yellow" },
      { label: "High",     meaning: "61 to 80", color: "text-func-carbs-orange" },
      { label: "Critical", meaning: "81+",      color: "text-func-danger-red" },
    ],
  },
  {
    key: "training-load",
    icon: "barChartOutline",
    color: "text-brand-spirit-blue",
    bg: "bg-brand-spirit-blue/10",
    title: "Training load",
    summary: "Compares your last 7 days of training to your typical month. Tells you if you're ramping up too fast, holding steady, or backing off.",
    details: "Uses the acute-to-chronic ratio (your 7-day load divided by your 28-day baseline). This card needs at least 14 training days in the last month before the standalone number is trustworthy — until then it shows 'Building'. (Your overall Fight Form score starts factoring training load in sooner.)",
    states: [
      { label: "Building", meaning: "less than 14 training days logged", color: "text-muted-foreground" },
      { label: "Low",      meaning: "below your normal volume",            color: "text-brand-spirit-blue" },
      { label: "Optimal",  meaning: "matches your normal pattern",         color: "text-func-recovery-green" },
      { label: "High",     meaning: "above normal, watch recovery",        color: "text-func-warning-yellow" },
      { label: "Spike",    meaning: "much more than usual, real risk",     color: "text-func-danger-red" },
    ],
  },
  {
    key: "sleep",
    icon: "moonOutline",
    color: "text-brand-night-indigo",
    bg: "bg-brand-night-indigo/10",
    title: "Sleep score",
    summary: "How well-rested you are based on your last 3 nights versus your normal.",
    details: "Sleep is the single biggest recovery lever. Even small deficits add up. This score weights the last 3 nights against your personal baseline once it's established.",
  },
  {
    key: "hooper",
    icon: "speedometerOutline",
    color: "text-func-hydration-cyan",
    bg: "bg-func-hydration-cyan/10",
    title: "Daily check-in score",
    summary: "How you feel today, on a 4 to 28 scale. Higher is better.",
    details: "A validated sports-science survey (Hooper Index) combining sleep, stress, fatigue, and soreness. Rising values signal accumulating fatigue before it shows in your training. If this score is good, it softens load and overtraining warnings.",
  },
  {
    key: "forecast",
    icon: "flashOutline",
    color: "text-func-warning-yellow",
    bg: "bg-func-warning-yellow/10",
    title: "Projected tomorrow",
    summary: "What your strain and risk are likely to look like tomorrow if you train as planned.",
    details: "Extrapolates from your current trajectory. Use it to decide whether tomorrow should be push, steady, or recover. Improves as you log more sessions.",
  },
  {
    key: "coach",
    icon: "bulbOutline",
    color: "text-primary",
    bg: "bg-primary/10",
    title: "Recovery coach",
    summary: "A conversational AI you can ask anything recovery-related.",
    details: "Tell it where you're sore, how you slept, or what session you're considering. It factors in your readiness, load, recent sessions, and a peer-reviewed combat-sports recovery library. Tap the mic to dictate when supported. Free accounts get 1 message per day; Pro is unlimited.",
  },
];

export function RecoveryHelpSheet({ open, onOpenChange }: RecoveryHelpSheetProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const prefersReduced = useReducedMotion();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl max-h-[90vh] overflow-y-auto pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]"
      >
        <SheetHeader>
          <SheetTitle className="text-xl text-center">How to read this page</SheetTitle>
        </SheetHeader>

        {/* How to use: actionable, 3-4 short sentences. Lives at the top so
            users who only read the first card still get value. */}
        <section className="mt-4 space-y-2 text-[13px] leading-snug text-foreground/90">
          <p>
            Start with the <span className="font-semibold">Today's call</span> card up top.
            It tells you whether to push, do a steady session, take it easy, or rest. That's the
            short answer for what to do.
          </p>
          <p>
            Glance at the three <span className="font-semibold">rings</span> for the why:
            Readiness (how prepared you are), Strain (today's load so far), and Overtraining risk
            (if you're piling on too much).
          </p>
          <p>
            Open the <span className="font-semibold">Daily check-in</span> when prompted. It's
            four taps and makes everything on this page personalised to how you actually feel.
          </p>
          <p>
            Use <span className="font-semibold">This week's training load</span> to plan ahead.
            It suggests intent for each remaining day so your week balances out.
          </p>
        </section>

        {/* "Building" callout: directly addresses the cold-start state most
            new users will see for their first two weeks. */}
        <section className="mt-5 rounded-xs border border-func-warning-yellow/30 p-3">
          <p className="text-[11px] uppercase tracking-[0.12em] font-semibold text-func-warning-yellow mb-1">
            Why does it say "Building"?
          </p>
          <p className="text-[12px] text-foreground/85 leading-snug">
            Some scores need at least two weeks of logged training to give an honest read. Until
            then they show "Building" instead of a colour so the page doesn't shout warnings based
            on too little data. Log sessions, check in daily, and the page sharpens automatically.
          </p>
        </section>

        {/* Glossary: tap-to-expand the math, summary line is always visible. */}
        <section className="mt-5">
          <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/70 mb-2">
            What each metric means
          </p>
          <div className="space-y-1.5">
            {GLOSSARY.map((item, i) => {
              const isOpen = expandedKey === item.key;
              return (
                <motion.button
                  key={item.key}
                  type="button"
                  onClick={() => setExpandedKey(isOpen ? null : item.key)}
                  initial={prefersReduced ? false : { opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={
                    prefersReduced
                      ? { duration: 0 }
                      : { type: "spring", stiffness: 320, damping: 26, delay: i * 0.05 }
                  }
                  whileTap={prefersReduced ? undefined : { scale: 0.985 }}
                  className="w-full text-left rounded-xs border border-border/30 overflow-hidden active:bg-muted/20 transition-colors"
                >
                  <div className="flex items-start gap-2.5 p-3">
                    <div className={`w-7 h-7 rounded-full ${item.bg} flex items-center justify-center shrink-0 mt-0.5`}>
                      <Icon name={item.icon} size={14} className={item.color} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[13px] font-semibold text-foreground">{item.title}</span>
                        <motion.span
                          className="inline-flex shrink-0 text-muted-foreground/50"
                          animate={{ rotate: isOpen ? 180 : 0 }}
                          transition={
                            prefersReduced
                              ? { duration: 0 }
                              : { type: "spring", stiffness: 320, damping: 26 }
                          }
                        >
                          <Icon name="chevronDownOutline" size={14} />
                        </motion.span>
                      </div>
                      <p className="text-[12px] text-muted-foreground leading-snug mt-0.5">
                        {item.summary}
                      </p>
                    </div>
                  </div>

                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div
                        key="details"
                        initial={prefersReduced ? false : { height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={prefersReduced ? { opacity: 0 } : { height: 0, opacity: 0 }}
                        transition={
                          prefersReduced
                            ? { duration: 0 }
                            : { type: "spring", stiffness: 320, damping: 30 }
                        }
                        className="overflow-hidden"
                      >
                        <div className="px-3 pb-3 pl-12 space-y-2.5">
                          <p className="text-[12px] text-foreground/80 leading-relaxed">
                            {item.details}
                          </p>
                          {item.states && (
                            <div className="flex flex-wrap gap-1.5">
                              {item.states.map((s) => (
                                <div
                                  key={s.label}
                                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border/30"
                                >
                                  <span className={`text-[10px] font-bold ${s.color}`}>{s.label}</span>
                                  <span className="text-[10px] text-muted-foreground/70">{s.meaning}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.button>
              );
            })}
          </div>
        </section>

        <p className="text-[11px] text-muted-foreground/70 text-center mt-5">
          The more you log, the smarter and more personalised the page gets.
        </p>
      </SheetContent>
    </Sheet>
  );
}
