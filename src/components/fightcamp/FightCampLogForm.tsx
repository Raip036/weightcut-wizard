import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { X, Mic, MicOff, Loader2, Camera, ImagePlus, Play, ChevronRight } from "lucide-react";
import { captureCameraPhoto } from "@/lib/captureCameraPhoto";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { triggerHapticSelection } from "@/lib/haptics";
import { useToast } from "@/hooks/use-toast";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { TinderMediaSwiper } from "@/components/training/TinderMediaSwiper";
import type { LightboxItem } from "@/components/training/MediaLightbox";
import {
  MARTIAL_ARTS,
  SANDC,
  REST,
  tagsForPrimary,
  sessionCategory,
  isContactSession,
  type SessionTagDef,
} from "@/lib/sessionTypes";
import { getSessionColor } from "@/lib/sessionColors";
import { SessionTypePickerSheet } from "@/components/fightcamp/SessionTypePickerSheet";

export interface PendingSessionMedia {
  /** Stable id so React doesn't recycle the wrong tile when one is removed. */
  id: string;
  file: File;
  /** `URL.createObjectURL(file)`, revoke when the entry is removed. */
  previewUrl: string;
  kind: "photo" | "video";
}

// Thin alias kept so external callers still resolve a default. Under the
// two-level model this is the PRIMARY list (martial arts + S&C + Rest);
// custom martial-art primaries are merged in at render time per-user.
const SESSION_TYPES: readonly string[] = [...MARTIAL_ARTS, SANDC, REST];

export { SESSION_TYPES };

interface FightCampLogFormProps {
  isEditing: boolean;
  userId: string | null;
  /** PRIMARY discipline (a martial art, "S&C", or "Rest"). Required. */
  sessionType: string;
  setSessionType: (v: string) => void;
  /** OPTIONAL activity tag (Sparring, Drilling, Strength, …). `null` ⇒ none. */
  sessionTag: string | null;
  setSessionTag: (v: string | null) => void;
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
  /** Techniques covered (combos / positions / drills). Separate reflection field. */
  techniquesNotes: string;
  setTechniquesNotes: (v: string) => void;
  runDistance: string;
  setRunDistance: (v: string) => void;
  runTime: string;
  setRunTime: (v: string) => void;
  runDistanceUnit: "km" | "mi";
  setRunDistanceUnit: (v: string) => void;
  runPace: string;
  /** Optional contact-round count for contact sessions (sparring / live
   *  grappling). `null` ⇒ user hasn't set a value yet. Controlled by parent. */
  rounds: number | null;
  setRounds: (v: number | null) => void;
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

export function FightCampLogForm({
  isEditing,
  userId,
  sessionType, setSessionType,
  sessionTag, setSessionTag,
  duration, setDuration,
  rpe, setRpe,
  intensityLevel, setIntensityLevel,
  hasSoreness, setHasSoreness,
  sorenessLevel, setSorenessLevel,
  notes, setNotes,
  techniquesNotes, setTechniquesNotes,
  runDistance, setRunDistance,
  runTime, setRunTime,
  runDistanceUnit, setRunDistanceUnit,
  runPace,
  rounds, setRounds,
  pendingMedia,
  onAddMedia,
  onRemoveMedia,
  existingSessionId = null,
  legacyMediaUrl = null,
  onSave,
  saving = false,
  canSave = true,
}: FightCampLogFormProps) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const { toast } = useToast();
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);

  // Existing media for the row being edited. Only run the query when we
  // have a real Convex id (UUIDs from optimistic rows would trip the
  // server validator; same guard the SessionDetailDrawer uses).
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

  // Camera tile. On native iOS/Android go through the Capacitor Camera
  // plugin (a raw `<input capture>` silently drops the file in WKWebView —
  // the root cause of media not saving from this form). On web, fall back
  // to clicking the hidden capture input, which works in a real browser.
  const handleCameraCapture = useCallback(async () => {
    triggerHapticSelection();
    if (Capacitor.isNativePlatform()) {
      const file = await captureCameraPhoto();
      if (file) handleFilePicked(file);
      return;
    }
    cameraInputRef.current?.click();
  }, [handleFilePicked]);

  // Which textarea the voice transcription should append to. Set when the
  // user taps a box's mic button, so a single recogniser instance can feed
  // either the Techniques box or the reflection box.
  const [voiceTarget, setVoiceTarget] = useState<"techniques" | "reflection">("reflection");
  // Read the live target/values via refs so the (stable) transcript handler
  // routes to the box that's actually recording without re-subscribing.
  const voiceTargetRef = useRef(voiceTarget);
  voiceTargetRef.current = voiceTarget;
  const notesRef = useRef(notes);
  notesRef.current = notes;
  const techniquesNotesRef = useRef(techniquesNotes);
  techniquesNotesRef.current = techniquesNotes;

  const handleVoiceTranscript = useCallback((text: string) => {
    if (voiceTargetRef.current === "techniques") {
      const prev = techniquesNotesRef.current;
      setTechniquesNotes(prev ? prev + " " + text : text);
    } else {
      const prev = notesRef.current;
      setNotes(prev ? prev + " " + text : text);
    }
  }, [setNotes, setTechniquesNotes]);

  const handleVoiceError = useCallback((error: string) => {
    toast({ title: "Voice Input", description: error, variant: "destructive" });
  }, [toast]);

  const { isListening, isSupported: voiceSupported, startListening, stopListening, interimText } = useSpeechRecognition({
    onTranscript: handleVoiceTranscript,
    onError: handleVoiceError,
  });

  // Tap a box's mic: if that box is already the active recording target,
  // stop; otherwise (re)start listening with that box as the target.
  const toggleVoiceFor = useCallback(
    (target: "techniques" | "reflection") => {
      triggerHapticSelection();
      if (isListening && voiceTargetRef.current === target) {
        stopListening();
        return;
      }
      setVoiceTarget(target);
      voiceTargetRef.current = target;
      if (!isListening) startListening();
    },
    [isListening, startListening, stopListening],
  );

  // Tags offered for the currently-selected primary. Drives the
  // incompatible-tag cleanup effect below + the Run-details / Rounds gating.
  const tagOptions = useMemo<SessionTagDef[]>(
    () => (sessionType ? tagsForPrimary(sessionType) : []),
    [sessionType],
  );
  const primaryKind = sessionCategory(sessionType);
  const selectedIsContact = isContactSession(sessionType, sessionTag);

  // When the chosen tag no longer applies to the selected primary's
  // category (e.g. the user switched from a martial art to S&C), drop it
  // so we never ship a "Sparring" tag on an "S&C" primary.
  useEffect(() => {
    if (sessionTag && !tagOptions.some((t) => t.id === sessionTag)) {
      setSessionTag(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [primaryKind]);

  // When the active tag isn't a contact tag, clear any stale rounds value
  // so the next save doesn't accidentally ship rounds for a `Run`.
  useEffect(() => {
    if (!selectedIsContact && rounds !== null) {
      setRounds(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionType, sessionTag, selectedIsContact]);

  const adjustDuration = (delta: number) => {
    const next = Math.max(0, (parseInt(duration) || 0) + delta);
    setDuration(String(next));
    triggerHapticSelection();
  };

  return (
    <div className="space-y-4">
      {/* ── Session type: collapsed summary row → focused picker sheet ─
          Both levels (primary discipline + optional activity tag) live
          behind one tap so the form body stays compact instead of stacking
          two pill grids. The summary shows "Discipline · Activity". */}
      <div className="space-y-2">
        <Label className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/60">
          Session type
        </Label>
        <button
          type="button"
          onClick={() => { triggerHapticSelection(); setPickerOpen(true); }}
          className="w-full flex items-center justify-between gap-3 h-12 px-4 rounded-xs bg-muted/40 dark:bg-white/[0.06] border border-border/30 active:scale-[0.99] transition-transform"
        >
          <span className="flex items-center gap-2.5 min-w-0">
            {sessionType ? (
              <>
                <span
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: getSessionColor(sessionType) }}
                />
                <span className="text-[15px] font-semibold text-foreground truncate">
                  {sessionType}
                </span>
                {sessionTag && (
                  <span className="text-[12px] font-medium text-muted-foreground truncate">
                    · {sessionTag}
                  </span>
                )}
              </>
            ) : (
              <span className="text-[15px] text-muted-foreground/60">Select session type</span>
            )}
          </span>
          <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" strokeWidth={2.2} />
        </button>
      </div>

      <SessionTypePickerSheet
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        userId={userId}
        sessionType={sessionType}
        setSessionType={setSessionType}
        sessionTag={sessionTag}
        setSessionTag={setSessionTag}
      />

      {/* ── Training metrics: single grouped card ────────────── */}
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

        {/* Rounds: only for contact sessions (sparring / live grappling).
            Optional: omit on save if untouched (handled by parent reading null). */}
        {selectedIsContact && (
          <div className="flex items-center justify-between px-4 py-3.5">
            <span
              className="text-[14px] font-medium text-foreground/85"
              title="Number of contact rounds (skip if N/A)"
            >
              Rounds
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const current = rounds ?? 5;
                  const next = Math.max(1, current - 1);
                  setRounds(next);
                  triggerHapticSelection();
                }}
                aria-label="Decrease rounds"
                className="h-8 w-8 rounded-full bg-muted/40 dark:bg-white/[0.06] border border-border/30 flex items-center justify-center text-foreground/80 active:scale-95 transition-all"
              >
                <span className="text-[16px] font-medium leading-none">−</span>
              </button>
              <span className="text-[15px] font-bold tabular-nums w-14 text-center">
                {rounds ?? 5}
                <span className="text-[11px] font-medium text-muted-foreground/60 ml-0.5">rds</span>
              </span>
              <button
                type="button"
                onClick={() => {
                  const current = rounds ?? 5;
                  const next = Math.min(20, current + 1);
                  setRounds(next);
                  triggerHapticSelection();
                }}
                aria-label="Increase rounds"
                className="h-8 w-8 rounded-full bg-muted/40 dark:bg-white/[0.06] border border-border/30 flex items-center justify-center text-foreground/80 active:scale-95 transition-all"
              >
                <span className="text-[14px] font-medium leading-none">+</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Run details (conditional): shown for the "Run" activity tag ─ */}
      {sessionTag === "Run" && (
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
              {runPace ? `${runPace} /${runDistanceUnit}` : "-"}
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

      {/* ── Techniques covered ────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/60">
            Techniques covered
          </Label>
          {voiceSupported && (
            <button
              type="button"
              onClick={() => toggleVoiceFor("techniques")}
              className={`flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] font-semibold transition-all ${
                isListening && voiceTarget === "techniques"
                  ? "bg-func-danger-red/15 text-func-danger-red animate-pulse"
                  : "bg-muted/40 dark:bg-white/[0.06] border border-border/30 text-muted-foreground active:bg-muted/60"
              }`}
            >
              {isListening && voiceTarget === "techniques" ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
              {isListening && voiceTarget === "techniques" ? "Stop" : "Voice"}
            </button>
          )}
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground/55">
          The skills you drilled. Shows up in your weekly{" "}
          <span className="font-medium text-muted-foreground/80">training summaries</span>.
        </p>
        <Textarea
          value={techniquesNotes}
          onChange={(e) => setTechniquesNotes(e.target.value)}
          placeholder={isListening && voiceTarget === "techniques" ? "Listening…" : "Combos, positions, drills you worked…"}
          className={`min-h-[88px] resize-none rounded-xs bg-muted/40 dark:bg-white/[0.06] border-border/30 text-[14px] px-4 py-3 placeholder:text-muted-foreground/50 ${isListening && voiceTarget === "techniques" ? "ring-2 ring-func-danger-red/40" : ""}`}
        />
        {isListening && voiceTarget === "techniques" && interimText && (
          <p className="text-[12px] text-muted-foreground/70 italic px-1">{interimText}</p>
        )}
      </div>

      {/* ── What went well / to improve ───────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/60">
            What went well / to improve
          </Label>
          {voiceSupported && (
            <button
              type="button"
              onClick={() => toggleVoiceFor("reflection")}
              className={`flex items-center gap-1 h-7 px-2.5 rounded-full text-[11px] font-semibold transition-all ${
                isListening && voiceTarget === "reflection"
                  ? "bg-func-danger-red/15 text-func-danger-red animate-pulse"
                  : "bg-muted/40 dark:bg-white/[0.06] border border-border/30 text-muted-foreground active:bg-muted/60"
              }`}
            >
              {isListening && voiceTarget === "reflection" ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
              {isListening && voiceTarget === "reflection" ? "Stop" : "Voice"}
            </button>
          )}
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground/55">
          What clicked and what to fix. Feeds your{" "}
          <span className="font-medium text-muted-foreground/80">Technique Mastery</span> on the Camp page.
        </p>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={isListening && voiceTarget === "reflection" ? "Listening…" : "What clicked, what to fix next time…"}
          className={`min-h-[88px] resize-none rounded-xs bg-muted/40 dark:bg-white/[0.06] border-border/30 text-[14px] px-4 py-3 placeholder:text-muted-foreground/50 ${isListening && voiceTarget === "reflection" ? "ring-2 ring-func-danger-red/40" : ""}`}
        />
        {isListening && voiceTarget === "reflection" && interimText && (
          <p className="text-[12px] text-muted-foreground/70 italic px-1">{interimText}</p>
        )}
      </div>

      {/* ── Media: horizontal strip with gallery + camera tiles ─
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
          {/* Already-saved media: tap a tile to open the Tinder swiper
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
                {/* Delete button: only available for the new
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

          {/* Newly attached (not yet uploaded) media: same shape, but
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
                onClick={() => { void handleCameraCapture(); }}
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

      {/* Tinder swiper: opens on tap of any media tile, drag horizontally
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
