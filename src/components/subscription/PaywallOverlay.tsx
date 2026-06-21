import { useState, useEffect, useCallback, useRef } from "react";
import { X, Zap, Check, Loader2, RotateCcw, Crown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSubscriptionContext } from "@/contexts/SubscriptionContext";
import { useProfile } from "@/contexts/UserContext";
import {
  isPremiumFromCustomerInfo,
  getSubscriptionFromCustomerInfo,
  getOfferings,
  purchasePackage,
  restorePurchases,
  presentPaywall,
  getCustomerInfo,
} from "@/lib/purchases";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useToast } from "@/hooks/use-toast";
import { logger } from "@/lib/logger";
import { isNativePlatform } from "@/hooks/useIsNative";

/**
 * Update the profile subscription tier from RevenueCat customerInfo.
 *
 * Post-Convex migration: there's a single Convex action that performs the
 * authoritative write. We dropped the dual "direct update + fallback"
 * pattern that existed under Supabase RLS. Convex has no RLS, the
 * mutation is the single source of truth.
 */
// The previous `syncPremiumToDb` helper was a no-op stub kept for backwards
// compatibility. It has been replaced by a direct call to the server-
// verified `api.actions.activatePremium.run` action from the paywall
// handler (see `activatePro` below). The action takes no arguments, hits
// the RevenueCat REST API server-side, and only flips the Convex profile
// after a positive RC response. There is no client-trusted tier/expiry
// surface anymore.

// ─── Activating Pro Loading Screen ───

function ActivatingProScreen() {
  const [step, setStep] = useState(0);
  const steps = ["Confirming purchase", "Activating Pro", "Unlocking features"];

  useEffect(() => {
    const t1 = setTimeout(() => setStep(1), 800);
    const t2 = setTimeout(() => setStep(2), 1600);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  return (
    <div className="fixed inset-0 z-[10005] flex flex-col items-center justify-center bg-background">
      <div className="flex flex-col items-center gap-6 px-8">
        {/* Animated icon */}
        <div className="relative">
          <div className="h-20 w-20 rounded-[22px] bg-gradient-to-br from-primary to-secondary flex items-center justify-center animate-in zoom-in-75 duration-500">
            <Crown className="h-10 w-10 text-primary-foreground" />
          </div>
          <div className="absolute inset-0 rounded-[22px] bg-primary/20 animate-ping" style={{ animationDuration: "2s" }} />
        </div>

        <div className="text-center">
          <h2 className="text-xl font-bold text-foreground">Activating Pro</h2>
          <p className="text-sm text-muted-foreground mt-1">Just a moment...</p>
        </div>

        {/* Progress steps */}
        <div className="space-y-3 w-full max-w-[240px]">
          {steps.map((label, i) => (
            <div key={i} className={`flex items-center gap-3 transition-all duration-500 ${i <= step ? "opacity-100" : "opacity-30"}`}>
              <div className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 transition-all duration-300 ${
                i < step ? "bg-primary" : i === step ? "bg-primary/20 border-2 border-primary" : "bg-muted border border-border"
              }`}>
                {i < step ? (
                  <Check className="h-3.5 w-3.5 text-primary-foreground" />
                ) : i === step ? (
                  <Loader2 className="h-3 w-3 text-primary animate-spin" />
                ) : (
                  <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground/30" />
                )}
              </div>
              <span className={`text-sm ${i <= step ? "text-foreground font-medium" : "text-muted-foreground"}`}>{label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main Paywall Overlay ───

const FEATURES = [
  "Unlimited AI meal analysis",
  "AI Coach chat",
  "Fight week protocols",
  "Rehydration plans",
  "Diet analysis & meal planning",
  "Training load analytics",
  "Weight trend AI insights",
];

/**
 * Wait up to `timeoutMs` for the reactive Convex profile to flip into a
 * paid tier. Used by the paywall flow to ride out the sandbox StoreKit
 * propagation race: the local customerInfo can lag behind the RC server-
 * to-server webhook by several seconds, and bailing immediately would
 * show a misleading "Could not verify purchase" toast even though the
 * webhook is about to grant entitlement.
 *
 * Returns true if the profile tier becomes non-"free" within the window,
 * false otherwise. Does NOT mutate any state on its own; caller decides
 * whether to close the paywall or surface the error.
 */
async function waitForProfilePro(opts: {
  refresh: () => Promise<boolean>;
  readTier: () => string | undefined;
  timeoutMs?: number;
  intervalMs?: number;
}): Promise<boolean> {
  const { refresh, readTier, timeoutMs = 10_000, intervalMs = 1000 } = opts;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await refresh();
    const tier = readTier();
    if (tier && tier !== "free") return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return false;
}

export function PaywallOverlay() {
  const { isPaywallOpen, closePaywall } = useSubscriptionContext();
  const { profile, refreshProfile } = useProfile();
  const [activating, setActivating] = useState(false);
  const activatePremium = useAction(api.actions.activatePremium.run);
  const { toast } = useToast();
  // Stable ref so the polling loop inside activatePro always reads the
  // freshest profile value without re-creating the callback every render.
  const profileRef = useRef(profile);
  useEffect(() => { profileRef.current = profile; }, [profile]);

  /**
   * STRICT activation: caller must already have confirmed the paywall returned
   * `PURCHASED` or `RESTORED` AND the local customerInfo passes
   * `isPremiumFromCustomerInfo` (strict exact-entitlement match).
   *
   * Even after those checks pass locally, we DON'T trust the client state:
   * we hit the server-verified `activatePremium` action, which calls RC's
   * REST API with a server-held secret and only flips the Convex profile
   * after a positive RC response. The Convex `useQuery(api.profiles.getMine)`
   * then propagates the tier change reactively to every premium gate.
   *
   * There is no `forcePremium` / localStorage override anymore; bypassing
   * the server-verify path was the security bug that allowed "dismiss
   * paywall → get premium" in sandbox.
   */
  const activatePro = useCallback(async (customerInfo: any) => {
    // Defence-in-depth check. If the local SDK already sees the entitlement,
    // we go straight to the server-verified path. If it doesn't (sandbox
    // propagation race), we wait briefly for the RC webhook to land instead
    // of flashing a misleading "Could not verify purchase" toast, but we
    // still DO NOT bypass the server-verify path: we never trust the client
    // to flip premium on its own. See commit history in `purchases.ts` for
    // the security rationale.
    if (!isPremiumFromCustomerInfo(customerInfo)) {
      logger.warn("activatePro: local customerInfo not premium, waiting for webhook");
      setActivating(true);
      try {
        const grantedByWebhook = await waitForProfilePro({
          refresh: refreshProfile,
          readTier: () => profileRef.current?.subscription_tier,
        });
        if (grantedByWebhook) {
          logger.info("activatePro: profile flipped by webhook during wait");
          return;
        }
        // 10s elapsed with no webhook write; surface the original error.
        logger.warn("activatePro: webhook timeout; reporting verify failure");
        toast({
          title: "Could not verify purchase",
          description: "Please try again or use Restore Purchases.",
          variant: "destructive",
        });
      } finally {
        setActivating(false);
        closePaywall();
      }
      return;
    }
    setActivating(true);
    try {
      // Server-side RC REST verification + profile patch. Throws on
      // RC_NOT_ENTITLED / RC_VERIFY_NETWORK_FAILED / CONFIG_MISSING_*.
      await activatePremium({});
      await refreshProfile();
      logger.info("activatePro: RC-verified premium activated");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("Pro activation error", { error: msg });
      // Same webhook-wait safety net for the RC_NOT_ENTITLED sandbox race.
      if (msg.includes("RC_NOT_ENTITLED")) {
        const grantedByWebhook = await waitForProfilePro({
          refresh: refreshProfile,
          readTier: () => profileRef.current?.subscription_tier,
        });
        if (grantedByWebhook) {
          logger.info("activatePro: webhook covered RC_NOT_ENTITLED race");
          return;
        }
      }
      toast({
        title: "Could not verify purchase",
        description: msg.includes("RC_NOT_ENTITLED")
          ? "RevenueCat could not confirm payment. If you completed the purchase, please try Restore Purchases."
          : "Please check your connection and try again.",
        variant: "destructive",
      });
    } finally {
      setActivating(false);
      closePaywall();
    }
  }, [activatePremium, refreshProfile, closePaywall, toast]);

  useEffect(() => {
    if (!isPaywallOpen || !isNativePlatform) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await presentPaywall();
        logger.info("Native paywall closed", { result: JSON.stringify(result) });
        if (cancelled) return;

        const paywallResult = result?.paywallResult;

        // STRICT GATE: only `PURCHASED` or `RESTORED` proceed. CANCELLED /
        // ERROR / NOT_PRESENTED → no state mutation whatsoever. This is the
        // critical fix: the previous flow relied on `addCustomerInfoUpdate
        // Listener` and a startup re-sync to flip premium, both of which
        // fire on sandbox StoreKit echoes AFTER a dismissed paywall and
        // mistakenly granted premium to non-paying users.
        if (paywallResult !== "PURCHASED" && paywallResult !== "RESTORED") {
          logger.info("Paywall dismissed without confirmed purchase", { paywallResult });
          if (!cancelled) closePaywall();
          return;
        }

        // Prefer customerInfo from the paywall result; fall back to a fresh
        // fetch (rare; the SDK usually populates it). The local check is
        // defence in depth; the server-side RC REST call inside
        // `activatePremium` is the real source of truth.
        const info = result?.customerInfo ?? await getCustomerInfo();
        await activatePro(info);
      } catch (err) {
        logger.error("Native paywall error", err);
        if (!cancelled) closePaywall();
      }
    })();
    return () => { cancelled = true; };
  }, [isPaywallOpen, closePaywall, activatePro]);

  // Show activating screen (full-screen, above everything)
  if (activating) return <ActivatingProScreen />;

  if (!isPaywallOpen) return null;
  if (isNativePlatform) return null;
  return <WebFallbackPaywall activatePro={activatePro} />;
}

/**
 * Custom paywall for web/non-native platforms.
 */
function WebFallbackPaywall({ activatePro }: { activatePro: (info: any) => Promise<void> }) {
  const { closePaywall } = useSubscriptionContext();
  const { toast } = useToast();
  const [selectedPlan, setSelectedPlan] = useState<"monthly" | "yearly">("yearly");
  const [offerings, setOfferings] = useState<any>(null);
  const [purchasing, setPurchasing] = useState(false);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    getOfferings().then(setOfferings).catch(() => {});
  }, []);

  const monthlyPackage = offerings?.availablePackages?.find(
    (p: any) => p.identifier === "$rc_monthly" || p.product?.identifier === "com.weightcutwizard.premium.monthly"
  );
  const yearlyPackage = offerings?.availablePackages?.find(
    (p: any) => p.identifier === "$rc_annual" || p.product?.identifier === "com.weightcutwizard.premium.yearly"
  );

  const monthlyPrice = monthlyPackage?.product?.priceString || "£7.99";
  const yearlyPrice = yearlyPackage?.product?.priceString || "£49.99";

  const handlePurchase = async () => {
    const pkg = selectedPlan === "monthly" ? monthlyPackage : yearlyPackage;

    if (!pkg) {
      toast({
        title: "Subscriptions available on iOS",
        description: "Open the app on your iPhone to subscribe.",
      });
      return;
    }

    setPurchasing(true);
    try {
      const { customerInfo, cancelled } = await purchasePackage(pkg);
      if (cancelled) return;
      if (customerInfo && isPremiumFromCustomerInfo(customerInfo)) {
        await activatePro(customerInfo);
      }
    } catch (err: any) {
      logger.error("Purchase failed", err);
      toast({ title: "Purchase failed", description: "Please try again or contact support.", variant: "destructive" });
    } finally {
      setPurchasing(false);
    }
  };

  const handleRestore = async () => {
    setRestoring(true);
    try {
      const customerInfo = await restorePurchases();
      if (customerInfo && isPremiumFromCustomerInfo(customerInfo)) {
        await activatePro(customerInfo);
      } else {
        toast({ title: "No active subscription found", description: "If you believe this is an error, contact support." });
      }
    } catch {
      toast({ title: "Restore failed", description: "Please try again.", variant: "destructive" });
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[10003] flex flex-col bg-background animate-in fade-in duration-300">
      <button
        onClick={closePaywall}
        className="absolute right-4 z-10 h-11 w-11 flex items-center justify-center rounded-full bg-muted/50 border border-border/30 active:scale-90 transition-transform"
        style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }}
      >
        <X className="h-5 w-5 text-muted-foreground" />
      </button>

      <div className="flex-1 flex flex-col items-center justify-center px-6 overflow-y-auto" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 56px)", paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)" }}>
        <div className="h-16 w-16 rounded-xs bg-gradient-to-br from-primary/20 to-secondary/20 border border-primary/30 flex items-center justify-center mb-5">
          <Zap className="h-8 w-8 text-primary" />
        </div>

        <h1 className="text-2xl font-bold text-foreground text-center">Go Pro</h1>
        <p className="text-sm text-muted-foreground text-center mt-2 max-w-[280px]">
          Unlock unlimited AI access.
        </p>

        <div className="w-full max-w-sm mt-7 space-y-3">
          {FEATURES.map((feature) => (
            <div key={feature} className="flex items-center gap-3">
              <div className="h-6 w-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <Check className="h-3.5 w-3.5 text-primary" />
              </div>
              <span className="text-sm text-foreground">{feature}</span>
            </div>
          ))}
        </div>

        <div className="w-full max-w-sm mt-8 grid grid-cols-2 gap-3">
          <button
            onClick={() => setSelectedPlan("monthly")}
            className={`relative rounded-xs border p-4 text-left transition-all active:scale-[0.97] ${
              selectedPlan === "monthly"
                ? "border-primary bg-primary/5 dark:bg-primary/10"
                : "border-border/50 bg-muted/20 dark:bg-white/5"
            }`}
          >
            <p className="text-xs font-medium text-muted-foreground">Monthly</p>
            <p className="text-lg font-bold text-foreground mt-1">{monthlyPrice}</p>
            <p className="text-xs text-muted-foreground">/month</p>
          </button>

          <button
            onClick={() => setSelectedPlan("yearly")}
            className={`relative rounded-xs border p-4 text-left transition-all active:scale-[0.97] ${
              selectedPlan === "yearly"
                ? "border-primary bg-primary/5 dark:bg-primary/10"
                : "border-border/50 bg-muted/20 dark:bg-white/5"
            }`}
          >
            <div className="absolute -top-2.5 right-3 px-2 py-0.5 rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
              SAVE 48%
            </div>
            <p className="text-xs font-medium text-muted-foreground">Yearly</p>
            <p className="text-lg font-bold text-foreground mt-1">£4.17</p>
            <p className="text-xs text-muted-foreground">/month</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">{yearlyPrice} billed annually</p>
          </button>
        </div>

        <Button
          onClick={handlePurchase}
          disabled={purchasing || restoring}
          className="w-full max-w-sm h-12 rounded-xs text-base font-bold bg-gradient-to-r from-primary to-secondary text-primary-foreground mt-6 active:scale-[0.97] transition-transform"
        >
          {purchasing ? <Loader2 className="h-5 w-5 animate-spin" /> : "Subscribe Now"}
        </Button>

        <button
          onClick={handleRestore}
          disabled={purchasing || restoring}
          className="flex items-center gap-1.5 mt-4 text-sm text-muted-foreground active:text-foreground transition-colors"
        >
          {restoring ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          Restore Purchases
        </button>

        <div className="flex items-center gap-3 mt-5 text-xs text-muted-foreground/60">
          <a href="/legal?tab=terms" className="underline">Terms of Use</a>
          <span>·</span>
          <a href="/legal?tab=privacy" className="underline">Privacy Policy</a>
        </div>

        <p className="text-[10px] text-muted-foreground/40 text-center mt-3 max-w-[280px] leading-relaxed">
          Payment will be charged to your Apple ID account at confirmation of purchase.
          Subscription automatically renews unless cancelled at least 24 hours before the end of the current period.
        </p>
      </div>
    </div>
  );
}
