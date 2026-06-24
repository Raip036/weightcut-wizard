import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, subDays } from "date-fns";
import { useQuery } from "convex/react";
import { motion, useReducedMotion } from "motion/react";
import { api } from "@/../convex/_generated/api";
import { useUser } from "@/contexts/UserContext";
import { RecoveryDashboard } from "@/components/fightcamp/RecoveryDashboard";
import { WizardCharacter } from "@/tutorial/WizardCharacter";
import { WizardAuroraBackground } from "@/components/onboarding/WizardAuroraBackground";
import { localCache } from "@/lib/localCache";
import { Skeleton } from "@/components/ui/skeleton-loader";
import { Card } from "@/components/ui/card";
import { triggerHapticSelection } from "@/lib/haptics";
import { Icon } from "@/components/ui/Icon";

// Local row shape — snake_case shape consumed by RecoveryDashboard / performanceEngine.
interface TrainingCalendarRow {
    id: string;
    user_id: string;
    date: string;
    session_type: string;
    /** Optional activity tag (Sparring, Drilling, Run…). Drives load + contact. */
    session_tag: string | null;
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
    const prefersReduced = useReducedMotion();
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
            session_tag: r.sessionTag ?? null,
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
            <div className="animate-page-in relative flex min-h-[82vh] flex-col overflow-hidden px-5 py-3 sm:p-6 max-w-2xl mx-auto pb-16 md:pb-6">
                {/* Animated blue aurora — ambient hero atmosphere, glow centered behind the wizard. */}
                <WizardAuroraBackground intensity="full" radialGlow />

                <motion.div
                    initial={prefersReduced ? false : { opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: "spring", damping: 22, stiffness: 260 }}
                    className="relative flex flex-1 flex-col items-center justify-center text-center"
                >
                    {/* Wizard hero — large, centered, gently floating. */}
                    <motion.div
                        className="relative"
                        style={{ width: 132, height: 132 }}
                        animate={prefersReduced ? undefined : { y: [0, -7, 0] }}
                        transition={prefersReduced ? undefined : { duration: 4.5, repeat: Infinity, ease: "easeInOut" }}
                    >
                        <div style={{ width: 140, height: 140, transform: "scale(0.94)", transformOrigin: "top left" }}>
                            <WizardCharacter pose="wave" />
                        </div>
                    </motion.div>

                    <p className="mt-3 text-[11px] font-bold uppercase tracking-[0.18em] text-primary">
                        Coach
                    </p>
                    <h2 className="mt-1.5 max-w-[15ch] text-[27px] font-bold leading-[1.08] text-foreground">
                        Let's measure your recovery.
                    </h2>
                    <p className="mt-3 max-w-[34ch] text-[13px] leading-snug text-muted-foreground">
                        Log a session or do a check-in. Your readiness, strain, and weekly load build from there.
                    </p>

                    {/* Three equal, horizontal action tiles. */}
                    <div className="mt-8 grid w-full max-w-md grid-cols-3 gap-2.5">
                        <button
                            onClick={() => { triggerHapticSelection(); navigate("/recovery/check-in"); }}
                            className="flex flex-col items-center justify-center gap-2 rounded-2xl bg-primary px-2 py-4 font-bold text-primary-foreground shadow-[0_10px_30px_-10px_hsl(var(--primary)/0.7)] active:scale-[0.97] transition"
                        >
                            <Icon name="sparklesOutline" size={22} />
                            <span className="text-[12px] leading-tight">Daily check-in</span>
                        </button>
                        <button
                            onClick={() => { triggerHapticSelection(); navigate("/training-calendar"); }}
                            className="glass-card flex flex-col items-center justify-center gap-2 rounded-2xl border border-border/50 px-2 py-4 font-semibold text-foreground active:scale-[0.97] transition"
                        >
                            <Icon name="pulseOutline" size={22} className="text-primary" />
                            <span className="text-[12px] leading-tight">Log a session</span>
                        </button>
                        <button
                            onClick={() => { triggerHapticSelection(); navigate("/sleep"); }}
                            className="glass-card flex flex-col items-center justify-center gap-2 rounded-2xl border border-border/50 px-2 py-4 font-semibold text-foreground active:scale-[0.97] transition"
                        >
                            <Icon name="heartOutline" size={22} className="text-func-danger-red" />
                            <span className="text-[12px] leading-tight">Log sleep</span>
                        </button>
                    </div>
                </motion.div>
            </div>
        );
    }

    return (
        <div className="animate-page-in space-y-3 px-5 py-3 sm:p-5 md:p-6 max-w-7xl mx-auto pb-16 md:pb-6">
            <motion.header
                className="pt-1 flex items-end justify-between gap-3"
                initial={prefersReduced ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", damping: 24, stiffness: 280 }}
            >
                <div className="min-w-0">
                    <p className="text-micro uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">Your</p>
                    <h1 className="text-title font-semibold leading-tight">Wellness</h1>
                </div>
            </motion.header>
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
