import { useEffect, useRef } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { useUser } from "@/contexts/UserContext";
import { useSubscription } from "@/hooks/useSubscription";
import { WellnessCheckIn } from "@/components/fightcamp/WellnessCheckIn";
import { Icon } from "@/components/ui/Icon";
import { celebrateSuccess } from "@/lib/haptics";
import { readDateParam } from "@/lib/dateParam";
import { useSafeDismiss } from "@/hooks/useSafeDismiss";

/**
 * Distraction-free full-screen wellness check-in. Reached from the
 * dashboard Today Strip's "Wellness" pill when today's check-in isn't
 * logged yet. Rendered OUTSIDE AppLayout, so there's no sidebar / bottom
 * nav / offline banner — just back-arrow + the check-in flow.
 */
export default function RecoveryCheckIn() {
  const navigate = useNavigate();
  // Returns to the prior screen, or /dashboard on cold-start/deep-land
  // (window.history.length is unreliable after iOS restores the last route).
  const dismiss = useSafeDismiss();
  const { userId } = useUser();
  const { checkFeatureAccess, isSubscriptionResolved } = useSubscription();
  // The wellness survey is free (it feeds the fight-form-score ring), but the
  // Recovery dashboard is Pro — so after a FREE user finishes, send them to
  // /dashboard rather than onto the locked /recovery screen.
  const isFreeUser = isSubscriptionResolved && !checkFeatureAccess("RECOVERY");
  const afterCheckInRoute = isFreeUser ? "/dashboard" : "/recovery";

  // Target date "YYYY-MM-DD" — today by default, or a validated PAST date when
  // arriving from the dashboard catch-up sheet via `?date=YYYY-MM-DD`. Matches
  // the wellness upsert convention so the row read here is the row written below.
  const [searchParams] = useSearchParams();
  const targetDate = readDateParam(searchParams);

  const todayRows = useQuery(
    api.wellness.listCheckins,
    userId ? { from: targetDate, to: targetDate, limit: 1 } : "skip",
  );
  const alreadyCheckedIn = Array.isArray(todayRows) && todayRows.length > 0;

  // Bounce-on-arrival only: if today's check-in ALREADY existed when the page
  // first loaded, send the user on. This decision is made exactly once (when
  // the query + subscription first resolve) — NOT reactively. Otherwise the
  // reactive `listCheckins` update that fires right after a fresh submit would
  // unmount the survey before its result screen can show.
  const bounceDecidedRef = useRef(false);
  useEffect(() => {
    if (bounceDecidedRef.current) return;
    if (!isSubscriptionResolved || todayRows === undefined) return; // wait for data
    bounceDecidedRef.current = true;
    if (alreadyCheckedIn) navigate(afterCheckInRoute, { replace: true });
  }, [todayRows, alreadyCheckedIn, isSubscriptionResolved, afterCheckInRoute, navigate]);

  if (!userId) return <Navigate to="/" replace />;

  const handleBack = dismiss;

  const handleSubmit = () => {
    celebrateSuccess();
    // Brief delay so the success haptic registers before the route flip.
    setTimeout(() => navigate(afterCheckInRoute, { replace: true }), 250);
  };

  return (
    <div className="min-h-screen-safe bg-background flex flex-col safe-area-inset-top safe-area-inset-left safe-area-inset-right">
      <div className="w-full max-w-md mx-auto flex flex-col flex-1 px-5 pt-3 pb-8">
        <div className="flex items-center mb-4">
          <button
            type="button"
            onClick={handleBack}
            aria-label="Back"
            className="-ml-2 inline-flex items-center justify-center h-11 w-11 text-foreground active:opacity-60 transition-opacity"
          >
            <Icon name="chevronBackOutline" size={24} aria-label="Back" />
          </button>
        </div>
        <div className="flex-1 flex flex-col justify-center">
          <WellnessCheckIn userId={userId} date={targetDate} onSubmit={handleSubmit} />
        </div>
      </div>
    </div>
  );
}
