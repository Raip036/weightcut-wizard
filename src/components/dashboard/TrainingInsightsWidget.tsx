import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { format, subDays } from "date-fns";
import { Icon } from "@/components/ui/Icon";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { convex } from "@/integrations/convex/client";
import { AIPersistence } from "@/lib/aiPersistence";
import { triggerHapticSelection } from "@/lib/haptics";
import { useSubscription } from "@/hooks/useSubscription";
import { getSessionColor, getUserColors } from "@/lib/sessionColors";
import { logger } from "@/lib/logger";

interface TrainingInsightsWidgetProps {
  userId: string;
}

interface SessionRow {
  id: string;
  date: string;
  session_type: string;
  notes: string | null;
  rpe: number | null;
  intensity: string | null;
  duration_minutes: number | null;
}

interface DisciplineInsight {
  session_type: string;
  last_logged: string;
  /** Coach's read on the latest session. Not a recap. */
  interpretation: string;
  /** Specific drill / partner setup / cue to bring into the next session. */
  training_application: string;
  /** Three compounding steps for the very next session. */
  pathway: string[];
  // Legacy fields kept for backwards-compatibility with old cached entries
  // in localStorage. The action's defensive shape repair maps these into
  // the new fields on the server side, but if a user has a stale cache
  // we still want to render something rather than nothing.
  what_you_did?: string;
  next_focus?: string;
}

interface CachedInsight {
  fingerprint: string;
  insight: DisciplineInsight;
}

interface TrainingSummaryTechnique {
  name: string;
  steps: string[];
  sparringTip: string;
  drillFlow?: string[];
}

interface TrainingSummarySportSection {
  sport: string;
  sessions_count: number;
  techniques: TrainingSummaryTechnique[];
}

interface TrainingSummary {
  sportSections: TrainingSummarySportSection[];
  weekOverview: string;
}

const MAX_DISCIPLINES = 8;
const SESSIONS_PER_DISCIPLINE = 3;
const LOOKBACK_DAYS = 60;
const CACHE_TTL_HOURS = 24 * 30; // fingerprint is the real cache key — TTL is GC only

// `v2` suffix bumps the cache namespace when the insight schema changes.
// Old `training_insight_<type>` entries from the v1 schema (what_you_did /
// next_focus only) are ignored so we never render stale, fieldless cards.
const CACHE_VERSION = "v2";
function cacheKey(sessionType: string): string {
  return `training_insight_${CACHE_VERSION}_${sessionType.toLowerCase().replace(/\s+/g, "_")}`;
}

async function fetchRecentSessions(_userId: string): Promise<SessionRow[]> {
  const since = format(subDays(new Date(), LOOKBACK_DAYS), "yyyy-MM-dd");
  const rows = (await convex.query(api.fight_camp.listCalendar, { from: since })) ?? [];
  return (rows as any[])
    .filter((r) => r.sessionType !== "Rest" && typeof r.notes === "string" && r.notes.trim().length > 0)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 120)
    .map((r) => ({
      id: r._id,
      date: r.date,
      session_type: r.sessionType,
      notes: r.notes,
      rpe: r.rpe ?? null,
      intensity: r.intensity ?? null,
      duration_minutes: r.durationMinutes ?? null,
    }));
}

function groupByDiscipline(rows: SessionRow[]): Map<string, SessionRow[]> {
  const map = new Map<string, SessionRow[]>();
  for (const row of rows) {
    const key = row.session_type;
    if (!key) continue;
    const arr = map.get(key) ?? [];
    if (arr.length < SESSIONS_PER_DISCIPLINE) {
      arr.push(row);
      map.set(key, arr);
    }
  }
  // Cap to MAX_DISCIPLINES, ordered by most-recent latest session
  return new Map(
    Array.from(map.entries())
      .sort((a, b) => (a[1][0].date < b[1][0].date ? 1 : -1))
      .slice(0, MAX_DISCIPLINES)
  );
}

async function callTrainingInsights(
  sessionType: string,
  sessions: SessionRow[]
): Promise<{ insight?: DisciplineInsight; status: number }> {
  try {
    const latest = sessions[0];
    const body = await convex.action(api.actions.trainingInsights.run, {
      session_type: sessionType,
      fingerprint: latest?.id ?? "",
      session_id: latest?.id ?? null,
      session_date: latest?.date ?? null,
      sessions: sessions.map((s) => ({
        date: s.date,
        notes: s.notes,
        rpe: s.rpe,
        intensity: s.intensity,
        duration_minutes: s.duration_minutes,
      })),
    } as any);
    const insight = (body as any)?.insight as DisciplineInsight | undefined;
    return { insight, status: 200 };
  } catch (err: any) {
    const msg = String(err?.message ?? "");
    if (msg.toLowerCase().includes("premium") || msg.toLowerCase().includes("upgrade")) {
      return { status: 403 };
    }
    return { status: 500 };
  }
}

// Read every cached insight for this user from localStorage, oldest first.
// We don't know the discipline keys ahead of time so we sweep the standard
// AIPersistence prefix — cheap because the data is tiny and there are at
// most MAX_DISCIPLINES keys.
function loadAllCachedInsights(userId: string): DisciplineInsight[] {
  if (!userId) return [];
  const out: DisciplineInsight[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key) continue;
      // AIPersistence key format includes the userId and the cacheKey we set.
      if (!key.includes(userId) || !key.includes(`training_insight_${CACHE_VERSION}_`)) continue;
      const match = key.match(
        new RegExp(`training_insight_${CACHE_VERSION}_([a-z0-9_]+)`, "i"),
      );
      const sessionType = match?.[1];
      if (!sessionType) continue;
      const cached = AIPersistence.load(
        userId,
        `training_insight_${CACHE_VERSION}_${sessionType}`,
      ) as CachedInsight | null;
      if (cached?.insight) out.push(cached.insight);
    }
  } catch {
    // localStorage unavailable / quota — degrade silently
  }
  return out;
}

export const TrainingInsightsWidget = memo(function TrainingInsightsWidget({
  userId,
}: TrainingInsightsWidgetProps) {
  const { isPremium, openPaywall } = useSubscription();
  const [open, setOpen] = useState(false);
  // Pre-flight check: hide the widget entirely when there's no recent
  // training data to coach on. Mirrors the empty-render guard applied to
  // other dashboard widgets so cold-start users don't see a placeholder
  // card with nothing to say.
  const recentSince = useMemo(
    () => format(subDays(new Date(), LOOKBACK_DAYS), "yyyy-MM-dd"),
    [],
  );
  const recentCalendar = useQuery(
    api.fight_camp.listCalendar,
    userId ? { from: recentSince } : "skip",
  );
  const hasRecentSessions = useMemo(() => {
    if (recentCalendar == null) return null;
    return (recentCalendar as any[]).some(
      (r) => r.sessionType !== "Rest" && typeof r.notes === "string" && r.notes.trim().length > 0,
    );
  }, [recentCalendar]);
  // `coldLoading` blocks the UI on first render only — once we have any
  // cached or fetched insight, it flips false and stays false. Background
  // revalidation flips `refreshing` (a quiet "Refreshing…" hint), never
  // the blocking spinner.
  const [coldLoading, setColdLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [insights, setInsights] = useState<DisciplineInsight[]>([]);
  const [emptyState, setEmptyState] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const userColors = useMemo(() => (userId ? getUserColors(userId) : {}), [userId, open]);

  const summariesRaw = useQuery(
    api.fight_camp.listAllSummaries,
    open && userId ? { limit: 1 } : "skip"
  );
  const latestSummary = summariesRaw?.[0];
  const summaryData = latestSummary?.summaryData as TrainingSummary | undefined;
  const summaryWeekStart = latestSummary?.weekStart as string | undefined;
  // Defensive: only treat as valid if the rich shape is intact
  const hasSummary = !!(
    summaryData &&
    typeof summaryData.weekOverview === "string" &&
    Array.isArray(summaryData.sportSections)
  );

  const handleCardPress = useCallback(() => {
    triggerHapticSelection();
    if (!isPremium) {
      openPaywall();
      return;
    }
    setOpen(true);
  }, [isPremium, openPaywall]);

  useEffect(() => {
    if (!open || !userId) return;
    let cancelled = false;
    setErrorMsg(null);

    // Step 0 — paint every cached insight INSTANTLY, with no spinner. If the
    // user has anything cached we never block the UI. The fingerprint check
    // happens later, in the background, against the live training data.
    const cachedSnapshot = loadAllCachedInsights(userId);
    const hasCache = cachedSnapshot.length > 0;
    if (hasCache) {
      setInsights(cachedSnapshot);
      setColdLoading(false);
    } else {
      setColdLoading(true);
    }

    const run = async () => {
      setEmptyState(false);
      setRefreshing(hasCache);

      try {
        const rows = await fetchRecentSessions(userId);
        if (rows.length === 0) {
          if (!cancelled && !hasCache) {
            setInsights([]);
            setEmptyState(true);
          }
          return;
        }

        const grouped = groupByDiscipline(rows);
        if (grouped.size === 0) {
          if (!cancelled && !hasCache) {
            setInsights([]);
            setEmptyState(true);
          }
          return;
        }

        // Stale-while-revalidate: re-evaluate fingerprints. Disciplines whose
        // fingerprint matches the cache are skipped entirely (zero LLM cost).
        const initial: DisciplineInsight[] = [];
        const toFetch: Array<{ sessionType: string; sessions: SessionRow[]; fingerprint: string }> = [];

        for (const [sessionType, sessions] of grouped.entries()) {
          const fingerprint = sessions[0].id;
          const cached = AIPersistence.load(userId, cacheKey(sessionType)) as
            | CachedInsight
            | null;
          if (cached && cached.fingerprint === fingerprint && cached.insight) {
            initial.push(cached.insight);
          } else {
            if (cached?.insight) initial.push(cached.insight);
            toFetch.push({ sessionType, sessions, fingerprint });
          }
        }

        if (!cancelled && initial.length > 0) {
          setInsights(initial);
          setColdLoading(false);
        }

        if (toFetch.length === 0) {
          if (!cancelled) setRefreshing(false);
          return;
        }

        const results = await Promise.all(
          toFetch.map(async ({ sessionType, sessions, fingerprint }) => {
            const { insight, status } = await callTrainingInsights(sessionType, sessions);
            if (status === 403) {
              return { sessionType, premiumRequired: true as const };
            }
            if (insight) {
              AIPersistence.save(
                userId,
                cacheKey(sessionType),
                { fingerprint, insight } satisfies CachedInsight,
                CACHE_TTL_HOURS
              );
              return { sessionType, insight };
            }
            return { sessionType, error: status };
          })
        );

        if (cancelled) return;

        if (results.some((r) => "premiumRequired" in r && r.premiumRequired)) {
          setOpen(false);
          openPaywall();
          return;
        }

        setInsights((prev) => {
          const map = new Map<string, DisciplineInsight>();
          for (const ins of prev) map.set(ins.session_type, ins);
          for (const r of results) {
            if ("insight" in r && r.insight) {
              map.set(r.sessionType, r.insight);
            }
          }
          return Array.from(grouped.keys())
            .map((k) => map.get(k))
            .filter((v): v is DisciplineInsight => !!v);
        });

        const fetchedCount = results.filter((r) => "insight" in r && r.insight).length;
        const failedCount = results.length - fetchedCount;

        // Only surface an error if we have NOTHING to render (no cache, no
        // fresh fetch). When cached insights are visible we keep the UI
        // calm — the user already has something useful on screen.
        if (failedCount > 0 && initial.length === 0 && !hasCache) {
          setErrorMsg("Couldn't generate insights. Try again later.");
        }
      } catch (err) {
        if (!cancelled) {
          logger.debug("training-insights load failed", { err: String((err as Error)?.message ?? err) });
          // Only show the user a hard-failure card if we genuinely have
          // nothing cached — otherwise their existing data stays put and
          // we silently retry next time the sheet opens.
          if (!hasCache) {
            setErrorMsg("Couldn't load training insights.");
          }
        }
      } finally {
        if (!cancelled) {
          setColdLoading(false);
          setRefreshing(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [open, userId, openPaywall]);

  const headline = useMemo(() => {
    if (insights.length === 0) return null;
    const types = insights.map((i) => i.session_type);
    if (types.length === 1) return `Latest ${types[0]} session reviewed`;
    if (types.length === 2) return `${types[0]} & ${types[1]} reviewed`;
    return `${types.length} disciplines reviewed`;
  }, [insights]);

  if (hasRecentSessions === false) return null;

  return (
    <>
      <button
        onClick={handleCardPress}
        className="w-full text-left card-surface rounded-xs border border-border p-3.5 flex items-center gap-3 active:scale-[0.99] transition-all"
      >
        <div
          className={`h-9 w-9 rounded-xs flex items-center justify-center shrink-0 ${
            isPremium ? "bg-primary/15" : "bg-muted/40"
          }`}
        >
          {isPremium ? (
            <Icon name="barbellOutline" size={16} className="text-primary" />
          ) : (
            <Icon name="lockClosedOutline" size={16} className="text-muted-foreground" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <p className="text-[12px] font-semibold">Training Coach</p>
            {!isPremium && (
              <span className="text-[10px] uppercase tracking-wide text-primary font-semibold">
                Pro
              </span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">
            {isPremium
              ? "Things to work on, drilled from your last sessions"
              : "Upgrade to see things to work on after each session"}
          </p>
        </div>
        <Icon name="chevronForwardOutline" size={14} className="text-muted-foreground shrink-0" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="h-[85vh] rounded-t-xl border-0 bg-card/95 backdrop-blur-xl overflow-y-auto p-0"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" }}
        >
          <div className="px-4 pt-4 pb-2">
            <SheetHeader>
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-xs bg-primary/15 flex items-center justify-center">
                  <Icon name="bulbOutline" size={16} className="text-primary" />
                </div>
                <div>
                  <SheetTitle className="text-[13px] font-semibold">
                    Training Coach
                  </SheetTitle>
                  <p className="text-[11px] text-muted-foreground">
                    {format(new Date(), "EEEE, MMM d")}
                  </p>
                </div>
              </div>
            </SheetHeader>
          </div>

          <VisuallyHidden>
            <p>Drilled coaching insights from your most recent training sessions, grouped by discipline.</p>
          </VisuallyHidden>
          <div className="px-4 space-y-3">
            {hasSummary && summaryData && (
              <div className="space-y-3">
                <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground">
                  {(() => {
                    try {
                      return `Week of ${format(new Date(summaryWeekStart as string), "MMM d")}`;
                    } catch {
                      return `Week of ${summaryWeekStart ?? ""}`;
                    }
                  })()}
                </p>
                <p className="text-[14px] text-foreground/95 leading-relaxed">
                  {summaryData.weekOverview}
                </p>
                {summaryData.sportSections.map((section, idx) => {
                  const sportColor = getSessionColor(section.sport, userColors);
                  return (
                    <div
                      key={`${section.sport}-${idx}`}
                      className="card-surface rounded-xs border border-border overflow-hidden"
                      style={{ borderTop: `3px solid ${sportColor}` }}
                    >
                      <div className="flex items-center gap-2.5 px-3.5 py-3 bg-muted/20 border-b border-border/60">
                        <div
                          className="h-3.5 w-3.5 rounded-full flex-shrink-0 ring-2 ring-background"
                          style={{ backgroundColor: sportColor }}
                        />
                        <span className="text-[15px] font-bold text-foreground tracking-tight">
                          {section.sport}
                        </span>
                        <span className="text-[11px] font-semibold text-muted-foreground ml-auto tabular-nums uppercase tracking-wider">
                          {section.sessions_count} session{section.sessions_count !== 1 ? "s" : ""}
                        </span>
                      </div>
                      <div>
                        {section.techniques?.map((tech, i) => (
                          <div
                            key={i}
                            className={`px-3.5 py-3.5 ${i > 0 ? "border-t-2 border-border/50" : ""}`}
                          >
                            <p className="text-[14px] font-bold text-foreground mb-2.5">
                              {tech.name}
                            </p>
                            {tech.steps?.length > 0 && (
                              <div className="space-y-1.5 mb-3">
                                {tech.steps.map((step, j) => (
                                  <div key={j} className="flex items-start gap-2.5">
                                    <div className="h-5 w-5 rounded-full bg-muted/60 flex items-center justify-center flex-shrink-0 mt-0.5">
                                      <span className="text-[10px] font-bold text-foreground tabular-nums">
                                        {j + 1}
                                      </span>
                                    </div>
                                    <p className="text-[13px] text-foreground/95 leading-relaxed">
                                      {step}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}
                            {tech.sparringTip && (
                              <div className="rounded-xs bg-primary/15 border border-primary/25 px-3 py-2.5">
                                <p className="text-[13px] text-foreground leading-relaxed">
                                  <span className="font-bold text-primary uppercase text-[10px] tracking-wider block mb-0.5">
                                    Sparring tip
                                  </span>
                                  {tech.sparringTip}
                                </p>
                              </div>
                            )}
                            {tech.drillFlow && tech.drillFlow.length > 0 && (
                              <div className="flex items-center gap-1 flex-wrap mt-3">
                                {tech.drillFlow.map((step, k) => (
                                  <div key={k} className="flex items-center gap-1">
                                    {k > 0 && (
                                      <span className="text-muted-foreground/60 text-[11px] font-bold">
                                        →
                                      </span>
                                    )}
                                    <span className="text-[12px] font-medium text-foreground bg-muted/50 border border-border/40 rounded-xs px-2 py-0.5">
                                      {step}
                                    </span>
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

            {hasSummary && (insights.length > 0 || coldLoading || emptyState || errorMsg) && (
              <div className="border-t border-border/50 my-2" />
            )}

            {headline && !coldLoading && (
              <p className="display-number text-base text-foreground">{headline}</p>
            )}

            {coldLoading && insights.length === 0 && (
              <div className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="card-surface rounded-xs border border-border p-3 space-y-2"
                  >
                    <div className="h-2.5 rounded shimmer-skeleton w-1/3" />
                    <div className="h-2.5 rounded shimmer-skeleton w-full" />
                    <div className="h-2.5 rounded shimmer-skeleton w-4/5" />
                  </div>
                ))}
              </div>
            )}

            {!coldLoading && emptyState && (
              <div className="card-surface rounded-xs border border-border p-4 text-center">
                <p className="text-[13px] text-muted-foreground">
                  Log a session with notes to get coaching insights.
                </p>
              </div>
            )}

            {!coldLoading && !emptyState && errorMsg && insights.length === 0 && (
              <div className="card-surface rounded-xs border border-border p-4 text-center">
                <p className="text-[13px] text-muted-foreground">{errorMsg}</p>
              </div>
            )}

            {(() => {
              // Defensive dedup: collapse cards that share a normalized
              // discipline key, keeping the most recent. Prevents stale
              // localStorage entries with casing or whitespace drift from
              // ever rendering twice (e.g. "Muay Thai" and "muay thai").
              const byKey = new Map<string, DisciplineInsight>();
              for (const ins of insights) {
                const key = ins.session_type.trim().toLowerCase().replace(/\s+/g, " ");
                const existing = byKey.get(key);
                if (!existing || (ins.last_logged ?? "") > (existing.last_logged ?? "")) {
                  byKey.set(key, ins);
                }
              }
              return Array.from(byKey.values());
            })().map((insight) => {
              const color = getSessionColor(insight.session_type, userColors);
              const interpretation =
                insight.interpretation || insight.what_you_did || "";
              const application =
                insight.training_application || insight.next_focus || "";
              const pathway = Array.isArray(insight.pathway)
                ? insight.pathway.filter((s) => typeof s === "string" && s.trim())
                : [];
              return (
                <div
                  key={insight.session_type}
                  className="card-surface rounded-xs border border-border p-3 space-y-2.5 relative overflow-hidden"
                  style={{ borderLeft: `3px solid ${color}` }}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide" style={{ color }}>
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: color }}
                        aria-hidden
                      />
                      {insight.session_type}
                    </span>
                    {insight.last_logged && (
                      <span className="text-[11px] text-muted-foreground">
                        {(() => {
                          try {
                            return format(new Date(insight.last_logged), "MMM d");
                          } catch {
                            return insight.last_logged;
                          }
                        })()}
                      </span>
                    )}
                  </div>

                  {interpretation && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1">
                        Coach's read
                      </p>
                      <p className="text-[13px] text-foreground/90 leading-snug">
                        {interpretation}
                      </p>
                    </div>
                  )}

                  {application && (
                    <div
                      className="rounded-xs p-2.5"
                      style={{
                        backgroundColor: `${color}10`,
                        border: `1px solid ${color}33`,
                      }}
                    >
                      <p
                        className="text-[10px] uppercase tracking-wide font-semibold mb-1"
                        style={{ color }}
                      >
                        Apply next session
                      </p>
                      <p className="text-[13px] text-foreground leading-snug">
                        {application}
                      </p>
                    </div>
                  )}

                  {pathway.length > 0 && (
                    <div>
                      <p className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground mb-1.5">
                        Improvement pathway
                      </p>
                      <ol className="space-y-1.5">
                        {pathway.map((step, i) => (
                          <li key={i} className="flex items-start gap-2">
                            <span
                              className="h-5 w-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 text-[10px] font-bold tabular-nums"
                              style={{
                                backgroundColor: `${color}20`,
                                color,
                              }}
                            >
                              {i + 1}
                            </span>
                            <span className="text-[13px] text-foreground/90 leading-snug">
                              {step}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              );
            })}

            {refreshing && insights.length > 0 && (
              <p className="text-[11px] text-muted-foreground text-center pt-1">
                Refreshing latest discipline…
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
});
