import { useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { Utensils, Weight, Dumbbell, Loader2, ChevronLeft, Activity, Zap, Camera as CameraIcon, X } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { triggerHaptic, celebrateSuccess, triggerHapticSelection } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { useConvex, useMutation, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/hooks/use-toast";
import { logger } from "@/lib/logger";
import { uploadSessionMediaV2 } from "@/lib/uploadSessionMediaV2";
import { MARTIAL_ARTS, SANDC, REST, tagsForPrimary } from "@/lib/sessionTypes";
import { getCustomTypes } from "@/lib/customSessionTypes";

interface QuickLogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLogFood: () => void;
  onLogWeight: () => void;
  onLogTraining: () => void;
  onLogGym: () => void;
}

type Mode = "menu" | "weight" | "training";

// PRIMARY disciplines under the two-level session model: martial arts +
// S&C + Rest. User custom martial-art primaries are merged in at render.
const SESSION_TYPES: readonly string[] = [...MARTIAL_ARTS, SANDC, REST];
const DURATION_PRESETS = [30, 60, 90] as const;

// Maps a "feel" label → intensityLevel (1-5) and a sensible RPE (1-10).
// Used for the quick-log intensity strip; for the full editor users can
// fine-tune both numbers independently.
const INTENSITY_PRESETS = [
  { label: "Easy", level: 1, intensity: "low", rpe: 3 },
  { label: "Steady", level: 2, intensity: "low", rpe: 5 },
  { label: "Hard", level: 3, intensity: "moderate", rpe: 7 },
  { label: "Battle", level: 4, intensity: "high", rpe: 8 },
  { label: "Max", level: 5, intensity: "high", rpe: 10 },
] as const;

// Color ramp for the intensity dial — Easy (health green) → Max (red).
// Index-aligned with INTENSITY_PRESETS so the dial fill + center label can
// be tinted purely from `selectedIntensityIdx`.
const INTENSITY_COLORS = [
  "hsl(152 69% 46%)", // Easy — health green
  "hsl(199 89% 52%)", // Steady — cyan
  "hsl(24 95% 56%)", // Hard — energy orange
  "hsl(14 90% 55%)", // Battle — orange-red
  "hsl(0 72% 55%)", // Max — red
] as const;

const RECENT_SESSION_KEY = "wcw_quicklog_recent_session";

export function QuickLogDialog({ open, onOpenChange, onLogFood, onLogWeight, onLogTraining, onLogGym }: QuickLogDialogProps) {
  const { userId, refreshProfile } = useUser();
  const { toast } = useToast();
  const convex = useConvex();
  const logWeightMut = useMutation(api.weight_logs.logWeight);
  const updateCurrentWeightMut = useMutation(api.profiles.updateCurrentWeight);
  const createTrainingMut = useMutation(api.fight_camp.createCalendarEntry);
  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const shouldReduceMotion = useReducedMotion();

  // Smart defaults supply a sensible default activity tag for the quick
  // log. Cheap reactive query; gated on a real signed-in user.
  const smartDefaults = useQuery(
    api.fight_camp.getSmartDefaults,
    userId && userId !== "pending" ? {} : "skip",
  );

  const [mode, setMode] = useState<Mode>("menu");
  // Weight panel state
  const [quickWeight, setQuickWeight] = useState("");
  const [savingWeight, setSavingWeight] = useState(false);
  const [unit, setUnit] = useState<"kg" | "lb">(
    () => (localStorage.getItem("wcw_weight_unit") as "kg" | "lb") || "kg"
  );

  // Training panel state — defaults follow the brief: 60min + Steady intensity
  // give a sensible Fight-Form signal with zero extra taps required.
  const [selectedSessionType, setSelectedSessionType] = useState<string>(() => {
    try { return localStorage.getItem(RECENT_SESSION_KEY) || SESSION_TYPES[0]; } catch { return SESSION_TYPES[0]; }
  });
  const [selectedDuration, setSelectedDuration] = useState<number>(60);
  // Optional activity tag (Sparring, Drilling, Strength, …). null ⇒ none.
  const [selectedSessionTag, setSelectedSessionTag] = useState<string | null>(null);
  const [selectedIntensityIdx, setSelectedIntensityIdx] = useState<number>(1); // Steady
  const [savingTraining, setSavingTraining] = useState(false);
  // Optional selfie attached to the quick-logged training session. The file
  // is held in state until the session is created so we can link it via
  // `uploadSessionMediaV2` once we have the new session id.
  const [trainingPhoto, setTrainingPhoto] = useState<{ file: File; previewUrl: string } | null>(null);

  // Reset to menu whenever the sheet opens fresh.
  useEffect(() => {
    if (open) {
      setMode("menu");
      setQuickWeight("");
      setTrainingPhoto((prev) => {
        if (prev?.previewUrl) URL.revokeObjectURL(prev.previewUrl);
        return null;
      });
    }
  }, [open]);

  // Release the preview URL when the dialog is unmounted or the photo
  // changes — otherwise we leak the object URL on iOS WKWebView.
  useEffect(() => {
    return () => {
      if (trainingPhoto?.previewUrl) URL.revokeObjectURL(trainingPhoto.previewUrl);
    };
  }, [trainingPhoto?.previewUrl]);

  const handleTakeTrainingPhoto = async () => {
    triggerHapticSelection();
    if (Capacitor.isNativePlatform()) {
      try {
        const { Camera, CameraResultType, CameraSource } = await import("@capacitor/camera");
        const perms = await Camera.checkPermissions();
        if (perms.camera !== "granted") {
          const requested = await Camera.requestPermissions({ permissions: ["camera"] });
          if (requested.camera === "denied") {
            toast({ title: "Camera access denied", description: "Enable it in Settings to attach photos.", variant: "destructive" });
            return;
          }
        }
        // Use the native camera UI without forcing a direction so the
        // user can choose front or rear. Front-camera shots from iOS's
        // native UI are saved un-mirrored by default — previously we
        // pinned `direction: Front` which on some builds returned the
        // image with the preview's mirror baked in, making selfies
        // appear inverted in the log.
        const photo = await Camera.getPhoto({
          quality: 80,
          allowEditing: false,
          resultType: CameraResultType.Uri,
          source: CameraSource.Camera,
          width: 1600,
          height: 1600,
          promptLabelHeader: "Training photo",
          promptLabelPhoto: "Take Photo",
        });
        if (photo.webPath) {
          const res = await fetch(photo.webPath);
          const blob = await res.blob();
          const file = new File([blob], `quicklog-${Date.now()}.jpg`, { type: blob.type || "image/jpeg" });
          if (trainingPhoto?.previewUrl) URL.revokeObjectURL(trainingPhoto.previewUrl);
          setTrainingPhoto({ file, previewUrl: photo.webPath });
        }
      } catch (err) {
        // Camera "User cancelled photos app" surfaces as a thrown error on iOS
        if (err instanceof Error && /cancel/i.test(err.message)) return;
        logger.warn("QuickLog camera failed", { error: err });
      }
    } else {
      // Web fallback: hidden file input with `capture=environment` so
      // mobile Safari opens the universal camera (rear-default, with
      // the same "switch camera" affordance the native picker offers).
      // Desktop browsers ignore `capture` and fall back to the standard
      // file picker.
      photoInputRef.current?.click();
    }
  };

  const handlePhotoInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-pick of the same file
    if (!file) return;
    if (trainingPhoto?.previewUrl) URL.revokeObjectURL(trainingPhoto.previewUrl);
    setTrainingPhoto({ file, previewUrl: URL.createObjectURL(file) });
  };

  const clearTrainingPhoto = () => {
    triggerHapticSelection();
    if (trainingPhoto?.previewUrl) URL.revokeObjectURL(trainingPhoto.previewUrl);
    setTrainingPhoto(null);
  };

  // PRIMARY chip list — built-in disciplines plus the user's custom
  // martial-art primaries, with the most-recently-logged primary hoisted
  // to the front so it's the natural one-tap default after first use.
  const orderedSessionTypes = useMemo(() => {
    const customs = userId ? getCustomTypes(userId) : [];
    const base = [...SESSION_TYPES, ...customs.filter((c) => !SESSION_TYPES.includes(c))];
    let recent = base[0];
    try { recent = localStorage.getItem(RECENT_SESSION_KEY) || base[0]; } catch { /* swallow */ }
    if (!base.includes(recent)) return base;
    return [recent, ...base.filter((t) => t !== recent)];
  }, [open, userId]); // re-read on each open

  // Optional activity tags offered for the currently-selected primary.
  const tagOptions = useMemo(
    () => tagsForPrimary(selectedSessionType),
    [selectedSessionType],
  );

  // Seed the default tag from smart defaults when the sheet opens, but
  // only if it's valid for the selected primary.
  useEffect(() => {
    if (!open) return;
    const fallback = smartDefaults?.sessionTag ?? null;
    setSelectedSessionTag(
      fallback && tagsForPrimary(selectedSessionType).some((t) => t.id === fallback)
        ? fallback
        : null,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, smartDefaults?.sessionTag]);

  // Drop a tag that no longer applies when the user switches primary.
  useEffect(() => {
    if (selectedSessionTag && !tagOptions.some((t) => t.id === selectedSessionTag)) {
      setSelectedSessionTag(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSessionType]);

  const handleQuickWeight = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId) return;
    const raw = parseFloat(quickWeight);
    if (isNaN(raw) || raw <= 0) {
      toast({ title: "Enter a valid weight", variant: "destructive" });
      return;
    }
    const weight_kg = unit === "lb" ? raw / 2.20462 : raw;
    const _now = new Date();
    const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}-${String(_now.getDate()).padStart(2, "0")}`;
    setSavingWeight(true);
    try {
      await logWeightMut({ date: today, weightKg: weight_kg });
      await updateCurrentWeightMut({ weightKg: weight_kg });
      celebrateSuccess();
      refreshProfile?.();
      toast({ title: "Weight logged", description: `${raw.toFixed(1)} ${unit}` });
      setQuickWeight("");
      onOpenChange(false);
    } catch (err) {
      logger.error("QuickLog weight save failed", err);
      toast({ title: "Failed to log weight", variant: "destructive" });
    } finally {
      setSavingWeight(false);
    }
  };

  const handleQuickTraining = async () => {
    if (!userId) return;
    const _now = new Date();
    const today = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}-${String(_now.getDate()).padStart(2, "0")}`;
    const intensityPreset = INTENSITY_PRESETS[selectedIntensityIdx];
    setSavingTraining(true);
    try {
      const sessionId = (await createTrainingMut({
        date: today,
        sessionType: selectedSessionType,
        sessionTag: selectedSessionTag ?? undefined,
        intensity: intensityPreset.intensity,
        intensityLevel: intensityPreset.level,
        durationMinutes: selectedDuration,
        rpe: intensityPreset.rpe,
      })) as Id<"fight_camp_calendar">;

      // Attach the optional selfie after the session row exists. We fire-
      // and-toast on upload failure rather than blocking the session-logged
      // success path — the row is already saved.
      if (trainingPhoto && sessionId) {
        try {
          await uploadSessionMediaV2(sessionId, trainingPhoto.file, undefined, convex);
        } catch (uploadErr) {
          logger.warn("QuickLog photo upload failed", { error: uploadErr });
          toast({
            title: "Session saved",
            description: "Couldn't attach the photo. Try adding it from the training calendar.",
            variant: "destructive",
          });
        }
      }

      try { localStorage.setItem(RECENT_SESSION_KEY, selectedSessionType); } catch { /* swallow */ }
      celebrateSuccess();
      toast({
        title: "Session logged",
        description: `${selectedSessionType} · ${selectedDuration}min · ${intensityPreset.label}`,
      });
      onOpenChange(false);
    } catch (err) {
      logger.error("QuickLog training save failed", err);
      toast({ title: "Failed to log session", variant: "destructive" });
    } finally {
      setSavingTraining(false);
    }
  };

  const sheetTitle = mode === "weight" ? "Log weight" : mode === "training" ? "Log session" : "Quick Log";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl p-0 max-h-[100dvh] flex flex-col [&>button]:hidden"
      >
        {/* Sticky header — drag handle + title stay visible even when the
            body scrolls, so the back button is always reachable. */}
        <div className="shrink-0 px-6 pt-6">
          <div className="flex justify-center pt-1 pb-3">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/25" aria-hidden />
          </div>
          <SheetHeader className="px-1 pb-3 flex-row items-center gap-2 space-y-0">
            {mode !== "menu" && (
              <button
                type="button"
                onClick={() => { setMode("menu"); triggerHapticSelection(); }}
                aria-label="Back"
                className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground/80 active:text-foreground active:bg-muted/40 transition-colors -ml-1"
              >
                <ChevronLeft className="h-5 w-5" strokeWidth={2.4} />
              </button>
            )}
            <SheetTitle className="text-[16px] font-semibold tracking-tight">{sheetTitle}</SheetTitle>
          </SheetHeader>
        </div>

        {/* Scrollable body — keeps tall panels (training) within the viewport
            and ensures the bottom-nav clearance is respected. */}
        <div className="flex-1 min-h-0 overflow-y-auto px-6 pb-[calc(env(safe-area-inset-bottom,0px)+5rem)]">

        {/* ── Menu ───────────────────────────────────────────────── */}
        {mode === "menu" && (
          <div className="grid grid-cols-4 gap-3 px-1">
            <button
              onClick={() => { triggerHaptic(ImpactStyle.Light); onLogFood(); }}
              className="flex flex-col items-center gap-2 py-4 rounded-xs bg-muted/50 active:scale-95 transition-transform duration-100"
            >
              <Utensils className="h-[1.6rem] w-[1.6rem] text-health" />
              <span className="text-sm font-medium">Food</span>
            </button>
            <button
              onClick={() => { triggerHaptic(ImpactStyle.Light); setMode("weight"); }}
              className="flex flex-col items-center gap-2 py-4 rounded-xs bg-muted/50 active:scale-95 transition-transform duration-100"
            >
              <Weight className="h-[1.6rem] w-[1.6rem] text-hydration" />
              <span className="text-sm font-medium">Weight</span>
            </button>
            <button
              onClick={() => { triggerHaptic(ImpactStyle.Light); setMode("training"); }}
              className="flex flex-col items-center gap-2 py-4 rounded-xs bg-muted/50 active:scale-95 transition-transform duration-100"
            >
              <Activity className="h-[1.6rem] w-[1.6rem] text-energy" />
              <span className="text-sm font-medium">Training</span>
            </button>
            <button
              onClick={() => { triggerHaptic(ImpactStyle.Light); onLogGym(); }}
              className="flex flex-col items-center gap-2 py-4 rounded-xs bg-muted/50 active:scale-95 transition-transform duration-100"
            >
              <Dumbbell className="h-[1.6rem] w-[1.6rem] text-primary" />
              <span className="text-sm font-medium">Gym</span>
            </button>
          </div>
        )}

        {/* ── Weight panel ───────────────────────────────────────── */}
        {mode === "weight" && (
          <form onSubmit={handleQuickWeight} className="px-1 pb-2 space-y-3">
            <p className="text-[12px] text-muted-foreground/80 px-1">
              Saves to today and updates your current weight.
            </p>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                step="0.1"
                placeholder="Today's weight"
                value={quickWeight}
                onChange={(e) => setQuickWeight(e.target.value)}
                autoFocus
                className="flex-1 h-12 rounded-xs text-[16px] font-semibold tabular-nums text-center bg-muted/40 dark:bg-white/[0.06] border-border/30"
              />
              <div className="flex gap-0.5 bg-muted/40 dark:bg-white/[0.06] border border-border/30 rounded-full p-0.5 h-12 items-center">
                <button
                  type="button"
                  onClick={() => { setUnit("kg"); triggerHaptic(ImpactStyle.Light); }}
                  className={`px-3 h-10 rounded-full text-[13px] font-semibold transition-colors ${unit === "kg" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                >kg</button>
                <button
                  type="button"
                  onClick={() => { setUnit("lb"); triggerHaptic(ImpactStyle.Light); }}
                  className={`px-3 h-10 rounded-full text-[13px] font-semibold transition-colors ${unit === "lb" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
                >lb</button>
              </div>
            </div>
            <button
              type="submit"
              disabled={savingWeight || !quickWeight}
              className="w-full h-12 rounded-xs bg-primary text-primary-foreground text-[15px] font-semibold active:scale-[0.98] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {savingWeight && <Loader2 className="h-4 w-4 animate-spin" />}
              {savingWeight ? "Saving…" : "Log weight"}
            </button>
            <button
              type="button"
              onClick={() => { onOpenChange(false); onLogWeight(); }}
              className="w-full text-center text-[12px] text-muted-foreground/70 py-1 active:text-foreground transition-colors"
            >
              Need more detail? Open weight tracker
            </button>
          </form>
        )}

        {/* ── Training panel ─────────────────────────────────────── */}
        {mode === "training" && (
          <div className="px-1 pb-2 space-y-3">
            <p className="text-[12px] text-muted-foreground/80 px-1">
              Pick what you did. Duration and intensity have smart defaults you can tweak.
            </p>

            {/* Session-type chip grid */}
            <div className="grid grid-cols-2 gap-2">
              {orderedSessionTypes.map((t) => {
                const active = selectedSessionType === t;
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => { setSelectedSessionType(t); triggerHapticSelection(); }}
                    aria-pressed={active}
                    className={`h-12 rounded-xs text-[14px] font-semibold active:scale-[0.97] transition-all ${
                      active
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted/40 dark:bg-white/[0.06] border border-border/30 text-foreground/85"
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>

            {/* Optional activity tag — secondary, smaller chips below the
                primary grid. "None" leaves the session tag-less. Hidden
                when the selected primary offers no tags. */}
            {tagOptions.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/60 mb-1.5 px-1">
                  Activity <span className="text-muted-foreground/40 normal-case tracking-normal">· optional</span>
                </p>
                <div className="flex flex-wrap gap-1.5">
                  <button
                    type="button"
                    onClick={() => { setSelectedSessionTag(null); triggerHapticSelection(); }}
                    aria-pressed={!selectedSessionTag}
                    className={`h-8 px-3 rounded-full text-[12px] font-semibold active:scale-[0.96] transition-all ${
                      !selectedSessionTag
                        ? "bg-primary/15 text-primary border border-primary/40"
                        : "bg-muted/30 dark:bg-white/[0.04] border border-border/30 text-muted-foreground"
                    }`}
                  >
                    None
                  </button>
                  {tagOptions.map((t) => {
                    const active = selectedSessionTag === t.id;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => { setSelectedSessionTag(t.id); triggerHapticSelection(); }}
                        aria-pressed={active}
                        className={`h-8 px-3 rounded-full text-[12px] font-semibold active:scale-[0.96] transition-all ${
                          active
                            ? "bg-primary/15 text-primary border border-primary/40"
                            : "bg-muted/30 dark:bg-white/[0.04] border border-border/30 text-muted-foreground"
                        }`}
                      >
                        {t.id}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Duration row */}
            <div>
              <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/60 mb-1.5 px-1">
                Duration
              </p>
              <div className="flex gap-2">
                {DURATION_PRESETS.map((d) => {
                  const active = selectedDuration === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => { setSelectedDuration(d); triggerHapticSelection(); }}
                      aria-pressed={active}
                      className={`flex-1 h-11 rounded-xs text-[14px] font-semibold tabular-nums active:scale-[0.97] transition-all ${
                        active
                          ? "bg-foreground text-background"
                          : "bg-muted/40 dark:bg-white/[0.06] border border-border/30 text-foreground/80"
                      }`}
                    >
                      {d}<span className="text-[11px] font-medium opacity-70 ml-0.5">min</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Intensity dial (HERO) — a tap-only animated SVG ring. The fill
                arc sweeps from Easy up to and including the selected level,
                animating via a motion.circle strokeDashoffset spring. The 5
                tick buttons below are the tap targets so the dial never
                fights the sheet's scroll. */}
            {(() => {
              // Dial geometry — kept in the render so it's co-located with the
              // SVG that consumes it. r/circumference are pure constants.
              const DIAL = 160;
              const STROKE = 12;
              const R = (DIAL - STROKE) / 2;
              const C = 2 * Math.PI * R;
              const fraction = (selectedIntensityIdx + 1) / INTENSITY_PRESETS.length;
              const fillOffset = C * (1 - fraction);
              const active = INTENSITY_PRESETS[selectedIntensityIdx];
              const color = INTENSITY_COLORS[selectedIntensityIdx];

              return (
                <div>
                  <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/60 mb-1.5 px-1">
                    Intensity
                  </p>

                  {/* Dial readout */}
                  <div className="flex justify-center pt-1 pb-2">
                    <div className="relative" style={{ width: DIAL, height: DIAL }}>
                      <svg
                        width={DIAL}
                        height={DIAL}
                        viewBox={`0 0 ${DIAL} ${DIAL}`}
                        className="-rotate-90"
                        aria-hidden
                      >
                        {/* Track */}
                        <circle
                          cx={DIAL / 2}
                          cy={DIAL / 2}
                          r={R}
                          fill="none"
                          strokeWidth={STROKE}
                          stroke="hsl(0 0% 100% / 0.07)"
                          strokeLinecap="round"
                        />
                        {/* Animated fill arc */}
                        <motion.circle
                          cx={DIAL / 2}
                          cy={DIAL / 2}
                          r={R}
                          fill="none"
                          strokeWidth={STROKE}
                          strokeLinecap="round"
                          strokeDasharray={C}
                          initial={false}
                          animate={{ strokeDashoffset: fillOffset, stroke: color }}
                          transition={
                            shouldReduceMotion
                              ? { duration: 0 }
                              : { type: "spring", stiffness: 260, damping: 30 }
                          }
                        />
                      </svg>
                      {/* Center label */}
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <motion.span
                          key={active.label}
                          initial={shouldReduceMotion ? false : { opacity: 0, y: 4 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
                          className="text-[26px] font-bold tracking-tight leading-none"
                          style={{ color }}
                        >
                          {active.label}
                        </motion.span>
                        <span className="mt-1 text-[11px] font-semibold tabular-nums text-muted-foreground/70">
                          RPE {active.rpe}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Tick buttons — the tap targets that set the level */}
                  <div className="flex gap-1">
                    {INTENSITY_PRESETS.map((p, i) => {
                      const isActive = selectedIntensityIdx === i;
                      return (
                        <button
                          key={p.label}
                          type="button"
                          onClick={() => { setSelectedIntensityIdx(i); triggerHapticSelection(); }}
                          aria-pressed={isActive}
                          aria-label={`Intensity ${p.label}`}
                          className="flex-1 h-9 rounded-xs text-[11.5px] font-semibold active:scale-[0.97] transition-all border"
                          style={
                            isActive
                              ? { backgroundColor: INTENSITY_COLORS[i], borderColor: INTENSITY_COLORS[i], color: "hsl(0 0% 100%)" }
                              : { backgroundColor: "hsl(0 0% 100% / 0.05)", borderColor: "hsl(220 10% 18% / 0.5)", color: "hsl(220 15% 65%)" }
                          }
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })()}

            {/* Optional selfie — slimmed to an "Attach photo" chip so the
                dial stays the hero. Once a photo exists it swaps to a small
                thumbnail with a remove X. Camera/file-input flow unchanged. */}
            <div>
              {trainingPhoto ? (
                <div className="flex items-center gap-2.5">
                  <div className="relative inline-block">
                    <img
                      src={trainingPhoto.previewUrl}
                      alt="Training photo"
                      className="h-12 w-12 rounded-xs object-cover border border-border/40"
                    />
                    <button
                      type="button"
                      onClick={clearTrainingPhoto}
                      aria-label="Remove photo"
                      className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-black/70 text-white flex items-center justify-center active:scale-90 transition-transform"
                    >
                      <X className="h-3 w-3" strokeWidth={2.5} />
                    </button>
                  </div>
                  <span className="text-[12px] font-medium text-muted-foreground/70">Photo attached</span>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handleTakeTrainingPhoto}
                  className="w-full h-10 px-3 rounded-xs border border-dashed border-border/60 bg-muted/30 dark:bg-white/[0.04] flex items-center justify-center gap-2 text-muted-foreground/85 active:scale-[0.98] transition-transform"
                >
                  <CameraIcon className="h-4 w-4" strokeWidth={1.9} />
                  <span className="text-[12px] font-semibold">Attach photo</span>
                  <span className="text-[11px] font-medium text-muted-foreground/50">· optional</span>
                </button>
              )}
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handlePhotoInputChange}
              />
            </div>

            <button
              type="button"
              onClick={handleQuickTraining}
              disabled={savingTraining}
              className="w-full h-12 rounded-xs bg-primary text-primary-foreground text-[15px] font-semibold active:scale-[0.98] transition-transform disabled:opacity-40 flex items-center justify-center gap-2 mt-1"
            >
              {savingTraining ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Zap className="h-4 w-4" strokeWidth={2.6} fill="currentColor" />
                  Log {selectedSessionType.toLowerCase()}
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => { onOpenChange(false); onLogTraining(); }}
              className="w-full text-center text-[12px] text-muted-foreground/70 py-1 active:text-foreground transition-colors"
            >
              Need more detail? Open training calendar
            </button>
          </div>
        )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
