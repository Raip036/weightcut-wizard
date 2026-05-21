import { Loader2, Utensils, Dumbbell } from "lucide-react";
import wizardLogo from "@/assets/wizard-logo.webp";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { TrainingFoodTip } from "@/pages/nutrition/types";

interface TrainingWisdomSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  wisdom: TrainingFoodTip | null;
  preference: string;
  setPreference: (v: string) => void;
  onGenerate: (force?: boolean) => void;
}

export function TrainingWisdomSheet({ open, onOpenChange, loading, wisdom, preference, setPreference, onGenerate }: TrainingWisdomSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[85vh] rounded-t-2xl overflow-y-auto pb-[calc(5rem+env(safe-area-inset-bottom))]">
        <SheetHeader className="mb-4">
          <div className="flex items-center gap-3">
            <div className="rounded-full bg-primary/15 p-2 flex-shrink-0">
              <img src={wizardLogo} alt="Wizard" className="w-10 h-10 rounded-full object-cover" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <SheetTitle className="text-base">Training Fuel Guide</SheetTitle>
                <button
                  onClick={() => onGenerate(true)}
                  disabled={loading}
                  className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 disabled:opacity-40 transition-colors px-2 py-1 rounded-xs hover:bg-primary/5"
                >
                  {loading ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path d="M14 8A6 6 0 1 1 8 2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                      <path d="M8 2V5l2-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                  Refresh
                </button>
              </div>
              <p className="text-xs text-muted-foreground">Optimal pre & post training nutrition</p>
            </div>
          </div>
        </SheetHeader>
        <div className="flex gap-2 mb-4">
          <Input
            placeholder="e.g. easily digestible, high carb, no dairy…"
            value={preference}
            onChange={(e) => setPreference(e.target.value)}
            disabled={loading}
            className="text-sm h-9"
            onKeyDown={(e) => { if (e.key === "Enter" && preference.trim()) onGenerate(true); }}
          />
          <Button size="sm" onClick={() => onGenerate(true)} disabled={loading || !preference.trim()} className="h-9 px-3 shrink-0">
            Go
          </Button>
        </div>
        {loading ? (
          <div className="space-y-5 py-4">
            <div className="text-center mb-2">
              <p className="text-sm font-medium text-foreground">Crafting your training fuel plan…</p>
              <p className="text-xs text-muted-foreground/60 mt-0.5">Personalizing based on your goals</p>
            </div>
            <div className="relative h-1 rounded-full bg-border/20 overflow-hidden">
              <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-primary via-secondary to-primary" style={{ animation: "trainingProgressGrow 8s ease-out forwards" }} />
            </div>
            <style>{`@keyframes trainingProgressGrow { 0% { width: 5%; } 30% { width: 35%; } 60% { width: 60%; } 80% { width: 80%; } 100% { width: 95%; } } @keyframes trainingStepFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }`}</style>
            <div className="space-y-3">
              {[
                { icon: "🎯", label: "Analyzing your macro targets", delay: "0s" },
                { icon: "⚡", label: "Designing pre-training fuel", delay: "2s" },
                { icon: "💪", label: "Crafting post-training recovery meals", delay: "4s" },
                { icon: "✨", label: "Finalizing recommendations", delay: "6s" },
              ].map((step, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5 rounded-xs transition-all duration-500" style={{ animation: `trainingStepFadeIn 0.5s ease-out ${step.delay} both` }}>
                  <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm flex-shrink-0">{step.icon}</div>
                  <span className="text-sm text-muted-foreground">{step.label}</span>
                  <Loader2 className="h-3.5 w-3.5 text-primary/40 animate-spin ml-auto flex-shrink-0" style={{ animationDelay: step.delay }} />
                </div>
              ))}
            </div>
          </div>
        ) : wisdom ? (
          <div className="space-y-6">
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-full bg-orange-500/15 flex items-center justify-center">
                  <Utensils className="h-3.5 w-3.5 text-orange-500" />
                </div>
                <h4 className="text-sm font-bold uppercase tracking-wider text-orange-500">Pre-Training</h4>
              </div>
              <div className="space-y-2.5">
                {wisdom.preMeals.map((meal, i) => (
                  <div key={i} className="card-surface p-3.5 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <h5 className="text-sm font-semibold">{meal.name}</h5>
                      <span className="text-[13px] font-medium text-orange-500/70 bg-orange-500/10 px-2 py-0.5 rounded-full flex-shrink-0">{meal.timing}</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{meal.description}</p>
                    <p className="text-[13px] font-medium text-muted-foreground/60 tabular-nums">{meal.macros}</p>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2 mb-3">
                <div className="w-6 h-6 rounded-full bg-blue-500/15 flex items-center justify-center">
                  <Dumbbell className="h-3.5 w-3.5 text-blue-500" />
                </div>
                <h4 className="text-sm font-bold uppercase tracking-wider text-blue-500">Post-Training</h4>
              </div>
              <div className="space-y-2.5">
                {wisdom.postMeals.map((meal, i) => (
                  <div key={i} className="card-surface p-3.5 space-y-1.5">
                    <div className="flex items-start justify-between gap-2">
                      <h5 className="text-sm font-semibold">{meal.name}</h5>
                      <span className="text-[13px] font-medium text-blue-500/70 bg-blue-500/10 px-2 py-0.5 rounded-full flex-shrink-0">{meal.timing}</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">{meal.description}</p>
                    <p className="text-[13px] font-medium text-muted-foreground/60 tabular-nums">{meal.macros}</p>
                  </div>
                ))}
              </div>
            </div>
            {wisdom.tip && (
              <div className="rounded-xs bg-primary/5 border border-primary/10 p-3.5">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-xs font-semibold text-primary">Wizard's Tip</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{wisdom.tip}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="text-center py-12">
            <Utensils className="h-8 w-8 text-muted-foreground/20 mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">No training ideas available</p>
            <p className="text-xs text-muted-foreground/50 mt-1">Tap the card above to generate ideas</p>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
