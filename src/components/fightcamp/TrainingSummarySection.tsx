import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, useReducedMotion, type PanInfo } from "motion/react";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { ChevronDown, Trash2, CheckCircle, X, Dumbbell, Activity, RotateCw, BookOpen } from "lucide-react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { useAIAction } from "@/hooks/useAIAction";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { useToast } from "@/hooks/use-toast";
import { triggerHapticSelection } from "@/lib/haptics";
import { springs } from "@/lib/motion";
import { useSubscription } from "@/hooks/useSubscription";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { logger } from "@/lib/logger";
import { localCache } from "@/lib/localCache";
import { useAITask } from "@/contexts/AITaskContext";
import { ProtocolGeneratingOverlay } from "@/components/protocol/ProtocolGeneratingOverlay";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { WeeklyRecap, type RecapDebrief } from "./WeeklyRecap";
import { TechniqueLog } from "./TechniqueLog";
import { WeeklyTimeline } from "./WeeklyTimeline";
import { ShimmerCrownBadge } from "@/components/subscription/ShimmerCrownBadge";
import { ProExplainerOverlay } from "@/components/subscription/ProExplainerOverlay";

/** The value story for the weekly recap, shown before the paywall. */
const RECAP_PERKS = [
    "A coach-voice debrief of your training week",
    "The key techniques you drilled, with cues to remember them",
    "Catches recurring issues before they cost you",
    "Builds your all-time technique log",
];

// ─── New shape (weekly recap debrief) ──────────────────────────────────────
type RecapSummary = {
    weekHeadline: string;
    stats: {
        sessionsLogged: number;
        totalMinutes: number;
        topDiscipline: string;
        avgRpe?: number;
        avgSleepHours?: number;
    };
    debrief: RecapDebrief;
};

// ─── Legacy shape (kept only so older saved rows render the chip path) ────
type TrainingSummary = {
    sportSections?: {
        sport: string;
        sessions_count: number;
        techniques: { name: string; steps: string[]; sparringTip: string; drillFlow?: string[] }[];
    }[];
    weekOverview?: string;
};

type SavedSummaryRow = {
    id: string;
    week_start: string;
    summary_data: TrainingSummary;
    session_ids: string[];
    notes_fingerprint: string;
    created_at: string;
    updated_at: string;
};

type SessionRow = {
    id: string;
    date: string;
    session_type: string;
    duration_minutes: number;
    notes: string | null;
};

type ButtonState = "hidden" | "generate" | "update" | "up_to_date";

interface TrainingSummarySectionProps {
    userId: string;
    selectedDate: Date;
    sessionLoggedTrigger: number;
    customColors?: Record<string, string>;
}

function computeFingerprint(sessions: SessionRow[]): string {
    return sessions
        .filter(s => s.notes)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(s => `${s.id}:${s.notes}`)
        .join("|");
}

export function TrainingSummarySection({ userId, selectedDate, sessionLoggedTrigger, customColors }: TrainingSummarySectionProps) {
    // `customColors` was used by the old per-sport rendering. The recap UI
    // pulls discipline tints from `disciplineToken` instead. Keep the prop in
    // the surface for now so callers don't have to change.
    void customColors;
    const { toast } = useToast();
    const { handlePaywallError } = useSubscription();
    const { hasAccess: hasAiAccess } = useFeatureAccess("AI_TRAINING_SUMMARY");
    const [recapExplainerOpen, setRecapExplainerOpen] = useState(false);
    const { tasks, addTask, completeTask, failTask, dismissTask } = useAITask();
    const trainingSummaryAction = useAIAction(api.actions.trainingSummary.run, "AI_TRAINING_SUMMARY");
    const upsertSummaryMut = useMutation(api.fight_camp.upsertSummary);
    const deleteSummaryMut = useMutation(api.fight_camp.deleteSummary);
    const summariesRaw = useQuery(api.fight_camp.listAllSummaries, userId ? { limit: 20 } : "skip");
    // Live-reactive subscription to training_summaries. The Convex client caches identically.
    const savedSummaries = useMemo<SavedSummaryRow[]>(() => (
        (summariesRaw ?? []).map((r: any) => ({
            id: r._id,
            week_start: r.weekStart,
            summary_data: r.summaryData,
            session_ids: r.sessionIds,
            notes_fingerprint: r.notesFingerprint,
            created_at: r._creationTime ? new Date(r._creationTime).toISOString() : "",
            updated_at: r.updatedAt ? new Date(r.updatedAt).toISOString() : "",
        }))
    ), [summariesRaw]);
    const [weekSessions, setWeekSessions] = useState<SessionRow[]>([]);
    const [selectedWeekStart, setSelectedWeekStart] = useState<string>(
        format(startOfWeek(selectedDate, { weekStartsOn: 1 }), "yyyy-MM-dd")
    );
    const [isLoading, setIsLoading] = useState(false);
    const aiTrainingTask = tasks.find(t => t.type === "training-summary" && t.status === "running");
    const isGenerating = isLoading || !!aiTrainingTask;

    // Pick up completed training summary from task context
    const handledSummaryTaskRef = useRef<string | null>(null);
    useEffect(() => {
      const done = tasks.find(t => t.status === "done" && t.type === "training-summary" && handledSummaryTaskRef.current !== t.id);
      if (done) {
        handledSummaryTaskRef.current = done.id;
        fetchAllSummaries();
        setIsSummaryOpen(true);
        dismissTask(done.id);
      }
    }, [tasks, dismissTask]);
    const [isSummaryOpen, setIsSummaryOpen] = useState(true);
    const [isTechniqueLogOpen, setIsTechniqueLogOpen] = useState(false);
    const abortRef = useRef<AbortController | null>(null);

    const calendarWeekStart = format(startOfWeek(selectedDate, { weekStartsOn: 1 }), "yyyy-MM-dd");

    // Sync selectedWeekStart when calendar week changes
    useEffect(() => {
        setSelectedWeekStart(calendarWeekStart);
    }, [calendarWeekStart]);

    // Re-fetch hook is now a no-op shim; the Convex subscription keeps the list live.
    // Kept under the same name so the rest of the file's call-sites compile.
    const fetchAllSummaries = useCallback(async () => { /* live via useQuery */ }, []);

    // Fetch sessions for the current calendar week (for change detection).
    // Now driven by the Convex fight_camp_calendar query mapped into the local
    // SessionRow shape that `computeFingerprint` consumes.
    const calendarConvex = useConvex();
    const fetchWeekSessions = useCallback(async (skipCache = false) => {
        if (!userId) return;
        const ws = startOfWeek(selectedDate, { weekStartsOn: 1 });
        const we = endOfWeek(selectedDate, { weekStartsOn: 1 });
        const weekKey = `training_week_${format(ws, "yyyy-MM-dd")}`;
        if (!skipCache) {
            const cached = localCache.get<SessionRow[]>(userId, weekKey, 5 * 60 * 1000);
            if (cached) { setWeekSessions(cached); return; }
        }
        try {
            const rawRows = await calendarConvex.query(api.fight_camp.listCalendar, {
                from: format(ws, "yyyy-MM-dd"),
                to: format(we, "yyyy-MM-dd"),
            });
            const rows: SessionRow[] = (rawRows ?? []).map((r: any) => ({
                id: r._id,
                date: r.date,
                session_type: r.sessionType,
                duration_minutes: r.durationMinutes,
                notes: r.notes ?? null,
            }));
            setWeekSessions(rows);
            localCache.set(userId, weekKey, rows);
        } catch (err) {
            logger.error("Error fetching week sessions", err);
        }
    }, [userId, selectedDate, calendarConvex]);

    useEffect(() => {
        fetchAllSummaries();
    }, [fetchAllSummaries]);

    // Initial load: uses cache
    useEffect(() => {
        fetchWeekSessions();
    }, [fetchWeekSessions]);

    // Re-fetch on new session logged: bypass cache
    useEffect(() => {
        if (sessionLoggedTrigger > 0) fetchWeekSessions(true);
    }, [sessionLoggedTrigger]);

    // Currently selected summary
    const selectedSummary = useMemo(
        () => savedSummaries.find(s => s.week_start === selectedWeekStart) ?? null,
        [savedSummaries, selectedWeekStart]
    );

    // Sessions with notes for the current calendar week
    const sessionsWithNotes = useMemo(
        () => weekSessions.filter(s => s.notes),
        [weekSessions]
    );

    // Past weeks that have a saved summary; drives the timeline chips. DESC
    // (newest first) to match WeeklyTimeline's contract.
    const summarisedWeeks = useMemo(
        () => savedSummaries.map(s => s.week_start).sort((a, b) => b.localeCompare(a)),
        [savedSummaries]
    );

    // ── Horizontal swipe between recapped weeks ─────────────────────────────
    // The recap content reads off `selectedWeekStart`; swiping (or the timeline
    // chips) just moves that pointer through `summarisedWeeks`. Swipe right →
    // older week (going back in time), swipe left → newer week. `slideDir` is
    // the x-sign the incoming content animates in from, so the transition reads
    // directionally. NOTE: list is DESC, so older = higher index, newer = lower.
    const prefersReduced = useReducedMotion();
    const [slideDir, setSlideDir] = useState(0);

    const navigateWeek = useCallback(
        (dir: "older" | "newer") => {
            if (summarisedWeeks.length === 0) return;
            let idx = summarisedWeeks.indexOf(selectedWeekStart);
            // Current (possibly unsummarised) week sits just before the newest
            // saved one, so an "older" swipe lands on the newest recap.
            if (idx === -1) idx = -1;
            const next = dir === "older" ? idx + 1 : idx - 1;
            if (next < 0 || next >= summarisedWeeks.length) return; // at an edge
            triggerHapticSelection();
            setSlideDir(dir === "older" ? -1 : 1);
            setSelectedWeekStart(summarisedWeeks[next]);
        },
        [summarisedWeeks, selectedWeekStart],
    );

    const handleRecapSwipe = useCallback(
        (_e: unknown, info: PanInfo) => {
            const SWIPE_PX = 48;
            const SWIPE_V = 320;
            if (info.offset.x <= -SWIPE_PX || info.velocity.x < -SWIPE_V) navigateWeek("newer");
            else if (info.offset.x >= SWIPE_PX || info.velocity.x > SWIPE_V) navigateWeek("older");
        },
        [navigateWeek],
    );

    // Change detection: only for the CURRENT calendar week. When the user is
    // viewing a past week (via swipe or the timeline chips), the recap is
    // read-only — `weekSessions`/`sessionsWithNotes` only ever hold the current
    // week, so comparing their fingerprint against a past week's stored summary
    // would always mismatch and wrongly prompt "Update recap", which then
    // regenerated the WRONG week and duplicated its techniques.
    const buttonState: ButtonState = useMemo(() => {
        if (selectedWeekStart !== calendarWeekStart) return "hidden";
        if (sessionsWithNotes.length === 0) return "hidden";
        if (!selectedSummary) return "generate";
        const currentFingerprint = computeFingerprint(weekSessions);
        if (currentFingerprint !== selectedSummary.notes_fingerprint) return "update";
        return "up_to_date";
    }, [selectedWeekStart, calendarWeekStart, sessionsWithNotes, selectedSummary, weekSessions]);

    const handleCancel = () => {
        abortRef.current?.abort();
        // Also clear the persisted AI task, otherwise the wizard overlay (gated
        // on `aiTrainingTask`) would stay on screen after the user cancels.
        if (aiTrainingTask) dismissTask(aiTrainingTask.id);
        setIsLoading(false);
    };

    const handleGenerateOrUpdate = async () => {
        if (sessionsWithNotes.length === 0) return;
        if (!hasAiAccess) {
            setRecapExplainerOpen(true);
            return;
        }
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setIsLoading(true);

        const taskId = addTask({
            id: `training-summary-${Date.now()}`,
            type: "training-summary",
            label: "Generating Recap",
            steps: [
                { icon: Dumbbell, label: "Reviewing sessions" },
                { icon: Activity, label: "Analyzing performance" },
                { icon: CheckCircle, label: "Writing recap" },
            ],
            returnPath: window.location.pathname,
        });

        try {
            // Only send sessions not already summarized (new entries since last summary)
            const alreadySummarized = new Set(selectedSummary?.session_ids || []);
            const sessionsToSend = sessionsWithNotes.filter(s => !alreadySummarized.has(s.id));
            // If no new sessions, nothing to do (shouldn't happen since fingerprint would match)
            if (sessionsToSend.length === 0) { setIsLoading(false); return; }

            // The trainingSummary action only takes a weekStart. The session
            // payload is server-side; we keep `sessionsToSend` to guard the
            // fingerprint logic above.
            void sessionsToSend;
            let data: any;
            try {
                data = await trainingSummaryAction({ weekStart: calendarWeekStart });
            } catch (error: any) {
                if (controller.signal.aborted) return;
                if (await handlePaywallError(error)) { failTask(taskId, "Pro required"); return; }
                throw error;
            }
            if (controller.signal.aborted) return;
            const summaryData = data;
            if (!summaryData) throw new Error("No recap returned");
            const dataRec = summaryData as Record<string, unknown>;
            const isNewShape =
                typeof dataRec.weekHeadline === "string" &&
                !!dataRec.debrief &&
                typeof dataRec.debrief === "object";
            if (!isNewShape) {
                throw new Error("AI returned malformed recap. Please retry.");
            }

            const fingerprint = computeFingerprint(weekSessions);
            const allSessionIds = sessionsWithNotes.map(s => s.id);

            // Upsert via Convex; handler is idempotent on (userId, weekStart).
            // The new shape isn't list-additive (techniques live in their own
            // table, written server-side), so we just persist the latest.
            await upsertSummaryMut({
                weekStart: calendarWeekStart,
                sessionIds: allSessionIds,
                notesFingerprint: fingerprint,
                summaryData,
            });

            // Bust cache and refresh immediately so the recap appears live
            localCache.remove(userId, "training_summaries");
            await fetchAllSummaries();
            setIsSummaryOpen(true);
            completeTask(taskId, summaryData);
        } catch (error: any) {
            if (error?.name === 'AbortError' || controller.signal.aborted) return;
            logger.error("Error generating training recap", error);
            failTask(taskId, error?.message || "Could not generate your weekly recap");
            toast({
                title: "Error generating recap",
                description: "Could not generate your weekly recap. Please try again.",
                variant: "destructive",
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteSummary = async (id: string) => {
        try {
            await deleteSummaryMut({ id: id as Id<"training_summaries"> });
        } catch (error) {
            logger.error("Error deleting summary", error);
            toast({
                title: "Error deleting summary",
                description: "Could not delete the summary. Please try again.",
                variant: "destructive",
            });
        }
    };

    const summaryToDisplay = selectedSummary?.summary_data ?? null;
    // ── Shape detection ──────────────────────────────────────────────────
    // NEW SHAPE  → `weekHeadline` string + `stats` object + `debrief` object.
    // LEGACY     → `sportSections` + `weekOverview`. Show a tiny "Legacy
    //              summary" chip with a regenerate tap.
    const summaryAsRecord = (summaryToDisplay ?? {}) as Record<string, unknown>;
    const isNewSummaryShape = !!(summaryToDisplay
        && typeof summaryAsRecord.weekHeadline === "string"
        && summaryAsRecord.stats
        && typeof summaryAsRecord.stats === "object"
        && summaryAsRecord.debrief
        && typeof summaryAsRecord.debrief === "object");
    const isLegacySummaryShape = !isNewSummaryShape && !!(summaryToDisplay
        && Array.isArray(summaryAsRecord.sportSections)
        && typeof summaryAsRecord.weekOverview === "string");

    const newSummary: RecapSummary | null = isNewSummaryShape ? (summaryToDisplay as RecapSummary) : null;

    // Nothing to show if there's no summary for this week and no notes to summarise
    if (sessionsWithNotes.length === 0 && !selectedSummary) {
        return null;
    }

    return (
        <div className="mt-6 space-y-4">
            {aiTrainingTask && (
                <ProtocolGeneratingOverlay
                    label="Conjuring your recap"
                    steps={[
                        "Reviewing your logged sessions",
                        "Distilling the techniques you drilled",
                        "Writing your coach debrief",
                    ]}
                    footnote="This usually takes 5-15 seconds."
                />
            )}

            {/* Manual generate / update control: the single entry point. */}
            {buttonState !== "hidden" && (
                <div className="flex items-center justify-center min-h-[44px]">
                    {isGenerating ? (
                        <button
                            onClick={handleCancel}
                            className="flex items-center gap-1.5 text-note font-medium text-muted-foreground hover:text-foreground transition-colors px-3 py-2 rounded-xs hover:bg-accent/30"
                        >
                            <X className="h-3.5 w-3.5" />
                            Cancel
                        </button>
                    ) : buttonState === "up_to_date" ? (
                        <span className="inline-flex items-center gap-1.5 text-note text-muted-foreground">
                            <CheckCircle className="h-3.5 w-3.5 text-func-recovery-green" />
                            Up to date
                        </span>
                    ) : !hasAiAccess ? (
                        <button
                            onClick={handleGenerateOrUpdate}
                            className="inline-flex items-center gap-2 rounded-xs border border-primary/30 bg-primary/10 px-3 py-2 min-h-[44px] text-[13px] font-semibold text-foreground card-press"
                        >
                            <ShimmerCrownBadge size={22} />
                            <span>{buttonState === "generate" ? "Generate weekly recap" : "Update recap"}</span>
                            <span className="rounded-full border border-primary/40 bg-primary/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-primary">
                                Pro
                            </span>
                        </button>
                    ) : (
                        <button
                            onClick={handleGenerateOrUpdate}
                            className="inline-flex items-center gap-1.5 text-body-sm font-semibold text-primary hover:text-primary/80 transition-colors px-3 py-2 rounded-xs min-h-[44px]"
                        >
                            <RotateCw className="h-4 w-4" />
                            {buttonState === "generate" ? "Generate weekly recap" : "Update recap"}
                        </button>
                    )}
                </div>
            )}

            {/* Summary display: header (collapse + delete) is shared */}
            {(isNewSummaryShape || isLegacySummaryShape) && summaryToDisplay && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between w-full">
                        <button onClick={() => setIsSummaryOpen(!isSummaryOpen)} className="flex items-center gap-2">
                            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground/70 transition-transform ${isSummaryOpen ? "" : "-rotate-90"}`} />
                            <span className="text-[13px] font-semibold text-foreground">Week Recap</span>
                        </button>
                        {selectedSummary && (
                            <button onClick={() => handleDeleteSummary(selectedSummary.id)}
                                className="h-8 w-8 flex items-center justify-center rounded-xs text-muted-foreground/30 active:text-destructive active:bg-destructive/10 transition-colors"
                                aria-label="Delete summary">
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>

                    {/* Legacy summaries: small chip + regenerate tap. Regenerate
                        only targets the current calendar week, so it's hidden
                        when viewing a past week (the control would otherwise
                        regenerate the wrong week). */}
                    {isSummaryOpen && isLegacySummaryShape && (
                        <div className="card-surface rounded-xs border border-border/60 px-4 py-3 flex items-center gap-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-muted/30 border border-border/50 text-[10px] uppercase tracking-wider font-bold text-muted-foreground flex-shrink-0">
                                Legacy summary
                            </span>
                            <p className="text-note text-muted-foreground flex-1 min-w-0">
                                {selectedWeekStart === calendarWeekStart
                                    ? "Older format. Regenerate to switch to the new recap."
                                    : "Older format. Open this week to regenerate."}
                            </p>
                            {selectedWeekStart === calendarWeekStart && (
                            <button
                                onClick={handleGenerateOrUpdate}
                                disabled={isGenerating}
                                className="inline-flex items-center gap-1.5 text-note font-medium text-primary hover:text-primary/80 transition-colors px-2 py-2 rounded-xs min-h-[44px] disabled:opacity-50 flex-shrink-0"
                            >
                                <RotateCw className={`h-3.5 w-3.5 ${isGenerating ? "animate-spin" : ""}`} />
                                Regenerate
                            </button>
                            )}
                        </div>
                    )}

                    {/* New shape: stats strip, recap debrief, timeline */}
                    {isSummaryOpen && isNewSummaryShape && newSummary && (
                        <div className="space-y-4">
                            {/* Swipeable week pager: the stats + recap slide as the
                                user swipes left/right between recapped weeks. Keyed
                                by week so each change re-runs the directional enter
                                animation. Timeline chips stay outside so their own
                                horizontal scroll never fights the swipe. */}
                            <motion.div
                                key={selectedWeekStart}
                                drag={summarisedWeeks.length > 1 ? "x" : false}
                                dragConstraints={{ left: 0, right: 0 }}
                                dragElastic={0.16}
                                dragSnapToOrigin
                                onDragEnd={handleRecapSwipe}
                                initial={prefersReduced ? false : { opacity: 0, x: slideDir * 28 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={springs.gentle}
                                className="space-y-4"
                            >
                                {/* Stats strip */}
                                <div className="grid grid-cols-4 gap-3">
                                    <StatCell label="Sessions" value={`${newSummary.stats.sessionsLogged}`} />
                                    <StatCell label="Minutes" value={`${newSummary.stats.totalMinutes}`} />
                                    <StatCell label="Top sport" value={newSummary.stats.topDiscipline || "-"} />
                                    <StatCell
                                        label={newSummary.stats.avgRpe !== undefined ? "Avg RPE" : "Avg sleep"}
                                        value={
                                            newSummary.stats.avgRpe !== undefined
                                                ? newSummary.stats.avgRpe.toFixed(1)
                                                : newSummary.stats.avgSleepHours !== undefined
                                                    ? `${newSummary.stats.avgSleepHours.toFixed(1)}h`
                                                    : "-"
                                        }
                                    />
                                </div>

                                {/* Recap debrief: headline, takeaways, watch-out */}
                                <WeeklyRecap headline={newSummary.weekHeadline} debrief={newSummary.debrief} />
                            </motion.div>

                            {/* Weekly timeline: past-week chips */}
                            {summarisedWeeks.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-micro uppercase tracking-wider text-muted-foreground/70 font-bold">
                                        Past weeks
                                    </p>
                                    <WeeklyTimeline
                                        weeks={summarisedWeeks}
                                        currentWeek={selectedWeekStart}
                                        onSelectWeek={(w) => {
                                            const ai = summarisedWeeks.indexOf(selectedWeekStart);
                                            const bi = summarisedWeeks.indexOf(w);
                                            setSlideDir(bi > ai ? -1 : 1);
                                            setSelectedWeekStart(w);
                                        }}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Technique log: all-time, searchable library of logged techniques */}
            <button
                type="button"
                onClick={() => setIsTechniqueLogOpen(true)}
                className="w-full min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-full bg-muted/30 border border-border/50 px-4 py-2 text-note font-semibold text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
                <BookOpen className="h-3.5 w-3.5" />
                View technique log
            </button>

            <Sheet open={isTechniqueLogOpen} onOpenChange={setIsTechniqueLogOpen}>
                <SheetContent side="bottom" className="rounded-t-3xl max-h-[92vh] overflow-y-auto">
                    <SheetHeader>
                        <SheetTitle>Technique log</SheetTitle>
                    </SheetHeader>
                    <div className="mt-4">
                        <TechniqueLog />
                    </div>
                </SheetContent>
            </Sheet>

            <ProExplainerOverlay
                open={recapExplainerOpen}
                onOpenChange={setRecapExplainerOpen}
                title="Weekly Recap is a Pro feature"
                blurb="Your AI corner reads every session note and writes you a coach-voice debrief of the week."
                perks={RECAP_PERKS}
            />
        </div>
    );
}

// ─── Small inline stats cell, used by the new shape's stats strip ────────
function StatCell({ label, value }: { label: string; value: string | number }) {
    return (
        <div className="flex flex-col gap-0.5">
            <span className="text-micro uppercase tracking-wider text-muted-foreground/70 font-bold">
                {label}
            </span>
            <span className="text-value font-bold tabular-nums text-foreground truncate">
                {value}
            </span>
        </div>
    );
}
