import { Home, Utensils, Plus, Weight, Target, MoreHorizontal, Trophy, Calendar, HeartPulse, Dumbbell, TrendingDown, Moon, Users, X, type LucideIcon } from "lucide-react";
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
import { useMyGyms } from "@/hooks/coach/useMyGyms";
import { useTutorial } from "@/tutorial/useTutorial";
import { FIGHT_ONLY_PATHS, isFighter } from "@/lib/goalType";
import { capturePhotoBase64 } from "@/lib/capturePhoto";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { QuickLogDialog } from "@/components/nav/QuickLogDialog";
import { MoreMenuSheet } from "@/components/nav/MoreMenuSheet";
import { SettingsPanel } from "@/components/nav/SettingsPanel";
import { ReviewSheet } from "@/components/community/ReviewSheet";
import {
  useRoundCardCapture,
  useFabGesture,
  useRoundCardTooltip,
} from "@/hooks/useRoundCardCapture";

const mainNavItems = [
  { title: "Home", url: "/dashboard", icon: Home },
  { title: "Nutrition", url: "/nutrition", icon: Utensils },
  // "Gym" tab points at the gym-scoped social feed (/community). The
  // Users (people) icon reads as the social/friends meaning rather
  // than literal gym equipment; the Gym Tracker still lives in More.
  { title: "Gym", url: "/community", icon: Users },
  { title: "Weight", url: "/weight", icon: Weight },
];

const moreMenuItems = [
  { title: "Profile", url: "/goals", icon: Target },
  { title: "Fight Camps", url: "/fight-camps", icon: Trophy },
  { title: "Training Calendar", url: "/training-calendar", icon: Calendar },
  { title: "Recovery", url: "/recovery", icon: HeartPulse },
  { title: "Sleep", url: "/sleep", icon: Moon },
  { title: "Weight Cut", url: "/weight-cut", icon: TrendingDown },
  { title: "Gym Tracker", url: "/gym", icon: Dumbbell },
];

export const BottomNav = memo(function BottomNav() {
  const isMobile = useIsMobile();
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { userName, avatarUrl, setUserName, setAvatarUrl } = useProfile();
  const { userId, profile, refreshProfile } = useUser();
  // Only fetch gym memberships for athletes — coaches use the /coach surface
  const isAthlete = profile?.role !== "coach";
  const { gyms: myGyms } = useMyGyms(isAthlete ? userId : null);
  const primaryGym = myGyms[0] ?? null;
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
  const filteredMoreMenuItems = isFighter(goalType)
    ? moreMenuItems
    : moreMenuItems.filter(item => !FIGHT_ONLY_PATHS.includes(item.url));
  const [quickLogOpen, setQuickLogOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
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
  const fabGesture = useFabGesture({
    onTap: () => {
      // Synchronous tap branch — fires Camera.getPhoto inside the
      // pointerup handler before any React state propagates. See
      // `useRoundCardCapture.beginCapture` for the iOS gesture-token
      // constraint and the matching PostComposer pattern.
      roundCard.beginCapture();
      tooltip.dismiss();
    },
    onLongPress: () => {
      setQuickLogOpen(true);
      tooltip.dismiss();
    },
  });

  useEffect(() => {
    setEditedName(userName);
  }, [userName]);

  // Preload More menu page chunks when the menu opens
  useEffect(() => {
    if (moreMenuOpen) {
      import("../pages/Goals").catch(() => {});
      import("../pages/TrainingCalendar").catch(() => {});
      import("../pages/Recovery").catch(() => {});
      import("../pages/GymTracker").catch(() => {});
      if (isFighter(goalType)) {
        import("../pages/FightCamps").catch(() => {});
        import("../pages/WeightCut").catch(() => {});
      }
    }
  }, [moreMenuOpen, goalType]);

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
    document.documentElement.classList.toggle("dark", newTheme === "dark");
    triggerHapticSelection();
  };

  const handleLogFood = async () => {
    setQuickLogOpen(false);
    // Fire the camera FROM THIS TAP — iOS WKWebView requires the gesture
    // token to be live when `Camera.getPhoto({ source: Camera })` runs, and
    // any post-navigation `setTimeout` loses it (the plugin then silently
    // no-ops). The Capacitor plugin grabs the token in its first sync
    // instruction, so the small `await` for the lazy import is safe.
    const { base64, reason } = await capturePhotoBase64();
    // Always open the Nutrition page on the AI tab — even on cancel/deny —
    // so the user lands somewhere actionable rather than being stranded.
    // The base64 (if any) rides as router state; NutritionPage detects it
    // and runs the existing analyze flow with no further camera calls.
    navigate("/nutrition", { state: { aiPhoto: base64 ?? null, captureFailed: reason ?? null } });
  };

  const handleLogWeight = () => {
    setQuickLogOpen(false);
    navigate("/weight?focusWeightInput=true");
  };

  const handleLogTraining = () => {
    setQuickLogOpen(false);
    navigate("/training-calendar?openLogSession=true");
  };

  const handleLogGym = () => {
    setQuickLogOpen(false);
    navigate("/gym");
  };

  const handleMoreItemClick = (url: string) => {
    setMoreMenuOpen(false);
    navigate(url);
  };

  const handleSettings = async () => {
    setMoreMenuOpen(false);
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
    setMoreMenuOpen(false);
    navigate("/dashboard");
    setTimeout(() => replayTutorial("onboarding"), 600);
  };

  const handleUpdateProfile = async () => {
    try {
      setUserName(editedName);
      setSettingsDialogOpen(false);
    } catch (error) {
      toast({ description: "Failed to update profile", variant: "destructive" });
    }
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    setLogoutDialogOpen(false);
    setMoreMenuOpen(false);
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
  const NutritionIcon = mainNavItems[1].icon;
  // Gym tab uses the Users (social/friends) icon — see mainNavItems comment.
  const GymIcon = mainNavItems[2].icon;
  const WeightIcon = mainNavItems[3].icon;

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
  // 3=Weight, 4=More) the current route maps to. -1 means none → bubble
  // hides.
  const activeIndex = useMemo(() => {
    const mainHit = mainNavItems.findIndex((item) => location.pathname === item.url);
    if (mainHit >= 0) return mainHit;
    if (filteredMoreMenuItems.some((i) => i.url === location.pathname)) return 4;
    return -1;
  }, [location.pathname, filteredMoreMenuItems]);

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
      {/* Outer fixed wrapper does NOT have any transform — that is
          essential. WebKit ignores a child's `backdrop-filter` when the
          child's stacking context is created by an ancestor's `transform`
          (the previous structure had `transform: translateX(-50%)` on the
          parent motion.nav, which is why the screen behind read as
          plain translucent instead of frosted). Centering is now done
          with `mx-auto w-fit` on a transform-free div; the entrance
          animation (y + opacity) moved onto the same element as
          `glass-nav`, which is allowed because the transform on the
          backdrop-filter element itself doesn't break the blur — only
          an ancestor transform does. */}
      <div
        data-bottom-nav
        className="fixed inset-x-0 z-[9999] md:hidden flex justify-center pointer-events-none"
        /* Sit tight against the iOS home-indicator safe area — 4px of
           breathing room above the system grey bar is enough to feel
           floating without floating *high*. Increase if it ever looks
           crowded; do not drop below ~2px or the pill kisses the bar. */
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 0.25rem)" }}
      >
        <motion.div
          initial={{ y: 24, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ type: "spring", damping: 22, stiffness: 260, mass: 0.6 }}
          /* Bottom-nav pill — glass recipe (Design System v1) via
             `.glass-nav`. Width ~92vw capped at 26rem so each tab gets
             breathing room. `pointer-events-auto` re-enables tap on the
             nav itself (the outer wrapper has pointer-events-none so
             taps pass through to page content elsewhere along the bottom). */
          className="pointer-events-auto relative flex items-stretch gap-2 p-1.5 w-[92vw] max-w-[26rem] rounded-pill glass-nav"
        >
          <motion.div
            aria-hidden
            /* Explicit `left-0 top-1 bottom-1` keeps the bubble pinned
               to the parent's inner edges with 4px breathing room top
               and bottom — closer to the nav pill's outer rim than the
               previous top-2/bottom-2 (8px) inset. `rounded-pill` gives
               fully rounded semi-circular ends. We also widen the
               bubble's animated x/width by 4px on each side so the pill
               extends slightly past the tab content. NOTE: do NOT use
               `rounded-l` — Tailwind treats it as the directional
               shorthand for "left corners only" and produces a
               flat-right-edge bug. */
            className="absolute left-0 top-1 bottom-1 rounded-pill bg-[rgba(139,126,234,0.12)] pointer-events-none"
            initial={false}
            animate={{
              x: bubble.x - 4,
              width: bubble.width + 8,
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
          />
          <NavItem
            ref={(el) => { tabRefs.current[1] = el; }}
            to={mainNavItems[1].url}
            icon={NutritionIcon}
            label={mainNavItems[1].title}
            tutorial="nav-nutrition"
            isActive={activeIndex === 1}
            tapAnimation={TAP_ANIMATIONS.nutrition}
          />
          <NavItem
            ref={(el) => { tabRefs.current[2] = el; }}
            to={mainNavItems[2].url}
            icon={GymIcon}
            label={mainNavItems[2].title}
            tutorial="nav-gym"
            isActive={activeIndex === 2}
            tapAnimation={TAP_ANIMATIONS.gym}
          />
          <NavItem
            ref={(el) => { tabRefs.current[3] = el; }}
            to={mainNavItems[3].url}
            icon={WeightIcon}
            label={mainNavItems[3].title}
            tutorial="nav-weight"
            isActive={activeIndex === 3}
            tapAnimation={TAP_ANIMATIONS.weight}
          />
          <NavButton
            ref={(el) => { tabRefs.current[4] = el; }}
            onClick={() => { setMoreMenuOpen(true); triggerHapticSelection(); }}
            icon={MoreHorizontal}
            label="More"
            tutorial="nav-more"
            isActive={activeIndex === 4}
            tapAnimation={TAP_ANIMATIONS.more}
          />
        </motion.div>
      </div>

      <QuickLogDialog
        open={quickLogOpen}
        onOpenChange={setQuickLogOpen}
        onLogFood={handleLogFood}
        onLogWeight={handleLogWeight}
        onLogTraining={handleLogTraining}
        onLogGym={handleLogGym}
      />

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

      <MoreMenuSheet
        open={moreMenuOpen}
        onOpenChange={setMoreMenuOpen}
        menuItems={filteredMoreMenuItems}
        onItemClick={handleMoreItemClick}
        onMyGym={() => { setMoreMenuOpen(false); navigate("/my-gym"); }}
        gymLogoUrl={primaryGym?.gym_logo_url ?? null}
        gymName={primaryGym?.gym_name ?? null}
        onSettings={handleSettings}
        onLogout={() => setLogoutDialogOpen(true)}
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
        <AlertDialogContent className="max-w-[240px] rounded-2xl p-0 border-0 bg-card/90 backdrop-blur-xl overflow-hidden gap-0 shadow-2xl">
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
        <AlertDialogContent className="max-w-[240px] rounded-2xl p-0 border-0 bg-card/90 backdrop-blur-xl overflow-hidden gap-0 shadow-2xl">
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

/* Shared layout class for every tab slot. */
const NAV_SLOT_CLASS =
  "relative z-10 flex flex-1 flex-col items-center justify-center gap-[3px] h-14 px-2 rounded-pill";

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
}

const NavItem = React.forwardRef<HTMLAnchorElement, NavItemProps>(
  function NavItem({ to, icon: Icon, label, isActive, tutorial, tapAnimation }, ref) {
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
  function NavItemWithBadge({ to, icon: Icon, label, isActive, tutorial, badge, tapAnimation }, ref) {
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
  /** Tap + long-press gesture handlers from `useFabGesture`. Spread
   *  directly onto the motion.button — they keep the pointer-token
   *  alive for the synchronous `Camera.getPhoto` invocation. */
  gestureProps: ReturnType<typeof useFabGesture>;
  tooltip: ReturnType<typeof useRoundCardTooltip>;
}

/**
 * Photo-first FAB block — the raised "+" circle and its one-time
 * discoverability popover. Lives as a separate component so `BottomNav`
 * stays under the 500-line project ceiling and the FAB's gesture wiring
 * is testable in isolation.
 *
 * The Popover wraps the FAB itself so the tooltip anchors to the same
 * element the gesture targets. We pass `onOpenAutoFocus` → preventDefault
 * so the popover doesn't steal focus on first render (which would
 * surface the iOS keyboard accessory bar over the bottom-nav).
 */
function RoundCardFab({ gestureProps, tooltip }: RoundCardFabProps) {
  return (
    <Popover open={tooltip.open} onOpenChange={tooltip.setOpen}>
      <PopoverTrigger asChild>
        <motion.button
          whileTap={{ scale: 0.88 }}
          transition={{ type: "spring", damping: 18, stiffness: 420 }}
          {...gestureProps}
          data-tutorial="nav-quick-log"
          className="relative ml-0.5 z-10 h-[50px] w-[50px] -translate-y-2 rounded-full bg-primary flex items-center justify-center shadow-[0_9px_20px_-5px_hsl(var(--primary)/0.6),0_2px_0_rgba(255,255,255,0.22)_inset,0_-1.5px_0_rgba(0,0,0,0.18)_inset] ring-2 ring-background/40 select-none touch-none"
          aria-label="Capture session photo (long-press for more options)"
        >
          <Plus className="h-6 w-6 text-primary-foreground" strokeWidth={2.75} />
        </motion.button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={10}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className="w-auto max-w-[260px] px-3 py-2 text-[12px]"
      >
        <div className="flex items-start gap-2">
          <p className="leading-snug text-foreground">
            Tap to capture &middot; long-press for more options
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
