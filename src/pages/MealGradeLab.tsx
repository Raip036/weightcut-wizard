// THROWAWAY MOCK LAB - /meal-grade-lab. Delete after sign-off.
import { useState } from "react";
import { Flame, Pizza, Fish, Droplet, X, Minus, Plus } from "lucide-react";
import MealHealthGrade from "@/components/dashboardlab/MealHealthGrade";
import FoodHealthRating from "@/components/dashboardlab/FoodHealthRating";
import MacroText from "@/components/dashboardlab/MacroText";
import { SAMPLE_MEALS, scoreMeal } from "@/components/dashboardlab/foodHealthScore";

const MULTIPLIERS = ["½×", "1×", "1½×", "2×"];

export default function MealGradeLab() {
  const [mealIdx, setMealIdx] = useState(0);
  const meal = SAMPLE_MEALS[mealIdx];
  const { score, worst } = scoreMeal(meal.foods);

  const totals = meal.foods.reduce(
    (a, f) => ({
      cal: a.cal + f.calories,
      p: a.p + f.protein_g,
      c: a.c + f.carbs_g,
      f: a.f + f.fats_g,
    }),
    { cal: 0, p: 0, c: 0, f: 0 },
  );

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-4 pb-16 pt-3">
        {/* Header */}
        <div className="flex items-center justify-between py-2">
          <p className="text-[20px] font-bold tracking-tight">Add a meal</p>
          <button className="flex h-8 w-8 items-center justify-center rounded-full bg-card text-muted-foreground" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Sample toggle (lab only) */}
        <div className="mb-3 flex gap-2">
          {SAMPLE_MEALS.map((m, i) => (
            <button
              key={m.key}
              onClick={() => setMealIdx(i)}
              className={`rounded-full px-3 py-1 text-[12px] font-medium transition-colors ${
                i === mealIdx ? "bg-primary text-white" : "bg-card text-muted-foreground"
              }`}
            >
              {m.title}
            </button>
          ))}
        </div>

        {/* Photo placeholder */}
        <div
          className="relative h-40 w-full overflow-hidden rounded-2xl"
          style={{ background: "linear-gradient(135deg, hsl(var(--muted)) 0%, hsl(var(--card)) 100%)" }}
        >
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40">
            <span className="text-[13px]">meal photo</span>
          </div>
        </div>

        {/* Meal-type chips */}
        <div className="mt-3 flex gap-2">
          {["Breakfast", "Lunch", "Dinner", "Snack"].map((t, i) => (
            <span
              key={t}
              className={`rounded-full px-3.5 py-1.5 text-[13px] font-medium ${
                i === 1 ? "bg-primary text-white" : "bg-card text-muted-foreground"
              }`}
            >
              {t}
            </span>
          ))}
        </div>

        {/* NEW: meal health grade, above the title */}
        <MealHealthGrade score={score} worstItem={worst?.name ?? null} />

        {/* Meal title */}
        <p className="mt-1 text-[18px] font-bold tracking-tight">{meal.title}</p>

        {/* Macro summary cards */}
        <div className="mt-3 grid grid-cols-2 gap-3">
          {[
            { label: "Calories", val: Math.round(totals.cal), unit: "", Icon: Flame, color: "hsl(var(--energy))" },
            { label: "Carbs", val: Math.round(totals.c), unit: "g", Icon: Pizza, color: "rgb(var(--func-carbs-orange))" },
            { label: "Protein", val: Math.round(totals.p), unit: "g", Icon: Fish, color: "rgb(var(--func-protein-blue))" },
            { label: "Fats", val: Math.round(totals.f), unit: "g", Icon: Droplet, color: "rgb(var(--func-fats-purple))" },
          ].map(({ label, val, unit, Icon, color }) => (
            <div key={label} className="rounded-2xl border border-border/50 bg-card p-4">
              <div className="flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5" style={{ color }} />
                <span className="section-header">{label}</span>
              </div>
              <p className="mt-1 display-number text-[18px] font-extrabold">
                {val}
                <span className="text-[12px] font-medium text-muted-foreground">{unit}</span>
              </p>
            </div>
          ))}
        </div>

        {/* Detected foods */}
        <div className="mt-5 flex items-center justify-between">
          <p className="section-header">DETECTED FOODS</p>
          <span className="text-[11px] text-muted-foreground">Tap to adjust</span>
        </div>

        <div className="mt-2 space-y-2">
          {meal.foods.map((f, i) => (
            <div key={i} className="rounded-2xl border border-border/30 bg-card/60 px-3 py-2.5">
              {/* Row 1: name + kcal stepper */}
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="truncate text-[15px] font-semibold">{f.name}</p>
                  <p className="text-[12px] text-muted-foreground">{f.quantity}</p>
                </div>
                <div className="flex items-center gap-2">
                  <button className="flex h-6 w-6 items-center justify-center rounded-full bg-muted/50 text-muted-foreground">
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <div className="text-center">
                    <p className="display-number text-[16px] font-bold leading-none">{Math.round(f.calories)}</p>
                    <p className="text-[9px] tracking-wide text-muted-foreground">KCAL</p>
                  </div>
                  <button className="flex h-6 w-6 items-center justify-center rounded-full bg-muted/50 text-muted-foreground">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Row 2: macros (colored text) + per-food health rating */}
              <div className="mt-2 flex items-center">
                <MacroText protein_g={f.protein_g} carbs_g={f.carbs_g} fats_g={f.fats_g} />
                <FoodHealthRating score={f.healthScore} />
              </div>

              {/* Row 3: serving multipliers */}
              <div className="mt-2.5 flex gap-1.5">
                {MULTIPLIERS.map((m, mi) => (
                  <span
                    key={m}
                    className={`flex-1 rounded-md py-1.5 text-center text-[12px] font-medium ${
                      mi === 1
                        ? "bg-primary/15 text-primary ring-1 ring-primary/40"
                        : "bg-muted/40 text-muted-foreground/70"
                    }`}
                  >
                    {m}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
