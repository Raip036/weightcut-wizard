import { useRef, useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { useFightCampCoach } from "@/contexts/FightCampCoachContext";
import { useUser } from "@/contexts/UserContext";
import { Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import { triggerHapticSelection, triggerHapticSuccess, triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { Orb } from "@/components/chat/Orb";
import { CoachBlocks } from "@/components/fightcamp/CoachBlocks";
import { CoachCockpitHeader } from "@/components/fightcamp/cockpit/CoachCockpitHeader";
import { AdaptiveChips } from "@/components/fightcamp/cockpit/AdaptiveChips";
import { CoachThinkingState } from "@/components/fightcamp/cockpit/CoachThinkingState";
import { CoachSpeechBubble } from "@/components/fightcamp/cockpit/CoachSpeechBubble";
import { CoachProGate } from "@/components/subscription/CoachProGate";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { api } from "@/../convex/_generated/api";
import type { LogAction } from "@/../convex/_shared/aiSchemas";

/* FAB rendered at 64px so the orb reads at a glance.
   Keep in sync with the `w-16 h-16` Tailwind utility on the button —
   this constant drives the snap/drag math, the className drives the visual. */
const FAB_SIZE = 64;
const EDGE_MARGIN = 16;
const SNAP_SPRING = "transform 0.35s cubic-bezier(0.25, 1, 0.5, 1)";
const FAB_POS_KEY = "wcw_fab_position";

function loadSavedPosition(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(FAB_POS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/* ── Coach bubble anti-annoyance frequency engine ─────────────────────────────
   The bubble used to re-appear on every load (single 4h dismiss cooldown). The
   engine below keeps it from nagging:
     • once per browser session (sessionStorage)
     • per-message cooldown after an outcome (dismiss 8h / chat 8h / act 24h /
       auto-collapse "ignore" 2h), keyed by message hash so the SAME nudge
       won't repeat
     • hard daily cap (3) — red flags are exempt for safety and also bypass the
       session + daily limits (but are still deduped by hash)
   The bubble also auto-collapses after a short peek so it never sits there. */
const BUBBLE_STATE_KEY = "wcw_bubble_state";
const BUBBLE_SESSION_KEY = "wcw_bubble_session_shown";
const BUBBLE_DAILY_CAP = 3;
const HOUR_MS = 60 * 60 * 1000;
const BUBBLE_COOLDOWN_MS: Record<"dismiss" | "act" | "chat" | "ignore", number> = {
  dismiss: 8 * HOUR_MS,
  act: 24 * HOUR_MS,
  chat: 8 * HOUR_MS,
  ignore: 2 * HOUR_MS,
};
const BUBBLE_AUTO_COLLAPSE_MS = 10_000;

type BubbleState = { until: number; lastHash: string; day: string; count: number };

function bubbleDayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function hashText(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return String(h);
}

function readBubbleState(): BubbleState {
  try {
    const raw = localStorage.getItem(BUBBLE_STATE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return {
        until: Number(p.until) || 0,
        lastHash: String(p.lastHash || ""),
        day: String(p.day || ""),
        count: Number(p.count) || 0,
      };
    }
  } catch { /* ignore */ }
  return { until: 0, lastHash: "", day: "", count: 0 };
}

function writeBubbleState(s: BubbleState): void {
  try { localStorage.setItem(BUBBLE_STATE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

/** Decide whether a freshly-derived nudge is allowed to show right now. */
function canShowBubble(hash: string, isRedFlag: boolean): boolean {
  const st = readBubbleState();
  const now = Date.now();
  // Same message still cooling down → never (applies to red flags too).
  if (st.lastHash === hash && now < st.until) return false;
  // Red flags are safety-critical: bypass session + daily caps.
  if (isRedFlag) return true;
  try { if (sessionStorage.getItem(BUBBLE_SESSION_KEY)) return false; } catch { /* ignore */ }
  if (st.day === bubbleDayKey() && st.count >= BUBBLE_DAILY_CAP) return false;
  return true;
}

/** Record that a nudge was shown (session flag + daily counter). */
function recordBubbleShown(): void {
  try { sessionStorage.setItem(BUBBLE_SESSION_KEY, "1"); } catch { /* ignore */ }
  const st = readBubbleState();
  const day = bubbleDayKey();
  writeBubbleState({ ...st, day, count: st.day === day ? st.count + 1 : 1 });
}

/** Record the user's response so the same nudge cools down accordingly. */
function recordBubbleOutcome(hash: string, kind: keyof typeof BUBBLE_COOLDOWN_MS): void {
  const st = readBubbleState();
  writeBubbleState({ ...st, lastHash: hash, until: Date.now() + BUBBLE_COOLDOWN_MS[kind] });
}

export function FloatingWizardChat() {
  const { messages, isLoading, sendMessage, clearChat } = useFightCampCoach();
  const { userId } = useUser();
  const navigate = useNavigate();
  const prefersReduced = useReducedMotion();

  // FREE-vs-PRO split. Pro users get the full chat; free users open the coach
  // and land on the engaging <CoachProGate /> — the gate owns its own paywall
  // CTA and contextual briefing line. Free users cannot type at all (the whole
  // composer is unmounted for them).
  const { hasAccess } = useFeatureAccess("AI_FIGHT_CAMP_COACH");

  // Proactive cockpit read — powers the pinned header + adaptive chips. Loading
  // (`undefined`) is treated as null so children render their no-data fallback.
  // Skipped when unauthenticated so the component renders safely before login.
  const cockpit = useQuery(api.coachCockpit.getCockpit, userId ? {} : "skip");
  const cockpitData = cockpit ?? null;

  // Proactive speech bubble off the orb (chat closed) — surfaces the coach's
  // current read (red flag / priority action / greeting) as a tutorial-style
  // nudge to tap the orb. Position follows the orb's snapped edge via `fabPos`.
  const briefing = useQuery(api.coachBriefing.getBriefing, userId ? {} : "skip");
  const bubbleText = useMemo(() => {
    const raw = briefing ? briefing.redFlag || briefing.priorityAction || briefing.greeting : null;
    if (!raw) return null;
    // No em/en dashes in the bubble — swap for a comma so it reads naturally.
    const cleaned = raw.replace(/\s*[—–]\s*/g, ", ").trim();
    return cleaned.length > 130 ? `${cleaned.slice(0, 127)}...` : cleaned;
  }, [briefing]);
  // Tier drives the bubble's accent; action is the context-aware CTA (or null
  // for a bare greeting → "Chat").
  const bubbleTier: "redFlag" | "priority" | "greeting" = briefing?.redFlag
    ? "redFlag"
    : briefing?.priorityAction
      ? "priority"
      : "greeting";
  const bubbleAction = briefing?.action ?? null;
  const [fabPos, setFabPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [bubbleReady, setBubbleReady] = useState(false);
  const [bubbleVisible, setBubbleVisible] = useState(false);
  const bubbleDecidedRef = useRef(false);
  const bubbleHashRef = useRef("");
  const autoCollapseRef = useRef<number | null>(null);

  const [open, setOpen] = useState(false);
  const [tutorialPulse, setTutorialPulse] = useState(false);
  const [input, setInput] = useState("");
  const [inputFocused, setInputFocused] = useState(false);
  /* Captured FAB centre at the moment of open — used as the
     transform-origin so the panel blooms from the orb. */
  const [originPoint, setOriginPoint] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Drag state — all refs for 60fps performance (no React re-renders during drag)
  const fabRef = useRef<HTMLButtonElement>(null);
  const dragState = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    startTouchX: 0,
    startTouchY: 0,
    moved: false,
  });
  const posRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Tutorial event listeners — pulse the orb or open the panel.
  useEffect(() => {
    const onPulse = () => setTutorialPulse(true);
    const onOpen = () => setOpen(true);
    window.addEventListener("tutorial:pulse-wizard-chat", onPulse);
    window.addEventListener("tutorial:open-wizard-chat", onOpen);
    return () => {
      window.removeEventListener("tutorial:pulse-wizard-chat", onPulse);
      window.removeEventListener("tutorial:open-wizard-chat", onOpen);
    };
  }, []);

  // Initialize + restore position (runs on mount AND when chat closes)
  useEffect(() => {
    if (open) return; // Don't reposition while chat is open
    const saved = loadSavedPosition();
    const defaultY = window.innerHeight - FAB_SIZE - 88 - 20;
    if (saved) {
      posRef.current = { x: Math.min(saved.x, window.innerWidth - FAB_SIZE - EDGE_MARGIN), y: Math.min(saved.y, defaultY) };
    } else if (posRef.current.x === 0 && posRef.current.y === 0) {
      posRef.current = { x: window.innerWidth - FAB_SIZE - EDGE_MARGIN, y: defaultY };
    }
    if (fabRef.current) {
      fabRef.current.style.transition = "none";
      fabRef.current.style.transform = `translate(${posRef.current.x}px, ${posRef.current.y}px)`;
    }
    setFabPos({ ...posRef.current });
  }, [open]);

  // Only surface after a short beat so it reads as a deliberate nudge rather
  // than a flash on load.
  useEffect(() => {
    const t = window.setTimeout(() => setBubbleReady(true), 1400);
    return () => {
      window.clearTimeout(t);
      if (autoCollapseRef.current) window.clearTimeout(autoCollapseRef.current);
    };
  }, []);

  // Decide ONCE whether to show the nudge (anti-annoyance engine). Runs when the
  // briefing text first resolves. If shown, it auto-collapses after a peek so it
  // never sits there nagging.
  useEffect(() => {
    if (!bubbleReady || !bubbleText || bubbleDecidedRef.current) return;
    bubbleDecidedRef.current = true;
    const hash = hashText(bubbleText);
    bubbleHashRef.current = hash;
    if (canShowBubble(hash, bubbleTier === "redFlag")) {
      setBubbleVisible(true);
      recordBubbleShown();
      autoCollapseRef.current = window.setTimeout(() => {
        setBubbleVisible(false);
        recordBubbleOutcome(hash, "ignore");
      }, BUBBLE_AUTO_COLLAPSE_MS);
    }
  }, [bubbleReady, bubbleText, bubbleTier]);

  // Keep the bubble anchored to the orb across viewport changes (rotate/resize).
  useEffect(() => {
    const onResize = () => setFabPos({ ...posRef.current });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const snapToEdge = useCallback(() => {
    const el = fabRef.current;
    if (!el) return;
    const { x, y } = posRef.current;
    const midX = window.innerWidth / 2;
    const snappedX = x + FAB_SIZE / 2 < midX ? EDGE_MARGIN : window.innerWidth - FAB_SIZE - EDGE_MARGIN;
    const clampedY = Math.max(60, Math.min(y, window.innerHeight - FAB_SIZE - 80));
    posRef.current = { x: snappedX, y: clampedY };
    el.style.transition = SNAP_SPRING;
    el.style.transform = `translate(${snappedX}px, ${clampedY}px)`;
    setFabPos({ x: snappedX, y: clampedY });
    try { localStorage.setItem(FAB_POS_KEY, JSON.stringify(posRef.current)); } catch { /* ignore */ }
    setTimeout(() => { if (el) el.style.transition = "none"; }, 350);
  }, []);

  const handleFabPress = useCallback(() => {
    triggerHapticSelection();
    // Capture FAB centre as bloom origin BEFORE we hide the button.
    setOriginPoint({
      x: posRef.current.x + FAB_SIZE / 2,
      y: posRef.current.y + FAB_SIZE / 2,
    });
    setOpen(true);
  }, []);

  // Coach-bubble responses — each clears the auto-collapse timer, hides the
  // bubble, and records the outcome so the same nudge cools down accordingly.
  const clearAutoCollapse = useCallback(() => {
    if (autoCollapseRef.current) {
      window.clearTimeout(autoCollapseRef.current);
      autoCollapseRef.current = null;
    }
  }, []);

  const dismissBubble = useCallback(() => {
    clearAutoCollapse();
    setBubbleVisible(false);
    recordBubbleOutcome(bubbleHashRef.current, "dismiss");
  }, [clearAutoCollapse]);

  const chatFromBubble = useCallback(() => {
    clearAutoCollapse();
    setBubbleVisible(false);
    recordBubbleOutcome(bubbleHashRef.current, "chat");
    handleFabPress();
  }, [clearAutoCollapse, handleFabPress]);

  const actFromBubble = useCallback(() => {
    clearAutoCollapse();
    setBubbleVisible(false);
    recordBubbleOutcome(bubbleHashRef.current, "act");
    triggerHapticSelection();
    if (bubbleAction) navigate(bubbleAction.route);
  }, [clearAutoCollapse, bubbleAction, navigate]);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    const { x, y } = posRef.current;
    dragState.current = { isDragging: true, startX: x, startY: y, startTouchX: touch.clientX, startTouchY: touch.clientY, moved: false };
    setDragging(true);
    if (fabRef.current) {
      fabRef.current.style.transition = "none";
      fabRef.current.style.transform = `translate(${x}px, ${y}px) scale(1.08)`;
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!dragState.current.isDragging) return;
    const touch = e.touches[0];
    const dx = touch.clientX - dragState.current.startTouchX;
    const dy = touch.clientY - dragState.current.startTouchY;
    if (Math.abs(dx) > 6 || Math.abs(dy) > 6) dragState.current.moved = true;
    const nx = Math.max(0, Math.min(dragState.current.startX + dx, window.innerWidth - FAB_SIZE));
    const ny = Math.max(40, Math.min(dragState.current.startY + dy, window.innerHeight - FAB_SIZE - 60));
    posRef.current = { x: nx, y: ny };
    if (fabRef.current) fabRef.current.style.transform = `translate(${nx}px, ${ny}px) scale(1.08)`;
  }, []);

  const handleTouchEnd = useCallback(() => {
    if (!dragState.current.isDragging) return;
    dragState.current.isDragging = false;
    setDragging(false);
    if (fabRef.current) fabRef.current.style.transform = `translate(${posRef.current.x}px, ${posRef.current.y}px) scale(1)`;
    if (!dragState.current.moved) {
      // Tap — open chat
      handleFabPress();
    } else {
      // Drag ended — snap to nearest edge
      triggerHaptic(ImpactStyle.Light);
      snapToEdge();
    }
  }, [snapToEdge, handleFabPress]);

  // Auto-scroll on new messages. For assistant replies, show the top of the new
  // message; for user sends / loading, stay at the bottom.
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg && lastMsg.role === "assistant" && !isLoading) {
      const lastEl = container.querySelector<HTMLElement>(
        `[data-msg-idx="${messages.length - 1}"]`
      );
      if (lastEl) {
        container.scrollTop = Math.max(0, lastEl.offsetTop - container.offsetTop - 8);
        return;
      }
    }
    container.scrollTop = container.scrollHeight;
  }, [messages, isLoading]);

  const handleClearChat = () => {
    triggerHapticSelection();
    clearChat();
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    // Free users never reach the composer (it's unmounted), but guard anyway.
    if (!hasAccess) return;
    if (!input.trim() || isLoading) return;

    triggerHapticSelection();
    const currentInput = input;
    setInput("");
    await sendMessage(currentInput);
    triggerHapticSuccess();
  };

  const handleSuggestion = async (prompt: string) => {
    // Free users never see chips (gate replaces the body), but guard anyway.
    if (!hasAccess) return;
    if (isLoading) return;
    triggerHapticSelection();
    await sendMessage(prompt);
    triggerHapticSuccess();
  };

  // Wire structured-block CTAs to the existing log/plan flows. Minimal v1:
  // navigate to the relevant screen. Phase 3+ can deep-link with the
  // suggested values pre-filled.
  const handleCoachAction = useCallback(
    (action: LogAction) => {
      triggerHapticSelection();
      switch (action.kind) {
        case "log_weight":
          navigate("/weight");
          break;
        case "log_fluid":
        case "open_plan":
        case "open_rehydration":
          navigate("/weight-protocol");
          break;
        default:
          // Forward-compatible: unknown actions from a newer server are no-ops.
          break;
      }
      setOpen(false);
    },
    [navigate],
  );

  // Show starter chips only on a fresh conversation — i.e. before the user
  // has sent anything (the coach's greeting is the sole message).
  const showStarters = !isLoading && !messages.some((m) => m.role === "user");

  // Orb state mirrors chat lifecycle: thinking while streaming, listening when
  // the composer is focused, otherwise idle.
  const orbState: "idle" | "listening" | "thinking" = isLoading
    ? "thinking"
    : inputFocused
      ? "listening"
      : "idle";

  return (
    <>
      {/* Floating button — draggable on touch (iOS), click-to-open on desktop.
          Always mounted to preserve position. We use a plain <button> instead
          of motion.button because motion's `whileTap` writes `transform: scale(1)`
          on release, which would wipe out the manual `translate(x,y)` transform
          and snap the orb to top-left. The tap-scale lives on the inner Orb
          wrapper via :active so the FAB's translate transform is untouched. */}
      <button
        ref={fabRef}
        type="button"
        onClick={(e) => {
          // Suppress click that fires immediately after a drag-tap on mobile
          // (touchend → click). dragState already opened the chat in that flow.
          if (dragState.current.moved) {
            e.preventDefault();
            return;
          }
          handleFabPress();
        }}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        data-tutorial="wizard-chat"
        className={`fixed top-0 left-0 z-[10000] w-16 h-16 flex items-center justify-center md:hidden touch-none ${
          open ? "pointer-events-none opacity-0" : "opacity-100"
        }`}
        style={{
          willChange: "transform",
          transition: open ? "opacity 0.15s" : undefined,
          background: "transparent",
          border: "none",
        }}
        aria-label="Open AI Wizard"
        aria-hidden={open}
      >
        <span className={`relative inline-flex ${prefersReduced ? "" : "active:scale-[0.92] transition-transform duration-100"}`}>
          {tutorialPulse && !prefersReduced && (
            <>
              <span className="absolute inset-0 rounded-full animate-ping bg-primary/40 pointer-events-none" style={{ animationDuration: "1.2s" }} />
              <span className="absolute inset-0 rounded-full animate-ping bg-primary/20 pointer-events-none" style={{ animationDuration: "1.2s", animationDelay: "0.4s" }} />
            </>
          )}
          <Orb size={FAB_SIZE} state="idle" />
        </span>
      </button>

      {/* Proactive coach speech bubble — pops out of the orb (chat closed) and
          "speaks" the coach's current read to entice a tap. Positioned above
          the orb, tail pointing to whichever edge it snapped to. */}
      {!open && bubbleVisible && !dragging && bubbleText && fabPos && (() => {
        const side: "left" | "right" =
          fabPos.x + FAB_SIZE / 2 > window.innerWidth / 2 ? "right" : "left";
        // Horizontal: anchor to the orb's edge so the bubble grows INTO the
        // screen (orb on the right edge -> bubble extends left, and vice-versa).
        const posStyle =
          side === "right"
            ? { right: Math.max(EDGE_MARGIN, window.innerWidth - (fabPos.x + FAB_SIZE) - 4) }
            : { left: Math.max(EDGE_MARGIN, fabPos.x - 4) };
        // Vertical: above the orb normally, but BELOW it when the orb is near
        // the top, so the bubble is never clipped off the top of the screen.
        const placeBelow = fabPos.y < 150;
        const vStyle = placeBelow
          ? { top: fabPos.y + FAB_SIZE + 12 }
          : { bottom: window.innerHeight - fabPos.y + 12 };
        return (
          <div
            className="fixed z-[9999] md:hidden"
            style={{ ...vStyle, ...posStyle }}
          >
            <CoachSpeechBubble
              text={bubbleText}
              tier={bubbleTier}
              action={bubbleAction}
              side={side}
              placement={placeBelow ? "below" : "above"}
              onAct={actFromBubble}
              onChat={chatFromBubble}
              onDismiss={dismissBubble}
            />
          </div>
        );
      })()}

      {/* Backdrop + Panel — orbit-aware bloom from FAB position. */}
      <AnimatePresence>
        {open && (
          <>
            {/* Glassy backdrop fades in independently from the panel. */}
            <motion.div
              key="wcw-backdrop"
              className="fixed inset-0 z-[10001] bg-black/55 backdrop-blur-sm"
              onClick={() => setOpen(false)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: "easeOut" }}
            />

            {/* Wrapper covers viewport so transformOrigin can be expressed in
                viewport coordinates. The panel inside is the actual surface. */}
            <motion.div
              key="wcw-panel-wrap"
              className="fixed inset-0 z-[10002] flex items-end pointer-events-none"
              initial={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.1 }}
              animate={prefersReduced ? { opacity: 1 } : { opacity: 1, scale: 1 }}
              exit={prefersReduced ? { opacity: 0 } : { opacity: 0, scale: 0.1 }}
              style={{
                transformOrigin: `${originPoint.x}px ${originPoint.y}px`,
              }}
              transition={prefersReduced
                ? { duration: 0.15 }
                : { type: "spring", stiffness: 380, damping: 32, mass: 0.7 }}
            >
              <div
                className="relative w-full flex flex-col pointer-events-auto rounded-t-[28px] border border-white/10 bg-card/80 backdrop-blur-2xl shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_-12px_40px_rgba(0,0,0,0.45)]"
                style={{ height: "85dvh" }}
              >
                {/* Drag handle */}
                <div className="flex justify-center pt-2.5 pb-1 shrink-0">
                  <div className="w-9 h-[5px] rounded-full bg-white/25" />
                </div>

                {/* Free users: the Pro gate fills the ENTIRE sheet — nothing
                    else is shown except this floating close button. */}
                {!hasAccess && (
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    aria-label="Close"
                    className="absolute top-3 right-3 z-20 h-9 w-9 rounded-full bg-white/10 hover:bg-white/15 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
                  >
                    <X className="h-[16px] w-[16px]" />
                  </button>
                )}

                {/* Header — Apple Health style with orb avatar (Pro only) */}
                {hasAccess && (
                <div className="shrink-0 px-5 py-3 border-b border-white/10">
                  <div className="flex items-center gap-3">
                    <div className="relative shrink-0 w-11 h-11 flex items-center justify-center">
                      <Orb size={36} state={orbState} />
                      <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[hsl(var(--success))] ring-2 ring-background z-10" />
                    </div>
                    <div className="min-w-0">
                      <h2 className="text-[17px] font-semibold leading-tight tracking-tight text-foreground">FightCamp Coach</h2>
                      <p className="text-[11px] font-medium text-[hsl(var(--success))] mt-0.5 flex items-center gap-1">
                        <span className="inline-block w-1 h-1 rounded-full bg-[hsl(var(--success))]" />
                        Active now
                      </p>
                    </div>
                    <div className="ml-auto flex items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={handleClearChat}
                        className="h-8 w-8 rounded-full bg-white/5 hover:bg-white/10 text-muted-foreground/70 hover:text-destructive transition-colors"
                        title="Clear chat history"
                        aria-label="Clear chat"
                      >
                        <Trash2 className="h-[13px] w-[13px]" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setOpen(false)}
                        className="h-9 w-9 rounded-full bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-foreground transition-colors"
                        title="Close"
                        aria-label="Close chat"
                      >
                        <X className="h-[16px] w-[16px]" />
                      </Button>
                    </div>
                  </div>
                </div>
                )}

                {/* Pinned cockpit — proactive, data-grounded header. Sits ABOVE
                    the chat scroll (Pro only — free users get the full-sheet
                    gate). */}
                {hasAccess && cockpitData && (
                  <div className="shrink-0 px-4 pt-3 pb-1 space-y-2">
                    <CoachCockpitHeader data={cockpitData} />
                  </div>
                )}

                {/* Messages area */}
                <div
                  ref={scrollRef}
                  className={`flex-1 min-h-0 wcw-scroll ${
                    hasAccess
                      ? "overflow-y-auto px-4 py-4 space-y-2.5"
                      : "overflow-hidden"
                  }`}
                  style={{
                    overscrollBehaviorY: "contain",
                    scrollbarWidth: "none",
                  }}
                >
                  {/* FREE branch — the full engaging Pro gate fills the body.
                      No message list, no nudge, no chips, no thinking state:
                      this is the conversion moment. The gate owns its own
                      "Unlock Pro" CTA + contextual briefing line. */}
                  {!hasAccess ? (
                    <CoachProGate />
                  ) : (
                  messages.map((msg, idx) => {
                    const prev = messages[idx - 1];
                    const isGrouped = prev && prev.role === msg.role;
                    const isLast = idx === messages.length - 1;
                    const blocks = msg.role === "assistant" ? msg.blocks ?? [] : [];
                    const followups = msg.role === "assistant" ? msg.followups ?? [] : [];
                    // Per-turn followup chips appear only beneath the latest
                    // assistant turn and once the user has engaged.
                    const showFollowups = isLast && !isLoading && followups.length > 0;
                    return (
                      <div
                        key={msg.id ?? idx}
                        data-msg-idx={idx}
                        className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"} ${isGrouped ? "mt-0.5" : "mt-2"} ${msg.role === "user" ? "animate-fade-in" : "animate-msg-bounce-in"}`}
                        style={msg.role !== "user" ? { transformOrigin: "bottom left" } : undefined}
                      >
                        <div className={`flex items-end gap-2 max-w-[82%] ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                          {/* Assistant orb avatar — only on first of a group */}
                          {msg.role === "assistant" ? (
                            isGrouped ? (
                              <div className="shrink-0 w-7" />
                            ) : (
                              <div className="shrink-0 h-7 w-7 flex items-center justify-center">
                                <Orb size={28} state="idle" />
                              </div>
                            )
                          ) : null}

                          {msg.role === "user" ? (
                            <div className="px-4 py-2.5 rounded-2xl rounded-br-md text-[15px] leading-snug bg-primary/85 text-primary-foreground backdrop-blur-sm">
                              <div className="wizard-prose wizard-prose-user max-w-none">
                                <ReactMarkdown>{msg.content}</ReactMarkdown>
                              </div>
                            </div>
                          ) : (
                            <div className="px-4 py-2.5 rounded-2xl rounded-bl-md text-[15px] leading-snug bg-white/5 border border-white/[0.08] text-foreground">
                              <div className="wizard-prose max-w-none">
                                <ReactMarkdown>{msg.content}</ReactMarkdown>
                              </div>
                            </div>
                          )}
                        </div>

                        {/* Structured coach blocks — render below the text bubble,
                            offset past the orb gutter to align with the bubble. */}
                        {blocks.length > 0 && (
                          <div className="mt-2 ml-9 w-full max-w-[88%]">
                            <CoachBlocks blocks={blocks} onAction={handleCoachAction} />
                          </div>
                        )}

                        {/* Per-turn followup chips from the response. */}
                        {showFollowups && (
                          <div className="mt-2.5 ml-9 flex flex-wrap gap-2 animate-fade-in">
                            {followups.map((chip) => (
                              <button
                                key={chip}
                                type="button"
                                onClick={() => handleSuggestion(chip)}
                                className="text-left text-[13px] leading-snug px-3 py-1.5 rounded-full border border-primary/30 bg-primary/10 text-foreground active:scale-[0.97] active:bg-primary/20 transition-all"
                              >
                                {chip}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                  )}

                  {hasAccess && isLoading && (
                    <div className="flex justify-start mt-2 animate-msg-bounce-in" style={{ transformOrigin: "bottom left" }}>
                      <div className="flex items-end gap-2 max-w-[82%]">
                        <div className="shrink-0 h-7 w-7 flex items-center justify-center">
                          <Orb size={28} state="thinking" />
                        </div>
                        {/* "Reading your numbers" thinking state replaces generic
                            typing dots — rotating, data-flavoured status line. */}
                        <div className="px-4 py-3 rounded-2xl rounded-bl-md bg-white/5 border border-white/[0.08]">
                          <CoachThinkingState />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Adaptive starter chips — context-derived from the cockpit
                      read (days-to-weigh-in, drift) instead of a static list.
                      Aligned with the assistant bubbles (offset past the orb
                      gutter). Per-turn followups still render above. */}
                  {hasAccess && showStarters && (
                    <AdaptiveChips
                      data={cockpitData}
                      onPick={handleSuggestion}
                      className="mt-3 ml-9 animate-fade-in"
                    />
                  )}
                </div>

                {/* ========== INPUT BAR — glassy pill ==========
                    Pro only. Free users land on <CoachProGate /> and cannot
                    type — the entire composer is unmounted for them.
                    Keyboard is in `resize: "none"` app-wide, so we reserve
                    `--keyboard-inset` (set by the JS listener in main.tsx) in
                    addition to the safe-area inset. */}
                {hasAccess && (
                <div
                  className="shrink-0 border-t border-white/10 bg-background/30 backdrop-blur-2xl px-4 pt-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
                  style={{
                    paddingBottom:
                      "max(calc(env(safe-area-inset-bottom, 0px) + 10px), var(--keyboard-inset, 0px))",
                  }}
                >
                    <form onSubmit={handleSend} className="flex items-center gap-2">
                      <div className="flex-1 flex items-center h-11 rounded-full bg-white/8 px-5 ring-1 ring-white/10 focus-within:ring-1 focus-within:ring-primary/30 transition-all">
                        <input
                          ref={inputRef}
                          type="text"
                          value={input}
                          onChange={(e) => setInput(e.target.value)}
                          onFocus={() => setInputFocused(true)}
                          onBlur={() => setInputFocused(false)}
                          placeholder="Message Coach"
                          disabled={isLoading}
                          className="flex-1 bg-transparent text-[15px] text-foreground placeholder:text-muted-foreground/70 outline-none border-none disabled:opacity-50"
                        />
                      </div>
                      <div className="relative shrink-0">
                        {/* Orb-tinted glow halo behind send — only when ready. */}
                        {input.trim() && !isLoading && (
                          <span
                            aria-hidden
                            className="absolute inset-0 rounded-full bg-primary/45 blur-md scale-110 pointer-events-none"
                          />
                        )}
                        <button
                          type="submit"
                          disabled={!input.trim() || isLoading}
                          aria-label="Send message"
                          className="relative h-11 w-11 rounded-full bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 disabled:scale-90 active:scale-90 transition-all duration-150"
                        >
                          <Send className="h-[18px] w-[18px] -ml-0.5" />
                        </button>
                      </div>
                    </form>
                </div>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Hide webkit scrollbar inside the chat panel. */}
      <style>{`.wcw-scroll::-webkit-scrollbar { display: none; }`}</style>
    </>
  );
}
