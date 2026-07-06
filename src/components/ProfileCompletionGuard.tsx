import { Navigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { useAuth } from "@/contexts/UserContext";
import { WizardLoader } from "@/components/ui/WizardLoader";

export function ProfileCompletionGuard({ children }: { children: React.ReactNode }) {
  // `isCoach` resolves SYNCHRONOUSLY from JWT user_metadata + localStorage,
  // so coaches are routed to /coach even before profile.role finishes loading.
  // Without this, coaches signing in fresh would briefly see /onboarding.
  const { hasProfile, isLoading, isCoach, isProfileResolved, everCompletedProfile } =
    useAuth();

  // `isLoading` only tracks AUTH, which resolves BEFORE the profile query. If
  // we acted on `hasProfile` here we would redirect a returning, onboarded
  // user to /onboarding during the profile-loading window (the reported bounce
  // bug). So keep booting until the profile query has actually resolved. Once
  // a complete profile has been latched this session, treat it as booted even
  // if a later reconnect blips the query back to loading.
  const booting = isLoading || (!isProfileResolved && !everCompletedProfile);

  if (!booting) {
    if (isCoach) return <Navigate to="/coach" replace />;
    // Redirect only a genuinely incomplete profile that has resolved and was
    // never complete this session — never an onboarded user caught in a blip.
    if (!hasProfile && !everCompletedProfile) {
      return <Navigate to="/onboarding" replace />;
    }
  }

  // Keep both the splash and the real content mounted briefly so the transition
  // is a crossfade — no jarring swap when booting flips.
  return (
    <>
      <AnimatePresence mode="sync">
        {booting && <WizardLoader key="wizard-loader" />}
      </AnimatePresence>
      {!booting && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.40, ease: [0.32, 0.72, 0, 1], delay: 0.12 }}
          style={{ willChange: "opacity" }}
        >
          {children}
        </motion.div>
      )}
    </>
  );
}
