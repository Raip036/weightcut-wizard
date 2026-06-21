import { useState } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/Icon";

interface WeightIncreaseQuestionnaireProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onComplete: () => void;
}

export function WeightIncreaseQuestionnaire({ open, onOpenChange, onComplete }: WeightIncreaseQuestionnaireProps) {
    const [step, setStep] = useState<"question" | "diagnosis">("question");

    const handleSelect = (option: string) => {
        if (option === "Nothing unusual") {
            onOpenChange(false);
            onComplete();
            // Reset after animation
            setTimeout(() => setStep("question"), 300);
        } else {
            setStep("diagnosis");
        }
    };

    const handleGotIt = () => {
        onOpenChange(false);
        onComplete();
        // Reset after animation
        setTimeout(() => setStep("question"), 300);
    };

    return (
        <Sheet open={open} onOpenChange={(val) => {
            onOpenChange(val);
            if (!val) {
                setTimeout(() => setStep("question"), 300);
            }
        }}>
            <SheetContent side="bottom" className="rounded-t-xl border-0 bg-card/95 backdrop-blur-xl p-0 overflow-hidden" style={{ maxHeight: "calc(100vh - env(safe-area-inset-top, 0px) - 4rem)" }}>
                <div className="px-3 pt-3 pb-1.5 shrink-0">
                    <SheetHeader>
                        <div className="flex items-center gap-2">
                            <SheetTitle className="text-[13px] font-semibold text-left">Weight went up. What happened?</SheetTitle>
                        </div>
                    </SheetHeader>
                </div>

                <div className="overflow-y-auto overscroll-contain px-3 pb-[calc(env(safe-area-inset-bottom,0px)+1rem)]" style={{ WebkitOverflowScrolling: "touch" } as any}>
                {step === "question" ? (
                    <div className="space-y-1">
                        <button className="w-full text-left rounded-md bg-muted/20 px-2.5 py-2 text-[13px] leading-snug active:bg-muted/40 transition-colors" onClick={() => handleSelect("Salty")}>
                            Salty food (takeout, soy sauce, processed)
                        </button>
                        <button className="w-full text-left rounded-md bg-muted/20 px-2.5 py-2 text-[13px] leading-snug active:bg-muted/40 transition-colors" onClick={() => handleSelect("Carbs")}>
                            High carbs (pasta, rice, bread)
                        </button>
                        <button className="w-full text-left rounded-md bg-muted/20 px-2.5 py-2 text-[13px] leading-snug active:bg-muted/40 transition-colors" onClick={() => handleSelect("Late")}>
                            Big meal close to bedtime
                        </button>
                        <div className="border-t border-border/30 mt-1">
                            <button className="w-full py-2 text-[13px] text-muted-foreground active:text-foreground transition-colors" onClick={() => handleSelect("Nothing unusual")}>
                                Nothing unusual (skip)
                            </button>
                        </div>
                    </div>
                ) : (
                    <div className="animate-in fade-in duration-200">
                        <div className="rounded-md bg-func-recovery-green/10 p-2.5">
                            <div className="flex items-center gap-1.5 mb-1.5">
                                <Icon name="checkmarkCircleOutline" size={12} className="text-func-recovery-green" />
                                <h3 className="text-[13px] font-semibold text-func-recovery-green">Water Retention</h3>
                            </div>
                            <p className="text-[13px] text-muted-foreground leading-snug">
                                Normal. Carbs and sodium hold extra water (~3g per 1g carb). Temporary, not fat. Flushes in 1-2 days.
                            </p>
                        </div>
                        <div className="border-t border-border/30 mt-2">
                            <button onClick={handleGotIt} className="w-full py-2 text-[13px] font-semibold text-primary active:bg-muted/50 transition-colors">
                                View Daily Wisdom
                            </button>
                        </div>
                    </div>
                )}
                </div>
            </SheetContent>
        </Sheet>
    );
}
