import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { AlertTriangle, Check, ChevronRight, TrendingDown, Settings as SettingsIcon } from "lucide-react";
import { ImpactStyle } from "@capacitor/haptics";
import { motion, AnimatePresence } from "motion/react";
import { profileSchema } from "@/lib/validation";
import { useUser } from "@/contexts/UserContext";
import { celebrateSuccess, triggerHaptic, triggerHapticSelection } from "@/lib/haptics";
import { GoalsSkeleton } from "@/components/ui/skeleton-loader";
import { ProfilePictureUpload } from "@/components/ProfilePictureUpload";

const ACTIVITY_MULTIPLIERS = {
  sedentary: 1.2,
  lightly_active: 1.375,
  moderately_active: 1.55,
  very_active: 1.725,
  extra_active: 1.9,
};

const ATHLETE_TYPES: Record<string, string> = {
  mma: "MMA", boxing: "Boxing", muay_thai: "Muay Thai", bjj: "BJJ",
  wrestling: "Wrestling", kickboxing: "Kickboxing", judo: "Judo",
  karate: "Karate", other: "Other",
};

const EXPERIENCE_LABELS: Record<string, string> = {
  beginner: "Beginner", amateur: "Amateur Fighter", pro: "Experienced / Pro",
};

const AGGRESSIVENESS_LABELS: Record<string, string> = {
  conservative: "Conservative", balanced: "Balanced", aggressive: "Aggressive",
};

const SEX_LABELS: Record<string, string> = { male: "Male", female: "Female" };

const ACTIVITY_LABELS: Record<string, string> = {
  sedentary: "Sedentary",
  lightly_active: "Light",
  moderately_active: "Moderate",
  very_active: "Active",
  extra_active: "Extreme",
};

const GOAL_LABELS: Record<string, string> = {
  cutting: "Cut",
  losing: "Lose",
  maintaining: "Maintain",
  gaining: "Gain",
};

const SLEEP_LABELS: Record<string, string> = {
  "<5": "<5h",
  "5-6": "5–6h",
  "6-7": "6–7h",
  "7-8": "7–8h",
  "8+": "8h+",
};

type FieldKey =
  | "age" | "sex" | "height_cm" | "current_weight_kg" | "body_fat_pct" | "sleep_hours"
  | "goal_weight_kg" | "fight_week_target_kg" | "target_date"
  | "activity_level" | "training_frequency"
  | "athlete_type" | "goal_type" | "experience_level" | "plan_aggressiveness";

type ActiveField = { key: FieldKey; title: string } | null;

export default function Goals() {
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const { toast } = useToast();
  const {
    userId,
    currentWeight,
    profile: contextProfile,
    refreshProfile,
    userName,
    setUserName,
    avatarUrl,
    setAvatarUrl,
    loadCutPlan,
  } = useUser();
  const updateGoals = useMutation(api.profiles.updateGoals);
  const setUserNameMut = useMutation(api.profiles.setUserName);
  const updateCampMut = useMutation(api.fight_camp.updateCamp);
  const activeCamp = useQuery(api.fight_camp.getActiveCamp, userId ? {} : "skip");

  // Editable display name — mirrored so typing doesn't churn the auth cache.
  const [editedName, setEditedName] = useState<string>(userName ?? "");
  useEffect(() => { setEditedName(userName ?? ""); }, [userName]);

  const flushName = useCallback(async () => {
    const next = editedName.trim();
    if (!userId || !next || next === userName) return;
    try {
      await setUserNameMut({ displayName: next });
      setUserName(next);
      flagSaved();
    } catch (err) {
      console.warn("Goals: setUserName failed", err);
    }
  }, [editedName, userId, userName, setUserNameMut, setUserName]);

  // Cut plan summary surfaced as a tappable row in YOUR PLAN group.
  const [cutPlanSummary, setCutPlanSummary] = useState<{
    totalWeeks: number;
    weeklyLossTarget: string;
    goalWeight: number;
    planType: "weight_loss" | "weight_cut";
  } | null>(null);

  useEffect(() => {
    const readSummaryFromRaw = (raw: string | null) => {
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        const last = parsed?.weeklyPlan?.[parsed.weeklyPlan.length - 1];
        if (!parsed?.totalWeeks || !parsed?.weeklyLossTarget) return null;
        return {
          totalWeeks: parsed.totalWeeks,
          weeklyLossTarget: parsed.weeklyLossTarget,
          goalWeight: parsed.goalWeight ?? last?.targetWeight ?? 0,
          planType: parsed.planType === "weight_loss" ? "weight_loss" : "weight_cut",
        } as const;
      } catch { return null; }
    };
    const local = readSummaryFromRaw(localStorage.getItem("wcw_cut_plan"));
    if (local) { setCutPlanSummary(local); return; }
    if (!userId) return;
    let cancelled = false;
    (async () => {
      const dbPlan = await loadCutPlan();
      if (cancelled || !dbPlan?.weeklyPlan) return;
      localStorage.setItem("wcw_cut_plan", JSON.stringify(dbPlan));
      setCutPlanSummary(readSummaryFromRaw(JSON.stringify(dbPlan)));
    })();
    return () => { cancelled = true; };
  }, [userId, loadCutPlan]);

  const [formData, setFormData] = useState({
    age: "", sex: "", height_cm: "", current_weight_kg: "", goal_weight_kg: "",
    fight_week_target_kg: "", target_date: "",
    activity_level: "", training_frequency: "",
    athlete_type: "", goal_type: "", experience_level: "",
    training_types: [] as string[],
    sleep_hours: "", primary_struggle: "", plan_aggressiveness: "",
    body_fat_pct: "",
  });

  const [useAutoTarget, setUseAutoTarget] = useState(true);
  const [activeField, setActiveField] = useState<ActiveField>(null);

  // Transient "Saved ✓" header chip — set on every successful auto-save.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flagSaved = () => {
    setSavedAt(Date.now());
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedAt(null), 1800);
  };
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  useEffect(() => {
    if (!userId) { navigate("/auth"); return; }
    if (contextProfile) {
      const currentWeightValue = currentWeight ?? contextProfile.current_weight_kg ?? 0;
      const p = contextProfile as any;
      setFormData({
        age: contextProfile.age?.toString() || "",
        sex: contextProfile.sex || "",
        height_cm: contextProfile.height_cm?.toString() || "",
        current_weight_kg: currentWeightValue.toString(),
        goal_weight_kg: contextProfile.goal_weight_kg?.toString() || "",
        fight_week_target_kg: contextProfile.fight_week_target_kg?.toString() || "",
        target_date: contextProfile.target_date || "",
        activity_level: contextProfile.activity_level || "",
        training_frequency: contextProfile.training_frequency?.toString() || "",
        athlete_type: p.athlete_type || "",
        goal_type: p.goal_type || "cutting",
        experience_level: p.experience_level || "",
        training_types: p.training_types || [],
        sleep_hours: p.sleep_hours || "",
        primary_struggle: p.primary_struggle || "",
        plan_aggressiveness: p.plan_aggressiveness || "",
        body_fat_pct: p.body_fat_pct?.toString() || "",
      });
      if (contextProfile.goal_weight_kg && contextProfile.fight_week_target_kg) {
        const recommended = Math.round(contextProfile.goal_weight_kg * 1.055 * 10) / 10;
        setUseAutoTarget(Math.abs(contextProfile.fight_week_target_kg - recommended) < 0.1);
      }
      setLoading(false);
    } else {
      setLoading(false);
    }
  }, [userId, contextProfile, currentWeight, navigate]);

  const calculateBMR = (data = formData) => {
    const weight = parseFloat(data.current_weight_kg) || 70;
    const height = parseFloat(data.height_cm) || 175;
    const age = parseInt(data.age) || 25;
    return data.sex === "male"
      ? 10 * weight + 6.25 * height - 5 * age + 5
      : 10 * weight + 6.25 * height - 5 * age - 161;
  };
  const calculateRecommendedTarget = (fightNightWeight: number) =>
    Math.round(fightNightWeight * 1.055 * 10) / 10;

  const assessTargetSafety = (fightNightWeight: number, fightWeekTarget: number) => {
    const cutPct = ((fightWeekTarget - fightNightWeight) / fightNightWeight) * 100;
    if (cutPct <= 5) return { level: "safe" as const, message: "Safe range (≤5%)" };
    if (cutPct <= 7) return { level: "moderate" as const, message: "Moderate risk (5-7%)" };
    return { level: "risky" as const, message: "High risk (>7%)" };
  };

  // Auto-recompute diet target when goal weight changes (auto mode only).
  useEffect(() => {
    if (useAutoTarget && formData.goal_weight_kg) {
      const rec = calculateRecommendedTarget(parseFloat(formData.goal_weight_kg));
      setFormData(prev => ({ ...prev, fight_week_target_kg: rec.toString() }));
    }
  }, [formData.goal_weight_kg, useAutoTarget]);

  // ── Auto-save ────────────────────────────────────────────────────────
  // Each field commit calls autoSave with the next snapshot. We pass the
  // override explicitly rather than reading state to avoid the stale-closure
  // race that happens when the sheet closes before React re-renders.
  const autoSave = useCallback(async (overrides: Partial<typeof formData>) => {
    if (!userId) return;
    const next = { ...formData, ...overrides };
    setFormData(next);

    // Don't even try saving until the core profile fields exist — first-run
    // users hit the onboarding flow instead. updateGoals fails validation on
    // missing core fields, which would noisily toast on every tap.
    const haveCore = next.age && next.height_cm && next.current_weight_kg && next.training_frequency;
    if (!haveCore) return;

    const validationResult = profileSchema.safeParse({
      age: parseInt(next.age),
      height_cm: parseFloat(next.height_cm),
      current_weight_kg: parseFloat(next.current_weight_kg),
      goal_weight_kg: parseFloat(next.goal_weight_kg) || 0,
      fight_week_target_kg: next.goal_type === "cutting"
        ? parseFloat(next.fight_week_target_kg) || undefined
        : undefined,
      training_frequency: parseInt(next.training_frequency),
    });
    if (!validationResult.success) {
      toast({ variant: "destructive", title: "Invalid value", description: validationResult.error.errors[0].message });
      return;
    }

    try {
      const bmr = calculateBMR(next);
      const tdee = bmr * (ACTIVITY_MULTIPLIERS[next.activity_level as keyof typeof ACTIVITY_MULTIPLIERS] ?? 1.55);
      await updateGoals({
        age: parseInt(next.age),
        sex: next.sex,
        heightCm: parseFloat(next.height_cm),
        currentWeightKg: parseFloat(next.current_weight_kg),
        goalWeightKg: parseFloat(next.goal_weight_kg),
        fightWeekTargetKg: next.goal_type === "cutting" ? parseFloat(next.fight_week_target_kg) : undefined,
        targetDate: next.target_date,
        activityLevel: next.activity_level,
        trainingFrequency: parseInt(next.training_frequency),
        bmr,
        tdee,
        athleteType: next.athlete_type || undefined,
        goalType: next.goal_type || undefined,
        experienceLevel: next.experience_level || undefined,
        trainingTypes: next.training_types.length > 0 ? next.training_types : undefined,
        sleepHours: next.sleep_hours || undefined,
        primaryStruggle: next.primary_struggle || undefined,
        planAggressiveness: next.plan_aggressiveness || undefined,
        bodyFatPct: next.body_fat_pct ? parseFloat(next.body_fat_pct) : undefined,
      });

      // Mirror target_date → active camp.fightDate so the dashboard / camp
      // pages don't read two conflicting dates.
      if (
        activeCamp && !activeCamp.isCompleted &&
        next.target_date && next.target_date !== activeCamp.fightDate
      ) {
        try { await updateCampMut({ id: activeCamp._id, fightDate: next.target_date }); }
        catch (e) { console.warn("Goals: failed to sync active camp fightDate", e); }
      }

      await refreshProfile();
      flagSaved();
      triggerHaptic(ImpactStyle.Light);
    } catch (error: any) {
      toast({ variant: "destructive", title: "Save failed", description: error.message });
    }
  }, [formData, userId, updateGoals, updateCampMut, activeCamp, refreshProfile, toast]);

  if (loading) return <GoalsSkeleton />;

  const isFighter = formData.goal_type === "cutting";
  const safetyFeedback = formData.goal_weight_kg && formData.fight_week_target_kg
    ? assessTargetSafety(parseFloat(formData.goal_weight_kg), parseFloat(formData.fight_week_target_kg))
    : null;

  const selectedSports = formData.athlete_type
    ? formData.athlete_type.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  const primarySport = selectedSports[0] ?? "";

  // Subtitle: age · sex · height · weight as a single line.
  const subtitle = [
    formData.age && `${formData.age}`,
    formData.sex && SEX_LABELS[formData.sex],
    formData.height_cm && `${formData.height_cm}cm`,
    formData.current_weight_kg && `${formData.current_weight_kg}kg`,
  ].filter(Boolean).join(" · ");

  return (
    <div className="animate-page-in px-5 py-3 sm:p-5 max-w-2xl mx-auto pb-20 md:pb-8">
      {/* Hero header — large-title with centered avatar + name + subtitle.
          Settings gear sits top-right (this page IS the edit-profile
          destination when the user taps the Dashboard avatar; the gear
          is the access point for app settings now that the ProfileSheet
          menu is no longer used). The Saved indicator shifts left when
          present so the gear stays in its corner. */}
      <header className="relative pt-2 pb-6">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('wcw:open-settings'))}
          aria-label="Settings"
          className="absolute top-2 right-0 flex h-9 w-9 items-center justify-center rounded-full active:bg-neutral-800 transition-colors"
        >
          <SettingsIcon className="h-5 w-5 text-muted-foreground" strokeWidth={2} />
        </button>

        <AnimatePresence>
          {savedAt && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.9 }}
              transition={{ duration: 0.18 }}
              className="absolute top-2 right-12 inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-func-recovery-green/15 text-func-recovery-green text-[11px] font-semibold"
            >
              <Check className="h-3 w-3" strokeWidth={3} />
              Saved
            </motion.div>
          )}
        </AnimatePresence>

        <div className="flex flex-col items-center gap-3">
          <ProfilePictureUpload
            currentAvatarUrl={avatarUrl}
            onUploadSuccess={(url) => { setAvatarUrl(url); flagSaved(); }}
            size="lg"
            showRemove={false}
          />
          <input
            value={editedName}
            onChange={(e) => setEditedName(e.target.value)}
            onBlur={() => void flushName()}
            placeholder="Your name"
            className="text-[28px] font-bold tracking-tight text-center bg-transparent border-0 focus:outline-none focus:ring-0 placeholder:text-muted-foreground/40 max-w-[280px]"
            aria-label="Display name"
          />
          {subtitle && (
            <p className="text-[13px] text-muted-foreground tabular-nums tracking-tight">
              {subtitle}
            </p>
          )}
        </div>
      </header>

      <div className="space-y-6">
        {/* YOUR PLAN — quick link to the canonical timeline */}
        {cutPlanSummary && (
          <SettingsGroup title={cutPlanSummary.planType === "weight_loss" ? "Your weight loss plan" : "Your cut plan"}>
            <button
              type="button"
              onClick={() => {
                triggerHaptic(ImpactStyle.Light);
                navigate(cutPlanSummary.planType === "weight_loss" ? "/weight-plan" : "/cut-plan");
              }}
              className="w-full flex items-center gap-3 px-4 py-3 min-h-[52px] active:bg-muted/30 transition-colors text-left"
            >
              <div className="h-9 w-9 rounded-xs bg-primary/10 flex items-center justify-center shrink-0">
                <TrendingDown className="h-4.5 w-4.5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium leading-tight">View full plan</p>
                <p className="text-[12px] text-muted-foreground mt-0.5 leading-snug truncate">
                  {cutPlanSummary.totalWeeks} weeks · {cutPlanSummary.weeklyLossTarget}
                  {cutPlanSummary.goalWeight ? ` · target ${cutPlanSummary.goalWeight}kg` : ""}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground/60 shrink-0" />
            </button>
          </SettingsGroup>
        )}

        {/* PERSONAL DETAILS */}
        <SettingsGroup title="Personal details">
          <SettingsRow label="Age" value={formData.age || "—"} onTap={() => setActiveField({ key: "age", title: "Age" })} />
          <SettingsRow label="Sex" value={SEX_LABELS[formData.sex] ?? "—"} onTap={() => setActiveField({ key: "sex", title: "Sex" })} />
          <SettingsRow label="Height" value={formData.height_cm ? `${formData.height_cm} cm` : "—"} onTap={() => setActiveField({ key: "height_cm", title: "Height" })} />
          <SettingsRow label="Weight" value={formData.current_weight_kg ? `${formData.current_weight_kg} kg` : "—"} onTap={() => setActiveField({ key: "current_weight_kg", title: "Weight" })} />
          <SettingsRow label="Body fat" value={formData.body_fat_pct ? `${formData.body_fat_pct}%` : "—"} onTap={() => setActiveField({ key: "body_fat_pct", title: "Body fat %" })} />
          <SettingsRow label="Sleep" value={SLEEP_LABELS[formData.sleep_hours] ?? "—"} onTap={() => setActiveField({ key: "sleep_hours", title: "Sleep per night" })} />
        </SettingsGroup>

        {/* TARGETS */}
        <SettingsGroup title="Targets">
          <SettingsRow
            label={isFighter ? "Weight class" : "Goal weight"}
            value={formData.goal_weight_kg ? `${formData.goal_weight_kg} kg` : "—"}
            accent
            onTap={() => setActiveField({ key: "goal_weight_kg", title: isFighter ? "Weight class" : "Goal weight" })}
          />
          {isFighter && (
            <SettingsRow
              label="Diet target"
              value={
                formData.fight_week_target_kg
                  ? `${formData.fight_week_target_kg} kg${useAutoTarget ? " · auto" : ""}`
                  : "—"
              }
              hint={!useAutoTarget && safetyFeedback ? safetyFeedback.message : undefined}
              hintTone={
                !useAutoTarget && safetyFeedback
                  ? (safetyFeedback.level === "safe" ? "ok" : safetyFeedback.level === "moderate" ? "warn" : "bad")
                  : undefined
              }
              onTap={() => setActiveField({ key: "fight_week_target_kg", title: "Diet target" })}
            />
          )}
          <SettingsRow
            label="Target date"
            value={formData.target_date ? formatDate(formData.target_date) : "—"}
            onTap={() => setActiveField({ key: "target_date", title: "Target date" })}
          />
        </SettingsGroup>

        {/* ACTIVITY & TRAINING */}
        <SettingsGroup title="Activity & training">
          <SettingsRow label="Activity level" value={ACTIVITY_LABELS[formData.activity_level] ?? "—"} onTap={() => setActiveField({ key: "activity_level", title: "Activity level" })} />
          <SettingsRow label="Training" value={formData.training_frequency ? `${formData.training_frequency} / week` : "—"} onTap={() => setActiveField({ key: "training_frequency", title: "Sessions per week" })} />
        </SettingsGroup>

        {/* ATHLETE PROFILE */}
        <SettingsGroup title="Athlete profile">
          <SettingsRow label="Sport" value={ATHLETE_TYPES[primarySport] ?? "—"} onTap={() => setActiveField({ key: "athlete_type", title: "Sport" })} />
          <SettingsRow label="Goal" value={GOAL_LABELS[formData.goal_type] ?? "—"} onTap={() => setActiveField({ key: "goal_type", title: "Primary goal" })} />
          <SettingsRow label="Experience" value={EXPERIENCE_LABELS[formData.experience_level] ?? "—"} onTap={() => setActiveField({ key: "experience_level", title: "Experience" })} />
          <SettingsRow label="Plan style" value={AGGRESSIVENESS_LABELS[formData.plan_aggressiveness] ?? "—"} onTap={() => setActiveField({ key: "plan_aggressiveness", title: "Plan style" })} />
        </SettingsGroup>
      </div>

      {/* Field edit sheet — focused single-field editor */}
      <EditFieldSheet
        active={activeField}
        formData={formData}
        isFighter={isFighter}
        useAutoTarget={useAutoTarget}
        onUseAutoTargetChange={(v) => {
          setUseAutoTarget(v);
          if (v && formData.goal_weight_kg) {
            const rec = calculateRecommendedTarget(parseFloat(formData.goal_weight_kg));
            void autoSave({ fight_week_target_kg: rec.toString() });
          }
        }}
        onCommit={(overrides) => {
          void autoSave(overrides);
        }}
        onClose={() => setActiveField(null)}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Inline UI primitives — iOS Settings-style grouped rows + focused
// edit sheet. Kept in this file so the page reads top-to-bottom.
// ─────────────────────────────────────────────────────────────────────

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="px-4 mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/80">
        {title}
      </h2>
      <div className="rounded-xs bg-card/60 backdrop-blur-sm border border-border/40 overflow-hidden divide-y divide-border/30">
        {children}
      </div>
    </section>
  );
}

function SettingsRow({
  label, value, accent, hint, hintTone, onTap,
}: {
  label: string;
  value: string;
  accent?: boolean;
  hint?: string;
  hintTone?: "ok" | "warn" | "bad";
  onTap: () => void;
}) {
  return (
    <button
      type="button"
      onClick={() => { triggerHapticSelection(); onTap(); }}
      className="w-full min-h-[52px] flex items-center gap-3 px-4 py-2.5 text-left active:bg-muted/40 transition-colors"
    >
      <div className="flex-1 min-w-0">
        <p className="text-[15px] font-medium leading-tight truncate">{label}</p>
        {hint && (
          <p className={`mt-0.5 text-[12px] font-medium leading-snug flex items-center gap-1 ${
            hintTone === "ok" ? "text-func-recovery-green" : hintTone === "warn" ? "text-func-warning-yellow" : "text-func-danger-red"
          }`}>
            <AlertTriangle className="h-3 w-3 shrink-0" />
            <span className="truncate">{hint}</span>
          </p>
        )}
      </div>
      <span className={`text-[15px] tabular-nums shrink-0 truncate max-w-[55%] text-right ${
        accent ? "text-primary font-semibold" : "text-muted-foreground"
      }`}>
        {value}
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
    </button>
  );
}

function EditFieldSheet({
  active, formData, isFighter, useAutoTarget, onUseAutoTargetChange, onCommit, onClose,
}: {
  active: ActiveField;
  formData: any;
  isFighter: boolean;
  useAutoTarget: boolean;
  onUseAutoTargetChange: (v: boolean) => void;
  onCommit: (overrides: Record<string, any>) => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<string>("");
  useEffect(() => {
    if (!active) return;
    setDraft(formData[active.key] ?? "");
  }, [active, formData]);

  if (!active) return null;

  const commit = (value: string) => {
    let key: string = active.key;
    if (active.key === "athlete_type") {
      // Sport is stored as CSV; honour primary slot only on this page.
      onCommit({ athlete_type: value });
    } else {
      onCommit({ [key]: value });
    }
    onClose();
  };

  const commitNumber = () => {
    onCommit({ [active.key]: draft });
    onClose();
  };

  const renderBody = () => {
    switch (active.key) {
      case "age":
      case "height_cm":
      case "current_weight_kg":
      case "body_fat_pct":
      case "goal_weight_kg":
      case "fight_week_target_kg":
      case "training_frequency":
        return (
          <NumericEditor
            value={draft}
            unit={
              active.key === "age" ? "yrs"
                : active.key === "height_cm" ? "cm"
                : active.key === "body_fat_pct" ? "%"
                : active.key === "training_frequency" ? "/wk"
                : "kg"
            }
            step={
              active.key === "current_weight_kg" || active.key === "goal_weight_kg" ||
              active.key === "fight_week_target_kg" || active.key === "body_fat_pct" ? "0.1" : "1"
            }
            extraControl={
              active.key === "fight_week_target_kg" && isFighter ? (
                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => onUseAutoTargetChange(!useAutoTarget)}
                    className={`flex-1 h-10 rounded-xs text-[13px] font-semibold transition-colors ${
                      useAutoTarget ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground"
                    }`}
                  >
                    Auto (5.5% buffer)
                  </button>
                  <button
                    type="button"
                    onClick={() => onUseAutoTargetChange(false)}
                    className={`flex-1 h-10 rounded-xs text-[13px] font-semibold transition-colors ${
                      !useAutoTarget ? "bg-primary text-primary-foreground" : "bg-muted/40 text-muted-foreground"
                    }`}
                  >
                    Manual
                  </button>
                </div>
              ) : null
            }
            disabled={active.key === "fight_week_target_kg" && useAutoTarget}
            onChange={setDraft}
            onCommit={commitNumber}
          />
        );

      case "target_date":
        return (
          <div className="space-y-3">
            <label className="block">
              <span className="sr-only">Target date</span>
              <Input
                type="date"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                className="h-12 rounded-xs text-[16px] bg-muted/30 border-border/40"
              />
            </label>
            <button
              type="button"
              onClick={commitNumber}
              className="w-full h-12 rounded-xs bg-primary text-primary-foreground text-[15px] font-semibold active:scale-[0.98] transition-transform"
            >
              Save
            </button>
          </div>
        );

      case "sex":
        return <ChipPicker value={draft} onPick={commit} options={[
          { value: "male", label: "Male" },
          { value: "female", label: "Female" },
        ]} />;

      case "sleep_hours":
        return <ChipPicker value={draft} onPick={commit} options={Object.entries(SLEEP_LABELS).map(([v, l]) => ({ value: v, label: l }))} />;

      case "activity_level":
        return <ChipPicker value={draft} onPick={commit} options={Object.entries(ACTIVITY_LABELS).map(([v, l]) => ({ value: v, label: l }))} />;

      case "goal_type":
        return <ChipPicker value={draft} onPick={commit} options={Object.entries(GOAL_LABELS).map(([v, l]) => ({ value: v, label: l }))} />;

      case "experience_level":
        return <ChipPicker value={draft} onPick={commit} options={Object.entries(EXPERIENCE_LABELS).map(([v, l]) => ({ value: v, label: l }))} />;

      case "plan_aggressiveness":
        return <ChipPicker value={draft} onPick={commit} options={Object.entries(AGGRESSIVENESS_LABELS).map(([v, l]) => ({ value: v, label: l }))} />;

      case "athlete_type":
        return <ChipPicker value={draft} onPick={commit} options={Object.entries(ATHLETE_TYPES).map(([v, l]) => ({ value: v, label: l }))} columns={2} />;

      default:
        return null;
    }
  };

  return (
    <Sheet open={!!active} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="bottom" className="rounded-t-3xl px-5 pb-8 pt-3 max-h-[80vh] overflow-y-auto">
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-muted-foreground/30" aria-hidden />
        <SheetHeader>
          <SheetTitle className="text-[17px] font-semibold text-center">{active.title}</SheetTitle>
        </SheetHeader>
        <div className="mt-4">
          {renderBody()}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function NumericEditor({
  value, unit, step, disabled, extraControl, onChange, onCommit,
}: {
  value: string;
  unit: string;
  step: string;
  disabled?: boolean;
  extraControl?: React.ReactNode;
  onChange: (v: string) => void;
  onCommit: () => void;
}) {
  const stepNum = parseFloat(step);
  const bump = (delta: number) => {
    const cur = parseFloat(value) || 0;
    const next = Math.round((cur + delta) * 10) / 10;
    if (next < 0) return;
    onChange(next.toString());
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => bump(-stepNum)}
          disabled={disabled}
          className="h-12 w-12 rounded-full bg-muted/40 text-foreground text-[20px] font-light active:scale-95 transition-transform disabled:opacity-40"
        >
          −
        </button>
        <div className="flex items-baseline gap-1.5 min-w-[140px] justify-center">
          <Input
            type="number"
            step={step}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled}
            className="w-[110px] h-14 text-center text-[34px] font-bold tabular-nums bg-transparent border-0 focus-visible:ring-0 px-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            placeholder="—"
            inputMode="decimal"
          />
          <span className="text-[15px] text-muted-foreground font-medium">{unit}</span>
        </div>
        <button
          type="button"
          onClick={() => bump(stepNum)}
          disabled={disabled}
          className="h-12 w-12 rounded-full bg-muted/40 text-foreground text-[20px] font-light active:scale-95 transition-transform disabled:opacity-40"
        >
          +
        </button>
      </div>
      {extraControl}
      <button
        type="button"
        onClick={onCommit}
        className="w-full h-12 rounded-xs bg-primary text-primary-foreground text-[15px] font-semibold active:scale-[0.98] transition-transform"
      >
        Save
      </button>
    </div>
  );
}

function ChipPicker({
  value, options, onPick, columns = 1,
}: {
  value: string;
  options: { value: string; label: string }[];
  onPick: (v: string) => void;
  columns?: 1 | 2;
}) {
  return (
    <div className={`grid gap-2 ${columns === 2 ? "grid-cols-2" : "grid-cols-1"}`}>
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => { triggerHapticSelection(); onPick(o.value); }}
            className={`min-h-[48px] px-4 rounded-xs text-[15px] font-medium transition-all active:scale-[0.98] ${
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "bg-muted/30 text-foreground border border-border/40"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function formatDate(iso: string): string {
  // ISO yyyy-mm-dd → "Jun 18, 2026"
  try {
    const [y, m, d] = iso.split("-").map(Number);
    if (!y || !m || !d) return iso;
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });
  } catch {
    return iso;
  }
}
