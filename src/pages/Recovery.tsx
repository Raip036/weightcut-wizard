import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, subDays } from "date-fns";
import { useQuery } from "convex/react";
import { motion } from "motion/react";
import { Activity, Heart } from "lucide-react";
import { api } from "@/../convex/_generated/api";
import { useUser } from "@/contexts/UserContext";
import { RecoveryDashboard } from "@/components/fightcamp/RecoveryDashboard";
import { WizardCharacter } from "@/tutorial/WizardCharacter";
import { localCache } from "@/lib/localCache";
import { Skeleton } from "@/components/ui/skeleton-loader";
import { Card } from "@/components/ui/card";
import { triggerHapticSelection } from "@/lib/haptics";
import { HealthTilesPanel } from "@/components/health/HealthTilesPanel";
import { MorningCheckInPrompt } from "@/components/health/MorningCheckInPrompt";

// Local row shape — snake_case shape consumed by RecoveryDashboard / performanceEngine.
interface TrainingCalendarRow {
    id: string;
    user_id: string;
    date: string;
    session_type: string;
    duration_minutes: number;
    rpe: number;
    intensity: string;
    intensity_level: number | null;
    bodyweight: number | null;
    fatigue_level: number | null;
    soreness_level: number | null;
    sleep_hours: number | null;
    sleep_quality: string | null;
    mobility_done: boolean | null;
    notes: string | null;
    media_url: string | null;
    created_at: string | null;
}

export default function Recovery() {
    const navigate = useNavigate();
    const { userId, profile } = useUser();
    const from = useMemo(() => format(subDays(new Date(), 28), "yyyy-MM-dd"), []);
    const to = useMemo(() => format(new Date(), "yyyy-MM-dd"), []);

    // Live-reactive Convex subscription.
    const rawSessions = useQuery(api.fight_camp.listCalendar, userId ? { from, to } : "skip");

    const sessions28d = useMemo<TrainingCalendarRow[]>(() => {
        if (!rawSessions) return [];
        return rawSessions.map((r: any) => ({
            id: r._id,
            user_id: r.userId,
            date: r.date,
            session_type: r.sessionType,
            duration_minutes: r.durationMinutes,
            rpe: r.rpe,
            intensity: r.intensity,
            intensity_level: r.intensityLevel ?? null,
            bodyweight: r.bodyweight ?? null,
            fatigue_level: r.fatigueLevel ?? null,
            soreness_level: r.sorenessLevel ?? null,
            sleep_hours: r.sleepHours ?? null,
            sleep_quality: r.sleepQuality ?? null,
            mobility_done: r.mobilityDone ?? null,
            notes: r.notes ?? null,
            media_url: r.mediaUrl ?? null,
            created_at: r._creationTime ? new Date(r._creationTime).toISOString() : null,
        }));
    }, [rawSessions]);

    // Cache the mapped result so a remount has instant first-paint while Convex
    // re-subscribes. Mirrors the pattern in TrainingCalendar.tsx.
    const [cachedSessions, setCachedSessions] = useState<TrainingCalendarRow[]>(() => {
        if (!userId) return [];
        return localCache.get<TrainingCalendarRow[]>(userId, "recovery_sessions_28d", 24 * 60 * 60 * 1000) || [];
    });
    useEffect(() => {
        if (rawSessions && userId) {
            localCache.set(userId, "recovery_sessions_28d", sessions28d);
            setCachedSessions(sessions28d);
        }
    }, [rawSessions, sessions28d, userId]);

    const athleteProfile = useMemo(() => profile ? {
        trainingFrequency: profile.training_frequency ?? null,
        activityLevel: profile.activity_level ?? null,
        sex: profile.sex ?? null,
        age: profile.age ?? null,
    } : undefined, [profile?.training_frequency, profile?.activity_level, profile?.sex, profile?.age]);

    // Loading: Convex result not yet hydrated AND no cache to fall back on.
    const isLoading = rawSessions === undefined && cachedSessions.length === 0;
    const display = rawSessions ? sessions28d : cachedSessions;

    // Apple Health tier — drives whether we surface the tiles panel or the
    // self-report morning check-in banner. Hand-off contract: Agent B's
    // `api.health.getTier` returns `{ tier, grantedMetrics, lastSyncAt,
    // connectedAt }`. Treated as any until codegen runs.
    const tierInfo = useQuery(
        (api as any).health?.getTier,
        userId ? {} : "skip",
    ) as { tier?: "tier_0" | "tier_1" | "tier_2" } | undefined;
    const healthTier = tierInfo?.tier ?? "tier_0";
    const showHealthTiles = healthTier !== "tier_0";

    if (isLoading) {
        return (
            <div className="space-y-3 px-5 py-3 sm:p-5 md:p-6 max-w-7xl mx-auto pb-16 md:pb-6">
                <Card className="p-6 rounded-xs card-surface">
                    <Skeleton className="h-6 w-40 mb-4" />
                    <Skeleton className="h-48 w-full rounded-xs" />
                </Card>
            </div>
        );
    }

    if (display.length === 0) {
        return (
            <div className="animate-page-in space-y-3 px-5 py-3 sm:p-5 md:p-6 max-w-7xl mx-auto pb-16 md:pb-6">
                {userId && (
                    showHealthTiles
                        ? <HealthTilesPanel />
                        : <MorningCheckInPrompt userId={userId} />
                )}
                <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, ease: "easeOut" }}
                    className="relative overflow-hidden rounded-xs border border-border/50 bg-card/60 p-5"
                >
                    <div className="flex items-start gap-3 mb-4">
                        <div className="relative shrink-0" style={{ width: 72, height: 72 }}>
                            <div style={{ width: 140, height: 140, transform: "scale(0.51)", transformOrigin: "top left" }}>
                                <WizardCharacter pose="wave" />
                            </div>
                        </div>
                        <div className="min-w-0 flex-1 pt-1.5">
                            <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80">
                                Coach
                            </p>
                            <h4 className="mt-0.5 text-[19px] font-bold leading-tight">
                                Let's measure your recovery.
                            </h4>
                            <p className="mt-1 text-[12px] text-muted-foreground leading-snug">
                                Log a session or do a check-in. Your readiness, strain, and weekly load build from there.
                            </p>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={() => { triggerHapticSelection(); navigate("/training-calendar"); }}
                            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3.5 py-2 text-[12px] font-bold text-primary-foreground shadow-md shadow-primary/30 active:scale-[0.97] transition"
                        >
                            <Activity className="h-3.5 w-3.5" strokeWidth={2.5} />
                            Log a session
                        </button>
                        <button
                            onClick={() => { triggerHapticSelection(); navigate("/sleep"); }}
                            className="inline-flex items-center gap-1.5 rounded-full bg-muted/40 border border-border/40 px-3.5 py-2 text-[12px] font-semibold text-foreground hover:bg-muted/60 active:scale-[0.97] transition"
                        >
                            <Heart className="h-3.5 w-3.5 text-rose-400" strokeWidth={2.5} />
                            Log sleep
                        </button>
                    </div>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="animate-page-in space-y-3 px-5 py-3 sm:p-5 md:p-6 max-w-7xl mx-auto pb-16 md:pb-6">
            <header className="pt-1">
              <p className="text-micro uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">Your</p>
              <h1 className="text-title font-semibold leading-tight">Wellness</h1>
            </header>
            {userId && (
                showHealthTiles
                    ? <HealthTilesPanel />
                    : <MorningCheckInPrompt userId={userId} />
            )}
            {userId && (
                <RecoveryDashboard
                    sessions28d={display as any}
                    userId={userId}
                    athleteProfile={athleteProfile}
                    tdee={profile?.tdee ?? null}
                />
            )}
        </div>
    );
}
