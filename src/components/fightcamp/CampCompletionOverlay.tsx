// CampCompletionOverlay: global controller for the full-screen "your camp is
// complete / start your next one" takeover. Mounted once at the App root.
//
// Flow:  app open → reactive query says a prompt is due → mark it shown
//        (server CAS, on reveal) → play CampCompleteCutscene → on "continue"
//        hand into the EXISTING NextCampFlow (wrap-up stepper for a passed
//        camp, then the new-camp wizard). NextCampFlow owns its own post-create
//        welcome cutscene + navigation to /cut-plan; we tear down once that
//        navigation happens.
//
// Gating: shows at most once per app session (module flag) and never on auth /
// onboarding / landing routes. Cross-session "once-ness" is enforced server
// side (per-camp flag for wrap-up, 7-day cooldown for the camp-less nudge).
import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence } from "motion/react";
import { useQuery, useMutation } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { useUser } from "@/contexts/UserContext";
import { CampCompleteCutscene } from "./CampCompleteCutscene";
import { NextCampFlow } from "./NextCampFlow";

type Prompt =
  | {
      kind: "wrapup";
      camp: {
        id: Id<"fight_camps">;
        name: string;
        fightDate: string;
        eventName: string | null;
        performanceFeeling: string | null;
      };
    }
  | { kind: "next_camp" };

// Once per JS session (cold start). Cross-session limits live on the server.
let shownThisSession = false;

const SKIP_PREFIXES = ["/auth", "/onboarding", "/welcome", "/legal"];
function routeAllowed(path: string): boolean {
  if (path === "/") return false; // landing / boot redirect
  return !SKIP_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

export function CampCompletionOverlay(): JSX.Element | null {
  const { userId, hasProfile, isCoach, isLoading } = useUser();
  const location = useLocation();

  const eligible = Boolean(userId) && hasProfile && !isCoach;
  const prompt = useQuery(
    api.campCompletion.getCampCompletionPrompt,
    eligible ? {} : "skip",
  ) as Prompt | null | undefined;
  const markShown = useMutation(api.campCompletion.markCampPromptShown);

  const [phase, setPhase] = useState<"idle" | "intro" | "flow">("idle");
  const [snapshot, setSnapshot] = useState<Prompt | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const createdRef = useRef(false);
  // Set when the user taps the primary CTA: the NextCampFlow sheet should open
  // once the cutscene has finished exiting (see `startFlow`).
  const pendingOpenRef = useRef(false);
  const safetyTimerRef = useRef<number | null>(null);

  const clearSafetyTimer = () => {
    if (safetyTimerRef.current !== null) {
      clearTimeout(safetyTimerRef.current);
      safetyTimerRef.current = null;
    }
  };

  const reset = () => {
    clearSafetyTimer();
    pendingOpenRef.current = false;
    createdRef.current = false;
    setSheetOpen(false);
    setSnapshot(null);
    setPhase("idle");
  };

  // Primary CTA ("Start next camp" / "Wrap up & continue"). The cutscene is a
  // full-screen `z-[10010]` takeover that animates out over ~0.4s. If we opened
  // the NextCampFlow sheet (`z-50`) immediately, the exiting takeover would sit
  // ON TOP of it and swallow every tap until it unmounted — which read as the
  // button "doing nothing". Instead we flip phase to "flow" (removing the
  // cutscene from <AnimatePresence>, which starts its exit) and open the sheet
  // only from `onExitComplete`, once the takeover is fully gone. A safety
  // timeout opens it regardless so the CTA can never hang.
  const startFlow = () => {
    pendingOpenRef.current = true;
    setPhase("flow");
    clearSafetyTimer();
    safetyTimerRef.current = window.setTimeout(() => {
      if (pendingOpenRef.current) {
        pendingOpenRef.current = false;
        setSheetOpen(true);
      }
    }, 600);
  };

  // Clear any pending safety timer on unmount.
  useEffect(() => () => clearSafetyTimer(), []);

  // ── Decide whether to show, and mark it shown (on reveal) ──
  useEffect(() => {
    if (phase !== "idle" || shownThisSession) return;
    if (!eligible || isLoading) return;
    if (!routeAllowed(location.pathname)) return;
    if (!prompt) return;

    shownThisSession = true; // claim immediately to avoid double-fire
    let cancelled = false;
    void (async () => {
      try {
        const res = await markShown({
          kind: prompt.kind,
          campId: prompt.kind === "wrapup" ? prompt.camp.id : undefined,
        });
        if (cancelled) return;
        // Another device already claimed this camp's takeover; stay hidden.
        if (prompt.kind === "wrapup" && !res.firstTime) return;
        setSnapshot(prompt);
        setPhase("intro");
      } catch {
        shownThisSession = false; // allow a retry later this session
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, eligible, isLoading, prompt, location.pathname, markShown]);

  // ── After a camp is created, NextCampFlow plays its own welcome cutscene
  //    then navigates (handleSeePlan → /cut-plan). Tear down on that nav. ──
  useEffect(() => {
    if (phase === "flow" && createdRef.current) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  if (phase === "idle" || !snapshot) return null;

  const activeCamp =
    snapshot.kind === "wrapup"
      ? {
          _id: snapshot.camp.id,
          name: snapshot.camp.name,
          fightDate: snapshot.camp.fightDate,
          isCompleted: false,
        }
      : null;

  return (
    <>
      <AnimatePresence
        onExitComplete={() => {
          // The intro takeover has fully animated out — now it's safe to open
          // the sheet beneath it (it can no longer cover or block taps).
          if (pendingOpenRef.current) {
            pendingOpenRef.current = false;
            clearSafetyTimer();
            setSheetOpen(true);
          }
        }}
      >
        {phase === "intro" && (
          <CampCompleteCutscene
            kind={snapshot.kind}
            campName={snapshot.kind === "wrapup" ? snapshot.camp.name : null}
            onContinue={startFlow}
            onSkip={reset}
          />
        )}
      </AnimatePresence>

      {phase === "flow" && (
        <NextCampFlow
          open={sheetOpen}
          onOpenChange={(o) => {
            setSheetOpen(o);
            // Closed without creating → dismiss the whole overlay. If a camp
            // was just created, keep mounted so the welcome cutscene can play.
            if (!o && !createdRef.current) reset();
          }}
          activeCamp={activeCamp}
          onCreated={() => {
            createdRef.current = true;
          }}
        />
      )}
    </>
  );
}
