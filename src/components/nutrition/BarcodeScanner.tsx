import { useState, useEffect, useRef, useMemo } from "react";
import { useZxing } from "react-zxing";
import { Button } from "@/components/ui/button";
import {
  Drawer,
  DrawerContent,
} from "@/components/ui/drawer";
import { ScanBarcode, RotateCcw, AlertCircle, X, PackageX, Minus, Plus } from "lucide-react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { useToast } from "@/hooks/use-toast";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { AIPersistence } from "@/lib/aiPersistence";
import { useAuth } from "@/contexts/UserContext";
import { Capacitor } from "@capacitor/core";
import { Camera as CapCamera } from "@capacitor/camera";
import { triggerHaptic, triggerHapticSelection } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { logger } from "@/lib/logger";

interface ScannedProduct {
  productName: string;
  brand: string | null;
  // Per-serving figures (already scaled by the action — what the user
  // sees by default).
  calories: number;
  protein_g: number;
  carbs_g: number;
  fats_g: number;
  // Per-100g reference used when the user changes the portion size in
  // the UI so the recomputation is exact.
  calories_per_100g: number;
  protein_per_100g: number;
  carbs_per_100g: number;
  fats_per_100g: number;
  serving_size: string;
  serving_grams: number;
  source: string;
}

interface BarcodeScannerProps {
  onFoodScanned: (foodData: {
    meal_name: string;
    calories: number;
    protein_g: number;
    carbs_g: number;
    fats_g: number;
    serving_size: string;
  }) => void;
  disabled?: boolean;
  className?: string;
  label?: string;
}

const QUICK_MULTIPLIERS = [0.5, 1, 1.5, 2] as const;
const round1 = (n: number) => Math.round(n * 10) / 10;

export const BarcodeScanner = ({ onFoodScanned, disabled, className, label }: BarcodeScannerProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [cameraError, setCameraError] = useState<string>("");
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [useExactConstraint, setUseExactConstraint] = useState(false);
  const [scannedProduct, setScannedProduct] = useState<ScannedProduct | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [lastScannedBarcode, setLastScannedBarcode] = useState<string>("");
  const [permissionDenied, setPermissionDenied] = useState(false);
  // Live grams the user is logging. Defaults to the product's stated
  // serving size on first load; the +/- stepper and multiplier pills
  // mutate this and macros recompute against the per-100g reference.
  const [grams, setGrams] = useState<number>(100);
  const scanTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reduced = useReducedMotion();
  const { toast } = useToast();
  const { userId } = useAuth();
  const scanBarcodeAction = useAction(api.actions.scanBarcode.run);

  const requestNativePermission = async (): Promise<boolean> => {
    if (!Capacitor.isNativePlatform()) return true;
    try {
      const status = await CapCamera.requestPermissions({ permissions: ["camera"] });
      const granted = status.camera;
      if (granted === "denied" || granted === ("restricted" as string)) {
        setPermissionDenied(true);
        setCameraError("Camera access was denied. Go to iOS Settings > FightCamp Wizard > Camera and enable it.");
        return false;
      }
      return true;
    } catch {
      return true;
    }
  };

  const handleBarcodeScanned = async (barcode: string) => {
    setIsProcessing(true);
    setScannedProduct(null);
    setNotFound(false);

    try {
      const cacheKey = `barcode_${barcode}`;
      const cachedData = userId ? AIPersistence.load(userId, cacheKey) : null;
      if (cachedData && cachedData.serving_grams) {
        setScannedProduct(cachedData);
        setGrams(cachedData.serving_grams);
        setIsProcessing(false);
        triggerHaptic(ImpactStyle.Medium);
        return;
      }

      let data: ScannedProduct & { found: true } | { found: false };
      try {
        data = (await Promise.race([
          scanBarcodeAction({ barcode }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("Barcode lookup timed out")), 12_000),
          ),
        ])) as ScannedProduct & { found: true } | { found: false };
      } catch (timeoutErr) {
        const msg = timeoutErr instanceof Error ? timeoutErr.message : String(timeoutErr);
        if (msg.includes("timed out")) {
          toast({
            title: "Lookup timed out",
            description: "Try again — the network may be slow.",
            variant: "destructive",
          });
          setIsProcessing(false);
          return;
        }
        throw timeoutErr;
      }

      if (!data.found) {
        setNotFound(true);
        setIsProcessing(false);
        triggerHaptic(ImpactStyle.Light);
        return;
      }

      const product: ScannedProduct = {
        productName: data.productName,
        brand: data.brand,
        calories: data.calories,
        protein_g: data.protein_g,
        carbs_g: data.carbs_g,
        fats_g: data.fats_g,
        calories_per_100g: data.calories_per_100g,
        protein_per_100g: data.protein_per_100g,
        carbs_per_100g: data.carbs_per_100g,
        fats_per_100g: data.fats_per_100g,
        serving_size: data.serving_size,
        serving_grams: data.serving_grams,
        source: data.source,
      };

      setScannedProduct(product);
      setGrams(product.serving_grams);
      setIsProcessing(false);
      triggerHaptic(ImpactStyle.Medium);

      if (userId) {
        AIPersistence.save(userId, `barcode_${barcode}`, product, 24 * 30);
      }
    } catch (error) {
      logger.error("Error scanning barcode", error);
      const errorMessage = error instanceof Error ? error.message : "Failed to get product information";
      toast({
        title: "Scan failed",
        description: errorMessage,
        variant: "destructive",
      });
      setIsProcessing(false);
    }
  };

  const { ref } = useZxing({
    paused: !isOpen || !!scannedProduct || notFound,
    constraints: {
      audio: false,
      video: {
        facingMode: useExactConstraint ? { exact: facingMode } : { ideal: facingMode },
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    },
    onDecodeResult(result) {
      if (isProcessing) return;
      const barcode = result.getText();
      if (barcode === lastScannedBarcode) return;
      setLastScannedBarcode(barcode);
      logger.info("Barcode scanned", { barcode });
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
      scanTimeoutRef.current = setTimeout(() => handleBarcodeScanned(barcode), 350);
    },
    onError(error) {
      logger.error("Scanner error", error);
      const errorName = error instanceof Error ? error.name : String(error);
      if (useExactConstraint && (errorName === "OverconstrainedError" || errorName === "ConstraintNotSatisfiedError")) {
        setUseExactConstraint(false);
        return;
      }
      if (errorName === "NotAllowedError" || errorName === "PermissionDeniedError") {
        setCameraError("Camera permission denied. Enable camera access in Settings.");
      } else if (errorName === "NotFoundError" || errorName === "DevicesNotFoundError") {
        setCameraError("No camera found.");
      } else if (errorName === "NotReadableError" || errorName === "TrackStartError") {
        setCameraError("Camera is already in use by another app.");
      } else {
        setCameraError("Couldn't open the camera. Check permissions and try again.");
      }
    },
  });

  // Reset transient state when the drawer toggles. Permission denied
  // and exact-constraint flags are scoped per open so users who
  // recover camera access don't get stuck on the previous error.
  useEffect(() => {
    if (!isOpen) {
      setCameraError("");
      setScannedProduct(null);
      setNotFound(false);
      setLastScannedBarcode("");
      setPermissionDenied(false);
      setUseExactConstraint(false);
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    } else {
      setFacingMode("environment");
      setUseExactConstraint(true);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      if (scanTimeoutRef.current) clearTimeout(scanTimeoutRef.current);
    };
  }, []);

  const switchCamera = () => {
    setUseExactConstraint(true);
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"));
    setLastScannedBarcode("");
  };

  const restartScan = () => {
    setScannedProduct(null);
    setNotFound(false);
    setLastScannedBarcode("");
  };

  // Live macros recomputed from the per-100g reference + the current
  // grams. Falls back to the OFF per-serving value when a product
  // hasn't loaded yet.
  const live = useMemo(() => {
    if (!scannedProduct) return { calories: 0, protein: 0, carbs: 0, fats: 0, factor: 1 };
    const factor = grams / 100;
    return {
      calories: Math.round(scannedProduct.calories_per_100g * factor),
      protein: round1(scannedProduct.protein_per_100g * factor),
      carbs: round1(scannedProduct.carbs_per_100g * factor),
      fats: round1(scannedProduct.fats_per_100g * factor),
      factor,
    };
  }, [scannedProduct, grams]);

  // Identify which preset chip should appear selected. The user is on a
  // preset only when grams is exactly multiplier × serving_grams.
  const activeMultiplier = useMemo(() => {
    if (!scannedProduct) return null;
    const base = scannedProduct.serving_grams || 100;
    const match = QUICK_MULTIPLIERS.find((m) => Math.abs(grams - base * m) < 0.5);
    return match ?? null;
  }, [grams, scannedProduct]);

  const adjustGrams = (delta: number) => {
    triggerHapticSelection();
    setGrams((g) => Math.max(5, Math.round(g + delta)));
  };

  return (
    <>
      <Button
        variant="outline"
        onClick={async () => {
          const ok = await requestNativePermission();
          if (ok) setIsOpen(true);
        }}
        disabled={disabled}
        className={className}
        title="Scan Barcode"
      >
        <ScanBarcode className="h-4 w-4" />
        {label ? (
          <span className="text-[13px] text-muted-foreground">{label}</span>
        ) : (
          <span className="sr-only">Scan Barcode</span>
        )}
      </Button>

      <Drawer open={isOpen} onOpenChange={setIsOpen}>
        <DrawerContent className="no-tap-select max-h-[92dvh] p-0 rounded-t-3xl border-t border-white/10 bg-background/95 backdrop-blur-2xl">
          {/* Header row */}
          <div className="px-5 pt-1 pb-2 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold tracking-tight text-foreground">
              {scannedProduct ? "Scanned" : notFound ? "Not found" : "Scan Barcode"}
            </h2>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              aria-label="Close scanner"
              className="no-tap-select h-9 w-9 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-white/5 active:scale-95 transition"
            >
              <X className="h-4.5 w-4.5" />
            </button>
          </div>

          <div className="overflow-y-auto" style={{ paddingBottom: "max(20px, env(safe-area-inset-bottom))" }}>
            {/* Camera error / permission denied */}
            {cameraError && !scannedProduct && (
              <div className="mx-5 mt-2 rounded-xs border border-destructive/40 bg-destructive/10 p-4 flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <p className="text-[13px] text-destructive/90 leading-snug">{cameraError}</p>
              </div>
            )}

            {/* Viewfinder — Apple-native pulsing primary border + vignette.
                Hidden once we have a product or a definitive not-found so the
                result sheet owns the space. */}
            {!scannedProduct && !notFound && !cameraError && (
              <div className="relative mx-5 mt-2 aspect-[4/3] rounded-xs overflow-hidden bg-black">
                <video
                  ref={ref as React.RefObject<HTMLVideoElement>}
                  className="absolute inset-0 h-full w-full object-cover"
                  autoPlay
                  playsInline
                  muted
                />

                {/* Vignette: dim everything outside the scan zone. Four
                    rectangles around a 78% × 42% transparent centre. */}
                <div className="absolute inset-x-0 top-0 h-[29%] bg-black/55 backdrop-blur-[2px]" />
                <div className="absolute inset-x-0 bottom-0 h-[29%] bg-black/55 backdrop-blur-[2px]" />
                <div className="absolute left-0 top-[29%] bottom-[29%] w-[11%] bg-black/55 backdrop-blur-[2px]" />
                <div className="absolute right-0 top-[29%] bottom-[29%] w-[11%] bg-black/55 backdrop-blur-[2px]" />

                {/* Pulsing scan-zone border — the Apple-native cue. */}
                <motion.div
                  aria-hidden
                  className="absolute left-[11%] right-[11%] top-[29%] bottom-[29%] rounded-xs border-2 border-primary"
                  style={{ boxShadow: "0 0 24px 0 hsl(var(--primary) / 0.45)" }}
                  initial={false}
                  animate={
                    reduced
                      ? { opacity: 1 }
                      : { opacity: [1, 0.5, 1], scale: [1, 1.015, 1] }
                  }
                  transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                />

                {/* Sweeping scan line within the zone. */}
                {!reduced && (
                  <div className="absolute left-[11%] right-[11%] top-[29%] bottom-[29%] rounded-xs overflow-hidden pointer-events-none">
                    <motion.div
                      aria-hidden
                      className="absolute left-3 right-3 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent"
                      initial={{ top: "0%" }}
                      animate={{ top: ["0%", "100%", "0%"] }}
                      transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }}
                    />
                  </div>
                )}

                {/* Hint pill — fades when processing kicks in. */}
                <AnimatePresence>
                  {!isProcessing && (
                    <motion.p
                      key="hint"
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      transition={{ duration: 0.2 }}
                      className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 backdrop-blur-md px-3.5 py-1.5 text-[11px] font-medium text-white/90"
                    >
                      Position barcode in the frame
                    </motion.p>
                  )}
                </AnimatePresence>

                {/* Camera switch button */}
                <button
                  type="button"
                  onClick={switchCamera}
                  aria-label="Switch camera"
                  className="no-tap-select absolute top-3 right-3 h-9 w-9 rounded-full bg-black/45 hover:bg-black/65 backdrop-blur-md border border-white/15 flex items-center justify-center active:scale-95 transition"
                >
                  <RotateCcw className="h-4 w-4 text-white" />
                </button>

                {/* Processing veil */}
                {isProcessing && (
                  <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex flex-col items-center justify-center gap-2">
                    <span className="inline-flex h-9 w-9 rounded-full border-2 border-primary/30 border-t-primary animate-spin" />
                    <p className="text-[13px] font-medium text-white/90">Looking up product…</p>
                    <p className="text-[11px] text-white/50">OpenFoodFacts</p>
                  </div>
                )}
              </div>
            )}

            {/* Not-found inline state — keeps the sheet open, offers
                Scan-again and Cancel-rescan paths without bouncing the
                user out. */}
            {notFound && (
              <div className="mx-5 mt-4 rounded-xs border border-white/10 bg-card/40 backdrop-blur-xl p-6 text-center">
                <div className="mx-auto h-14 w-14 rounded-full bg-white/5 ring-1 ring-white/10 flex items-center justify-center">
                  <PackageX className="h-6 w-6 text-muted-foreground" />
                </div>
                <p className="text-[15px] font-semibold mt-3 text-foreground">Product not found</p>
                <p className="text-[13px] text-muted-foreground mt-1 leading-snug">
                  We couldn't find this barcode in the database. You can scan again or add the item manually.
                </p>
                <div className="mt-4 flex flex-col gap-2">
                  <Button
                    className="no-tap-select w-full h-11 rounded-xs bg-primary text-primary-foreground font-semibold"
                    onClick={restartScan}
                  >
                    Scan again
                  </Button>
                  <Button
                    variant="ghost"
                    className="no-tap-select w-full h-10"
                    onClick={() => setIsOpen(false)}
                  >
                    Close
                  </Button>
                </div>
              </div>
            )}

            {/* Result card */}
            {scannedProduct && (
              <motion.div
                initial={reduced ? { opacity: 1, y: 0 } : { opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: "spring", stiffness: 380, damping: 32 }}
                className="mx-5 mt-2 rounded-xs border border-white/10 bg-card/40 backdrop-blur-xl p-5"
              >
                {/* Header row */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[16px] font-semibold leading-tight text-foreground truncate">
                      {scannedProduct.productName}
                    </p>
                    {scannedProduct.brand && (
                      <p className="text-[12px] text-muted-foreground mt-0.5 truncate">{scannedProduct.brand}</p>
                    )}
                  </div>
                  <span className="shrink-0 rounded-full bg-white/10 border border-white/10 px-2.5 py-1 text-[10px] font-medium text-white/80 uppercase tracking-wide">
                    {scannedProduct.source === "openfoodfacts" ? "OFF" : scannedProduct.source}
                  </span>
                </div>

                {/* Hero kcal — anchored to the serving the user is logging,
                    NOT per-100g. "Per 127g" is shown prominently, fixing the
                    old footnote behaviour where the user couldn't tell what
                    weight the macros referred to. */}
                <div className="mt-4 flex items-baseline justify-between">
                  <div>
                    <p className="display-number text-[48px] font-black tabular-nums leading-none text-primary">
                      {live.calories}
                    </p>
                    <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground/80 font-bold mt-1">
                      kcal
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-semibold">
                      Per
                    </p>
                    <p className="text-[18px] font-bold tabular-nums text-foreground">{grams}<span className="text-[12px] text-muted-foreground/80 font-medium ml-0.5">g</span></p>
                    <p className="text-[10px] text-muted-foreground/60 leading-snug mt-0.5">
                      Pack serving: {scannedProduct.serving_grams}g
                    </p>
                  </div>
                </div>

                {/* Macro chips */}
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="rounded-xs border border-white/10 bg-white/5 px-3 py-2.5 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground/80 font-semibold">Protein</p>
                    <p className="text-[16px] font-bold tabular-nums text-blue-400 mt-0.5">{live.protein}<span className="text-[10px] text-muted-foreground/60 ml-0.5 font-medium">g</span></p>
                  </div>
                  <div className="rounded-xs border border-white/10 bg-white/5 px-3 py-2.5 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground/80 font-semibold">Carbs</p>
                    <p className="text-[16px] font-bold tabular-nums text-func-warning-yellow mt-0.5">{live.carbs}<span className="text-[10px] text-muted-foreground/60 ml-0.5 font-medium">g</span></p>
                  </div>
                  <div className="rounded-xs border border-white/10 bg-white/5 px-3 py-2.5 text-center">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground/80 font-semibold">Fats</p>
                    <p className="text-[16px] font-bold tabular-nums text-func-danger-red mt-0.5">{live.fats}<span className="text-[10px] text-muted-foreground/60 ml-0.5 font-medium">g</span></p>
                  </div>
                </div>

                {/* Portion adjuster — quick multipliers + grams stepper.
                    Macros above recompute live from the per-100g reference
                    so a 127g packet × 2 reads accurately. */}
                <div className="mt-5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70 font-bold">
                      Portion
                    </p>
                    {activeMultiplier !== null && (
                      <p className="text-[10px] text-muted-foreground/60">{activeMultiplier}× serving</p>
                    )}
                  </div>

                  {/* Quick-pick multipliers */}
                  <div className="grid grid-cols-4 gap-1.5">
                    {QUICK_MULTIPLIERS.map((m) => {
                      const isActive = activeMultiplier === m;
                      return (
                        <button
                          key={m}
                          type="button"
                          onClick={() => {
                            triggerHapticSelection();
                            setGrams(Math.round((scannedProduct.serving_grams || 100) * m));
                          }}
                          className={`no-tap-select h-8 rounded-full text-[12px] font-semibold tabular-nums transition ${
                            isActive
                              ? "bg-primary text-primary-foreground"
                              : "bg-white/5 text-foreground/75 hover:bg-white/10"
                          }`}
                        >
                          {m}×
                        </button>
                      );
                    })}
                  </div>

                  {/* Fine-grained stepper */}
                  <div className="flex items-center justify-between gap-2 rounded-full bg-white/5 border border-white/10 h-12 px-1">
                    <button
                      type="button"
                      onClick={() => adjustGrams(-5)}
                      aria-label="Decrease grams"
                      className="no-tap-select h-10 w-10 rounded-full flex items-center justify-center text-foreground hover:bg-white/10 active:scale-95 transition"
                    >
                      <Minus className="h-4 w-4" />
                    </button>
                    <div className="flex items-baseline gap-1">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={5}
                        max={9999}
                        value={grams}
                        onChange={(e) => {
                          const v = parseInt(e.target.value, 10);
                          if (Number.isFinite(v)) setGrams(Math.max(5, Math.min(9999, v)));
                        }}
                        className="no-tap-select w-16 bg-transparent text-center text-[15px] font-semibold tabular-nums text-foreground outline-none"
                      />
                      <span className="text-[12px] text-muted-foreground font-medium">g</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => adjustGrams(5)}
                      aria-label="Increase grams"
                      className="no-tap-select h-10 w-10 rounded-full flex items-center justify-center text-foreground hover:bg-white/10 active:scale-95 transition"
                    >
                      <Plus className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {/* CTAs */}
                <div className="mt-5 space-y-2">
                  <Button
                    className="no-tap-select w-full h-12 rounded-xs bg-primary text-primary-foreground font-semibold text-[15px] shadow-lg shadow-primary/20"
                    onClick={() => {
                      onFoodScanned({
                        meal_name: scannedProduct.productName,
                        calories: live.calories,
                        protein_g: live.protein,
                        carbs_g: live.carbs,
                        fats_g: live.fats,
                        serving_size: `${grams}g`,
                      });
                      setIsOpen(false);
                    }}
                  >
                    Add to meal · {live.calories} kcal
                  </Button>
                  <Button
                    variant="ghost"
                    className="no-tap-select w-full h-10 text-[13px]"
                    onClick={restartScan}
                  >
                    Scan another
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Help text — only on the live scanner view, not the result. */}
            {!scannedProduct && !notFound && !cameraError && !isProcessing && (
              <p className="px-5 py-3 text-[11px] text-muted-foreground/70 text-center">
                Hold steady. We'll snap as soon as the barcode is in focus.
              </p>
            )}

            {/* Permission-denied helper hint */}
            {permissionDenied && (
              <p className="px-5 pb-2 text-[11px] text-muted-foreground/60 text-center">
                Settings → FightCamp Wizard → Camera
              </p>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
};
