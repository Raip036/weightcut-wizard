// THROWAWAY MOCK LAB - /food-grade-lab. Delete after sign-off.
import { useState } from "react";
import { DailyFoodQualityBar } from "@/components/nutrition/health/DailyFoodQualityBar";
import { FoodQualityExplainerSheet } from "@/components/nutrition/health/FoodQualityExplainerSheet";

export default function FoodGradeInfoLab() {
  const [open, setOpen] = useState(false);
  const [score, setScore] = useState(72);

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-5 pt-6">
        <p className="text-[20px] font-bold tracking-tight">Food grade explainer</p>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Tap the bar to open the grading explainer sheet.
        </p>

        {/* Score variants to preview the sheet against different grades. */}
        <div className="mt-4 flex gap-2">
          {[92, 72, 48, 22].map((s) => (
            <button
              key={s}
              onClick={() => setScore(s)}
              className={`rounded-full px-3 py-1 text-[12px] font-medium ${
                s === score ? "bg-primary text-white" : "bg-card text-muted-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <div className="mt-6 rounded-2xl border border-border/40 bg-card/40 p-4">
          <DailyFoodQualityBar score={score} mealCount={2} onPress={() => setOpen(true)} />
        </div>
      </div>

      <FoodQualityExplainerSheet open={open} onOpenChange={setOpen} />
    </div>
  );
}
