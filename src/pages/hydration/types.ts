// ── Types ──────────────────────────────────────────────────────────────────

export interface HourlyStep {
  hour: number;
  timeLabel?: string;
  phase?: string;
  fluidML: number;
  sodiumMg?: number;
  sodium?: number; // backward compat
  potassiumMg?: number;
  potassium?: number; // backward compat
  magnesiumMg?: number;
  carbsG?: number;
  carbs?: number; // backward compat
  drinkRecipe?: string;
  notes: string;
  foods?: string[];
}

export interface MealPlan {
  timing: string;
  carbsG: number;
  foods?: string[];
  mealIdeas?: string[]; // backward compat
  rationale: string;
}

export interface CarbRefuelPlan {
  targetCarbs?: string;
  targetCarbsG?: number;
  maxCarbsPerHour?: number;
  strategy?: string;
  meals: MealPlan[];
  totalCarbs?: string;
}

export interface ProtocolTotals {
  totalFluidLitres: number;
  totalSodiumMg: number;
  totalPotassiumMg: number;
  totalMagnesiumMg: number;
  totalCarbsG: number;
  carbTargetPerKg: string;
  maxCarbsPerHour: number;
  rehydrationWindowHours: number;
  bodyWeightKg: number;
  caffeineLowMg?: number;
  caffeineHighMg?: number;
}

export interface EducationItem {
  title: string;
  content: string;
}

export interface ProtocolEducation {
  howItWorks?: EducationItem[];
  caffeineGuidance?: string;
  carbMouthRinse?: string;
}

export interface RehydrationProtocol {
  summary: string;
  totals?: ProtocolTotals;
  hourlyProtocol: HourlyStep[];
  electrolyteRatio?: {
    sodium: string;
    potassium: string;
    magnesium: string;
  };
  carbRefuelPlan: CarbRefuelPlan;
  warnings: string[];
  education?: ProtocolEducation;
}

// ── Constants ──────────────────────────────────────────────────────────────

export const DEFAULT_WARNINGS = [
  "Do not exceed 1L of fluid per hour — exceeding gastric emptying rate causes bloating and impairs absorption",
  "Avoid high-fibre and high-fat foods until after competition — they slow gastric emptying and nutrient absorption",
  "Monitor urine colour — aim for pale yellow. Clear urine may indicate over-hydration risk (hyponatremia)",
  "If you feel nauseous, dizzy, or confused, stop the protocol and seek medical attention immediately",
  "This protocol assumes weight was lost via dehydration. If weight was lost via other means, fluid targets may be excessive",
];

export const SUGGESTED_FOODS = [
  { name: "White rice (200g cooked)", carbsG: 56, notes: "Low fibre, fast digesting" },
  { name: "Banana", carbsG: 27, notes: "Potassium-rich, gentle on gut" },
  { name: "Honey (1 tbsp)", carbsG: 17, notes: "Rapid glucose source" },
  { name: "White bread (2 slices)", carbsG: 26, notes: "Low residue" },
  { name: "Rice cakes (2)", carbsG: 14, notes: "Light, easy to eat" },
  { name: "Sports drink (500ml)", carbsG: 30, notes: "Dual hydration + carbs" },
  { name: "Sweetened milk (500ml)", carbsG: 24, notes: "Protein + carbs" },
];

export const SUGGESTED_DRINKS = [
  { name: "ORS (Oral Rehydration Solution)", usage: "Hours 1-2, priority rehydration" },
  { name: "Sports drink (Gatorade/Powerade)", usage: "Hours 2+, moderate Na + carbs" },
  { name: "Diluted fruit juice + salt", usage: "Alternative carb + electrolyte source" },
  { name: "Sweetened milk", usage: "Hour 3+, protein + carb + fluid" },
];

export const DEFAULT_EDUCATION: EducationItem[] = [
  {
    title: "Gastric Emptying",
    content: "Your stomach can process ~800-1000ml of fluid per hour. Drinking beyond this rate causes bloating and impairs absorption. This protocol spaces intake to maximise absorption efficiency.",
  },
  {
    title: "Sodium-Glucose Co-Transport (SGLT1)",
    content: "Sodium is the primary driver of water absorption in the gut. Adding sodium to your fluids activates the sodium-glucose co-transporter (SGLT1), pulling water into cells 2-3x faster than plain water alone.",
  },
  {
    title: "Glycogen-Water Binding",
    content: "Each gram of glycogen stored in muscles binds ~2.7g of water (Bergstrom & Hultman 1972). Carb-loading after weigh-in restores energy AND accelerates rehydration — a dual benefit for fight performance.",
  },
  {
    title: "150% Fluid Replacement Rule",
    content: "You must drink 150% of weight lost to account for continued urine losses during rehydration (Shirreffs & Maughan 1998; Reale SSE #183).",
  },
  {
    title: "Phased Recovery",
    content: "Hours 1-2 focus on rapid cellular rehydration with higher sodium. Hours 3+ shift to glycogen restoration with carbs. The final phase before competition maintains equilibrium without overloading the gut.",
  },
];

// ── Helper functions ───────────────────────────────────────────────────────

export function getSodium(step: HourlyStep): number {
  return step.sodiumMg ?? step.sodium ?? 0;
}
export function getPotassium(step: HourlyStep): number {
  return step.potassiumMg ?? step.potassium ?? 0;
}
export function getCarbs(step: HourlyStep): number {
  return step.carbsG ?? step.carbs ?? 0;
}
export function getMealFoods(meal: MealPlan): string[] {
  const foods = meal.foods ?? meal.mealIdeas ?? [];
  return Array.isArray(foods) ? foods : [];
}

export function getPhaseBadge(phase?: string) {
  if (!phase) return null;
  const lower = phase.toLowerCase();
  if (lower.includes("rapid"))
    return { bg: "bg-func-danger-red/10 border-func-danger-red/20", text: "text-func-danger-red" };
  if (lower.includes("active"))
    return { bg: "bg-blue-500/10 border-blue-500/20", text: "text-blue-400" };
  if (lower.includes("glycogen") || lower.includes("loading"))
    return { bg: "bg-func-recovery-green/10 border-func-recovery-green/20", text: "text-func-recovery-green" };
  if (lower.includes("pre-comp"))
    return { bg: "bg-func-warning-yellow/10 border-func-warning-yellow/20", text: "text-func-warning-yellow" };
  return { bg: "bg-muted border-border/50", text: "text-muted-foreground" };
}
