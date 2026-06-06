import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, subMonths, addMonths, subDays, startOfWeek, isToday as isDateToday, isYesterday as isDateYesterday, getISOWeek } from "date-fns";
import { ChevronLeft, ChevronRight, Plus, BookOpen, Images, CalendarDays } from "lucide-react";
import { motion } from "motion/react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger, SheetHeader } from "@/components/ui/sheet";
import { useKeyboardAware } from "@/hooks/useKeyboardAware";
import { WizardCharacter } from "@/tutorial/WizardCharacter";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { localCache } from "@/lib/localCache";
import { useUser } from "@/contexts/UserContext";
import { useToast } from "@/hooks/use-toast";
import { useSafeAsync } from "@/hooks/useSafeAsync";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Icon } from "@/components/ui/Icon";

import { TrainingSummarySection } from "@/components/fightcamp/TrainingSummarySection";
import { CalendarMonthGrid } from "@/components/fightcamp/CalendarMonthGrid";
import { SessionCard } from "@/components/fightcamp/SessionCard";
import { SessionDetailDrawer } from "@/components/fightcamp/SessionDetailDrawer";
import { FightCampLogForm } from "@/components/fightcamp/FightCampLogForm";
import {
  MARTIAL_ARTS,
  isContactSession,
} from "@/lib/sessionTypes";
import { uploadSessionMediaV2 } from "@/lib/uploadSessionMediaV2";
import type { PendingSessionMedia } from "@/components/fightcamp/FightCampLogForm";
import { triggerHapticSelection, confirmDelete } from "@/lib/haptics";
import { ShareButton } from "@/components/share/ShareButton";
import { ShareCardDialog } from "@/components/share/ShareCardDialog";
import { TrainingCalendarCard } from "@/components/share/cards/TrainingCalendarCard";
import { CoachingLibrarySheet } from "@/components/fightcamp/CoachingLibrarySheet";
import { logger } from "@/lib/logger";
import { getUserColors, setUserColor } from "@/lib/sessionColors";
import { encodeRunMeta, decodeRunMeta, formatPace } from "@/lib/runMeta";
import { Skeleton } from "@/components/ui/skeleton-loader";

// Local row + insert types for fight_camp_calendar entries.
// All fields are nullable to match the Convex schema's optional shape.
interface TrainingCalendarRow {
  id: string;
  user_id: string;
  date: string;
  // PRIMARY discipline (martial art / "S&C" / "Rest").
  session_type: string;
  // OPTIONAL activity tag (Sparring, Drilling, Strength, …). null ⇒ none.
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
  // Techniques covered (combos / positions / drills). Optional. null ⇒ none.
  techniques_notes: string | null;
  media_url: string | null;
  created_at: string | null;
  // Contact rounds (optional — sparring / live grappling rows only).
  rounds?: number | null;
}
type TrainingCalendarInsert = Partial<TrainingCalendarRow> & {
  date: string;
  session_type: string;
  duration_minutes: number;
  rpe: number;
  intensity: string;
};

// Module-level in-memory cache survives component remounts within a session,
// so re-entering the page paints instantly without a JSON.parse from localStorage.
type SessionsCacheEntry = { data: TrainingCalendarRow[]; fetchedAt: number };
const monthMemCache = new Map<string, SessionsCacheEntry>();
const monthInflight = new Map<string, Promise<TrainingCalendarRow[]>>();
const recent28dMemCache = new Map<string, SessionsCacheEntry>();
const recent28dInflight = new Map<string, Promise<TrainingCalendarRow[]>>();
const FRESH_WINDOW_MS = 30 * 1000; // dedupe identical requests inside 30s

// Convex ids are lowercase alphanumeric strings (no hyphens). Optimistic rows
// created locally use crypto.randomUUID() which contains hyphens — so this
// positive check filters out fabricated client-side ids that the server has
// never seen and would reject with an ArgumentValidationError.
function looksLikeConvexId(id: string): boolean {
    return typeof id === "string" && /^[a-z0-9]{20,40}$/i.test(id);
}

// Most-Recently-Used session types per-user. Persisted to localStorage so
// the picker remembers across reloads. Wrapped in try/catch to survive
// Safari Private Mode (where setItem throws) without breaking the save.
const MRU_KEY = (uid: string) => `recent-session-types:${uid}`;
function readMru(userId: string): string[] {
    try {
        const raw = localStorage.getItem(MRU_KEY(userId));
        const parsed = raw ? (JSON.parse(raw) as unknown) : [];
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((t): t is string => typeof t === "string").slice(0, 3);
    } catch {
        return [];
    }
}
function pushMru(userId: string, type: string): void {
    try {
        const existing = readMru(userId);
        const next = [type, ...existing.filter((t) => t !== type)].slice(0, 3);
        localStorage.setItem(MRU_KEY(userId), JSON.stringify(next));
    } catch {
        /* swallow private-mode / quota errors */
    }
}

// Default-selection helper. Prefer first MRU; fall back to the first
// built-in martial-art primary. Under the two-level model the default
// selection is a PRIMARY discipline (the optional activity tag stays unset).
function pickDefaultSessionType(userId: string | null): string {
    if (userId) {
        const mru = readMru(userId);
        if (mru.length > 0) return mru[0];
    }
    return MARTIAL_ARTS[0];
}

export default function TrainingCalendar() {
    const { userId, profile } = useUser();
    void profile;
    const navigate = useNavigate();
    const { toast } = useToast();
    const { safeAsync, isMounted } = useSafeAsync();
    const { keyboardHeight } = useKeyboardAware();
    const [searchParams, setSearchParams] = useSearchParams();
    const createCalendarMut = useMutation(api.fight_camp.createCalendarEntry);
    const updateCalendarMut = useMutation(api.fight_camp.updateCalendarEntry);
    const deleteCalendarMut = useMutation(api.fight_camp.deleteCalendarEntry);
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState(new Date());
    const [sessions, setSessions] = useState<TrainingCalendarRow[]>(() => {
        // Hydrate from in-memory cache synchronously so first paint has data
        const ws = userId ? monthMemCache.get(`${userId}:${format(new Date(), "yyyy-MM")}`) : null;
        return ws?.data ?? [];
    });
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [pendingRestDay, setPendingRestDay] = useState(false);
    const [sessions28d, setSessions28d] = useState<TrainingCalendarRow[]>(() => {
        const ws = userId ? recent28dMemCache.get(userId) : null;
        return ws?.data ?? [];
    });
    const [sessionLoggedTrigger, setSessionLoggedTrigger] = useState(0);

    // Form State
    const [sessionType, setSessionType] = useState<string>(() => pickDefaultSessionType(userId));
    // Optional activity tag for the primary above. null ⇒ no tag.
    const [sessionTag, setSessionTag] = useState<string | null>(null);
    const [duration, setDuration] = useState("60");
    const [rpe, setRpe] = useState([5]);
    const [intensityLevel, setIntensityLevel] = useState([3]);
    const [hasSoreness, setHasSoreness] = useState(false);
    const [sorenessLevel, setSorenessLevel] = useState([5]);
    const [notes, setNotes] = useState("");
    const [techniquesNotes, setTechniquesNotes] = useState("");
    const [runDistance, setRunDistance] = useState("");
    const [runTime, setRunTime] = useState("");
    const [runDistanceUnit, setRunDistanceUnit] = useState<"km" | "mi">("km");
    const runPace = formatPace(runDistance, runTime);
    // Optional contact-round count. `null` ⇒ user hasn't set one; we omit
    // the field on save so the schema's `v.optional(v.number())` stays clean.
    const [rounds, setRounds] = useState<number | null>(null);

    // Edit state
    const [editingSession, setEditingSession] = useState<TrainingCalendarRow | null>(null);
    // Share state
    const [shareOpen, setShareOpen] = useState(false);
    const [shareTimeRange, setShareTimeRange] = useState<"day" | "week" | "month">("week");
    const [cardVariant, setCardVariant] = useState<"dark" | "transparent">("dark");
    // Custom session colors
    const [customColors, setCustomColors] = useState<Record<string, string>>({});
    // Multi-attach pending media — uploaded after the session is inserted
    // so we always have a real `sessionId` to associate with each row in
    // `session_media`. Files are held in memory; preview URLs are tracked
    // here so we can revoke them when entries are removed (object URLs
    // leak memory until revoked).
    const [pendingMedia, setPendingMedia] = useState<PendingSessionMedia[]>([]);
    const pendingMediaRef = useRef<PendingSessionMedia[]>([]);
    useEffect(() => { pendingMediaRef.current = pendingMedia; }, [pendingMedia]);
    // Detail drawer state
    const [viewingSession, setViewingSession] = useState<TrainingCalendarRow | null>(null);
    const [isDetailDrawerOpen, setIsDetailDrawerOpen] = useState(false);
    // Coaching library state
    const [libraryOpen, setLibraryOpen] = useState(false);
    const [monthSheetOpen, setMonthSheetOpen] = useState(false);

    const DISPLAY_TTL = 24 * 60 * 60 * 1000; // 24h — show stale cache instantly, refresh in background
    const fetchingRef = useRef(false);
    const toastRef = useRef(toast);
    toastRef.current = toast;
    // Keep a ref in sync with userId so async handlers (e.g. handleSaveSession's
    // wait-for-auth poll) observe live values, not the captured render closure.
    const userIdRef = useRef(userId);
    useEffect(() => { userIdRef.current = userId; }, [userId]);

    const monthCacheKey = (d: Date) => `training_sessions_${format(d, "yyyy-MM")}`;

    // Convex client used for ad-hoc imperative queries (the calendar still
    // pages month-by-month and needs to fetch arbitrary ranges that don't
    // bind to a single useQuery subscription).
    const convexClientRef = useRef<any | null>(null);
    useEffect(() => {
        if (convexClientRef.current) return;
        import("@/integrations/convex/client").then(({ convex }) => {
            convexClientRef.current = convex;
        });
    }, []);

    const queryMonth = useCallback(async (uid: string, date: Date): Promise<TrainingCalendarRow[]> => {
        const memKey = `${uid}:${format(date, "yyyy-MM")}`;
        const inflight = monthInflight.get(memKey);
        if (inflight) return inflight;

        const promise = (async () => {
            // Wait for the Convex client to mount (fast — the dynamic import
            // resolves synchronously the second time around).
            let client = convexClientRef.current;
            if (!client) {
                ({ convex: client } = await import("@/integrations/convex/client"));
                convexClientRef.current = client;
            }
            const rawRows = await client.query(api.fight_camp.listCalendar, {
                from: format(startOfMonth(date), "yyyy-MM-dd"),
                to: format(endOfMonth(date), "yyyy-MM-dd"),
            });
            const rows: TrainingCalendarRow[] = (rawRows ?? []).map((r: any) => ({
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
                techniques_notes: r.techniquesNotes ?? null,
                media_url: r.mediaUrl ?? null,
                created_at: r._creationTime ? new Date(r._creationTime).toISOString() : null,
                rounds: typeof r.rounds === "number" ? r.rounds : null,
            }));
            monthMemCache.set(memKey, { data: rows, fetchedAt: Date.now() });
            localCache.set(uid, monthCacheKey(date), rows);
            return rows;
        })();

        monthInflight.set(memKey, promise);
        try {
            return await promise;
        } finally {
            monthInflight.delete(memKey);
        }
    }, []);

    const fetchSessions = useCallback(async () => {
        if (!userId) return;

        // Cache-first: serve memCache → localCache → network. Skeleton only on cold miss.
        const memKey = `${userId}:${format(currentDate, "yyyy-MM")}`;
        const mem = monthMemCache.get(memKey);
        const cached = mem?.data ?? localCache.get<TrainingCalendarRow[]>(userId, monthCacheKey(currentDate), DISPLAY_TTL);
        if (cached) {
            safeAsync(setSessions)(cached);
            safeAsync(setIsLoading)(false);
            // Skip refetch if memCache is hot
            if (mem && Date.now() - mem.fetchedAt < FRESH_WINDOW_MS) return;
        } else {
            safeAsync(setIsLoading)(true);
        }

        try {
            const rows = await queryMonth(userId, currentDate);
            safeAsync(setSessions)(rows);
        } catch (error) {
            logger.warn("Error fetching sessions", { err: String(error) });
            // Only surface a destructive toast when we have nothing cached to
            // show the user; otherwise the cache covers it and we silently
            // retry next time UserContext flushes the queue.
            if (!cached && isMounted()) {
                toastRef.current({
                    title: "Couldn't refresh calendar",
                    description: "Showing offline data — we'll retry when you're reconnected.",
                });
            }
        } finally {
            safeAsync(setIsLoading)(false);
        }
    }, [userId, currentDate, safeAsync, isMounted, queryMonth]);

    const fetch28DaySessions = useCallback(async () => {
        if (!userId) return;

        const mem = recent28dMemCache.get(userId);
        const cached28d = mem?.data ?? localCache.get<TrainingCalendarRow[]>(userId, "training_sessions_28d", DISPLAY_TTL);
        if (cached28d) safeAsync(setSessions28d)(cached28d);
        if (mem && Date.now() - mem.fetchedAt < FRESH_WINDOW_MS) return;

        const inflight = recent28dInflight.get(userId);
        if (inflight) {
            try {
                const rows = await inflight;
                safeAsync(setSessions28d)(rows);
            } catch { /* already logged */ }
            return;
        }

        const promise = (async () => {
            const from = format(subDays(new Date(), 28), "yyyy-MM-dd");
            const to = format(new Date(), "yyyy-MM-dd");
            let client = convexClientRef.current;
            if (!client) {
                ({ convex: client } = await import("@/integrations/convex/client"));
                convexClientRef.current = client;
            }
            const rawRows = await client.query(api.fight_camp.listCalendar, { from, to });
            const rows: TrainingCalendarRow[] = (rawRows ?? []).map((r: any) => ({
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
                techniques_notes: r.techniquesNotes ?? null,
                media_url: r.mediaUrl ?? null,
                created_at: r._creationTime ? new Date(r._creationTime).toISOString() : null,
                rounds: typeof r.rounds === "number" ? r.rounds : null,
            }));
            recent28dMemCache.set(userId, { data: rows, fetchedAt: Date.now() });
            localCache.set(userId, "training_sessions_28d", rows);
            return rows;
        })();

        recent28dInflight.set(userId, promise);
        try {
            const rows = await promise;
            safeAsync(setSessions28d)(rows);
        } catch (err) {
            logger.warn("TrainingCalendar: 28-day fetch failed", { err });
        } finally {
            recent28dInflight.delete(userId);
        }
    }, [userId, safeAsync]);

    // Preload adjacent months in background
    const preloadMonth = useCallback(async (date: Date) => {
        if (!userId) return;
        const memKey = `${userId}:${format(date, "yyyy-MM")}`;
        if (monthMemCache.get(memKey)) return;
        if (localCache.get(userId, monthCacheKey(date), DISPLAY_TTL)) return;
        try {
            await queryMonth(userId, date);
        } catch { /* silent preload */ }
    }, [userId, queryMonth]);

    useEffect(() => {
        if (fetchingRef.current) return;
        fetchingRef.current = true;
        Promise.all([fetchSessions(), fetch28DaySessions()]).finally(() => { fetchingRef.current = false; });
    }, [fetchSessions, fetch28DaySessions]);

    // Preload prev/next months after current month loads
    useEffect(() => {
        if (!userId) return;
        const t = setTimeout(() => {
            preloadMonth(subMonths(currentDate, 1));
            preloadMonth(addMonths(currentDate, 1));
        }, 500);
        return () => clearTimeout(t);
    }, [userId, currentDate, preloadMonth]);
    useEffect(() => { if (userId) setCustomColors(getUserColors(userId)); }, [userId]);

    // Re-pick the default session type once userId resolves — the first
    // render uses null (Sparring default). Only re-pick if the user hasn't
    // already touched the picker mid-edit (editingSession is null).
    useEffect(() => {
        if (!userId || editingSession || isAddModalOpen) return;
        const mru = readMru(userId);
        if (mru.length > 0 && mru[0] !== sessionType) {
            setSessionType(mru[0]);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [userId]);

    // Auto-open Log Session dialog when navigated from Quick Log (deferred to avoid race with QuickLog sheet close)
    useEffect(() => {
        if (searchParams.get("openLogSession") === "true") {
            searchParams.delete("openLogSession");
            setSearchParams(searchParams, { replace: true });
            const t = setTimeout(() => {
                setSelectedDate(new Date());
                setIsAddModalOpen(true);
            }, 150);
            return () => clearTimeout(t);
        }
    }, [searchParams, setSearchParams]);

    const resetForm = () => {
        setSessionType(pickDefaultSessionType(userId));
        setSessionTag(null);
        setDuration("60");
        setRpe([5]);
        setIntensityLevel([3]);
        setHasSoreness(false);
        setSorenessLevel([5]);
        setNotes("");
        setTechniquesNotes("");
        setRunDistance("");
        setRunTime("");
        setRunDistanceUnit("km");
        setRounds(null);
        setEditingSession(null);
        // Revoke any in-flight object URLs so the browser releases the
        // underlying blob memory before we drop the references.
        for (const m of pendingMediaRef.current) {
          try { URL.revokeObjectURL(m.previewUrl); } catch { /* ignore */ }
        }
        setPendingMedia([]);
    };

    const handleAddPendingMedia = useCallback((file: File) => {
        const previewUrl = URL.createObjectURL(file);
        const kind: "photo" | "video" = file.type.startsWith("video/") ? "video" : "photo";
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        setPendingMedia(prev => [...prev, { id, file, previewUrl, kind }]);
    }, []);

    const handleRemovePendingMedia = useCallback((id: string) => {
        setPendingMedia(prev => {
            const removed = prev.find(m => m.id === id);
            if (removed) {
              try { URL.revokeObjectURL(removed.previewUrl); } catch { /* ignore */ }
            }
            return prev.filter(m => m.id !== id);
        });
    }, []);

    const handleViewSession = (session: TrainingCalendarRow) => {
        setViewingSession(session);
        setIsDetailDrawerOpen(true);
    };

    const handleEditSession = (session: TrainingCalendarRow) => {
        // Close detail drawer first if open
        setIsDetailDrawerOpen(false);
        setViewingSession(null);

        setEditingSession(session);
        setSessionType(session.session_type);
        setSessionTag(session.session_tag ?? null);
        setDuration(String(session.duration_minutes));
        setRpe([session.rpe]);
        const il = session.intensity_level ?? (session.intensity === 'high' ? 5 : session.intensity === 'moderate' ? 3 : 1);
        setIntensityLevel([il]);
        setHasSoreness((session.soreness_level ?? 0) > 0);
        setSorenessLevel([(session.soreness_level ?? 0) > 0 ? session.soreness_level! : 5]);
        // Preload existing rounds for contact sessions; null otherwise so the
        // form respects "user hasn't set it" semantics (unchecked on save).
        setRounds(
            isContactSession(session.session_type, session.session_tag) && typeof session.rounds === "number"
                ? session.rounds
                : null,
        );
        const { meta, notes: cleanNotes } = decodeRunMeta(session.notes);
        setNotes(cleanNotes);
        setTechniquesNotes(session.techniques_notes ?? "");
        if (meta) {
            setRunDistance(meta.distance || "");
            setRunTime(meta.time || "");
            setRunDistanceUnit(meta.unit || "km");
        } else {
            setRunDistance("");
            setRunTime("");
            setRunDistanceUnit("km");
        }
        // Editing path: legacy `media_url` (single attachment) is managed by
        // the SessionDetailDrawer's media grid + multi-attachment uploads
        // happen against the existing session id. The form opens with no
        // staged pendingMedia so edits don't accidentally re-attach files.
        setPendingMedia([]);
        setIsAddModalOpen(true);
    };

    const handleSaveSession = async () => {
        // Wait briefly for userId on cold-start. Read from a ref so the loop
        // sees live updates from React re-renders rather than the captured
        // closure value of `userId`.
        let resolvedUserId = userIdRef.current;
        if (!resolvedUserId) {
            const start = Date.now();
            while (!resolvedUserId && Date.now() - start < 2000) {
                await new Promise((r) => setTimeout(r, 100));
                resolvedUserId = userIdRef.current;
            }
            if (!resolvedUserId) {
                toast({
                    title: "Still loading your account",
                    description: "Please wait a moment and try again.",
                    variant: "destructive",
                });
                return;
            }
        }

        if (isSaving) return; // guard against double-press
        setIsSaving(true);

        const uid = resolvedUserId;
        const sessionId = editingSession ? editingSession.id : crypto.randomUUID();
        const intensityMap: Record<number, string> = { 1: 'low', 2: 'low', 3: 'moderate', 4: 'high', 5: 'high' };
        const dateStr = format(selectedDate, "yyyy-MM-dd");
        const monthKey = monthCacheKey(currentDate);
        const memMonthKey = `${uid}:${format(currentDate, "yyyy-MM")}`;
        const previousMonthSessions = sessions;
        const previousMem = monthMemCache.get(memMonthKey);

        // Normalise the optional tag: empty string ⇒ null so we never ship
        // a blank tag to the backend.
        const tagToSave = sessionTag && sessionTag.trim() ? sessionTag : null;

        // Build optimistic row using existing media url (we'll replace with the
        // uploaded URL once it lands; UI shows the preview meanwhile).
        // Run-meta is keyed on the "Run" activity TAG under the two-level model.
        const baseNotes = tagToSave === "Run"
            ? encodeRunMeta(
                { distance: runDistance, unit: runDistanceUnit, time: runTime, pace: runPace },
                notes.trim()
              ) || null
            : notes.trim() || null;

        // Techniques covered live on their OWN field (never run-meta encoded).
        const techniquesToSave = techniquesNotes.trim() || null;

        // Rounds is only included for contact sessions, and only when the
        // user actually set a value (rounds !== null). Mirrors the payload
        // logic below so the optimistic row matches what the server stores.
        const contactRounds = isContactSession(sessionType, tagToSave) && rounds != null ? rounds : null;

        const optimisticRow: TrainingCalendarRow = {
            // Spread editingSession to preserve any DB-managed fields (created_at, etc.)
            ...(editingSession ?? ({} as TrainingCalendarRow)),
            id: sessionId,
            user_id: uid,
            date: dateStr,
            session_type: sessionType,
            session_tag: tagToSave,
            duration_minutes: parseInt(duration) || 0,
            rpe: rpe[0],
            intensity: intensityMap[intensityLevel[0]] || 'moderate',
            intensity_level: intensityLevel[0],
            soreness_level: hasSoreness ? sorenessLevel[0] : 0,
            notes: baseNotes,
            techniques_notes: techniquesToSave,
            fatigue_level: null,
            sleep_quality: null,
            mobility_done: null,
            rounds: contactRounds,
            // Legacy single-media URL stays nullable; the new flow attaches
            // media via `session_media` after the row is created.
            media_url: editingSession?.media_url ?? null,
        };

        // OPTIMISTIC: update state + caches + close dialog immediately.
        // Skip the optimistic state mutation when editing a row that isn't in
        // the visible month — preserves the row instead of silently dropping it.
        const editingRowIsVisible = !editingSession || sessions.some(s => s.id === sessionId);
        const optimisticApplied = editingRowIsVisible;
        const nextSessions = !optimisticApplied
            ? sessions
            : editingSession
                ? sessions.map(s => s.id === sessionId ? optimisticRow : s)
                : [...sessions, optimisticRow];
        if (optimisticApplied) {
            setSessions(nextSessions);
            monthMemCache.set(memMonthKey, { data: nextSessions, fetchedAt: Date.now() });
            localCache.set(uid, monthKey, nextSessions);
        }
        setIsAddModalOpen(false);
        setSessionLoggedTrigger(prev => prev + 1);

        // Hoisted so the catch block can enqueue the failed write
        let payload: TrainingCalendarInsert | null = null;
        // Legacy single-media value preserved on edits; new attachments
        // ride the multi-attachment table instead.
        const resolvedMediaUrl: string | null = editingSession?.media_url ?? null;
        let mediaUploadFailed = false;
        // Snapshot the in-flight pending media so a concurrent reset (e.g.
        // user opens dialog again before uploads finish) doesn't drop them.
        const queuedMedia = pendingMediaRef.current;

        try {
            payload = {
                id: sessionId,
                user_id: uid,
                date: dateStr,
                session_type: sessionType,
                session_tag: tagToSave,
                duration_minutes: parseInt(duration) || 0,
                rpe: rpe[0],
                intensity: intensityMap[intensityLevel[0]] || 'moderate',
                intensity_level: intensityLevel[0],
                soreness_level: hasSoreness ? sorenessLevel[0] : 0,
                notes: baseNotes,
                techniques_notes: techniquesToSave,
                fatigue_level: null,
                sleep_quality: null,
                mobility_done: null,
                media_url: resolvedMediaUrl,
            };

            // Capture the real Convex id so the multi-attachment uploads
            // below can associate with the correct row. On edit we already
            // have it; on create the mutation returns the new id.
            let realSessionId: Id<"fight_camp_calendar">;
            if (editingSession) {
                realSessionId = editingSession.id as unknown as Id<"fight_camp_calendar">;
                await updateCalendarMut({
                    id: realSessionId,
                    sessionType: payload!.session_type,
                    // Backend accepts a string to set/replace; omit (undefined)
                    // leaves the stored tag unchanged. The validator rejects
                    // null, so a cleared tag maps to "no change" here.
                    sessionTag: tagToSave ?? undefined,
                    intensity: payload!.intensity,
                    intensityLevel: payload!.intensity_level ?? undefined,
                    durationMinutes: payload!.duration_minutes,
                    rpe: payload!.rpe,
                    sorenessLevel: payload!.soreness_level ?? undefined,
                    notes: payload!.notes ?? undefined,
                    techniquesNotes: payload!.techniques_notes ?? undefined,
                    ...(isContactSession(sessionType, tagToSave) && rounds != null ? { rounds } : {}),
                });
            } else {
                realSessionId = (await createCalendarMut({
                    date: payload!.date,
                    sessionType: payload!.session_type,
                    sessionTag: tagToSave ?? undefined,
                    intensity: payload!.intensity,
                    intensityLevel: payload!.intensity_level ?? undefined,
                    durationMinutes: payload!.duration_minutes,
                    rpe: payload!.rpe,
                    sorenessLevel: payload!.soreness_level ?? undefined,
                    notes: payload!.notes ?? undefined,
                    techniquesNotes: payload!.techniques_notes ?? undefined,
                    ...(isContactSession(sessionType, tagToSave) && rounds != null ? { rounds } : {}),
                })) as Id<"fight_camp_calendar">;
            }

            // Push to MRU now that the server accepted the row. Skipped for
            // the dedicated "Rest" sentinel (handled by its own flow) so the
            // picker's recent list stays training-focused.
            if (sessionType !== "Rest") {
                pushMru(uid, sessionType);
            }

            // Multi-attachment upload pass. Run in parallel because each
            // media file does its own POST + storage round-trip; serialising
            // would make a 5-clip save feel slow. allSettled so one bad
            // file (e.g. corrupt video header) doesn't block the others.
            let mediaSucceeded = 0;
            let mediaFailed = 0;
            if (queuedMedia.length > 0) {
                const results = await Promise.allSettled(
                    queuedMedia.map((m) =>
                        uploadSessionMediaV2(realSessionId, m.file, {
                            capturedAt: payload!.date,
                        }),
                    ),
                );
                for (const r of results) {
                    if (r.status === "fulfilled") mediaSucceeded++;
                    else {
                        mediaFailed++;
                        logger.warn("session media upload failed", { reason: (r as PromiseRejectedResult).reason });
                    }
                }
                if (mediaFailed > 0) mediaUploadFailed = true;
                // Either way, free the preview blob URLs so we don't leak.
                for (const m of queuedMedia) {
                    try { URL.revokeObjectURL(m.previewUrl); } catch { /* ignore */ }
                }
            }
            void mediaSucceeded;

            // Patch the optimistic row with the resolved media URL using a
            // functional update; mirror to caches via the live cache snapshot
            // so a concurrent month-nav refetch doesn't get overwritten.
            if (optimisticApplied && resolvedMediaUrl !== optimisticRow.media_url) {
                const patch = (rows: TrainingCalendarRow[]) =>
                    rows.map(s => s.id === sessionId ? { ...s, media_url: resolvedMediaUrl } : s);
                setSessions(prev => patch(prev));
                const liveMem = monthMemCache.get(memMonthKey);
                if (liveMem) {
                    monthMemCache.set(memMonthKey, { data: patch(liveMem.data), fetchedAt: liveMem.fetchedAt });
                }
                const liveLocal = localCache.get<TrainingCalendarRow[]>(uid, monthKey);
                if (liveLocal) {
                    localCache.set(uid, monthKey, patch(liveLocal));
                }
            }

            // If we skipped the optimistic update (edit-from-different-month),
            // invalidate the affected month so the next visit refetches fresh.
            if (!optimisticApplied && editingSession) {
                const editedMonthKey = `training_sessions_${editingSession.date.slice(0, 7)}`;
                const editedMemKey = `${uid}:${editingSession.date.slice(0, 7)}`;
                monthMemCache.delete(editedMemKey);
                localCache.remove(uid, editedMonthKey);
            }

            // Invalidate the 28d cache so the rolling window picks up the new row
            recent28dMemCache.delete(uid);
            localCache.remove(uid, "training_sessions_28d");
            // Background revalidate (non-blocking)
            void fetch28DaySessions();

            // Invalidate the TrainingSummarySection's week cache and bump the
            // trigger again now that the DB row is persisted. The first bump
            // happened optimistically (before the insert), which queried the DB
            // too early — without this second bump the "Generate Summary"
            // button would stay hidden until a manual refresh.
            const weekStartIso = format(startOfWeek(selectedDate, { weekStartsOn: 1 }), "yyyy-MM-dd");
            localCache.remove(uid, `training_week_${weekStartIso}`);
            localCache.remove(uid, "training_summaries");
            setSessionLoggedTrigger(prev => prev + 1);

            if (mediaUploadFailed) {
                toast({
                    title: "Session saved, media failed",
                    description: "Saved without the photo/video. Edit the session to retry.",
                    variant: "destructive",
                });
            } else {
                toast({
                    title: editingSession ? "Session Updated" : "Session Saved",
                    description: editingSession
                        ? "Your session has been updated."
                        : "Your training session has been logged successfully.",
                });
            }
            resetForm();
        } catch (error) {
            // No more offline syncQueue path — surface a destructive toast and
            // roll back the optimistic row when possible. The Convex client
            // auto-reconnects so this is a "try again in a moment" prompt.
            logger.warn("Save failed", { error });

            if (payload) {
                toast({
                    title: editingSession ? "Couldn't update session" : "Couldn't save session",
                    description: "Check your connection and try again.",
                    variant: "destructive",
                });
                resetForm();
            } else {
                // Failed before the payload was built (very early error) — roll
                // back the optimistic state so the UI matches reality.
                if (optimisticApplied) {
                    setSessions(previousMonthSessions);
                    if (previousMem) {
                        monthMemCache.set(memMonthKey, previousMem);
                    } else {
                        monthMemCache.delete(memMonthKey);
                    }
                    localCache.set(uid, monthKey, previousMonthSessions);
                }
                toast({
                    title: "Couldn't save session",
                    description: "Check your connection and try again.",
                    variant: "destructive"
                });
            }
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteSession = (id: string) => {
        if (!userId) return;
        const uid = userId;
        const session = sessions.find(s => s.id === id);
        const memMonthKey = `${uid}:${format(currentDate, "yyyy-MM")}`;
        const previousSessions = sessions;
        const previousMem = monthMemCache.get(memMonthKey);

        // 1. UNCONDITIONAL OPTIMISTIC REMOVE — instant, before any async work.
        const next = sessions.filter(s => s.id !== id);
        setSessions(next);
        monthMemCache.set(memMonthKey, { data: next, fetchedAt: Date.now() });
        localCache.set(uid, monthCacheKey(currentDate), next);
        confirmDelete();

        const rollback = (reason: unknown) => {
            setSessions(previousSessions);
            if (previousMem) {
                monthMemCache.set(memMonthKey, previousMem);
            } else {
                monthMemCache.delete(memMonthKey);
            }
            localCache.set(uid, monthCacheKey(currentDate), previousSessions);
            const message = reason instanceof Error
                ? reason.message
                : (typeof reason === "string" ? reason : "Unknown error");
            // Authorization-specific copy for the common "lost session" case.
            const isAuth = /not authorized|unauthor|forbidden|auth/i.test(message);
            toast({
                title: "Couldn't delete",
                description: isAuth ? "Sign in again to delete this session." : message,
                variant: "destructive",
            });
        };

        // 2. ID GUARD — a hyphenated UUID came from an optimistic-only row that
        //    was never persisted server-side. Skip the mutation entirely.
        if (!looksLikeConvexId(id)) {
            logger.info("Skipping server delete for non-Convex id (optimistic-only row)", { id });
            return;
        }

        // 3. Best-effort media cleanup — fire-and-forget, never blocks or rolls back.
        if (session?.media_url) {
            // deleteSessionMedia may not be imported in this file; guard with typeof.
            try {
                const fn = (globalThis as { deleteSessionMedia?: (u: string) => Promise<void> }).deleteSessionMedia;
                if (typeof fn === "function") fn(session.media_url).catch(() => {});
            } catch { /* ignore */ }
        }

        // 4. Background mutation — UI stays cleared even while pending.
        (async () => {
            try {
                await deleteCalendarMut({ id: id as unknown as Id<"fight_camp_calendar"> });
                // 5. "Already gone" is success — server is idempotent.
                recent28dMemCache.delete(uid);
                localCache.remove(uid, "training_sessions_28d");
                void fetch28DaySessions();
            } catch (error) {
                logger.warn("Delete failed", { error: String(error) });
                if (isMounted()) rollback(error);
            }
        })();
    };

    // ── Rest-day toggle ────────────────────────────────────────────────
    // Marks a date as a deliberate rest by writing a `Rest` row into
    // `fight_camp_calendar`. Mirrors the optimistic + cache pattern used
    // by handleSaveSession, but skips the form path entirely — Rest is
    // its own dedicated action, not a session-type option in the form.
    const handleMarkRestDay = async () => {
        if (!userId || pendingRestDay) return;
        const uid = userId;
        const dateStr = format(selectedDate, "yyyy-MM-dd");

        // Idempotency guard: if a rest row already exists for this date,
        // do nothing — the UI should be showing the "Remove" affordance.
        if (sessions.some(s => s.date === dateStr && s.session_type === "Rest")) return;

        setPendingRestDay(true);
        triggerHapticSelection();

        const tempId = crypto.randomUUID();
        const memMonthKey = `${uid}:${format(currentDate, "yyyy-MM")}`;
        const monthKey = monthCacheKey(currentDate);
        const previousSessions = sessions;
        const previousMem = monthMemCache.get(memMonthKey);

        const optimisticRow: TrainingCalendarRow = {
            id: tempId,
            user_id: uid,
            date: dateStr,
            session_type: "Rest",
            session_tag: null,
            duration_minutes: 0,
            rpe: 0,
            intensity: "low",
            intensity_level: 1,
            bodyweight: null,
            fatigue_level: null,
            soreness_level: null,
            sleep_hours: null,
            sleep_quality: null,
            mobility_done: null,
            notes: null,
            techniques_notes: null,
            media_url: null,
            created_at: new Date().toISOString(),
            rounds: null,
        };

        const next = [...sessions, optimisticRow];
        setSessions(next);
        monthMemCache.set(memMonthKey, { data: next, fetchedAt: Date.now() });
        localCache.set(uid, monthKey, next);

        try {
            const realId = (await createCalendarMut({
                date: dateStr,
                sessionType: "Rest",
                intensity: "low",
                intensityLevel: 1,
                durationMinutes: 0,
                rpe: 0,
            })) as Id<"fight_camp_calendar">;

            // Swap the optimistic temp id for the real Convex id so a later
            // "Remove rest day" tap can call deleteCalendarMut with a valid id.
            const patch = (rows: TrainingCalendarRow[]) =>
                rows.map(s => s.id === tempId ? { ...s, id: realId as unknown as string } : s);
            setSessions(prev => patch(prev));
            const liveMem = monthMemCache.get(memMonthKey);
            if (liveMem) {
                monthMemCache.set(memMonthKey, { data: patch(liveMem.data), fetchedAt: liveMem.fetchedAt });
            }
            const liveLocal = localCache.get<TrainingCalendarRow[]>(uid, monthKey);
            if (liveLocal) {
                localCache.set(uid, monthKey, patch(liveLocal));
            }

            // Bump the same trigger session-save uses so dependent widgets
            // (TrainingSummarySection, dashboard daily-log chip via the
            // reactive Convex query) pick up the change immediately.
            setSessionLoggedTrigger(prev => prev + 1);

            // Invalidate the 28d cache so the rolling window picks up the rest row.
            recent28dMemCache.delete(uid);
            localCache.remove(uid, "training_sessions_28d");
            void fetch28DaySessions();

            toast({
                title: "Rest day logged",
                description: "Nice — recovery is part of the work.",
            });
        } catch (error) {
            logger.warn("Mark rest day failed", { error: String(error) });
            // Rollback to pre-optimistic state.
            setSessions(previousSessions);
            if (previousMem) {
                monthMemCache.set(memMonthKey, previousMem);
            } else {
                monthMemCache.delete(memMonthKey);
            }
            localCache.set(uid, monthKey, previousSessions);
            toast({
                title: "Couldn't mark rest day",
                description: "Check your connection and try again.",
                variant: "destructive",
            });
        } finally {
            setPendingRestDay(false);
        }
    };

    const handleRemoveRestDay = () => {
        if (!userId || pendingRestDay) return;
        const dateStr = format(selectedDate, "yyyy-MM-dd");
        const restEntry = sessions.find(s => s.date === dateStr && s.session_type === "Rest");
        if (!restEntry) return;
        setPendingRestDay(true);
        triggerHapticSelection();
        // Reuse the existing delete pipeline — same optimistic UI, rollback,
        // cache invalidation, and "already gone" idempotency.
        handleDeleteSession(restEntry.id);
        // handleDeleteSession is fire-and-forget; release the gate on the
        // next tick. Cache + state update have already happened synchronously.
        setTimeout(() => setPendingRestDay(false), 0);
    };

    const handleColorChange = (sessionType: string, color: string) => {
        if (!userId) return;
        setUserColor(userId, sessionType, color);
        setCustomColors(prev => ({ ...prev, [sessionType]: color }));
    };

    const daysInMonth = eachDayOfInterval({
        start: startOfMonth(currentDate),
        end: endOfMonth(currentDate)
    });

    const nextMonth = () => { setCurrentDate(addMonths(currentDate, 1)); triggerHapticSelection(); };
    const prevMonth = () => { setCurrentDate(subMonths(currentDate, 1)); triggerHapticSelection(); };

    const sessionsForSelectedDate = sessions.filter(s => s.date === format(selectedDate, 'yyyy-MM-dd'));
    // Rest-day toggle state for the selected date. Suppress the "Mark rest"
    // affordance if any real (non-Rest) session is already logged — the day
    // is accounted for and showing the button there would be noise.
    const restEntryForSelectedDate = sessionsForSelectedDate.find(s => s.session_type === "Rest") ?? null;
    const hasRealSessionForSelectedDate = sessionsForSelectedDate.some(s => s.session_type !== "Rest");
    // Show the rest toggle when: there's a rest entry to remove, OR there's
    // no real session for the day (so the user can mark it).
    const showRestToggle = !!restEntryForSelectedDate || !hasRealSessionForSelectedDate;

    // ── Week-strip helpers ────────────────────────────────────────────
    // Render the 7 days of the week that contains `selectedDate`. Sunday
    // is the locale-neutral start; this is consistent with the existing
    // CalendarMonthGrid header (S M T W T F S).
    const weekStart = startOfWeek(selectedDate, { weekStartsOn: 0 });
    const weekDays = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart);
        d.setDate(weekStart.getDate() + i);
        return d;
    });
    const sessionsByDate = new Map<string, TrainingCalendarRow[]>();
    for (const s of sessions) {
        const k = s.date;
        if (!sessionsByDate.has(k)) sessionsByDate.set(k, []);
        sessionsByDate.get(k)!.push(s);
    }
    const weekSessions = weekDays.flatMap((d) => sessionsByDate.get(format(d, "yyyy-MM-dd")) ?? []);
    const weekMinutes = weekSessions.reduce((sum, s) => sum + (s.duration_minutes ?? 0), 0);
    const weekSessionCount = weekSessions.length;
    const isoWeek = getISOWeek(selectedDate);

    const openLogModal = () => {
        triggerHapticSelection();
        setIsAddModalOpen(true);
    };

    return (
        <div className="animate-page-in space-y-4 px-5 py-3 sm:p-5 md:p-6 max-w-7xl mx-auto pb-16 md:pb-6">
                <header className="pt-1">
                  <p className="text-micro uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">Your</p>
                  <h1 className="text-title font-semibold leading-tight">Training Calendar</h1>
                </header>
                {/* Top action row + week-summary chip */}
                <div className="flex items-center justify-between gap-2">
                    <button
                        type="button"
                        onClick={() => { triggerHapticSelection(); setMonthSheetOpen(true); }}
                        className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-card/50 px-3 py-1.5 text-[12px] font-semibold hover:bg-muted/40 active:scale-[0.97] transition"
                        aria-label="Open month calendar"
                    >
                        <CalendarDays className="h-3.5 w-3.5 text-primary" />
                        <span className="text-foreground/90">Week {isoWeek}</span>
                        <span className="text-muted-foreground/70 tabular-nums">
                            · {weekSessionCount} {weekSessionCount === 1 ? "session" : "sessions"} · {weekMinutes}min
                        </span>
                    </button>
                    <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => { triggerHapticSelection(); navigate("/training-library"); }}
                            aria-label="Open media library"
                            className="rounded-full h-9 w-9"
                        >
                            <Images className="h-4 w-4" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => { triggerHapticSelection(); setLibraryOpen(true); }}
                            aria-label="Open coaching library"
                            className="rounded-full h-9 w-9"
                        >
                            <BookOpen className="h-4 w-4" />
                        </Button>
                        {sessions.length > 0 && <ShareButton onClick={() => setShareOpen(true)} />}
                    </div>
                </div>

                {/* Horizontal week strip — 7 days, selected day pops. Auto-scrolls
                    via flex layout (no overflow needed since 7 fits naturally). */}
                <div className="grid grid-cols-7 gap-1.5">
                    {weekDays.map((d) => {
                        const ds = format(d, "yyyy-MM-dd");
                        const active = ds === format(selectedDate, "yyyy-MM-dd");
                        const isTodayCell = isDateToday(d);
                        const isYestCell = isDateYesterday(d);
                        const dayEntries = sessionsByDate.get(ds) ?? [];
                        // Surface rest-only days with a distinct corner marker so
                        // they read differently from active training days (which
                        // use the warm primary dots). Rest rows that share a day
                        // with a real session keep the session-dot treatment —
                        // the real session is the headline.
                        const realCount = dayEntries.filter(s => s.session_type !== "Rest").length;
                        const restOnly = realCount === 0 && dayEntries.some(s => s.session_type === "Rest");
                        const dayCount = dayEntries.length;
                        return (
                            <motion.button
                                key={ds}
                                whileTap={{ scale: 0.94 }}
                                onClick={() => { triggerHapticSelection(); setSelectedDate(d); }}
                                className={`relative flex flex-col items-center justify-center h-[68px] rounded-xs border transition-colors ${
                                    active
                                        ? "bg-primary text-primary-foreground border-primary"
                                        : "bg-card/40 text-foreground/85 border-border/40 hover:bg-muted/40"
                                }`}
                                aria-label={`${format(d, "EEEE, MMMM d")}${restOnly ? ", rest day" : ""}`}
                                aria-current={active ? "date" : undefined}
                            >
                                {/* Rest-day corner marker — muted cool tone so it
                                    doesn't compete with the primary session dots. */}
                                {restOnly && (
                                    <span
                                        className={`absolute top-1 right-1 inline-flex items-center justify-center ${
                                            active ? "text-primary-foreground/70" : "text-muted-foreground/60"
                                        }`}
                                        aria-hidden
                                    >
                                        <Icon name="moonOutline" size={10} />
                                    </span>
                                )}
                                <span
                                    className={`text-[9.5px] font-bold uppercase tracking-wider leading-none ${
                                        active ? "text-primary-foreground/85" : "text-muted-foreground/70"
                                    }`}
                                >
                                    {isTodayCell ? "TODAY" : isYestCell ? "YEST" : format(d, "EEE")}
                                </span>
                                <span
                                    className={`mt-1.5 text-[17px] font-bold tabular-nums leading-none ${
                                        active ? "text-primary-foreground" : "text-foreground"
                                    }`}
                                >
                                    {format(d, "d")}
                                </span>
                                {/* Session count dot(s) below — only for real
                                    sessions. Rest-only days use the moon marker. */}
                                {!restOnly && dayCount > 0 && (
                                    <span className="absolute bottom-1.5 flex items-center gap-0.5">
                                        {Array.from({ length: Math.min(3, dayCount) }).map((_, i) => (
                                            <span
                                                key={i}
                                                className={`h-1 w-1 rounded-full ${active ? "bg-primary-foreground" : "bg-primary"}`}
                                            />
                                        ))}
                                    </span>
                                )}
                            </motion.button>
                        );
                    })}
                </div>

                {/* Selected date header */}
                <div>
                    <h3 className="text-[18px] font-bold tracking-tight">{format(selectedDate, "EEEE, MMM do")}</h3>
                </div>

                {/* Big primary "Log a session" button */}
                <Sheet open={isAddModalOpen} onOpenChange={(open) => {
                    setIsAddModalOpen(open);
                    if (!open) resetForm();
                }}>
                    <SheetTrigger asChild>
                        <button
                            onClick={openLogModal}
                            className="w-full h-12 rounded-xs bg-primary text-primary-foreground font-bold text-[14px] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform"
                        >
                            <Plus className="h-4 w-4" strokeWidth={2.6} />
                            Log a session
                        </button>
                    </SheetTrigger>
                    <SheetContent
                        side="bottom"
                        className="p-0 max-h-[92vh] flex flex-col bg-card/95 backdrop-blur-xl"
                        style={{ paddingBottom: `calc(env(safe-area-inset-bottom, 0px) + ${keyboardHeight}px)` }}
                    >
                        <div className="flex justify-center pt-2 pb-1 shrink-0">
                            <div className="w-10 h-1 rounded-full bg-muted-foreground/25" aria-hidden />
                        </div>
                        <SheetHeader className="px-5 pb-3 shrink-0">
                            <SheetTitle className="text-[17px] font-semibold tracking-tight text-center">
                                {editingSession ? 'Edit session' : 'Log session'}
                            </SheetTitle>
                        </SheetHeader>
                        <div className="px-5 overflow-y-auto flex-1 min-h-0 [-webkit-overflow-scrolling:touch]">
                                <FightCampLogForm
                                    isEditing={!!editingSession}
                                    userId={userId}
                                    sessionType={sessionType} setSessionType={setSessionType}
                                    sessionTag={sessionTag} setSessionTag={setSessionTag}
                                    duration={duration} setDuration={setDuration}
                                    rpe={rpe} setRpe={setRpe}
                                    intensityLevel={intensityLevel} setIntensityLevel={setIntensityLevel}
                                    hasSoreness={hasSoreness} setHasSoreness={setHasSoreness}
                                    sorenessLevel={sorenessLevel} setSorenessLevel={setSorenessLevel}
                                    notes={notes} setNotes={setNotes}
                                    techniquesNotes={techniquesNotes} setTechniquesNotes={setTechniquesNotes}
                                    runDistance={runDistance} setRunDistance={setRunDistance}
                                    runTime={runTime} setRunTime={setRunTime}
                                    runDistanceUnit={runDistanceUnit} setRunDistanceUnit={setRunDistanceUnit}
                                    runPace={runPace}
                                    rounds={rounds} setRounds={setRounds}
                                    pendingMedia={pendingMedia}
                                    onAddMedia={handleAddPendingMedia}
                                    onRemoveMedia={handleRemovePendingMedia}
                                    existingSessionId={
                                      editingSession
                                        ? (editingSession.id as unknown as Id<"fight_camp_calendar">)
                                        : null
                                    }
                                    legacyMediaUrl={editingSession?.media_url ?? null}
                                    onSave={handleSaveSession}
                                    saving={isSaving}
                                    canSave={!!userId}
                                />
                        </div>
                    </SheetContent>
                </Sheet>

                {/* Rest-day toggle — secondary outline CTA sitting below the
                    primary "Log a session" button. Hidden when a real session
                    is already logged for this date; the day is accounted for. */}
                {showRestToggle && (
                    <button
                        type="button"
                        onClick={restEntryForSelectedDate ? handleRemoveRestDay : handleMarkRestDay}
                        disabled={pendingRestDay || !userId}
                        aria-pressed={!!restEntryForSelectedDate}
                        className={`w-full h-11 rounded-xs border text-[13px] font-semibold flex items-center justify-center gap-2 transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100 ${
                            restEntryForSelectedDate
                                ? "bg-muted/30 text-foreground border-border/50"
                                : "bg-transparent text-foreground/85 border-border/40 hover:bg-muted/30"
                        }`}
                    >
                        <Icon
                            name="moonOutline"
                            size={15}
                            className={restEntryForSelectedDate ? "text-foreground/80" : "text-muted-foreground"}
                        />
                        {restEntryForSelectedDate ? "Remove rest day" : "Mark as rest day"}
                    </button>
                )}

                    <div className="space-y-2.5">
                        {isLoading ? (
                            <div className="flex flex-col gap-3">
                                {[1, 2].map(i => (
                                    <div key={i} className="card-surface rounded-xs p-5 overflow-hidden relative border border-border">
                                        <div className="absolute top-0 left-0 right-0 h-[2px]">
                                            <Skeleton className="w-1/3 h-full" />
                                        </div>
                                        <div className="flex items-center gap-2.5">
                                            <Skeleton className="w-3 h-3 rounded-full" />
                                            <Skeleton className="h-4 w-20" />
                                        </div>
                                        <div className="flex gap-4 mt-4">
                                            {[1, 2, 3].map(j => (
                                                <div key={j} className="flex-1 space-y-1.5">
                                                    <Skeleton className="h-2.5 w-12" />
                                                    <Skeleton className="h-7 w-10" />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : sessionsForSelectedDate.length === 0 ? (
                            <WizardTrainingEmptyState
                                onQuickLog={(type) => {
                                    triggerHapticSelection();
                                    setSessionType(type);
                                    setIsAddModalOpen(true);
                                }}
                            />
                        ) : (
                            sessionsForSelectedDate.map(session => (
                                <SessionCard
                                    key={session.id}
                                    session={session}
                                    customColors={customColors}
                                    userId={userId}
                                    onView={handleViewSession}
                                    onColorChange={handleColorChange}
                                    onEdit={handleEditSession}
                                    onDelete={(s) => handleDeleteSession(s.id)}
                                />
                            ))
                        )}
                    </div>

                    {/* Training Summary Section */}
                    {userId && (
                        <TrainingSummarySection
                            userId={userId}
                            selectedDate={selectedDate}
                            sessionLoggedTrigger={sessionLoggedTrigger}
                            customColors={customColors}
                        />
                    )}

                    {/* Month grid sheet — opened from the Week chip top-left */}
                    <Sheet open={monthSheetOpen} onOpenChange={setMonthSheetOpen}>
                        <SheetContent
                            side="bottom"
                            className="rounded-t-3xl p-0 max-h-[88vh] overflow-y-auto [&>button]:hidden"
                            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)" }}
                        >
                            <VisuallyHidden><SheetTitle>Month calendar</SheetTitle></VisuallyHidden>
                            <div className="flex justify-center pt-2 pb-1">
                                <div className="w-10 h-1 rounded-full bg-muted-foreground/25" aria-hidden />
                            </div>
                            <div className="px-5 pt-2 pb-4">
                                <div className="flex items-center justify-between mb-3">
                                    <Button variant="ghost" size="icon" onClick={prevMonth} aria-label="Previous month" className="rounded-full h-9 w-9">
                                        <ChevronLeft className="h-5 w-5" />
                                    </Button>
                                    <h2 className="text-[17px] font-bold tracking-tight">{format(currentDate, "MMMM yyyy")}</h2>
                                    <Button variant="ghost" size="icon" onClick={nextMonth} aria-label="Next month" className="rounded-full h-9 w-9">
                                        <ChevronRight className="h-5 w-5" />
                                    </Button>
                                </div>
                                <CalendarMonthGrid
                                    daysInMonth={daysInMonth}
                                    selectedDate={selectedDate}
                                    sessions={sessions}
                                    onSelectDate={(d) => { setSelectedDate(d); setMonthSheetOpen(false); }}
                                />
                            </div>
                        </SheetContent>
                    </Sheet>

            {/* Coaching Library Sheet */}
            <CoachingLibrarySheet
                userId={userId}
                open={libraryOpen}
                onOpenChange={setLibraryOpen}
            />

            {/* Session Detail Drawer */}
            <SessionDetailDrawer
                session={viewingSession}
                open={isDetailDrawerOpen}
                onOpenChange={setIsDetailDrawerOpen}
                onEdit={handleEditSession}
                onDelete={handleDeleteSession}
                customColors={customColors}
            />

            {/* Share dialog with time range */}
            <ShareCardDialog
                open={shareOpen}
                onOpenChange={(v) => { setShareOpen(v); if (v) setCardVariant("dark"); }}
                transparent={cardVariant === "transparent"}
                showSwipeHint
                title="Share Training Log"
                shareTitle="Training Log"
                shareText="Check out my training log on FightCamp Wizard"
            >
                {({ cardRef, aspect, transparent }) => {
                    const now = new Date();
                    let filtered = [...sessions, ...sessions28d];
                    const seen = new Set<string>();
                    filtered = filtered.filter((s) => {
                        if (seen.has(s.id)) return false;
                        seen.add(s.id);
                        return true;
                    });
                    if (shareTimeRange === "day") {
                        const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
                        filtered = filtered.filter((s) => s.date === todayStr);
                    } else if (shareTimeRange === "week") {
                        const cutoff = new Date(now);
                        cutoff.setDate(cutoff.getDate() - 7);
                        const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
                        filtered = filtered.filter((s) => s.date >= cutoffStr);
                    } else {
                        const cutoff = new Date(now);
                        cutoff.setDate(cutoff.getDate() - 35);
                        const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
                        filtered = filtered.filter((s) => s.date >= cutoffStr);
                    }

                    let touchStartX = 0;
                    const flashCardWrapper = (el: HTMLElement | null) => {
                        if (!el) return;
                        el.classList.remove("share-variant-flash");
                        // Force reflow so the animation re-triggers on rapid swipes.
                        void el.offsetWidth;
                        el.classList.add("share-variant-flash");
                    };

                    return (
                        <div
                            onTouchStart={(e) => { touchStartX = e.touches[0].clientX; }}
                            onTouchEnd={(e) => {
                                const delta = e.changedTouches[0].clientX - touchStartX;
                                if (Math.abs(delta) > 40) {
                                    setCardVariant((v) => v === "dark" ? "transparent" : "dark");
                                    flashCardWrapper(e.currentTarget as HTMLElement);
                                }
                            }}
                        >
                            {/* Time range pills */}
                            <div style={{
                                position: "absolute",
                                top: 100,
                                right: 48,
                                display: "flex",
                                gap: 8,
                                zIndex: 10,
                            }}>
                                {(["day", "week", "month"] as const).map((t) => (
                                    <button
                                        key={t}
                                        onClick={() => setShareTimeRange(t)}
                                        style={{
                                            padding: "4px 12px",
                                            borderRadius: 999,
                                            fontSize: 12,
                                            fontWeight: 600,
                                            background: shareTimeRange === t ? "#2563eb" : "rgba(255,255,255,0.08)",
                                            color: shareTimeRange === t ? "#ffffff" : "rgba(255,255,255,0.5)",
                                            border: "none",
                                            cursor: "pointer",
                                            textTransform: "capitalize",
                                        }}
                                    >
                                        {t === "day" ? "Day" : t === "week" ? "Week" : "Month"}
                                    </button>
                                ))}
                            </div>
                            <TrainingCalendarCard
                                ref={cardRef}
                                sessions={filtered as any}
                                timeRange={shareTimeRange}
                                aspect={aspect}
                                customColors={customColors}
                                transparent={transparent}
                            />
                            {/* Variant mode toggle */}
                            <div style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: 10,
                                marginTop: 10,
                            }}>
                                <button
                                    onClick={() => setCardVariant("dark")}
                                    style={{
                                        background: "none",
                                        border: "none",
                                        padding: 0,
                                        cursor: "pointer",
                                        fontSize: 12,
                                        fontWeight: 600,
                                        color: cardVariant === "dark" ? "#ffffff" : "rgba(255,255,255,0.35)",
                                        transition: "color 0.2s",
                                    }}
                                >
                                    Dark
                                </button>
                                <div style={{ display: "flex", gap: 6 }}>
                                    {(["dark", "transparent"] as const).map((v) => (
                                        <button
                                            key={v}
                                            onClick={() => setCardVariant(v)}
                                            aria-label={`${v} style`}
                                            style={{
                                                width: 8,
                                                height: 8,
                                                borderRadius: 4,
                                                border: "none",
                                                padding: 0,
                                                cursor: "pointer",
                                                background: cardVariant === v ? "#ffffff" : "rgba(255,255,255,0.3)",
                                                transition: "background 0.2s",
                                            }}
                                        />
                                    ))}
                                </div>
                                <button
                                    onClick={() => setCardVariant("transparent")}
                                    style={{
                                        background: "none",
                                        border: "none",
                                        padding: 0,
                                        cursor: "pointer",
                                        fontSize: 12,
                                        fontWeight: 600,
                                        color: cardVariant === "transparent" ? "#ffffff" : "rgba(255,255,255,0.35)",
                                        transition: "color 0.2s",
                                    }}
                                >
                                    Transparent
                                </button>
                            </div>
                        </div>
                    );
                }}
            </ShareCardDialog>

        </div>
    );
}

// ── Wizard-led empty state ─────────────────────────────────────────────
// Shown when the selected day has no logged sessions. Wizard mascot +
// "What did you train?" + 3 quick chips that pre-fill the log form
// with that discipline before opening it.
function WizardTrainingEmptyState({
  onQuickLog,
}: {
  onQuickLog: (sessionType: string) => void;
}) {
  const quickTypes: Array<{ label: string; type: string }> = [
    { label: "BJJ", type: "BJJ" },
    { label: "Boxing", type: "Boxing" },
    { label: "Run", type: "Run" },
  ];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: "easeOut" }}
      className="relative overflow-hidden rounded-xs card-surface p-4"
    >
      <div className="flex items-start gap-3 mb-3">
        <div className="relative shrink-0" style={{ width: 64, height: 64 }}>
          <div style={{ width: 140, height: 140, transform: "scale(0.46)", transformOrigin: "top left" }}>
            <WizardCharacter pose="wave" />
          </div>
        </div>
        <div className="min-w-0 flex-1 pt-1.5">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-primary/80">
            Coach
          </p>
          <h4 className="mt-0.5 text-[17px] font-bold leading-tight">
            What did you train?
          </h4>
          <p className="mt-1 text-[12px] text-muted-foreground leading-snug">
            Pick a discipline or tap Log a session for the full form.
          </p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {quickTypes.map((q) => (
          <button
            key={q.type}
            onClick={() => onQuickLog(q.type)}
            className="inline-flex items-center gap-1.5 rounded-full bg-muted/40 border border-border/40 px-3 py-1.5 text-[12px] font-semibold text-foreground hover:bg-muted/60 active:scale-[0.97] transition"
          >
            {q.label}
          </button>
        ))}
      </div>
    </motion.div>
  );
}
