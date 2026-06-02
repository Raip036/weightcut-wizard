import { createContext, useContext, useState, useEffect, useRef, useMemo, useCallback, ReactNode } from "react";
import { useConvexAuth, useQuery, useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Capacitor } from "@capacitor/core";
import { App as CapacitorApp } from "@capacitor/app";
import { localCache } from "@/lib/localCache";
import { nutritionCache, startCacheCleanup, stopCacheCleanup } from "@/lib/nutritionCache";
import { AIPersistence } from "@/lib/aiPersistence";
import { logger } from "@/lib/logger";
import { usePushRegistration } from "@/hooks/usePushRegistration";
import { clearLocalSubscriptionState } from "@/contexts/SubscriptionContext";
import { api } from "../../convex/_generated/api";

// Profile cache freshness — beyond this we serve cached data but flag it stale
// so guards can show a banner and we trigger a background refresh.
const PROFILE_STALE_AFTER_MS = 24 * 60 * 60 * 1000;

export interface ProfileData {
  id?: string;
  age?: number;
  sex?: string;
  height_cm?: number;
  current_weight_kg?: number;
  goal_weight_kg?: number;
  fight_week_target_kg?: number | null;
  target_date?: string;
  activity_level?: string;
  training_frequency?: number;
  tdee?: number;
  bmr?: number;
  ai_recommended_calories?: number;
  ai_recommended_protein_g?: number;
  ai_recommended_carbs_g?: number;
  ai_recommended_fats_g?: number;
  normal_daily_carbs_g?: number;
  manual_nutrition_override?: boolean;
  avatar_url?: string;
  goal_type?: 'cutting' | 'losing';
  role?: 'fighter' | 'coach';
  display_name?: string | null;
  is_premium?: boolean;
  subscription_tier?: string;
  subscription_expires_at?: string | null;
  trial_ends_at?: number | string | null;
  /** Epoch ms the one-time "Welcome to Pro" cutscene was shown (server CAS). */
  welcome_pro_shown_at?: number | null;
  cut_plan_json?: any;
  [key: string]: any;
}

const AI_RELEVANT_FIELDS: (keyof ProfileData)[] = [
  'goal_weight_kg', 'fight_week_target_kg', 'target_date',
  'activity_level', 'tdee', 'bmr',
  'age', 'sex', 'height_cm', 'training_frequency', 'goal_type',
];

function haveAIFieldsChanged(prev: ProfileData | null, next: ProfileData): boolean {
  if (!prev) return false;
  return AI_RELEVANT_FIELDS.some(f => prev[f] !== next[f]);
}

interface AuthContextType {
  userId: string | null;
  isSessionValid: boolean;
  isLoading: boolean;
  hasProfile: boolean;
  authError: boolean;
  isOffline: boolean;
  /** True if auth fetch failed in a way the UI should surface. With Convex
   *  this is rare — Convex retries WebSocket connections automatically — but
   *  we keep the flag for compatibility. */
  authTimedOut: boolean;
  /** Synchronous role resolution. See `isCoach` memo below. */
  isCoach: boolean;
  /** True once isCoach has had a chance to resolve. */
  isRoleResolved: boolean;
  retryAuth: () => Promise<void>;
  checkSessionValidity: () => Promise<boolean>;
  refreshSession: () => Promise<boolean>;
  loadUserData: () => Promise<void>;
  signOut: () => Promise<void>;
}

interface ProfileContextType {
  profile: ProfileData | null;
  userName: string;
  avatarUrl: string;
  currentWeight: number | null;
  isProfileStale: boolean;
  setUserName: (name: string) => void;
  setAvatarUrl: (url: string) => void;
  refreshProfile: () => Promise<boolean>;
  updateCurrentWeight: (weight: number) => Promise<void>;
  loadCutPlan: () => Promise<any | null>;
}

type UserContextType = AuthContextType & ProfileContextType;

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const ProfileContext = createContext<ProfileContextType | undefined>(undefined);

export function UserProvider({ children }: { children: ReactNode }) {
  // ── Convex Auth ─────────────────────────────────────────────────────
  // `useConvexAuth` returns the auth-loading + isAuthenticated flags.
  // `useAuthActions` exposes signIn / signOut.
  const { isLoading: isAuthLoading, isAuthenticated } = useConvexAuth();
  const { signOut: convexSignOut } = useAuthActions();

  // ── Local state ─────────────────────────────────────────────────────
  const [userName, setUserName] = useState<string>("");
  const [avatarUrl, setAvatarUrl] = useState<string>("");
  const [currentWeight, setCurrentWeight] = useState<number | null>(null);
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [hasProfile, setHasProfile] = useState<boolean>(false);
  const [authError, setAuthError] = useState<boolean>(false);
  const [authTimedOut, setAuthTimedOut] = useState<boolean>(false);
  const [isProfileStale, setIsProfileStale] = useState<boolean>(false);
  const [isOffline, setIsOffline] = useState<boolean>(!navigator.onLine);

  // userIdRef tracks the latest userId synchronously so any async
  // refreshProfile() / updateCurrentWeight() call sees the current value.
  const userIdRef = useRef<string | null>(null);
  const profileRef = useRef<ProfileData | null>(null);

  // ── Profile fetch via Convex query ──────────────────────────────────
  // `profiles.getMine` returns the full profile row in the snake_case shape
  // that the rest of the app already consumes. Convex auto-subscribes — any
  // mutation that touches the profile pushes new data here without
  // manual refetching.
  //
  // Skip the query entirely when unauthenticated (don't waste a round trip).
  const profileFromConvex = useQuery(
    api.profiles.getMine,
    isAuthenticated ? {} : "skip",
  ) as ProfileData | null | undefined;

  // Convex mutations used below.
  const updateCurrentWeightMut = useMutation(api.profiles.updateCurrentWeight);
  const setUserNameMut = useMutation(api.profiles.setUserName);

  // Derive userId from the profile (Convex Auth identity is what binds the
  // query; once the query resolves, the user_id field gives us the truth).
  const userId = profile?.user_id ?? profile?.id ?? (isAuthenticated ? "pending" : null);

  usePushRegistration(userId === "pending" ? null : userId);

  // Sync the ref whenever userId changes.
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  // ── Reconcile the Convex query into our local state ─────────────────
  // We mirror the Convex result into `profile` state (rather than reading
  // directly from useQuery) so existing consumers — many of which expect a
  // mutable, cache-backed shape — keep working unchanged. When the query
  // returns fresh data, we diff against the cache and update if changed.
  // A profile row is auto-created at signup with empty/zero defaults; we
  // only consider it "complete" once onboarding has populated key fields.
  const isProfileComplete = (p: ProfileData | null | undefined): boolean =>
    !!p && !!p.target_date && (p.age ?? 0) > 0 && (p.current_weight_kg ?? 0) > 0;
  useEffect(() => {
    if (profileFromConvex === undefined) {
      // Still loading — try to serve from cache for instant render.
      const uid = userIdRef.current;
      if (uid && uid !== "pending" && !profileRef.current) {
        const cached = localCache.get<ProfileData>(uid, "profiles");
        if (cached) {
          setProfile(cached);
          profileRef.current = cached;
          setHasProfile(isProfileComplete(cached));
          if (cached.avatar_url) setAvatarUrl(cached.avatar_url);
          if (cached.current_weight_kg) setCurrentWeight(cached.current_weight_kg);
          const cachedAt = localCache.cachedAt(uid, "profiles");
          if (cachedAt !== null && Date.now() - cachedAt > PROFILE_STALE_AFTER_MS) {
            setIsProfileStale(true);
          }
        }
      }
      return;
    }

    if (profileFromConvex === null) {
      // Authenticated but no profile row yet (or query returned no data).
      setHasProfile(false);
      return;
    }

    // Fresh data from Convex.
    const next = profileFromConvex;
    const uid = next.id ?? userIdRef.current ?? null;
    const changed = JSON.stringify(next) !== JSON.stringify(profileRef.current);
    if (changed) {
      if (haveAIFieldsChanged(profileRef.current, next) && uid) {
        AIPersistence.clearAllForUser(uid);
      }
      setProfile(next);
      profileRef.current = next;
      setHasProfile(isProfileComplete(next));
      if (next.avatar_url) setAvatarUrl(next.avatar_url);
      if (next.current_weight_kg != null) setCurrentWeight(next.current_weight_kg);
      if (uid) localCache.set(uid, "profiles", next);
    }
    setIsProfileStale(false);
    setAuthTimedOut(false);
    setAuthError(false);
  }, [profileFromConvex]);

  // ── Public-interface stubs ──────────────────────────────────────────
  // These exist so consumers that imperatively call them (legacy Supabase
  // patterns) keep working. With Convex, the underlying query is reactive
  // — calling these is effectively a no-op, but we keep them async so
  // existing `await refreshProfile()` chains don't change semantics.

  const checkSessionValidity = useCallback(async (): Promise<boolean> => {
    // Convex maintains the WebSocket; if `isAuthenticated` is true, the
    // session is valid by definition.
    return isAuthenticated;
  }, [isAuthenticated]);

  const refreshSession = useCallback(async (): Promise<boolean> => {
    // Convex Auth refreshes tokens transparently. Nothing to do.
    return isAuthenticated;
  }, [isAuthenticated]);

  const refreshProfile = useCallback(async (): Promise<boolean> => {
    // Convex queries auto-invalidate when their underlying data changes,
    // so a manual "refresh" is generally unnecessary. We keep the method
    // for backward-compatibility with existing call sites.
    return profileRef.current !== null;
  }, []);

  const loadCutPlan = useCallback(async (): Promise<any | null> => {
    // Cut plan now lives in the profile row served by `profiles.getMine`.
    // Phase 3 may split this into a separate query if payload size warrants it.
    return profileRef.current?.cut_plan_json ?? null;
  }, []);

  const loadUserData = useCallback(async (): Promise<void> => {
    // Convex Auth bootstraps automatically on app mount. Keep this method
    // for callers (retry buttons, app-resume handlers) that imperatively
    // want to "re-trigger" auth — but it's effectively a no-op now.
    setAuthError(false);
    setAuthTimedOut(false);
  }, []);

  const retryAuth = useCallback(async () => {
    setAuthError(false);
    setAuthTimedOut(false);
    await loadUserData();
  }, [loadUserData]);

  // ── Username / weight / avatar mutations (Convex-wired) ─────────────
  const updateUserName = useCallback((name: string) => {
    setUserName(name);
    const uid = userIdRef.current;
    if (uid && uid !== "pending") {
      try { localStorage.setItem(`user_name_${uid}`, name); } catch { /* ignore */ }
    }
    // Fire-and-forget DB write; Convex query reactivity refreshes profile.
    setUserNameMut({ displayName: name }).catch(err => {
      logger.warn("setUserName mutation failed", { err: String(err) });
    });
  }, [setUserNameMut]);

  // Avatar uploads now go directly through the Convex Storage flow
  // (`api.profiles.generateAvatarUploadUrl` + `api.profiles.setAvatar`) inside
  // ProfilePictureUpload.tsx. The new URL flows back here via the reactive
  // `profiles.getMine` query, so this setter just nudges the local state
  // (mostly useful for the "remove avatar" path, where the consumer passes
  // an empty string and we want the optimistic UI to clear immediately).
  const updateAvatarUrl = useCallback((url: string) => {
    setAvatarUrl(url);
  }, []);

  const updateCurrentWeight = useCallback(async (weight: number) => {
    setCurrentWeight(weight);
    setProfile(prev => {
      const updated = prev ? { ...prev, current_weight_kg: weight } : prev;
      profileRef.current = updated;
      return updated;
    });
    try {
      await updateCurrentWeightMut({ weightKg: weight });
    } catch (err) {
      logger.warn("updateCurrentWeight mutation failed", { err: String(err) });
    }
  }, [updateCurrentWeightMut]);

  // ── Sign out ────────────────────────────────────────────────────────
  const signOut = useCallback(async () => {
    stopCacheCleanup();
    const uid = userIdRef.current;
    if (uid && uid !== "pending") {
      localCache.clearUser(uid);
      nutritionCache.clearUser(uid);
    }
    if (uid && uid !== "pending") {
      clearLocalSubscriptionState(uid);
    }
    // Clear local state immediately so the UI updates without waiting.
    setUserName("");
    setAvatarUrl("");
    setCurrentWeight(null);
    setProfile(null);
    profileRef.current = null;
    setHasProfile(false);
    setIsProfileStale(false);
    setAuthTimedOut(false);

    try {
      await convexSignOut();
    } catch (err) {
      logger.warn("convex signOut failed", { err: String(err) });
    }
  }, [convexSignOut]);

  // ── Cache cleanup lifecycle ─────────────────────────────────────────
  useEffect(() => {
    if (isAuthenticated) {
      startCacheCleanup();
      return () => stopCacheCleanup();
    }
  }, [isAuthenticated]);

  // ── Name fallback from email (cold-start UX) ────────────────────────
  // Once the profile row arrives, `display_name` overwrites this.
  useEffect(() => {
    if (!isAuthenticated) return;
    const uid = userIdRef.current;
    if (!uid || uid === "pending") return;
    if (userName) return; // already set
    const savedName = localStorage.getItem(`user_name_${uid}`);
    if (savedName) {
      setUserName(savedName);
    }
  }, [isAuthenticated, userName]);

  useEffect(() => {
    if (profile?.display_name && profile.display_name.trim()) {
      setUserName(profile.display_name);
      const uid = userIdRef.current;
      if (uid && uid !== "pending") {
        try { localStorage.setItem(`user_name_${uid}`, profile.display_name); } catch {}
      }
    }
  }, [profile?.display_name]);

  // ── Capacitor app-resume handler ────────────────────────────────────
  // Convex auto-reconnects its WebSocket on resume, so the manual session
  // validation / realtime cycling logic of the Supabase era is no longer
  // necessary. We keep the listener registered just to log the resume and
  // let Convex handle reconnection naturally.
  useEffect(() => {
    let appResumeHandle: { remove: () => void } | null = null;
    let visibilityHandler: (() => void) | null = null;

    const handleAppResume = () => {
      logger.info("App resumed — letting Convex reconnect naturally");
    };

    if (Capacitor.isNativePlatform()) {
      let cleanedUp = false;
      CapacitorApp.addListener("appStateChange", ({ isActive }) => {
        if (isActive) handleAppResume();
      })
        .then(h => {
          if (cleanedUp) h.remove();
          else appResumeHandle = h;
        })
        .catch(err => {
          logger.warn("appStateChange listener attach failed", { err: String(err) });
        });
      (handleAppResume as any).__capacitorCleanup = () => { cleanedUp = true; };
    } else {
      visibilityHandler = () => {
        if (document.visibilityState === "visible") handleAppResume();
      };
      document.addEventListener("visibilitychange", visibilityHandler);
    }

    return () => {
      if (Capacitor.isNativePlatform()) {
        const flip = (handleAppResume as any).__capacitorCleanup as (() => void) | undefined;
        flip?.();
        appResumeHandle?.remove();
        appResumeHandle = null;
      } else if (visibilityHandler) {
        document.removeEventListener("visibilitychange", visibilityHandler);
      }
    };
  }, []);

  // ── Network online/offline detection ────────────────────────────────
  useEffect(() => {
    const handleOnline = () => setIsOffline(false);
    const handleOffline = () => setIsOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // ── Role resolution ─────────────────────────────────────────────────
  // Priority:
  //   1. profile.role (authoritative once the Convex query lands)
  //   2. localStorage("wcw_intended_role") — set during signup so coaches
  //      aren't bounced into fighter onboarding while profile is still loading.
  //
  // We dropped the JWT user_metadata path (Convex Auth doesn't have an
  // equivalent free-form metadata; role lives in the profiles row).
  const isCoach = useMemo(() => {
    if (profile?.role === "coach") return true;
    if (profile?.role === "fighter") return false;
    try {
      const ls = localStorage.getItem("wcw_intended_role");
      if (ls === "coach") return true;
    } catch {}
    return false;
  }, [profile?.role]);
  const isRoleResolved = !isAuthLoading;

  const isSessionValid = isAuthenticated;
  const isLoading = isAuthLoading;

  const authValue = useMemo(() => ({
    userId: userId === "pending" ? null : userId,
    isSessionValid,
    isLoading,
    hasProfile,
    authError,
    authTimedOut,
    isOffline,
    isCoach,
    isRoleResolved,
    retryAuth,
    checkSessionValidity,
    refreshSession,
    loadUserData,
    signOut,
  }), [userId, isSessionValid, isLoading, hasProfile, authError, authTimedOut, isOffline, isCoach, isRoleResolved,
       retryAuth, checkSessionValidity, refreshSession, loadUserData, signOut]);

  const profileValue = useMemo(() => ({
    profile,
    userName,
    avatarUrl,
    currentWeight,
    isProfileStale,
    setUserName: updateUserName,
    setAvatarUrl: updateAvatarUrl,
    refreshProfile,
    updateCurrentWeight,
    loadCutPlan,
  }), [profile, userName, avatarUrl, currentWeight, isProfileStale,
       updateUserName, updateAvatarUrl, refreshProfile, updateCurrentWeight, loadCutPlan]);

  return (
    <AuthContext.Provider value={authValue}>
      <ProfileContext.Provider value={profileValue}>
        {children}
      </ProfileContext.Provider>
    </AuthContext.Provider>
  );
}

const AUTH_FALLBACK: AuthContextType = {
  userId: null,
  hasProfile: false,
  isLoading: true,
  authError: false,
  authTimedOut: false,
  isSessionValid: false,
  isOffline: false,
  isCoach: false,
  isRoleResolved: false,
  retryAuth: async () => {},
  checkSessionValidity: async () => false,
  refreshSession: async () => false,
  loadUserData: async () => {},
  signOut: async () => {},
};

const PROFILE_FALLBACK: ProfileContextType = {
  profile: null,
  userName: "",
  avatarUrl: null as any,
  currentWeight: null,
  isProfileStale: false,
  setUserName: () => {},
  setAvatarUrl: () => {},
  refreshProfile: async () => false,
  updateCurrentWeight: async () => {},
  loadCutPlan: async () => null,
};

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) return AUTH_FALLBACK;
  return context;
}

export function useProfile() {
  const context = useContext(ProfileContext);
  if (context === undefined) return PROFILE_FALLBACK;
  return context;
}

export function useUser(): UserContextType {
  const auth = useAuth();
  const profile = useProfile();
  return { ...auth, ...profile };
}
