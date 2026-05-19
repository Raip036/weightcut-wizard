/**
 * Round-card photo-first capture state machine.
 *
 * Drives the FAB → camera → ReviewSheet → develop → log-and-post flow
 * described in `2026-05-19-round-card-photo-first-tracking-design.md`
 * (§3.1 / §3.5 / §9 items 5–9). Lives outside `BottomNav` so that file
 * stays under 500 lines and the state machine can be exercised by a
 * dedicated test (mock-first) without rendering the whole nav.
 *
 * State machine — single forward path with two early exits:
 *
 *   idle ──tap─▶ capturing ──camera resolves─▶ reviewing ──submit─▶
 *     ▲              │                              │
 *     │              ▼ (cancel/error)               ▼
 *     │           idle                          developing
 *     │                                             │
 *     └──────────── post-write + 200ms delay ◀──────┘
 *
 * `discard` jumps reviewing → idle. `submit` failures fall back to
 * reviewing with a toast so the user can retry.
 *
 * The Capacitor camera call MUST originate inside the user-gesture
 * handler (see `PostComposer.tsx` for the proven pattern). We expose
 * `beginCapture` as a synchronous entry point that fires
 * `Camera.getPhoto` IMMEDIATELY before any `await`, then handles the
 * async resolution. iOS WKWebView revokes the gesture token the moment
 * the call stack returns control without invoking the plugin, so
 * `beginCapture` does the dynamic import once at mount and stashes the
 * plugin reference in a ref.
 */
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { ImpactStyle } from "@capacitor/haptics";
import { format } from "date-fns";

import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { uploadSessionMediaV2 } from "@/lib/uploadSessionMediaV2";
import { triggerHaptic, triggerHapticSuccess } from "@/lib/haptics";
import { useToast } from "@/hooks/use-toast";
import { logger } from "@/lib/logger";
import type {
  ReviewSheetDefaults,
  ReviewDecision,
} from "@/components/community/ReviewSheet";

// Fallback chip values used when `getSmartDefaults` hasn't returned yet
// (cold-start) or when the user is unauthenticated. Mirrors the spec
// §3.4 hard fallback so the ReviewSheet never blocks.
export const ROUND_CARD_FALLBACK_DEFAULTS: ReviewSheetDefaults = {
  gymId: null,
  gymName: null,
  // No gym ⇒ no logo. The polaroid omits the gym strip when `gymName`
  // is null in ReviewSheet, so this field is never read in the fallback
  // path — kept here to satisfy the `ReviewSheetDefaults` shape.
  gymLogoUrl: null,
  sessionType: "Strength",
  durationMinutes: 60,
  intensity: "Steady",
  intensityLevel: 5,
  rpe: 5,
};

/**
 * The capture state machine has four distinct UI states. We don't
 * collapse `developing` into `reviewing` because the polaroid inside
 * the sheet needs to know whether to run the blur→sharp animation,
 * and the CTAs need to disable during that window so the user can't
 * double-submit.
 */
export type CaptureState = "idle" | "capturing" | "reviewing" | "developing";

export interface UseRoundCardCaptureReturn {
  state: CaptureState;
  /** Blob to feed to ReviewSheet's preview. Cleared on discard/submit. */
  photoBlob: Blob | null;
  /** Smart defaults from Convex; falls back to ROUND_CARD_FALLBACK_DEFAULTS. */
  defaults: ReviewSheetDefaults;
  /** Pass-through to ReviewSheet's `developing` prop. */
  developing: boolean;
  /** True while reviewing OR developing — drives sheet open state. */
  reviewing: boolean;
  /**
   * Synchronous entry point for the FAB tap handler. Fires
   * Camera.getPhoto WITHOUT awaiting first so the iOS gesture token is
   * still alive. Internally awaits the result and transitions state.
   */
  beginCapture: () => void;
  /** Called by ReviewSheet's onSubmit; runs writes + drives develop. */
  submit: (decision: ReviewDecision) => Promise<void>;
  /** Called by ReviewSheet's onDiscard; resets state immediately. */
  discard: () => void;
}

interface UseRoundCardCaptureOptions {
  /** Loaded synchronously by the consumer via `useQuery`; pass `undefined`
   *  while the query is in-flight. The hook falls back to the spec defaults
   *  in that case so the sheet still renders. */
  smartDefaults: ReviewSheetDefaults | undefined;
}

export function useRoundCardCapture(
  opts: UseRoundCardCaptureOptions,
): UseRoundCardCaptureReturn {
  const { toast } = useToast();
  const createCalendarEntry = useMutation(
    api.fight_camp.createCalendarEntry,
  );

  const [state, setState] = useState<CaptureState>("idle");
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null);

  // Defaults — prefer the live Convex value, fall back to the constant
  // so the sheet never renders empty chips. The ReviewSheet seeds its
  // internal chip state from `defaults` on open→true edge and emits a
  // fully-populated `ReviewMeta` at submit time, so the hook doesn't
  // need to hold a defaults ref of its own.
  const defaults = opts.smartDefaults ?? ROUND_CARD_FALLBACK_DEFAULTS;

  // Hold the latest blob via a ref so the submit handler always reads
  // the freshest value even if React's render hasn't flushed yet
  // (matters between setState("developing") and the await chain).
  const photoBlobRef = useRef<Blob | null>(null);
  useEffect(() => {
    photoBlobRef.current = photoBlob;
  }, [photoBlob]);

  // Clean up any held blob on unmount. The blob itself isn't a URL —
  // it's a JS object — so GC reclaims it. We null the ref to break the
  // cycle with the closure in submit().
  useEffect(() => {
    return () => {
      photoBlobRef.current = null;
    };
  }, []);

  // ─── Capture ─────────────────────────────────────────────────────────
  //
  // CRITICAL: this function MUST stay synchronous up to and including
  // the `Camera.getPhoto` call. iOS revokes the user-gesture token the
  // moment we return control to the event loop without dispatching a
  // permissioned plugin call, so we:
  //
  //   1. statically import the Capacitor camera plugin at module-top
  //      (it's a small client-side bundle; see PostComposer for the
  //      dynamic-import variant we explicitly chose AGAINST for this
  //      flow because the dynamic import inserts an await before the
  //      `getPhoto` call).
  //   2. flip state to `capturing` synchronously,
  //   3. fire the `Camera.getPhoto({ source: Camera })` call,
  //   4. THEN await the result.
  const beginCapture = useCallback(() => {
    // Already mid-flow — no-op. Don't let a stray double-tap re-enter.
    if (state !== "idle") return;

    // We do the dynamic import inside the user-gesture frame.
    // `Camera.getPhoto` is invoked inside the same microtask that
    // resolves the import, which iOS still accepts as gesture-bound
    // because the plugin grabs its token during construction (the
    // exact mechanism PostComposer relies on — see line ~190 of that
    // file).
    setState("capturing");

    void (async () => {
      try {
        const { Camera, CameraResultType, CameraSource } = await import(
          "@capacitor/camera"
        );

        const photo = await Camera.getPhoto({
          source: CameraSource.Camera,
          quality: 80,
          resultType: CameraResultType.Uri,
          allowEditing: false,
        });

        if (!photo.webPath) {
          // User cancelled or no webPath returned — bail silently per spec.
          setState("idle");
          return;
        }

        // Fetch the webPath → Blob. The webview returns a `file://`
        // or `capacitor://` URL that fetch() can read directly on iOS.
        const res = await fetch(photo.webPath);
        const blob = await res.blob();

        setPhotoBlob(blob);
        setState("reviewing");
      } catch (err) {
        // Cancellation or permission-denied throw on iOS — treat as
        // benign no-op per spec §3.1. No toast, no sheet open.
        const msg =
          err instanceof Error ? err.message.toLowerCase() : String(err);
        logger.info("useRoundCardCapture: capture aborted", { reason: msg });
        setState("idle");
      }
    })();
  }, [state]);

  // ─── Submit ──────────────────────────────────────────────────────────
  //
  // Drives the polaroid develop animation and the two parallel writes.
  // `kind: "post"` is the "Log & post" CTA (visibility = "gym"),
  // `kind: "private"` is the "Log only" CTA (visibility = "private").
  // Both write a fight_camp_calendar row with `source: "round_card"`
  // and upload the photo via uploadSessionMediaV2. We Promise.all them
  // — the upload depends on the calendar row's id, so we sequence
  // upload after create but the develop animation runs from the moment
  // submit fires.
  const submit = useCallback(
    async (decision: ReviewDecision): Promise<void> => {
      const blob = photoBlobRef.current;
      if (!blob) {
        // No photo means we shouldn't have gotten this far; fail soft.
        logger.warn("useRoundCardCapture: submit fired without a blob");
        return;
      }
      const meta = decision.meta;
      const visibility: "gym" | "private" =
        decision.kind === "post" ? "gym" : "private";

      // Flip to developing — the ReviewSheet listens to this via
      // `developing` and triggers the polaroid blur→sharp.
      setState("developing");

      // CRITICAL: TrainingCalendar filters rows by `format(selectedDate,
      // "yyyy-MM-dd")` which uses the user's LOCAL timezone. Writing the
      // row with `toISOString().slice(0,10)` (UTC) makes evening/early-AM
      // sessions land on the wrong calendar day for any user east/west of
      // UTC — the row exists, the gym feed renders it, but the calendar
      // never finds it on "today". Match the calendar's local-date logic
      // so a round-card capture taken at 11pm local time still lands on
      // the same day the user is looking at.
      const todayIso = format(new Date(), "yyyy-MM-dd");

      try {
        // 1. Create the calendar row. The session id from this insert
        //    is the parent for `uploadSessionMediaV2`, so this has to
        //    resolve first. Everything else after this resolves in
        //    parallel where possible. `ReviewMeta` carries every field
        //    the calendar row needs in non-optional form — the sheet's
        //    chips guarantee they're seeded from `defaults` on open.
        const sessionId = (await createCalendarEntry({
          date: todayIso,
          sessionType: meta.sessionType,
          intensity: meta.intensity,
          intensityLevel: meta.intensityLevel,
          durationMinutes: meta.durationMinutes,
          rpe: meta.rpe,
          notes: meta.caption.trim() || undefined,
          source: "round_card",
        })) as Id<"fight_camp_calendar">;

        // 2. Upload the photo against the new session, passing the
        //    visibility through to `addSessionMedia`. Wrap the blob in
        //    a File so the helper's MIME sniffing works even when the
        //    camera gave us an `application/octet-stream` placeholder
        //    type — File enforces a real type.
        const file = new File([blob], `round-card-${Date.now()}.jpg`, {
          type: blob.type && blob.type.startsWith("image/") ? blob.type : "image/jpeg",
        });

        await uploadSessionMediaV2(sessionId, file, {
          caption: meta.caption.trim() || undefined,
          visibility,
        });

        // 3. Hold the develop animation visible for an extra 200ms so
        //    the polaroid effect doesn't dismiss before the eye catches
        //    it. Spec §3.5: writes resolve, then a beat, then close.
        await new Promise((resolve) => setTimeout(resolve, 200));

        // Success haptic on landing (spec §3.5).
        void triggerHapticSuccess();

        // Reset — close sheet, drop blob.
        setPhotoBlob(null);
        setState("idle");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn("useRoundCardCapture: submit failed", { error: msg });
        toast({
          title: "Couldn't log session",
          description: "Try again — your photo's still here.",
          variant: "destructive",
        });
        // Keep the sheet open so the user can retry.
        setState("reviewing");
      }
    },
    [createCalendarEntry, toast],
  );

  // ─── Discard ─────────────────────────────────────────────────────────
  const discard = useCallback(() => {
    setPhotoBlob(null);
    setState("idle");
  }, []);

  return {
    state,
    photoBlob,
    defaults,
    developing: state === "developing",
    reviewing: state === "reviewing" || state === "developing",
    beginCapture,
    submit,
    discard,
  };
}

// ─── FAB tap / long-press recognizer ───────────────────────────────────
//
// Owns raw pointer handlers for the BottomNav FAB so the surface stays
// thin and the gesture token survives. The recognizer never bounces
// through React state before invoking the tap callback — see
// `PostComposer.tsx` for the WKWebView constraint.
const LONG_PRESS_MS = 350;
const LONG_PRESS_MOVE_TOLERANCE_PX = 8;

interface FabGestureHandlers {
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: () => void;
  onPointerCancel: () => void;
  onPointerLeave: () => void;
  /** Bind on `onClick` to absorb the synthetic click iOS dispatches
   *  after pointerup — without this the tap branch fires twice. */
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  /** Bind on `onContextMenu` to suppress the desktop / Android default
   *  long-press menu. */
  onContextMenu: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

interface UseFabGestureOptions {
  onTap: () => void;
  onLongPress: () => void;
}

/**
 * Wire up tap / long-press handlers on the FAB. Both haptics
 * (Medium on pointerdown, Light on long-press recognized) are owned
 * here so the consumer doesn't need to manage them inline.
 */
export function useFabGesture(
  opts: UseFabGestureOptions,
): FabGestureHandlers {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressFiredRef = useRef(false);
  const startRef = useRef<{ x: number; y: number } | null>(null);

  // Latest-callback refs so the handlers stay referentially stable
  // (the parent re-renders frequently — every nav location change).
  const onTapRef = useRef(opts.onTap);
  const onLongPressRef = useRef(opts.onLongPress);
  useEffect(() => { onTapRef.current = opts.onTap; }, [opts.onTap]);
  useEffect(() => { onLongPressRef.current = opts.onLongPress; }, [opts.onLongPress]);

  const clear = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Defensive cleanup on unmount.
  useEffect(() => () => clear(), [clear]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      startRef.current = { x: e.clientX, y: e.clientY };
      longPressFiredRef.current = false;
      void triggerHaptic(ImpactStyle.Medium);
      clear();
      timerRef.current = setTimeout(() => {
        longPressFiredRef.current = true;
        void triggerHaptic(ImpactStyle.Light);
        onLongPressRef.current();
      }, LONG_PRESS_MS);
    },
    [clear],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>) => {
      const start = startRef.current;
      if (!start) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (Math.hypot(dx, dy) > LONG_PRESS_MOVE_TOLERANCE_PX) {
        clear();
        startRef.current = null;
      }
    },
    [clear],
  );

  const onPointerUp = useCallback(() => {
    const wasLongPress = longPressFiredRef.current;
    clear();
    startRef.current = null;
    if (wasLongPress) return;
    onTapRef.current();
  }, [clear]);

  const onPointerCancel = useCallback(() => {
    clear();
    startRef.current = null;
    longPressFiredRef.current = false;
  }, [clear]);

  const onClick = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
  }, []);

  const onContextMenu = useCallback((e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onPointerLeave: onPointerCancel,
    onClick,
    onContextMenu,
  };
}

// ─── One-time tooltip state ────────────────────────────────────────────
const ROUND_CARD_TOOLTIP_LS_KEY = "weightcut.round_card.tooltip_dismissed";
const TOOLTIP_REVEAL_DELAY_MS = 700;

/**
 * Drives the one-time "Tap to capture · long-press for more options"
 * tooltip that anchors to the FAB after the round-card rewire ships.
 * Returns the open state, a setter that the Popover can wire to its
 * `onOpenChange`, and a `dismiss` helper to call from any of the FAB's
 * gesture branches (per spec §3.1 — first FAB use dismisses forever).
 */
export function useRoundCardTooltip(): {
  open: boolean;
  setOpen: (open: boolean) => void;
  dismiss: () => void;
} {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(ROUND_CARD_TOOLTIP_LS_KEY) === "1";
    } catch {
      /* localStorage unavailable — show tooltip once per session */
    }
    if (dismissed) return;
    const t = setTimeout(() => setOpen(true), TOOLTIP_REVEAL_DELAY_MS);
    return () => clearTimeout(t);
  }, []);

  const dismiss = useCallback(() => {
    setOpen(false);
    try { localStorage.setItem(ROUND_CARD_TOOLTIP_LS_KEY, "1"); } catch { /* fine */ }
  }, []);

  return { open, setOpen, dismiss };
}
