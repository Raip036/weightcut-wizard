/**
 * PostComposer — bottom-sheet flow for creating a Corner tab post.
 *
 * Steps (state machine, single sheet):
 *
 *   1. CAPTURE   — "Take Photo" / "Choose From Library" / Cancel
 *   2. PREVIEW   — square preview, caption textarea (240 chars), privacy toggle
 *   3. UPLOADING — full-sheet spinner with progress label
 *   4. ERROR     — retry button + the error message from useCreatePost
 *
 * Native iOS image cropping is delegated to `@capacitor/camera`'s
 * `allowEditing: true` flow — we don't ship our own crop UI for v1.
 *
 * Submit pipeline:
 *
 *   base64 ──▶ compressImage (1024w q=0.82)  ──┬──▶ uploadSessionMediaV2
 *                                              │
 *                                              └──▶ generateThumbDataUrl (LQIP)
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Image as ImageIcon, Camera as CameraIcon, Lock, Loader2 } from "lucide-react";
import { ImpactStyle } from "@capacitor/haptics";
import { useQuery } from "convex/react";

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { triggerHaptic, triggerHapticSuccess } from "@/lib/haptics";
import { logger } from "@/lib/logger";

import {
  compressImage,
  generateThumbDataUrl,
} from "@/lib/imageCompress";
import { useCreatePost } from "@/hooks/community/useCreatePost";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const CAPTION_MAX = 240;

/**
 * Memoised caption input. Isolated so per-keystroke `caption` updates
 * only re-render this subtree — the preview <img>, privacy toggle, and
 * Post button stay quiescent. `setCaption` (from useState) is a stable
 * identity so the memo never invalidates on parent re-renders for
 * unrelated reasons.
 */
const CaptionInput = memo(function CaptionInput({
  value,
  onChange,
  max,
}: {
  value: string;
  onChange: (next: string) => void;
  max: number;
}) {
  return (
    <Textarea
      value={value}
      onChange={(e) => onChange(e.target.value.slice(0, max))}
      placeholder="Add a caption…"
      maxLength={max}
      className="mt-4 min-h-[88px] resize-none rounded-xs border border-white/10 bg-white/[0.04] text-sm text-white placeholder:text-white/40 focus-visible:ring-1 focus-visible:ring-white/20"
    />
  );
});

type Step = "capture" | "preview" | "uploading" | "error";

interface PostComposerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Fired after a successful post create. */
  onPosted?: (postId: Id<"session_media">) => void;
  /** Session to attach this post to. Required at submit time. */
  defaultSessionId?: Id<"fight_camp_calendar">;
}

export function PostComposer({
  open,
  onOpenChange,
  onPosted,
  defaultSessionId,
}: PostComposerProps) {
  const { toast } = useToast();
  const navigate = useNavigate();
  const createPost = useCreatePost();

  // Hidden file input — used as a web fallback when running outside Capacitor
  // and as a "Choose From Library" path when the gesture context demands it.
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [step, setStep] = useState<Step>("capture");

  // ─── Today's-session auto-detection ─────────────────────────────────
  //
  // When the parent supplies an explicit `defaultSessionId` we honour it
  // verbatim. Otherwise we list today's calendar rows for the signed-in
  // user via the existing `fight_camp.listCalendar` query (no single-
  // session-by-date query exists yet) and pick the most-recent row.
  //
  // The query is gated on `open` so a closed sheet doesn't keep a
  // subscription warm. We also skip when an explicit id is provided,
  // avoiding an unnecessary round-trip for the standard "open from a
  // logged session" flow.
  const todayIso = useMemo(() => new Date().toISOString().slice(0, 10), []);

  // Defer the Convex subscription until *after* the sheet's slide-in
  // animation lands. The sheet's open transition runs ~400 ms; firing
  // a fresh `useQuery` on the same render that flips `open` to true
  // causes Convex to suspend mid-animation (websocket round-trip +
  // reactive re-render), which the user perceives as a stutter half-
  // way through the slide. A 450 ms gate gives the animation a tiny
  // buffer to finish before we hot-mount the subscription.
  const [queryEnabled, setQueryEnabled] = useState(false);
  useEffect(() => {
    if (!open) {
      setQueryEnabled(false);
      return;
    }
    const t = setTimeout(() => setQueryEnabled(true), 450);
    return () => clearTimeout(t);
  }, [open]);

  const calendarRows = useQuery(
    api.fight_camp.listCalendar,
    queryEnabled && !defaultSessionId ? { from: todayIso, to: todayIso } : "skip",
  );

  // Pick the most-recent today-row. `_creationTime` is the canonical
  // monotonic ordering on Convex docs — preferred over `updatedAt`
  // which a coach-edit could bump out of band.
  const autoSessionId = useMemo<Id<"fight_camp_calendar"> | null>(() => {
    if (defaultSessionId) return null;
    if (!calendarRows || calendarRows.length === 0) return null;
    const sorted = [...calendarRows].sort(
      (a, b) => (b._creationTime ?? 0) - (a._creationTime ?? 0),
    );
    return sorted[0]._id as Id<"fight_camp_calendar">;
  }, [calendarRows, defaultSessionId]);

  // Effective session — prop wins, then auto-detected. `undefined` while
  // the query is in-flight, `null` once we've confirmed there's no
  // session to attach to.
  const effectiveSessionId: Id<"fight_camp_calendar"> | null | undefined =
    defaultSessionId ??
    (calendarRows === undefined ? undefined : autoSessionId);
  // The "no session at all" branch only matters once we've actually
  // gotten the query result back AND there's no explicit prop value.
  const hasNoSession =
    !defaultSessionId && calendarRows !== undefined && autoSessionId === null;

  /** Source blob (already JPEG; HEIC is converted by @capacitor/camera). */
  const [sourceBlob, setSourceBlob] = useState<Blob | null>(null);
  /** Object URL for the preview <img>. Always revoked on cleanup. */
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // Un-mirror the image before saving. Default true because iOS's
  // "Mirror Front Camera" setting (ON by default since iOS 14) bakes a
  // horizontal mirror into selfie pixels, which makes text/logos read
  // reversed in the gym feed. Users can toggle off for rear-camera shots
  // that come in already-correct.
  const [flipHorizontal, setFlipHorizontal] = useState(true);

  // Reset state whenever the sheet closes so a reopened composer is fresh.
  useEffect(() => {
    if (!open) {
      setStep("capture");
      setSourceBlob(null);
      setCaption("");
      setIsPrivate(false);
      setErrorMsg(null);
      setFlipHorizontal(true);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Revoke any in-flight object URL on unmount — defensive cleanup so a
  // hot-reload doesn't leak a handful of blob: URLs.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  /** Promote a blob into the preview step, replacing any prior selection. */
  const acceptBlob = useCallback(
    (blob: Blob) => {
      // Revoke prior preview before reassigning so each transition cleans up.
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(blob);
      setSourceBlob(blob);
      setPreviewUrl(url);
      setStep("preview");
    },
    [previewUrl],
  );

  // ─── Capture — native ────────────────────────────────────────────────
  const handleNativePick = useCallback(async () => {
    // The camera plugin requires a live user-gesture; we're inside an
    // onClick so the stack is intact. Dynamic import keeps the bundle
    // light for users who never open the composer.
    try {
      triggerHaptic(ImpactStyle.Light);
      const { Camera, CameraResultType, CameraSource } = await import(
        "@capacitor/camera"
      );

      // Permission gate. iOS shows the system prompt on first invocation;
      // we treat "denied" as a soft no-op since the user can re-enable
      // it in Settings.
      const perms = await Camera.checkPermissions();
      if (perms.camera !== "granted" && perms.photos !== "granted") {
        const req = await Camera.requestPermissions({
          permissions: ["camera", "photos"],
        });
        if (req.camera === "denied" && req.photos === "denied") {
          toast({
            title: "Camera access blocked",
            description: "Enable it in Settings → WeightCut to post photos.",
            variant: "destructive",
          });
          return;
        }
      }

      const photo = await Camera.getPhoto({
        source: CameraSource.Prompt,
        resultType: CameraResultType.Base64,
        quality: 90,
        allowEditing: true,
        // Wide enough that the post-compose step still has headroom to
        // downscale to 1024w without softening detail.
        width: 1600,
        height: 1600,
        promptLabelHeader: "New Post",
        promptLabelPhoto: "Choose from Library",
        promptLabelPicture: "Take Photo",
      });

      if (!photo.base64String) return; // User cancelled.

      // Convert base64 → Blob without bouncing through fetch(); cleaner
      // for large payloads and avoids a CSP "data:" hit on stricter
      // configs.
      const bin = atob(photo.base64String);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], {
        type: photo.format ? `image/${photo.format}` : "image/jpeg",
      });

      acceptBlob(blob);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message.toLowerCase() : String(err);
      // Cancellation throws on iOS — treat it as a benign no-op.
      if (msg.includes("cancel") || msg.includes("dismiss")) return;
      logger.warn("PostComposer: native capture failed", { error: msg });
      toast({
        title: "Couldn't open camera",
        description: "Try choosing a photo from your library instead.",
        variant: "destructive",
      });
    }
  }, [acceptBlob, toast]);

  // ─── Capture — web fallback ─────────────────────────────────────────
  const handleWebPick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      // Reset the input so the same file can be picked twice in a row.
      e.target.value = "";
      if (!file) return;
      acceptBlob(file);
    },
    [acceptBlob],
  );

  // Unified entry point — picks the right pathway by platform.
  const handlePickPhoto = useCallback(() => {
    if (Capacitor.isNativePlatform()) {
      void handleNativePick();
    } else {
      handleWebPick();
    }
  }, [handleNativePick, handleWebPick]);

  // ─── Submit ─────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    if (!sourceBlob) return;
    // We never hit this branch in practice — the preview-step Post
    // button is disabled when there's no `effectiveSessionId`, and the
    // empty-state fork below takes over when none can be auto-detected.
    // Keep the early-return as a defensive guard.
    if (!effectiveSessionId) return;

    setStep("uploading");
    setErrorMsg(null);

    try {
      // Compress in parallel with the LQIP — both read from the source
      // blob independently, so there's no work-sharing benefit to
      // sequencing. Saves ~80 ms on midrange iPhones.
      const [compressed, thumbDataUrl] = await Promise.all([
        compressImage(sourceBlob, { maxWidth: 1024, quality: 0.82, flipHorizontal }),
        // LQIP encodes from the *original* source for max source fidelity.
        // Tiny by design (≤ 2 KB) so this is a near-instant generate.
        // Matches the main image's flip so the blur-up doesn't pop.
        generateThumbDataUrl(sourceBlob, { flipHorizontal }),
      ]);

      // Decode the compressed blob once to read its final dimensions —
      // the server records them so the grid can reserve aspect-ratio slots
      // before the image fetches.
      const { width, height } = await readBlobDimensions(compressed);

      const { postId } = await createPost({
        blob: compressed,
        sessionId: effectiveSessionId,
        caption: caption.trim() || undefined,
        isPrivate,
        thumbDataUrl,
        width,
        height,
      });

      void triggerHapticSuccess();
      toast({
        title: "Posted",
        description: isPrivate ? "Saved to your private feed." : "Live in your gym's Corner.",
      });
      onPosted?.(postId);
      onOpenChange(false);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "Something went wrong.";
      setErrorMsg(msg);
      setStep("error");
    }
  }, [
    sourceBlob,
    effectiveSessionId,
    toast,
    createPost,
    caption,
    isPrivate,
    flipHorizontal,
    onPosted,
    onOpenChange,
  ]);

  const captionLeft = CAPTION_MAX - caption.length;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        // 100dvh on iOS to dodge the dynamic toolbar. Padding follows
        // the safe-area inset so the post button doesn't sit under the
        // home indicator.
        className="h-[100dvh] max-h-[100dvh] rounded-t-3xl border-t border-white/10 bg-zinc-950 p-0 text-white"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px))",
        }}
      >
        <SheetHeader className="px-5 pb-2 pt-5 text-left">
          <SheetTitle className="text-base font-semibold text-white">
            New Post
          </SheetTitle>
        </SheetHeader>

        {/* Hidden web file input — invoked from handleWebPick. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileChange}
        />

        {hasNoSession ? (
          // No logged session today and no explicit `defaultSessionId` —
          // replace the entire body (after the open animation) with a
          // friendly empty state that routes to the training calendar.
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 pb-12 text-center">
            <p className="text-base font-semibold text-white">
              Log a session first
            </p>
            <p className="text-xs text-white/60">
              Posts attach to a training session. Log today's session and
              come back to share it.
            </p>
            <button
              type="button"
              onClick={() => {
                onOpenChange(false);
                navigate("/training-calendar?openLogSession=true");
              }}
              className="mt-3 h-10 rounded-xs bg-white px-5 text-sm font-semibold text-zinc-950 active:scale-[0.98]"
            >
              Go to Training
            </button>
          </div>
        ) : (
          <>
        {step === "capture" && (
          <div className="flex flex-1 flex-col gap-3 px-5 pt-4">
            <p className="text-sm text-white/60">
              Share a photo from training. Stays in your gym's feed unless
              you mark it private.
            </p>
            <button
              type="button"
              onClick={handlePickPhoto}
              className="mt-4 flex h-14 items-center justify-center gap-2 rounded-xs bg-white text-base font-semibold text-zinc-950 active:scale-[0.98] transition-transform"
            >
              <CameraIcon className="h-5 w-5" />
              Take Photo or Choose
            </button>
            <button
              type="button"
              onClick={handleWebPick}
              className="flex h-12 items-center justify-center gap-2 rounded-xs bg-white/5 text-sm font-medium text-white/80 active:scale-[0.98] transition-transform"
            >
              <ImageIcon className="h-4 w-4" />
              From files
            </button>
          </div>
        )}

        {step === "preview" && previewUrl && (
          <div className="flex flex-1 flex-col px-5 pt-2">
            {/* Square preview — `object-cover` enforces the 1:1 framing the
                feed grid expects. The native picker handles the actual
                crop on iOS via `allowEditing: true`. */}
            <div className="relative mx-auto aspect-square w-full max-w-[480px] overflow-hidden rounded-xs bg-zinc-900">
              <img
                src={previewUrl}
                alt="Preview"
                className="absolute inset-0 h-full w-full object-cover"
                style={{
                  transform: flipHorizontal ? "scaleX(-1)" : undefined,
                }}
              />
              <button
                type="button"
                onClick={() => {
                  setStep("capture");
                  if (previewUrl) URL.revokeObjectURL(previewUrl);
                  setPreviewUrl(null);
                  setSourceBlob(null);
                }}
                className="absolute left-3 top-3 rounded-full bg-black/55 px-3 py-1 text-xs font-medium backdrop-blur-sm active:scale-[0.97]"
              >
                Change
              </button>
              {/* Un-mirror toggle. Default ON un-flips iOS's baked-in
                  selfie mirror so text reads correctly; user can flip
                  off for rear-camera shots. */}
              <button
                type="button"
                onClick={() => setFlipHorizontal((v) => !v)}
                aria-pressed={flipHorizontal}
                className="absolute right-3 top-3 rounded-full bg-black/55 px-3 py-1 text-xs font-medium backdrop-blur-sm active:scale-[0.97]"
              >
                {flipHorizontal ? "Un-mirrored" : "Mirrored"}
              </button>
            </div>

            <CaptionInput
              value={caption}
              onChange={setCaption}
              max={CAPTION_MAX}
            />
            <div className="mt-1 flex items-center justify-end text-[11px] text-white/40">
              {captionLeft} left
            </div>

            <PrivacyToggle isPrivate={isPrivate} onChange={setIsPrivate} />

            <div className="mt-auto pb-4 pt-4">
              <button
                type="button"
                onClick={() => void handleSubmit()}
                // Disable until we have both a blob AND a resolved session
                // id. `effectiveSessionId === undefined` while the
                // today's-session query is still in flight.
                disabled={!sourceBlob || !effectiveSessionId}
                className={cn(
                  "h-12 w-full rounded-xs bg-white text-sm font-semibold text-zinc-950 active:scale-[0.98] transition-transform",
                  (!sourceBlob || !effectiveSessionId) && "opacity-60",
                )}
              >
                Post
              </button>
            </div>
          </div>
        )}

        {step === "uploading" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 pb-12 text-center">
            <Loader2 className="h-7 w-7 animate-spin text-white/80" />
            <p className="text-sm font-medium text-white/90">Posting…</p>
            <p className="text-xs text-white/50">
              Compressing photo and uploading.
            </p>
          </div>
        )}

        {step === "error" && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 pb-12 text-center">
            <p className="text-sm font-semibold text-white">
              That didn't go through
            </p>
            <p className="text-xs text-white/60">
              {errorMsg ?? "Try again. Your photo's still here."}
            </p>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => setStep("preview")}
                className="h-10 rounded-xs bg-white/[0.06] px-4 text-sm font-medium text-white active:scale-[0.98]"
              >
                Back
              </button>
              <button
                type="button"
                onClick={() => void handleSubmit()}
                className="h-10 rounded-xs bg-white px-4 text-sm font-semibold text-zinc-950 active:scale-[0.98]"
              >
                Retry
              </button>
            </div>
          </div>
        )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Two-pill segmented control for Gym ↔ Private. Mirrors the iOS
 * `UISegmentedControl` look at the dark palette WeightCut runs.
 */
function PrivacyToggle({
  isPrivate,
  onChange,
}: {
  isPrivate: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="mt-4 flex rounded-xs bg-white/[0.05] p-1">
      <button
        type="button"
        onClick={() => {
          if (isPrivate) {
            triggerHaptic(ImpactStyle.Light);
            onChange(false);
          }
        }}
        className={cn(
          "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xs text-xs font-semibold transition-colors",
          !isPrivate
            ? "bg-white text-zinc-950"
            : "text-white/70 hover:text-white",
        )}
        aria-pressed={!isPrivate}
      >
        Gym
      </button>
      <button
        type="button"
        onClick={() => {
          if (!isPrivate) {
            triggerHaptic(ImpactStyle.Light);
            onChange(true);
          }
        }}
        className={cn(
          "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xs text-xs font-semibold transition-colors",
          isPrivate
            ? "bg-white text-zinc-950"
            : "text-white/70 hover:text-white",
        )}
        aria-pressed={isPrivate}
      >
        <Lock className="h-3 w-3" />
        Private
      </button>
    </div>
  );
}

/**
 * Decode a JPEG blob into an `HTMLImageElement` long enough to read its
 * natural dimensions. Returns 0×0 on failure so the caller still posts
 * — the server treats missing dims as "render at default aspect ratio".
 */
async function readBlobDimensions(
  blob: Blob,
): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const dims = { width: img.naturalWidth, height: img.naturalHeight };
      URL.revokeObjectURL(url);
      resolve(dims);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ width: 0, height: 0 });
    };
    img.src = url;
  });
}
