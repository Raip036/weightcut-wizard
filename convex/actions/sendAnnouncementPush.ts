"use node";

/**
 * Push fan-out for `gym_announcements`.
 *
 * Scheduled (via `ctx.scheduler.runAfter`) from the announcement-create
 * mutation. Looks up targets, sends APNs / FCM, and prunes 410-Gone tokens.
 * APNs JWT is generated + cached via `_shared/apnsJwt.ts`.
 *
 * Env required for delivery:
 *   APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_KEY_P8 (iOS)
 *   FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY (Android, FCM HTTP v1)
 */
import { v } from "convex/values";
import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import { getApnsJwt, apnsHost } from "../_shared/apnsJwt";
import { getFcmAccessToken, fcmProjectId } from "../_shared/fcmAccessToken";

interface Target {
  userId: string;
  token: string;
  platform: "ios" | "android" | "web";
}

async function sendApns(
  token: string,
  payload: { aps: any; data?: any },
): Promise<{ ok: boolean; status?: number; reason?: string }> {
  const jwt = await getApnsJwt();
  const bundleId = process.env.APNS_BUNDLE_ID;
  if (!jwt || !bundleId) return { ok: false, reason: "apns-not-configured" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(`${apnsHost()}/3/device/${token}`, {
      method: "POST",
      headers: {
        authorization: `bearer ${jwt}`,
        "apns-topic": bundleId,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { ok: false, reason: "apns-timeout" };
    }
    return { ok: false, reason: String(err) };
  } finally {
    clearTimeout(timer);
  }
}

async function sendFcm(
  token: string,
  body: string,
  title: string,
): Promise<{ ok: boolean; status?: number; reason?: string }> {
  // FCM HTTP v1: OAuth2 bearer token (minted + cached from the service account)
  // POSTed to the project-scoped messages:send endpoint. Replaces the legacy
  // `/fcm/send` + `key=` API that Google decommissioned in 2024.
  const projectId = fcmProjectId();
  const accessToken = await getFcmAccessToken();
  if (!projectId || !accessToken) return { ok: false, reason: "fcm-not-configured" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token,
            notification: { title, body },
            android: {
              priority: "high",
              notification: { sound: "default" },
            },
          },
        }),
        signal: controller.signal,
      },
    );
    return { ok: res.ok, status: res.status };
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return { ok: false, reason: "fcm-timeout" };
    }
    return { ok: false, reason: String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export const run = internalAction({
  args: { announcementId: v.id("gym_announcements") },
  handler: async (
    ctx,
    { announcementId },
  ): Promise<{ delivered: number; failed?: number; reason?: string }> => {
    // Pull announcement metadata + recipient set via a single internal query.
    const meta = (await ctx.runQuery(
      internal.pushFanout.resolveTargets,
      { announcementId },
    )) as {
      gymName: string;
      senderName: string;
      body: string;
      targets: Target[];
    } | null;
    if (!meta || meta.targets.length === 0) {
      return { delivered: 0, reason: "no-tokens" };
    }

    const title = `${meta.senderName} · ${meta.gymName}`;
    const body =
      meta.body.length > 240 ? `${meta.body.slice(0, 237)}…` : meta.body;

    const results = await Promise.all(
      meta.targets.map(async (t: Target) => {
        if (t.platform === "ios") {
          return sendApns(t.token, {
            aps: {
              alert: { title, body },
              sound: "default",
              "thread-id": `gym-${announcementId}`,
              "mutable-content": 1,
            },
            data: {
              announcement_id: announcementId,
              gym_name: meta.gymName,
            },
          });
        }
        if (t.platform === "android") {
          return sendFcm(t.token, body, title);
        }
        return { ok: false as const, reason: "unsupported-platform" };
      }),
    );

    type Result = { ok: boolean; status?: number; reason?: string };
    const typedResults = results as Result[];
    const delivered = typedResults.filter((r) => r.ok).length;
    const failed = typedResults.length - delivered;

    // Prune any tokens APNs rejected as 410 Gone.
    const expiredTokens: string[] = [];
    typedResults.forEach((r, i) => {
      if (!r.ok && r.status === 410) expiredTokens.push(meta.targets[i].token);
    });
    if (expiredTokens.length > 0) {
      await Promise.all(
        expiredTokens.map((tk: string) =>
          ctx.runMutation(internal.device_tokens.removeTokenInternal, {
            token: tk,
          }),
        ),
      );
    }

    return { delivered, failed };
  },
});

// Internal `resolveTargets` query lives in `convex/pushFanout.ts` (V8 runtime).
