import { useRef, useEffect, useState, useCallback } from "react";
import { useWizardBackground } from "@/contexts/WizardBackgroundContext";
import { Send, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import { triggerHapticSelection, triggerHapticSuccess, triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import wizardAvatar from "@/assets/wizard-logo.webp";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";

const FAB_SIZE = 48;
const EDGE_MARGIN = 16;
const SNAP_SPRING = "transform 0.35s cubic-bezier(0.25, 1, 0.5, 1)";
const FAB_POS_KEY = "wcw_fab_position";

function loadSavedPosition(): { x: number; y: number } | null {
  try {
    const raw = localStorage.getItem(FAB_POS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

export function FloatingWizardChat() {
  const { messages, isLoading, sendMessage, clearChat } = useWizardBackground();
  const { hasAccess } = useFeatureAccess("AI_WIZARD_CHAT");
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
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
  }, [open]);

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
    try { localStorage.setItem(FAB_POS_KEY, JSON.stringify(posRef.current)); } catch {}
    setTimeout(() => { if (el) el.style.transition = "none"; }, 350);
  }, []);

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const touch = e.touches[0];
    const { x, y } = posRef.current;
    dragState.current = { isDragging: true, startX: x, startY: y, startTouchX: touch.clientX, startTouchY: touch.clientY, moved: false };
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
    if (fabRef.current) fabRef.current.style.transform = `translate(${posRef.current.x}px, ${posRef.current.y}px) scale(1)`;
    if (!dragState.current.moved) {
      // Tap — open chat
      handleFabPress();
    } else {
      // Drag ended — snap to nearest edge
      triggerHaptic(ImpactStyle.Light);
      snapToEdge();
    }
  }, [snapToEdge]);

  // No warmup needed under Convex — actions are co-located with the deployment.

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
    if (!input.trim() || isLoading) return;

    triggerHapticSelection();
    const currentInput = input;
    setInput("");
    await sendMessage(currentInput);
    triggerHapticSuccess();
  };

  const handleFabPress = () => {
    triggerHapticSelection();
    // Always open the chat — gem is only deducted when user sends a message
    setOpen(true);
  };

  return (
    <>
      {/* Floating button — draggable, snaps to edges. Always mounted to preserve position. */}
      <button
        ref={fabRef}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        data-tutorial="wizard-chat"
        className={`fixed top-0 left-0 z-[10000] w-12 h-12 rounded-full shadow-lg flex items-center justify-center md:hidden touch-none overflow-hidden ${
          hasAccess
            ? "bg-gradient-to-br from-primary to-secondary text-primary-foreground shadow-primary/30"
            : "bg-zinc-800 text-zinc-400 shadow-none border border-white/10"
        } ${open ? "pointer-events-none opacity-0" : "opacity-100"}`}
        style={{ willChange: "transform", transition: open ? "opacity 0.15s" : undefined }}
        aria-label="Open AI Wizard"
        aria-hidden={open}
      >
        <img src={wizardAvatar} alt="Wizard" className="w-full h-full object-cover rounded-full mix-blend-screen" />
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="fixed inset-0 z-[10001] bg-black/60 animate-in fade-in duration-200"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Chat Panel */}
      {open && (
        <div
          className="fixed inset-x-0 bottom-0 z-[10002] flex flex-col bg-background border-t border-border/40 rounded-t-[28px] shadow-[0_-20px_60px_-15px_rgba(0,0,0,0.5)] animate-in slide-in-from-bottom duration-300"
          style={{ height: "85dvh" }}
        >
          {/* Drag handle */}
          <div className="flex justify-center pt-2.5 pb-1 shrink-0">
            <div className="w-9 h-[5px] rounded-full bg-muted-foreground/30" />
          </div>

          {/* Header — Apple Health style: clean, bold, status indicator */}
          <div className="shrink-0 px-5 py-3 border-b border-border/40">
            <div className="flex items-center gap-3">
              <div className="relative shrink-0">
                <div className="w-11 h-11 rounded-full overflow-hidden bg-muted ring-1 ring-border/60">
                  <img src={wizardAvatar} alt="Coach" className="w-full h-full object-cover mix-blend-screen" />
                </div>
                <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-[hsl(var(--success))] ring-2 ring-background" />
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
                  className="h-9 w-9 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground hover:text-destructive transition-colors"
                  title="Clear chat history"
                  aria-label="Clear chat"
                >
                  <Trash2 className="h-[15px] w-[15px]" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setOpen(false)}
                  className="h-9 w-9 rounded-full bg-muted/60 hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
                  title="Close"
                  aria-label="Close chat"
                >
                  <X className="h-[16px] w-[16px]" />
                </Button>
              </div>
            </div>
          </div>

          {/* Messages area */}
          <div className="flex-1 overflow-y-auto min-h-0 px-4 py-4 space-y-2.5" ref={scrollRef}>
            {messages.map((msg, idx) => {
              const prev = messages[idx - 1];
              const isGrouped = prev && prev.role === msg.role;
              return (
                <div
                  key={idx}
                  data-msg-idx={idx}
                  className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"} ${isGrouped ? "mt-0.5" : "mt-2"} ${msg.role === "user" ? "animate-fade-in" : "animate-msg-bounce-in"}`}
                  style={msg.role !== "user" ? { transformOrigin: "bottom left" } : undefined}
                >
                  <div className={`flex items-end gap-2 max-w-[82%] ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                    {/* Avatar — only show on first of a group for AI */}
                    {msg.role === "assistant" ? (
                      isGrouped ? (
                        <div className="shrink-0 w-7" />
                      ) : (
                        <div className="shrink-0 h-7 w-7 rounded-full overflow-hidden bg-muted ring-1 ring-border/50">
                          <img src={wizardAvatar} alt="Coach" className="w-full h-full object-cover mix-blend-screen" />
                        </div>
                      )
                    ) : null}

                    {msg.role === "user" ? (
                      <div className="px-4 py-2.5 rounded-[20px] rounded-br-md text-[15px] leading-snug bg-primary text-primary-foreground shadow-sm">
                        <div className="wizard-prose wizard-prose-user max-w-none">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      </div>
                    ) : (
                      <div className="px-4 py-2.5 rounded-[20px] rounded-bl-md text-[15px] leading-snug bg-muted text-foreground">
                        <div className="wizard-prose max-w-none">
                          <ReactMarkdown>{msg.content}</ReactMarkdown>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {isLoading && (
              <div className="flex justify-start mt-2 animate-msg-bounce-in" style={{ transformOrigin: "bottom left" }}>
                <div className="flex items-end gap-2 max-w-[82%]">
                  <div className="shrink-0 h-7 w-7 rounded-full overflow-hidden bg-muted ring-1 ring-border/50">
                    <img src={wizardAvatar} alt="Coach" className="w-full h-full object-cover mix-blend-screen" />
                  </div>
                  <div className="px-4 py-3 rounded-[20px] rounded-bl-md bg-muted flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/70 animate-[typing_1.2s_ease-in-out_infinite]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/70 animate-[typing_1.2s_ease-in-out_0.15s_infinite]" />
                    <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/70 animate-[typing_1.2s_ease-in-out_0.3s_infinite]" />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ========== INPUT BAR — iOS pill style ==========
              Keyboard is in `resize: "none"` app-wide, so we reserve
              `--keyboard-inset` (set by the JS listener in main.tsx) in
              addition to the safe-area inset. */}
          <div
            className="shrink-0 border-t border-border/40 bg-background px-4 pt-3"
            style={{
              paddingBottom:
                "max(calc(env(safe-area-inset-bottom, 0px) + 10px), var(--keyboard-inset, 0px))",
            }}
          >
            <form onSubmit={handleSend} className="flex items-center gap-2">
              <div className="flex-1 flex items-center h-11 rounded-full bg-muted px-5 ring-1 ring-border/40 focus-within:ring-primary/50 transition-[box-shadow,ring]">
                <input
                  ref={inputRef}
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Message Coach"
                  disabled={isLoading}
                  className="flex-1 bg-transparent text-[15px] text-foreground placeholder:text-muted-foreground/70 outline-none border-none disabled:opacity-50"
                />
              </div>
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                aria-label="Send message"
                className="h-11 w-11 shrink-0 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-sm disabled:opacity-40 disabled:scale-90 active:scale-90 transition-all duration-150"
              >
                <Send className="h-[18px] w-[18px] -ml-0.5" />
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
