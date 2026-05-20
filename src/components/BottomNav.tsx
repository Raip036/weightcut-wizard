import { Home, Utensils, Plus, Weight, Target, MoreHorizontal, Trophy, Calendar, HeartPulse, Dumbbell, TrendingDown, Moon, Users, X, type LucideIcon } from "lucide-react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect, memo } from "react";
import { motion, LayoutGroup } from "motion/react";
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
  { title: "Dashboard", url: "/dashboard", icon: Home },
  { title: "Nutrition", url: "/nutrition", icon: Utensils },
  // Corner — gym-scoped social feed. Inserted as a new middle slot
  // alongside the existing nav (no slot replaced); engagement red-dot
  // moved here from the More button.
  { title: "Corner", url: "/community", icon: Users },
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
    } catch {
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

  const DashboardIcon = mainNavItems[0].icon;
  const NutritionIcon = mainNavItems[1].icon;
  const CornerIcon = mainNavItems[2].icon;
  const WeightIcon = mainNavItems[3].icon;

  if (!isMobile) return null;

  return (
    <>
      <motion.nav
        data-bottom-nav
        initial={{ y: 24, x: "-50%", opacity: 0 }}
        animate={{ y: 0, x: "-50%", opacity: 1 }}
        transition={{ type: "spring", damping: 22, stiffness: 260, mass: 0.6 }}
        className="fixed left-1/2 z-[9999] md:hidden"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 0.5rem)" }}
      >
        <LayoutGroup id="bottom-nav">
          {/* Bottom-nav pill — sized ~23% smaller than the original spec
              (30% shrink, then +10% bump per follow-up). Item / icon sizes
              and the FAB scale together so the visual rhythm is preserved. */}
          <div className="flex items-center gap-1.5 p-1.5 rounded-full bg-card/70 backdrop-blur-2xl border border-white/10 shadow-[0_12px_30px_-8px_rgba(0,0,0,0.55),0_2px_0_rgba(255,255,255,0.04)_inset,0_-1px_0_rgba(0,0,0,0.35)_inset]">
            <NavItem
              to={mainNavItems[0].url}
              icon={DashboardIcon}
              label={mainNavItems[0].title}
              isActive={location.pathname === mainNavItems[0].url}
              tutorial="nav-dashboard"
            />
            <NavItem
              to={mainNavItems[1].url}
              icon={NutritionIcon}
              label={mainNavItems[1].title}
              isActive={location.pathname === mainNavItems[1].url}
              tutorial="nav-nutrition"
            />

            {/* Corner — gym-scoped social feed, new middle slot. Red-dot
                badge surfaces here (previously on More) because the
                social tab IS where the user goes to clear unread
                engagement. */}
            <NavItemWithBadge
              to={mainNavItems[2].url}
              icon={CornerIcon}
              label={mainNavItems[2].title}
              isActive={location.pathname === mainNavItems[2].url || location.pathname.startsWith("/profile/")}
              tutorial="nav-corner"
              badge={hasUnreadFeedEngagement}
            />

            <NavItem
              to={mainNavItems[3].url}
              icon={WeightIcon}
              label={mainNavItems[3].title}
              isActive={location.pathname === mainNavItems[3].url}
              tutorial="nav-weight"
            />

            <NavButton
              onClick={() => { setMoreMenuOpen(true); triggerHapticSelection(); }}
              icon={MoreHorizontal}
              label="More"
              isActive={filteredMoreMenuItems.some(i => i.url === location.pathname)}
              tutorial="nav-more"
            />

            <RoundCardFab
              gestureProps={fabGesture}
              tooltip={tooltip}
            />
          </div>
        </LayoutGroup>
      </motion.nav>

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

interface NavItemProps {
  to: string;
  icon: LucideIcon;
  label: string;
  isActive: boolean;
  tutorial?: string;
}

function NavItem({ to, icon: Icon, label, isActive, tutorial }: NavItemProps) {
  return (
    <NavLink
      to={to}
      data-tutorial={tutorial}
      onClick={() => triggerHaptic(ImpactStyle.Light)}
      aria-label={label}
      className="relative flex h-11 w-11 items-center justify-center rounded-full"
    >
      {isActive && (
        <motion.div
          layoutId="nav-active-pill"
          className="absolute inset-0 rounded-full bg-primary/15"
          transition={{ type: "spring", damping: 26, stiffness: 320 }}
        />
      )}
      <Icon
        className={`relative h-[22px] w-[22px] transition-colors duration-150 ${isActive ? "text-primary" : "text-muted-foreground/75"}`}
        strokeWidth={isActive ? 2.4 : 1.9}
      />
    </NavLink>
  );
}

interface NavItemWithBadgeProps extends NavItemProps {
  badge?: boolean;
}

/** NavItem variant that overlays a small red dot when `badge` is true.
 *  Used by the Corner tab for unread-engagement indication. */
function NavItemWithBadge({ to, icon: Icon, label, isActive, tutorial, badge }: NavItemWithBadgeProps) {
  return (
    <NavLink
      to={to}
      data-tutorial={tutorial}
      onClick={() => triggerHaptic(ImpactStyle.Light)}
      aria-label={label}
      className="relative flex h-11 w-11 items-center justify-center rounded-full"
    >
      {isActive && (
        <motion.div
          layoutId="nav-active-pill"
          className="absolute inset-0 rounded-full bg-primary/15"
          transition={{ type: "spring", damping: 26, stiffness: 320 }}
        />
      )}
      <Icon
        className={`relative h-[22px] w-[22px] transition-colors duration-150 ${isActive ? "text-primary" : "text-muted-foreground/75"}`}
        strokeWidth={isActive ? 2.4 : 1.9}
      />
      {badge && (
        <span
          aria-hidden
          className="absolute top-1.5 right-2 h-2 w-2 rounded-full bg-destructive ring-2 ring-background"
        />
      )}
    </NavLink>
  );
}

interface NavButtonProps {
  onClick: () => void;
  icon: LucideIcon;
  label: string;
  isActive: boolean;
  tutorial?: string;
  /** When true, render a small red dot on the top-right of the icon to
   *  signal unread activity (e.g. gym-feed engagement). Doesn't affect
   *  the click target. */
  badge?: boolean;
}

function NavButton({ onClick, icon: Icon, label, isActive, tutorial, badge }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      data-tutorial={tutorial}
      aria-label={label}
      className="relative flex h-11 w-11 items-center justify-center rounded-full"
    >
      {isActive && (
        <motion.div
          layoutId="nav-active-pill"
          className="absolute inset-0 rounded-full bg-primary/15"
          transition={{ type: "spring", damping: 26, stiffness: 320 }}
        />
      )}
      <Icon
        className={`relative h-[22px] w-[22px] transition-colors duration-150 ${isActive ? "text-primary" : "text-muted-foreground/75"}`}
        strokeWidth={isActive ? 2.4 : 1.9}
      />
      {badge && (
        <span
          aria-hidden
          className="absolute top-1.5 right-2 h-2 w-2 rounded-full bg-destructive ring-2 ring-background"
        />
      )}
    </button>
  );
}

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
