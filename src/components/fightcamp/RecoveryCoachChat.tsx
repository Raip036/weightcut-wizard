import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Icon } from "@/components/ui/Icon";
import { useAIAction } from "@/hooks/useAIAction";
import { api } from "@/../convex/_generated/api";
import { useSpeechRecognition } from "@/hooks/useSpeechRecognition";
import { useSubscription } from "@/hooks/useSubscription";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { useToast } from "@/hooks/use-toast";
import { AIPersistence } from "@/lib/aiPersistence";
import { triggerHapticSelection } from "@/lib/haptics";
import { logger } from "@/lib/logger";

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
}

interface RecoveryCoachChatProps {
  userId: string;
  userName?: string | null;
}

const STORAGE_KEY = "recovery_coach_session";

const PROMPT_CHIPS = [
  "My shoulders are tight after sparring.",
  "I feel drained today.",
  "Can I spar tomorrow?",
  "Suggest a recovery day plan.",
];

function newId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function RecoveryCoachChat({ userId, userName }: RecoveryCoachChatProps) {
  const { openPaywall, handlePaywallError } = useSubscription();
  const { hasAccess: hasAiAccess } = useFeatureAccess("AI_RECOVERY_COACH");
  const { toast } = useToast();
  const recoveryCoachAction = useAIAction(api.actions.recoveryCoach.run, "AI_RECOVERY_COACH");
  const prefersReduced = useReducedMotion();

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Hydrate from localStorage on mount
  useEffect(() => {
    const cached = AIPersistence.load(userId, STORAGE_KEY) as Msg[] | null;
    if (cached && Array.isArray(cached) && cached.length > 0) {
      setMessages(cached);
    }
  }, [userId]);

  // Persist on every change
  useEffect(() => {
    if (messages.length === 0) return;
    AIPersistence.save(userId, STORAGE_KEY, messages, 24);
  }, [userId, messages]);

  // Auto-scroll to bottom on new message
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, sending]);

  // No warmup needed under Convex; actions are co-located with the deployment.

  // Cleanup any in-flight request on unmount
  useEffect(() => () => abortRef.current?.abort(), []);

  // Voice dictation: same UX as the add-meal flow on Nutrition page
  const handleVoiceTranscript = useCallback((text: string) => {
    setInput((prev) => (prev ? `${prev} ${text}` : text).trim());
  }, []);
  const handleVoiceError = useCallback(
    (error: string) => toast({ title: "Voice Input", description: error, variant: "destructive" }),
    [toast],
  );
  const {
    isListening,
    isSupported: voiceSupported,
    startListening,
    stopListening,
    interimText,
  } = useSpeechRecognition({ onTranscript: handleVoiceTranscript, onError: handleVoiceError });

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [input, autoResize]);

  const send = useCallback(async () => {
    const trimmed = input.trim();
    if (!trimmed || sending) return;
    if (isListening) stopListening();

    if (!hasAiAccess) {
      openPaywall("recovery_coach");
      return;
    }

    const userMsg: Msg = { id: newId(), role: "user", content: trimmed, createdAt: Date.now() };
    const nextHistory = [...messages, userMsg];
    setMessages(nextHistory);
    setInput("");
    setSending(true);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const apiHistory = nextHistory.map((m) => ({ role: m.role, content: m.content }));
      let data: any;
      try {
        data = await recoveryCoachAction({
          messages: apiHistory,
          userName: userName ?? undefined,
        });
      } catch (err: any) {
        if (controller.signal.aborted) return;
        if (await handlePaywallError(err)) {
          setMessages(messages);
          return;
        }
        logger.error("recovery-coach failed", err);
        throw new Error(err?.message || "Coach unavailable");
      }
      const assistantText: string = data?.choices?.[0]?.message?.content ?? "";
      if (!assistantText) throw new Error("Empty response");

      const assistantMsg: Msg = {
        id: newId(),
        role: "assistant",
        content: assistantText,
        createdAt: Date.now(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
    } catch (err) {
      const e = err as { name?: string; message?: string };
      if (e?.name === "AbortError") return;
      logger.error("recovery-coach send failed", err);
      toast({
        title: "Coach unavailable",
        description: e?.message ?? "Try again in a moment.",
        variant: "destructive",
      });
      setMessages(messages);
    } finally {
      setSending(false);
    }
  }, [
    input,
    sending,
    isListening,
    stopListening,
    hasAiAccess,
    openPaywall,
    messages,
    userName,
    handlePaywallError,
    recoveryCoachAction,
    toast,
  ]);

  const clearChat = useCallback(() => {
    triggerHapticSelection();
    abortRef.current?.abort();
    setMessages([]);
    AIPersistence.remove(userId, STORAGE_KEY);
  }, [userId]);

  const isEmpty = messages.length === 0;
  const sendDisabled = sending || input.trim().length === 0;

  const composedTextareaValue = useMemo(() => {
    if (!isListening || !interimText) return input;
    return input ? `${input} ${interimText}` : interimText;
  }, [input, isListening, interimText]);

  return (
    <div className="card-surface rounded-xs border border-border overflow-hidden">
      {/* Header: matches the rounded-xs rhythm of the verdict and load cards
          and surfaces a small live status pill so the chat reads as a live
          coach, not a static text box. */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xs bg-primary/15 flex items-center justify-center">
            <Icon name="bulbOutline" size={16} className="text-primary" />
          </div>
          <div className="leading-tight">
            <h2 className="text-[15px] font-bold tracking-tight">Recovery Coach</h2>
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/70">
              <span className="h-1.5 w-1.5 rounded-full bg-func-recovery-green animate-pulse" />
              Online · Pro feature
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              type="button"
              onClick={clearChat}
              className="h-8 w-8 flex items-center justify-center rounded-xs text-muted-foreground/60 active:text-destructive active:scale-[0.98] transition-all"
              aria-label="Clear chat"
            >
              <Icon name="trashOutline" size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="px-3 py-3 space-y-3 max-h-[440px] overflow-y-auto scroll-smooth [-webkit-overflow-scrolling:touch]">
        {isEmpty && (
          <div className="space-y-3 py-2">
            <p className="text-[13px] text-muted-foreground/80 leading-relaxed px-1">
              Tell me how you're feeling: sore spots, sleep, energy, anything bothering you. I'll factor in your
              recent training load and suggest a session that fits.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {PROMPT_CHIPS.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => {
                    triggerHapticSelection();
                    setInput(chip);
                    textareaRef.current?.focus();
                  }}
                  className="text-[11px] px-2.5 py-1.5 rounded-full bg-muted/40 active:bg-muted/60 border border-border/40 text-foreground/80 transition-colors"
                >
                  {chip}
                </button>
              ))}
            </div>
          </div>
        )}

        <AnimatePresence initial={false}>
          {messages.map((m) => (
            <motion.div
              key={m.id}
              initial={prefersReduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={prefersReduced ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 26 }}
            >
              <MessageBubble role={m.role} content={m.content} />
            </motion.div>
          ))}
        </AnimatePresence>

        {sending && (
          <motion.div
            initial={prefersReduced ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={prefersReduced ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 26 }}
            className="flex items-center gap-2 text-muted-foreground/80 text-[12px] pl-1"
          >
            <span
              className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent"
              aria-hidden
            />
            Thinking...
          </motion.div>
        )}
      </div>

      {/* Input footer */}
      <div className="border-t border-border/40 px-3 py-2.5 space-y-1.5">
        {isListening && interimText && (
          <p className="text-[12px] text-muted-foreground/70 italic px-1">{interimText}</p>
        )}
        <div className="flex items-end gap-1.5">
          {voiceSupported && (
            <motion.button
              type="button"
              onClick={() => {
                triggerHapticSelection();
                if (isListening) stopListening();
                else startListening();
              }}
              disabled={sending}
              animate={
                isListening && !prefersReduced
                  ? { scale: [1, 1.06, 1] }
                  : { scale: 1 }
              }
              transition={
                isListening && !prefersReduced
                  ? { duration: 1.2, repeat: Infinity, ease: "easeInOut" }
                  : { type: "spring", stiffness: 320, damping: 26 }
              }
              whileTap={prefersReduced ? undefined : { scale: 0.94 }}
              className={`h-9 w-9 shrink-0 flex items-center justify-center rounded-xs transition-colors ${
                isListening
                  ? "border border-func-danger-red/30 text-func-danger-red"
                  : "bg-muted/40 text-muted-foreground active:bg-muted/60"
              }`}
              aria-label={isListening ? "Stop listening" : "Start voice input"}
            >
              {isListening ? (
                <Icon name="micOffOutline" size={16} />
              ) : (
                <Icon name="micOutline" size={16} />
              )}
            </motion.button>
          )}
          <textarea
            ref={textareaRef}
            value={composedTextareaValue}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder={isListening ? "Listening..." : "Describe how you feel..."}
            rows={1}
            className={`flex-1 min-h-[36px] max-h-[140px] resize-none rounded-xs border border-border/40 bg-muted/20 py-2 px-3 text-[13px] focus:outline-none focus:ring-1 focus:ring-primary/40 ${
              isListening ? "border-func-danger-red/30" : ""
            }`}
            disabled={sending}
          />
          <motion.button
            type="button"
            onClick={send}
            disabled={sendDisabled}
            whileTap={prefersReduced || sendDisabled ? undefined : { scale: 0.92 }}
            transition={{ type: "spring", stiffness: 380, damping: 22 }}
            className="h-9 w-9 shrink-0 flex items-center justify-center rounded-xs bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.95] transition-all"
            aria-label="Send message"
          >
            <Icon name="sendOutline" size={16} />
          </motion.button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  const isUser = role === "user";
  const clean = content.replace(/\u2014/g, " - ").replace(/\u2013/g, "-");
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[88%] rounded-xs px-3.5 py-2.5 text-[13px] leading-relaxed ${
          isUser
            ? "bg-primary/15 text-foreground"
            : "bg-muted/40 text-foreground"
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap">{clean}</p>
        ) : (
          <div className="prose prose-sm prose-invert max-w-none [&_p]:my-1.5 [&_ul]:my-1.5 [&_li]:my-0.5 [&_strong]:text-primary">
            <ReactMarkdown>{clean}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
