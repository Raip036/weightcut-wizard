/**
 * PostWorkoutMediaSheet: after a strength workout is saved, ask the user
 * if they want to attach a photo / video. If they do, upload it via the
 * shared `uploadSessionMediaV2` pipeline, which:
 *
 *   1. Mints a one-time upload URL.
 *   2. POSTs the file bytes to Convex Storage.
 *   3. Inserts a `session_media` row tagged with the calendar entry id
 *      AND (server-side) the uploader's primary gym, so the post lands
 *      in the gym social feed automatically.
 *
 * Stays opt-in. The user can skip and the rest of the save flow is
 * unaffected. Failure to upload doesn't roll back the workout.
 */
import { useEffect, useState } from "react";
import { Image as ImageIcon, Loader2, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SessionMediaPicker } from "@/components/fightcamp/SessionMediaPicker";
import { uploadSessionMediaV2 } from "@/lib/uploadSessionMediaV2";
import { useToast } from "@/hooks/use-toast";
import { triggerHapticSelection } from "@/lib/haptics";
import { logger } from "@/lib/logger";
import type { Id } from "@/../convex/_generated/dataModel";

interface PostWorkoutMediaSheetProps {
  /** Convex `fight_camp_calendar` row id created by `finishSession`. */
  sessionId: Id<"fight_camp_calendar"> | null;
  /** PRIMARY discipline of the just-completed session (e.g. "BJJ" / "S&C"),
   *  used in the prompt copy so the user knows what they're attaching to. */
  sessionType?: string;
  /** OPTIONAL activity descriptor (Sparring, Strength, …); shown as a small
   *  secondary chip in the prompt when present. */
  sessionTag?: string | null;
  onClose: () => void;
}

export function PostWorkoutMediaSheet({
  sessionId,
  sessionType,
  sessionTag,
  onClose,
}: PostWorkoutMediaSheetProps) {
  const { toast } = useToast();
  const [pendingMedia, setPendingMedia] = useState<{ file: File; previewUrl: string } | null>(null);
  const [uploading, setUploading] = useState(false);

  // Clean up any blob URL we minted so we don't leak memory across opens.
  useEffect(() => {
    return () => {
      if (pendingMedia?.previewUrl) URL.revokeObjectURL(pendingMedia.previewUrl);
    };
  }, [pendingMedia?.previewUrl]);

  const handleUpload = async () => {
    if (!sessionId || !pendingMedia) return;
    setUploading(true);
    try {
      await uploadSessionMediaV2(sessionId, pendingMedia.file);
      triggerHapticSelection();
      toast({ description: "Shared with your gym" });
      setPendingMedia(null);
      onClose();
    } catch (err) {
      logger.warn("PostWorkoutMedia upload failed", { error: err instanceof Error ? err.message : String(err) });
      toast({
        description: "Couldn't upload. Try again from the workout's detail page.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <Sheet open={sessionId !== null} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] max-h-[80vh] overflow-y-auto"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="flex items-center gap-2">
            <ImageIcon className="h-4 w-4" />
            Add a photo or video?
            {sessionTag && (
              <span className="text-[10px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-muted/50 text-muted-foreground">
                {sessionTag}
              </span>
            )}
          </SheetTitle>
          <p className="text-[13px] text-muted-foreground">
            Share your{sessionType ? ` ${sessionType.toLowerCase()}` : ""} session with the gym feed.
            Skip if you'd rather keep it private.
          </p>
        </SheetHeader>

        <div className="mt-4 space-y-3">
          <SessionMediaPicker
            mediaPreviewUrl={pendingMedia?.previewUrl ?? null}
            existingMediaUrl={null}
            onMediaSelected={(file, previewUrl) => {
              if (pendingMedia?.previewUrl) URL.revokeObjectURL(pendingMedia.previewUrl);
              setPendingMedia({ file, previewUrl });
            }}
            onMediaRemoved={() => {
              if (pendingMedia?.previewUrl) URL.revokeObjectURL(pendingMedia.previewUrl);
              setPendingMedia(null);
            }}
          />

          <div className="flex items-center gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={uploading}
              className="flex-1 h-11 rounded-xs bg-muted/40 dark:bg-white/[0.06] border border-border/30 text-[14px] font-semibold text-foreground/85 active:scale-[0.98] transition-transform disabled:opacity-50"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={handleUpload}
              disabled={!pendingMedia || uploading}
              className="flex-1 h-11 rounded-xs bg-primary text-primary-foreground text-[14px] font-semibold active:scale-[0.98] transition-transform disabled:opacity-40 flex items-center justify-center gap-2"
            >
              {uploading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Uploading…
                </>
              ) : (
                "Share to gym"
              )}
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
