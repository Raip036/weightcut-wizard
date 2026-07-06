import { useEffect, lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate, Outlet } from "react-router-dom";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/AppSidebar";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ProfileCompletionGuard } from "@/components/ProfileCompletionGuard";
import { UserProvider } from "@/contexts/UserContext";
import { SubscriptionProvider } from "@/contexts/SubscriptionContext";
import { AnalyticsBridge } from "@/components/AnalyticsBridge";
import { trackPageview } from "@/lib/analytics";
import { FightCampCoachProvider } from "@/contexts/FightCampCoachContext";
import { AITaskProvider } from "@/contexts/AITaskContext";
import { PaywallOverlay } from "@/components/subscription/PaywallOverlay";
import { WelcomeProOverlay } from "@/components/subscription/WelcomeProOverlay";
import { ProEndedOverlay } from "@/components/subscription/ProEndedOverlay";
import { ProRouteGate } from "@/components/subscription/ProRouteGate";
import { GlobalLoadingOverlay } from "@/components/GlobalLoadingOverlay";
import { CampCompletionOverlay } from "@/components/fightcamp/CampCompletionOverlay";
import { PageTransition } from "@/components/PageTransition";
import { NavigationDirectionProvider } from "@/hooks/useNavigationDirection";
import { TutorialProvider } from "@/tutorial/TutorialContext";
import { BottomNav } from "@/components/BottomNav";
import { FloatingWizardChat } from "@/components/FloatingWizardChat";
import { AppUpdateGate } from "@/components/AppUpdateGate";
import { MaintenanceGate } from "@/components/MaintenanceGate";
const FloatingWorkoutIndicator = lazy(() => import("@/components/gym/FloatingWorkoutIndicator").then(m => ({ default: m.FloatingWorkoutIndicator })));
const AIFloatingIndicator = lazy(() => import("@/components/AIFloatingIndicator").then(m => ({ default: m.AIFloatingIndicator })));
import * as Sentry from "@sentry/react";
import ErrorBoundary from "@/components/ErrorBoundary";
import { DashboardSkeleton, NutritionPageSkeleton, WeightTrackerSkeleton, GoalsSkeleton } from "@/components/ui/skeleton-loader";
import WizardSpinnerLoader from "@/components/ui/WizardSpinnerLoader";
import { OfflineBanner } from "@/components/OfflineBanner";
import { PullToRefresh } from "@/components/PullToRefresh";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Onboarding from "./pages/Onboarding";

// Welcome cutscene — animated wizard intro shown on first "Get Started"
// tap before the auth screen. Lazy-loaded so it never bloats the
// returning-user critical path.
const WizardIntroCutscene = lazy(() => import("@/components/welcome/WizardIntroCutscene"));

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Camp = lazy(() => import("./pages/Camp"));
const Goals = lazy(() => import("./pages/Goals"));
const Nutrition = lazy(() => import("./pages/nutrition/NutritionPage"));
const WeightTracker = lazy(() => import("./pages/WeightTracker"));
// WP-T21: `/weight-protocol` replaces the old `/fight-week` + `/hydration`
// tabs (formerly aggregated under `/weight-cut`). All three legacy routes
// now redirect here.
const WeightProtocol = lazy(() => import("./pages/WeightProtocol"));
const FightCamps = lazy(() => import("./pages/FightCamps"));
const FightCampDetail = lazy(() => import("./pages/FightCampDetail"));
const TrainingCalendar = lazy(() => import("./pages/TrainingCalendar"));
const TrainingLibrary = lazy(() => import("./pages/TrainingLibrary"));
const Recovery = lazy(() => import("./pages/Recovery"));
const RecoveryCheckIn = lazy(() => import("./pages/RecoveryCheckIn"));
const Sleep = lazy(() => import("./pages/Sleep"));
const GymTracker = lazy(() => import("./pages/GymTracker"));
const NotFound = lazy(() => import("./pages/NotFound"));
const CutPlanReview = lazy(() => import("./pages/CutPlanReview"));
const Legal = lazy(() => import("./pages/Legal"));
const CoachDashboard = lazy(() => import("./pages/coach/CoachDashboard"));
const CoachOnboarding = lazy(() => import("./pages/coach/CoachOnboarding"));
const CoachLogin = lazy(() => import("./pages/coach/CoachLogin"));
const AthleteDetail = lazy(() => import("./pages/coach/AthleteDetail"));
const JoinGym = lazy(() => import("./pages/JoinGym"));
const MyGym = lazy(() => import("./pages/MyGym"));
const Community = lazy(() => import("./pages/Community"));
const Profile = lazy(() => import("./pages/Profile"));
const CommunityModeration = lazy(() => import("./pages/community/Moderation"));
// THROWAWAY mock lab for the Cut redesign — delete after sign-off.
const CutLab = lazy(() => import("./pages/CutLab"));
const DashboardLab = lazy(() => import("./pages/DashboardLab"));
const DeleteAccountLab = lazy(() => import("./pages/DeleteAccountLab"));
const CampMenuLab = lazy(() => import("./pages/CampMenuLab"));
const CaptionStepLab = lazy(() => import("./pages/CaptionStepLab"));
const MealGradeLab = lazy(() => import("./pages/MealGradeLab"));
const FoodGradeInfoLab = lazy(() => import("./pages/FoodGradeInfoLab"));
const GalleryLab = lazy(() => import("./pages/GalleryLab"));
const WidgetLab = lazy(() => import("./pages/WidgetLab"));
const MealAnalysisLab = lazy(() => import("./pages/MealAnalysisLab"));
const ChartLab = lazy(() => import("./pages/ChartLab"));

// Prioritized idle preloading — critical routes first, rest deferred
const _idle = window.requestIdleCallback || ((cb: IdleRequestCallback) => setTimeout(cb, 50));
_idle(() => {
  // Primary routes — likely first navigation
  import("./pages/Dashboard").catch(() => {});
  import("./pages/Camp").catch(() => {});
  import("./pages/nutrition/NutritionPage").catch(() => {});
  import("./pages/WeightTracker").catch(() => {});
  // Secondary routes — defer to avoid network contention
  setTimeout(() => {
    import("./pages/Goals").catch(() => {});
    import("./pages/WeightProtocol").catch(() => {});
    import("./pages/GymTracker").catch(() => {});
    import("./pages/TrainingCalendar").catch(() => {});
    import("./pages/MyGym").catch(() => {});
    import("./pages/JoinGym").catch(() => {});
    import("./pages/coach/CoachLogin").catch(() => {});
    // Corner tab — preload once the dashboard has settled.
    import("./pages/Community").catch(() => {});
    import("./pages/Profile").catch(() => {});
  }, 3000);
  setTimeout(() => {
    import("./pages/Recovery").catch(() => {});
    import("./pages/FightCamps").catch(() => {});
    import("./pages/FightCampDetail").catch(() => {});
  }, 6000);
});

// Convex actions don't need warmup — co-located with the deployment.

const queryClient = new QueryClient();

// `/cut-plan` + `/weight-plan` are excluded so RouteTracker never persists them
// as `lastRoute` — otherwise a cold launch / refresh would restore the user onto
// the cut plan (a second way into the old "stuck on the plan" trap).
const SKIP_ROUTES = ['/', '/welcome', '/auth', '/onboarding', '/legal', '/cut-plan', '/weight-plan'];

// Android hardware-back "root" screens — pressing back here exits the app
// instead of popping browser history (there's nothing meaningful to pop back
// to). The main dashboard is home; `/` is the cold-launch landing route.
const ROOT_ROUTES = ['/dashboard', '/'];

import { App as CapacitorApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import { isAndroid } from "@/lib/platform";
import { logger } from "@/lib/logger";
import { useReminderSync } from "@/hooks/useReminderSync";

// Keeps adaptive local-notification reminders alive after onboarding: re-syncs
// on cold start + foreground resume and routes notification taps. Native-only
// (no-op on web). Mounted once inside the router so it has navigate + convex.
function ReminderSync() {
  useReminderSync();
  return null;
}

function RouteTracker() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!SKIP_ROUTES.includes(location.pathname)) {
      localStorage.setItem('lastRoute', location.pathname);
    }
    // Manual SPA pageview — react-router navigations have no full page load,
    // so PostHog needs this to map "where users go / what they traverse".
    trackPageview(location.pathname);
  }, [location.pathname]);

  // Set light status bar text for dark background
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      StatusBar.setStyle({ style: Style.Dark });
      // `.native-app` class is now added synchronously in main.tsx (before first
      // paint) so the iOS CSS overrides fire on the first frame — see main.tsx.
    }
  }, []);

  // Handle Deep Links (Convex Auth + generic in-app routing).
  //
  // Convex Auth uses an OAuth `code` query param on the callback URL, and
  // <ConvexAuthProvider> (mounted in main.tsx) automatically detects and
  // consumes that code when the URL is present in the browser. For the
  // Capacitor native deep-link case, the browser never actually owns the
  // URL — it arrives via `appUrlOpen`. We push the URL onto the JS-side
  // location so the provider picks it up, then strip the code param.
  useEffect(() => {
    // Native listener handles to tear down on unmount. `addListener()` returns
    // a Promise<PluginListenerHandle>; we await each before calling `.remove()`.
    const listeners: Promise<{ remove: () => void }>[] = [];

    // --- Deep links (Convex Auth callback + generic in-app routing) ---
    listeners.push(
      CapacitorApp.addListener('appUrlOpen', async ({ url }) => {
        logger.info('App opened with URL', { url });

        let parsed: URL;
        try {
          parsed = new URL(url);
        } catch (e) {
          logger.error('Unparseable deep link URL', e);
          return;
        }

        // Two shapes reach us:
        //  - custom scheme:  weightcutwizard://<route>?<query>  (iOS + Android)
        //  - Android App Link: https://fightcampwizard.com/<route>?<query>
        // Both map to the SAME in-app routes; we branch on scheme/host below.
        const isCustomScheme = parsed.protocol === 'weightcutwizard:';
        const isAppLink =
          parsed.protocol === 'https:' && parsed.hostname === 'fightcampwizard.com';
        if (!isCustomScheme && !isAppLink) return;

        // Resolve the route segment for each form:
        //  - custom scheme: the host IS the route (weightcutwizard://join?code=)
        //  - app link:      the pathname is the route (https://.../join?code=)
        const routePath = (isCustomScheme ? parsed.hostname : parsed.pathname).replace(/^\/+/, '');

        // 1. Convex Auth OAuth callback. The contract is the custom scheme
        //    `weightcutwizard://callback?code=...` (App Links are never used for
        //    the OAuth round-trip). Surface the code to <ConvexAuthProvider> by
        //    writing it onto window.location's query string; the provider
        //    listens for it and exchanges the code automatically.
        if (isCustomScheme && routePath === 'callback' && parsed.searchParams.get('code')) {
          try {
            // Replace the current history entry so the provider sees the code
            // on its next URL read, without leaving a junk entry in history.
            const newUrl = `${window.location.pathname}?${parsed.search.replace(/^\?/, '')}`;
            window.history.replaceState({}, '', newUrl);
            // Give the provider a tick to pick up the code, then route.
            setTimeout(() => navigate('/dashboard'), 100);
          } catch (e) {
            logger.error('Error handling Convex Auth callback', e);
          }
          return;
        }

        // 2. Generic in-app routing (e.g. join?code=..., nutrition,
        //    auth?reset=true). Forward the original query string so the target
        //    route keeps its params (?code= for /join, ?reset=true for /auth).
        if (routePath && routePath !== 'callback') {
          navigate(`/${routePath}${parsed.search}`);
        } else if (routePath === 'callback') {
          // Custom-scheme callback without a usable code (defensive).
          navigate('/dashboard');
        }
      }),
    );

    // --- Android hardware/gesture back button ---
    // iOS has no hardware back button, so this is Android-only. Capacitor's
    // default would abruptly exit the app on every back press; instead we pop
    // browser history (in-app navigation) and only exit when at a root screen.
    // We let history/in-app navigation handle modals rather than special-casing
    // overlays here, to keep the behavior simple and predictable.
    if (isAndroid()) {
      listeners.push(
        CapacitorApp.addListener('backButton', () => {
          const atRoot = ROOT_ROUTES.includes(window.location.pathname);
          if (!atRoot && window.history.length > 1) {
            window.history.back();
          } else {
            CapacitorApp.exitApp();
          }
        }),
      );
    }

    return () => {
      // Remove every native listener we registered on unmount.
      listeners.forEach((p) => p.then((h) => h.remove()).catch(() => {}));
    };
  }, [navigate]);

  return null;
}

const AppLayoutContent = () => {
  // Warm the bottom-nav chunk cache once the protected shell mounts.
  //
  // Every primary destination (Dashboard, Camp, Nutrition, Community,
  // WeightProtocol) is `React.lazy`, so the FIRST navigation to each one in a
  // session would otherwise trigger Suspense and flash <DashboardSkeleton/>
  // in the middle of the PageTransition animation — which reads as jank
  // even though the motion itself is fine. By kicking off these imports
  // from `requestIdleCallback`, the chunks are already in the module
  // cache by the time the user taps a bottom-nav tab. Suspense never
  // fires, and the entering page renders straight from cache so the
  // PageTransition's opacity/y/scale animates over the real content.
  //
  // The top-level `_idle(...)` block above also kicks off these imports,
  // but it runs before auth resolves and can lose to network jitter on
  // cold app launches; this effect is the belt-and-braces second pass
  // that fires reliably once the user is actually inside the app shell.
  //
  // Errors are intentionally swallowed — if a chunk fails to preload
  // here, the real navigation attempt's <Suspense fallback> will still
  // handle it (and surface any error via the route's ErrorBoundary).
  useEffect(() => {
    const schedule =
      typeof window !== "undefined" &&
      typeof (window as unknown as { requestIdleCallback?: unknown }).requestIdleCallback === "function"
        ? (window as unknown as { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback
        : (cb: () => void) => window.setTimeout(cb, 400);
    const handle = schedule(() => {
      import("./pages/Dashboard").catch(() => {});
      import("./pages/Camp").catch(() => {});
      import("./pages/nutrition/NutritionPage").catch(() => {});
      import("./pages/Community").catch(() => {});
      import("./pages/WeightProtocol").catch(() => {});
    });
    return () => {
      const cancel = (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback;
      if (typeof cancel === "function" && typeof handle === "number") {
        cancel(handle);
      }
    };
  }, []);

  return (
    <>
      {/* Mobile-first layout: sidebar hidden on mobile, shown on desktop */}
      {/* Bind the app shell to the dynamic viewport via an INLINE style (the
          `.h-screen-safe` utility class was being dropped by the CSS build, so
          the container grew to content height and <main> never became a real
          scroll viewport — page bottoms were unreachable on Android Chromium,
          while iOS WKWebView happened to tolerate it). overflow:hidden makes
          the inner <main> the single scroller; PullToRefresh reads main.scrollTop. */}
      <div
        className="flex w-full no-horizontal-scroll"
        style={{ height: "100dvh", overflow: "hidden" }}
      >
        <div className="hidden md:block">
          <AppSidebar />
        </div>
        {/* Main content area - responsive padding for mobile */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0 w-full">
          {/* Desktop-only header with sidebar trigger and theme toggle */}
          <header className="hidden md:flex sticky top-0 z-50 h-14 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 items-center justify-between px-4 md:static md:z-auto">
            <SidebarTrigger className="touch-target" />
            <ThemeToggle className="touch-target" />
          </header>
          <OfflineBanner />
          {/* Main content with mobile-first responsive padding - bottom padding for bottom nav */}
          <main className="flex-1 overflow-auto overflow-x-hidden overscroll-y-contain relative min-h-0 w-full pt-2 md:pb-0 safe-area-inset-top safe-area-inset-left safe-area-inset-right animate-app-content-in" style={{ paddingBottom: "calc(4.5rem + env(safe-area-inset-bottom, 0px))", WebkitOverflowScrolling: "touch" }}>
            <PullToRefresh />
            {/* Center the routed content into a max-width column on desktop only.
                Base (mobile) classes are `w-full` with no max-width/padding, so
                the md:* utilities never apply below 768px and mobile layout is
                byte-for-byte unchanged. The sidebar stays on the left; this
                column centers within the remaining <main> space. */}
            <div className="mx-auto w-full md:max-w-[680px] md:px-6">
              <PageTransition>
                <Suspense fallback={<DashboardSkeleton />}>
                  <Outlet />
                </Suspense>
              </PageTransition>
            </div>
          </main>
        </div>
      </div>
      {/* Bottom Navigation - Mobile Only */}
      <BottomNav />
      <Suspense fallback={null}><FloatingWorkoutIndicator /></Suspense>
      <Suspense fallback={null}><AIFloatingIndicator /></Suspense>
      <FloatingWizardChat />
      <AppUpdateGate />
    </>
  );
};

const AppLayout = () => (
  <SidebarProvider>
    <AppLayoutContent />
  </SidebarProvider>
);

const ProtectedAppLayout = () => (
  <ProtectedRoute>
    <ProfileCompletionGuard>
      <AppLayout />
    </ProfileCompletionGuard>
  </ProtectedRoute>
);

const App = () => (
  <MaintenanceGate>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <ErrorBoundary onError={(error, errorInfo) => {
        Sentry.captureException(error, {
          extra: { componentStack: errorInfo.componentStack },
        });
      }}>
        <UserProvider>
          <SubscriptionProvider>
          <AITaskProvider>
          <FightCampCoachProvider>
            <Toaster />
            <Sonner />
            <PaywallOverlay />
            <WelcomeProOverlay />
            <ProEndedOverlay />
            <GlobalLoadingOverlay />
            <BrowserRouter
              future={{
                v7_startTransition: true,
                v7_relativeSplatPath: true,
              }}
            >
              <NavigationDirectionProvider>
              <TutorialProvider>
              <RouteTracker />
              <ReminderSync />
              <AnalyticsBridge />
              <CampCompletionOverlay />
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/welcome" element={
                  <Suspense fallback={<WizardSpinnerLoader />}>
                    <WizardIntroCutscene />
                  </Suspense>
                } />
                <Route path="/coach/welcome" element={
                  <Suspense fallback={<WizardSpinnerLoader />}>
                    <WizardIntroCutscene variant="coach" />
                  </Suspense>
                } />
                <Route path="/auth" element={<Auth />} />
                <Route path="/coach/login" element={<Suspense fallback={<DashboardSkeleton />}><CoachLogin /></Suspense>} />
                <Route path="/legal" element={<Suspense fallback={null}><Legal /></Suspense>} />
                {/* THROWAWAY mock lab — Cut redesign comparison. Delete after sign-off. */}
                <Route path="/cut-lab" element={<Suspense fallback={<DashboardSkeleton />}><CutLab /></Suspense>} />
                {/* THROWAWAY mock lab — Dashboard redesign. Delete after sign-off. */}
                <Route path="/dashboard-lab" element={<Suspense fallback={<DashboardSkeleton />}><DashboardLab /></Suspense>} />
                {/* THROWAWAY mock lab - Delete account redesign. Delete after sign-off. */}
                <Route path="/delete-lab" element={<Suspense fallback={<DashboardSkeleton />}><DeleteAccountLab /></Suspense>} />
                {/* THROWAWAY mock lab — Camp menu redesign. Delete after sign-off. */}
                <Route path="/camp-menu-lab" element={<Suspense fallback={<DashboardSkeleton />}><CampMenuLab /></Suspense>} />
                {/* THROWAWAY mock lab — Add-a-meal caption redesign. Delete after sign-off. */}
                <Route path="/caption-lab" element={<Suspense fallback={<DashboardSkeleton />}><CaptionStepLab /></Suspense>} />
                {/* THROWAWAY mock lab - Meal health grade feature. Delete after sign-off. */}
                <Route path="/meal-grade-lab" element={<Suspense fallback={<DashboardSkeleton />}><MealGradeLab /></Suspense>} />
                {/* THROWAWAY mock lab - Food grade explainer sheet. Delete after sign-off. */}
                <Route path="/food-grade-lab" element={<Suspense fallback={<DashboardSkeleton />}><FoodGradeInfoLab /></Suspense>} />
                {/* THROWAWAY mock lab - Training gallery redesign. Delete after sign-off. */}
                <Route path="/gallery-lab" element={<Suspense fallback={<DashboardSkeleton />}><GalleryLab /></Suspense>} />
                {/* THROWAWAY mock lab — iOS-native stat widgets. Delete after sign-off. */}
                <Route path="/widget-lab" element={<Suspense fallback={<DashboardSkeleton />}><WidgetLab /></Suspense>} />
                {/* THROWAWAY mock lab — Detected-foods list condense. Delete after sign-off. */}
                <Route path="/meal-analysis-lab" element={<Suspense fallback={<DashboardSkeleton />}><MealAnalysisLab /></Suspense>} />
                {/* THROWAWAY mock lab — BUILD-widget line chart redesign. Delete after sign-off. */}
                <Route path="/chart-lab" element={<Suspense fallback={<DashboardSkeleton />}><ChartLab /></Suspense>} />
                <Route path="/onboarding" element={
                  <ProtectedRoute>
                    <Onboarding />
                  </ProtectedRoute>
                } />
                <Route path="/cut-plan" element={
                  <ProtectedRoute>
                    <Suspense fallback={null}><CutPlanReview /></Suspense>
                  </ProtectedRoute>
                } />
                {/* Weight-loss flow reuses the same plan review component;
                    CutPlanReview adapts its copy based on plan.planType. */}
                <Route path="/weight-plan" element={
                  <ProtectedRoute>
                    <Suspense fallback={null}><CutPlanReview /></Suspense>
                  </ProtectedRoute>
                } />

                {/* Coach Mode routes — outside the ProfileCompletionGuard,
                    coaches don't go through fighter onboarding. */}
                <Route path="/coach/onboarding" element={
                  <ProtectedRoute>
                    <Suspense fallback={null}><CoachOnboarding /></Suspense>
                  </ProtectedRoute>
                } />
                {/* Legacy alias — older builds and cached `lastRoute`
                    entries point at /coach/setup. Forward them to the new
                    onboarding flow so no one lands on a 404. */}
                <Route path="/coach/setup" element={<Navigate to="/coach/onboarding" replace />} />
                <Route path="/coach" element={
                  <ProtectedRoute>
                    <Suspense fallback={<DashboardSkeleton />}><CoachDashboard /></Suspense>
                  </ProtectedRoute>
                } />
                <Route path="/coach/athletes/:id" element={
                  <ProtectedRoute>
                    <Suspense fallback={<DashboardSkeleton />}><AthleteDetail /></Suspense>
                  </ProtectedRoute>
                } />
                <Route path="/join" element={
                  <ProtectedRoute>
                    <Suspense fallback={null}><JoinGym /></Suspense>
                  </ProtectedRoute>
                } />
                {/* Dedicated full-screen wellness check-in — outside the
                    AppLayout so the user gets a distraction-free flow
                    (no sidebar, no bottom nav, no offline banner). */}
                <Route path="/recovery/check-in" element={
                  <ProtectedRoute>
                    <Suspense fallback={<DashboardSkeleton />}><RecoveryCheckIn /></Suspense>
                  </ProtectedRoute>
                } />

                {/* Shared layout route — AppLayout persists across all child navigations */}
                <Route element={<ProtectedAppLayout />}>
                  <Route path="/dashboard" element={<ErrorBoundary><Suspense fallback={<DashboardSkeleton />}><Dashboard /></Suspense></ErrorBoundary>} />
                  <Route path="/camp" element={<ErrorBoundary><Suspense fallback={<DashboardSkeleton />}><Camp /></Suspense></ErrorBoundary>} />
                  <Route path="/goals" element={<ErrorBoundary><Suspense fallback={<GoalsSkeleton />}><Goals /></Suspense></ErrorBoundary>} />
                  <Route path="/nutrition" element={<ErrorBoundary><Suspense fallback={<NutritionPageSkeleton />}><Nutrition /></Suspense></ErrorBoundary>} />
                  <Route path="/weight" element={<ErrorBoundary><Suspense fallback={<WeightTrackerSkeleton />}><WeightTracker /></Suspense></ErrorBoundary>} />
                  <Route path="/weight-protocol" element={<ErrorBoundary><Suspense fallback={<DashboardSkeleton />}><WeightProtocol /></Suspense></ErrorBoundary>} />
                  {/* WP-T21: legacy routes — `/fight-week` and `/hydration`
                      were the two tabs of `/weight-cut`. All three now
                      collapse into the unified `/weight-protocol` page. */}
                  <Route path="/fight-week" element={<Navigate to="/weight-protocol" replace />} />
                  <Route path="/hydration" element={<Navigate to="/weight-protocol" replace />} />
                  <Route path="/weight-cut" element={<Navigate to="/weight-protocol" replace />} />
                  <Route path="/fight-camps" element={<ErrorBoundary><Suspense fallback={<DashboardSkeleton />}><FightCamps /></Suspense></ErrorBoundary>} />
                  <Route path="/fight-camps/:id" element={<ErrorBoundary><Suspense fallback={<DashboardSkeleton />}><FightCampDetail /></Suspense></ErrorBoundary>} />
                  <Route path="/training-calendar" element={<ErrorBoundary><Suspense fallback={<DashboardSkeleton />}><TrainingCalendar /></Suspense></ErrorBoundary>} />
                  <Route path="/training-library" element={<ErrorBoundary><Suspense fallback={<DashboardSkeleton />}><TrainingLibrary /></Suspense></ErrorBoundary>} />
                  <Route path="/fight-camp-calendar" element={<Navigate to="/training-calendar" replace />} />
                  <Route path="/recovery" element={<ErrorBoundary><Suspense fallback={<DashboardSkeleton />}><ProRouteGate feature="RECOVERY"><Recovery /></ProRouteGate></Suspense></ErrorBoundary>} />
                  <Route path="/sleep" element={<ErrorBoundary><Suspense fallback={<DashboardSkeleton />}><Sleep /></Suspense></ErrorBoundary>} />
                  <Route path="/gym" element={<ErrorBoundary><Suspense fallback={<DashboardSkeleton />}><GymTracker /></Suspense></ErrorBoundary>} />
                  <Route path="/my-gym" element={<ErrorBoundary><Suspense fallback={<DashboardSkeleton />}><MyGym /></Suspense></ErrorBoundary>} />
                  <Route path="/gym-feed" element={<Navigate to="/community" replace />} />
                  <Route path="/community" element={<ErrorBoundary><Suspense fallback={<DashboardSkeleton />}><Community /></Suspense></ErrorBoundary>} />
                  <Route path="/community/moderation" element={<ErrorBoundary><Suspense fallback={<DashboardSkeleton />}><CommunityModeration /></Suspense></ErrorBoundary>} />
                  <Route path="/profile/:userId" element={<ErrorBoundary><Suspense fallback={<DashboardSkeleton />}><Profile /></Suspense></ErrorBoundary>} />
                </Route>

                <Route path="*" element={<NotFound />} />
              </Routes>
              </TutorialProvider>
              </NavigationDirectionProvider>
            </BrowserRouter>
          </FightCampCoachProvider>
          </AITaskProvider>
          </SubscriptionProvider>
        </UserProvider>
      </ErrorBoundary>
    </TooltipProvider>
  </QueryClientProvider>
  </MaintenanceGate>
);

export default App;
