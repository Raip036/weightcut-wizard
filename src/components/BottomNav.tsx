import { Home, Utensils, Flag, Users, X, Camera, type LucideIcon } from "lucide-react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import React, { useState, useEffect, useLayoutEffect, useMemo, useRef, memo } from "react";
import { motion, useAnimationControls, type TargetAndTransition } from "motion/react";
import { triggerHaptic, triggerHapticSelection } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useToast } from "@/hooks/use-toast";
import { useProfile, useUser, useAuth } from "@/contexts/UserContext";
import { useTutorial } from "@/tutorial/useTutorial";
import { capturePhotoBase64 } from "@/lib/capturePhoto";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { SettingsPanel } from "@/components/nav/SettingsPanel";
import { ReviewSheet } from "@/components/community/ReviewSheet";
import {
  useRoundCardCapture,
  useRoundCardTooltip,
} from "@/hooks/useRoundCardCapture";
import {
  RadialActionDial,
  type RadialActionOption,
} from "@/components/nav/RadialActionDial";

const mainNavItems = [
  { title: "Home", url: "/dashboard", icon: Home },
  { title: "Camp", url: "/camp", icon: Flag },
  { title: "Community", url: "/community", icon: Users },
  { title: "Nutrition", url: "/nutrition", icon: Utensils },
];

// Per-path lazy-chunk prefetcher — fires on `pointerdown` for each tab so
// the destination's bundle is loading by the time the user's finger lifts.
// Pairs with the idle preload in `App.tsx` for the cold-launch case where
// the user taps a tab before `requestIdleCallback` has run. All paths here
// must match the lazy() targets in App.tsx — keep them in sync.
//
// Errors are swallowed: a failed prefetch isn't fatal, the real navigation
// will still hit <Suspense fallback> and try again with the route's
// ErrorBoundary as a safety net.
const PREFETCH_BY_PATH: Record<string, () => Promise<unknown>> = {
  "/dashboard": () => import("@/pages/Dashboard"),
  "/camp": () => import("@/pages/Camp"),
  "/community": () => import("@/pages/Community"),
  "/nutrition": () => import("@/pages/nutrition/NutritionPage"),
};

const prefetchRoute = (path: string) => {
  PREFETCH_BY_PATH[path]?.().catch(() => {});
};

export const BottomNav = memo(function BottomNav() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { userName, avatarUrl, setUserName, setAvatarUrl } = useProfile();
  const { userId, profile, refreshProfile } = useUser();
  const { signOut } = useAuth();
  const deleteAccount = useAction(api.actions.deleteAccount.run);
  const updateGoalsMut = useMutation(api.profiles.updateGoals);
  const authUser = useQuery(api.profiles.getMyAuthUser, userId ? {} : "skip");
  // Gym-feed engagement badge. Reactive — `useQuery` auto-updates whenever
  // a like/comment lands on one of the user's posts. We render a red dot
  // on the More icon when the count is > 0 (cleared when the user opens
  // `/gym-feed`, which marks `lastSeenEngagementAt = now`).
  const unreadEngagement = useQuery(
    api.feedSocial.unreadEngagementCount,
    userId && userId !== "pending" ? {} : "skip",
  );
  const hasUnreadFeedEngagement = (unreadEngagement?.count ?? 0) > 0;
  const { replayTutorial } = useTutorial();
  const goalType = (profile?.goal_type as 'cutting' | 'losing') ?? 'cutting';
  const [settingsDialogOpen, setSettingsDialogOpen] = useState(false);
  const [logoutDialogOpen, setLogoutDialogOpen] = useState(false);
  const [deleteAccountDialogOpen, setDeleteAccountDialogOpen] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [editedName, setEditedName] = useState(userName);
  const [userEmail, setUserEmail] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    const saved = localStorage.getItem("theme") as "light" | "dark" | null;
    return saved || "dark";
  });

  // ─── Round-card photo-first capture wiring (spec §3.1 / §3.5) ────────
  //
  // Smart defaults pre-fill the ReviewSheet chips. The query is cheap
  // and reactive; we let it run continuously rather than gating on
  // sheet-open so the first capture's sheet renders with real defaults
  // rather than the constant fallback (the sheet opens immediately after
  // shutter, so deferring the fetch would always lose the race).
  const smartDefaults = useQuery(
    api.fight_camp.getSmartDefaults,
    userId && userId !== "pending" ? {} : "skip",
  );
  const roundCard = useRoundCardCapture({ smartDefaults: smartDefaults ?? undefined });
  const tooltip = useRoundCardTooltip();

  // ─── Camera FAB gesture wiring ────────────────────────────────────────
  // Tap fires the training-session capture flow (round-card photo →
  // ReviewSheet) synchronously inside the pointer handler — iOS WKWebView
  // requires the gesture token to be live when `Camera.getPhoto` runs (see
  // `useRoundCardCapture.beginCapture`).
  //
  // Long-press is handled inside `RadialActionDial`: it opens a radial
  // menu with two options (Nutrition / Training). Selecting one fires the
  // corresponding capture handler, again inside the gesture token where
  // possible.
  const dialOptions: RadialActionOption[] = useMemo(
    () => [
      { id: "nutrition", label: "Nutrition", iconName: "restaurantOutline", tone: "primary" },
      { id: "training", label: "Training", iconName: "pulseOutline", tone: "amber" },
    ],
    [],
  );

  const handleTrainingCapture = () => {
    // Same synchronous entry-point as the previous tap branch — keeps the
    // iOS gesture-token alive for `Camera.getPhoto`.
    roundCard.beginCapture();
    tooltip.dismiss();
  };

  const handleNutritionCapture = async () => {
    tooltip.dismiss();
    // Fire camera synchronously, navigate after the photo resolves. The
    // Nutrition page detects `aiPhoto` in router state and runs the
    // analyze flow without re-prompting the camera.
    const { base64, reason } = await capturePhotoBase64();
    navigate("/nutrition", { state: { aiPhoto: base64 ?? null, captureFailed: reason ?? null } });
  };

  const handleDialSelect = (optionId: string) => {
    if (optionId === "nutrition") {
      void handleNutritionCapture();
    } else if (optionId === "training") {
      handleTrainingCapture();
    }
  };

  const handleCameraTap = () => {
    handleTrainingCapture();
  };

  useEffect(() => {
    setEditedName(userName);
  }, [userName]);

  // Open settings panel via custom event — triggered from Dashboard avatar or Profile page
  useEffect(() => {
    const openSettings = () => {
      setEditedName(userName);
      setSettingsDialogOpen(true);
      if (authUser?.email) setUserEmail(authUser.email);
    };
    window.addEventListener('wcw:open-settings', openSettings);
    return () => window.removeEventListener('wcw:open-settings', openSettings);
  }, [userName, authUser?.email]);

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
    document.documentElement.classList.toggle("dark", newTheme === "dark");
    triggerHapticSelection();
  };

  const handleSettings = async () => {
    setEditedName(userName);
    setSettingsDialogOpen(true);
    if (authUser?.email) setUserEmail(authUser.email);
  };

  const handleToggleGoalType = async (fighterMode: boolean) => {
    if (!userId) return;
    const newType = fighterMode ? 'cutting' : 'losing';
    try {
      // Pass `0` to clear the fight-week target — Convex's updateGoals only
      // patches defined keys, so we send the sentinel and the backend ignores
      // non-cutting flows for that field via the form-level UI guard.
      await updateGoalsMut({
        goalType: newType,
        ...(newType === 'losing' ? { fightWeekTargetKg: 0 } : {}),
      });
      await refreshProfile();
      triggerHapticSelection();
      if (newType === 'cutting') {
        toast({ description: "Fighter mode enabled. Set your fight week target in Goals." });
        setSettingsDialogOpen(false);
        navigate("/goals");
      } else {
        toast({ description: "Switched to weight loss mode." });
      }
    } catch {
      toast({ description: "Failed to update mode.", variant: "destructive" });
    }
  };

  const handleReplayTutorial = () => {
    setSettingsDialogOpen(false);
    navigate("/dashboard");
    setTimeout(() => replayTutorial("onboarding"), 600);
  };

  const handleUpdateProfile = async () => {
    try {
      setUserName(editedName);
      setSettingsDialogOpen(false);
    } catch {
      toast({ description: "Failed to update profile", variant: "destructive" });
    }
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutDialogOpen(false);
    await signOut();
    navigate("/auth");
    toast({ title: "Signed out", description: "You have been successfully signed out." });
    setLoggingOut(false);
  };

  const handleDeleteAccount = async () => {
    setDeleteLoading(true);
    try {
      await deleteAccount({});
      await signOut();
      setDeleteAccountDialogOpen(false);
      setSettingsDialogOpen(false);
      navigate("/auth");
      toast({ title: "Account deleted", description: "Your account and all data have been permanently deleted." });
    } catch (err) {
      // Surface the real error message so we (and the user) can tell
      // which step of the cascade failed instead of a generic retry hint.
      const message = err instanceof Error ? err.message : String(err);
      toast({
        title: "Could not delete account",
        description: message,
        variant: "destructive",
      });
    } finally {
      setDeleteLoading(false);
    }
  };

  const HomeIcon = mainNavItems[0].icon;
  const CampIcon = mainNavItems[1].icon;
  const CommunityIcon = mainNavItems[2].icon;
  const NutritionIcon = mainNavItems[3].icon;

  // ───────────────────────────────────────────────────────────────────────
  // Active-tab bubble — single-element pattern
  // ───────────────────────────────────────────────────────────────────────
  // We render ONE absolutely-positioned motion.div inside the nav pill and
  // animate its `x` + `width` to match the active tab's measured rect. The
  // previous implementation conditionally mounted a motion.div inside each
  // tab and relied on Framer's `layoutId` shared-element transition to
  // bridge between mounts — that pattern is fragile inside WKWebView and
  // under React-Router-driven re-renders, and would snap rather than glide.
  // With a single element that never unmounts, Framer's `animate` prop
  // simply springs `x` and `width` between values and the glide always
  // works.
  // ───────────────────────────────────────────────────────────────────────
  const tabRefs = useRef<Array<HTMLElement | null>>([]);
  const [bubble, setBubble] = useState<{ x: number; width: number; visible: boolean }>({
    x: 0,
    width: 0,
    visible: false,
  });

  // Resolve which of the 5 nav slots (0=Home, 1=Nutrition, 2=Gym,
  // 3=Nutrition) the current route maps to. -1 means none → bubble hides.
  const campSubRoutes = ['/training-calendar', '/fight-camps', '/gym', '/weight-protocol', '/training-library'];
  const activeIndex = useMemo(() => {
    const mainHit = mainNavItems.findIndex((item) => location.pathname === item.url);
    if (mainHit >= 0) return mainHit;
    if (campSubRoutes.some((r) => location.pathname === r || location.pathname.startsWith(r + '/'))) return 1;
    if (location.pathname.startsWith('/profile/') || location.pathname === '/my-gym') return 2;
    return -1;
  }, [location.pathname]);

  // Measure synchronously after layout so the bubble settles on the right
  // tab on first paint (no flicker). Re-runs whenever the active tab
  // changes, the viewport resizes (tab widths are flex-1 so they shift
  // with the container), or `isMobile` flips from false → true.
  //
  // `isMobile` is in the deps for an important reason: `useIsMobile`
  // returns `false` on the very first render (it initialises before its
  // own useEffect runs `matchMedia`). On that first render the nav's JSX
  // returns null below, so the tab refs are never attached. When
  // `isMobile` then flips to `true`, the JSX mounts and the refs attach
  // — but without `isMobile` in this dep array, the layout effect would
  // not re-run (activeIndex hasn't changed), `tabRefs.current[…]` would
  // stay null, and the bubble would stay invisible until the user
  // navigated to a different tab.
  useLayoutEffect(() => {
    if (!isMobile) return;
    const measure = () => {
      if (activeIndex < 0) {
        setBubble((prev) => ({ ...prev, visible: false }));
        return;
      }
      const el = tabRefs.current[activeIndex];
      if (!el) return;
      setBubble({ x: el.offsetLeft, width: el.offsetWidth, visible: true });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [activeIndex, isMobile]);

  if (!isMobile) return null;

  return (
    <>
      {/* CRITICAL: the .glass-nav element MUST be a static element with
          no transform / will-change / opacity-animation / filter. WKWebView
          has a long-standing bug where any of those properties — even on
          the same element as backdrop-filter — silently disables the blur.
          Previous attempts had `motion.div` wrapping the glass element
          for the entrance slide-up, and Framer Motion's persistent
          `transform: translateY(0px)` (left after the animation ends)
          was enough to kill the blur. The entrance animation has been
          removed entirely from the nav pill; the bubble and the per-
          icon tap animations live INSIDE the glass element (which is
          fine — descendants don't break their ancestor's backdrop-
          filter, only ancestors break descendants').
          See: https://bugs.webkit.org/show_bug.cgi?id=212706 */}
      <div
        data-bottom-nav
        data-hide-when-keyboard
        className="fixed inset-x-0 z-[9999] md:hidden flex items-center justify-center gap-2 pointer-events-none"
        /* iOS reports `safe-area-inset-bottom` ≈ 34px on home-indicator
           devices, but the indicator BAR itself only occupies the
           bottom ~10–13px of the screen — the remaining ~20px is just
           Apple's recommended margin. Sitting flush with the safe-area
           top edge therefore leaves a visible gap above the bar. We
           subtract 1rem (16px) so the nav floats just above the
           indicator bar with only ~5px of breathing room. `max()`
           keeps the nav at least 4px above the screen bottom on
           older devices where the safe-area inset is 0. */
        style={{
          bottom: "max(0.25rem, calc(env(safe-area-inset-bottom, 0px) - 1rem))",
        }}
      >
        <div
          /* Bottom-nav pill — glass recipe (Design System v1) via
             `.glass-nav`. Width ~74vw capped at 20rem (compact mobile
             tab bar). `pointer-events-auto` re-enables tap on the nav
             itself (the outer wrapper has pointer-events-none so taps
             pass through to page content elsewhere along the bottom).
             Horizontal padding 10px (`px-2.5`) leaves a ~4px gap
             between the bubble (which overhangs each tab by 6px) and
             the nav's outer edge, matching the 4px top/bottom gap
             (top-1 bottom-1) for symmetric breathing room. */
          className="pointer-events-auto relative flex items-stretch gap-2 px-2.5 py-1.5 w-[74vw] max-w-[20rem] rounded-pill glass-nav"
        >
          {/* Internal darkening overlay — kept LIGHT (0.18 → 0.32) so
              the nav still reads as glass rather than solid plastic.
              Paired with the surface (rgba(8,12,20,0.62)) and the
              50px backdrop-blur, this is enough to wash out and
              obscure content behind the nav without fully opaquing
              it. Sits below the bubble and tabs (which have z-10) so
              neither is darkened by it. */}
          <div
            aria-hidden
            className="absolute inset-0 rounded-pill pointer-events-none"
            style={{
              background:
                "linear-gradient(180deg, rgba(20, 24, 35, 0.18), rgba(8, 12, 20, 0.32))",
            }}
          />
          <motion.div
            aria-hidden
            /* Explicit `left-0 top-1 bottom-1` keeps the bubble pinned
               to the parent's inner edges with 4px breathing room top
               and bottom. `rounded-pill` gives fully rounded semi-
               circular ends. We widen the bubble's animated x/width by
               6px on each horizontal side so the pill extends slightly
               past the tab content — fatter pill, more present.
               NOTE: do NOT use `rounded-l` — Tailwind treats it as the
               directional shorthand for "left corners only" and
               produces a flat-right-edge bug. */
            className="absolute left-0 top-1 bottom-1 rounded-pill bg-[rgba(139,126,234,0.12)] pointer-events-none"
            initial={false}
            animate={{
              x: bubble.x - 6,
              width: bubble.width + 12,
              opacity: bubble.visible ? 1 : 0,
            }}
            transition={{ type: "spring", stiffness: 350, damping: 32, mass: 0.7 }}
          />
          <NavItem
            ref={(el) => { tabRefs.current[0] = el; }}
            to={mainNavItems[0].url}
            icon={HomeIcon}
            label={mainNavItems[0].title}
            tutorial="nav-home"
            isActive={activeIndex === 0}
            tapAnimation={TAP_ANIMATIONS.home}
            onPointerDown={() => prefetchRoute(mainNavItems[0].url)}
          />
          <NavItem
            ref={(el) => { tabRefs.current[1] = el; }}
            to={mainNavItems[1].url}
            icon={CampIcon}
            label={mainNavItems[1].title}
            tutorial="nav-camp"
            isActive={activeIndex === 1}
            tapAnimation={TAP_ANIMATIONS.nutrition}
            onPointerDown={() => prefetchRoute(mainNavItems[1].url)}
          />
          <NavItemWithBadge
            ref={(el) => { tabRefs.current[2] = el; }}
            to={mainNavItems[2].url}
            icon={CommunityIcon}
            label={mainNavItems[2].title}
            tutorial="nav-community"
            isActive={activeIndex === 2}
            tapAnimation={TAP_ANIMATIONS.gym}
            badge={hasUnreadFeedEngagement}
            onPointerDown={() => prefetchRoute(mainNavItems[2].url)}
          />
          <NavItem
            ref={(el) => { tabRefs.current[3] = el; }}
            to={mainNavItems[3].url}
            icon={NutritionIcon}
            label={mainNavItems[3].title}
            tutorial="nav-nutrition"
            isActive={activeIndex === 3}
            tapAnimation={TAP_ANIMATIONS.weight}
            onPointerDown={() => prefetchRoute(mainNavItems[3].url)}
          />
        </div>

        {/* Camera FAB — blue circle alongside the nav pill.
            Tap = training session capture (round-card photo →
            ReviewSheet). Long-press opens the RadialActionDial with
            Nutrition + Training options. The dial owns its own gesture
            detection — we hand it the trigger as children and wire
            `onTap` / `onSelect` to the same handlers a direct tap or a
            dial-option select would call. */}
        <div className="pointer-events-auto">
          <RoundCardFab
            options={dialOptions}
            onTap={handleCameraTap}
            onSelect={handleDialSelect}
            tooltip={tooltip}
          />
        </div>
      </div>

      {/* Round-card photo-first review sheet — opens after the FAB tap
          captures a photo. The hook owns the state machine; we feed it
          smart defaults from `getSmartDefaults` (falling back to the
          spec constants when the query is still in-flight). */}
      <ReviewSheet
        open={roundCard.reviewing}
        photoBlob={roundCard.photoBlob}
        defaults={roundCard.defaults}
        onSubmit={roundCard.submit}
        onDiscard={roundCard.discard}
        developing={roundCard.developing}
      />

      <SettingsPanel
        open={settingsDialogOpen}
        onClose={() => setSettingsDialogOpen(false)}
        userName={userName}
        userEmail={userEmail}
        avatarUrl={avatarUrl}
        editedName={editedName}
        setEditedName={setEditedName}
        theme={theme}
        onToggleTheme={toggleTheme}
        onAvatarChange={(url) => {
          setAvatarUrl(url);
        }}
        onSave={handleUpdateProfile}
        onReplayTutorial={handleReplayTutorial}
        onDeleteAccount={() => { setSettingsDialogOpen(false); setDeleteAccountDialogOpen(true); }}
        goalType={goalType}
        onToggleGoalType={handleToggleGoalType}
      />

      {/* Logout Confirmation Dialog */}
      <AlertDialog open={logoutDialogOpen} onOpenChange={setLogoutDialogOpen}>
        <AlertDialogContent className="max-w-[240px] rounded-xs p-0 border-0 bg-card/90 backdrop-blur-xl overflow-hidden gap-0">
          <VisuallyHidden><AlertDialogTitle>Sign Out</AlertDialogTitle></VisuallyHidden>
          <AlertDialogDescription asChild>
            <div className="pt-4 pb-3 px-4 text-center">
              <p className="text-[15px] font-semibold text-foreground">Sign Out</p>
              <p className="text-[13px] text-muted-foreground mt-0.5 leading-snug">
                Are you sure? You'll need to sign in again.
              </p>
            </div>
          </AlertDialogDescription>
          <div className="border-t border-border/40">
            <button onClick={handleLogout} className="w-full py-2.5 text-[14px] font-semibold text-destructive active:bg-muted/50 transition-colors">
              Sign Out
            </button>
            <div className="border-t border-border/40" />
            <button onClick={() => setLogoutDialogOpen(false)} className="w-full py-2.5 text-[14px] font-normal text-primary active:bg-muted/50 transition-colors">
              Cancel
            </button>
          </div>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Account Confirmation Dialog */}
      <AlertDialog open={deleteAccountDialogOpen} onOpenChange={(open) => { if (!deleteLoading) setDeleteAccountDialogOpen(open); }}>
        <AlertDialogContent className="max-w-[240px] rounded-xs p-0 border-0 bg-card/90 backdrop-blur-xl overflow-hidden gap-0">
          <VisuallyHidden><AlertDialogTitle>Delete Account</AlertDialogTitle></VisuallyHidden>
          <AlertDialogDescription asChild>
            <div className="pt-4 pb-3 px-4 text-center">
              <p className="text-[15px] font-semibold text-foreground">Delete Account</p>
              <p className="text-[13px] text-muted-foreground mt-0.5 leading-snug">
                This will permanently delete your account and all data. This cannot be undone.
              </p>
            </div>
          </AlertDialogDescription>
          <div className="border-t border-border/40">
            <button
              onClick={handleDeleteAccount}
              disabled={deleteLoading}
              className="w-full py-2.5 text-[14px] font-semibold text-destructive active:bg-muted/50 transition-colors disabled:opacity-40"
            >
              {deleteLoading ? "Deleting..." : "Delete Account"}
            </button>
            <div className="border-t border-border/40" />
            <button
              onClick={() => setDeleteAccountDialogOpen(false)}
              disabled={deleteLoading}
              className="w-full py-2.5 text-[14px] font-normal text-primary active:bg-muted/50 transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});

/* Shared layout class for every tab slot. h-11 (44px) — Apple's
   recommended minimum touch target. Icon (22px) + 3px gap + 14px
   label = ~39px content, leaving ~3px of vertical breathing room.
   With p-1.5 (12px total y-padding) the nav pill ends up ~56px tall. */
const NAV_SLOT_CLASS =
  "relative z-10 flex flex-1 flex-col items-center justify-center gap-[3px] h-11 px-2 rounded-pill";

/* Color helpers — active is white, inactive is the neutral grey from the
   Figma nav. Applied to both the icon and the label so they switch in
   lockstep when the active tab changes. */
const navTextColor = (isActive: boolean) =>
  isActive ? "text-white" : "text-[#8A95A6]";

/* Per-tab tap micro-animations. Each one targets the icon's wrapping
   motion.span via useAnimationControls — playing on click only, not on
   active-state change. Each tab has a slightly different signature so
   the nav has personality without anything feeling busy. */
export const TAP_ANIMATIONS = {
  // Home: confident scale pulse.
  home:      { scale: [1, 1.25, 1], transition: { duration: 0.35, ease: "easeOut" } },
  // Nutrition: utensils give a little shake (like cutlery being picked up).
  nutrition: { rotate: [0, -15, 12, -6, 0], transition: { duration: 0.45 } },
  // Gym: friends icon hops once.
  gym:       { y: [0, -5, 0], transition: { duration: 0.35, ease: "easeOut" } },
  // Weight: subtle wobble — like a scale settling. (Previously a full
  // 360° spin which felt too aggressive against the rest of the row.)
  weight:    { rotate: [0, -12, 8, -3, 0], transition: { duration: 0.4, ease: "easeOut" } },
  // More: squish-and-pop (three dots compress then bounce back).
  more:      { scaleY: [1, 0.7, 1.1, 1], transition: { duration: 0.4 } },
} satisfies Record<string, TargetAndTransition>;

interface NavItemProps {
  to: string;
  icon: LucideIcon;
  label: string;
  isActive: boolean;
  tutorial?: string;
  tapAnimation?: TargetAndTransition;
  /** Fired on `pointerdown` — used to kick off lazy-chunk prefetch for
   *  the destination route so by the time the finger lifts (and the
   *  NavLink actually navigates) the page bundle is already in cache.
   *  Eliminates the Suspense skeleton flash on first navigation. */
  onPointerDown?: () => void;
}

const NavItem = React.forwardRef<HTMLAnchorElement, NavItemProps>(
  function NavItem({ to, icon: Icon, label, isActive, tutorial, tapAnimation, onPointerDown }, ref) {
    const iconControls = useAnimationControls();
    const handleClick = () => {
      triggerHaptic(ImpactStyle.Light);
      if (tapAnimation) iconControls.start(tapAnimation);
    };
    return (
      <NavLink
        ref={ref}
        to={to}
        data-tutorial={tutorial}
        onClick={handleClick}
        onPointerDown={onPointerDown}
        aria-label={label}
        className={NAV_SLOT_CLASS}
      >
        <motion.span
          aria-hidden
          animate={iconControls}
          /* `initial` keeps the icon at its resting transform when the
             component first mounts. The controls then trigger a one-shot
             play on each click. */
          initial={{ scale: 1, rotate: 0, y: 0, scaleY: 1 }}
          className="relative inline-flex"
        >
          <Icon className={`h-[22px] w-[22px] ${navTextColor(isActive)}`} fill="none" strokeWidth={2} />
        </motion.span>
        <span className={`relative font-semibold text-[10px] leading-[14px] tracking-[0.1px] ${navTextColor(isActive)}`}>
          {label}
        </span>
      </NavLink>
    );
  },
);

interface NavItemWithBadgeProps extends NavItemProps {
  badge?: boolean;
}

/** NavItem variant that overlays a small red dot when `badge` is true.
 *  Currently unused (the Corner badge moved to More) but kept available
 *  if a future tab needs the same indicator. */
const NavItemWithBadge = React.forwardRef<HTMLAnchorElement, NavItemWithBadgeProps>(
  function NavItemWithBadge({ to, icon: Icon, label, isActive, tutorial, badge, tapAnimation, onPointerDown }, ref) {
    const iconControls = useAnimationControls();
    const handleClick = () => {
      triggerHaptic(ImpactStyle.Light);
      if (tapAnimation) iconControls.start(tapAnimation);
    };
    return (
      <NavLink
        ref={ref}
        to={to}
        data-tutorial={tutorial}
        onClick={handleClick}
        onPointerDown={onPointerDown}
        aria-label={label}
        className={NAV_SLOT_CLASS}
      >
        <motion.span
          aria-hidden
          animate={iconControls}
          initial={{ scale: 1, rotate: 0, y: 0, scaleY: 1 }}
          className="relative inline-flex"
        >
          <Icon className={`h-[22px] w-[22px] ${navTextColor(isActive)}`} fill="none" strokeWidth={2} />
        </motion.span>
        <span className={`relative font-semibold text-[10px] leading-[14px] tracking-[0.1px] ${navTextColor(isActive)}`}>
          {label}
        </span>
        {badge && (
          <span
            aria-hidden
            className="absolute top-1.5 right-2 h-2 w-2 rounded-full bg-destructive ring-2 ring-background"
          />
        )}
      </NavLink>
    );
  },
);

interface NavButtonProps {
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  isActive: boolean;
  tutorial?: string;
  /** When true, render a small red dot on the top-right of the icon to
   *  signal unread activity. Doesn't affect the click target. */
  badge?: boolean;
  tapAnimation?: TargetAndTransition;
}

const NavButton = React.forwardRef<HTMLButtonElement, NavButtonProps>(
  function NavButton({ onClick, icon: Icon, label, isActive, tutorial, badge, tapAnimation }, ref) {
    const iconControls = useAnimationControls();
    const handleClick = () => {
      if (tapAnimation) iconControls.start(tapAnimation);
      onClick();
    };
    return (
      <button
        ref={ref}
        onClick={handleClick}
        data-tutorial={tutorial}
        aria-label={label}
        className={NAV_SLOT_CLASS}
      >
        <motion.span
          aria-hidden
          animate={iconControls}
          initial={{ scale: 1, rotate: 0, y: 0, scaleY: 1 }}
          className="relative inline-flex"
        >
          <Icon className={`h-[22px] w-[22px] ${navTextColor(isActive)}`} fill="none" strokeWidth={2} />
        </motion.span>
        <span className={`relative font-semibold text-[10px] leading-[14px] tracking-[0.1px] ${navTextColor(isActive)}`}>
          {label}
        </span>
        {badge && (
          <span
            aria-hidden
            className="absolute top-1.5 right-2 h-2 w-2 rounded-full bg-destructive ring-2 ring-background"
          />
        )}
      </button>
    );
  },
);

interface RoundCardFabProps {
  /** Dial options to fan out on long-press. */
  options: RadialActionOption[];
  /** Fires on a simple tap (no long-press). */
  onTap: () => void;
  /** Fires when the user selects a dial option after a long-press. */
  onSelect: (optionId: string) => void;
  tooltip: ReturnType<typeof useRoundCardTooltip>;
}

/**
 * Photo-first FAB block — the raised camera circle and its one-time
 * discoverability popover. Lives as a separate component so `BottomNav`
 * stays under the 500-line project ceiling.
 *
 * Tap fires the training-session capture flow. Long-press opens a
 * radial dial (`RadialActionDial`) with Nutrition + Training options;
 * the dial owns all gesture detection and visuals for the fan-out.
 *
 * The tooltip popover is anchored to the FAB via `PopoverAnchor` (not
 * `PopoverTrigger asChild`) because the dial owns the trigger button
 * and renders its own pointer handlers — letting Radix clone props
 * onto the dial would race against those handlers.
 */
function RoundCardFab({ options, onTap, onSelect, tooltip }: RoundCardFabProps) {
  return (
    <Popover open={tooltip.open} onOpenChange={tooltip.setOpen}>
      <PopoverAnchor asChild>
        <div className="relative z-10">
          <RadialActionDial
            options={options}
            onTap={onTap}
            onSelect={onSelect}
            className="block"
          >
            <motion.div
              whileTap={{ scale: 0.88 }}
              transition={{ type: "spring", damping: 18, stiffness: 420 }}
              data-tutorial="nav-quick-log"
              className="h-[52px] w-[52px] rounded-full bg-primary flex items-center justify-center select-none touch-none"
              aria-hidden
            >
              <Camera className="h-[22px] w-[22px] text-primary-foreground" strokeWidth={2.4} />
            </motion.div>
          </RadialActionDial>
        </div>
      </PopoverAnchor>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={10}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-auto max-w-[260px] px-3 py-2 text-[12px]"
      >
        <div className="flex items-start gap-2">
          <p className="leading-snug text-foreground">
            Tap = training &middot; long-press for nutrition
          </p>
          <button
            type="button"
            aria-label="Dismiss tooltip"
            onClick={tooltip.dismiss}
            className="-mr-1 -mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.2} />
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
