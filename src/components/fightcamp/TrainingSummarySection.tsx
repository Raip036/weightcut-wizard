import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { format, startOfWeek, endOfWeek } from "date-fns";
import { Brain, Loader2, ChevronDown, Trash2, CheckCircle, X, Dumbbell, Activity, Crown } from "lucide-react";
import { useConvex, useMutation, useQuery } from "convex/react";
import { useAIAction } from "@/hooks/useAIAction";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { useToast } from "@/hooks/use-toast";
import { useSubscription } from "@/hooks/useSubscription";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { logger } from "@/lib/logger";
import { localCache } from "@/lib/localCache";
import { getSessionColor } from "@/lib/sessionColors";
import { useAITask } from "@/contexts/AITaskContext";
import { AICompactOverlay } from "@/components/AICompactOverlay";

type TrainingSummary = {
    sportSections: {
        sport: string;
        sessions_count: number;
        techniques: { name: string; steps: string[]; sparringTip: string; drillFlow?: string[] }[];
    }[];
    weekOverview: string;
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

function mergeSummaries(existing: TrainingSummary, incoming: TrainingSummary): TrainingSummary {
    const merged = new Map<string, TrainingSummary["sportSections"][0]>();
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
    const { toast } = useToast();
    const { openPaywall, handlePaywallError } = useSubscription();
    const { hasAccess: hasAiAccess } = useFeatureAccess("AI_TRAINING_SUMMARY");
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
            if (!Array.isArray(summaryData.sportSections) || typeof summaryData.weekOverview !== "string") {
                throw new Error("AI returned malformed summary — please retry.");
            }

            const fingerprint = computeFingerprint(weekSessions);
            const allSessionIds = sessionsWithNotes.map(s => s.id);

            // Upsert via Convex — handler is idempotent on (userId, weekStart).
            const mergedData = selectedSummary
                ? mergeSummaries(selectedSummary.summary_data, summaryData)
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

    // Nothing to show if there's no summary for this week and no notes to summarise
    if (sessionsWithNotes.length === 0 && !selectedSummary) {
        return null;
    }

    const summaryToDisplay = selectedSummary?.summary_data ?? null;
    const summaryIsValid = !!(summaryToDisplay && Array.isArray((summaryToDisplay as any).sportSections) && typeof (summaryToDisplay as any).weekOverview === "string");

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

            {/* Generate / Update button — only for current calendar week */}
            {buttonState !== "hidden" && (
                <button
                    onClick={buttonState !== "up_to_date" ? handleGenerateOrUpdate : undefined}
                    disabled={isGenerating || buttonState === "up_to_date"}
                    className="relative w-full p-4 rounded-xs card-surface border border-border/50 flex items-center justify-center gap-2 hover:bg-accent/30 transition-all disabled:opacity-60"
                >
                    {isGenerating ? (
                        <div className="flex items-center gap-2 w-full justify-center">
                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                            <span className="text-sm font-semibold text-muted-foreground">
                                Analyzing your sessions...
                            </span>
                            <button
                                onClick={(e) => { e.stopPropagation(); handleCancel(); }}
                                className="ml-auto flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-xs hover:bg-accent/30"
                            >
                                <X className="h-3.5 w-3.5" />
                                Cancel
                            </button>
                        </div>
                    ) : buttonState === "up_to_date" ? (
                        <>
                            <CheckCircle className="h-5 w-5 text-func-recovery-green" />
                            <span className="text-sm font-semibold text-muted-foreground">Up to date</span>
                        </>
                    ) : (
                        <>
                            <span className="inline-flex items-center gap-2">
                                <Brain className="h-5 w-5 text-primary" />
                                <span className="text-sm font-semibold text-primary">
                                    {buttonState === "update" ? "Update Training Summary" : "Generate Training Summary"}
                                </span>
                            </span>
                            {!hasAiAccess && (
                                <span className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex items-center gap-0.5 text-primary/70 pointer-events-none">
                                    <Crown className="h-3 w-3" />
                                    <span className="text-[10px] font-medium uppercase tracking-wider">Pro</span>
                                </span>
                            )}
                        </>
                    )}
                </button>
            )}

            {/* Summary display */}
            {summaryIsValid && summaryToDisplay && (
                <div className="space-y-3">
                    <div className="flex items-center justify-between w-full">
                        <button onClick={() => setIsSummaryOpen(!isSummaryOpen)} className="flex items-center gap-2">
                            <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground/70 transition-transform ${isSummaryOpen ? "" : "-rotate-90"}`} />
                            <span className="text-[13px] font-semibold text-foreground">Week Summary</span>
                        </button>
                        {selectedSummary && (
                            <button onClick={() => handleDeleteSummary(selectedSummary.id)}
                                className="h-8 w-8 flex items-center justify-center rounded-xs text-muted-foreground/30 active:text-destructive active:bg-destructive/10 transition-colors">
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>

                    {isSummaryOpen && (
                        <div className="space-y-4">
                            {summaryToDisplay.weekOverview && (
                                <p className="text-[14px] text-foreground/95 leading-relaxed font-medium">
                                    {(summaryToDisplay.weekOverview || '').replace(/\u2014/g, ' - ').replace(/\u2013/g, '-')}
                                </p>
                            )}

                            {summaryToDisplay.sportSections?.map(section => {
                                const sportColor = getSessionColor(section.sport, customColors);
                                return (
                                <div
                                    key={section.sport}
                                    className="card-surface rounded-xs border border-border overflow-hidden"
                                    style={{ borderTop: `3px solid ${sportColor}` }}
                                >
                                    {/* Sport header */}
                                    <div className="flex items-center gap-2.5 px-3.5 py-3 bg-muted/20 border-b border-border/60">
                                        <div className="h-3.5 w-3.5 rounded-full flex-shrink-0 ring-2 ring-background" style={{ backgroundColor: sportColor }} />
                                        <span className="text-[15px] font-bold text-foreground tracking-tight">{section.sport}</span>
                                        <span className="text-[11px] font-semibold text-muted-foreground ml-auto tabular-nums uppercase tracking-wider">{section.sessions_count} session{section.sessions_count !== 1 ? "s" : ""}</span>
                                    </div>

                                    {/* Techniques — each visually separated by a full horizontal rule */}
                                    <div>
                                        {section.techniques?.map((tech, i) => (
                                            <div
                                                key={i}
                                                className={`px-3.5 py-3.5 ${i > 0 ? "border-t-2 border-border/50" : ""}`}
                                            >
                                                <p className="text-[14px] font-bold text-foreground mb-2.5">{tech.name}</p>

                                                {tech.steps && tech.steps.length > 0 && (
                                                    <div className="space-y-1.5 mb-3">
                                                        {tech.steps.map((step, j) => (
                                                            <div key={j} className="flex items-start gap-2.5">
                                                                <div className="h-5 w-5 rounded-full bg-muted/60 flex items-center justify-center flex-shrink-0 mt-0.5">
                                                                    <span className="text-[10px] font-bold text-foreground tabular-nums">{j + 1}</span>
                                                                </div>
                                                                <p className="text-[13px] text-foreground/95 leading-relaxed">{(step || '').replace(/\u2014/g, ' - ').replace(/\u2013/g, '-')}</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}

                                                {tech.sparringTip && (
                                                    <div className="rounded-xs bg-primary/15 border border-primary/25 px-3 py-2.5">
                                                        <p className="text-[13px] text-foreground leading-relaxed">
                                                            <span className="font-bold text-primary uppercase text-[10px] tracking-wider block mb-0.5">Sparring tip</span>
                                                            {(tech.sparringTip || '').replace(/\u2014/g, ' - ').replace(/\u2013/g, '-')}
                                                        </p>
                                                    </div>
                                                )}

                                                {tech.drillFlow && tech.drillFlow.length > 0 && (
                                                    <div className="flex items-center gap-1 flex-wrap mt-3">
                                                        {tech.drillFlow.map((step, k) => (
                                                            <div key={k} className="flex items-center gap-1">
                                                                {k > 0 && <span className="text-muted-foreground/60 text-[11px] font-bold">→</span>}
                                                                <span className="text-[12px] font-medium text-foreground bg-muted/50 border border-border/40 rounded-xs px-2 py-0.5">{step}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
