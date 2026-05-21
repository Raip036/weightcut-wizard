import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { Loader2, ChevronDown, Trash2, CheckCircle, X, Dumbbell, Activity, Crown, RotateCw } from "lucide-react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { useAIAction } from "@/hooks/useAIAction";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { useToast } from "@/hooks/use-toast";
import { useSubscription } from "@/hooks/useSubscription";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { logger } from "@/lib/logger";
import { localCache } from "@/lib/localCache";
import { useAITask } from "@/contexts/AITaskContext";
import { AICompactOverlay } from "@/components/AICompactOverlay";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FlashcardDeck, type FlashcardRow } from "./FlashcardDeck";
import { WeeklyTimeline } from "./WeeklyTimeline";

// ─── New shape (retention flashcards) ──────────────────────────────────────
type FlashcardSummary = {
    weekHeadline: string;
    stats: {
        sessionsLogged: number;
        totalMinutes: number;
        topDiscipline: string;
        avgRpe?: number;
        avgSleepHours?: number;
    };
    cards: Array<{
        sport: string;
        front: string;
        back: string;
        cue?: string;
        sourceSessionDate?: string;
    }>;
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

type LegacySportSection = NonNullable<TrainingSummary["sportSections"]>[number];

function mergeSummaries(existing: TrainingSummary, incoming: TrainingSummary): TrainingSummary {
    const merged = new Map<string, LegacySportSection>();
    for (const section of existing.sportSections || []) {
        merged.set(section.sport, { ...section, techniques: [...section.techniques] });
    }
    for (const section of incoming.sportSections || []) {
        const prev = merged.get(section.sport);
        if (prev) {
            const existingNames = new Set(prev.techniques.map(t => t.name));
            const newTechniques = section.techniques.filter(t => !existingNames.has(t.name));
            prev.techniques.push(...newTechniques);
            prev.sessions_count = section.sessions_count;
        } else {
            merged.set(section.sport, { ...section, techniques: [...section.techniques] });
        }
    }
    return {
        sportSections: Array.from(merged.values()),
        weekOverview: incoming.weekOverview || existing.weekOverview,
    };
}


export function TrainingSummarySection({ userId, selectedDate, sessionLoggedTrigger, customColors }: TrainingSummarySectionProps) {
    // `customColors` was used by the old per-sport rendering. The new
    // flashcard UI pulls discipline tints from `coachColors` instead. Keep
    // the prop in the surface for now so callers don't have to change.
    void customColors;
    const { toast } = useToast();
    const { openPaywall, handlePaywallError } = useSubscription();
    const { hasAccess: hasAiAccess } = useFeatureAccess("AI_TRAINING_SUMMARY");
    const { tasks, addTask, completeTask, failTask, dismissTask } = useAITask();
    const trainingSummaryAction = useAIAction(api.actions.trainingSummary.run, "AI_TRAINING_SUMMARY");
    const upsertSummaryMut = useMutation(api.fight_camp.upsertSummary);
    const deleteSummaryMut = useMutation(api.fight_camp.deleteSummary);
    const coachSettings = useQuery(api.user_coach_settings.getMyCoachSettings);
    const setAutoSummaryMut = useMutation(api.user_coach_settings.setAutoSummary);
    const autoSummaryOn = coachSettings?.autoSummary === true;
    const settingsLoading = coachSettings === undefined;
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
    const setSavedSummaries = (_v: any) => { /* no-op — Convex subscription drives this */ };
    void setSavedSummaries;
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
    const abortRef = useRef<AbortController | null>(null);

    const calendarWeekStart = format(startOfWeek(selectedDate, { weekStartsOn: 1 }), "yyyy-MM-dd");

    // Sync selectedWeekStart when calendar week changes
    useEffect(() => {
        setSelectedWeekStart(calendarWeekStart);
    }, [calendarWeekStart]);

    // Re-fetch hook is now a no-op shim — the Convex subscription keeps the list live.
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

    // Initial load — uses cache
    useEffect(() => {
        fetchWeekSessions();
    }, [fetchWeekSessions]);

    // Re-fetch on new session logged — bypass cache
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

    // Change detection — only for the current calendar week
    const buttonState: ButtonState = useMemo(() => {
        if (sessionsWithNotes.length === 0) return "hidden";
        if (!selectedSummary) return "generate";
        const currentFingerprint = computeFingerprint(weekSessions);
        if (currentFingerprint !== selectedSummary.notes_fingerprint) return "update";
        return "up_to_date";
    }, [selectedWeekStart, calendarWeekStart, sessionsWithNotes, selectedSummary, weekSessions]);

    const handleCancel = () => {
        abortRef.current?.abort();
        setIsLoading(false);
    };

    const handleToggleAutoSummary = async (next: boolean) => {
        if (settingsLoading) return;
        // Free-tier guard: don't even call the mutation when enabling without Pro.
        if (next && coachSettings && !coachSettings.isPro) {
            openPaywall();
            return;
        }
        try {
            await setAutoSummaryMut({ enabled: next });
        } catch (error: any) {
            // Backend throws PRO_FEATURE_REQUIRED:AUTO_SUMMARY for non-Pro enables.
            if (await handlePaywallError(error)) return;
            logger.error("Error updating auto-summary setting", error);
            toast({
                title: "Couldn't update setting",
                description: "Please try again.",
                variant: "destructive",
            });
        }
    };

    const handleGenerateOrUpdate = async () => {
        if (sessionsWithNotes.length === 0) return;
        if (!hasAiAccess) {
            openPaywall();
            return;
        }
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        setIsLoading(true);

        const taskId = addTask({
            id: `training-summary-${Date.now()}`,
            type: "training-summary",
            label: "Generating Summary",
            steps: [
                { icon: Dumbbell, label: "Reviewing sessions" },
                { icon: Activity, label: "Analyzing performance" },
                { icon: CheckCircle, label: "Writing summary" },
            ],
            returnPath: window.location.pathname,
        });

        try {
            // Only send sessions not already summarized (new entries since last summary)
            const alreadySummarized = new Set(selectedSummary?.session_ids || []);
            const sessionsToSend = sessionsWithNotes.filter(s => !alreadySummarized.has(s.id));
            // If no new sessions, nothing to do (shouldn't happen since fingerprint would match)
            if (sessionsToSend.length === 0) { setIsLoading(false); return; }

            // Convex trainingSummary action only takes a weekStart. The
            // session payload is server-side; we keep `sessionsToSend` to
            // guard the fingerprint logic above.
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
            if (!summaryData) throw new Error("No summary returned");
            // Accept either the new flashcards shape OR the legacy shape — the
            // action *should* now return the new shape, but if a sibling
            // deploy hasn't rolled out the rest still works.
            const dataRec = summaryData as Record<string, unknown>;
            const isNewShape = Array.isArray(dataRec.cards) && typeof dataRec.weekHeadline === "string";
            const isLegacyShape = Array.isArray(dataRec.sportSections) && typeof dataRec.weekOverview === "string";
            if (!isNewShape && !isLegacyShape) {
                throw new Error("AI returned malformed summary — please retry.");
            }

            const fingerprint = computeFingerprint(weekSessions);
            const allSessionIds = sessionsWithNotes.map(s => s.id);

            // Upsert via Convex — handler is idempotent on (userId, weekStart).
            // Only merge legacy-with-legacy. The new shape isn't list-additive
            // (cards live in their own table) so we just persist the latest.
            const existingRec = (selectedSummary?.summary_data ?? {}) as Record<string, unknown>;
            const mergedData = (isLegacyShape && selectedSummary && Array.isArray(existingRec.sportSections))
                ? mergeSummaries(selectedSummary.summary_data as TrainingSummary, summaryData as TrainingSummary)
                : summaryData;
            await upsertSummaryMut({
                weekStart: calendarWeekStart,
                sessionIds: allSessionIds,
                notesFingerprint: fingerprint,
                summaryData: mergedData,
            });

            // Bust cache and refresh immediately so summary appears live
            localCache.remove(userId, "training_summaries");
            await fetchAllSummaries();
            setIsSummaryOpen(true);
            completeTask(taskId, summaryData);
        } catch (error: any) {
            if (error?.name === 'AbortError' || controller.signal.aborted) return;
            logger.error("Error generating training summary", error);
            failTask(taskId, error?.message || "Could not generate your training summary");
            toast({
                title: "Error generating summary",
                description: "Could not generate your training summary. Please try again.",
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
    // NEW SHAPE  → has a `cards: []` field AND a `weekHeadline` string.
    // LEGACY     → has `sportSections: []` + `weekOverview`. Show a tiny
    //              "Legacy summary" chip with a regenerate tap.
    const summaryAsRecord = (summaryToDisplay ?? {}) as Record<string, unknown>;
    const isNewSummaryShape = !!(summaryToDisplay
        && Array.isArray(summaryAsRecord.cards)
        && typeof summaryAsRecord.weekHeadline === "string"
        && summaryAsRecord.stats
        && typeof summaryAsRecord.stats === "object");
    const isLegacySummaryShape = !isNewSummaryShape && !!(summaryToDisplay
        && Array.isArray(summaryAsRecord.sportSections)
        && typeof summaryAsRecord.weekOverview === "string");

    const newSummary: FlashcardSummary | null = isNewSummaryShape ? (summaryToDisplay as FlashcardSummary) : null;

    // Hooks (Convex queries + sheet state) MUST be unconditionally called.
    // The new card APIs are generated by Convex from a sibling-agent's
    // `convex/training_summary_cards.ts`. The generated api.d.ts may not
    // be regenerated yet — guard each `useQuery` with a "skip" arg until
    // the api ref resolves so we don't blow up at runtime. The single
    // `eslint-disable-next-line` keeps the codebase's existing lint rules
    // satisfied while we straddle deploys.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cardApis = (api as any).training_summary_cards as undefined | Record<string, unknown>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fallbackRef = (api as any).fight_camp.listAllSummaries;

    const summarisedWeeksRaw = useQuery(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cardApis?.listSummarisedWeeks as any) ?? fallbackRef,
        cardApis ? {} : "skip"
    ) as string[] | undefined;
    const summarisedWeeks = useMemo(() => summarisedWeeksRaw ?? [], [summarisedWeeksRaw]);

    const cardsForWeekRaw = useQuery(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cardApis?.getCardsForWeek as any) ?? fallbackRef,
        cardApis && userId && selectedWeekStart ? { weekStart: selectedWeekStart } : "skip"
    ) as FlashcardRow[] | undefined;
    const cardsForCurrentWeek = useMemo(() => cardsForWeekRaw ?? [], [cardsForWeekRaw]);

    const dueCardsRaw = useQuery(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (cardApis?.getDueToday as any) ?? fallbackRef,
        cardApis && userId ? {} : "skip"
    ) as FlashcardRow[] | undefined;
    const dueCards = useMemo(() => dueCardsRaw ?? [], [dueCardsRaw]);

    const [isDueSheetOpen, setIsDueSheetOpen] = useState(false);

    // Nothing to show if there's no summary for this week and no notes to summarise
    if (sessionsWithNotes.length === 0 && !selectedSummary) {
        return null;
    }

    // The browsing week defaults to whatever week the calendar is on. If the
    // user picks a chip from the timeline, we move there. When the timeline
    // is still loading or empty we just stick with `selectedWeekStart`
    // (already keyed to the calendar week via the earlier useEffect).
    const showPastWeek = selectedWeekStart !== calendarWeekStart;

    return (
        <div className="mt-6 space-y-4">
            {aiTrainingTask && (
                <AICompactOverlay
                    isOpen={true}
                    isGenerating={true}
                    steps={aiTrainingTask.steps}
                    startedAt={aiTrainingTask.startedAt}                    title={aiTrainingTask.label}
                    onCancel={() => { abortRef.current?.abort(); dismissTask(aiTrainingTask.id); setIsLoading(false); }}
                />
            )}

            {/* Auto-generate toggle — Pro-only; sits above the manual button */}
            {buttonState !== "hidden" && (
                <div className="w-full p-4 rounded-xs card-surface border border-border/50 flex items-center gap-3 min-h-[44px]">
                    <div className="flex-1 min-w-0">
                        <label
                            htmlFor="auto-summary-toggle"
                            className="text-body-sm font-semibold text-foreground cursor-pointer block"
                        >
                            Auto-generate summaries
                        </label>
                        <p className="text-note text-muted-foreground mt-0.5">
                            Generated automatically after each session you log with notes.
                        </p>
                    </div>
                    {coachSettings && !coachSettings.isPro && (
                        <span className="inline-flex items-center gap-0.5 text-primary/70 pointer-events-none flex-shrink-0">
                            <Crown className="h-3 w-3" />
                            <span className="text-[10px] font-medium uppercase tracking-wider">Pro</span>
                        </span>
                    )}
                    <Switch
                        id="auto-summary-toggle"
                        checked={autoSummaryOn}
                        disabled={settingsLoading}
                        onCheckedChange={handleToggleAutoSummary}
                        aria-label="Auto-generate training summaries"
                    />
                </div>
            )}

            {/* The legacy Generate / Update button has been removed —
                auto-summary toggle is the single entry point. The "Refresh
                now" link below (when toggle ON + isGenerating/up-to-date)
                provides the manual fallback for the current week. */}

            {/* Auto-summary is ON: show a subtle "Refresh now" link as a manual fallback. */}
            {buttonState !== "hidden" && autoSummaryOn && (
                <div className="flex items-center justify-center min-h-[44px]">
                    {isGenerating ? (
                        <div className="flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin text-primary" />
                            <span className="text-note text-muted-foreground">Analyzing your sessions...</span>
                            <button
                                onClick={handleCancel}
                                className="ml-1 flex items-center gap-1 text-note font-medium text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-xs hover:bg-accent/30"
                            >
                                <X className="h-3 w-3" />
                                Cancel
                            </button>
                        </div>
                    ) : buttonState === "up_to_date" ? (
                        <span className="inline-flex items-center gap-1.5 text-note text-muted-foreground">
                            <CheckCircle className="h-3.5 w-3.5 text-func-recovery-green" />
                            Up to date
                        </span>
                    ) : (
                        <button
                            onClick={handleGenerateOrUpdate}
                            className="text-note font-medium text-primary hover:text-primary/80 transition-colors px-2 py-2 rounded-xs"
                        >
                            Refresh now
                        </button>
                    )}
                </div>
            )}

            {/* Summary display — header (collapse + delete) is shared */}
            {(isNewSummaryShape || isLegacySummaryShape) && summaryToDisplay && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between w-full">
                        <button onClick={() => setIsSummaryOpen(!isSummaryOpen)} className="flex items-center gap-2">
                            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground/70 transition-transform ${isSummaryOpen ? "" : "-rotate-90"}`} />
                            <span className="text-[13px] font-semibold text-foreground">Week Summary</span>
                        </button>
                        {selectedSummary && (
                            <button onClick={() => handleDeleteSummary(selectedSummary.id)}
                                className="h-8 w-8 flex items-center justify-center rounded-xs text-muted-foreground/30 active:text-destructive active:bg-destructive/10 transition-colors"
                                aria-label="Delete summary">
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>

                    {/* Legacy summaries — small chip + regenerate tap. We
                        intentionally don't render the old technique cards
                        anymore so the surface stays focused on retention. */}
                    {isSummaryOpen && isLegacySummaryShape && (
                        <div className="card-surface rounded-xs border border-border/60 px-4 py-3 flex items-center gap-3">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-muted/30 border border-border/50 text-[10px] uppercase tracking-wider font-bold text-muted-foreground flex-shrink-0">
                                Legacy summary
                            </span>
                            <p className="text-note text-muted-foreground flex-1 min-w-0">
                                Older format. Regenerate to switch to flashcards.
                            </p>
                            <button
                                onClick={handleGenerateOrUpdate}
                                disabled={isGenerating}
                                className="inline-flex items-center gap-1.5 text-note font-medium text-primary hover:text-primary/80 transition-colors px-2 py-2 rounded-xs min-h-[44px] disabled:opacity-50 flex-shrink-0"
                            >
                                <RotateCw className={`h-3.5 w-3.5 ${isGenerating ? "animate-spin" : ""}`} />
                                Regenerate
                            </button>
                        </div>
                    )}

                    {/* New shape — stats strip, headline, deck, due chip, timeline */}
                    {isSummaryOpen && isNewSummaryShape && newSummary && (
                        <div className="space-y-4">
                            {/* Stats strip */}
                            <div className="grid grid-cols-4 gap-3">
                                <StatCell label="Sessions" value={`${newSummary.stats.sessionsLogged}`} />
                                <StatCell label="Minutes" value={`${newSummary.stats.totalMinutes}`} />
                                <StatCell label="Top sport" value={newSummary.stats.topDiscipline || "—"} />
                                <StatCell
                                    label={newSummary.stats.avgRpe !== undefined ? "Avg RPE" : "Avg sleep"}
                                    value={
                                        newSummary.stats.avgRpe !== undefined
                                            ? newSummary.stats.avgRpe.toFixed(1)
                                            : newSummary.stats.avgSleepHours !== undefined
                                                ? `${newSummary.stats.avgSleepHours.toFixed(1)}h`
                                                : "—"
                                    }
                                />
                            </div>

                            {/* Week headline */}
                            {newSummary.weekHeadline && (
                                <p className="text-body-sm font-semibold leading-snug text-foreground">
                                    {(newSummary.weekHeadline || '').replace(/—/g, ' - ').replace(/–/g, '-')}
                                </p>
                            )}

                            {/* Flashcard deck — cards born in the selected week */}
                            {cardsForCurrentWeek.length > 0 ? (
                                <FlashcardDeck cards={cardsForCurrentWeek} readOnly={showPastWeek} />
                            ) : cardsForWeekRaw === undefined ? (
                                <div className="flex items-center justify-center min-h-[100px] text-note text-muted-foreground">
                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                                    Loading cards…
                                </div>
                            ) : null}

                            {/* Due today — opens a Sheet with a fresh deck */}
                            {dueCards.length > 0 && (
                                <button
                                    type="button"
                                    onClick={() => setIsDueSheetOpen(true)}
                                    className="w-full min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-full bg-primary/10 border border-primary/25 px-4 py-2 text-note font-bold text-primary hover:bg-primary/15 transition-colors"
                                >
                                    {dueCards.length} card{dueCards.length === 1 ? "" : "s"} due from earlier weeks
                                </button>
                            )}

                            {/* Weekly timeline — past-week chips */}
                            {summarisedWeeks.length > 0 && (
                                <div className="space-y-2">
                                    <p className="text-micro uppercase tracking-wider text-muted-foreground/70 font-bold">
                                        Past weeks
                                    </p>
                                    <WeeklyTimeline
                                        weeks={summarisedWeeks}
                                        currentWeek={selectedWeekStart}
                                        onSelectWeek={setSelectedWeekStart}
                                    />
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Due-today review queue — full FlashcardDeck inside a Sheet */}
            <Sheet open={isDueSheetOpen} onOpenChange={setIsDueSheetOpen}>
                <SheetContent side="bottom" className="rounded-t-3xl max-h-[92vh] overflow-y-auto">
                    <SheetHeader>
                        <SheetTitle>Due today</SheetTitle>
                    </SheetHeader>
                    <div className="mt-4">
                        {dueCards.length > 0 ? (
                            <FlashcardDeck cards={dueCards} />
                        ) : (
                            <p className="text-note text-muted-foreground text-center py-8">
                                Nothing left for today. Nice work.
                            </p>
                        )}
                    </div>
                </SheetContent>
            </Sheet>

        </div>
    );
}

// ─── Small inline stats cell — used by the new shape's stats strip ────────
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
