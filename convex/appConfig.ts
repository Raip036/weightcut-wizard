import { v } from "convex/values";
import { query, internalMutation } from "./_generated/server";

const KEY = "global";

/** PUBLIC, no-auth: the client reads this to decide whether to show the
 *  maintenance screen. Returns false when no row exists yet. */
export const getMaintenance = query({
  args: {},
  handler: async (ctx): Promise<{ enabled: boolean; message: string | null }> => {
    const row = await ctx.db
      .query("app_config")
      .withIndex("by_key", (q) => q.eq("key", KEY))
      .first();
    return { enabled: row?.maintenanceEnabled ?? false, message: row?.message ?? null };
  },
});

/** INTERNAL — toggled only from the CLI / admin, never from the client:
 *    npx convex run appConfig:setMaintenance '{"enabled":true}'
 *    npx convex run appConfig:setMaintenance '{"enabled":false}'
 *  Optional message: '{"enabled":true,"message":"Back at 5pm"}' */
export const setMaintenance = internalMutation({
  args: { enabled: v.boolean(), message: v.optional(v.string()) },
  handler: async (ctx, { enabled, message }): Promise<{ enabled: boolean }> => {
    const row = await ctx.db
      .query("app_config")
      .withIndex("by_key", (q) => q.eq("key", KEY))
      .first();
    if (row) {
      await ctx.db.patch(row._id, { maintenanceEnabled: enabled, message, updatedAt: Date.now() });
    } else {
      await ctx.db.insert("app_config", { key: KEY, maintenanceEnabled: enabled, message, updatedAt: Date.now() });
    }
    return { enabled };
  },
});
