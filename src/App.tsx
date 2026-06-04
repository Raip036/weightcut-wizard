import { useEffect, lazy, Suspense } from "react";
import { useMutation } from "convex/react";
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
import { WizardBackgroundProvider } from "@/contexts/WizardBackgroundContext";
import { FightCampCoachProvider } from "@/contexts/FightCampCoachContext";
import { AITaskProvider } from "@/contexts/AITaskContext";
import { PaywallOverlay } from "@/components/subscription/PaywallOverlay";
import { WelcomeProOverlay } from "@/components/subscription/WelcomeProOverlay";
import { ProRouteGate } from "@/components/subscription/ProRouteGate";
import { GlobalLoadingOverlay } from "@/components/GlobalLoadingOverlay";
import { PageTransition } from "@/components/PageTransition";
import { NavigationDirectionProvider } from "@/hooks/useNavigationDirection";
import { TutorialProvider } from "@/tutorial/TutorialContext";
import { BottomNav } from "@/components/BottomNav";
import { FloatingWizardChat } from "@/components/FloatingWizardChat";
const FloatingWorkoutIndicator = lazy(() => import("@/components/gym/FloatingWorkoutIndicator").then(m => ({ default: m.FloatingWorkoutIndicator })));
const AIFloatingIndicator = lazy(() => import("@/components/AIFloatingIndicator").then(m => ({ default: m.AIFloatingIndicator })));
import * as Sentry from "@sentry/react";
import ErrorBoundary from "@/components/ErrorBoundary";
import { DashboardSkeleton, NutritionPageSkeleton, WeightTrackerSkeleton, GoalsSkeleton } from "@/components/ui/skeleton-loader";
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
// const SkillTree = lazy(() => import("./pages/SkillTree"));
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

const SKIP_ROUTES = ['/', '/welcome', '/auth', '/onboarding', '/legal'];

import { App as CapacitorApp } from '@capacitor/app';
import { StatusBar, Style } from '@capacitor/status-bar';
import { Capacitor } from '@capacitor/core';
import { logger } from "@/lib/logger";
import { runHealthKitSync } from "@/services/healthKitSync";
import { api } from "@/../convex/_generated/api";

function RouteTracker() {
  const location = useLocation();
  const navigate = useNavigate();
  // Convex mutation handle for HealthKit ingest. Safe to call from inside
  // `RouteTracker` because <UserProvider>/<SubscriptionProvider> already
  // mount the ConvexAuth context above us; the mutation no-ops while
  // unauthenticated (the server will reject and `runHealthKitSync` will
  // log + swallow the error).
  const insertHealthSamples = useMutation(api.health.insertSamples);

  useEffect(() => {
    if (!SKIP_ROUTES.includes(location.pathname)) {
      localStorage.setItem('lastRoute', location.pathname);
    }
  }, [location.pathname]);

  // Set light status bar text for dark background
  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      StatusBar.setStyle({ style: Style.Dark });
      document.documentElement.classList.add("native-app");
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
    CapacitorApp.addListener('appUrlOpen', async ({ url }) => {
      logger.info('App opened with URL', { url });

      // 1. Convex Auth OAuth callback (e.g. weightcutwizard://callback?code=...)
      //    Surface the code to the ConvexAuthProvider by setting
      //    window.location's query string. The provider listens to it and
      //    exchanges the code automatically.
      if (url.includes('code=')) {
        try {
          const u = new URL(url);
          const code = u.searchParams.get('code');
          if (code) {
            // Replace the current history entry so the provider sees the code
            // on its next URL read, without leaving a junk entry in history.
            const newUrl = `${window.location.pathname}?${u.search.replace(/^\?/, '')}`;
            window.history.replaceState({}, '', newUrl);
            // Give the provider a tick to pick up the code, then route.
            setTimeout(() => navigate('/dashboard'), 100);
          }
        } catch (e) {
          logger.error("Error handling Convex Auth callback", e);
        }
        return;
      }

      // 2. Generic Deep Linking (weightcutwizard://page)
      //    e.g. weightcutwizard://nutrition -> /nutrition
      if (url.includes('weightcutwizard://')) {
        const slug = url.split("weightcutwizard://")[1];
        if (slug) {
          const [path, queryString] = slug.split('?');
          // Preserve ?reset=true for password reset deep links
          const params = new URLSearchParams(queryString || '');
          const suffix = params.get('reset') === 'true' ? '?reset=true' : '';

          if (path !== 'callback') {
            navigate(`/${path}${suffix}`);
          } else {
            navigate('/dashboard');
          }
        }
      }
    });
  }, [navigate]);

  // Foreground HealthKit sync.
  //
  // Fires every time iOS reports the app has become active. The 60s
  // throttle (inside `runHealthKitSync`) is shared with the Dashboard
  // mount sync, the post-permission sync from ConnectAppleHealthSheet,
  // and the manual "Sync now" button in HealthSettingsCard so racing
  // call sites collapse to one network round trip.
  //
  // Gated to native — on web/Android `healthKit.isAvailable()` returns
  // false and the helper short-circuits to `null` anyway, but skipping
  // the listener attach entirely keeps the bundle quieter.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let handleRef: { remove: () => void } | null = null;
    let cleanedUp = false;

    CapacitorApp.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) return;
      // Fire-and-forget — never block the foreground transition. Errors
      // are already logged inside `runHealthKitSync`; the .catch here
      // is a belt-and-braces guard against unexpected throws.
      runHealthKitSync(insertHealthSamples).catch((err) => {
        logger.error("foreground HealthKit sync failed", err);
      });
    })
      .then((h) => {
        if (cleanedUp) h.remove();
        else handleRef = h;
      })
      .catch((err) => {
        logger.warn("appStateChange (HealthKit) attach failed", { err: String(err) });
      });

    return () => {
      cleanedUp = true;
      handleRef?.remove();
    };
  }, [insertHealthSamples]);

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
      <div className="min-h-screen-safe flex w-full no-horizontal-scroll">
        <div className="hidden md:block">
          <AppSidebar />
        </div>
        {/* Main content area - responsive padding for mobile */}
        <div className="flex-1 flex flex-col min-w-0 w-full">
          {/* Desktop-only header with sidebar trigger and theme toggle */}
          <header className="hidden md:flex sticky top-0 z-50 h-14 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 items-center justify-between px-4 md:static md:z-auto">
            <SidebarTrigger className="touch-target" />
            <ThemeToggle className="touch-target" />
          </header>
          <OfflineBanner />
          {/* Main content with mobile-first responsive padding - bottom padding for bottom nav */}
          <main className="flex-1 overflow-auto overflow-x-hidden overscroll-y-contain relative min-h-0 w-full pt-2 md:pb-0 safe-area-inset-top safe-area-inset-left safe-area-inset-right animate-app-content-in" style={{ paddingBottom: "calc(4.5rem + env(safe-area-inset-bottom, 0px))", WebkitOverflowScrolling: "touch" }}>
            <PullToRefresh />
            <PageTransition>
              <Suspense fallback={<DashboardSkeleton />}>
                <Outlet />
              </Suspense>
            </PageTransition>
          </main>
        </div>
      </div>
      {/* Bottom Navigation - Mobile Only */}
      <BottomNav />
      <Suspense fallback={null}><FloatingWorkoutIndicator /></Suspense>
      <Suspense fallback={null}><AIFloatingIndicator /></Suspense>
      <FloatingWizardChat />
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
          <WizardBackgroundProvider>
          <FightCampCoachProvider>
            <Toaster />
            <Sonner />
            <PaywallOverlay />
            <WelcomeProOverlay />
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
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/welcome" element={
                  <Suspense fallback={<DashboardSkeleton />}>
                    <WizardIntroCutscene />
                  </Suspense>
                } />
                <Route path="/coach/welcome" element={
                  <Suspense fallback={<DashboardSkeleton />}>
                    <WizardIntroCutscene variant="coach" />
                  </Suspense>
                } />
                <Route path="/auth" element={<Auth />} />
                <Route path="/coach/login" element={<Suspense fallback={<DashboardSkeleton />}><CoachLogin /></Suspense>} />
                <Route path="/legal" element={<Suspense fallback={null}><Legal /></Suspense>} />
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
                  {/* Skill Tree temporarily hidden from UI */}
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
          </WizardBackgroundProvider>
          </AITaskProvider>
          </SubscriptionProvider>
        </UserProvider>
      </ErrorBoundary>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
