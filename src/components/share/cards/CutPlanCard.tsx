import { forwardRef } from "react";
import { CardShell, type AspectRatio } from "../templates/CardShell";
import { StatBlock } from "../templates/StatBlock";
import { usePremium } from "@/hooks/usePremium";

interface WeekPlan {
  week: number;
  targetWeight: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fats_g: number;
  focus: string;
}

interface CutPlanCardProps {
  plan: {
    weeklyPlan: WeekPlan[];
    summary: string;
    totalWeeks: number;
    weeklyLossTarget: string;
    maintenanceCalories?: number;
    deficit?: number;
    targetCalories?: number;
    safetyNotes?: string;
    fightWeek?: { lowCarb: string; sodium: string; waterLoading: string; nutrition: string };
    fightWeekStrategy?: string;
    keyPrinciples: string[];
  };
  currentWeight: number;
  goalWeight: number;
  targetDate: string;
  aspect?: AspectRatio;
}

export const CutPlanCard = forwardRef<HTMLDivElement, CutPlanCardProps>(
  ({ plan, currentWeight, goalWeight, targetDate, aspect = "square" }, ref) => {
    const isPremium = usePremium();
    const s = aspect === "story";
    const visibleWeeks = plan.weeklyPlan; // show ALL weeks

    const formattedDate = targetDate
      ? new Date(targetDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "";

    return (
      <CardShell ref={ref} aspect={aspect} isPremium={isPremium}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: s ? "40px 48px" : "32px 36px", gap: s ? 28 : 20 }}>
          {/* Header */}
          <div style={{ textAlign: "center" }}>
            <p style={{ fontSize: s ? 14 : 11, letterSpacing: "0.15em", textTransform: "uppercase", color: "hsl(var(--primary))", fontWeight: 700, marginBottom: 6 }}>
              YOUR WEIGHT CUT PLAN
            </p>
            {formattedDate && (
              <p style={{ fontSize: s ? 13 : 10, color: "rgba(255,255,255,0.5)" }}>Target: {formattedDate}</p>
            )}
          </div>

          {/* Hero stats */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: s ? 12 : 8 }}>
            <StatBlock label="Current" value={`${currentWeight}`} unit="kg" size="default" />
            <StatBlock label="Goal" value={`${goalWeight}`} unit="kg" color="#22c55e" size="default" />
            <StatBlock label="Weeks" value={`${plan.totalWeeks}`} unit="" size="default" />
          </div>

          {/* Calorie info */}
          {plan.maintenanceCalories && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: s ? 12 : 8 }}>
              <StatBlock label="Maintain" value={`${Math.round(plan.maintenanceCalories / 100) * 100}`} unit="kcal" size="default" />
              <StatBlock label="Deficit" value={`-${Math.round((plan.deficit || 0) / 100) * 100}`} unit="kcal" color="#ef4444" size="default" />
              <StatBlock label="Target" value={`${Math.round((plan.targetCalories || 0) / 100) * 100}`} unit="kcal" color="hsl(var(--primary))" size="default" />
            </div>
          )}

          {/* Week-by-week table: all weeks, all macros */}
          <div style={{ borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.1)" }}>
            {/* Header row */}
            <div style={{
              display: "grid", gridTemplateColumns: "40px 1fr 1fr 1fr 1fr 1fr",
              padding: s ? "10px 12px" : "7px 10px",
              background: "rgba(255,255,255,0.08)",
              fontSize: s ? 10 : 8,
              fontWeight: 700,
              color: "rgba(255,255,255,0.5)",
              letterSpacing: "0.05em",
              textTransform: "uppercase",
            }}>
              <span>Wk</span>
              <span style={{ textAlign: "right" }}>kg</span>
              <span style={{ textAlign: "right" }}>Cal</span>
              <span style={{ textAlign: "right" }}>P</span>
              <span style={{ textAlign: "right" }}>C</span>
              <span style={{ textAlign: "right" }}>F</span>
            </div>
            {visibleWeeks.map((w, i) => (
              <div key={w.week} style={{
                display: "grid", gridTemplateColumns: "40px 1fr 1fr 1fr 1fr 1fr",
                padding: s ? "8px 12px" : "6px 10px",
                background: i % 2 === 0 ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.06)",
                fontSize: s ? 12 : 10,
                fontWeight: 600,
                color: "#fff",
                fontVariantNumeric: "tabular-nums",
              }}>
                <span style={{ color: "rgba(255,255,255,0.6)" }}>{w.week}</span>
                <span style={{ textAlign: "right" }}>{w.targetWeight.toFixed(1)}</span>
                <span style={{ textAlign: "right" }}>{Math.round(w.calories / 100) * 100}</span>
                <span style={{ textAlign: "right" }}>{w.protein_g}</span>
                <span style={{ textAlign: "right" }}>{w.carbs_g}</span>
                <span style={{ textAlign: "right" }}>{w.fats_g}</span>
              </div>
            ))}
          </div>

          {/* Key Principles */}
          <div style={{ display: "flex", flexDirection: "column", gap: s ? 8 : 6 }}>
            {plan.keyPrinciples.slice(0, 3).map((p, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                <div style={{ width: 6, height: 6, borderRadius: 3, background: "hsl(var(--primary))", marginTop: s ? 7 : 5, flexShrink: 0 }} />
                <p style={{ fontSize: s ? 13 : 10, color: "rgba(255,255,255,0.65)", lineHeight: 1.4 }}>{p}</p>
              </div>
            ))}
          </div>

          {/* Fight Week Strategy */}
          {plan.fightWeek ? (
            <div style={{ display: "flex", flexDirection: "column", gap: s ? 8 : 6 }}>
              <p style={{ fontSize: s ? 11 : 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.1em", color: "rgba(255,255,255,0.5)" }}>Fight Week</p>
              {[
                { label: "Low Carb", text: plan.fightWeek.lowCarb, color: "#f59e0b" },
                { label: "Sodium", text: plan.fightWeek.sodium, color: "#f97316" },
                { label: "Water", text: plan.fightWeek.waterLoading, color: "#06b6d4" },
                { label: "Nutrition", text: plan.fightWeek.nutrition, color: "#22c55e" },
              ].map((section) => (
                <div key={section.label} style={{
                  borderLeft: `3px solid ${section.color}`,
                  paddingLeft: s ? 12 : 8,
                  fontSize: s ? 11 : 9,
                  color: "rgba(255,255,255,0.55)",
                  lineHeight: 1.4,
                }}>
                  <span style={{ fontWeight: 700, color: section.color }}>{section.label}: </span>
                  {section.text}
                </div>
              ))}
            </div>
          ) : plan.fightWeekStrategy ? (
            <div style={{
              borderLeft: "3px solid hsl(var(--primary))",
              paddingLeft: s ? 14 : 10,
              fontSize: s ? 12 : 10,
              color: "rgba(255,255,255,0.55)",
              lineHeight: 1.5,
            }}>
              <span style={{ fontWeight: 700, color: "rgba(255,255,255,0.8)" }}>Fight Week: </span>
              {plan.fightWeekStrategy}
            </div>
          ) : null}

          {/* Disclaimer */}
          <p style={{
            fontSize: s ? 10 : 8,
            color: "rgba(255,255,255,0.3)",
            textAlign: "center",
            lineHeight: 1.4,
            marginTop: "auto",
          }}>
            A rough guide. FightCamp Wizard adapts alongside you.
          </p>
        </div>
      </CardShell>
    );
  }
);

CutPlanCard.displayName = "CutPlanCard";
