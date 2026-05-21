import { useMemo, useRef, useState } from "react";
import {
  Loader2, Send, Check, Trophy, MessageSquare, ImagePlus, Video, X,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useToast } from "@/hooks/use-toast";
import { celebrateSuccess, triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { logger } from "@/lib/logger";
import { AthleteAvatar } from "./AthleteAvatar";
import type { AthleteOverviewRow } from "@/hooks/coach/useCoachData";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;   // 5MB
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;  // 25MB

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  gymId: string;
  gymName: string;
  athletes: AthleteOverviewRow[];
  onSent?: () => void;
}

const MAX_BODY = 2000;

export function AnnouncementComposeSheet({ open, onOpenChange, gymId, gymName, athletes, onSent }: Props) {
  const { toast } = useToast();
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<"all" | "specific">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sending, setSending] = useState(false);
  // Compose kind: regular text announcement or a structured fight offer.
  // Polls and images are composed via separate flows (poll module + future
  // media upload), so this control is intentionally just the two kinds the
  // sheet supports today.
  const [kind, setKind] = useState<"text" | "fight_offer">("text");
  // Fight-offer structured fields. Date is held as the native input value
  // (yyyy-mm-dd) for round-tripping; converted to epoch on send.
  const [fightDate, setFightDate] = useState<string>("");
  const [weightClassKg, setWeightClassKg] = useState<string>("");
  const [eventName, setEventName] = useState<string>("");
  const [opponentName, setOpponentName] = useState<string>("");
  const [location, setLocation] = useState<string>("");
  const [purseText, setPurseText] = useState<string>("");

  const createAnnouncement = useMutation(api.announcements.create);
  const createOffer = useMutation(api.fight_offers.createOffer);
  const generateMediaUploadUrl = useMutation(api.announcements.generateMediaUploadUrl);

  // Media attachment state — the storage id is what gets sent on submit;
  // previewUrl is a local ObjectURL the compose sheet shows immediately so
  // the coach knows the upload landed. mediaKind drives the right preview
  // element (img vs video) + tells the server which renderer to use.
  const [mediaStorageId, setMediaStorageId] = useState<Id<"_storage"> | null>(null);
  const [mediaKind, setMediaKind] = useState<"image" | "video" | null>(null);
  const [mediaPreviewUrl, setMediaPreviewUrl] = useState<string | null>(null);
  const [mediaUploading, setMediaUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const remaining = MAX_BODY - body.length;
  const canSend = useMemo(() => {
    if (sending) return false;
    if (mediaUploading) return false;
    if (mode === "specific" && selected.size === 0) return false;
    if (kind === "text") return !!body.trim() || !!mediaStorageId;
    // Fight offer: date + weight class are required; body is optional pitch.
    if (!fightDate) return false;
    const wc = parseFloat(weightClassKg);
    if (!Number.isFinite(wc) || wc <= 0) return false;
    return true;
  }, [body, mode, selected, sending, kind, fightDate, weightClassKg, mediaUploading, mediaStorageId]);

  const toggleSelected = (userId: string) => {
    triggerHaptic(ImpactStyle.Light);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const reset = () => {
    setBody("");
    setMode("all");
    setSelected(new Set());
    setKind("text");
    setFightDate("");
    setWeightClassKg("");
    setEventName("");
    setOpponentName("");
    setLocation("");
    setPurseText("");
    if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
    setMediaPreviewUrl(null);
    setMediaStorageId(null);
    setMediaKind(null);
  };

  const handleMediaPick = () => {
    if (mediaUploading) return;
    triggerHaptic(ImpactStyle.Light);
    fileInputRef.current?.click();
  };

  const handleMediaRemove = () => {
    triggerHaptic(ImpactStyle.Light);
    if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
    setMediaPreviewUrl(null);
    setMediaStorageId(null);
    setMediaKind(null);
  };

  const handleMediaChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking same file
    if (!file) return;

    // MIME sniff — file picker filter is a UX hint, not a guarantee.
    const isImage = file.type.startsWith("image/");
    const isVideo = file.type.startsWith("video/");
    if (!isImage && !isVideo) {
      toast({
        title: "Unsupported file",
        description: "Pick a photo or video.",
        variant: "destructive",
      });
      return;
    }
    const cap = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
    if (file.size > cap) {
      toast({
        title: isVideo ? "Video too large" : "Image too large",
        description: isVideo ? "Keep videos under 25 MB." : "Keep images under 5 MB.",
        variant: "destructive",
      });
      return;
    }

    setMediaUploading(true);
    try {
      const uploadUrl = await generateMediaUploadUrl({ gymId: gymId as Id<"gyms"> });
      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!uploadRes.ok) {
        throw new Error(`Upload failed (${uploadRes.status})`);
      }
      const { storageId } = (await uploadRes.json()) as {
        storageId: Id<"_storage">;
      };
      // Revoke any previous preview before swapping in the new one.
      if (mediaPreviewUrl) URL.revokeObjectURL(mediaPreviewUrl);
      setMediaPreviewUrl(URL.createObjectURL(file));
      setMediaStorageId(storageId);
      setMediaKind(isVideo ? "video" : "image");
    } catch (err: any) {
      logger.error("AnnouncementComposeSheet: media upload failed", err);
      toast({
        title: "Couldn't attach media",
        description: err?.message ?? "Try again.",
        variant: "destructive",
      });
    } finally {
      setMediaUploading(false);
    }
  };

  const handleSend = async () => {
    if (!canSend) return;
    setSending(true);
    triggerHaptic(ImpactStyle.Medium);
    try {
      const targets =
        mode === "specific"
          ? Array.from(selected).map((id) => id as Id<"users">)
          : undefined;
      if (kind === "fight_offer") {
        // Local-midnight epoch from the yyyy-mm-dd value so timezone drift
        // doesn't shift the date the fighter sees in their feed.
        const epoch = new Date(`${fightDate}T12:00:00`).getTime();
        await createOffer({
          gymId: gymId as Id<"gyms">,
          body: body.trim() || undefined,
          targetUserIds: targets,
          mediaStorageId: mediaStorageId ?? undefined,
          mediaKind: mediaKind ?? undefined,
          fightDate: epoch,
          weightClassKg: parseFloat(weightClassKg),
          eventName: eventName.trim() || undefined,
          opponentName: opponentName.trim() || undefined,
          location: location.trim() || undefined,
          purseText: purseText.trim() || undefined,
        });
        celebrateSuccess();
        toast({
          title: "Fight offer posted",
          description: mode === "all"
            ? `Sent to every fighter in ${gymName}`
            : `Sent to ${selected.size} fighter${selected.size === 1 ? "" : "s"}`,
        });
      } else {
        await createAnnouncement({
          gymId: gymId as Id<"gyms">,
          body: body.trim(),
          kind: "text",
          targetUserIds: targets,
          mediaStorageId: mediaStorageId ?? undefined,
          mediaKind: mediaKind ?? undefined,
        });
        celebrateSuccess();
        toast({
          title: "Announcement sent",
          description: mode === "all"
            ? `Broadcast to all athletes in ${gymName}`
            : `Sent to ${selected.size} athlete${selected.size === 1 ? "" : "s"}`,
        });
      }
      reset();
      onOpenChange(false);
      onSent?.();
    } catch (err: any) {
      logger.error("AnnouncementComposeSheet: send failed", err);
      toast({ title: "Could not send announcement", description: err?.message, variant: "destructive" });
    } finally {
      setSending(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="rounded-t-2xl pb-[calc(env(safe-area-inset-bottom,0px)+1.5rem)] [&>button]:hidden max-h-[85vh] flex flex-col"
      >
        <div className="flex justify-center pt-1 pb-3 shrink-0">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/25" aria-hidden />
        </div>
        {/* Header with always-visible Send button (iOS compose pattern) */}
        <div className="flex items-center justify-between px-1 pb-3 shrink-0 gap-2">
          <SheetHeader className="text-left flex-1 min-w-0">
            <SheetTitle className="text-base font-semibold">New announcement</SheetTitle>
            <p className="text-[12px] text-muted-foreground truncate">{gymName}</p>
          </SheetHeader>
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="h-9 px-4 rounded-full bg-primary text-primary-foreground text-[13px] font-semibold active:scale-[0.95] transition-transform disabled:opacity-40 flex items-center justify-center gap-1.5 flex-shrink-0"
          >
            {sending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <><Send className="h-3 w-3" /> Send</>
            )}
          </button>
          {/* Explicit close — Radix's X is suppressed via `[&>button]:hidden`
              on SheetContent. Without this the only exit is the drag handle
              or backdrop tap, neither of which is obvious mid-compose. */}
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Close compose"
            className="h-9 w-9 rounded-full flex items-center justify-center text-muted-foreground/80 bg-muted/40 dark:bg-white/[0.06] border border-border/30 active:text-foreground active:bg-muted/60 transition-colors flex-shrink-0"
          >
            <X className="h-4 w-4" strokeWidth={2.4} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 px-1">
          {/* Kind segmented control — pick what we're posting. Polls and
              images compose elsewhere; this sheet handles plain text
              announcements and structured fight offers. */}
          <div className="flex bg-muted/40 dark:bg-white/[0.06] rounded-xs p-1 border border-border/40">
            <button
              type="button"
              onClick={() => setKind("text")}
              className={`flex-1 h-9 rounded-xs text-[12px] font-semibold transition-all inline-flex items-center justify-center gap-1.5 ${
                kind === "text" ? "bg-background text-foreground" : "text-muted-foreground"
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5" /> Announcement
            </button>
            <button
              type="button"
              onClick={() => setKind("fight_offer")}
              className={`flex-1 h-9 rounded-xs text-[12px] font-semibold transition-all inline-flex items-center justify-center gap-1.5 ${
                kind === "fight_offer" ? "bg-background text-primary" : "text-muted-foreground"
              }`}
            >
              <Trophy className="h-3.5 w-3.5" /> Fight offer
            </button>
          </div>

          {/* Audience segmented control */}
          <div className="flex bg-muted/40 dark:bg-white/[0.06] rounded-xs p-1 border border-border/40">
            <button
              type="button"
              onClick={() => setMode("all")}
              className={`flex-1 h-9 rounded-xs text-[12px] font-medium transition-all ${mode === "all" ? "bg-background text-foreground" : "text-muted-foreground"}`}
            >
              All athletes
            </button>
            <button
              type="button"
              onClick={() => setMode("specific")}
              className={`flex-1 h-9 rounded-xs text-[12px] font-medium transition-all ${mode === "specific" ? "bg-background text-foreground" : "text-muted-foreground"}`}
            >
              Specific
            </button>
          </div>

          {/* Athlete picker — only when specific */}
          {mode === "specific" && (
            <div className="card-surface rounded-xs border border-border overflow-hidden">
              {athletes.length === 0 ? (
                <p className="text-[12px] text-muted-foreground text-center px-3 py-4">No athletes in this gym yet.</p>
              ) : (
                <div className="divide-y divide-border/40 max-h-[40vh] overflow-y-auto">
                  {athletes.map((a) => {
                    const isSel = selected.has(a.user_id);
                    return (
                      <button
                        key={a.user_id}
                        type="button"
                        onClick={() => toggleSelected(a.user_id)}
                        className="w-full flex items-center gap-3 px-3 py-2.5 min-h-[48px] active:bg-muted/30 transition-colors text-left"
                      >
                        <AthleteAvatar avatarUrl={a.avatar_url} name={a.display_name} size={32} />
                        <span className="flex-1 text-[13px] font-medium truncate">{a.display_name}</span>
                        <span
                          className={`h-5 w-5 rounded-full border flex items-center justify-center transition-colors ${isSel ? "bg-primary border-primary" : "border-border"}`}
                          aria-hidden
                        >
                          {isSel && <Check className="h-3 w-3 text-primary-foreground" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
              {selected.size > 0 && (
                <div className="border-t border-border/40 px-3 py-2 text-[11px] text-muted-foreground">
                  {selected.size} selected
                </div>
              )}
            </div>
          )}

          {/* Media attach — shared by text and fight_offer kinds. Hidden file
              input fires the picker; once uploaded the preview lives in the
              same card so the coach can see what's been attached. */}
          <div className="card-surface rounded-xs border border-border p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
                Attach media
              </p>
              {mediaPreviewUrl ? (
                <button
                  type="button"
                  onClick={handleMediaRemove}
                  disabled={mediaUploading}
                  className="h-7 px-2 rounded-full text-muted-foreground text-[10px] font-semibold inline-flex items-center gap-1 active:text-foreground"
                >
                  <X className="h-3 w-3" /> Remove
                </button>
              ) : (
                <span className="text-[10px] text-muted-foreground/60">
                  optional · 5 MB image · 25 MB video
                </span>
              )}
            </div>

            {mediaPreviewUrl ? (
              <div className="relative w-full rounded-xs overflow-hidden bg-muted/30 border border-border/40">
                {mediaKind === "video" ? (
                  <video
                    src={mediaPreviewUrl}
                    controls
                    playsInline
                    preload="metadata"
                    className="w-full max-h-[260px] object-contain bg-black"
                  />
                ) : (
                  <img
                    src={mediaPreviewUrl}
                    alt="Attachment preview"
                    className="w-full max-h-[260px] object-contain"
                  />
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={handleMediaPick}
                disabled={mediaUploading}
                className="w-full h-12 rounded-xs border border-dashed border-border/60 bg-muted/20 text-foreground/80 text-[13px] font-medium inline-flex items-center justify-center gap-2 active:bg-muted/40 transition-colors disabled:opacity-60"
              >
                {mediaUploading ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading…
                  </>
                ) : (
                  <>
                    <ImagePlus className="h-4 w-4" />
                    <span>Add photo</span>
                    <span className="text-muted-foreground/60">or</span>
                    <Video className="h-4 w-4" />
                    <span>video</span>
                  </>
                )}
              </button>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime"
              className="hidden"
              onChange={handleMediaChange}
            />
          </div>

          {/* Fight-offer fields */}
          {kind === "fight_offer" && (
            <div className="card-surface rounded-xs border border-border p-3 space-y-2.5">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-1">
                    Fight date
                  </p>
                  <Input
                    type="date"
                    value={fightDate}
                    onChange={(e) => setFightDate(e.target.value)}
                    className="h-10 rounded-xs bg-muted/40 dark:bg-white/[0.06] border-border/40 text-[14px]"
                  />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-1">
                    Weight class (kg)
                  </p>
                  <Input
                    type="number"
                    inputMode="decimal"
                    step="0.5"
                    value={weightClassKg}
                    onChange={(e) => setWeightClassKg(e.target.value)}
                    placeholder="70.0"
                    className="h-10 rounded-xs bg-muted/40 dark:bg-white/[0.06] border-border/40 text-[14px] tabular-nums"
                  />
                </div>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-1">
                  Event
                </p>
                <Input
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  placeholder="Cage Warriors 162"
                  className="h-10 rounded-xs bg-muted/40 dark:bg-white/[0.06] border-border/40 text-[14px]"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-1">
                    Opponent
                  </p>
                  <Input
                    value={opponentName}
                    onChange={(e) => setOpponentName(e.target.value)}
                    placeholder="TBA"
                    className="h-10 rounded-xs bg-muted/40 dark:bg-white/[0.06] border-border/40 text-[14px]"
                  />
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-1">
                    Location
                  </p>
                  <Input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder="London, UK"
                    className="h-10 rounded-xs bg-muted/40 dark:bg-white/[0.06] border-border/40 text-[14px]"
                  />
                </div>
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-1">
                  Purse
                </p>
                <Input
                  value={purseText}
                  onChange={(e) => setPurseText(e.target.value)}
                  placeholder="$1,500 / TBD"
                  className="h-10 rounded-xs bg-muted/40 dark:bg-white/[0.06] border-border/40 text-[14px]"
                />
              </div>
            </div>
          )}

          {/* Body */}
          <div className="card-surface rounded-xs border border-border p-3">
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value.slice(0, MAX_BODY))}
              placeholder={
                kind === "fight_offer"
                  ? "Add a short pitch (optional) — context, expectations, anything fighters should know…"
                  : "Share a tip, schedule change, or shoutout…"
              }
              rows={kind === "fight_offer" ? 3 : 5}
              className="w-full bg-transparent text-[14px] leading-relaxed resize-none placeholder:text-muted-foreground/60 focus:outline-none"
              autoFocus={kind === "text"}
            />
            <div className="flex justify-end pt-1">
              <span className={`text-[10px] tabular-nums ${remaining < 100 ? "text-func-warning-yellow" : "text-muted-foreground/60"}`}>
                {remaining}
              </span>
            </div>
          </div>
        </div>

        {/* Secondary full-width Send so it's discoverable even if user
            scrolls down past the sticky header. */}
        <button
          type="button"
          onClick={handleSend}
          disabled={!canSend}
          className="mt-3 w-full h-11 rounded-xs bg-primary text-primary-foreground text-[14px] font-semibold active:scale-[0.98] transition-transform disabled:opacity-40 flex items-center justify-center gap-1.5 shrink-0"
        >
          {sending ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Sending…</>
          ) : (
            <><Send className="h-3.5 w-3.5" /> {kind === "fight_offer" ? "Post fight offer" : "Send announcement"}</>
          )}
        </button>
      </SheetContent>
    </Sheet>
  );
}
