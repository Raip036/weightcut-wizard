import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Slider } from "@/components/ui/slider";
import { ArrowLeft, Trophy, Camera, CheckCircle2, Share2, ChevronRight, Check, Droplet, Wheat } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { triggerHapticSelection, triggerHaptic } from "@/lib/haptics";
import { normalizeWeighInTiming, weighInTimingLabel } from "@/lib/weighInTiming";
import { ImpactStyle } from "@capacitor/haptics";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { logger } from "@/lib/logger";
import { useSafeAsync } from "@/hooks/useSafeAsync";
import { ShareCardDialog } from "@/components/share/ShareCardDialog";
import { FightCampSummaryCard } from "@/components/share/cards/FightCampSummaryCard";
import { CampTrophyCase } from "@/components/fightcamp/CampTrophyCase";

interface FightCamp {
  id: string;
  name: string;
  event_name: string | null;
  fight_date: string;
  profile_pic_url: string | null;
  starting_weight_kg: number | null;
  end_weight_kg: number | null;
  total_weight_cut: number | null;
  weight_via_dehydration: number | null;
  weight_via_carb_reduction: number | null;
  weigh_in_timing: string | null;
  rehydration_notes: string | null;
  performance_feeling: string | null;
  is_completed: boolean;
}

type FieldKey =
  | "starting_weight_kg" | "end_weight_kg"
  | "breakdown" | "weigh_in_timing"
  | "performance_feeling" | "rehydration_notes";

type ActiveField = { key: FieldKey; title: string } | null;

export default function FightCampDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { safeAsync, isMounted } = useSafeAsync();
  const campRow = useQuery(
    api.fight_camp.getCamp,
    id ? { id: id as Id<"fight_camps"> } : "skip",
  );
  const updateCamp = useMutation(api.fight_camp.updateCamp);
  const generateMediaUploadUrl = useMutation(api.fight_camp.generateMediaUploadUrl);

  // ── Share-card stats (camp-scoped) ──────────────────────────────────
  // Surfaced on the social share card: top discipline level, mastered count,
  // and session/hours totals over the camp window. All defensive — the card
  // shows an em dash for anything missing.
  const disciplineXp = useQuery(
    api.user_discipline_xp.getAllForUser,
    id ? { campId: id as Id<"fight_camps"> } : "skip",
  );
  const masteredTechs = useQuery(
    api.mastery_spine.getMasteredTechniques,
    id ? { campId: id as Id<"fight_camps"> } : "skip",
  );
  const campStartIso = campRow
    ? new Date((campRow as { _creationTime: number })._creationTime).toISOString().slice(0, 10)
    : null;
  const campFightIso = campRow ? ((campRow as { fightDate: string }).fightDate ?? null) : null;
  const campCalendar = useQuery(
    api.fight_camp.listCalendar,
    campStartIso && campFightIso ? { from: campStartIso, to: campFightIso } : "skip",
  );
  const shareStats = useMemo(() => {
    const topRow = disciplineXp && disciplineXp.length > 0 ? disciplineXp[0] : null;
    const sessionRows = (campCalendar ?? []).filter(
      (r: { sessionType?: string }) => r.sessionType !== "Rest",
    );
    const minutes = sessionRows.reduce(
      (sum: number, r: { durationMinutes?: number }) => sum + (r.durationMinutes ?? 0),
      0,
    );
    return {
      topDiscipline: topRow ? { sport: topRow.sport, level: topRow.level } : null,
      masteredCount: masteredTechs?.length ?? 0,
      sessions: sessionRows.length,
      hours: Math.round(minutes / 60),
    };
  }, [disciplineXp, masteredTechs, campCalendar]);
  const campWeeks = useMemo(() => {
    if (!campStartIso || !campFightIso) return undefined;
    const days = Math.round((Date.parse(campFightIso) - Date.parse(campStartIso)) / 86_400_000);
    return days > 0 ? Math.max(1, Math.round(days / 7)) : undefined;
  }, [campStartIso, campFightIso]);

  const [camp, setCamp] = useState<FightCamp | null>(null);
  const [uploading, setUploading] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [activeField, setActiveField] = useState<ActiveField>(null);

  // Saved ✓ flash, mirrors the Goals page.
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flagSaved = () => {
    setSavedAt(Date.now());
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSavedAt(null), 1800);
  };
  useEffect(() => () => { if (savedTimer.current) clearTimeout(savedTimer.current); }, []);

  // Project Convex row → legacy FightCamp shape.
  useEffect(() => {
    if (!campRow) return;
    const c: any = campRow;
    safeAsync(setCamp)({
      id: c._id,
      name: c.name,
      event_name: c.eventName ?? null,
      fight_date: c.fightDate,
      profile_pic_url: c.profilePicUrl ?? null,
      starting_weight_kg: c.startingWeightKg ?? null,
      end_weight_kg: c.endWeightKg ?? null,
      total_weight_cut: c.totalWeightCut ?? null,
      weight_via_dehydration: c.weightViaDehydration ?? null,
      weight_via_carb_reduction: c.weightViaCarbReduction ?? null,
      weigh_in_timing: c.weighInTiming ?? null,
      rehydration_notes: c.rehydrationNotes ?? null,
      performance_feeling: c.performanceFeeling ?? null,
      is_completed: c.isCompleted ?? false,
    });
  }, [campRow, safeAsync]);

  const loading = campRow === undefined && !camp;

  // ── Auto-save ────────────────────────────────────────────────────────
  // Each field commit merges overrides into local state + persists via the
  // Convex updateCamp mutation. Total weight cut is auto-derived from
  // Start − End on commit so downstream consumers stay coherent.
  const autoSave = useCallback(async (overrides: Partial<FightCamp>) => {
    if (!camp || !id) return;
    const next: FightCamp = { ...camp, ...overrides };

    const start = next.starting_weight_kg;
    const end = next.end_weight_kg;
    const computedTotal =
      start != null && end != null && start > end
        ? Math.round((start - end) * 10) / 10
        : null;
    if (computedTotal !== next.total_weight_cut) {
      next.total_weight_cut = computedTotal;
    }

    setCamp(next);
    try {
      await updateCamp({
        id: id as Id<"fight_camps">,
        startingWeightKg: next.starting_weight_kg ?? undefined,
        endWeightKg: next.end_weight_kg ?? undefined,
        totalWeightCut: next.total_weight_cut ?? undefined,
        weightViaDehydration: next.weight_via_dehydration ?? undefined,
        weightViaCarbReduction: next.weight_via_carb_reduction ?? undefined,
        weighInTiming: next.weigh_in_timing ?? undefined,
        rehydrationNotes: next.rehydration_notes ?? undefined,
        performanceFeeling: next.performance_feeling ?? undefined,
        isCompleted: next.is_completed,
      });
      flagSaved();
      triggerHaptic(ImpactStyle.Light);
    } catch (err) {
      logger.warn("FightCampDetail: autoSave failed", { err });
      toast({ title: "Save failed", description: "Couldn't save your changes.", variant: "destructive" });
    }
  }, [camp, id, updateCamp, toast]);

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0 || !camp) return;
    const file = e.target.files[0];
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Image too large", description: "Keep camp images under 5 MB.", variant: "destructive" });
      return;
    }
    if (file.type && !file.type.startsWith("image/")) {
      toast({ title: "Unsupported file", description: "Please choose an image.", variant: "destructive" });
      return;
    }
    safeAsync(setUploading)(true);
    try {
      const uploadUrl = await generateMediaUploadUrl({});
      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "image/jpeg" },
        body: file,
      });
      if (!uploadRes.ok) throw new Error(`Upload failed (${uploadRes.status})`);
      const { storageId } = (await uploadRes.json()) as { storageId: string };
      const { convex } = await import("@/integrations/convex/client");
      const publicUrl = (await convex.query(api.fight_camp.getMediaUrl, {
        storageId: storageId as any,
      })) as string | null;
      if (!publicUrl) throw new Error("Could not resolve uploaded image URL");
      if (!isMounted()) return;
      await updateCamp({ id: camp.id as Id<"fight_camps">, profilePicUrl: publicUrl });
      if (isMounted()) {
        setCamp({ ...camp, profile_pic_url: publicUrl });
        flagSaved();
      }
    } catch (err) {
      logger.error("Failed to upload fight-camp image", { err });
      toast({ title: "Error", description: "Failed to upload image", variant: "destructive" });
    } finally {
      if (isMounted()) setUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3 px-5 py-3 sm:p-5 md:p-6 max-w-2xl mx-auto">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full rounded-xs" />
        <Skeleton className="h-64 w-full rounded-xs" />
        <Skeleton className="h-48 w-full rounded-xs" />
      </div>
    );
  }

  if (!camp) {
    return (
      <div className="animate-page-in space-y-3 px-5 py-3 sm:p-5 md:p-6 max-w-2xl mx-auto">
        <div className="card-surface rounded-xs p-6 text-center space-y-3">
          <div className="h-12 w-12 bg-muted rounded-full flex items-center justify-center mx-auto">
            <Trophy className="w-5 h-5 text-muted-foreground" />
          </div>
          <div>
            <h2 className="text-sm font-bold">Camp not found</h2>
            <p className="text-muted-foreground text-xs mt-1">
              This fight camp may have been deleted or the link is invalid.
            </p>
          </div>
          <Button
            onClick={() => navigate("/fight-camps")}
            variant="outline"
            className="rounded-xs mt-2"
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to camps
          </Button>
        </div>
      </div>
    );
  }

  const computedTotal =
    camp.starting_weight_kg != null && camp.end_weight_kg != null && camp.starting_weight_kg > camp.end_weight_kg
      ? Math.round((camp.starting_weight_kg - camp.end_weight_kg) * 10) / 10
      : null;

  // Outcome chip: a soft status. We don't have a true
  // win/loss field so we derive from completion + cut depth, "Strong finish"
  // when the cut hit a meaningful number, "Wrap-up pending" otherwise.
  const outcome = (() => {
    if (!camp.is_completed) return { label: "In progress", tone: "muted" as const };
    if (computedTotal != null && computedTotal > 0) {
      return { label: `${computedTotal}kg cut · complete`, tone: "ok" as const };
    }
    return { label: "Camp complete", tone: "ok" as const };
  })();

  return (
    <div className="animate-page-in px-5 py-3 sm:p-5 md:p-6 max-w-2xl mx-auto pb-20 md:pb-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/fight-camps")} aria-label="Back to fight camps" className="h-9 w-9 rounded-full bg-muted hover:bg-muted/80 border border-border shrink-0">
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="min-w-0 flex-1 relative">
          <AnimatePresence>
            {savedAt && (
              <motion.div
                initial={{ opacity: 0, y: -2, scale: 0.9 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -2, scale: 0.9 }}
                transition={{ duration: 0.18 }}
                className="absolute -top-1 right-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-func-recovery-green/15 text-func-recovery-green text-[10px] font-semibold"
              >
                <Check className="h-2.5 w-2.5" strokeWidth={3} />
                Saved
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <Button variant="ghost" size="icon" onClick={() => setShareOpen(true)} aria-label="Share camp" className="h-9 w-9 rounded-full bg-muted hover:bg-muted/80 border border-border shrink-0">
          <Share2 className="w-4 h-4" />
        </Button>
      </div>

      {/* Hero, outcome chip, camp name, date, 3-up stat tiles */}
      <header className="rounded-xs card-surface overflow-hidden mb-6">
        <div className="px-5 pt-5 pb-4 flex flex-col items-center gap-3">
          <label className="relative cursor-pointer group">
            {camp.profile_pic_url ? (
              <img
                src={camp.profile_pic_url}
                alt={camp.name}
                className="w-20 h-20 rounded-xs object-cover border border-border/40"
              />
            ) : (
              <div className="w-20 h-20 rounded-xs bg-muted/40 border border-border/40 flex items-center justify-center">
                <Trophy className="w-7 h-7 text-muted-foreground/50" />
              </div>
            )}
            <div className="absolute inset-0 bg-black/40 rounded-xs opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity flex items-center justify-center">
              <Camera className="w-5 h-5 text-white" />
            </div>
            <input type="file" accept="image/*" onChange={handleImageUpload} disabled={uploading} className="hidden" />
          </label>

          <div className="text-center">
            <h1 className="text-[24px] font-bold tracking-tight leading-tight">{camp.name}</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              {camp.event_name && <span className="text-primary font-medium">{camp.event_name} · </span>}
              {format(new Date(camp.fight_date), "MMM dd, yyyy")}
            </p>
          </div>

          <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold ${
            outcome.tone === "ok"
              ? "bg-func-recovery-green/15 text-func-recovery-green"
              : "bg-muted/40 text-muted-foreground"
          }`}>
            {outcome.tone === "ok" && <CheckCircle2 className="h-3 w-3" />}
            {outcome.label}
          </div>
        </div>

        {/* 3-up stat tiles: Start → Cut → End */}
        <div className="grid grid-cols-3 border-t border-border/40 divide-x divide-border/40">
          <StatTile label="Start" value={camp.starting_weight_kg} unit="kg" />
          <StatTile label="Cut" value={computedTotal != null ? -computedTotal : null} unit="kg" accent />
          <StatTile label="End" value={camp.end_weight_kg} unit="kg" />
        </div>
      </header>

      <div className="space-y-6">
        {/* Per-camp XP + mastery badges (read-only). Stats load only here on
            the detail route — never on the camp list page. */}
        {id && <CampTrophyCase campId={id as Id<"fight_camps">} />}

        {/* WEIGHT CUT group */}
        <SettingsGroup title="Weight cut">
          <SettingsRow
            label="Start"
            value={camp.starting_weight_kg != null ? `${camp.starting_weight_kg} kg` : "-"}
            onTap={() => setActiveField({ key: "starting_weight_kg", title: "Start weight" })}
          />
          <SettingsRow
            label="End"
            value={camp.end_weight_kg != null ? `${camp.end_weight_kg} kg` : "-"}
            onTap={() => setActiveField({ key: "end_weight_kg", title: "End weight" })}
          />
          <SettingsRow
            label="Breakdown"
            value={
              camp.weight_via_dehydration != null || camp.weight_via_carb_reduction != null
                ? `${camp.weight_via_dehydration ?? 0} / ${camp.weight_via_carb_reduction ?? 0} kg`
                : "-"
            }
            hint={computedTotal != null ? `Total ${computedTotal}kg` : undefined}
            onTap={() => setActiveField({ key: "breakdown", title: "Cut breakdown" })}
          />
          <SettingsRow
            label="Weigh-in timing"
            value={camp.weigh_in_timing ? weighInTimingLabel(camp.weigh_in_timing) : "-"}
            onTap={() => setActiveField({ key: "weigh_in_timing", title: "Weigh-in timing" })}
          />
        </SettingsGroup>

        {/* FEEL group */}
        <SettingsGroup title="Feel">
          <SettingsRow
            label="Performance"
            value={camp.performance_feeling ? truncate(camp.performance_feeling, 28) : "-"}
            onTap={() => setActiveField({ key: "performance_feeling", title: "Performance feeling" })}
          />
          <SettingsRow
            label="Rehydration notes"
            value={camp.rehydration_notes ? truncate(camp.rehydration_notes, 28) : "-"}
            onTap={() => setActiveField({ key: "rehydration_notes", title: "Rehydration notes" })}
          />
        </SettingsGroup>

        {/* STATUS group, inline completed toggle */}
        <SettingsGroup title="Status">
          <button
            type="button"
            onClick={() => {
              triggerHapticSelection();
              void autoSave({ is_completed: !camp.is_completed });
            }}
            className="w-full min-h-[52px] flex items-center gap-3 px-4 py-2.5 text-left active:bg-muted/40 transition-colors"
          >
            <p className="flex-1 text-[15px] font-medium leading-tight truncate">Mark as completed</p>
            <span className={`relative inline-flex h-7 w-12 rounded-full transition-colors ${
              camp.is_completed ? "bg-primary" : "bg-muted-foreground/25"
            }`}>
              <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white transition-transform ${
                camp.is_completed ? "translate-x-[22px]" : "translate-x-0.5"
              }`} />
            </span>
          </button>
        </SettingsGroup>
      </div>

      <EditFieldSheet
        active={activeField}
        camp={camp}
        computedTotal={computedTotal}
        onCommit={(overrides) => void autoSave(overrides)}
        onClose={() => setActiveField(null)}
      />

      <ShareCardDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        title="Share Camp"
        shareTitle={camp.name}
        shareText={`Check out my fight camp: ${camp.name}`}
      >
        {({ cardRef, aspect }) => (
          <FightCampSummaryCard ref={cardRef} camp={camp} aspect={aspect} stats={shareStats} weeks={campWeeks} />
        )}
      </ShareCardDialog>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Inline primitives
// ─────────────────────────────────────────────────────────────────────

function StatTile({ label, value, unit, accent }: { label: string; value: number | null; unit: string; accent?: boolean }) {
  const display = value == null
    ? "-"
    : value < 0 ? `${value}` : `${value}`;
  return (
    <div className="py-3 px-2 text-center">
      <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/70">{label}</p>
      <p className={`mt-1 text-[22px] font-bold tabular-nums tracking-tight ${accent ? "text-primary" : "text-foreground"}`}>
        {display}
        {value != null && <span className={`text-[12px] font-medium ml-0.5 ${accent ? "text-primary/70" : "text-muted-foreground"}`}>{unit}</span>}
      </p>
    </div>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="px-4 mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground/80">
        {title}
      </h2>
      <div className="rounded-xs card-surface overflow-hidden divide-y divide-border/30">
        {children}
      </div>
    </section>
  );
}

function SettingsRow({
  label, value, hint, onTap,
}: {
  label: string;
  value: string;
  hint?: string;
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
        {hint && <p className="mt-0.5 text-[11px] text-muted-foreground/80 truncate">{hint}</p>}
      </div>
      <span className="text-[15px] tabular-nums shrink-0 truncate max-w-[55%] text-right text-muted-foreground">
        {value}
      </span>
      <ChevronRight className="h-4 w-4 text-muted-foreground/40 shrink-0" />
    </button>
  );
}

function EditFieldSheet({
  active, camp, computedTotal, onCommit, onClose,
}: {
  active: ActiveField;
  camp: FightCamp;
  computedTotal: number | null;
  onCommit: (overrides: Partial<FightCamp>) => void;
  onClose: () => void;
}) {
  const [draftText, setDraftText] = useState("");
  const [draftNumber, setDraftNumber] = useState("");

  useEffect(() => {
    if (!active) return;
    if (active.key === "performance_feeling") setDraftText(camp.performance_feeling ?? "");
    else if (active.key === "rehydration_notes") setDraftText(camp.rehydration_notes ?? "");
    else if (active.key === "starting_weight_kg") setDraftNumber(camp.starting_weight_kg?.toString() ?? "");
    else if (active.key === "end_weight_kg") setDraftNumber(camp.end_weight_kg?.toString() ?? "");
  }, [active, camp]);

  if (!active) return null;

  const commitText = () => {
    if (active.key === "performance_feeling") onCommit({ performance_feeling: draftText.trim() || null });
    if (active.key === "rehydration_notes") onCommit({ rehydration_notes: draftText.trim() || null });
    onClose();
  };

  const commitNumber = () => {
    const n = parseFloat(draftNumber);
    const val = Number.isFinite(n) ? n : null;
    if (active.key === "starting_weight_kg") onCommit({ starting_weight_kg: val });
    if (active.key === "end_weight_kg") onCommit({ end_weight_kg: val });
    onClose();
  };

  const renderBody = () => {
    switch (active.key) {
      case "starting_weight_kg":
      case "end_weight_kg":
        return (
          <NumericEditor
            value={draftNumber}
            unit="kg"
            step="0.1"
            onChange={setDraftNumber}
            onCommit={commitNumber}
          />
        );

      case "breakdown":
        return (
          <BreakdownEditor
            total={computedTotal}
            dehydration={camp.weight_via_dehydration}
            carbs={camp.weight_via_carb_reduction}
            onChange={(d, c) => onCommit({ weight_via_dehydration: d, weight_via_carb_reduction: c })}
            onClose={onClose}
          />
        );

      case "weigh_in_timing":
        return (
          <div className="grid gap-2">
            {[
              { value: "day_before", label: "Day before" },
              { value: "same_day", label: "Same-day" },
            ].map((o) => {
              // Normalize the stored value (handles legacy "day_of" / "morning_of"
              // and canonical "same_day") so the right chip highlights.
              const active = normalizeWeighInTiming(camp.weigh_in_timing) === o.value;
              return (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => { triggerHapticSelection(); onCommit({ weigh_in_timing: o.value }); onClose(); }}
                  className={`min-h-[48px] px-4 rounded-xs text-[15px] font-medium transition-all active:scale-[0.98] ${
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/30 text-foreground border border-border/40"
                  }`}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        );

      case "performance_feeling":
      case "rehydration_notes":
        return (
          <div className="space-y-3">
            <Textarea
              autoFocus
              value={draftText}
              onChange={(e) => setDraftText(e.target.value)}
              placeholder={
                active.key === "performance_feeling"
                  ? "How did you feel on fight day? Energy levels, strength, mental clarity…"
                  : "How did rehydration go? What worked well? What would you change?"
              }
              rows={6}
              className="rounded-xs bg-muted/30 border-border/40 text-[15px] resize-none focus:border-primary/40 focus:ring-2 focus:ring-primary/20"
            />
            <button
              type="button"
              onClick={commitText}
              className="w-full h-12 rounded-xs bg-primary text-primary-foreground text-[15px] font-semibold active:scale-[0.98] transition-transform"
            >
              Save
            </button>
          </div>
        );

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
        <div className="mt-4">{renderBody()}</div>
      </SheetContent>
    </Sheet>
  );
}

function NumericEditor({
  value, unit, step, onChange, onCommit,
}: {
  value: string;
  unit: string;
  step: string;
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
          className="h-12 w-12 rounded-full bg-muted/40 text-foreground text-[20px] font-light active:scale-95 transition-transform"
        >
          −
        </button>
        <div className="flex items-baseline gap-1.5 min-w-[140px] justify-center">
          <Input
            type="number"
            step={step}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-[110px] h-14 text-center text-[34px] font-bold tabular-nums bg-transparent border-0 focus-visible:ring-0 px-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
            placeholder="-"
            inputMode="decimal"
          />
          <span className="text-[15px] text-muted-foreground font-medium">{unit}</span>
        </div>
        <button
          type="button"
          onClick={() => bump(stepNum)}
          className="h-12 w-12 rounded-full bg-muted/40 text-foreground text-[20px] font-light active:scale-95 transition-transform"
        >
          +
        </button>
      </div>
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

function BreakdownEditor({
  total, dehydration, carbs, onChange, onClose,
}: {
  total: number | null;
  dehydration: number | null;
  carbs: number | null;
  onChange: (d: number, c: number) => void;
  onClose: () => void;
}) {
  // Slider value = dehydration share (0-100). If no total yet, default to 0
  // and show a soft prompt.
  const effectiveTotal = total ?? ((dehydration ?? 0) + (carbs ?? 0));
  const initialPct = useMemo(() => {
    if (effectiveTotal <= 0) return 50;
    return Math.round(((dehydration ?? 0) / effectiveTotal) * 100);
  }, [effectiveTotal, dehydration]);

  const [pct, setPct] = useState<number>(initialPct);
  useEffect(() => { setPct(initialPct); }, [initialPct]);

  const dehydKg = effectiveTotal > 0 ? Math.round((effectiveTotal * pct) / 10) / 10 : 0;
  const carbsKg = effectiveTotal > 0 ? Math.round((effectiveTotal - dehydKg) * 10) / 10 : 0;

  const commit = () => {
    onChange(dehydKg, carbsKg);
    onClose();
  };

  if (effectiveTotal <= 0) {
    return (
      <div className="space-y-3 text-center py-6">
        <p className="text-[14px] text-muted-foreground">
          Enter your <span className="font-semibold text-foreground">Start</span> and{" "}
          <span className="font-semibold text-foreground">End</span> weights first so we know your total cut.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="w-full h-12 rounded-xs bg-muted/40 text-foreground text-[15px] font-semibold"
        >
          Got it
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="text-center">
        <p className="text-[11px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/80">
          Total cut
        </p>
        <p className="text-[28px] font-bold tabular-nums tracking-tight">{effectiveTotal} kg</p>
      </div>

      {/* Split bar, drag to rebalance */}
      <div>
        <div className="flex h-7 rounded-full overflow-hidden bg-muted/40 border border-border/40">
          <div
            className="bg-blue-500/85 transition-[width] duration-100"
            style={{ width: `${pct}%` }}
          />
          <div
            className="bg-primary/85 transition-[width] duration-100"
            style={{ width: `${100 - pct}%` }}
          />
        </div>

        {/* Slider for drag, accessible + touch-friendly */}
        <div className="px-1 pt-3">
          <Slider
            value={[pct]}
            onValueChange={([v]) => { triggerHapticSelection(); setPct(v); }}
            min={0}
            max={100}
            step={1}
            aria-label="Dehydration vs carb reduction split"
          />
        </div>
      </div>

      {/* Big split readout */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xs bg-blue-500/10 border border-blue-500/20 p-3 text-center">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-blue-400/90">
            <Droplet className="h-3 w-3" /> Dehydration
          </p>
          <p className="mt-1 text-[24px] font-bold tabular-nums tracking-tight text-blue-400">
            {dehydKg}
            <span className="text-[12px] font-medium text-blue-400/70 ml-1">kg</span>
          </p>
          <p className="text-[11px] text-muted-foreground tabular-nums">{pct}%</p>
        </div>
        <div className="rounded-xs bg-primary/10 border border-primary/20 p-3 text-center">
          <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-primary/90">
            <Wheat className="h-3 w-3" /> Carbs
          </p>
          <p className="mt-1 text-[24px] font-bold tabular-nums tracking-tight text-primary">
            {carbsKg}
            <span className="text-[12px] font-medium text-primary/70 ml-1">kg</span>
          </p>
          <p className="text-[11px] text-muted-foreground tabular-nums">{100 - pct}%</p>
        </div>
      </div>

      <button
        type="button"
        onClick={commit}
        className="w-full h-12 rounded-xs bg-primary text-primary-foreground text-[15px] font-semibold active:scale-[0.98] transition-transform"
      >
        Save split
      </button>
    </div>
  );
}

function truncate(s: string, max: number) {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
