"use node";

import { PostHog } from "posthog-node";

/**
 * Creates a PostHog client configured for short-lived serverless invocations
 * (Convex actions). flushAt=1 and flushInterval=0 ensure events are sent
 * immediately without buffering. Always call `await client.shutdown()` after
 * your capture calls.
 */
export function createPostHogClient(): PostHog | null {
  const apiKey = process.env.POSTHOG_API_KEY;
  const host = process.env.POSTHOG_HOST;
  if (!host) return null;
  if (!apiKey) return null;
  return new PostHog(apiKey, {
    host,
    flushAt: 1,
    flushInterval: 0,
    enableExceptionAutocapture: true,
  });
}
