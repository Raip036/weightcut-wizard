import { useState, useEffect, useRef, forwardRef, type ComponentProps, type ReactNode } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/UserContext";
import { routeAfterAuth } from "@/lib/roleRouter";
import { mapAuthError, isAppleCancelError } from "@/lib/authErrors";
import wizardLogo from "@/assets/wizard-logo.webp";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ChevronLeft, Mail, Lock, Eye, EyeOff, Swords } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { motion, AnimatePresence } from "motion/react";
import { logger } from "@/lib/logger";

// ──────────────────────────────────────────────────────────────────────
// PremiumInput — floating-label, glass-style text field used in the
// expanded email/password form. Designed so iOS Keychain autofill,
// Strong Password suggestions and the keyboard's Next/Go affordance
// all "just work" via standard HTML attributes.
// ──────────────────────────────────────────────────────────────────────
type PremiumInputProps = Omit<ComponentProps<"input">, "type"> & {
  label: string;
  type?: "email" | "password" | "text";
  icon?: ReactNode;
  error?: boolean;
  /** Optional show/hide toggle for password fields. Default off. */
  toggleable?: boolean;
};

const PremiumInput = forwardRef<HTMLInputElement, PremiumInputProps>(function PremiumInput(
  { label, type = "text", icon, error = false, toggleable = false, className = "", ...rest },
  ref,
) {
  const [revealed, setRevealed] = useState(false);
  const effectiveType = toggleable && revealed ? "text" : type;
  return (
    <div className="relative group">
      {icon && (
        <div
          className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 transition-colors ${
            error ? "text-destructive/80" : "text-muted-foreground/60 group-focus-within:text-primary/90"
          }`}
        >
          {icon}
        </div>
      )}
      <input
        {...rest}
        ref={ref}
        type={effectiveType}
        placeholder=" "
        className={`peer h-[58px] w-full rounded-xs bg-white/[0.04] dark:bg-white/[0.05] border ${
          error
            ? "border-destructive/60 focus:border-destructive focus:ring-destructive/20"
            : "border-white/[0.06] focus:border-primary/60 focus:ring-primary/15"
        } text-foreground text-[16px] ${icon ? "pl-11" : "pl-4"} ${
          toggleable ? "pr-12" : "pr-4"
        } pt-5 pb-1 outline-none focus:ring-4 transition-[border-color,box-shadow,background-color] duration-150 ease-out caret-primary shadow-[inset_0_1px_0_0_rgba(255,255,255,0.04)] ${className}`}
      />
      <label
        className={`pointer-events-none absolute ${
          icon ? "left-11" : "left-4"
        } top-1/2 -translate-y-1/2 text-[15px] text-muted-foreground/60 transition-all duration-150 ease-out
        peer-focus:top-3.5 peer-focus:translate-y-0 peer-focus:text-[11px] peer-focus:font-semibold peer-focus:tracking-wide ${
          error ? "peer-focus:text-destructive/80" : "peer-focus:text-primary/80"
        }
        peer-[:not(:placeholder-shown)]:top-3.5 peer-[:not(:placeholder-shown)]:translate-y-0 peer-[:not(:placeholder-shown)]:text-[11px] peer-[:not(:placeholder-shown)]:font-semibold peer-[:not(:placeholder-shown)]:tracking-wide`}
      >
        {label}
      </label>
      {toggleable && (
        <button
          type="button"
          aria-label={revealed ? "Hide password" : "Show password"}
          onClick={() => setRevealed((r) => !r)}
          className="no-tap-select absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-xs text-muted-foreground/60 hover:text-foreground active:bg-white/5 active:scale-95 transition"
        >
          {revealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
});

export default function Auth() {
  const [isLogin, setIsLogin] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("mode") !== "signup";
  });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  // Apple Sign In is the headline path — the email/password form stays
  // collapsed behind a "Continue with email" link until the user opts
  // in. This cuts perceived friction on first paint and pushes the
  // one-tap conversion above the fold.
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [passwordError, setPasswordError] = useState("");
  const [loading, setLoading] = useState(false);
  // /auth is now the athlete-only door. Coaches go through /coach/login
  // which is themed distinctly so neither role can accidentally sign up
  // through the wrong page. Role is hard-coded to "fighter" here.
  const ROLE = "fighter" as const;
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { toast } = useToast();
  const { userId } = useAuth();
  const { signIn } = useAuthActions();

  const isPasswordReset = searchParams.get("reset") === "true";

  useEffect(() => {
    if (userId && !isPasswordReset) {
      const joinCode = searchParams.get("join");
      if (joinCode) {
        navigate(`/join?code=${encodeURIComponent(joinCode)}`, { replace: true });
        return;
      }
      // Role-aware: if a coach signs in via the athlete door, bounce them
      // to /coach instead of /dashboard. Single-column read on indexed `role`.
      void routeAfterAuth(userId, ROLE, navigate, toast);
    }
  }, [userId, isPasswordReset, navigate, searchParams, toast]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setPasswordError("");
    try {
      if (isLogin) {
        try {
          // Convex Auth Password provider: flow "signIn" verifies existing credentials.
          await signIn("password", { email, password, flow: "signIn" });
        } catch (error) {
          toast({ variant: "destructive", title: "Sign in failed", description: mapAuthError(error, "signIn") });
          return;
        }
      } else {
        if (password !== confirmPassword) {
          setPasswordError("Passwords do not match");
          return;
        }
        // Convex Auth's default validator requires 8+ characters; matching
        // here keeps the client + server rules in sync so users don't get
        // the cryptic "Invalid password" round-trip.
        if (password.length < 8) {
          setPasswordError("Password must be at least 8 characters");
          return;
        }
        // Stash intended role so the profile bootstrap / onboarding flow picks it up.
        try { localStorage.setItem("wcw_intended_role", ROLE); } catch {}

        try {
          await signIn("password", { email, password, flow: "signUp", role: ROLE });
        } catch (error) {
          toast({ variant: "destructive", title: "Sign up failed", description: mapAuthError(error, "signUp") });
          return;
        }
        // Fighters fall through to the post-auth router which lands on
        // /onboarding via ProfileCompletionGuard. Coach sign-up is owned
        // by /coach/login exclusively.
      }
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Convex Auth Password provider: flow "reset" sends a verification
      // code to the user's email via the configured email provider.
      // TODO(phase-3): email provider (Resend) must be wired into
      // `auth.ts`'s Password({ reset: ... }) before this works end-to-end.
      await signIn("password", { email, flow: "reset" });
      toast({ title: "Email sent", description: "Check your inbox for a reset code." });
      setShowForgotPassword(false);
      setEmail("");
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: mapAuthError(error, "reset") });
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError("");
    if (password !== confirmPassword) { setPasswordError("Passwords do not match"); return; }
    if (password.length < 8) { setPasswordError("Must be at least 8 characters"); return; }
    setLoading(true);
    try {
      // Convex Auth's password reset is a two-step flow: the email contains
      // a code that the user enters here together with their new password.
      // The current UI doesn't yet collect the code — Phase-3 will add a
      // code input. For now this submits with the code field empty, which
      // will trip the validation on the server. Surface the TODO clearly.
      const code = searchParams.get("code") ?? "";
      await signIn("password", {
        email,
        code,
        newPassword: password,
        flow: "reset-verification",
      });
      toast({ title: "Password updated!" });
      setSearchParams({});
      navigate("/dashboard");
    } catch (error: any) {
      toast({ variant: "destructive", title: "Error", description: mapAuthError(error, "reset-verification") });
    } finally {
      setLoading(false);
    }
  };

  const handleAppleSignIn = async () => {
    setLoading(true);
    try {
      if (Capacitor.isNativePlatform()) {
        // Native iOS path: use the @capacitor-community/apple-sign-in
        // plugin (already in package.json) to get an identity token from
        // Apple, then exchange it via Convex Auth.
        const rawNonce = crypto.randomUUID();
        const encoder = new TextEncoder();
        const hashBuffer = await crypto.subtle.digest("SHA-256", encoder.encode(rawNonce));
        const hashedNonce = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
        // Derive Convex callback URL from env so dev/staging/prod each
        // point at their own deployment instead of a hardcoded value.
        // The matching URL must be registered on the Apple Developer
        // console under the Sign-in-with-Apple Services ID.
        const convexSiteUrl = import.meta.env.VITE_CONVEX_SITE_URL as string | undefined;
        if (!convexSiteUrl) {
          throw new Error("VITE_CONVEX_SITE_URL not set — cannot build Apple redirect URI");
        }
        const redirectURI = `${convexSiteUrl}/api/auth/callback/apple`;
        // Production-safe diagnostic logging (raw console so logger's
        // dev-only gate doesn't strip these in the prod build).
        console.log("[apple-signin] starting native authorize", { redirectURI });
        const { SignInWithApple } = await import("@capacitor-community/apple-sign-in");
        const result = await SignInWithApple.authorize({
          // Native bundle ID (Apple Developer → App ID, NOT the Services ID).
          clientId: "com.weightcutwizard.app",
          redirectURI,
          scopes: "email",
          nonce: hashedNonce,
        });
        console.log("[apple-signin] native authorize returned", {
          hasIdentityToken: !!result.response.identityToken,
          hasEmail: !!result.response.email,
          userIdPresent: !!result.response.user,
          identityTokenPrefix: (result.response.identityToken || "").slice(0, 40),
        });
        // The bare `Apple` provider's signIn dispatcher in @convex-dev/auth
        // has no native-id_token short-circuit (always returns a redirect),
        // so we use a sibling `ConvexCredentials` provider with id
        // "apple-native" that verifies the id_token + nonce server-side
        // and upserts the user via `createAccount`. The React client
        // automatically persists the issued tokens once this resolves.
        console.log("[apple-signin] calling Convex signIn (apple-native)...");
        const signInResult = await signIn("apple-native", {
          idToken: result.response.identityToken,
          nonce: rawNonce,
          // Apple sends email / name only on the FIRST consent; relay
          // whatever the plugin captured so the user row stores them.
          ...(result.response.email ? { email: result.response.email } : {}),
          ...(result.response.givenName ? { givenName: result.response.givenName } : {}),
          ...(result.response.familyName ? { familyName: result.response.familyName } : {}),
          // /auth is the fighter door — coaches must use /coach/login.
          role: ROLE,
        });
        console.log("[apple-signin] Convex signIn resolved", { result: signInResult });
      } else {
        // Web / Capacitor-with-no-plugin path: open the OAuth browser flow.
        // Convex Auth will redirect to its callback HTTP route and then
        // back to the app via the `redirectTo` URL.
        await signIn("apple", { redirectTo: `${window.location.origin}/dashboard` });
      }
    } catch (error: any) {
      // User backed out of the Apple sheet (or closed the web popup) — never
      // toast for this. `isAppleCancelError` covers every form we've seen
      // across Capacitor, Convex, and the web flow.
      if (isAppleCancelError(error)) {
        setLoading(false);
        return;
      }
      console.error("[apple-signin] FAILED", {
        message: error?.message,
        code: error?.code,
        name: error?.name,
        stack: error?.stack?.split("\n").slice(0, 5).join(" | "),
        raw: error,
      });
      toast({ variant: "destructive", title: "Apple Sign-In Failed", description: error.message || "Please try again." });
    } finally {
      setLoading(false);
    }
  };

  // Refs used to chain the keyboard's "Next" / "Go" affordance across
  // the email/password fields without forcing the user to tap into
  // each one. enterKeyHint paints the right key label; the onKeyDown
  // handler does the actual focus jump.
  const passwordRef = useRef<HTMLInputElement | null>(null);
  const confirmRef = useRef<HTMLInputElement | null>(null);

  const passwordTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (passwordTimerRef.current) clearTimeout(passwordTimerRef.current);
    passwordTimerRef.current = setTimeout(() => {
      if ((!isLogin || isPasswordReset) && confirmPassword && password !== confirmPassword) {
        setPasswordError("Passwords do not match");
      } else if ((!isLogin || isPasswordReset) && confirmPassword && password === confirmPassword) {
        setPasswordError("");
      }
    }, 300);
    return () => { if (passwordTimerRef.current) clearTimeout(passwordTimerRef.current); };
  }, [password, confirmPassword, isLogin, isPasswordReset]);

  const inputClass = "h-[50px] rounded-xs bg-muted/40 dark:bg-white/[0.06] border-border/40 text-foreground placeholder:text-muted-foreground/50 px-4 text-[16px] focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all";
  const errorInputClass = "border-red-500/50 focus:ring-red-500/40";

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.28, ease: "easeOut" }}
      className="relative min-h-screen bg-background text-foreground flex flex-col overflow-hidden"
    >
      {/* Subtle red→amber radial wash in the upper third so the fighter
          door reads visually distinct from the coach door at a glance. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[60vh] opacity-60"
        style={{
          background:
            "radial-gradient(ellipse at 50% 0%, rgba(244, 63, 94, 0.18) 0%, rgba(245, 158, 11, 0.08) 35%, transparent 70%)",
        }}
      />

      {/* Nav bar — iOS style */}
      <div
        className="relative flex items-center justify-between px-4 shrink-0"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)", paddingBottom: "8px" }}
      >
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex items-center gap-0.5 min-h-[44px] min-w-[44px] -ml-2 pl-2 pr-3 rounded-full text-foreground/85 active:opacity-60 transition-opacity touch-manipulation"
          aria-label="Back"
        >
          <ChevronLeft className="h-5 w-5 shrink-0" strokeWidth={2.5} />
          <span className="text-[17px] font-normal">Back</span>
        </button>
        <ThemeToggle />
      </div>

      {/* Content */}
      <div className="relative flex-1 flex flex-col items-center px-6 overflow-y-auto" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
        <div className="w-full max-w-[360px] pt-4">
          {/* Fighter brand badge — red/amber gradient ring + swords icon
              over the existing logo so the door reads "fighter" the
              instant someone lands. */}
          <div className="flex flex-col items-center text-center mb-8">
            <div className="relative mb-4">
              <img
                src={wizardLogo}
                alt="FightCamp Wizard"
                className="relative h-16 w-16 object-contain rounded-xs ring-2 ring-primary/60 shadow-xl shadow-primary/20"
              />
              <span className="absolute -bottom-1 -right-1 flex h-7 w-7 items-center justify-center rounded-full bg-primary ring-2 ring-background shadow-lg shadow-primary/30">
                <Swords className="h-3.5 w-3.5 text-primary-foreground" strokeWidth={2.5} />
              </span>
            </div>
            <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-primary/90">
              Fighter sign-in
            </p>
            <h1 className="mt-1.5 text-2xl font-bold tracking-tight text-foreground">
              {isPasswordReset ? "New Password" : showForgotPassword ? "Reset Password" : isLogin ? "Welcome back, fighter" : "Start your cut"}
            </h1>
            <div className="text-sm text-muted-foreground mt-1 h-5 relative w-full">
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={
                    isPasswordReset
                      ? "reset"
                      : showForgotPassword
                      ? "forgot"
                      : isLogin ? "in" : "up"
                  }
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                  className="absolute inset-0"
                >
                  {isPasswordReset
                    ? "Choose a strong password"
                    : showForgotPassword
                    ? "We'll send you a reset link"
                    : isLogin
                    ? "Pick up where you left off"
                    : "Make weight. Stay safe."}
                </motion.p>
              </AnimatePresence>
            </div>
          </div>

          {/* Forms */}
          <div className="space-y-4">
            {isPasswordReset ? (
              <form onSubmit={handlePasswordUpdate} className="space-y-3">
                <Input type="password" placeholder="New password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} className={`${inputClass} ${passwordError ? errorInputClass : ""}`} />
                <Input type="password" placeholder="Confirm password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required minLength={8} className={`${inputClass} ${passwordError ? errorInputClass : ""}`} />
                {passwordError && <p className="text-xs text-red-500 text-center">{passwordError}</p>}
                <Button type="submit" disabled={loading} className="no-tap-select w-full h-[50px] rounded-xs text-[16px] font-semibold bg-primary text-primary-foreground active:scale-[0.98] transition-transform">
                  {loading ? "Updating..." : "Update Password"}
                </Button>
              </form>
            ) : showForgotPassword ? (
              <form onSubmit={handleForgotPassword} className="space-y-3">
                <Input type="email" placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} required className={inputClass} autoFocus />
                <Button type="submit" disabled={loading} className="no-tap-select w-full h-[50px] rounded-xs text-[16px] font-semibold bg-primary text-primary-foreground active:scale-[0.98] transition-transform">
                  {loading ? "Sending..." : "Send Reset Link"}
                </Button>
                <button type="button" onClick={() => setShowForgotPassword(false)} className="w-full text-center text-sm text-muted-foreground py-2">Back to Sign In</button>
              </form>
            ) : (
              <>
                {/* Apple Sign-In — primary CTA, sits above the email form
                    so the lowest-friction path is the first thing the
                    user sees. iOS-native black-pill styling. */}
                <button
                  type="button"
                  onClick={handleAppleSignIn}
                  disabled={loading}
                  className="no-tap-select w-full h-[54px] rounded-xs bg-foreground text-background font-semibold text-[16px] flex items-center justify-center gap-2 active:scale-[0.98] transition-transform touch-manipulation disabled:opacity-50 shadow-lg shadow-foreground/10"
                >
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.52-3.23 0-1.44.62-2.2.44-3.06-.4C3.79 16.17 4.36 9.51 8.82 9.28c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.3 4.11zM12.03 9.2C11.88 7.16 13.5 5.5 15.42 5.35c.28 2.35-2.14 4.1-3.39 3.85z" />
                  </svg>
                  {isLogin ? "Sign in with Apple" : "Sign up with Apple"}
                </button>

                {/* Collapsed email path — until the user opts in we hide
                    the full form behind a single link. The form uses
                    opacity+y motion only (NO height-auto) so iOS doesn't
                    have to recompute layout per frame. GPU-only, no jank. */}
                {!showEmailForm ? (
                  <button
                    type="button"
                    onClick={() => setShowEmailForm(true)}
                    className="no-tap-select w-full text-center text-[13px] text-muted-foreground hover:text-foreground transition-colors py-2"
                  >
                    Continue with email →
                  </button>
                ) : (
                  <motion.form
                    key="email-form"
                    onSubmit={handleAuth}
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
                    <PremiumInput
                      label="Email"
                      type="email"
                      icon={<Mail className="h-[18px] w-[18px]" />}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                      autoFocus
                      autoComplete="email"
                      inputMode="email"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint="next"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          passwordRef.current?.focus();
                        }
                      }}
                    />
                    <PremiumInput
                      ref={passwordRef}
                      label="Password"
                      type="password"
                      icon={<Lock className="h-[18px] w-[18px]" />}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      minLength={isLogin ? 1 : 8}
                      error={!!passwordError}
                      toggleable
                      autoComplete={isLogin ? "current-password" : "new-password"}
                      enterKeyHint={isLogin ? "go" : "next"}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !isLogin) {
                          e.preventDefault();
                          confirmRef.current?.focus();
                        }
                      }}
                    />
                    {!isLogin && (
                      <PremiumInput
                        ref={confirmRef}
                        label="Confirm password"
                        type="password"
                        icon={<Lock className="h-[18px] w-[18px]" />}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        required
                        minLength={8}
                        error={!!passwordError}
                        toggleable
                        autoComplete="new-password"
                        enterKeyHint="go"
                      />
                    )}
                    {passwordError && <p className="text-[12px] text-destructive/90 pl-1">{passwordError}</p>}
                    <Button type="submit" disabled={loading} className="no-tap-select w-full h-[54px] rounded-xs text-[16px] font-semibold bg-primary text-primary-foreground active:scale-[0.98] transition-transform shadow-lg shadow-primary/20">
                      {loading ? "Please wait..." : isLogin ? "Sign In" : "Create Account"}
                    </Button>
                  </motion.form>
                )}
              </>
            )}
          </div>

          {/* Footer links */}
          {!showForgotPassword && !isPasswordReset && (
            <div className="mt-8 space-y-3 text-center">
              {isLogin && (
                <button type="button" onClick={() => setShowForgotPassword(true)} className="text-sm text-muted-foreground">
                  Forgot password?
                </button>
              )}
              <div>
                <button
                  type="button"
                  onClick={() => { setIsLogin(!isLogin); setConfirmPassword(""); setPasswordError(""); setShowForgotPassword(false); }}
                  className="text-sm text-primary font-medium"
                >
                  {isLogin ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
                </button>
              </div>
              {/* Wrong door? Route through the coach cutscene so they
                  see what they're signing up for before landing on the
                  coach login page. */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => navigate("/coach/welcome")}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-card/40 px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground hover:border-border transition-colors"
                >
                  Are you a coach? <span className="text-foreground/90 font-semibold">Coach sign-in →</span>
                </button>
              </div>
            </div>
          )}

          {/* Legal */}
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
