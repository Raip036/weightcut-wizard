import { useState, useMemo, useRef } from "react";
import { format, parseISO } from "date-fns";
import { Pencil, Trash2, Plus, Loader2, Play, Image as ImageIcon } from "lucide-react";
import { decodeRunMeta } from "@/lib/runMeta";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { getSessionColor } from "@/lib/sessionColors";
import { triggerHapticSelection } from "@/lib/haptics";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { uploadSessionMediaV2 } from "@/lib/uploadSessionMediaV2";
import { MediaLightbox, type LightboxItem } from "@/components/training/MediaLightbox";
import { useToast } from "@/hooks/use-toast";
// Local row type — mirrors the snake_case shape produced by TrainingCalendar.
interface TrainingCalendarRow {
  id: string;
  user_id: string;
  date: string;
  session_type: string;
  duration_minutes: number;
  rpe: number;
  intensity: string;
  intensity_level: number | null;
  bodyweight: number | null;
  fatigue_level: number | null;
  soreness_level: number | null;
  sleep_hours: number | null;
  sleep_quality: string | null;
  mobility_done: boolean | null;
  notes: string | null;
  media_url: string | null;
  created_at: string | null;
  rounds?: number | null;
}

interface SessionDetailDrawerProps {
  session: TrainingCalendarRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onEdit: (session: TrainingCalendarRow) => void;
  onDelete: (id: string) => void;
  customColors: Record<string, string>;
}

function isVideo(url: string): boolean {
  return /\.(mp4|mov|webm|avi|m4v)(\?|$)/i.test(url);
}

function MetricChip({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex flex-col items-center gap-0.5 rounded-xs bg-muted/30 dark:bg-white/[0.03] border border-border/20 px-3 py-2 min-w-0">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className="text-base font-bold tabular-nums" style={color ? { color } : undefined}>{value}</span>
    </div>
  );
}

export function SessionDetailDrawer({
  session,
  open,
  onOpenChange,
  onEdit,
  onDelete,
  customColors,
}: SessionDetailDrawerProps) {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { toast } = useToast();

  // Multi-media: pull every attachment for this session. Skips when the
  // drawer is closed OR while the session row is still optimistic — newly
  // logged sessions hold a UUID local id (`crypto.randomUUID()` from
  // TrainingCalendar) until Convex round-trips back the real id, and
  // sending a UUID to a `v.id("fight_camp_calendar")` validator throws.
  // Real Convex ids are alphanumeric and never contain dashes.
  const sessionIdForQuery = session?.id;
  const isConvexId =
    typeof sessionIdForQuery === "string" && !sessionIdForQuery.includes("-");
  const mediaList = useQuery(
    api.fight_camp.listSessionMedia,
    open && sessionIdForQuery && isConvexId
      ? { sessionId: sessionIdForQuery as Id<"fight_camp_calendar"> }
      : "skip",
  );
  const removeMediaMut = useMutation(api.fight_camp.removeSessionMedia);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const isRun = session?.session_type === "Run";
  const { meta: runMeta, notes: cleanNotes } = useMemo(
    () => isRun && session ? decodeRunMeta(session.notes) : { meta: null, notes: session?.notes ?? "" },
    [isRun, session?.notes]
  );

  // Build the unified list the lightbox renders. Combines (a) the legacy
  // single `media_url` from the row, with (b) the new session_media rows.
  // The legacy entry is ALWAYS shown when `media_url` is non-null — even
  // if the user has since added more attachments — because the legacy
  // attachment and the new ones are independent records, not duplicates
  // of the same image. Suppressing the legacy on the presence of new
  // media meant attaching a second photo made the first one vanish.
  const lightboxItems: LightboxItem[] = useMemo(() => {
    const items: LightboxItem[] = [];
    if (session?.media_url) {
      items.push({
        id: `legacy-${session.id}`,
        url: session.media_url,
        kind: isVideo(session.media_url ?? "") ? "video" : "photo",
        caption: null,
        capturedAt: session.date,
        sessionType: session.session_type,
      });
    }
    for (const m of mediaList ?? []) {
      items.push({
        id: m.id as unknown as string,
        url: m.url ?? null,
        kind: m.kind,
        caption: m.caption,
        capturedAt: m.capturedAt,
        sessionType: session?.session_type ?? null,
      });
    }
    return items;
  }, [mediaList, session]);

  const handleFile = async (file: File | undefined) => {
    if (!file || !session) return;
    // Optimistic rows haven't been persisted yet, so there's no Convex id
    // to attach media to. Tell the user to wait a moment instead of
    // tripping the same validator error from the upload mutation.
    if (!isConvexId) {
      toast({
        title: "Saving session…",
        description: "Try adding media again in a second.",
      });
      return;
    }
    setUploading(true);
    try {
      await uploadSessionMediaV2(
        session.id as Id<"fight_camp_calendar">,
        file,
        { capturedAt: session.date },
      );
      triggerHapticSelection();
    } catch (err: any) {
      toast({
        title: "Couldn't upload media",
        description: err?.message ?? "Try again with a smaller file.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteMedia = async (item: LightboxItem) => {
    if (item.id.startsWith("legacy-")) {
      // Legacy media still lives on `fight_camp_calendar.mediaStorageId`.
      // The dedicated edit flow is the right place to clear it; surface a
      // toast so the user knows to use Edit for now.
      toast({
        title: "Edit the session to remove this media",
        description: "Tap Edit, then save without a photo to clear it.",
      });
      return;
    }
    try {
      await removeMediaMut({ mediaId: item.id as Id<"session_media"> });
      // Keep the lightbox open if there are still items left; otherwise close.
      if (lightboxItems.length <= 1) setLightboxIndex(null);
    } catch (err: any) {
      toast({
        title: "Couldn't delete media",
        description: err?.message ?? "Try again.",
        variant: "destructive",
      });
    }
  };

  if (!session) return null;

  const sessionColor = getSessionColor(session.session_type, customColors);
  const isRest = session.session_type === "Rest";
  const intensityDisplay = session.intensity_level ?? (session.intensity === "high" ? 5 : session.intensity === "moderate" ? 3 : 1);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md rounded-[24px]">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 rounded-full flex-shrink-0" style={{ backgroundColor: sessionColor }} />
              <DialogTitle className="text-2xl font-bold">{session.session_type}</DialogTitle>
            </div>
            <p className="text-sm text-muted-foreground mt-1 text-left">
              {format(parseISO(session.date), "EEEE, MMMM do yyyy")}
            </p>
          </DialogHeader>

          {/* Media — multi-attachment grid. Tap a tile to open the
              fullscreen swipeable lightbox. The "+" tile picks from the
              gallery; the camera tile opens the device camera (iOS uses
              `capture="environment"` to launch the rear camera). */}
          <div className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              {lightboxItems.map((item, i) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    triggerHapticSelection();
                    setLightboxIndex(i);
                  }}
                  className="relative aspect-square rounded-xs overflow-hidden bg-muted/40 border border-border/30 active:scale-[0.98] transition-transform"
                >
                  {item.url ? (
                    item.kind === "video" ? (
                      <>
                        <video
                          src={item.url}
                          className="w-full h-full object-cover"
                          muted
                          playsInline
                          preload="metadata"
                        />
                        <div className="absolute inset-0 flex items-center justify-center bg-black/15">
                          <div className="h-8 w-8 rounded-full bg-black/50 backdrop-blur flex items-center justify-center">
                            <Play className="h-3.5 w-3.5 text-white fill-white" />
                          </div>
                        </div>
                      </>
                    ) : (
                      <img
                        src={item.url}
                        alt={item.caption ?? "Session media"}
                        className="w-full h-full object-cover"
                      />
                    )
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground/40">
                      <ImageIcon className="h-5 w-5" />
                    </div>
                  )}
                </button>
              ))}

              {/* Add from gallery */}
              <button
                type="button"
                onClick={() => {
                  triggerHapticSelection();
                  fileInputRef.current?.click();
                }}
                disabled={uploading}
                className="aspect-square rounded-xs border-2 border-dashed border-border/50 bg-muted/20 flex flex-col items-center justify-center text-muted-foreground active:bg-muted/40 transition-colors disabled:opacity-50"
                aria-label="Add photo or video from gallery"
              >
                {uploading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Plus className="h-5 w-5" />
                    <span className="text-[9px] font-semibold uppercase tracking-wider mt-1">Gallery</span>
                  </>
                )}
              </button>

              {/* Take a new photo / video */}
              <button
                type="button"
                onClick={() => {
                  triggerHapticSelection();
                  cameraInputRef.current?.click();
                }}
                disabled={uploading}
                className="aspect-square rounded-xs border-2 border-dashed border-border/50 bg-muted/20 flex flex-col items-center justify-center text-muted-foreground active:bg-muted/40 transition-colors disabled:opacity-50"
                aria-label="Take a new photo or video"
              >
                {uploading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <Plus className="h-5 w-5" />
                    <span className="text-[9px] font-semibold uppercase tracking-wider mt-1">Camera</span>
                  </>
                )}
              </button>
            </div>

            {/* Hidden inputs — Capacitor on iOS opens the native picker /
                camera UI when these are clicked. `capture="environment"`
                hints the rear camera; without it the user gets the
                full picker including selfie cam. */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                void handleFile(f);
              }}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*,video/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                void handleFile(f);
              }}
            />
          </div>

          {/* Notes — prominent, first thing the user sees */}
          {(isRun ? cleanNotes : session.notes) && (
            <div className="rounded-xs border border-border/20 bg-muted/10 dark:bg-white/[0.02] p-4">
              <p className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">{isRun ? cleanNotes : session.notes}</p>
            </div>
          )}

          {/* Metrics — compact chip grid */}
          <div className="grid grid-cols-3 gap-2">
            {isRest ? (
              <>
                {session.sleep_quality && <MetricChip label="Sleep" value={session.sleep_quality} />}
                {session.fatigue_level != null && <MetricChip label="Fatigue" value={`${session.fatigue_level}/10`} />}
                {session.mobility_done != null && <MetricChip label="Mobility" value={session.mobility_done ? "Done" : "Skip"} />}
              </>
            ) : (
              <>
                {isRun && runMeta ? (
                  <>
                    {runMeta.distance && <MetricChip label="Distance" value={`${runMeta.distance} ${runMeta.unit}`} color={sessionColor} />}
                    {runMeta.time && <MetricChip label="Time" value={runMeta.time} />}
                    {runMeta.pace && <MetricChip label="Pace" value={`${runMeta.pace}/${runMeta.unit}`} />}
                  </>
                ) : (
                  <>
                    <MetricChip label="Duration" value={`${session.duration_minutes}m`} color={sessionColor} />
                    <MetricChip label="RPE" value={`${session.rpe}/10`} />
                    <MetricChip label="Intensity" value={`${intensityDisplay}/5`} />
                  </>
                )}
                {(session.soreness_level ?? 0) > 0 && <MetricChip label="Soreness" value={`${session.soreness_level}/10`} />}
                {(session.sleep_hours ?? 0) > 0 && <MetricChip label="Sleep" value={`${session.sleep_hours}h`} />}
              </>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <Button
              variant="outline"
              className="flex-1 h-12 rounded-xs font-semibold text-base gap-2"
              onClick={() => {
                triggerHapticSelection();
                onEdit(session);
              }}
            >
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
            <Button
              variant="outline"
              className="h-12 w-12 rounded-xs text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30"
              onClick={() => {
                triggerHapticSelection();
                setDeleteOpen(true);
              }}
            >
              <Trash2 className="h-5 w-5" />
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        onConfirm={() => {
          onDelete(session.id);
          setDeleteOpen(false);
          onOpenChange(false);
        }}
        title="Delete Session"
        description={`Delete this ${session.session_type} session?`}
      />

      <MediaLightbox
        items={lightboxItems}
        startIndex={lightboxIndex ?? 0}
        open={lightboxIndex !== null}
        onClose={() => setLightboxIndex(null)}
        onDelete={handleDeleteMedia}
      />
    </>
  );
}
