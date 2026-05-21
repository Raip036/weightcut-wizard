/**
 * Bottom-sheet for filing a moderation report on a feed post.
 *
 * Design contract (locked with the social-tab spec):
 *  - Four large tap targets, one per reason. Selection state is purely
 *    visual; nothing is sent until the user taps Submit.
 *  - "Other" reveals a 140-char textarea. The note is optional even when
 *    "Other" is picked — the server accepts a bare reason.
 *  - Server-side `reportPost` is idempotent on (postId, reporterUserId)
 *    so double-tapping Submit (network jitter) won't dupe reports.
 *  - Self-reports silently no-op on the server. We don't special-case
 *    them here — the success toast still fires, which is fine because
 *    the resulting UI state ("it's been flagged") is what the user
 *    expected anyway.
 */
import { useCallback, useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { Loader2 } from "lucide-react";

import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { triggerHaptic, triggerHapticSuccess, triggerHapticWarning } from "@/lib/haptics";

type Reason = "spam" | "inappropriate" | "harassment" | "other";

interface ReasonOption {
  value: Reason;
  label: string;
  hint: string;
}

const REASONS: ReasonOption[] = [
  { value: "spam", label: "Spam", hint: "Repetitive, promotional, or off-topic." },
  {
    value: "inappropriate",
    label: "Inappropriate content",
    hint: "Explicit, graphic, or otherwise NSFW for the gym feed.",
  },
  {
    value: "harassment",
    label: "Harassment",
    hint: "Targets or attacks a specific person.",
  },
  { value: "other", label: "Other", hint: "Tell the coach what's wrong." },
];

const OTHER_NOTE_MAX = 140;

export interface ReportPostSheetProps {
  /** Controls open/close. Parent owns the state. */
  open: boolean;
  /** Standard shadcn Sheet onOpenChange — invoked on user-driven close. */
  onOpenChange: (open: boolean) => void;
  /** The post being reported. `null` is treated as "no-op", which lets the
   *  parent pass the current post id without worrying about a flash of
   *  empty content during the closing animation. */
  postId: Id<"session_media"> | null;
}

export function ReportPostSheet({
  open,
  onOpenChange,
  postId,
}: ReportPostSheetProps): JSX.Element {
  const reportPost = useMutation(api.feedSocial.reportPost);
  const { toast } = useToast();

  const [reason, setReason] = useState<Reason | null>(null);
  const [note, setNote] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);

  // Reset state every time the sheet closes so the next open is clean.
  useEffect(() => {
    if (!open) {
      // Defer the reset by a tick so the closing animation doesn't show
      // an empty body mid-fade.
      const t = window.setTimeout(() => {
        setReason(null);
        setNote("");
        setSubmitting(false);
      }, 250);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [open]);

  const handlePick = useCallback((next: Reason) => {
    void triggerHaptic();
    setReason(next);
    // Clear stale note text if the user moves away from "Other".
    if (next !== "other") setNote("");
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!postId || !reason || submitting) return;
    setSubmitting(true);
    try {
      const trimmedNote = note.trim();
      await reportPost({
        postId,
        reason,
        // Only send a note when the user actually typed one. The server
        // accepts an optional string but we keep the payload tight.
        note:
          reason === "other" && trimmedNote.length > 0 ? trimmedNote : undefined,
      });
      await triggerHapticSuccess();
      toast({
        title: "Reported",
        description: "Thanks for keeping the gym clean.",
      });
      onOpenChange(false);
    } catch (err) {
      await triggerHapticWarning();
      const message =
        err instanceof Error ? err.message : "Couldn't send the report.";
      toast({
        title: "Report failed",
        description: message,
        variant: "destructive",
      });
      setSubmitting(false);
    }
  }, [note, onOpenChange, postId, reason, reportPost, submitting, toast]);

  const noteRemaining = OTHER_NOTE_MAX - note.length;
  const canSubmit = !!postId && !!reason && !submitting;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-3xl border-border/50 bg-background pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)]"
      >
        <SheetHeader className="text-left">
          <SheetTitle className="text-[17px]">Report this post</SheetTitle>
          <SheetDescription className="text-[13px]">
            Your coach reviews the queue. Posts hit by multiple reports are
            hidden automatically.
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 space-y-2">
          {REASONS.map((opt) => {
            const selected = reason === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => handlePick(opt.value)}
                disabled={submitting}
                aria-pressed={selected}
                className={`glass-card rounded-xs p-4 w-full text-left transition-all active:scale-[0.99] disabled:opacity-60 disabled:active:scale-100 ${
                  selected
                    ? "border-primary/70 ring-2 ring-primary/40"
                    : "border-border/50"
                } border`}
              >
                <p className="text-[15px] font-semibold">{opt.label}</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  {opt.hint}
                </p>
              </button>
            );
          })}
        </div>

        {reason === "other" && (
          <div className="mt-3">
            <textarea
              value={note}
              onChange={(e) => {
                // Hard-cap input length so the counter never goes negative.
                const next = e.target.value.slice(0, OTHER_NOTE_MAX);
                setNote(next);
              }}
              placeholder="What's wrong with this post?"
              rows={3}
              disabled={submitting}
              className="w-full rounded-xs border border-border/50 bg-background/60 p-3 text-[14px] resize-none focus:outline-none focus:ring-2 focus:ring-primary/40 disabled:opacity-60"
            />
            <div className="mt-1 flex justify-end">
              <span
                className={`text-[11px] tabular-nums ${
                  noteRemaining <= 10 ? "text-func-carbs-orange" : "text-muted-foreground"
                }`}
              >
                {noteRemaining}
              </span>
            </div>
          </div>
        )}

        <div className="mt-5 flex items-center gap-2">
          <Button
            type="button"
            variant="ghost"
            className="h-11 rounded-xs flex-1"
            disabled={submitting}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-11 rounded-xs flex-1"
            disabled={!canSubmit}
            onClick={handleSubmit}
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Sending…
              </span>
            ) : (
              "Submit report"
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default ReportPostSheet;
