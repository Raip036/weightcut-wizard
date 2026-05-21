import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Plus, X, Check, Mic, MicOff, Loader2, Camera, ImagePlus, Play } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { getCustomTypes, addCustomType, removeCustomType } from "@/lib/customSessionTypes";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { triggerHapticSelection } from "@/lib/haptics";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { TinderMediaSwiper } from "@/components/training/TinderMediaSwiper";
import type { LightboxItem } from "@/components/training/MediaLightbox";

export interface PendingSessionMedia {
  /** Stable id so React doesn't recycle the wrong tile when one is removed. */
  id: string;
  file: File;
  /** `URL.createObjectURL(file)` — revoke when the entry is removed. */
  previewUrl: string;
  kind: "photo" | "video";
}

const SESSION_TYPES = ["BJJ", "Muay Thai", "Boxing", "Wrestling", "Sparring", "Strength", "Run"];

export { SESSION_TYPES };

interface FightCampLogFormProps {
  isEditing: boolean;
  userId: string | null;
  sessionType: string;
  setSessionType: (v: string) => void;
  duration: string;
  setDuration: (v: string) => void;
  rpe: number[];
  setRpe: (v: number[]) => void;
  intensityLevel: number[];
  setIntensityLevel: (v: number[]) => void;
  hasSoreness: boolean;
  setHasSoreness: (v: boolean) => void;
  sorenessLevel: number[];
  setSorenessLevel: (v: number[]) => void;
  notes: string;
  setNotes: (v: string) => void;
  runDistance: string;
  setRunDistance: (v: string) => void;
  runTime: string;
  setRunTime: (v: string) => void;
  runDistanceUnit: "km" | "mi";
  setRunDistanceUnit: (v: string) => void;
  runPace: string;
  /** Media files queued to upload after the session is created. Capped
   *  client-side at MAX_PENDING_MEDIA so a slip of the finger doesn't
   *  fire 50 uploads. */
  pendingMedia: PendingSessionMedia[];
  onAddMedia: (file: File) => void;
  onRemoveMedia: (id: string) => void;
  /** When the user is editing an existing session, pass the row's
   *  Convex id so the form can fetch + show the media already attached
   *  to it (and let the user delete or swipe through them in-place).
   *  `null` for the create flow. */
  existingSessionId?: Id<"fight_camp_calendar"> | null;
  /** Legacy single-attachment URL stored on the row itself
   *  (`fight_camp_calendar.media_url`). Renders alongside the
   *  multi-attach `session_media` rows for backwards compat. */
  legacyMediaUrl?: string | null;
  onSave: () => void;
  saving?: boolean;
  canSave?: boolean;
}

const MAX_PENDING_MEDIA = 10;

const INPUT_CLASS =
  "h-11 rounded-xs bg-muted/40 dark:bg-white/[0.06] border-border/30 text-[15px] text-foreground placeholder:text-muted-foreground/50 px-4 focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all";

export function FightCampLogForm({
  isEditing,
  userId,
  sessionType, setSessionType,
  duration, setDuration,
  rpe, setRpe,
  intensityLevel, setIntensityLevel,
  hasSoreness, setHasSoreness,
  sorenessLevel, setSorenessLevel,
  notes, setNotes,
  runDistance, setRunDistance,
  runTime, setRunTime,
  runDistanceUnit, setRunDistanceUnit,
  runPace,
  pendingMedia,
  onAddMedia,
  onRemoveMedia,
  existingSessionId = null,
  legacyMediaUrl = null,
  onSave,
  saving = false,
  canSave = true,
}: FightCampLogFormProps) {
  const [customTypes, setCustomTypes] = useState<string[]>([]);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const { toast } = useToast();
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  // Existing media for the row being edited. Only run the query when we
  // have a real Convex id (UUIDs from optimistic rows would trip the
  // server validator — same guard the SessionDetailDrawer uses).
  const existingIdIsConvex =
    !!existingSessionId && !String(existingSessionId).includes("-");
  const savedMedia = useQuery(
    api.fight_camp.listSessionMedia,
    existingIdIsConvex
      ? { sessionId: existingSessionId as Id<"fight_camp_calendar"> }
      : "skip",
  );
  const removeSessionMediaMut = useMutation(api.fight_camp.removeSessionMedia);

  // Tinder swiper state. `swiperStart` is the index in the combined
  // existing+pending list the user tapped on; the swiper renders the
  // whole list so they can swipe through everything in one go.
  const [swiperStart, setSwiperStart] = useState<number | null>(null);

  // Build the unified list the swiper renders. Order: legacy single
  // media → already-uploaded `session_media` rows (oldest first) →
  // pending unsaved attachments. The swipe model treats them as one
  // continuous deck.
  const swiperItems: LightboxItem[] = useMemo(() => {
    const items: LightboxItem[] = [];
    if (legacyMediaUrl) {
      items.push({
        id: `legacy-${existingSessionId ?? "row"}`,
        url: legacyMediaUrl,
        kind: /\.(mp4|mov|webm|m4v)(\?|$)/i.test(legacyMediaUrl) ? "video" : "photo",
        caption: null,
        sessionType: sessionType || null,
      });
    }
    for (const m of savedMedia ?? []) {
      items.push({
        id: m.id as unknown as string,
        url: m.url ?? null,
        kind: m.kind,
        caption: m.caption,
        capturedAt: m.capturedAt,
        sessionType: sessionType || null,
      });
    }
    for (const m of pendingMedia) {
      items.push({
        id: `pending-${m.id}`,
        url: m.previewUrl,
        kind: m.kind,
        caption: null,
        sessionType: sessionType || null,
      });
    }
    return items;
  }, [legacyMediaUrl, savedMedia, pendingMedia, existingSessionId, sessionType]);

  const handleDeleteSavedMedia = useCallback(
    async (mediaId: string) => {
      try {
        await removeSessionMediaMut({ mediaId: mediaId as Id<"session_media"> });
        triggerHapticSelection();
      } catch (err: any) {
        toast({
          title: "Couldn't delete",
          description: err?.message ?? "Try again.",
          variant: "destructive",
        });
      }
    },
    [removeSessionMediaMut, toast],
  );

  // Centralised file-pick handler so both the gallery + camera inputs
  // share the same validation, haptic, and "10 attachment" cap.
  const handleFilePicked = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      if (pendingMedia.length >= MAX_PENDING_MEDIA) {
        toast({
          title: "Up to 10 clips per session",
          description: "Save this session first, then add more later.",
          variant: "destructive",
        });
        return;
      }
      const isMedia =
        file.type.startsWith("image/") || file.type.startsWith("video/");
      if (!isMedia) {
        toast({
          title: "Photos and videos only",
          description: "Pick an image or video file.",
          variant: "destructive",
        });
        return;
      }
      triggerHapticSelection();
      onAddMedia(file);
    },
    [pendingMedia.length, onAddMedia, toast],
  );

  const handleVoiceTranscript = useCallback((text: string) => {
    setNotes(notes ? notes + " " + text : text);
  }, [notes, setNotes]);

  const handleVoiceError = useCallback((error: string) => {
    toast({ title: "Voice Input", description: error, variant: "destructive" });
  }, [toast]);

  const { isListening, isSupported: voiceSupported, startListening, stopListening, interimText } = useSpeechRecognition({
    onTranscript: handleVoiceTranscript,
    onError: handleVoiceError,
  });

  useEffect(() => {
    if (userId) setCustomTypes(getCustomTypes(userId));
  }, [userId]);

  const allTypes = [...SESSION_TYPES, ...customTypes];
  const hasLegacyType = sessionType && !allTypes.includes(sessionType);
  const displayTypes = hasLegacyType ? [...allTypes, sessionType] : allTypes;

  const handleAddCustomType = () => {
    const trimmed = newTypeName.trim();
    if (!trimmed || !userId) return;
    if (allTypes.includes(trimmed)) return;
    const updated = addCustomType(userId, trimmed);
    setCustomTypes(updated);
    setSessionType(trimmed);
    setNewTypeName("");
    setIsAddingNew(false);
  };

  const handleRemoveCustomType = (type: string) => {
    if (!userId) return;
    const updated = removeCustomType(userId, type);
    setCustomTypes(updated);
    if (sessionType === type) {
      setSessionType(SESSION_TYPES[0]);
    }
  };

  const adjustDuration = (delta: number) => {
    const next = Math.max(0, (parseInt(duration) || 0) + delta);
    setDuration(String(next));
    triggerHapticSelection();
  };

  return (
    <div className="space-y-4">
      {/* ── Session Type — horizontal scrolling chip rail ──────── */}
      <div className="space-y-2">
        <Label className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/60">
          Session type
        </Label>
        <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden snap-x">
          {displayTypes.map((type) => {
            const active = sessionType === type;
            const isCustom = customTypes.includes(type);
            return (
              <div key={type} className="relative shrink-0 snap-start">
                <button
                  type="button"
                  onClick={() => { setSessionType(type); triggerHapticSelection(); }}
                  className={`h-10 px-4 rounded-full text-[13.5px] font-semibold transition-all active:scale-[0.96] ${
                    active
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "bg-muted/40 dark:bg-white/[0.06] border border-border/30 text-foreground/80 hover:bg-muted/60"
                  } ${isCustom ? "pr-7" : ""}`}
                >
                  {type}
                </button>
                {isCustom && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleRemoveCustomType(type); }}
                    aria-label={`Remove ${type}`}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-background/40 flex items-center justify-center text-muted-foreground/60 active:text-destructive transition-colors"
                  >
                    <X className="h-3 w-3" strokeWidth={2.4} />
                  </button>
                )}
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => setIsAddingNew(!isAddingNew)}
            aria-label="Add custom type"
            className="shrink-0 snap-start h-10 w-10 rounded-full bg-muted/40 dark:bg-white/[0.06] border border-border/30 flex items-center justify-center active:scale-[0.96] transition-transform"
          >
            <Plus className="h-4 w-4 text-foreground/70" strokeWidth={2.4} />
          </button>
        </div>

        {isAddingNew && (
          <div className="flex gap-2 mt-2">
            <Input
              placeholder="e.g. Swimming, Yoga…"
              value={newTypeName}
              onChange={(e) => setNewTypeName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAddCustomType(); }}
              className={`${INPUT_CLASS} flex-1`}
              autoFocus
            />
            <button
              type="button"
              onClick={handleAddCustomType}
              disabled={!newTypeName.trim()}
              aria-label="Confirm new type"
              className="h-11 w-11 rounded-xs bg-primary/15 hover:bg-primary/25 text-primary flex items-center justify-center shrink-0 active:scale-[0.96] transition-transform disabled:opacity-40"
            >
              <Check className="h-4 w-4" strokeWidth={2.6} />
            </button>
          </div>
        )}
      </div>

      {/* ── Training metrics — single grouped card ────────────── */}
      <div className="card-surface rounded-xs divide-y divide-border/15 overflow-hidden">
        {/* Duration */}
        <div className="flex items-center justify-between px-4 py-3.5">
          <span className="text-[14px] font-medium text-foreground/85">Duration</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => adjustDuration(-5)}
              className="h-8 w-8 rounded-full bg-muted/40 dark:bg-white/[0.06] border border-border/30 flex items-center justify-center text-foreground/80 active:scale-95 transition-all"
              aria-label="Decrease duration"
            >
              <span className="text-[16px] font-medium leading-none">−</span>
            </button>
            <span className="text-[15px] font-bold tabular-nums w-14 text-center">
              {duration}
              <span className="text-[11px] font-medium text-muted-foreground/60 ml-0.5">min</span>
            </span>
            <button
              type="button"
              onClick={() => adjustDuration(5)}
              className="h-8 w-8 rounded-full bg-muted/40 dark:bg-white/[0.06] border border-border/30 flex items-center justify-center text-foreground/80 active:scale-95 transition-all"
              aria-label="Increase duration"
            >
              <span className="text-[14px] font-medium leading-none">+</span>
            </button>
          </div>
        </div>

        {/* Intensity */}
        <div className="px-4 py-3.5 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[14px] font-medium text-foreground/85">Intensity</span>
            <span className="text-[14px] font-bold tabular-nums">
              {intensityLevel[0]}<span className="text-muted-foreground/50 font-medium">/5</span>
            </span>
          </div>
          <Slider value={intensityLevel} onValueChange={setIntensityLevel} max={5} min={1} step={1} />
          <div className="flex justify-between text-[10px] font-medium text-muted-foreground/60 pt-0.5">
            <span>Easy</span>
            <span>Mod</span>
            <span>Max</span>
          </div>
        </div>

        {/* RPE */}
        <div className="px-4 py-3.5 space-y-2">
          <div className="flex justify-between items-center">
            <span className="text-[14px] font-medium text-foreground/85">RPE</span>
            <span className="text-[14px] font-bold tabular-nums">
              {rpe[0]}<span className="text-muted-foreground/50 font-medium">/10</span>
            </span>
          </div>
          <Slider value={rpe} onValueChange={setRpe} max={10} min={1} step={1} />
          <div className="flex justify-between text-[10px] font-medium text-muted-foreground/60 pt-0.5">
            <span>Light</span>
            <span>Max</span>
          </div>
        </div>
      </div>

      {/* ── Run details (conditional) ─────────────────────────── */}
      {sessionType === "Run" && (
        <div className="card-surface rounded-xs divide-y divide-border/15 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3.5">
            <span className="text-[14px] font-medium text-foreground/85">Distance</span>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                value={runDistance}
                onChange={(e) => setRunDistance(e.target.value)}
                placeholder="0"
                className="w-20 h-9 rounded-xs text-right text-[14px] font-bold tabular-nums bg-muted/40 dark:bg-white/[0.06] border-border/30 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <button
                type="button"
                onClick={() => setRunDistanceUnit(runDistanceUnit === "km" ? "mi" : "km")}
                className="h-9 px-3 rounded-full bg-muted/40 dark:bg-white/[0.06] border border-border/30 text-[12px] font-semibold active:scale-95 transition-transform min-w-[44px]"
              >
                {runDistanceUnit}
              </button>
            </div>
          </div>
          <div className="flex items-center justify-between px-4 py-3.5">
            <span className="text-[14px] font-medium text-foreground/85">Time</span>
            <Input
              type="text"
              inputMode="numeric"
              value={runTime}
              onChange={(e) => setRunTime(e.target.value)}
              placeholder="mm:ss"
              className="w-24 h-9 rounded-xs text-right text-[14px] font-bold tabular-nums bg-muted/40 dark:bg-white/[0.06] border-border/30"
            />
          </div>
          <div className="flex items-center justify-between px-4 py-3.5">
            <span className="text-[14px] font-medium text-foreground/85">Pace</span>
            <span className="text-[13px] font-semibold text-foreground/70 tabular-nums">
              {runPace ? `${runPace} /${runDistanceUnit}` : "—"}
            </span>
          </div>
        </div>
      )}

      {/* ── Recovery (soreness) ───────────────────────────────── */}
      <div className="card-surface rounded-xs overflow-hidden">
        <div className="px-4 py-3.5">
          <div className="flex items-center justify-between">
            <span className="text-[14px] font-medium text-foreground/85">Soreness</span>
            <Switch checked={hasSoreness} onCheckedChange={setHasSoreness} />
          </div>
          {hasSoreness && (
            <div className="pt-3 space-y-2">
              <div className="flex justify-between items-center">
                <span className="text-[12px] text-muted-foreground/70 font-medium">Level</span>
                <span className="text-[14px] font-bold tabular-nums">
                  {sorenessLevel[0]}<span className="text-muted-foreground/50 font-medium">/10</span>
                </span>
              </div>
              <Slider value={sorenessLevel} onValueChange={setSorenessLevel} max={10} min={1} step={1} />
            </div>
          )}
        </div>
      </div>

      {/* ── Notes ─────────────────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/60">
            Notes
          </Label>
          {voiceSupported && (
            <button
              type="button"
              onClick={() => { triggerHapticSelection(); isListening ? stopListening() : startListening(); }}
              className={`flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] font-semibold transition-all ${
                isListening
                  ? "bg-func-danger-red/15 text-func-danger-red animate-pulse"
                  : "bg-muted/40 dark:bg-white/[0.06] border border-border/30 text-muted-foreground active:bg-muted/60"
              }`}
            >
              {isListening ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
              {isListening ? "Stop" : "Voice"}
            </button>
          )}
        </div>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={isListening ? "Listening…" : "Techniques, drills, anything worth remembering…"}
          className={`min-h-[88px] resize-none rounded-xs bg-muted/40 dark:bg-white/[0.06] border-border/30 text-[14px] px-4 py-3 placeholder:text-muted-foreground/50 ${isListening ? "ring-2 ring-func-danger-red/40" : ""}`}
        />
        {isListening && interimText && (
          <p className="text-[12px] text-muted-foreground/70 italic px-1">{interimText}</p>
        )}
      </div>

      {/* ── Media — horizontal strip with gallery + camera tiles ─
          Pattern from the brainstorm: zero vertical cost when empty,
          scrolls cleanly up to MAX_PENDING_MEDIA tiles. Files are held
          in memory and uploaded after the session insert succeeds, so
          tapping Cancel never leaves orphan storage objects. */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/60">
            Media
          </Label>
          {pendingMedia.length > 0 && (
            <span className="text-[10px] font-medium text-muted-foreground/70 tabular-nums">
              {pendingMedia.length} / {MAX_PENDING_MEDIA}
            </span>
          )}
        </div>

        <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1 pb-1">
          {/* Already-saved media — tap a tile to open the Tinder swiper
              starting on it. The X button calls removeSessionMedia and
              the row disappears as soon as the Convex query reflects the
              delete (no optimistic state needed; the query is reactive). */}
          {swiperItems
            .filter((item) => !item.id.startsWith("pending-"))
            .map((item, i) => (
              <div
                key={item.id}
                className="relative shrink-0 h-20 w-20 rounded-xs overflow-hidden border border-border/30 bg-muted/30"
              >
                <button
                  type="button"
                  onClick={() => {
                    triggerHapticSelection();
                    setSwiperStart(i);
                  }}
                  className="block h-full w-full active:scale-[0.97] transition-transform"
                  aria-label="Open media swiper"
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
                          <div className="h-7 w-7 rounded-full bg-black/55 backdrop-blur flex items-center justify-center">
                            <Play className="h-3 w-3 text-white fill-white" />
                          </div>
                        </div>
                      </>
                    ) : (
                      <img
                        src={item.url}
                        alt={item.caption ?? "Saved media"}
                        className="w-full h-full object-cover"
                        loading="lazy"
                      />
                    )
                  ) : (
                    <div className="w-full h-full" />
                  )}
                </button>
                {/* Delete button — only available for the new
                    `session_media` rows. Legacy single-media is cleared
                    by saving the row without media via the edit form,
                    so we don't expose a delete X for that one tile. */}
                {!item.id.startsWith("legacy-") && (
                  <button
                    type="button"
                    onClick={() => {
                      triggerHapticSelection();
                      void handleDeleteSavedMedia(item.id);
                    }}
                    aria-label="Delete media"
                    className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/65 backdrop-blur text-white flex items-center justify-center active:scale-90 transition-transform"
                  >
                    <X className="h-3 w-3" strokeWidth={2.5} />
                  </button>
                )}
              </div>
            ))}

          {/* Newly attached (not yet uploaded) media — same shape, but
              the X button removes from the in-memory queue rather than
              hitting the backend. */}
          {pendingMedia.map((m) => {
            const swiperIndex = swiperItems.findIndex(
              (it) => it.id === `pending-${m.id}`,
            );
            return (
            <div
              key={m.id}
              className="relative shrink-0 h-20 w-20 rounded-xs overflow-hidden border border-border/30 bg-muted/30 animate-in fade-in zoom-in-95 duration-200"
            >
              <button
                type="button"
                onClick={() => {
                  triggerHapticSelection();
                  if (swiperIndex >= 0) setSwiperStart(swiperIndex);
                }}
                className="block h-full w-full active:scale-[0.97] transition-transform"
                aria-label="Open media swiper"
              >
                {m.kind === "video" ? (
                  <>
                    <video
                      src={m.previewUrl}
                      className="w-full h-full object-cover"
                      muted
                      playsInline
                      preload="metadata"
                    />
                    <div className="absolute inset-0 flex items-center justify-center bg-black/15">
                      <div className="h-7 w-7 rounded-full bg-black/55 backdrop-blur flex items-center justify-center">
                        <Play className="h-3 w-3 text-white fill-white" />
                      </div>
                    </div>
                  </>
                ) : (
                  <img
                    src={m.previewUrl}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  triggerHapticSelection();
                  onRemoveMedia(m.id);
                }}
                aria-label="Remove media"
                className="absolute top-1 right-1 h-5 w-5 rounded-full bg-black/65 backdrop-blur text-white flex items-center justify-center active:scale-90 transition-transform"
              >
                <X className="h-3 w-3" strokeWidth={2.5} />
              </button>
            </div>
            );
          })}

          {pendingMedia.length < MAX_PENDING_MEDIA && (
            <>
              <button
                type="button"
                onClick={() => {
                  triggerHapticSelection();
                  galleryInputRef.current?.click();
                }}
                aria-label="Add from gallery"
                className="shrink-0 h-20 w-20 rounded-xs border-2 border-dashed border-border/40 bg-muted/20 flex flex-col items-center justify-center text-muted-foreground active:bg-muted/40 transition-colors"
              >
                <ImagePlus className="h-5 w-5" />
                <span className="text-[9px] font-semibold uppercase tracking-wider mt-0.5">
                  Gallery
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  triggerHapticSelection();
                  cameraInputRef.current?.click();
                }}
                aria-label="Take photo or video"
                className="shrink-0 h-20 w-20 rounded-xs border-2 border-dashed border-border/40 bg-muted/20 flex flex-col items-center justify-center text-muted-foreground active:bg-muted/40 transition-colors"
              >
                <Camera className="h-5 w-5" />
                <span className="text-[9px] font-semibold uppercase tracking-wider mt-0.5">
                  Camera
                </span>
              </button>
            </>
          )}
        </div>

        {/* Hidden inputs. `accept` covers gallery, plus `capture` on the
            second input opens the device camera directly on iOS. */}
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            handleFilePicked(f);
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
            handleFilePicked(f);
          }}
        />
      </div>

      {/* Tinder swiper — opens on tap of any media tile, drag horizontally
          to flip through the deck, vertical/Esc to dismiss. Mounts items
          in the same order the strip shows them so tap → swipe lands on
          the exact tile the user picked. */}
      <TinderMediaSwiper
        items={swiperItems}
        startIndex={swiperStart ?? 0}
        open={swiperStart !== null}
        onClose={() => setSwiperStart(null)}
      />

      {/* ── Save ──────────────────────────────────────────────── */}
      <button
        type="button"
        onClick={onSave}
        disabled={saving || !canSave}
        className="w-full h-12 rounded-xs bg-primary text-primary-foreground text-[15px] font-semibold active:scale-[0.98] transition-transform flex items-center justify-center gap-2 disabled:opacity-40 disabled:active:scale-100"
      >
        {saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {saving
          ? (isEditing ? "Updating…" : pendingMedia.length > 0 ? `Saving + uploading ${pendingMedia.length}…` : "Saving…")
          : !canSave
            ? "Loading account…"
            : (isEditing ? "Update session" : pendingMedia.length > 0 ? `Save with ${pendingMedia.length} media` : "Save session")}
      </button>
    </div>
  );
}
