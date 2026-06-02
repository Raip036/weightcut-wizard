import { format, subDays } from "date-fns";
import { localCache } from "./localCache";

// ── Flag management ──

export function isDemoActive(userId: string): boolean {
  return localStorage.getItem(`demo_active_${userId}`) === "true";
}

// ── Weight logs (30 days: 80.2 → 78.1 with zigzag) ──

function generateDemoWeightLogs(userId: string) {
  const today = new Date();
  const logs: { id: string; date: string; weight_kg: number; user_id: string }[] = [];
  let weight = 80.2;
  const trend = -0.07; // ~2.1kg over 30 days

  for (let i = 29; i >= 0; i--) {
    const date = format(subDays(today, i), "yyyy-MM-dd");
    const noise = (Math.sin(i * 1.7) * 0.3) + (Math.cos(i * 0.8) * 0.15);
    weight = Math.max(77.5, weight + trend + noise * 0.4);
    logs.push({
      id: `demo-wl-${i}`,
      date,
      weight_kg: Math.round(weight * 10) / 10,
      user_id: userId,
    });
  }
  return logs;
}

// ── Nutrition logs (meals for a given date) ──
//
// Demo data is localStorage-only: the seeder does NOT hit the Supabase DB,
// so the write path does not need to call `create_meal_with_items`. The
// client reads this cache under the `"nutrition_logs"` namespace key (a
// legacy string; see spec §4.7) and consumes rows via the same `Meal`
// shape used for DB rows. Each row therefore includes `date`, pre-computed
// macro totals, and `item_count` so `MealSections` / `NutritionHero` render
// identical to a DB-backed day.

const MEAL_TEMPLATES = [
  { meal_name: "Oatmeal with banana and protein powder", calories: 420, protein_g: 35, carbs_g: 55, fats_g: 8, meal_type: "breakfast" },
  { meal_name: "Scrambled eggs with avocado toast", calories: 380, protein_g: 24, carbs_g: 28, fats_g: 20, meal_type: "breakfast" },
  { meal_name: "Protein smoothie with mixed berries", calories: 310, protein_g: 30, carbs_g: 35, fats_g: 6, meal_type: "breakfast" },
  { meal_name: "Grilled chicken with rice and broccoli", calories: 580, protein_g: 45, carbs_g: 60, fats_g: 12, meal_type: "lunch" },
  { meal_name: "Turkey wrap with salad", calories: 450, protein_g: 35, carbs_g: 40, fats_g: 14, meal_type: "lunch" },
  { meal_name: "Tuna poke bowl with brown rice", calories: 520, protein_g: 38, carbs_g: 52, fats_g: 14, meal_type: "lunch" },
  { meal_name: "Salmon fillet with sweet potato and greens", calories: 510, protein_g: 38, carbs_g: 42, fats_g: 18, meal_type: "dinner" },
  { meal_name: "Lean beef stir-fry with vegetables", calories: 490, protein_g: 40, carbs_g: 35, fats_g: 16, meal_type: "dinner" },
  { meal_name: "Chicken breast with quinoa and asparagus", calories: 530, protein_g: 44, carbs_g: 48, fats_g: 12, meal_type: "dinner" },
  { meal_name: "Greek yogurt with berries and honey", calories: 180, protein_g: 15, carbs_g: 22, fats_g: 4, meal_type: "snack" },
  { meal_name: "Protein bar", calories: 210, protein_g: 20, carbs_g: 22, fats_g: 8, meal_type: "snack" },
  { meal_name: "Apple slices with peanut butter", calories: 195, protein_g: 5, carbs_g: 20, fats_g: 12, meal_type: "snack" },
];

function generateDemoMeals(userId: string, date: string) {
  // Pick 4 meals: 1 breakfast, 1 lunch, 1 dinner, 1 snack — vary by date hash
  const hash = date.split("-").reduce((a, b) => a + parseInt(b), 0);
  const pick = (type: string) => {
    const options = MEAL_TEMPLATES.filter(m => m.meal_type === type);
    return options[hash % options.length];
  };

  return ["breakfast", "lunch", "dinner", "snack"].map((type, i) => {
    const template = pick(type);
    return {
      id: `demo-meal-${date}-${i}`,
      ...template,
      date,
      is_ai_generated: false,
      notes: null,
      item_count: 1,
      created_at: `${date}T${8 + i * 4}:00:00Z`,
    };
  });
}

// ── Training sessions (12 sessions across current month) ──

// Two-level model: `session_type` is the PRIMARY discipline (martial art /
// "S&C" / "Rest"); `session_tag` is the OPTIONAL activity descriptor and may
// be null. Kept varied so the demo dashboard exercises every renderer.
const SESSION_TEMPLATES = [
  { session_type: "BJJ", session_tag: "Drilling", duration_minutes: 90, rpe: 7, intensity: "moderate", intensity_level: 3, notes: "Worked on guard retention and sweeps from half guard. Drilled the knee shield series." },
  { session_type: "BJJ", session_tag: "Live Grappling", duration_minutes: 75, rpe: 8, intensity: "high", intensity_level: 4, notes: "Positional sparring from mount. Focused on hip escapes and re-guarding." },
  { session_type: "BJJ", session_tag: "Skill / Technical", duration_minutes: 60, rpe: 6, intensity: "moderate", intensity_level: 3, notes: "Technique class — single leg takedowns and transitions to back control." },
  { session_type: "BJJ", session_tag: null, duration_minutes: 90, rpe: 7, intensity: "moderate", intensity_level: 3, notes: "No-gi session. Guillotines and darce chokes from front headlock." },
  { session_type: "Muay Thai", session_tag: "Pad Work", duration_minutes: 60, rpe: 8, intensity: "high", intensity_level: 4, notes: "Padwork combos. Low kicks and teeps. 5 rounds of clinch work." },
  { session_type: "Muay Thai", session_tag: "Bag Work", duration_minutes: 60, rpe: 7, intensity: "moderate", intensity_level: 3, notes: "Heavy bag rounds focusing on power hooks and body kicks." },
  { session_type: "Muay Thai", session_tag: "Sparring", duration_minutes: 45, rpe: 8, intensity: "high", intensity_level: 4, notes: "Technical sparring — light contact, working angles and footwork." },
  { session_type: "S&C", session_tag: "Strength", duration_minutes: 50, rpe: 6, intensity: "moderate", intensity_level: 3, notes: "Squats, deadlifts, pull-ups. Strength endurance focus." },
  { session_type: "S&C", session_tag: "Strength", duration_minutes: 45, rpe: 5, intensity: "low", intensity_level: 2, notes: "Upper body — bench press, rows, shoulder press. Lighter session." },
  { session_type: "S&C", session_tag: "Conditioning", duration_minutes: 55, rpe: 7, intensity: "moderate", intensity_level: 3, notes: "Full body circuit — kettlebell swings, box jumps, farmer carries." },
  { session_type: "MMA", session_tag: "Sparring", duration_minutes: 45, rpe: 9, intensity: "high", intensity_level: 5, notes: "5 rounds of MMA sparring. Worked on takedown defence and cage work." },
  { session_type: "S&C", session_tag: "Run", duration_minutes: 30, rpe: 5, intensity: "low", intensity_level: 2, notes: "Easy 5km run for active recovery. Kept heart rate zone 2." },
];

function generateDemoSessions(userId: string) {
  const today = new Date();
  const sessions: any[] = [];

  // Spread 12 sessions across last 28 days (roughly every 2-3 days)
  const dayOffsets = [1, 2, 4, 5, 7, 9, 11, 13, 15, 18, 21, 25];

  for (let i = 0; i < SESSION_TEMPLATES.length; i++) {
    const template = SESSION_TEMPLATES[i];
    const date = format(subDays(today, dayOffsets[i]), "yyyy-MM-dd");
    sessions.push({
      id: `demo-session-${i}`,
      user_id: userId,
      date,
      ...template,
      soreness_level: template.rpe >= 8 ? 4 : template.rpe >= 6 ? 2 : 0,
      sleep_hours: 7 + Math.round(Math.random() * 2 * 10) / 10,
      media_url: null,
      fatigue_level: null,
      sleep_quality: null,
      mobility_done: null,
      bodyweight: null,
      created_at: `${date}T18:00:00Z`,
    });
  }
  return sessions;
}

// ── Hydration logs ──

function generateDemoHydration(userId: string, date: string) {
  return [
    { id: `demo-hyd-1`, user_id: userId, date, amount_ml: 500, sodium_mg: null, created_at: `${date}T07:00:00Z` },
    { id: `demo-hyd-2`, user_id: userId, date, amount_ml: 400, sodium_mg: null, created_at: `${date}T10:00:00Z` },
    { id: `demo-hyd-3`, user_id: userId, date, amount_ml: 600, sodium_mg: null, created_at: `${date}T13:00:00Z` },
    { id: `demo-hyd-4`, user_id: userId, date, amount_ml: 500, sodium_mg: null, created_at: `${date}T16:00:00Z` },
    { id: `demo-hyd-5`, user_id: userId, date, amount_ml: 400, sodium_mg: null, created_at: `${date}T19:00:00Z` },
  ];
}

// ── Seed all demo data into localStorage ──

export function seedDemoData(userId: string): void {
  const today = format(new Date(), "yyyy-MM-dd");
  const yesterday = format(subDays(new Date(), 1), "yyyy-MM-dd");
  const dayBefore = format(subDays(new Date(), 2), "yyyy-MM-dd");
  const currentMonth = format(new Date(), "yyyy-MM");

  // Weight logs (Dashboard reads "dashboard_weight_logs", WeightTracker reads from same)
  localCache.set(userId, "dashboard_weight_logs", generateDemoWeightLogs(userId));

  // Nutrition logs (3 days of meals)
  for (const date of [today, yesterday, dayBefore]) {
    localCache.setForDate(userId, "nutrition_logs", date, generateDemoMeals(userId, date));
  }

  // Training sessions (month view + 28d recovery view)
  const sessions = generateDemoSessions(userId);
  localCache.set(userId, `training_sessions_${currentMonth}`, sessions);
  localCache.set(userId, "training_sessions_28d", sessions);

  // Hydration (today)
  localCache.setForDate(userId, "hydration_logs", today, generateDemoHydration(userId, today));

  // Set flag
  localStorage.setItem(`demo_active_${userId}`, "true");
}

// ── Clear all demo data ──

export function clearDemoData(userId: string): void {
  const today = format(new Date(), "yyyy-MM-dd");
  const yesterday = format(subDays(new Date(), 1), "yyyy-MM-dd");
  const dayBefore = format(subDays(new Date(), 2), "yyyy-MM-dd");
  const currentMonth = format(new Date(), "yyyy-MM");

  localCache.remove(userId, "dashboard_weight_logs");

  for (const date of [today, yesterday, dayBefore]) {
    localCache.removeForDate(userId, "nutrition_logs", date);
  }

  localCache.remove(userId, `training_sessions_${currentMonth}`);
  localCache.remove(userId, "training_sessions_28d");

  localCache.removeForDate(userId, "hydration_logs", today);

  localStorage.removeItem(`demo_active_${userId}`);
}
