import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  type ReactNode,
} from "react";
import { useAIAction } from "@/hooks/useAIAction";
import { api } from "@/../convex/_generated/api";
import { useAuth, useUser } from "./UserContext";
import { useSubscription } from "@/hooks/useSubscription";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { AIPersistence } from "@/lib/aiPersistence";
import { logger } from "@/lib/logger";
import type { CoachMessage, CoachBlock } from "@/../convex/_shared/aiSchemas";

/**
 * Fight Camp Coach data layer.
 *
 * Parallel to `useWizardBackground`, but routes the global floating orb at the
 * rewritten structured coach action (`api.actions.fightCampCoach.run`) which
 * returns a `CoachMessage` ({ reply, blocks, followups }) rather than the old
 * `{ choices: [{ message: { content } }] }` prose shape.
 *
 * Spec: docs/superpowers/specs/2026-06-04-fight-camp-coach-redesign-design.md
 * (§2, §3.2, §3.3, §5 Phase 1, §6, §8 Q1).
 */

/** A single coach chat turn. `blocks`/`followups` are optional so old
 *  localStorage sessions (pre-structured-output) hydrate without migration. */
export interface CoachChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  blocks?: CoachBlock[];
  followups?: string[];
  createdAt: number;
}

interface FightCampCoachContextType {
  messages: CoachChatMessage[];
  isLoading: boolean;
  sendMessage: (text: string) => Promise<void>;
  clearChat: () => void;
}

const FightCampCoachContext = createContext<FightCampCoachContextType | undefined>(undefined);

/** localStorage namespace via AIPersistence (`ai_<type>_<userId>`). */
const STORAGE_KEY = "fight_camp_coach_session";
/** How long a persisted session survives — mirrors the recovery-coach 24h TTL. */
const STORAGE_TTL_HOURS = 24;

const PAYWALL_REPLY =
  "FightCamp Coach is a **Pro** feature. Upgrade to Pro to chat with your cornerman and unlock unlimited AI access across the app.";

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function FightCampCoachProvider({ children }: { children: ReactNode }) {
  const { userId } = useAuth();
  const { userName } = useUser();
  const { openPaywall, handlePaywallError } = useSubscription();
  const { hasAccess } = useFeatureAccess("AI_FIGHT_CAMP_COACH");
  const coachAction = useAIAction(api.actions.fightCampCoach.run, "AI_FIGHT_CAMP_COACH");

  const [messages, setMessages] = useState<CoachChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Opening greeting (Phase 1 placeholder — Phase 2 makes this data-driven
  // from today's fight-week numbers via the pinned cockpit header).
  const getGreeting = useCallback((): CoachChatMessage => {
    const name = userName || "champ";
    return {
      id: "greeting",
      role: "assistant",
      content: `Hey ${name} — I'm your FightCamp Coach. Ask me about your cut, today's targets, or how to make weight safely.`,
      createdAt: Date.now(),
    };
  }, [userName]);

  // Hydrate from localStorage on user change. Tolerates old messages with no
  // `blocks`/`followups` (fields are optional — no migration needed).
  useEffect(() => {
    if (!userId || userId === "pending") {
      setMessages([]);
      return;
    }
    const cached = AIPersistence.load(userId, STORAGE_KEY) as CoachChatMessage[] | null;
    if (cached && Array.isArray(cached) && cached.length > 0) {
      setMessages(cached);
    } else {
      setMessages([getGreeting()]);
    }
    // getGreeting depends on userName; we intentionally only re-hydrate on
    // userId change so a name update mid-session doesn't wipe history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const persist = useCallback(
    (next: CoachChatMessage[]) => {
      if (!userId || userId === "pending") return;
      AIPersistence.save(userId, STORAGE_KEY, next, STORAGE_TTL_HOURS);
    },
    [userId],
  );

  const clearChat = useCallback(() => {
    if (!userId || userId === "pending") return;
    AIPersistence.remove(userId, STORAGE_KEY);
    setMessages([getGreeting()]);
  }, [userId, getGreeting]);

  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading || !userId || userId === "pending") return;

      const userMsg: CoachChatMessage = {
        id: newId(),
        role: "user",
        content: trimmed,
        createdAt: Date.now(),
      };
      const withUser = [...messages, userMsg];
      setMessages(withUser);
      // Persist the user turn immediately so it survives an app backgrounding
      // mid-request.
      persist(withUser);
      setIsLoading(true);

      // Pre-flight Pro gate — short-circuit before the network round-trip.
      if (!hasAccess) {
        const limited: CoachChatMessage[] = [
          ...withUser,
          { id: newId(), role: "assistant", content: PAYWALL_REPLY, createdAt: Date.now() },
        ];
        setMessages(limited);
        persist(limited);
        openPaywall();
        setIsLoading(false);
        return;
      }

      try {
        // The action accepts {role, content}[] (user|assistant) — the server
        // injects its own system prompt and computes deterministic blocks.
        const apiMessages = withUser.map((m) => ({ role: m.role, content: m.content }));

        let data: CoachMessage;
        try {
          data = (await coachAction({
            messages: apiMessages,
            userName: userName || undefined,
          })) as CoachMessage;
        } catch (err: unknown) {
          // PRO_FEATURE_REQUIRED bubbles up from the server when a free user
          // bypasses the client gate; route through the shared paywall handler.
          if (await handlePaywallError(err)) {
            const limited: CoachChatMessage[] = [
              ...withUser,
              { id: newId(), role: "assistant", content: PAYWALL_REPLY, createdAt: Date.now() },
            ];
            setMessages(limited);
            persist(limited);
            setIsLoading(false);
            return;
          }
          const message = err instanceof Error ? err.message : "Failed to reach the coach";
          throw new Error(message);
        }

        const assistantMsg: CoachChatMessage = {
          id: newId(),
          role: "assistant",
          content: data?.reply ?? "",
          blocks: data?.blocks ?? [],
          followups: data?.followups,
          createdAt: Date.now(),
        };
        const finalMessages = [...withUser, assistantMsg];
        setMessages(finalMessages);
        persist(finalMessages);
      } catch (error) {
        logger.error("FightCamp Coach send failed", error);
        const fallback: CoachChatMessage[] = [
          ...withUser,
          {
            id: newId(),
            role: "assistant",
            content: "Sorry, I couldn't reach the corner right now. Try again in a moment.",
            createdAt: Date.now(),
          },
        ];
        setMessages(fallback);
        persist(fallback);
      } finally {
        setIsLoading(false);
      }
    },
    [
      userId,
      isLoading,
      messages,
      hasAccess,
      openPaywall,
      handlePaywallError,
      userName,
      coachAction,
      persist,
    ],
  );

  const value = useMemo(
    () => ({ messages, isLoading, sendMessage, clearChat }),
    [messages, isLoading, sendMessage, clearChat],
  );

  return (
    <FightCampCoachContext.Provider value={value}>
      {children}
    </FightCampCoachContext.Provider>
  );
}

export function useFightCampCoach(): FightCampCoachContextType {
  const context = useContext(FightCampCoachContext);
  if (context === undefined) {
    throw new Error("useFightCampCoach must be used within a FightCampCoachProvider");
  }
  return context;
}
