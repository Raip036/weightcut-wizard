import { useState, useMemo, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Droplets,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
  ChevronRight,
  Info,
  BookOpen,
  Beaker,
  Activity,
  Zap,
  Shield,
  User,
  Clock,
  Crown,
  Sparkles,
} from "lucide-react";
import wizardLogo from "@/assets/wizard-tutorial.png";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useAITask } from "@/contexts/AITaskContext";
import { AICompactOverlay } from "@/components/AICompactOverlay";
import { useRehydrationProtocol } from "@/hooks/hydration/useRehydrationProtocol";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { HydrationSkeleton } from "@/components/hydration/HydrationSkeleton";
import { InputsUsedChipRow } from "@/components/hydration/InputsUsedChipRow";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  DEFAULT_WARNINGS, SUGGESTED_FOODS, SUGGESTED_DRINKS, DEFAULT_EDUCATION,
  getSodium, getPotassium, getCarbs, getMealFoods, getPhaseBadge,
} from "@/pages/hydration/types";

export default function Hydration() {
  const {
    weightLost, setWeightLost,
    weighInDate, setWeighInDate,
    weighInTime, setWeighInTime,
    fightDate, setFightDate,
    fightTime, setFightTime,
    glycogenDepletion,
    normalCarbs, setNormalCarbs,
    fightWeekCarbs, setFightWeekCarbs,
    availableHours, awakeHours,
    protocol, loading, lastError,
    currentWeight, profileParts,
    handleGenerateProtocol, handleAICancel,
  } = useRehydrationProtocol();
  const { hasAccess: hasAiAccess } = useFeatureAccess("AI_REHYDRATION_PROTOCOL");

  const [activeTab, setActiveTab] = useState<"fluid" | "carbs">("fluid");
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [scienceOpen, setScienceOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  // When a protocol exists we collapse the form into a chip row. The user can
  // still re-expand it via the Edit button.
  const [formExpanded, setFormExpanded] = useState(false);
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  const [glycogenSheetOpen, setGlycogenSheetOpen] = useState(false);
  const showForm = !protocol || formExpanded;

  // Detect a fallback/empty AI summary so we can swap it for a muted banner
  // without hiding the deterministic protocol data (timeline, totals, etc.).
  const summaryRaw = (protocol?.summary ?? "").trim();
  const summaryIsFallback =
    !!protocol &&
    (summaryRaw.length === 0 ||
      summaryRaw.toLowerCase().includes("ai commentary is temporarily unavailable"));


  const formatTime = (startStr: string, hourIndex: number) => {
    if (!startStr) return `H${hourIndex}`;
    const [h, m] = startStr.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) return `H${hourIndex}`;
    const d = new Date();
    d.setHours(h, m, 0, 0);
    d.setHours(d.getHours() + (hourIndex - 1));
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  };

  const cumulativeFluidByStep = useMemo(() => {
    if (!protocol) return [];
    let sum = 0;
    return protocol.hourlyProtocol.map((step) => { sum += step.fluidML; return sum; });
  }, [protocol]);

  const getCumulativeFluid = (upToIndex: number) => cumulativeFluidByStep[upToIndex] ?? 0;

  const cumulativeCarbs = useMemo(() => {
    if (!protocol) return 0;
    return protocol.carbRefuelPlan.meals.reduce((s, m) => s + m.carbsG, 0);
  }, [protocol]);

  const getCumulativeCarbs = () => cumulativeCarbs;

  const totals = protocol?.totals;
  const education = protocol?.education;
  const educationItems = education?.howItWorks ?? DEFAULT_EDUCATION;

  const allWarnings = [
    ...(protocol?.warnings ?? []),
    ...DEFAULT_WARNINGS.filter(
      (dw) => !(protocol?.warnings ?? []).some((w) => w.toLowerCase().includes(dw.slice(0, 30).toLowerCase()))
    ),
  ];

  const REHYDRATION_STEPS = [
    { icon: Activity, label: "Analysing weight loss", color: "text-red-400" },
    { icon: Droplets, label: "Calculating fluid requirements", color: "text-blue-500" },
    { icon: Zap, label: "Optimising electrolyte ratios", color: "text-yellow-400" },
    { icon: Beaker, label: "Formulating recovery plan", color: "text-green-400" },
  ];

  const { tasks: aiTasks, dismissTask: aiDismiss } = useAITask();
  const aiTask = aiTasks.find(t => t.status === "running" && t.type === "rehydration");

  return (
    <>
      {aiTask && (
        <div className="px-5 sm:px-6 pt-3 max-w-7xl mx-auto">
          <AICompactOverlay
            isOpen={true}
            isGenerating={true}
            steps={aiTask.steps}
            startedAt={aiTask.startedAt}            title={aiTask.label}
            onCancel={() => aiDismiss(aiTask.id)}
          />
        </div>
      )}
      <div className="space-y-3">
        {/* Header — slim eyebrow + title + chip */}
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1 pt-0.5">
            <p className="text-[10px] uppercase tracking-[0.15em] font-bold text-primary/80">
              Rehydration
            </p>
            <h1 className="text-[22px] font-bold tracking-tight leading-tight">
              Post-weigh-in protocol
            </h1>
            <div className="mt-1 inline-flex items-center gap-1 rounded-full bg-primary/12 ring-1 ring-primary/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary">
              <Sparkles className="h-3 w-3" />
              Hour-by-hour
            </div>
          </div>
        </div>

        {/* Wizard-led "How it works" tile — slim coach prompt opens the
            full 3-step + safety explainer in a sheet. */}
        {!protocol && !loading && (
          <button
            type="button"
            onClick={() => setHowItWorksOpen(true)}
            className="group w-full text-left card-surface rounded-3xl p-4 border border-primary/20 hover:border-primary/35 active:scale-[0.99] transition-all"
          >
            <div className="flex items-start gap-3">
              <div className="h-11 w-11 shrink-0 flex items-center justify-center bg-transparent">
                <img src={wizardLogo} alt="" className="h-full w-full object-contain pointer-events-none select-none" draggable={false} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80">
                  Coach
                </p>
                <p className="mt-0.5 text-[14px] font-semibold leading-snug text-foreground">
                  Tell me your cut and times. I'll map hourly fluids, salts and carbs to bell.
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground leading-snug">
                  How it works · pacing · safety →
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:translate-x-0.5 transition-transform self-center" />
            </div>
          </button>
        )}

        {/* How-it-works detail sheet */}
        <Sheet open={howItWorksOpen} onOpenChange={setHowItWorksOpen}>
          <SheetContent
            side="bottom"
            className="rounded-t-3xl p-0 max-h-[88vh] overflow-y-auto [&>button]:hidden"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)" }}
          >
            <VisuallyHidden><SheetTitle>How rehydration works</SheetTitle></VisuallyHidden>
            <div className="flex justify-center pt-2 pb-1">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/25" aria-hidden />
            </div>
            <div className="px-5 pt-2 pb-6 space-y-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80">Rehydration</p>
                <h2 className="text-[19px] font-bold tracking-tight mt-0.5">How this protocol works</h2>
                <p className="mt-2 text-[13px] text-foreground/85 leading-snug">
                  An evidence-based plan that replenishes fluid, sodium, potassium and glycogen across the hours between weigh-in and bell so you step in rehydrated and powered.
                </p>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { n: 1, title: "Enter cut + times", body: "Weight lost, weigh-in & fight times" },
                  { n: 2, title: "Build protocol", body: "AI maps fluids and refuel hour-by-hour" },
                  { n: 3, title: "Drink to plan", body: "Follow the timeline with food and drink prompts" },
                ].map((s) => (
                  <div key={s.n}>
                    <div className="h-6 w-6 rounded-full bg-primary/15 text-primary text-[12px] font-bold flex items-center justify-center mb-2 tabular-nums">
                      {s.n}
                    </div>
                    <p className="text-[12px] font-semibold leading-tight text-foreground">{s.title}</p>
                    <p className="text-[11px] text-muted-foreground/70 leading-snug mt-1">{s.body}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <div className="flex items-start gap-2 rounded-xs bg-amber-500/10 ring-1 ring-amber-500/20 px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 text-amber-400 mt-0.5 flex-shrink-0" strokeWidth={2.4} />
                  <p className="text-[11px] text-foreground/80 leading-snug">
                    Rehydrating too fast can dilute sodium and trigger cramps or nausea. The protocol paces fluid and electrolyte intake to avoid this.
                  </p>
                </div>
                <div className="flex items-start gap-2 rounded-xs bg-muted/30 ring-1 ring-border/30 px-3 py-2">
                  <Info className="h-3.5 w-3.5 text-muted-foreground/80 mt-0.5 flex-shrink-0" strokeWidth={2.2} />
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    Science-backed but not perfectly accurate. For a high-stakes cut, working with a sports nutritionist is still the gold standard.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setHowItWorksOpen(false)}
                className="w-full h-11 rounded-xs bg-primary text-primary-foreground font-semibold text-[14px] active:scale-[0.98] transition-transform shadow-md shadow-primary/30"
              >
                Got it
              </button>
            </div>
          </SheetContent>
        </Sheet>

        {/* Compact "Inputs used" chip row when a protocol is already on screen.
            The full form re-expands via the Edit button. */}
        {protocol && !formExpanded && (
          <InputsUsedChipRow
            weightLost={weightLost}
            availableHours={availableHours}
            glycogenDepletion={glycogenDepletion}
            onEdit={() => setFormExpanded(true)}
          />
        )}

        {/* Input Form */}
        {showForm && (
        <div className="rounded-xs border border-border p-4 mb-4 relative overflow-hidden bg-card">
          <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
          </div>

          <form onSubmit={handleGenerateProtocol} className="space-y-4 relative z-10">
            <div className="flex items-center justify-center gap-2">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-[11px] text-muted-foreground">{profileParts.join(" · ")}</p>
            </div>

            {!currentWeight && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xs bg-red-500/10 border border-red-500/20">
                <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />
                <p className="text-[11px] text-red-400">Set your current weight in your profile to generate a protocol.</p>
              </div>
            )}

            {/* Weight Lost — stepper pill (matches Fight Plan inputs) */}
            <WeightLostPill
              weightLost={weightLost}
              setWeightLost={setWeightLost}
              currentWeight={currentWeight}
            />

            {/* Weigh-in + Fight datetime rows */}
            <div className="space-y-2.5">
              <DateTimeRow
                label="Weigh-in"
                dotColor="bg-emerald-400"
                date={weighInDate}
                time={weighInTime}
                onDate={setWeighInDate}
                onTime={setWeighInTime}
              />
              <DateTimeRow
                label="Fight"
                dotColor="bg-amber-400"
                date={fightDate}
                time={fightTime}
                onDate={setFightDate}
                onTime={setFightTime}
              />
            </div>

            {/* Rehydration window summary — clearly read-only */}
            <div className="flex items-center justify-between rounded-xs border border-primary/20 bg-primary/[0.06] px-3.5 py-2.5">
              <div className="flex items-center gap-2.5">
                <div className="h-9 w-9 rounded-xs bg-primary/15 ring-1 ring-primary/25 flex items-center justify-center">
                  <Clock className="h-4 w-4 text-primary" strokeWidth={2.4} />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-primary/80">Your window</p>
                  <p className="text-[14px] font-semibold text-foreground leading-tight mt-0.5">
                    Time to rehydrate
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p
                  className={`text-[22px] font-black tabular-nums leading-none ${
                    availableHours <= 5 ? "text-red-300" : availableHours <= 10 ? "text-amber-300" : "text-emerald-300"
                  }`}
                >
                  {availableHours}
                </p>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80 mt-0.5">hours</p>
              </div>
            </div>

            {/* Glycogen Depletion — chip that opens a sheet */}
            <button
              type="button"
              onClick={() => setGlycogenSheetOpen(true)}
              className="group w-full flex items-center gap-2.5 rounded-xs border border-border/40 bg-muted/30 px-3 py-2.5 active:scale-[0.99] transition"
            >
              <div className="h-8 w-8 rounded-xs bg-muted/40 ring-1 ring-border/30 flex items-center justify-center shrink-0">
                <Beaker className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0 text-left">
                <p className="text-[11px] font-semibold text-foreground/80 leading-tight">Glycogen Depletion</p>
                <p className="text-[10px] text-muted-foreground/70 leading-tight mt-0.5 truncate">
                  {parseFloat(normalCarbs) > 0 && fightWeekCarbs !== "" && parseFloat(fightWeekCarbs) >= 0 ? (
                    <>Auto-detected: <span className="text-foreground/85 font-semibold">{glycogenDepletion}</span></>
                  ) : (
                    <>Tap to customize carb ratios</>
                  )}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/40 group-hover:translate-x-0.5 transition-transform" />
            </button>

            {/* Glycogen sheet */}
            <Sheet open={glycogenSheetOpen} onOpenChange={setGlycogenSheetOpen}>
              <SheetContent
                side="bottom"
                className="rounded-t-3xl p-0 max-h-[80vh] overflow-y-auto [&>button]:hidden"
                style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)" }}
              >
                <VisuallyHidden><SheetTitle>Glycogen depletion</SheetTitle></VisuallyHidden>
                <div className="flex justify-center pt-2 pb-1">
                  <div className="w-10 h-1 rounded-full bg-muted-foreground/25" aria-hidden />
                </div>
                <div className="px-5 pt-2 pb-5 space-y-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80">Advanced</p>
                    <h2 className="text-[19px] font-bold tracking-tight mt-0.5">Glycogen depletion</h2>
                    <p className="mt-2 text-[12px] text-muted-foreground leading-snug">
                      How many grams of carbs do you eat on a <span className="text-foreground/80 font-semibold">normal training day</span> vs during <span className="text-foreground/80 font-semibold">fight week</span>? This dials how aggressively we refuel post-weigh-in.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xs bg-muted/30 border border-border/30 p-3 text-center">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-1">Normal</p>
                      <input
                        type="number"
                        inputMode="numeric"
                        placeholder="300"
                        value={normalCarbs}
                        onChange={(e) => setNormalCarbs(e.target.value)}
                        className="w-full bg-transparent text-center text-[24px] font-black tabular-nums text-foreground focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <p className="text-[10px] text-muted-foreground/70 mt-1">g/day</p>
                    </div>
                    <div className="rounded-xs bg-muted/30 border border-border/30 p-3 text-center">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-1">Fight week</p>
                      <input
                        type="number"
                        inputMode="numeric"
                        placeholder="50"
                        value={fightWeekCarbs}
                        onChange={(e) => setFightWeekCarbs(e.target.value)}
                        className="w-full bg-transparent text-center text-[24px] font-black tabular-nums text-foreground focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                      />
                      <p className="text-[10px] text-muted-foreground/70 mt-1">g/day</p>
                    </div>
                  </div>
                  {(() => {
                    const normal = parseFloat(normalCarbs);
                    const fightWeek = parseFloat(fightWeekCarbs);
                    const hasInputs = normal > 0 && fightWeek >= 0;
                    const reduction = hasInputs ? Math.round(((normal - fightWeek) / normal) * 100) : 0;
                    const level = glycogenDepletion;
                    const config = {
                      significant: { color: "text-red-300", bg: "bg-red-500/12", ring: "ring-red-500/25", label: "Significant", target: "8-12 g/kg" },
                      moderate: { color: "text-amber-300", bg: "bg-amber-500/12", ring: "ring-amber-500/25", label: "Moderate", target: "6-8 g/kg" },
                      none: { color: "text-emerald-300", bg: "bg-emerald-500/12", ring: "ring-emerald-500/25", label: "None", target: "4-5 g/kg" },
                    }[level] ?? { color: "text-amber-300", bg: "bg-amber-500/12", ring: "ring-amber-500/25", label: "Moderate", target: "6-8 g/kg" };
                    return (
                      <div className={`rounded-xs ${config.bg} ring-1 ${config.ring} px-3.5 py-3 text-center`}>
                        <p className={`text-[14px] font-bold ${config.color}`}>{config.label}</p>
                        <p className={`text-[11px] mt-0.5 ${config.color} opacity-80`}>Replenish target: {config.target}</p>
                        {hasInputs && (
                          <p className="text-[10px] text-muted-foreground mt-1.5">
                            {fightWeek < 50 ? "< 50g/day during fight week" : `${reduction}% reduction`} · {normal}g → {fightWeek}g/day
                          </p>
                        )}
                      </div>
                    );
                  })()}
                  <button
                    onClick={() => setGlycogenSheetOpen(false)}
                    className="w-full h-11 rounded-xs bg-primary text-primary-foreground font-semibold text-[14px] active:scale-[0.98] transition-transform shadow-md shadow-primary/30"
                  >
                    Done
                  </button>
                </div>
              </SheetContent>
            </Sheet>

            {/* Safety & Disclaimer */}
            <div className="rounded-xs border border-border/30 overflow-hidden">
              <button type="button" className="w-full px-3 py-2.5 flex items-center gap-2 text-left" onClick={() => setDisclaimerOpen(o => !o)}>
                <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[11px] font-medium text-muted-foreground">Safety & Disclaimer</span>
                <span className="ml-auto text-muted-foreground">{disclaimerOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}</span>
              </button>
              {disclaimerOpen && (
                <div className="px-3 pb-3 border-t border-border/20 space-y-2 pt-2">
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    <span className="font-semibold text-foreground/80">Not medical advice.</span> This protocol is an educational guideline based on sports science research. Consult a qualified sports dietitian before implementing. Stop and seek medical attention if you experience dizziness, confusion, nausea, or chest pain.
                  </p>
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-amber-400 leading-snug">For athletes who have safely completed their weight cut. Never rehydrate without guidance.</p>
                  </div>
                </div>
              )}
            </div>

            <Button
              type="submit"
              className={`relative w-full h-12 min-h-[52px] mt-1 font-bold text-[15px] rounded-xs bg-primary text-primary-foreground transition-all active:scale-[0.98] shadow-lg shadow-primary/30 ${lastError && !loading ? "ring-2 ring-red-500/40" : ""}`}
              disabled={loading || !currentWeight || !weightLost || parseFloat(weightLost) <= 0}
            >
              {loading ? (
                <HydrationCastingMessage />
              ) : lastError ? (
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4" strokeWidth={2.4} />
                  Try again
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4" strokeWidth={2.4} />
                  Generate Protocol
                </span>
              )}
              {!loading && !lastError && !hasAiAccess && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 text-primary-foreground/70 pointer-events-none">
                  <Crown className="h-3 w-3" />
                  <span className="text-[10px] font-medium uppercase tracking-wider">Pro</span>
                </span>
              )}
            </Button>
          </form>
        </div>
        )}

        {/* Skeleton during generation gives the wait some shape. */}
        {loading && !protocol && <HydrationSkeleton />}

        {/* PROTOCOL RESULTS — render the deterministic plan even when AI text is missing. */}
        {protocol && (
          <div className="space-y-2.5">
            {/* Summary — falls back to a muted banner when AI text is empty. */}
            {summaryIsFallback ? (
              <div className="rounded-xs border border-border/40 bg-muted/30 p-3 flex items-start gap-2">
                <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                <p className="text-[12px] text-muted-foreground leading-relaxed flex-1">AI commentary unavailable — showing computed plan.</p>
                <button onClick={() => { setFormExpanded(false); handleGenerateProtocol(new Event("submit") as unknown as React.FormEvent); }} disabled={loading} className="shrink-0 p-1 rounded-xs hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors" aria-label="Regenerate">
                  <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>
            ) : (
              <div className="rounded-xs bg-muted/50 border border-border p-3 flex items-start justify-between gap-3">
                <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-line">{summaryRaw}</p>
                <button onClick={() => { setFormExpanded(false); handleGenerateProtocol(new Event("submit") as unknown as React.FormEvent); }} disabled={loading} className="shrink-0 p-1.5 rounded-xs hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors" aria-label="Regenerate">
                  <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
                </button>
              </div>
            )}

            {/* Totals Dashboard */}
            {totals && (
              <div className="rounded-xs bg-card border border-border p-3">
                <p className="text-[9px] text-muted-foreground uppercase tracking-wider mb-2 text-center font-bold">Rehydration Totals</p>
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="rounded-xs bg-blue-500/5 border border-blue-500/20 p-2 text-center">
                    <p className="text-base font-bold tabular-nums text-blue-400">{totals.totalFluidLitres}L</p>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">Total Fluid</p>
                  </div>
                  <div className="rounded-xs bg-amber-500/5 border border-amber-500/20 p-2 text-center">
                    <p className="text-base font-bold tabular-nums text-amber-400">{(totals.totalSodiumMg / 1000).toFixed(1)}g</p>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">Sodium</p>
                  </div>
                  <div className="rounded-xs bg-emerald-500/5 border border-emerald-500/20 p-2 text-center">
                    <p className="text-base font-bold tabular-nums text-emerald-400">{totals.totalCarbsG}g</p>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider mt-0.5">Carbs</p>
                  </div>
                  <div className="rounded-xs bg-muted border border-border p-2.5 text-center">
                    <p className="text-sm font-bold tabular-nums text-foreground/80">{totals.rehydrationWindowHours}h</p>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Window</p>
                  </div>
                  <div className="rounded-xs bg-muted border border-border p-2.5 text-center">
                    <p className="text-sm font-bold tabular-nums text-foreground/80">{totals.totalPotassiumMg}mg</p>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Potassium</p>
                  </div>
                  <div className="rounded-xs bg-muted border border-border p-2.5 text-center">
                    <p className="text-sm font-bold tabular-nums text-foreground/80">{totals.totalMagnesiumMg}mg</p>
                    <p className="text-[9px] text-muted-foreground uppercase tracking-wider">Magnesium</p>
                  </div>
                </div>
              </div>
            )}

            {/* Warnings Section */}
            <div className="rounded-xs bg-amber-500/5 border border-amber-500/20 overflow-hidden">
              <button className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-amber-500/10 transition-colors" onClick={() => setWarningsOpen((o) => !o)}>
                <AlertTriangle className="h-3.5 w-3.5 text-amber-400 shrink-0" />
                <span className="text-sm font-medium text-amber-400">Safety Warnings ({allWarnings.length})</span>
                <span className="ml-auto text-amber-400">{warningsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</span>
              </button>
              {warningsOpen && (
                <div className="px-4 pb-4 space-y-2 border-t border-amber-500/20">
                  {allWarnings.map((warning, idx) => (
                    <div key={idx} className="flex items-start gap-2 pt-2">
                      <AlertTriangle className="h-3 w-3 text-amber-400 shrink-0 mt-0.5" />
                      <p className="text-xs text-amber-600 dark:text-amber-300 leading-relaxed">{warning}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Learn More */}
            <div className="rounded-xs bg-muted/50 border border-border overflow-hidden">
              <button className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-muted/30 transition-colors" onClick={() => setScienceOpen((o) => !o)}>
                <BookOpen className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                <span className="text-sm font-medium">Learn More</span>
                <span className="ml-auto text-muted-foreground">{scienceOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}</span>
              </button>
              {scienceOpen && (
                <div className="px-4 pb-4 space-y-4 border-t border-border pt-3">
                  {/* How It Works */}
                  <div>
                    <p className="text-xs font-bold text-foreground/80 mb-2">How This Protocol Works</p>
                    <div className="space-y-2">
                      {educationItems.map((item, idx) => (
                        <div key={idx}>
                          <p className="text-[11px] font-semibold text-foreground/70">{item.title}</p>
                          <p className="text-[11px] text-muted-foreground leading-relaxed">{item.content}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Electrolytes */}
                  <div>
                    <p className="text-xs font-bold text-foreground/80 mb-2">Why Electrolytes Matter</p>
                    <div className="space-y-2">
                      {[
                        { symbol: "Na", name: "Sodium", desc: "Creates osmotic gradient for cell absorption. Target: 50-90 mmol/L in fluid." },
                        { symbol: "K", name: "Potassium", desc: "Intracellular hydration + muscle function. Prevents cramps and impaired reflexes." },
                        { symbol: "Mg", name: "Magnesium", desc: "Neuromuscular function, energy production. Critical for reaction time." },
                      ].map(({ symbol, name, desc }) => (
                        <div key={symbol} className="flex items-start gap-2">
                          <span className="text-[10px] font-bold text-blue-400 bg-blue-500/10 border border-blue-500/20 rounded-md px-1.5 py-0.5 shrink-0 mt-0.5">{symbol}</span>
                          <div>
                            <span className="text-[11px] font-semibold text-foreground/70">{name}: </span>
                            <span className="text-[11px] text-muted-foreground leading-relaxed">{desc}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  {/* Caffeine */}
                  <div>
                    <p className="text-xs font-bold text-foreground/80 mb-1">Caffeine Strategy</p>
                    {totals && <span className="text-[10px] font-bold text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-md px-1.5 py-0.5 inline-block mb-1.5">Your dose: {totals.caffeineLowMg}-{totals.caffeineHighMg}mg</span>}
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{education?.caffeineGuidance ?? "Consume 3-6 mg/kg caffeine ~60 min before competition. Improves reaction time and reduces perceived effort."}</p>
                  </div>
                  {/* Mouth Rinse */}
                  <div>
                    <p className="text-xs font-bold text-foreground/80 mb-1">GI Distress? Carb Mouth Rinse</p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">{education?.carbMouthRinse ?? "Rinse mouth ~10s with sports drink to activate CNS drive when swallowing feels impossible."}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Segmented Tab Control (Fluid / Carbs) */}
            <div className="rounded-xs bg-muted/50 border border-border overflow-hidden">
              <div className="p-2">
                <div className="flex bg-muted rounded-full p-0.5">
                  <button onClick={() => setActiveTab("fluid")} className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-full text-xs font-medium transition-all ${activeTab === "fluid" ? "bg-blue-500 text-white shadow-sm" : "text-muted-foreground"}`}>
                    <Droplets className="h-3 w-3" /> Fluid
                  </button>
                  <button onClick={() => setActiveTab("carbs")} className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-full text-xs font-medium transition-all ${activeTab === "carbs" ? "bg-blue-500 text-white shadow-sm" : "text-muted-foreground"}`}>
                    <Zap className="h-3 w-3" /> Carbs
                  </button>
                </div>
              </div>

              {/* Fluid Tab */}
              {activeTab === "fluid" && (
                <div>
                  {totals && (
                    <div className="px-4 pb-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] text-muted-foreground">Fluid Schedule</span>
                        <span className="text-[10px] text-blue-400 font-medium">{totals.totalFluidLitres}L total</span>
                      </div>
                    </div>
                  )}
                  <div className="mx-4 mb-2 flex items-start gap-2 px-3 py-2 rounded-xs bg-blue-500/5 border border-blue-500/20">
                    <Droplets className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
                    <p className="text-[11px] text-blue-300 leading-snug">
                      <span className="font-semibold">Sip, don't chug.</span> Spread each hour's fluids into small sips over the full 60 minutes for better absorption and less GI distress.
                    </p>
                  </div>
                  {protocol.hourlyProtocol.map((step, idx) => {
                    const phaseBadge = getPhaseBadge(step.phase);
                    return (
                      <div key={idx} className="flex gap-3 px-4 py-3">
                        {/* Timeline dot + line */}
                        <div className="flex flex-col items-center shrink-0">
                          <div className="w-2.5 h-2.5 rounded-full bg-blue-500 border-2 border-background shadow-sm" />
                          {idx < protocol.hourlyProtocol.length - 1 && <div className="w-0.5 flex-1 bg-border/40 mt-1" />}
                        </div>
                        {/* Content */}
                        <div className="flex-1 min-w-0 pb-3">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-[10px] font-bold text-blue-500 uppercase">H{step.hour}</span>
                            <span className="text-xs font-bold text-foreground">{formatTime(weighInTime, step.hour)}</span>
                            <span className="text-sm font-bold tabular-nums text-foreground ml-auto">{step.fluidML}ml</span>
                          </div>
                          <div className="flex items-center gap-2 flex-wrap mb-1.5">
                            <span className="text-[10px] text-muted-foreground">Na {getSodium(step)}mg</span>
                            <span className="text-[10px] text-muted-foreground">K {getPotassium(step)}mg</span>
                            {getCarbs(step) > 0 && <span className="text-[10px] text-emerald-400 font-medium">{getCarbs(step)}g carbs</span>}
                            {phaseBadge && <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-md border ${phaseBadge.bg} ${phaseBadge.text}`}>{step.phase}</span>}
                          </div>
                          {step.drinkRecipe && (
                            <div className="flex items-start gap-1.5 bg-blue-500/5 border border-blue-500/20 rounded-xs px-2.5 py-1.5 mb-1.5">
                              <Beaker className="h-3 w-3 text-blue-400 shrink-0 mt-0.5" />
                              <p className="text-[11px] text-blue-400 font-medium leading-snug">{step.drinkRecipe}</p>
                            </div>
                          )}
                          {Array.isArray(step.foods) && step.foods.length > 0 && (
                            <div className="flex flex-wrap gap-1 mb-1.5">
                              {step.foods.map((food, fIdx) => (
                                <span key={fIdx} className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">{food}</span>
                              ))}
                            </div>
                          )}
                          {step.notes && <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-2">{step.notes}</p>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Carbs Tab */}
              {activeTab === "carbs" && (
                <div>
                  <div className="px-4 pb-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">Target {totals?.totalCarbsG ?? protocol.carbRefuelPlan.targetCarbs ?? "—"}g ({totals?.carbTargetPerKg ?? "6-8"} g/kg)</span>
                      <span className="text-[10px] text-emerald-400 font-medium bg-emerald-500/10 border border-emerald-500/20 rounded-md px-1.5 py-0.5">Max {totals?.maxCarbsPerHour ?? 60}g/h</span>
                    </div>
                    <div className="space-y-1">
                      <div className="w-full h-2 bg-muted rounded-full overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.min(100, Math.round((getCumulativeCarbs() / (totals?.totalCarbsG ?? (getCumulativeCarbs() || 1))) * 100))}%` }} />
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[10px] text-emerald-400 tabular-nums font-medium">{getCumulativeCarbs()}g planned</span>
                        <span className="text-[10px] text-muted-foreground tabular-nums">{totals?.totalCarbsG ?? "—"}g target</span>
                      </div>
                    </div>
                    {protocol.carbRefuelPlan.strategy && <p className="text-[11px] text-muted-foreground leading-snug italic">{protocol.carbRefuelPlan.strategy}</p>}
                  </div>

                  {protocol.carbRefuelPlan.meals.map((meal, idx) => (
                    <div key={idx} className="flex gap-3 px-4 py-3">
                      <div className="flex flex-col items-center shrink-0">
                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 border-2 border-background shadow-sm" />
                        {idx < protocol.carbRefuelPlan.meals.length - 1 && <div className="w-0.5 flex-1 bg-border/40 mt-1" />}
                      </div>
                      <div className="flex-1 min-w-0 pb-3">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-[10px] font-medium text-emerald-400">{meal.timing}</span>
                          <span className="text-sm font-bold tabular-nums text-emerald-400 ml-auto">{meal.carbsG}g</span>
                        </div>
                        {getMealFoods(meal).length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-1.5">
                            {getMealFoods(meal).map((food, foodIdx) => (
                              <span key={foodIdx} className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">{food}</span>
                            ))}
                          </div>
                        )}
                        {meal.rationale && <p className="text-[11px] text-muted-foreground leading-relaxed">{meal.rationale}</p>}
                      </div>
                    </div>
                  ))}

                  {/* Suggested Foods Grid */}
                  <div className="mx-4 mt-4 mb-2">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2 font-bold">Suggested Foods (Research-Backed)</p>
                    <div className="grid grid-cols-2 gap-1.5">
                      {SUGGESTED_FOODS.map((food, idx) => (
                        <div key={idx} className="rounded-xs bg-card border border-border p-2 space-y-1">
                          <div className="flex items-start justify-between gap-1.5">
                            <p className="text-[11px] font-medium text-foreground/90 leading-tight min-w-0">{food.name}</p>
                            <span className="text-[10px] text-emerald-400 font-bold tabular-nums shrink-0">{food.carbsG}g</span>
                          </div>
                          <p className="text-[9px] text-muted-foreground leading-snug">{food.notes}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Suggested Drinks */}
                  <div className="mx-4 mt-3 mb-4">
                    <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2 font-bold">Suggested Drinks</p>
                    <div className="space-y-1.5">
                      {SUGGESTED_DRINKS.map((drink, idx) => (
                        <div key={idx} className="flex items-center gap-2 rounded-xs bg-card border border-border px-3 py-2">
                          <Droplets className="h-3 w-3 text-blue-400 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-[11px] font-medium text-foreground/90">{drink.name}</p>
                            <p className="text-[9px] text-muted-foreground">{drink.usage}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ── WeightLostPill ─────────────────────────────────────────────────
// Stepper pill matching the Fight Plan input pattern. Left label + hint,
// right cluster: −/+ stepper around a centered editable number. Body-mass
// percentage shows as a color-coded chip when valid.
function WeightLostPill({
  weightLost,
  setWeightLost,
  currentWeight,
}: {
  weightLost: string;
  setWeightLost: (v: string) => void;
  currentWeight: number | null | undefined;
}) {
  const val = parseFloat(weightLost) || 0;
  const clamp = (n: number) => Math.min(15, Math.max(0, n));
  const pct = currentWeight && val > 0 ? (val / currentWeight) * 100 : null;
  const pctTone =
    pct == null
      ? "hidden"
      : pct <= 5
        ? "bg-emerald-500/12 text-emerald-300 ring-emerald-500/25"
        : pct <= 8
          ? "bg-amber-500/12 text-amber-300 ring-amber-500/25"
          : "bg-red-500/12 text-red-300 ring-red-500/25";
  return (
    <div className="flex items-center gap-3 rounded-xs bg-muted/30 border border-border/30 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-foreground/80 leading-tight">Weight lost</p>
        <p className="text-[10px] text-muted-foreground/70 leading-tight mt-0.5">vs your normal weight</p>
      </div>
      {pct != null && (
        <span className={`shrink-0 inline-flex items-center text-[10px] font-bold tabular-nums rounded-full ring-1 px-2 py-0.5 ${pctTone}`}>
          {pct.toFixed(1)}% BM
        </span>
      )}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={() => setWeightLost(clamp(val - 0.5).toString())}
          aria-label="Decrease weight lost"
          className="h-8 w-8 rounded-full bg-card/60 border border-border/40 flex items-center justify-center active:bg-muted/60 active:scale-95 transition disabled:opacity-40"
          disabled={val <= 0}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <div className="min-w-[72px] text-center">
          <input
            type="number"
            inputMode="decimal"
            step="0.1"
            value={weightLost}
            onChange={(e) => setWeightLost(e.target.value)}
            placeholder="0.0"
            className="w-[60px] bg-transparent text-center text-[15px] font-bold tabular-nums text-foreground outline-none focus:ring-2 focus:ring-primary/40 rounded-xs [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 ml-0.5">kg</span>
        </div>
        <button
          type="button"
          onClick={() => setWeightLost(clamp(val + 0.5).toString())}
          aria-label="Increase weight lost"
          className="h-8 w-8 rounded-full bg-card/60 border border-border/40 flex items-center justify-center active:bg-muted/60 active:scale-95 transition disabled:opacity-40"
          disabled={val >= 15}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ── Minus / Plus icons local fallback — Hydration.tsx doesn't import them ──
function Minus(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className={props.className}>
      <path d="M5 12h14" />
    </svg>
  );
}
function Plus(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" className={props.className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

// ── DateTimeRow ────────────────────────────────────────────────────
// Colored dot + label on top, then two visible buttons side-by-side
// for Date and Time. Each button's value is a real `<input>` styled
// to look like a button — native picker fires on tap reliably (no
// hidden-overlay trickery that broke in WKWebView).
function DateTimeRow({
  label,
  dotColor,
  date,
  time,
  onDate,
  onTime,
}: {
  label: string;
  dotColor: string;
  date: string;
  time: string;
  onDate: (v: string) => void;
  onTime: (v: string) => void;
}) {
  const dateDisplay = date
    ? (() => {
        try {
          const d = new Date(`${date}T00:00`);
          if (Number.isNaN(d.getTime())) return "Date";
          return d.toLocaleString("en-GB", { day: "2-digit", month: "short" });
        } catch {
          return "Date";
        }
      })()
    : "Pick date";
  const timeDisplay = time || "Pick time";
  return (
    <div className="rounded-xs bg-muted/30 border border-border/30 px-3 py-2.5">
      <div className="flex items-center gap-2 mb-2">
        <span className={`h-2 w-2 rounded-full ${dotColor} shrink-0`} aria-hidden />
        <p className="text-[11px] font-semibold text-foreground/80 leading-none">{label}</p>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {/* Date button — wraps a styled `<input type="date">` that lays
            transparent across the entire button. Clicking anywhere on
            the visible content focuses the input and fires the native
            date picker. The label element guarantees the input
            receives the click on iOS/Android WebViews. */}
        <label className="relative flex items-center justify-between gap-1.5 h-10 rounded-xs bg-card/70 border border-border/40 px-2.5 active:bg-muted/50 transition cursor-pointer">
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className={`text-[13px] font-bold tabular-nums truncate ${date ? "text-foreground" : "text-muted-foreground/60"}`}>
              {dateDisplay}
            </span>
          </span>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
          <input
            type="date"
            value={date}
            onChange={(e) => onDate(e.target.value)}
            required
            aria-label={`${label} date`}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </label>
        {/* Time button — same pattern but `<input type="time">`. */}
        <label className="relative flex items-center justify-between gap-1.5 h-10 rounded-xs bg-card/70 border border-border/40 px-2.5 active:bg-muted/50 transition cursor-pointer">
          <span className="inline-flex items-center gap-1.5 min-w-0">
            <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className={`text-[13px] font-bold tabular-nums truncate ${time ? "text-foreground" : "text-muted-foreground/60"}`}>
              {timeDisplay}
            </span>
          </span>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
          <input
            type="time"
            value={time}
            onChange={(e) => onTime(e.target.value)}
            required
            aria-label={`${label} time`}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
        </label>
      </div>
    </div>
  );
}

// Local calendar icon — Hydration.tsx doesn't import Calendar from lucide
function CalendarIcon(props: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={props.className}>
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M16 2v4M8 2v4M3 10h18" />
    </svg>
  );
}

// Multi-stage coach-voice loading copy that cycles through 4 stages
// while the AI generates the rehydration protocol.
function HydrationCastingMessage() {
  const stages = useMemo(
    () => [
      "Analysing your cut…",
      "Pacing fluid replacement…",
      "Mapping sodium + glycogen…",
      "Cross-checking safe limits…",
    ],
    [],
  );
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStage((s) => Math.min(s + 1, stages.length - 1)), 1200);
    return () => clearInterval(id);
  }, [stages.length]);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="h-4 w-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
      <span className="tabular-nums">{stages[stage]}</span>
    </span>
  );
}
