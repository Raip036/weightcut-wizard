import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAIAction } from "@/hooks/useAIAction";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { useAuth } from "@/contexts/UserContext";
import { useSubscription } from "@/hooks/useSubscription";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import { AIPersistence } from "@/lib/aiPersistence";
import { normalizeTechniqueName, processChains, buildGraphData } from "@/lib/techniqueGraph";
import { createAIAbortController } from "@/lib/timeoutWrapper";
import { celebrateSuccess } from "@/lib/haptics";
import { logger } from "@/lib/logger";
import type {
  Technique,
  TechniqueEdge,
  UserTechniqueProgress,
  TechniqueChainResponse,
  GraphNode,
  GraphEdge,
  TechniqueLevel,
} from "@/types/technique";

interface SkillTreeState {
  techniques: Technique[];
  edges: TechniqueEdge[];
  progress: UserTechniqueProgress[];
}

export function useSkillTree() {
  const { userId } = useAuth();
  const { openPaywall, handlePaywallError } = useSubscription();
  const { hasAccess: hasAiAccess } = useFeatureAccess("AI_TECHNIQUE_CHAINS");
  const generateTechniqueChainsAction = useAIAction(api.actions.generateTechniqueChains.run, "AI_TECHNIQUE_CHAINS");
  const upsertTechnique = useMutation(api.techniques.upsertTechnique);
  const upsertEdges = useMutation(api.techniques.upsertEdges);
  const logTechniqueMut = useMutation(api.techniques.logTechnique);
  const setProgressLevelMut = useMutation(api.techniques.setProgressLevel);

  // Reactive Convex queries — no manual cache or polling.
  const allTechniques = useQuery(api.techniques.listTechniques, {}) as Technique[] | undefined;
  const allEdges = useQuery(api.techniques.listEdges, {}) as TechniqueEdge[] | undefined;
  const userProgress = useQuery(
    api.techniques.getUserProgress,
    userId ? {} : "skip",
  ) as UserTechniqueProgress[] | undefined;

  const [state, setState] = useState<SkillTreeState>({ techniques: [], edges: [], progress: [] });
  const [graphNodes, setGraphNodes] = useState<GraphNode[]>([]);
  const [graphEdges, setGraphEdges] = useState<GraphEdge[]>([]);
  const [graphBounds, setGraphBounds] = useState({ width: 400, height: 300 });
  const [isGenerating, setIsGenerating] = useState(false);
  const aiAbortRef = useRef<AbortController | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;

  const rebuildGraph = useCallback((techniques: Technique[], edges: TechniqueEdge[], progress: UserTechniqueProgress[]) => {
    const progressMap = new Map(
      progress.map((p) => [p.technique_id, { level: p.level, timesLogged: p.times_logged }])
    );
    const { graphNodes: nodes, graphEdges: edgs, graphBounds: bounds } = buildGraphData(techniques, edges, progressMap);
    setGraphNodes(nodes);
    setGraphEdges(edgs);
    setGraphBounds(bounds);
  }, []);

  // Normalise Convex returns into the legacy snake_case Technique/Edge/Progress shapes.
  useEffect(() => {
    if (!userId) return;
    if (!allTechniques || !allEdges || !userProgress) return;

    const techniques: Technique[] = (allTechniques as any[]).map((t) => ({
      id: t._id,
      name: t.name,
      name_normalized: t.nameNormalized,
      sport: t.sport,
      position: t.position ?? null,
      category: t.category ?? null,
      created_at: new Date(t._creationTime).toISOString(),
    }));
    const edges: TechniqueEdge[] = (allEdges as any[]).map((e) => ({
      id: e._id,
      from_technique_id: e.fromTechniqueId,
      to_technique_id: e.toTechniqueId,
      relation_type: e.relationType,
      created_at: new Date(e._creationTime).toISOString(),
    }));
    const progress: UserTechniqueProgress[] = (userProgress as any[]).map((p) => ({
      id: p._id,
      user_id: p.userId,
      technique_id: p.techniqueId,
      level: p.level as TechniqueLevel,
      times_logged: p.timesLogged,
      first_logged_at: p.firstLoggedAt ? new Date(p.firstLoggedAt).toISOString() : null,
      last_logged_at: p.lastLoggedAt ? new Date(p.lastLoggedAt).toISOString() : null,
    })) as unknown as UserTechniqueProgress[];

    const newState = { techniques, edges, progress };
    setState(newState);
    rebuildGraph(techniques, edges, progress);
    AIPersistence.save(userId, "skill_tree", newState, 24);
  }, [userId, allTechniques, allEdges, userProgress, rebuildGraph]);

  const isLoading = userId
    ? allTechniques === undefined || allEdges === undefined || userProgress === undefined
    : false;

  const generateChains = async (
    name: string,
    sport: string,
    techniqueId: string,
    controller: AbortController,
  ) => {
    try {
      if (!hasAiAccess) {
        openPaywall("technique_chains");
        return;
      }

      let chainResponse: any;
      try {
        chainResponse = await generateTechniqueChainsAction({
          sport,
          startingTechnique: name,
        });
      } catch (chainError: any) {
        if (controller.signal.aborted) return;
        if (await handlePaywallError(chainError)) return;
        if (chainError?.name === "AbortError") throw chainError;
        throw new Error(chainError?.message || "Chain generation failed");
      }

      if (controller.signal.aborted) return;
      const chainData = chainResponse as TechniqueChainResponse;

      if (!chainData?.chains?.length) return;

      // Update technique metadata if provided.
      if (chainData.technique_metadata) {
        const { position, category } = chainData.technique_metadata;
        if (position || category) {
          // Re-upsert with the same normalised key carries over metadata.
          await upsertTechnique({
            name,
            nameNormalized: normalizeTechniqueName(name),
            sport,
            position: position ?? undefined,
            category: category ?? undefined,
          });
        }
      }

      // Process chains → batch-upsert techniques + edges via Convex.
      const { newTechniques, newEdges } = processChains(
        chainData.chains,
        sport,
        stateRef.current.techniques,
        stateRef.current.edges,
      );

      const insertedTechniqueIds = new Map<string, string>();
      for (const t of newTechniques) {
        const id = await upsertTechnique({
          name: t.name,
          nameNormalized: t.name_normalized,
          sport: t.sport,
        });
        insertedTechniqueIds.set(t.name_normalized, id as unknown as string);
      }

      const normalizedToId = new Map<string, string>();
      for (const t of stateRef.current.techniques) normalizedToId.set(t.name_normalized, t.id);
      for (const [k, v] of insertedTechniqueIds) normalizedToId.set(k, v);

      const edgesToInsert = newEdges
        .map((e) => ({
          fromTechniqueId: normalizedToId.get(e.fromNormalized) as Id<"techniques"> | undefined,
          toTechniqueId: normalizedToId.get(e.toNormalized) as Id<"techniques"> | undefined,
          relationType: "chains_into",
        }))
        .filter((e) => e.fromTechniqueId && e.toTechniqueId) as Array<{
          fromTechniqueId: Id<"techniques">;
          toTechniqueId: Id<"techniques">;
          relationType: string;
        }>;
      if (edgesToInsert.length > 0) {
        await upsertEdges({ edges: edgesToInsert });
      }

      // The Convex queries re-fetch automatically; we don't need to splice
      // local state ourselves. Pin a celebrate-success regardless.
      void techniqueId;
      celebrateSuccess();
    } catch (chainErr: any) {
      if (chainErr?.name === "AbortError" || controller.signal.aborted) {
        logger.info("Chain generation cancelled by user");
      } else {
        logger.warn("Chain generation failed (technique was still logged)", { error: chainErr });
      }
    } finally {
      aiAbortRef.current = null;
      setIsGenerating(false);
    }
  };

  const logTechnique = useCallback(
    async (name: string, sport: string, notes?: string, sessionId?: string) => {
      if (!userId) return;

      const normalized = normalizeTechniqueName(name);

      try {
        // 1. Upsert technique → canonical id.
        const techniqueId = await upsertTechnique({ name, nameNormalized: normalized, sport });

        // 2. Insert training log + bump progression in one transactional mutation.
        await logTechniqueMut({
          techniqueId: techniqueId as Id<"techniques">,
          date: new Date().toISOString().split("T")[0],
          sessionId: sessionId ? (sessionId as Id<"fight_camp_calendar">) : undefined,
          notes: notes ?? undefined,
        });

        // 3. Generate chains in background — don't block the caller.
        const controller = createAIAbortController();
        aiAbortRef.current = controller;
        setIsGenerating(true);
        generateChains(name, sport, techniqueId as unknown as string, controller);
      } catch (err) {
        logger.error("Failed to log technique", { error: err });
        throw err;
      }
    },
    [userId, upsertTechnique, logTechniqueMut],
  );

  const updateProgress = useCallback(
    async (techniqueId: string, level: TechniqueLevel) => {
      if (!userId) return;
      try {
        await setProgressLevelMut({
          techniqueId: techniqueId as Id<"techniques">,
          level,
        });
      } catch (err) {
        logger.error("Failed to update technique progress", { error: err });
      }
    },
    [userId, setProgressLevelMut],
  );

  return {
    graphNodes,
    graphEdges,
    graphBounds,
    techniques: state.techniques,
    progress: state.progress,
    isLoading,
    isGenerating,
    logTechnique,
    updateProgress,
  };
}
