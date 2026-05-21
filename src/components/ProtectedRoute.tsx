import { useEffect, useRef, useState } from "react";
import { Navigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { useAuth } from "@/contexts/UserContext";
import { Button } from "@/components/ui/button";
import { RefreshCw, AlertTriangle } from "lucide-react";
import { WizardLoader } from "@/components/ui/WizardLoader";

// Boot grace period: on cold start (especially iOS Capacitor) Supabase's
// INITIAL_SESSION event can take 1-3s to resolve. If `isLoading` flips false
// briefly while `userId` is still null (cache-served path with no session),
// this guard prevents an immediate /auth redirect that would feel like a
// random logout. After the window we trust the auth state.
const BOOT_GRACE_MS = 3500;

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { userId, isLoading, authError, retryAuth } = useAuth();
  const mountedAtRef = useRef<number>(Date.now());
  const [bootGraceExpired, setBootGraceExpired] = useState(false);
  useEffect(() => {
    const elapsed = Date.now() - mountedAtRef.current;
    if (elapsed >= BOOT_GRACE_MS) {
      setBootGraceExpired(true);
      return;
    }
    const t = setTimeout(() => setBootGraceExpired(true), BOOT_GRACE_MS - elapsed);
    return () => clearTimeout(t);
  }, []);

  if (authError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="relative flex items-center justify-center w-28 h-28 opacity-50">
            <div className="rounded-xs bg-primary/10 p-4">
              <AlertTriangle className="h-10 w-10 text-primary" />
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-base font-semibold">Couldn't connect</p>
            <p className="text-sm text-muted-foreground">Check your internet and try again.</p>
          </div>
          <Button onClick={retryAuth} variant="outline" size="lg">
            <RefreshCw className="h-4 w-4 mr-2" />
            Try again
          </Button>
        </div>
      </div>
    );
  }

  if (!isLoading && !userId && bootGraceExpired) {
    return <Navigate to="/auth" replace />;
  }

  // During the boot grace window with no resolved user, hold the loader
  // instead of redirecting. UserContext's auth resolution will populate
  // userId or surface authError shortly.
  if (!isLoading && !userId && !bootGraceExpired) {
    return (
      <AnimatePresence mode="sync">
        <WizardLoader key="wizard-loader-boot" />
      </AnimatePresence>
    );
  }

  // Crossfade between splash and real content so auth resolution is seamless.
  return (
    <>
      <AnimatePresence mode="sync">
        {isLoading && <WizardLoader key="wizard-loader" />}
      </AnimatePresence>
      {!isLoading && userId && (
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
