import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { ChevronLeft, Loader2 } from "lucide-react";
import AuthWizardHero from "@/components/auth/AuthWizardHero";
import { motion } from "motion/react";
import { Capacitor } from "@capacitor/core";
import { isIOS, isNative, googleInitOptions } from "@/lib/platform";
import { useAuthActions } from "@convex-dev/auth/react";
import { useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useToast } from "@/hooks/use-toast";
import { useScrollIntoViewOnFocus } from "@/hooks/useScrollIntoViewOnFocus";
import { useAuth } from "@/contexts/UserContext";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { routeAfterAuth } from "@/lib/roleRouter";
import { mapAuthError } from "@/lib/authErrors";
import { logger } from "@/lib/logger";
import { track, EVENTS } from "@/lib/analytics";

const inputClass =
  "h-[50px] rounded-xs bg-muted/40 dark:bg-white/[0.06] border-border/40 text-foreground placeholder:text-muted-foreground/50 px-4 text-[16px] focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all";

// App Store compliance (Guideline 2.1): the password-reset flow has no wired
// backend yet (no Convex Password `reset:` handler + Resend sender is a
// Phase-3 TODO that throws), so the entry point is hidden until it ships.
// Mirrors PASSWORD_RESET_ENABLED in src/pages/Auth.tsx — flip to `true` to
// re-enable once the email sender is wired. Reset UI/handlers below are left
// intact (just unreachable).
const PASSWORD_RESET_ENABLED = false;

export default function CoachLogin() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showForgot, setShowForgot] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [loading, setLoading] = useState(false);
  const [exiting, setExiting] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();
  const { userId } = useAuth();
  const { signIn } = useAuthActions();
  const setRoleMut = useMutation(api.profiles.setRole);
  const purgeOrphanedAccount = useMutation(api.authCleanup.purgeOrphanedAccount);
  // Keep the focused field above the software keyboard (iOS + Android).
  const handleInputFocus = useScrollIntoViewOnFocus();

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
        // Clear any orphaned auth account left behind by a manual `users`-row
        // delete (e.g. straight from the Convex dashboard) so a previously
        // deleted email can register cleanly. No-op for fresh emails and for
        // live accounts — a real duplicate still errors below. Best-effort.
        try { await purgeOrphanedAccount({ email }); } catch (purgeErr) { logger.warn("CoachLogin: orphan purge failed", { purgeErr }); }

        try {
          await signIn("password", { email, password, flow: "signUp", role: "coach" });
        } catch (err) {
          logger.warn("CoachLogin: signUp failed", { err });
          setErrorMsg(mapAuthError(err, "signUp"));
          return;
        }
        // Brand-new coach account created (signUp flow, not signIn) —
        // activation funnel entry point. Fired only after the await resolves.
        track(EVENTS.SIGNED_UP, { method: "password", role: "coach" });
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
        // Derive Convex callback URL from env so dev/staging/prod each
        // point at their own deployment instead of a hardcoded value.
        // Mirrors the fighter login (Auth.tsx) so both doors use the
        // identical production callback. The matching URL must be
        // registered on the Apple Developer console under the
        // Sign-in-with-Apple Services ID.
        const convexSiteUrl = import.meta.env.VITE_CONVEX_SITE_URL as string | undefined;
        if (!convexSiteUrl) {
          throw new Error("VITE_CONVEX_SITE_URL not set, cannot build Apple redirect URI");
        }
        const redirectURI = `${convexSiteUrl}/api/auth/callback/apple`;
        const { SignInWithApple } = await import("@capacitor-community/apple-sign-in");
        const result = await SignInWithApple.authorize({
          clientId: "com.weightcutwizard.app",
          redirectURI,
          scopes: "email",
          nonce: hashedNonce,
        });
        // Must be "apple-native" (not "apple") so Convex verifies the
        // id_token + nonce server-side; bare "apple" has no native handler
        // and falls into a redirect. Mirrors Auth.tsx:291.
        await signIn("apple-native", {
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

  const handleGoogle = async () => {
    setLoading(true);
    try {
      // Android-only native path, mirrors handleApple. Capgo plugin is
      // dynamically imported so it never lands in the iOS bundle. No
      // web-origin redirect fallback here: Android always takes the native
      // id_token path, so there's no origin-mismatch bug on native. (E3.)
      const googleOpts = googleInitOptions();
      if (!googleOpts) {
        // Placeholder-safe: OAuth client id for this platform not pasted into
        // platform.ts yet. Don't crash — soft toast and bail.
        toast({ title: "Google Sign-In isn't configured yet", description: "Please use email sign-in for now." });
        return;
      }
      const { SocialLogin } = await import("@capgo/capacitor-social-login");
      await SocialLogin.initialize({ google: googleOpts });
      // Google echoes the RAW nonce in the id_token's `nonce` claim (unlike
      // Apple, which expects SHA-256(nonce)); the server compares it raw.
      const nonce = crypto.randomUUID();
      // No `scopes`: online flow returns an id_token (email + profile) via
      // Credential Manager; scopes would require extra MainActivity wiring.
      const res = await SocialLogin.login({
        provider: "google",
        options: { nonce },
      });
      const idToken =
        res.provider === "google" && "idToken" in res.result ? res.result.idToken : null;
      if (!idToken) {
        throw new Error("Google did not return an id_token");
      }
      // Pass the coach role so the bootstrap profile row is created as a
      // coach atomically (mirrors the coach Apple flow).
      await signIn("google-native", { idToken, nonce, role: "coach" });
      // Belt-and-braces: ensure the freshly-bootstrapped profile is coach.
      try { await setRoleMut({ role: "coach" }); } catch (err) {
        logger.warn("CoachLogin: setRole failed (Google)", { err });
      }
    } catch (err: any) {
      const code = err?.code;
      const m = String(err?.message ?? "").toLowerCase();
      if (code === "USER_CANCELLED" || m.includes("cancel")) {
        setLoading(false);
        return;
      }
      toast({ variant: "destructive", title: "Google Sign-In Failed", description: err?.message });
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
          paddingBottom: "calc(max(env(safe-area-inset-bottom, 0px), var(--keyboard-inset, 0px)) + 24px)",
          opacity: exiting ? 0 : 1,
          transform: exiting ? "scale(0.97)" : "scale(1)",
          transition: "all 250ms ease-out",
        }}
      >
        <div className="w-full max-w-[360px] pt-4 animate-page-in">
          <AuthWizardHero title="Welcome" subtitle="Manage your gym and athletes" />

          {/* Forms — social-first layout */}
          <div className="space-y-4">
            {PASSWORD_RESET_ENABLED && showForgot ? (
              /* Forgot password form */
              <form onSubmit={handleForgot} className="space-y-3">
                <Input type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputClass} autoFocus />
                <Button type="submit" disabled={loading} className="w-full h-[50px] rounded-xs bg-primary text-primary-foreground font-semibold text-[16px] active:scale-[0.98] transition-transform disabled:opacity-50">
                  {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : "Send Reset Link"}
                </Button>
                <button type="button" onClick={() => setShowForgot(false)} className="w-full text-center text-sm text-muted-foreground py-2">Back to Sign In</button>
              </form>
            ) : (
              <>
                {/* Apple Sign-In — primary CTA, shown on iOS + web */}
                {(isIOS() || !isNative()) && (
                  <button
                    type="button"
                    onClick={handleApple}
                    disabled={loading}
                    className="no-tap-select w-full h-[54px] rounded-xs bg-foreground text-background font-semibold text-[16px] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform touch-manipulation disabled:opacity-50"
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.52-3.23 0-1.44.62-2.2.44-3.06-.4C3.79 16.17 4.36 9.51 8.82 9.28c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.3 4.11zM12.03 9.2C11.88 7.16 13.5 5.5 15.42 5.35c.28 2.35-2.14 4.1-3.39 3.85z" />
                    </svg>
                    {isLogin ? "Sign in with Apple" : "Sign up with Apple"}
                  </button>
                )}

                {/* Google Sign-In — native platforms */}
                {isNative() && (
                  <button
                    type="button"
                    onClick={handleGoogle}
                    disabled={loading}
                    className="no-tap-select w-full h-[54px] rounded-xs bg-white text-[#1f1f1f] border border-black/10 font-semibold text-[16px] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform touch-manipulation disabled:opacity-50"
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
                      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.56c2.08-1.92 3.28-4.74 3.28-8.09z" />
                      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.56-2.76c-.98.66-2.23 1.06-3.72 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23z" />
                      <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84z" />
                      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05l3.66 2.84c.87-2.6 3.3-4.51 6.16-4.51z" />
                    </svg>
                    {isLogin ? "Sign in with Google" : "Sign up with Google"}
                  </button>
                )}

                {/* Email form — collapsed behind a quiet link until the user opts in */}
                {!showEmailForm ? (
                  <button
                    type="button"
                    onClick={() => setShowEmailForm(true)}
                    className="no-tap-select w-full text-center text-[13px] text-muted-foreground hover:text-foreground transition-colors py-2"
                  >
                    Continue with email →
                  </button>
                ) : (
                  <motion.div
                    key="coach-email-form"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                    style={{ willChange: "transform, opacity" }}
                    className="space-y-3"
                  >
                    <div className="flex items-center gap-3 pt-1">
                      <div className="flex-1 h-px bg-border/50" />
                      <span className="text-[11px] uppercase tracking-wider text-muted-foreground/70">or with email</span>
                      <div className="flex-1 h-px bg-border/50" />
                    </div>

                    {/* Sign In / Sign Up tabs */}
                    <div className="flex bg-muted/40 dark:bg-white/[0.06] rounded-xs p-1 border border-border/40">
                      <button
                        type="button"
                        onClick={() => switchTab(true)}
                        className={`flex-1 h-[42px] rounded-xs text-[14px] font-medium transition-all duration-200 ${isLogin ? "bg-background text-foreground" : "text-muted-foreground"}`}
                      >
                        Sign In
                      </button>
                      <button
                        type="button"
                        onClick={() => switchTab(false)}
                        className={`flex-1 h-[42px] rounded-xs text-[14px] font-medium transition-all duration-200 ${!isLogin ? "bg-background text-foreground" : "text-muted-foreground"}`}
                      >
                        Sign Up
                      </button>
                    </div>

                    <form onSubmit={handleAuth} className="space-y-3">
                      <Input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} onFocus={handleInputFocus} required className={inputClass} autoFocus />
                      <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} onFocus={handleInputFocus} required minLength={isLogin ? 1 : 8} className={inputClass} />
                      {!isLogin && (
                        <Input type="password" placeholder="Confirm password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} onFocus={handleInputFocus} required minLength={8} className={inputClass} />
                      )}
                      {errorMsg && <p className="text-xs text-func-danger-red text-center">{errorMsg}</p>}
                      <Button type="submit" disabled={loading} className="w-full h-[50px] rounded-xs bg-primary text-primary-foreground font-semibold text-[16px] active:scale-[0.98] transition-transform disabled:opacity-50">
                        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : isLogin ? "Sign In" : "Create Account"}
                      </Button>
                    </form>

                    {PASSWORD_RESET_ENABLED && isLogin && (
                      <button type="button" onClick={() => setShowForgot(true)} className="w-full text-center text-sm text-muted-foreground py-1">
                        Forgot password?
                      </button>
                    )}
                  </motion.div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          {!showForgot && (
            <div className="mt-8 space-y-3 text-center">
              <div>
                <button
                  type="button"
                  onClick={() => { setIsLogin(false); setShowEmailForm(true); setErrorMsg(""); setConfirmPassword(""); }}
                  className="text-sm text-primary font-medium"
                >
                  New coach? Create account
                </button>
              </div>
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => navWithExit("/auth")}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-card/40 px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                >
                  Are you a fighter? <span className="text-foreground/90 font-semibold">Athlete sign-in →</span>
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
