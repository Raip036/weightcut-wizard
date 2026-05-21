# Fight Camp Wizard — Design System v1

> Source of truth for the visual + interaction language used across the app.
> Lives at `docs/DESIGN_SYSTEM.md`. Keep it current when you add or change a
> token, component, or recipe.
>
> Figma file (mascot, palette, components, spacing reference):
> [Branding](https://www.figma.com/design/GdczXC0vxl2xADN7QzhoHy/Branding?node-id=67-2)

---

## 1. Philosophy

- **Dark only.** Light mode was removed entirely. `<html>` boots with the `.dark`
  class forced on at parse time (see `index.html`) and `--background` is a brand
  void (`#000513`), not neutral black.
- **Flat surfaces, deep palette.** Cards have no border and no shadow by default.
  Visual hierarchy comes from `neutral-800` (`#081225`) cards popping against the
  darker `--background`. Hero treatments add glow or gradient where deliberate.
- **One primary color.** All hero CTAs route through `Button variant="default"` =
  solid Spirit Blue. The 4-stop "Gradient CTA" was tried and removed — it read as
  cheap at button scale. Aurora / Cosmic / Mystic gradients are reserved for
  hero treatments (progress bars, splash, optional accents) not buttons.
- **Sora for display, Inter for body.** Global `@layer base` rule promotes every
  `<h1>`–`<h6>` to Sora; everything else inherits Inter.
- **Glass = nav + chat bubbles only.** Don't propose glassmorphism for other
  surfaces unsolicited. Cards are flat.
- **Mobile-first.** Touch targets stay ≥ 44px (Apple minimum) even when the
  Figma source says smaller. Spec is a guide, not gospel for touch hit areas.
- **Whimsy in moments, not ambient.** Bursts on achievement unlock, sparkles
  around the wizard mascot, the orb FAB itself — yes. An always-on ambient
  star field was tried and pulled (too noisy).

---

## 2. Color tokens

All defined in `src/index.css` `:root`. Reference via Tailwind shortcuts in
`tailwind.config.ts` (`bg-brand-spirit-blue`, `text-func-recovery-green`,
`border-neutral-700`, etc.).

### Brand palette
| Token | Hex | Tailwind class | Use |
|---|---|---|---|
| `--brand-spirit-blue` | `#4068EF` | `brand-spirit-blue` | Primary CTA, focus, link |
| `--brand-wizard-lilac` | `#8B7EEA` | `brand-wizard-lilac` | Active nav tab, sparkles |
| `--brand-dream-cyan` | `#4AB4ED` | `brand-dream-cyan` | Accent on day-counter text, secondary sparkles |
| `--brand-night-indigo` | `#080D20` | `brand-night-indigo` | Available; not heavily used |
| `--brand-void` | `#020811` | `brand-void` | Glass surface base, secondary button bg |

### Functional palette (status, macros)
| Token | Hex | Tailwind class | Use |
|---|---|---|---|
| `--func-danger-red` | `#F7403F` | `func-danger-red` | Destructive button, trend up (weight gain) |
| `--func-warning-yellow` | `#FAC146` | `func-warning-yellow` | Reserved for warnings |
| `--func-recovery-green` | `#23C599` | `func-recovery-green` | Trend down (weight loss), success |
| `--func-carbs-orange` | `#F08439` | `func-carbs-orange` | Carbs macro |
| `--func-fats-purple` | `#7B31EA` | `func-fats-purple` | Fats macro |
| `--func-protein-blue` | `#2A5BDD` | `func-protein-blue` | Protein macro |
| `--func-hydration-cyan` | `#12CAE6` | `func-hydration-cyan` | Hydration, sodium |

### Neutral scale
| Token | Hex | Tailwind class | Use |
|---|---|---|---|
| `--neutral-100` | `#E2E5F2` | `neutral-100` | Borders on Secondary button |
| `--neutral-200` | `#DEDEF7` | `neutral-200` | Default text on dark buttons |
| `--neutral-400` | `#8C96B4` | `neutral-400` | Inactive nav icons (legacy), avatar text |
| `--neutral-500` | `#4D5877` | `neutral-500` | Body / Caption color (low emphasis) |
| `--neutral-700` | `#162137` | `neutral-700` | Avatar background, progress-bar track variant |
| `--neutral-800` | `#081225` | `neutral-800` | **Standard card surface** |
| `--neutral-900` | `#030B18` | `neutral-900` | Crystal-glass progress track |
| `--neutral-1000` | `#000513` | `neutral-1000` | Page background (`--background`) |

### Page background

```css
/* index.css */
--background: 224 100% 4%;     /* ≈ #000513 (HSL form for shadcn convention) */
```

The previous `.dark body { background-color: hsl(0 0% 4%); }` hardcoded
override is removed; body now uses `hsl(var(--background))` so the page picks
up `#000513` consistently.

---

## 3. Gradients

| Token | Stops | Tailwind class | Use |
|---|---|---|---|
| `--gradient-aurora` | `#4068EF → #2A5BDD → #4AB4ED` | `bg-gradient-aurora` | Crystal-glass progress fill |
| `--gradient-cosmic` | `#7B31EA → #F08439` | `bg-gradient-cosmic` | Hero accents (optional) |
| `--gradient-mystic` | `#4068EF → #020811` | `bg-gradient-mystic` | Ambient backgrounds (optional) |

The 4-stop **Gradient CTA** (`#4068EF → #8B7EEA → #D96CB8 → #F08439`) was
removed — see Philosophy.

---

## 4. Glass recipes

Two glass surfaces. Both live in `:root` in `src/index.css` and have utility
classes in `@layer components`.

### `.glass-nav` (bottom navigation)
```css
--glass-surface:         rgba(8, 12, 20, 0.62);
--glass-blur:            blur(50px) saturate(160%);
--glass-border:          1px solid rgba(255, 255, 255, 0.08);
--glass-inset-highlight: inset 0 1px 0 0 rgba(255, 255, 255, 0.10);
--glass-shadow:          0 -8px 32px 0 rgba(0, 0, 0, 0.45);
```

Plus an **internal gradient overlay** inside the nav pill (see `BottomNav.tsx`):
```jsx
<div className="absolute inset-0 rounded-pill pointer-events-none"
     style={{ background: "linear-gradient(180deg, rgba(20,24,35,0.18), rgba(8,12,20,0.32))" }} />
```

### `.glass-bubble` (wizard chat bubbles, future use)
```css
--glass-bubble-surface:  rgba(8, 13, 32, 0.55);
--glass-bubble-blur:     blur(24px) saturate(150%);
--glass-bubble-border:   1px solid rgba(255, 255, 255, 0.12);
--glass-bubble-inset:    inset 0 1px 0 0 rgba(255, 255, 255, 0.14);
--glass-bubble-shadow:   0 8px 32px 0 rgba(0, 0, 0, 0.45);
```

Both classes have a `@supports not (backdrop-filter)` fallback that thickens
the surface to ~94% so the glass element still reads as solid on older WebKit.

---

## 5. Typography

### Families
| Family | Use | Loaded via |
|---|---|---|
| **Sora** (Variable 100–800) | Display, all `<h1>`–`<h6>` | `public/fonts/sora/Sora-Variable.woff2`, `@font-face` in index.css |
| **Inter** (Variable 100–900) | Body, labels, UI default | `public/fonts/inter/Inter-Variable.woff2`, `@font-face` in index.css |
| Satoshi (legacy) | 3 share-card components only | Kept on disk for `html-to-image` PNG export; should not be used in new UI |

Tailwind:
- `font-sans` → Inter (default)
- `font-display` → Sora
- Global rule in `@layer base`: `h1, h2, h3, h4, h5, h6 { @apply font-display; }`

### Type scale (Figma)
| Token | Size / line-height | Letter spacing | Family |
|---|---|---|---|
| `text-display-1` | 40 / 48 | −0.02em | Sora ExtraBold |
| `text-display-2` | 32 / 40 | −0.02em | Sora ExtraBold |
| `text-heading-1` | 24 / 32 | −0.01em | Sora Bold |
| `text-heading-2` | 20 / 28 | −0.01em | Sora SemiBold |
| `text-subheading` | 16 / 24 | — | Inter SemiBold |
| `text-body` | 16 / 24 | — | Inter Regular |
| `text-caption` | 12 / 16 | — | Inter Regular |
| `text-overline` | 10 / 14 | 0.08em | Inter Medium (uppercase) |

### App-UI scale (additional, IA agent additions)
| Token | Size / line-height | Use |
|---|---|---|
| `text-micro` | 11 / 16 | Eyebrows, small labels |
| `text-note` | 13 / 20 | Secondary text, captions |
| `text-body-sm` | 15 / 22 | Body in compact UI |
| `text-value` | 18 / 24 | Numeric values, small headings |
| `text-title` | 22 / 28 | Page titles ("Your / Camp", "Your / Nutrition") |

---

## 6. Radius scale

```ts
borderRadius: {
  xs: "var(--radius-xs)",   //  8px — default for cards, buttons, chips
  s:  "var(--radius-s)",    // 12px
  m:  "var(--radius-m)",    // 16px
  l:  "var(--radius-l)",    // 20px
  xl: "var(--radius-xl)",   // 24px
  pill: "var(--radius-full)", // 999px — nav pill, avatars, badges
}
```

⚠️ **Do not use `rounded-l` to mean "L size"** — Tailwind interprets `rounded-l`
as the directional shorthand for left-only corners. Always prefix with a side
or use a different token name when in doubt.

Migration note: the app still has ~588× `rounded-2xl` and ~133× `rounded-xl`
left over from the shadcn defaults. Sweeping these to `rounded-xs` is the
single highest-ROI consistency PR remaining.

---

## 7. Components

### Button (`src/components/ui/button.tsx`)
6 variants, all rounded-xs, h-11 default size (44px min).

| Variant | Use | Look |
|---|---|---|
| `default` | Primary CTAs | Spirit Blue solid, hover `#5078F5`, pressed `#2A4ACC` |
| `secondary` | Quiet alternative | Void surface, solid 1px neutral-100 border |
| `outline` | Tertiary | Void surface, 0.5px translucent border |
| `destructive` | Delete, sign out | Danger Red solid |
| `ghost` | Inline / icon | Transparent, neutral hover |
| `link` | Inline text link | Spirit Blue, underline on hover |

The `cta` (gradient) variant was removed — all CTAs use `default`.

### Card (`src/components/ui/card.tsx`)
Single flat recipe. No border, no shadow.
```tsx
"rounded-xs bg-neutral-800 text-card-foreground transition-colors duration-200"
```
CardTitle renders in Sora Bold (`font-display font-bold`) automatically.

Global CSS rule (`@layer components`) extends this to ALL `.glass-card`,
`.card-surface`, `.bg-card`, `[data-sidebar="sidebar"]`,
`[role="dialog"]:not([data-alert-dialog])`, `.popover-content` so legacy class
usages inherit the same flat surface without per-call-site changes.

### Progress (`src/components/ui/progress.tsx`)
Crystal-glass tube. `neutral-900` track, Aurora gradient fill, translucent
shimmer sweeping inside the fill on a 2.6s loop. Uses the
`progress-shimmer` keyframe defined in `tailwind.config.ts`.

### OrbSpinner (`src/components/ui/orb-spinner.tsx`)
Brand-tinted loading orb. Use anywhere you'd normally reach for `<Loader2>`.
```tsx
<OrbSpinner size={24} label="Loading" />
```
Migration is incremental — `Loader2` is still in ~10 files.

### Floating glass navigation (`src/components/BottomNav.tsx`)
Pill-shaped, fixed-bottom, frosted glass. Single-bubble pattern — one
`motion.div` whose `x` + `width` animate to the active tab's measured rect.
Per-tab tap micro-animations defined in a module-scope `TAP_ANIMATIONS`
table (Home pulse / Nutrition shake / Gym hop / Weight wobble / More squish).

**Important** — see Gotchas: the nav pill itself must be a static element
(no transform / will-change / opacity animation on the same element or any
ancestor) or the backdrop-filter silently disables in WKWebView.

### Tutorial overlay (`src/tutorial/*`)
- **TutorialProgressBar**: single continuous crystal-glass bar at top
- **TutorialNav**: Back (Outline) + Next (Spirit Blue solid), screen-centered
  in its own bottom container (NOT inside the speech-bubble column)
- **SpeechBubble**: compact (`px-4 py-3`, `text-[12.5px]` body, `text-[14px]`
  headline) so it doesn't crowd the nav row
- **Skip pill**: Void bg + glass blur, top-right

### Floating wizard chat (`src/components/FloatingWizardChat.tsx`)
Orb FAB (64×64) with brand drop-shadow glow, gentle bobbing, 3 sparkles
drifting around it when the user has paid access. Uses `src/assets/orb.png`.

### Welcome landing (`src/pages/Index.tsx`)
3D wizard mascot (`src/assets/wizard_3D.png`, 300×300) with 5 sparkles + soft
glow. Sora 34px headline / Inter 13px subhead. CTA stack pinned bottom.

---

## 8. Patterns

### Sparkle burst on achievement unlock
See `src/components/dashboard/MilestoneBadges.tsx` → `SparkleBurst`. 8
Sparkles fly outward at evenly distributed angles over 600ms with slight
per-particle delay. Triggered via `useRef` tracking previous unlocked state
— only fires on transition false → true, never on mount.

### Floating mascot motion
```tsx
<motion.img
  animate={{ y: [0, -6, 0] }}
  transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
/>
```
Use for orb FAB, wizard hero, any "alive" character.

### Glow halo via drop-shadow filter
```tsx
style={{
  filter:
    "drop-shadow(0 12px 24px rgba(64, 104, 239, 0.35)) " +
    "drop-shadow(0 4px 12px rgba(0, 0, 0, 0.5))",
}}
```
Lilac/cyan halo on dark surfaces. Strengthen the inner shadow for closer
glow, the outer for atmosphere.

---

## 9. Gotchas (lessons learned the hard way)

### WKWebView disables `backdrop-filter` when any ancestor has a transform
The Capacitor iOS WebView silently ignores `backdrop-filter` on an element if
that element OR any ancestor has `transform`, `will-change: transform`,
animated opacity, or `filter`. Even an identity transform left over from a
Framer Motion animation that completed is enough.

**Rule:** the glass-nav element must be a plain `<div>`, not a `<motion.div>`.
Mount it in a static wrapper; render any entrance animation on a sibling or
child, never on the glass element or its ancestors. The nav pill currently
lives as a static `<div>` for exactly this reason.

See: https://bugs.webkit.org/show_bug.cgi?id=212706

### Tailwind opacity modifiers on brand/func/neutral tokens
`bg-brand-wizard-lilac/20`, `border-func-danger-red/30`, `text-neutral-500/60`
all work correctly. The `--brand-*`, `--func-*`, and `--neutral-*` CSS vars
are stored as space-separated RGB triplets (e.g. `139 126 234`) and the
Tailwind theme wraps them as `rgb(var(--x) / <alpha-value>)` so the `/N`
modifier composes alpha.

Direct uses of `var(--brand-*)` etc. in inline `style={}` or CSS must wrap
in `rgb(...)`:

```css
/* ✗ broken — renders nothing, because the var is just "139 126 234" */
background: var(--brand-wizard-lilac);

/* ✓ works */
background: rgb(var(--brand-wizard-lilac));
background: rgb(var(--brand-wizard-lilac) / 0.12);
```

Legacy notes about the `bg-[rgba(...)]` inline-rgba workaround can be
ignored — they predate the token format change. Prefer the Tailwind
class with `/N` modifier in new code.

### `rounded-l` is the directional shorthand, not the L-size token
Adding a custom `l: "var(--radius-l)"` borderRadius theme entry conflicts
with Tailwind's built-in `rounded-l` (left corners only). We hit this on
the active-tab nav bubble — only the left corners rounded.

**Fix:** use `rounded-pill` or `rounded-xs` etc. Never use `rounded-l` as
a size token.

### SVG `stroke` attribute doesn't reliably resolve CSS vars in WKWebView
Tailwind classes (`text-func-protein-blue`) work fine because they compile
to `color`. But raw SVG `stroke="var(--func-protein-blue)"` is flaky on iOS.

**Fix:** hardcode hex values in SVG `stroke`/`fill` attributes. The macro
rings, donuts, and trend arrows do this — the hex is duplicated with a
comment pointing back to the token.

### Forced-dark + ThemeToggle
Dark mode is forced unconditionally at parse time in `index.html`. The
`ThemeToggle` component was neutralized to `return null` but its export is
preserved so the 3 import sites compile. Full removal is on the TODO list.

### Worktree iOS file noise
`ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved`
constantly shows as modified when Xcode resolves SwiftPM deps. Add this to a
local pre-commit habit:
```bash
git checkout -- ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved
```
Same for the bundle-ID change you may have made locally for device signing
— don't commit those.

---

## 10. Migration status

| Surface | Done | Remaining |
|---|---|---|
| **Color tokens** | Brand / functional / neutral palettes defined; macros + dehydration migrated | Many raw Tailwind hex codes (`#22c55e`, `#ef4444`, `#f59e0b`, etc.) still in 20+ files |
| **Font family** | Sora on h1–h6 via global rule; Inter as default | None — done |
| **Radius** | New scale defined; nav, buttons, cards, Dashboard use `rounded-xs` | ~588× `rounded-2xl` + 133× `rounded-xl` to sweep |
| **Card surface** | Base shadcn Card + global `.card-surface` rule flat; Dashboard, Gym, Profile, WeightTracker migrated | 8 files still using `bg-card/N`; some shadcn primitives untouched |
| **Buttons** | All 6 variants updated to v1 palette | Many `<button>` elements with hand-rolled classes (not using `<Button>`) |
| **Loading states** | `OrbSpinner` exists | `<Loader2>` still in ~10 files |
| **Page background** | `--background` set to `#000513` everywhere | None — done |
| **Light mode** | Removed | None — done |

---

## 11. Open work

**Highest impact (small effort):**
1. Radius sweep — `rounded-2xl/xl/lg` → `rounded-xs` on card-shaped elements
2. Body font weight — most text is `font-semibold` by default; switch to `font-normal` and reserve `font-semibold` for labels/CTAs
3. Raw-hex Tailwind palette sweep to `func-*` tokens

**Medium effort:**
4. `<Loader2>` → `<OrbSpinner>` codemod
5. `bg-card/N` → `bg-neutral-800` in the 8 stragglers
6. Motion vocabulary file (`src/lib/motion.ts`) standardising 2 easings + 3 durations

**Larger:**
7. **PR 8 — Wizard speech bubbles**: rebuild the SVG-as-image bubbles in
   `src/tutorial/SpeechBubble.tsx` + `src/components/FloatingWizardChat.tsx`
   as real CSS divs with true `backdrop-filter` for the glass effect.
8. Delete `ThemeToggle.tsx` and its 3 call sites (it's a no-op now).
9. Migrate the 3 share-card components off hardcoded Satoshi.

---

## 12. References

- Figma source: [Branding file](https://www.figma.com/design/GdczXC0vxl2xADN7QzhoHy/Branding?node-id=67-2)
  (accessible via the Figma MCP — file key `GdczXC0vxl2xADN7QzhoHy`, design
  system node `67:2`)
- Tokens: `src/index.css` (`:root` block)
- Tailwind theme: `tailwind.config.ts`
- Memory notes (Claude sessions): `~/.claude/projects/-Users-nyreemarsh-weightcut-wizard/memory/`
