import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ChevronLeft, ClipboardList, Loader2 } from "lucide-react";
import { motion } from "motion/react";
import { Capacitor } from "@capacitor/core";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/UserContext";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { routeAfterAuth } from "@/lib/roleRouter";
import { mapAuthError } from "@/lib/authErrors";
import { logger } from "@/lib/logger";

const inputClass =
  "h-[50px] rounded-xs bg-muted/40 dark:bg-white/[0.06] border-border/40 text-foreground placeholder:text-muted-foreground/50 px-4 text-[16px] focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all";

export default function CoachLogin() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showForgot, setShowForgot] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [exiting, setExiting] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { userId } = useAuth();
  const { signIn } = useAuthActions();
  const setRoleMut = useMutation(api.profiles.setRole);

  // Already-authed user — route them to the right surface
  useEffect(() => {
    if (userId) void routeAfterAuth(userId, "coach", navigate, toast);
  }, [userId, navigate, toast]);

  const navWithExit = (path: string) => {
    setExiting(true);
    setTimeout(() => navigate(path), 250);
  };

  const switchTab = (next: boolean) => {
    triggerHaptic(ImpactStyle.Light);
    setIsLogin(next);
    setErrorMsg("");
    setConfirmPassword("");
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg("");
    try {
      if (isLogin) {
        try {
          await signIn("password", { email, password, flow: "signIn" });
        } catch (err) {
          logger.warn("CoachLogin: signIn failed", { err });
          setErrorMsg(mapAuthError(err, "signIn"));
          return;
        }
        // routeAfterAuth fires from the useEffect once userId resolves.
      } else {
        if (password !== confirmPassword) { setErrorMsg("Passwords do not match"); return; }
        // Convex Auth's default validator requires 8+ characters; matching
        // here keeps the client + server rules in sync so users don't get
        // the cryptic "Invalid password" round-trip.
        if (password.length < 8) { setErrorMsg("Password must be at least 8 characters"); return; }
        try { localStorage.setItem("wcw_intended_role", "coach"); } catch {}
        try {
          await signIn("password", { email, password, flow: "signUp", role: "coach" });
        } catch (err) {
          logger.warn("CoachLogin: signUp failed", { err });
          setErrorMsg(mapAuthError(err, "signUp"));
          return;
        }
        // Belt-and-braces: convex/auth.ts now persists `role: "coach"` on
        // the bootstrap row directly from the signUp params, so this is a
        // no-op for fresh accounts. We keep the call to cover the edge
        // case where the profile row was created before that wiring.
        try { await setRoleMut({ role: "coach" }); } catch (err) {
          logger.warn("CoachLogin: setRole failed", { err });
        }
        navigate("/coach/onboarding", { replace: true });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await signIn("password", { email, flow: "reset" });
      toast({ title: "Email sent", description: "Check your inbox for the reset link." });
      setShowForgot(false);
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: err?.message || "Failed to send" });
    } finally {
      setLoading(false);
    }
  };

  const handleApple = async () => {
    setLoading(true);
    try {
      if (Capacitor.isNativePlatform()) {
        const rawNonce = crypto.randomUUID();
        const hashBuf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawNonce));
        const hashedNonce = Array.from(new Uint8Array(hashBuf)).map((b) => b.toString(16).padStart(2, "0")).join("");
        const { SignInWithApple } = await import("@capacitor-community/apple-sign-in");
        const result = await SignInWithApple.authorize({
          clientId: "com.weightcutwizard.app",
          // Convex Auth's Apple callback (same as Auth.tsx).
          redirectURI: "https://warmhearted-koala-322.eu-west-1.convex.site/api/auth/callback/apple",
          scopes: "email",
          nonce: hashedNonce,
        });
        await signIn("apple", {
          idToken: result.response.identityToken,
          nonce: rawNonce,
        });
        // Mark the freshly-bootstrapped profile as coach.
        try { await setRoleMut({ role: "coach" }); } catch (err) {
          logger.warn("CoachLogin: setRole failed (Apple)", { err });
        }
      } else {
        await signIn("apple", { redirectTo: `${window.location.origin}/coach` });
      }
    } catch (err: any) {
      const m = String(err?.message ?? "").toLowerCase();
      if (m.includes("cancel") || err?.code === "ERR_CANCELED" || err?.code === 1001) {
        setLoading(false);
        return;
      }
      toast({ variant: "destructive", title: "Apple Sign-In Failed", description: err?.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="relative min-h-screen bg-background text-foreground flex flex-col overflow-hidden"
    >
      {/* Subtle blue→teal radial wash in the upper third so the coach
          door reads visually distinct from the fighter door at a glance. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[60vh] opacity-60"
        style={{
          background:
            "radial-gradient(ellipse at 50% 0%, rgba(56, 189, 248, 0.18) 0%, rgba(20, 184, 166, 0.08) 35%, transparent 70%)",
        }}
      />

      {/* Nav bar */}
      <div
        className="relative flex items-center justify-between px-4 shrink-0"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)", paddingBottom: 8 }}
      >
        <button
          type="button"
          onClick={() => navWithExit("/")}
          className="flex items-center gap-0.5 min-h-[44px] min-w-[44px] -ml-2 pl-2 pr-3 rounded-full text-primary active:opacity-60 transition-opacity"
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5" strokeWidth={2.5} />
          <span className="text-[17px]">Back</span>
        </button>
        <ThemeToggle />
      </div>

      <div
        className="relative flex-1 flex flex-col items-center px-6 overflow-y-auto"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)",
          opacity: exiting ? 0 : 1,
          transform: exiting ? "scale(0.97)" : "scale(1)",
          transition: "all 250ms ease-out",
        }}
      >
        <div className="w-full max-w-[360px] pt-4 animate-page-in">
          {/* Coach brand mark — blue/teal gradient + clipboard icon makes
              this door instantly recognizable as "for coaches" so fighters
              don't accidentally complete signup here. */}
          <div className="flex flex-col items-center text-center mb-8">
            <div className="relative mb-4">
              <div className="relative flex h-16 w-16 items-center justify-center rounded-xs bg-card ring-2 ring-primary/60 shadow-xl shadow-primary/20">
                <ClipboardList className="h-7 w-7 text-primary" strokeWidth={2.25} />
              </div>
            </div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/90">
              Coach sign-in
            </p>
            <h1 className="mt-1.5 text-2xl font-bold tracking-tight">
              {showForgot ? "Reset Password" : isLogin ? "Welcome back, coach" : "Open your gym"}
            </h1>
            <p className="text-[13px] text-muted-foreground mt-1">
              {showForgot ? "We'll email you a reset link" : "Manage your gym + athletes"}
            </p>
          </div>

          {/* Tabs */}
          {!showForgot && (
            <div className="flex bg-muted/40 dark:bg-white/[0.06] rounded-xs p-1 border border-border/40 mb-4">
              <button
                type="button"
                onClick={() => switchTab(true)}
                className={`flex-1 h-[42px] rounded-xs text-[14px] font-medium transition-all duration-200 ${isLogin ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => switchTab(false)}
                className={`flex-1 h-[42px] rounded-xs text-[14px] font-medium transition-all duration-200 ${!isLogin ? "bg-background text-foreground shadow-sm" : "text-muted-foreground"}`}
              >
                Sign Up
              </button>
            </div>
          )}

          {/* Forms */}
          <div className="space-y-4">
            {showForgot ? (
              <form onSubmit={handleForgot} className="space-y-3">
                <Input type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputClass} autoFocus />
                <Button type="submit" disabled={loading} className="w-full h-[50px] rounded-xs bg-primary text-primary-foreground font-semibold text-[16px] active:scale-[0.98] transition-transform disabled:opacity-50">
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Send Reset Link"}
                </Button>
                <button type="button" onClick={() => setShowForgot(false)} className="w-full text-center text-sm text-muted-foreground py-2">Back to Sign In</button>
              </form>
            ) : (
              <>
                <form onSubmit={handleAuth} className="space-y-3">
                  <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputClass} autoFocus />
                  <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={isLogin ? 1 : 8} className={inputClass} />
                  {!isLogin && (
                    <Input type="password" placeholder="Confirm password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} className={inputClass} />
                  )}
                  {errorMsg && <p className="text-xs text-func-danger-red text-center">{errorMsg}</p>}
                  <Button type="submit" disabled={loading} className="w-full h-[50px] rounded-xs bg-primary text-primary-foreground font-semibold text-[16px] active:scale-[0.98] transition-transform disabled:opacity-50 shadow-lg shadow-primary/20">
                    {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : isLogin ? "Sign In" : "Create Account"}
                  </Button>
                </form>

                <div className="flex items-center gap-3 py-1">
                  <div className="flex-1 h-px bg-border/50" />
                  <span className="text-xs text-muted-foreground">or</span>
                  <div className="flex-1 h-px bg-border/50" />
                </div>

                <button
                  type="button"
                  onClick={handleApple}
                  disabled={loading}
                  className="w-full h-[50px] rounded-xs bg-foreground text-background font-semibold text-[16px] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-50"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.52-3.23 0-1.44.62-2.2.44-3.06-.4C3.79 16.17 4.36 9.51 8.82 9.28c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.3 4.11zM12.03 9.2C11.88 7.16 13.5 5.5 15.42 5.35c.28 2.35-2.14 4.1-3.39 3.85z" />
                  </svg>
                  {isLogin ? "Sign in with Apple" : "Sign up with Apple"}
                </button>
              </>
            )}
          </div>

          {/* Footer */}
          {!showForgot && (
            <div className="mt-8 space-y-3 text-center">
              {isLogin && (
                <button type="button" onClick={() => setShowForgot(true)} className="text-sm text-muted-foreground">Forgot password?</button>
              )}
              <div>
                <button
                  type="button"
                  onClick={() => navWithExit("/auth")}
                  className="text-[12px] text-muted-foreground/70 hover:text-muted-foreground transition-colors"
                >
                  Are you a fighter? Athlete sign in →
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-center gap-2 mt-6 text-[11px] text-muted-foreground/50">
            <Link to="/legal?tab=privacy" className="hover:text-muted-foreground transition-colors">Privacy</Link>
            <span>·</span>
            <Link to="/legal?tab=terms" className="hover:text-muted-foreground transition-colors">Terms</Link>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
