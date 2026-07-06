/**
 * useCreatePost — orchestrates the three-step post-creation flow from the
 * Corner tab's `PostComposer`:
 *
 *   1. Mint a one-time upload URL via `api.gymFeed.generateUploadUrl`
 *   2. POST the compressed JPEG blob to that URL → Convex returns a storageId
 *   3. Insert the `session_media` row via `api.gymFeed.createPost`
 *
 * ─── Expected backend contracts (assumed by this hook) ─────────────────
 *
 * The backend agent owns `convex/gymFeed.ts`. This hook is written against
 * the following signatures; if the backend lands on different names, update
 * the references below and the `api.gymFeed.<name>` paths in the hook body.
 *
 *   // Returns a single-use POST URL the client uses to upload the blob.
 *   // Auth-gated: only signed-in users may mint upload URLs.
 *   export const generateUploadUrl = mutation({
 *     args: {},
 *     handler: async (ctx) => {
 *       await requireUserId(ctx);
 *       return await ctx.storage.generateUploadUrl();
 *     },
 *   });
 *
 *   // Persists a fresh post against a session, gym-scoped at insert time.
 *   // Inputs: storageId from step 2 + the session this post belongs to.
 *   // Optional thumbDataUrl/thumbStorageId pre-computed on the client.
 *   export const uploadSessionMediaV2 = mutation({
 *     args: {
 *       sessionId: v.id("fight_camp_calendar"),
 *       storageId: v.id("_storage"),
 *       kind: v.union(v.literal("photo"), v.literal("video")),
 *       caption: v.optional(v.string()),
 *       visibility: v.union(v.literal("gym"), v.literal("private")),
 *       thumbDataUrl: v.optional(v.string()),
 *       thumbStorageId: v.optional(v.id("_storage")),
 *       width: v.optional(v.number()),
 *       height: v.optional(v.number()),
 *     },
 *     handler: async (ctx, args) => {
 *       // ... requireUserId, gym lookup, rate limit, insert row ...
 *       return { postId };
 *     },
 *   });
 *
 *  Soft-fallback strategy: if either function is missing at runtime, the
 *  hook surfaces a `useToast` error and rejects — the UI's "retry" path
 *  picks up automatically when the backend deploys.
 */
import { useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useToast } from "@/hooks/use-toast";
import { logger } from "@/lib/logger";
import { track, EVENTS } from "@/lib/analytics";

/**
 * Argument shape for the returned `createPost` function.
 *
 * `blob` is the already-compressed image (typically 1024w q=0.82 JPEG —
 * see `src/lib/imageCompress.ts#compressImage`). The hook does not
 * re-compress.
 */
export interface CreatePostArgs {
  blob: Blob;
  sessionId: Id<"fight_camp_calendar">;
  caption?: string;
  isPrivate?: boolean;
  /** Base64 LQIP for inline blur-up. ~2 KB. Optional. */
  thumbDataUrl?: string;
  /** Image dimensions (post-compression) for grid layout reservation. */
  width?: number;
  height?: number;
}

export interface CreatePostResult {
  postId: Id<"session_media">;
}

/**
 * Returns a function the composer calls on submit. The returned function
 * resolves with the new post id on success and rejects with a human-readable
 * Error otherwise — the composer reads `err.message` to drive its retry UI.
 *
 * The hook itself is hook-stable across renders; `createPost` is a fresh
 * closure each render so callers can include it in effect dependency
 * arrays without breaking memoization.
 */
export function useCreatePost() {
  const { toast } = useToast();

  // Backend exposes `gymFeed.generateUploadUrl` + `gymFeed.createPost`
  // (see convex/gymFeed.ts). Direct typed references — Convex codegen
  // surfaces signature drift as a TS error at build time.
  const generateUploadUrl = useMutation(api.gymFeed.generateUploadUrl);
  const createPostMut = useMutation(api.gymFeed.createPost);

  const createPost = useCallback(
    async (args: CreatePostArgs): Promise<CreatePostResult> => {
      const { blob, sessionId, caption, isPrivate, thumbDataUrl, width, height } =
        args;

      // ─── Step 1: mint upload URL ──────────────────────────────────────
      let postUrl: string;
      try {
        postUrl = await generateUploadUrl({});
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Couldn't start upload. Try again.";
        logger.warn("useCreatePost: generateUploadUrl failed", { error: msg });
        toast({
          title: "Upload couldn't start",
          description: msg,
          variant: "destructive",
        });
        throw new Error(msg);
      }

      // ─── Step 2: POST blob to Convex Storage ──────────────────────────
      let storageId: Id<"_storage">;
      try {
        const res = await fetch(postUrl, {
          method: "POST",
          headers: { "Content-Type": blob.type || "image/jpeg" },
          body: blob,
        });
        if (!res.ok) {
          throw new Error(`Upload failed (${res.status})`);
        }
        const json = (await res.json()) as { storageId?: string };
        if (!json.storageId) {
          throw new Error("Upload response missing storageId");
        }
        storageId = json.storageId as Id<"_storage">;
      } catch (err) {
        const msg =
          err instanceof Error
            ? err.message
            : "Network error uploading photo.";
        logger.warn("useCreatePost: storage POST failed", { error: msg });
        toast({
          title: "Photo upload failed",
          description: msg,
          variant: "destructive",
        });
        throw new Error(msg);
      }

      // ─── Step 3: persist session_media row ────────────────────────────
      try {
        const result = await createPostMut({
          sessionId,
          storageId,
          kind: "photo",
          caption: caption?.trim() ? caption.trim() : undefined,
          visibility: isPrivate ? "private" : "gym",
          thumbDataUrl,
          width,
          height,
        });
        // No caption/content in props — privacy rule for the health app.
        track(EVENTS.POST_CREATED, {
          post_id: result.postId,
          is_private: !!isPrivate,
        });
        return { postId: result.postId };
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Couldn't save your post.";
        logger.warn("useCreatePost: createPost failed", { error: msg });
        toast({
          title: "Post didn't go through",
          description: msg,
          variant: "destructive",
        });
        throw new Error(msg);
      }
    },
    [generateUploadUrl, toast, createPostMut],
  );

  return createPost;
}
