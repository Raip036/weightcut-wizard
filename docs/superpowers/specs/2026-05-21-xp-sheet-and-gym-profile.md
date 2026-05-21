# XP Level sheet + Gym profile sheet

**Status:** Approved 2026-05-21. Two independent surfaces shipped together.

## A. XP Level sheet

### Trigger

Tap the existing `<XpSummaryCard>` "Your level" tile on `/camp`. Wrap the card in a button that opens `<LevelSheet>`.

### Layout — `src/components/coach/LevelSheet.tsx` (new)

`<Sheet>` with `<SheetContent side="bottom" className="h-[92vh] rounded-t-2xl flex flex-col">`. Header uses `SheetHeader` + `SheetTitle "Your level"`. Body is `flex-1 overflow-y-auto scrollbar-hide` with `paddingBottom: max(env(safe-area-inset-bottom), 6rem)`.

Sections (top to bottom):

1. **All disciplines** — every row from `useQuery(api.user_discipline_xp.getAllForUser)`. Each row: `<LevelRing size={48}>` + discipline label (coloured via `disciplineToken`) + `Lv N` chip + XP `{currentLevelXp} / {nextLevelXp}` tabular-nums. Empty state: "Train and log notes to start earning XP."

2. **How to earn XP** — three small `card-surface rounded-xs p-3` rows. Each shows:
   - +10 XP — Log a session in the Training Calendar
   - +20 XP — Tick a Training Coach mission item
   - +100 XP — Complete an entire mission

3. **What it means** — 1-paragraph explainer below "How to earn XP". Plain `text-note text-muted-foreground`. Copy: "Each discipline tracks its own progress so the work you put into BJJ stays separate from your Muay Thai or strength. Level thresholds widen as you climb — early levels come quickly, advanced ones take real consistency."

4. **Streak** — reuse `computeStreak` from `useGamification` (already exposed via hook). Render: flame icon + "{N}-day streak". Subtle muted card.

5. **Achievements (preview)** — 2×2 grid of the top 4 `MilestoneBadges` (already in `useGamification`). Tap header → opens existing `<AchievementSheet>` (don't reinvent).

6. **Daily XP challenges (v1 — hardcoded)** — 3 challenges displayed as progress rows. v1 doesn't track actual completion; the rows show:
   - "Log a session today" (+25 XP bonus shown as future intent)
   - "Tick 3 mission items today" (+50 XP)
   - "Write notes for 1 session" (+15 XP)
   Each = small card with checkbox + label + bonus pill. Marked "Coming soon" if no live tracking yet. Out of scope: actually awarding the bonus XP (deferred to a future cron + table).

## B. Gym profile sheet

### Changes to `src/components/community/GymHeader.tsx`

- Add `<GymLogoAvatar gymId={gymId} src={logoUrl} size={44} />` (the existing rounded-xs avatar component) to the LEFT of the title block.
- Wrap the `flex items-start` left cluster (logo + title + counts) in a `<button>` that calls `onProfileOpen()` (new prop). Right cluster (`ActivityBell`) stays separate.
- New optional props on `GymHeader`: `logoUrl: string | null`, `onProfileOpen: () => void`. Defaults so the component still works if props omitted.

### New component — `src/components/community/GymProfileSheet.tsx`

`<Sheet>` with `<SheetContent side="bottom" className="h-[92vh] rounded-t-2xl flex flex-col">`. Body:

1. **Hero** — large `<GymLogoAvatar size={80}>` (rounded-xs) + gym name + location (with `<MapPin className="h-3.5 w-3.5">` and grey location text) + coach name (smaller, "Coached by {name}").

2. **About** — `gym.about` description text. If empty, show a small grey "No description yet" placeholder.

3. **Disciplines** — chips row of `gym.disciplines[]` (if present). Each chip uses the existing discipline colour token (`coachColors.disciplineToken`).

4. **Members ({count})** — header micro label + scrollable list. Each row: 32px round avatar + display name. Plain `text-body-sm text-foreground`. No role chip in v1 (per user choice). Members render in `listMembersForActiveMember` order (server-side sort by joinedAt asc).

### Backend additions — `convex/gym_members.ts`

Add a new query alongside the existing `listForGym`:

```ts
export const listMembersForActiveMember = query({
  args: { gymId: v.id("gyms") },
  handler: async (ctx, { gymId }) => {
    const userId = await requireUserId(ctx);
    // Caller must be an active member of this gym.
    const membership = await ctx.db
      .query("gym_members")
      .withIndex("by_gym_user", q => q.eq("gymId", gymId).eq("userId", userId))
      .first();
    if (!membership || membership.status !== "active") throw new Error("Not authorized");

    const rows = await ctx.db
      .query("gym_members")
      .withIndex("by_gym", q => q.eq("gymId", gymId))
      .collect();
    const active = rows.filter(r => r.status === "active").sort((a, b) => a.joinedAt - b.joinedAt);
    return Promise.all(active.map(async (r) => {
      const profile = await ctx.db.query("profiles").withIndex("by_user", q => q.eq("userId", r.userId)).first();
      let avatarUrl: string | null = null;
      if (profile?.avatarStorageId) avatarUrl = await ctx.storage.getUrl(profile.avatarStorageId);
      return {
        userId: r.userId,
        displayName: profile?.displayName ?? "Member",
        avatarUrl,
      };
    }));
  },
});
```

No schema changes required.

### Wiring in `src/pages/Community.tsx`

- Pull `logo_url` from `getById(gymId)` (already exposed).
- Pass `logoUrl` + `onProfileOpen={() => setProfileSheetOpen(true)}` to `<GymHeader>`.
- Render `<GymProfileSheet gymId={gymId} open={profileSheetOpen} onOpenChange={setProfileSheetOpen} />` at the same level.

## Out of scope (v1)

- Daily XP challenge tracking + bonus XP awards (placeholder UI only)
- Belt/rank tiers per discipline (level numbers are the v1 ladder)
- Gym member roles in the list (coach vs athlete)
- Per-member tap → individual profile page

## Testing

Playwright after both agents return:
- Tap "Your level" tile → sheet opens with all sections visible at 390×844 mobile
- Tap gym header on Community → profile sheet opens with logo + about + member list
- Confirm 0 console errors on both
