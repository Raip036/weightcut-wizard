/**
 * Coach onboarding — engaging, wizard-led version.
 *
 * Layout (top → bottom):
 *   1. Wizard companion + per-field speech bubble (coach-to-coach tone)
 *   2. Live gym preview card that builds as the coach types
 *   3. The actual form (slides between identity → profile steps)
 *
 * The gym is created at the end of step 1 so step 2 can reuse the
 * `GymLogoUpload` component (which needs a `gymId`). Step 2 is fully
 * optional — the "Open dashboard" button completes onboarding regardless.
 *
 * Visual rules per design: blue only, no gradients on UI elements. The
 * ambient radial spotlight + sparkles are background atmosphere (not UI
 * gradients) and were explicitly approved.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Check, Building2, ArrowLeftRight } from "lucide-react";
import { useMutation, useQuery } from "convex/react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { triggerHaptic, celebrateSuccess } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { globalLoading } from "@/lib/globalLoading";
import { logger } from "@/lib/logger";
import { GymLogoUpload } from "@/components/coach/GymLogoUpload";
import { WizardCharacter } from "@/tutorial/WizardCharacter";
import type { WizardPose } from "@/tutorial/types";

const inputClass =
  "h-[50px] rounded-xs bg-muted/40 dark:bg-white/[0.06] border-border/40 px-4 text-[16px]";

const DISCIPLINES = [
  "MMA",
  "BJJ",
  "Boxing",
  "Muay Thai",
  "Wrestling",
  "Kickboxing",
  "Judo",
  "Strength",
] as const;

type Step = "identity" | "profile";
type FocusKey =
  | "default_id"
  | "coachName"
  | "gymName"
  | "location"
  | "default_profile"
  | "logo"
  | "disciplines"
  | "count"
  | "about";

// Coach-to-coach voice — direct, brisk, expert tone. Headline is the
// hook; body is the why.
const FIELD_PROMPTS: Record<FocusKey, { headline: string; body: string; pose: WizardPose }> = {
  default_id: {
    headline: "Welcome, coach.",
    body: "Two quick steps. You'll get an invite code at the end.",
    pose: "wave",
  },
  coachName: {
    headline: "Your name.",
    body: "Shows on athlete invites and the dashboard.",
    pose: "point",
  },
  gymName: {
    headline: "Pick the team's name.",
    body: "Something they'll recognize on the roster.",
    pose: "point",
  },
  location: {
    headline: "Where you train.",
    body: "Helps fighters find your gym in search.",
    pose: "idle",
  },
  default_profile: {
    headline: "Make it yours.",
    body: "Optional polish — skip if you're in a hurry.",
    pose: "idle",
  },
  logo: {
    headline: "Add your mark.",
    body: "Lands on every athlete invite and dashboard card.",
    pose: "point",
  },
  disciplines: {
    headline: "What you teach.",
    body: "Tag the styles. Athletes find your gym this way.",
    pose: "point",
  },
  count: {
    headline: "Rough roster size.",
    body: "Helps us tune your alerts and dashboard sections.",
    pose: "idle",
  },
  about: {
    headline: "One line.",
    body: "What makes your gym different. Skip if unsure.",
    pose: "idle",
  },
};

export default function CoachOnboarding() {
  const { userId, userName, profile } = useUser();
  const navigate = useNavigate();
  const { toast } = useToast();
  const prefersReduced = useReducedMotion();

  const [step, setStep] = useState<Step>("identity");
  const [coachName, setCoachName] = useState(userName || profile?.display_name || "");
  const [gymName, setGymName] = useState("");
  const [location, setLocation] = useState("");
  const [disciplines, setDisciplines] = useState<string[]>([]);
  const [fighterCount, setFighterCount] = useState<string>("");
  const [about, setAbout] = useState("");
  const [gymId, setGymId] = useState<Id<"gyms"> | null>(null);
  const [creating, setCreating] = useState(false);
  const [finishing, setFinishing] = useState(false);
  // Track which field the coach is currently looking at so the wizard
  // can chime in with context for that exact input.
  const [focusKey, setFocusKey] = useState<FocusKey>("default_id");
  // One-shot confetti when step 1 → 2 transitions ("gym created" moment).
  const [confettiKey, setConfettiKey] = useState(0);

  const createGym = useMutation(api.gyms.create);
  const updateGym = useMutation(api.gyms.update);
  const setRole = useMutation(api.profiles.setRole);
  const [switchingRole, setSwitchingRole] = useState(false);

  // Reactive subscription to the gym row once created.
  const gymRow = useQuery(api.gyms.getById, gymId ? { gymId } : "skip");
  const logoUrl = gymRow?.logo_url ?? null;

  // Pre-warm CoachDashboard so the post-finish navigation is instant.
  useEffect(() => {
    void import("@/pages/coach/CoachDashboard");
  }, []);

  // Reset the wizard's default greeting per step so the bubble doesn't
  // stall on a stale field-focus prompt across the transition.
  useEffect(() => {
    setFocusKey(step === "identity" ? "default_id" : "default_profile");
  }, [step]);

  const toggleDiscipline = (d: string) => {
    triggerHaptic(ImpactStyle.Light);
    setDisciplines((prev) =>
      prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d],
    );
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!userId || !gymName.trim()) return;
    setCreating(true);
    (document.activeElement as HTMLElement | null)?.blur?.();
    globalLoading.show("Creating your gym…", "Generating an invite code");
    try {
      const gym = await createGym({
        name: gymName.trim(),
        location: location.trim() || undefined,
        coachDisplayName: coachName.trim() || undefined,
      });
      if (!gym) throw new Error("Gym creation returned no result");
      setGymId(gym.id as Id<"gyms">);
      celebrateSuccess();
      setConfettiKey((k) => k + 1);
      toast({
        title: "Gym created",
        description: `Invite code ${gym.invite_code}`,
      });
      setStep("profile");
      globalLoading.hideAfterPaint();
    } catch (err: any) {
      logger.error("CoachOnboarding: create gym failed", err);
      globalLoading.hide();
      toast({
        title: "Could not create gym",
        description: err?.message,
        variant: "destructive",
      });
    } finally {
      setCreating(false);
    }
  };

  const handleFinish = async () => {
    if (!gymId) {
      navigate("/coach", { replace: true });
      return;
    }
    setFinishing(true);
    triggerHaptic(ImpactStyle.Medium);
    const parsedCount = fighterCount.trim() ? Number(fighterCount.trim()) : NaN;
    try {
      await updateGym({
        gymId,
        disciplines: disciplines.length > 0 ? disciplines : null,
        fighterCount: Number.isFinite(parsedCount) && parsedCount >= 0
          ? parsedCount
          : null,
        about: about.trim() ? about.trim() : null,
      });
    } catch (err: any) {
      logger.warn("CoachOnboarding: update gym failed", { err });
      toast({
        title: "Saved partial details",
        description: err?.message,
        variant: "destructive",
      });
    } finally {
      setFinishing(false);
      navigate("/coach", { replace: true });
    }
  };

  const handleSkipProfile = () => {
    triggerHaptic(ImpactStyle.Light);
    navigate("/coach", { replace: true });
  };

  /**
   * Escape hatch: a user whose profile was created with `role: "coach"`
   * (e.g. they previously walked through the coach cutscene/login) but
   * who actually wants to be a fighter lands here. Without this they'd
   * be stuck filling out gym fields. One tap flips their role and routes
   * them to the fighter onboarding.
   */
  const handleSwitchToFighter = async () => {
    if (switchingRole) return;
    setSwitchingRole(true);
    triggerHaptic(ImpactStyle.Medium);
    try {
      await setRole({ role: "fighter" });
      try { localStorage.setItem("wcw_intended_role", "fighter"); } catch {}
      toast({
        title: "Switched to fighter",
        description: "Setting up your athlete profile.",
      });
      navigate("/onboarding", { replace: true });
    } catch (err: any) {
      logger.warn("CoachOnboarding: switch to fighter failed", { err });
      toast({
        title: "Could not switch",
        description: err?.message ?? "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setSwitchingRole(false);
    }
  };

  const prompt = FIELD_PROMPTS[focusKey];

  return (
    <div className="relative min-h-screen bg-background text-foreground flex flex-col overflow-hidden">
      {/* Ambient blue spotlight + drifting sparkles — atmosphere only,
          sits beneath the form. */}
      <AmbientLayer prefersReduced={prefersReduced} />

      <div
        className="relative flex items-center justify-between px-4 shrink-0 z-10"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)",
          paddingBottom: 8,
        }}
      >
        <p className="text-[11px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
          Coach Setup
        </p>
        <StepDots step={step} />
      </div>

      <div className="relative flex-1 flex flex-col items-center px-6 overflow-y-auto z-10">
        <div className="w-full max-w-[420px] pt-3 pb-12">
          {/* Wizard companion + speech bubble — updates per focused field */}
          <WizardCompanion focusKey={focusKey} prompt={prompt} />

          {/* Live gym preview — builds as the coach types */}
          <GymPreviewCard
            coachName={coachName}
            gymName={gymName}
            location={location}
            logoUrl={logoUrl}
            step={step}
          />

          {/* Form region — slides between steps */}
          <div className="relative mt-5 overflow-hidden">
            <AnimatePresence mode="wait" initial={false}>
              {step === "identity" ? (
                <motion.form
                  key="identity"
                  onSubmit={handleCreate}
                  initial={prefersReduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
                  animate={prefersReduced ? { opacity: 1 } : { opacity: 1, x: 0 }}
                  exit={prefersReduced ? { opacity: 0 } : { opacity: 0, x: -24 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  className="space-y-3"
                >
                  <FieldLabel>Your name</FieldLabel>
                  <Input
                    placeholder="Coach Alex"
                    value={coachName}
                    onChange={(e) => setCoachName(e.target.value)}
                    onFocus={() => setFocusKey("coachName")}
                    autoFocus
                    className={inputClass}
                  />
                  <FieldLabel>Gym name</FieldLabel>
                  <Input
                    placeholder="Iron Wolf MMA"
                    value={gymName}
                    onChange={(e) => setGymName(e.target.value)}
                    onFocus={() => setFocusKey("gymName")}
                    required
                    className={inputClass}
                  />
                  <FieldLabel>Location</FieldLabel>
                  <Input
                    placeholder="London, UK"
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    onFocus={() => setFocusKey("location")}
                    className={inputClass}
                  />

                  <button
                    type="submit"
                    disabled={creating || !gymName.trim()}
                    className="mt-4 w-full h-[52px] rounded-xs text-[16px] font-semibold bg-primary text-primary-foreground active:scale-[0.98] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {creating ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" /> Creating…
                      </>
                    ) : (
                      "Continue"
                    )}
                  </button>

                  {/* Wrong door? Quick switch to fighter mode. Bridges
                      the gap when an existing coach-role profile lands a
                      user here even though they meant to be a fighter. */}
                  <button
                    type="button"
                    onClick={handleSwitchToFighter}
                    disabled={creating || switchingRole}
                    className="mt-1 w-full flex items-center justify-center gap-1.5 py-3 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                  >
                    {switchingRole ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ArrowLeftRight className="h-3.5 w-3.5" />
                    )}
                    I'm not a coach — switch to fighter
                  </button>
                </motion.form>
              ) : (
                <motion.div
                  key="profile"
                  initial={prefersReduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
                  animate={prefersReduced ? { opacity: 1 } : { opacity: 1, x: 0 }}
                  exit={prefersReduced ? { opacity: 0 } : { opacity: 0, x: -24 }}
                  transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                  className="space-y-5"
                >
                  {/* Logo */}
                  <div
                    className="rounded-xs border border-border bg-card/60 p-4"
                    onFocus={() => setFocusKey("logo")}
                    onClick={() => setFocusKey("logo")}
                  >
                    <FieldLabel className="mb-3">Gym logo</FieldLabel>
                    <div className="flex items-center gap-3">
                      {gymId && (
                        <GymLogoUpload
                          gymId={gymId}
                          gymName={gymName.trim() || "Gym"}
                          currentLogoUrl={logoUrl}
                          size={64}
                          onUploaded={() => { /* reactive — see gymRow */ }}
                          hideRemove
                        />
                      )}
                      <p className="text-[12px] text-muted-foreground leading-snug flex-1">
                        Shows on the dashboard, athlete invites, and settings.
                      </p>
                    </div>
                  </div>

                  {/* Disciplines */}
                  <div onFocus={() => setFocusKey("disciplines")}>
                    <FieldLabel className="mb-2">What styles do you teach?</FieldLabel>
                    <div className="flex flex-wrap gap-2">
                      {DISCIPLINES.map((d) => {
                        const active = disciplines.includes(d);
                        return (
                          <motion.button
                            key={d}
                            type="button"
                            onClick={() => {
                              setFocusKey("disciplines");
                              toggleDiscipline(d);
                            }}
                            whileTap={prefersReduced ? undefined : { scale: 0.92 }}
                            animate={{
                              scale: active ? 1.04 : 1,
                            }}
                            transition={{ type: "spring", stiffness: 380, damping: 22 }}
                            className={`min-h-[40px] px-3.5 rounded-xs border text-[13px] font-medium active:scale-[0.97] flex items-center gap-1.5 ${
                              active
                                ? "bg-primary text-primary-foreground border-primary"
                                : "bg-muted/30 text-foreground border-border/40"
                            }`}
                          >
                            {active && <Check className="h-3 w-3" />}
                            {d}
                          </motion.button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Fighter count */}
                  <div>
                    <FieldLabel className="mb-2">Roughly how many fighters?</FieldLabel>
                    <Input
                      inputMode="numeric"
                      pattern="[0-9]*"
                      placeholder="e.g. 12"
                      value={fighterCount}
                      onChange={(e) => {
                        const cleaned = e.target.value.replace(/[^0-9]/g, "");
                        setFighterCount(cleaned);
                      }}
                      onFocus={() => setFocusKey("count")}
                      className={inputClass}
                    />
                  </div>

                  {/* About */}
                  <div>
                    <FieldLabel className="mb-2">About your gym (optional)</FieldLabel>
                    <textarea
                      value={about}
                      onChange={(e) => setAbout(e.target.value)}
                      onFocus={() => setFocusKey("about")}
                      placeholder="One line on what makes your gym yours."
                      rows={3}
                      maxLength={200}
                      className="w-full resize-none rounded-xs bg-muted/40 dark:bg-white/[0.06] border border-border/40 p-3 text-[15px] focus:outline-none focus:ring-2 focus:ring-primary/40"
                    />
                  </div>

                  <div className="space-y-2 pt-1">
                    <button
                      type="button"
                      onClick={handleFinish}
                      disabled={finishing}
                      className="w-full h-[52px] rounded-xs text-[16px] font-semibold bg-primary text-primary-foreground active:scale-[0.98] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
                    >
                      {finishing ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" /> Saving…
                        </>
                      ) : (
                        "Open dashboard"
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={handleSkipProfile}
                      disabled={finishing}
                      className="w-full text-center text-[13px] text-muted-foreground py-2"
                    >
                      Skip — I'll do this later
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {/* One-shot confetti when step 1 completes — fires from the
          confettiKey bump in handleCreate. */}
      <ConfettiBurst fireKey={confettiKey} prefersReduced={prefersReduced} />
    </div>
  );
}

// ── Wizard companion ────────────────────────────────────────────────
// Small wizard (~72px) on the left, speech bubble to the right.
// Re-keys on focusKey so the typewriter/bubble cleanly re-runs per field.
function WizardCompanion({
  focusKey,
  prompt,
}: {
  focusKey: FocusKey;
  prompt: { headline: string; body: string; pose: WizardPose };
}) {
  return (
    <div className="flex items-start gap-3">
      {/* Wizard — tap-able for a fun reaction */}
      <div className="relative shrink-0" style={{ width: 72, height: 72 }}>
        <div
          style={{
            width: 140,
            height: 140,
            transform: "scale(0.51)",
            transformOrigin: "top left",
          }}
        >
          <WizardCharacter pose={prompt.pose} />
        </div>
      </div>

      {/* Bubble — slides + fades on key change */}
      <div className="relative flex-1 min-w-0 pt-1">
        <AnimatePresence mode="wait">
          <motion.div
            key={focusKey}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            className="relative rounded-xs border border-primary/20 bg-card/80 px-3.5 py-2.5 backdrop-blur-sm"
          >
            {/* Tail pointing left at wizard */}
            <span
              aria-hidden
              className="absolute -left-1.5 top-3.5 h-3 w-3 rotate-45 rounded-sm border-b border-l border-primary/20 bg-card/80"
            />
            <p className="text-[14px] font-bold text-foreground leading-tight">
              {prompt.headline}
            </p>
            <p className="mt-0.5 text-[12px] text-muted-foreground leading-snug">
              {prompt.body}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

// ── Live gym preview ───────────────────────────────────────────────
// Reads the form state and previews what the coach is building. Updates
// in real-time so the "make weight" abstraction becomes a concrete card.
function GymPreviewCard({
  coachName,
  gymName,
  location,
  logoUrl,
  step,
}: {
  coachName: string;
  gymName: string;
  location: string;
  logoUrl: string | null;
  step: Step;
}) {
  const displayGym = gymName.trim() || "Your gym";
  const displayLoc = location.trim();
  const displayCoach = coachName.trim();
  const filled = !!gymName.trim();

  return (
    <motion.div
      layout
      transition={{ type: "spring", stiffness: 260, damping: 28 }}
      className={`mt-4 rounded-xs border bg-card/60 p-3 transition-colors ${
        filled ? "border-primary/30" : "border-border/40"
      }`}
    >
      <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 mb-2">
        Preview
      </p>
      <div className="flex items-center gap-3">
        {/* Logo / placeholder */}
        <div className="relative h-14 w-14 shrink-0 rounded-xs bg-muted/40 ring-1 ring-primary/15 flex items-center justify-center overflow-hidden">
          {logoUrl ? (
            <img src={logoUrl} alt="Gym logo" className="h-full w-full object-cover" />
          ) : (
            <Building2 className="h-6 w-6 text-primary/60" strokeWidth={2} />
          )}
        </div>

        {/* Name + meta */}
        <div className="min-w-0 flex-1">
          <p
            className={`text-[15px] font-bold leading-tight truncate transition-colors ${
              filled ? "text-foreground" : "text-muted-foreground/60"
            }`}
          >
            {displayGym}
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground truncate">
            {displayLoc || "Add a location"}
            {displayCoach ? ` · ${displayCoach}` : ""}
          </p>
        </div>

        {/* Step-2 ready badge */}
        {step === "profile" && (
          <motion.span
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 18 }}
            className="shrink-0 inline-flex items-center gap-1 rounded-full bg-primary/15 text-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ring-primary/30"
          >
            <Check className="h-3 w-3" />
            Live
          </motion.span>
        )}
      </div>
    </motion.div>
  );
}

// ── Ambient layer — radial spotlight + drifting sparkles ───────────
function AmbientLayer({ prefersReduced }: { prefersReduced: boolean | null }) {
  // Memoize sparkle positions so they don't re-randomize on rerender.
  const sparkles = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        id: i,
        left: 5 + Math.random() * 90,
        top: 5 + Math.random() * 60,
        delay: Math.random() * 4,
        duration: 3 + Math.random() * 2.5,
        size: 2 + Math.random() * 2,
      })),
    [],
  );

  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[55vh] opacity-70"
        style={{
          background:
            "radial-gradient(ellipse at 50% 0%, rgba(56, 132, 255, 0.16) 0%, rgba(56, 132, 255, 0.05) 40%, transparent 75%)",
        }}
      />
      {!prefersReduced && (
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {sparkles.map((s) => (
            <motion.span
              key={s.id}
              className="absolute rounded-full bg-primary/60"
              style={{
                left: `${s.left}%`,
                top: `${s.top}%`,
                width: s.size,
                height: s.size,
              }}
              animate={{
                opacity: [0, 0.7, 0],
                y: [0, -14, -22],
              }}
              transition={{
                duration: s.duration,
                repeat: Infinity,
                delay: s.delay,
                ease: "easeOut",
              }}
            />
          ))}
        </div>
      )}
    </>
  );
}

// ── Confetti burst — one-shot, fires when fireKey bumps ────────────
function ConfettiBurst({
  fireKey,
  prefersReduced,
}: {
  fireKey: number;
  prefersReduced: boolean | null;
}) {
  const pieces = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        id: i,
        dx: (Math.random() - 0.5) * 360,
        dy: 320 + Math.random() * 240,
        rot: (Math.random() - 0.5) * 720,
        delay: Math.random() * 0.15,
        size: 5 + Math.random() * 4,
      })),
    // Re-memoize per fire so each burst has fresh trajectories.
    [fireKey], // eslint-disable-line react-hooks/exhaustive-deps
  );

  if (prefersReduced) return null;
  if (fireKey === 0) return null;

  return (
    <div
      key={fireKey}
      className="pointer-events-none fixed inset-0 z-[60] overflow-hidden"
      aria-hidden
    >
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          className="absolute left-1/2 top-[30%] rounded-sm bg-primary"
          style={{ width: p.size, height: p.size * 1.4 }}
          initial={{ x: 0, y: 0, opacity: 0, rotate: 0 }}
          animate={{ x: p.dx, y: p.dy, opacity: [0, 1, 1, 0], rotate: p.rot }}
          transition={{ duration: 1.6, delay: p.delay, ease: [0.22, 1, 0.36, 1] }}
        />
      ))}
    </div>
  );
}

function FieldLabel({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p
      className={`text-[11px] uppercase tracking-wider text-muted-foreground/70 font-semibold ${className}`}
    >
      {children}
    </p>
  );
}

function StepDots({ step }: { step: Step }) {
  const dots: Step[] = useMemo(() => ["identity", "profile"], []);
  return (
    <div className="flex items-center gap-1.5">
      {dots.map((d) => (
        <span
          key={d}
          className={`h-1.5 rounded-full transition-all ${
            d === step ? "w-6 bg-primary" : "w-1.5 bg-muted-foreground/30"
          }`}
        />
      ))}
    </div>
  );
}
