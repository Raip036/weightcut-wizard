import { useEffect } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { useUser } from "@/contexts/UserContext";
import { useSubscription } from "@/hooks/useSubscription";
import { WellnessCheckIn } from "@/components/fightcamp/WellnessCheckIn";
import { Icon } from "@/components/ui/Icon";
import { celebrateSuccess } from "@/lib/haptics";

/**
 * Distraction-free full-screen wellness check-in. Reached from the
 * dashboard Today Strip's "Wellness" pill when today's check-in isn't
 * logged yet. Rendered OUTSIDE AppLayout, so there's no sidebar / bottom
 * nav / offline banner — just back-arrow + the check-in flow.
 */
export default function RecoveryCheckIn() {
  const navigate = useNavigate();
  const { userId } = useUser();
  const { checkFeatureAccess, isSubscriptionResolved } = useSubscription();
  // The wellness survey is free (it feeds the fight-form-score ring), but the
  // Recovery dashboard is Pro — so after a FREE user finishes, send them to
  // /dashboard rather than onto the locked /recovery screen.
  const isFreeUser = isSubscriptionResolved && !checkFeatureAccess("RECOVERY");
  const afterCheckInRoute = isFreeUser ? "/dashboard" : "/recovery";

  // Local-date "YYYY-MM-DD" — matches the dashboard's TodayStrip / wellness
  // upsert convention so the row read here is the row written below.
  const today = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();

  const todayRows = useQuery(
    api.wellness.listCheckins,
    userId ? { from: today, to: today, limit: 1 } : "skip",
  );
  const alreadyCheckedIn = Array.isArray(todayRows) && todayRows.length > 0;

  // If we know definitively that today's check-in already exists, bounce
  // to the dashboard. The mutation is idempotent (upsert), so this is a
  // UX nicety rather than a data-integrity requirement.
  useEffect(() => {
    if (alreadyCheckedIn && isSubscriptionResolved)
      navigate(afterCheckInRoute, { replace: true });
  }, [alreadyCheckedIn, isSubscriptionResolved, afterCheckInRoute, navigate]);

  if (!userId) return <Navigate to="/" replace />;

  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/");
  };

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
          <WellnessCheckIn userId={userId} onSubmit={handleSubmit} />
        </div>
      </div>
    </div>
  );
}
