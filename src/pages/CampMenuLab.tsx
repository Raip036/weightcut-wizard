import { useLayoutEffect, useRef, useState } from "react";
import { Icon, type IonIconName } from "@/components/ui/Icon";
import { WizardAuroraBackground } from "@/components/onboarding/WizardAuroraBackground";

/* ------------------------------------------------------------------ *
 * THROWAWAY MOCK LAB - /camp-menu-lab
 *
 * Verifies the shipped Camp menu redesign (iOS-native grouped list) AND
 * that the onboarding tutorial spotlight still frames the new rows. The
 * spotlight sim mirrors TutorialStage.tsx exactly: getBoundingClientRect
 * of the [data-tutorial] target, SPOTLIGHT_PADDING = 10, rx/ry = 14,
 * scrim rgb(5,8,20) @ 0.88.
 *
 * Delete this file + its route after sign-off.
 * ------------------------------------------------------------------ */

interface MenuItem {
  title: string;
  subtitle: string;
  icon: IonIconName;
  tutorial?: string;
  locked?: boolean;
}

const ITEMS: MenuItem[] = [
  { title: "Training Calendar", subtitle: "Plan and log your sessions", icon: "calendarOutline", tutorial: "camp-training-calendar" },
  { title: "Fight Camps", subtitle: "Manage camps and phases", icon: "trophyOutline" },
  { title: "Gym Tracker", subtitle: "Exercises, volume and sets", icon: "barbellOutline", tutorial: "camp-gym-tracker" },
  { title: "Weight Protocol", subtitle: "Cut plan and rehydration", icon: "scaleOutline", tutorial: "camp-weight-protocol" },
  { title: "Training Library", subtitle: "Drills and techniques", icon: "bookOutline" },
  { title: "Recovery", subtitle: "Readiness and check-ins", icon: "pulseOutline", locked: true },
];

// Screenshot escape hatch: `?noaurora` renders the Recovery row without the
// live aurora so the page settles for static capture tooling.
const NO_AURORA =
  typeof window !== "undefined" && new URLSearchParams(window.location.search).has("noaurora");

function MenuIconChip({ icon }: { icon: IonIconName }) {
  return (
    <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[11px] bg-white/[0.05] border border-white/[0.07]">
      <Icon name={icon} size={20} className="text-foreground/80" />
    </div>
  );
}

/* The shipped grouped list, verbatim from Camp.tsx. */
function GroupedMenu() {
  return (
    <div className="card-surface rounded-2xl overflow-hidden">
      {ITEMS.map((tile, i) => {
        // Recovery is the premium Pro feature — it carries the blue wizard
        // aurora so it visibly stands apart from the calm neutral rows.
        const isRecovery = tile.title === "Recovery";
        return (
          <button
            key={tile.title}
            type="button"
            data-tutorial={tile.tutorial}
            className={`relative w-full overflow-hidden text-left transition-colors active:bg-white/[0.03] ${
              i > 0 ? "border-t border-white/[0.05]" : ""
            } ${isRecovery ? "bg-primary/[0.05]" : ""}`}
          >
            {isRecovery && !NO_AURORA && <WizardAuroraBackground intensity="full" />}
            <div className="relative z-10 flex items-center gap-3.5 px-3.5 py-3">
              <MenuIconChip icon={tile.icon} />
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-semibold text-foreground leading-tight tracking-tight">
                  {tile.title}
                </p>
                <p className="text-[12px] text-muted-foreground/70 leading-tight mt-0.5 truncate">
                  {tile.subtitle}
                </p>
              </div>
              {tile.locked ? (
                <span className="shrink-0 rounded-full bg-primary/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-primary">
                  Pro
                </span>
              ) : (
                <Icon name="chevronForwardOutline" size={15} className="text-muted-foreground/35 shrink-0" />
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}

/* A static mock of the TodayStrip circle row, with the per-pill tutorial
   anchors on the circles (matching the shipped TodayStrip fix). */
const STRIP = [
  { key: "weight", label: "Weight", icon: "speedometerOutline" as IonIconName, tutorial: "today-weight" },
  { key: "training", label: "Training", icon: "barbellOutline" as IonIconName },
  { key: "sleep", label: "Sleep", icon: "moonOutline" as IonIconName, tutorial: "today-sleep" },
  { key: "wellness", label: "Wellness", icon: "heartOutline" as IonIconName, tutorial: "today-wellness" },
  { key: "meals", label: "Meals", icon: "restaurantOutline" as IonIconName },
];

function MockTodayStrip() {
  return (
    <section data-tutorial="today-strip" className="relative">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/80">Today's log</p>
        <span className="text-[11px] text-muted-foreground">0/5 done</span>
      </div>
      <div className="relative flex items-start justify-between gap-2">
        {STRIP.map((p) => (
          <div key={p.key} className="relative z-10 flex flex-1 flex-col items-center gap-2">
            <span
              data-tutorial={p.tutorial}
              className="relative flex h-14 w-14 items-center justify-center rounded-full"
              style={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(0 0% 100% / 0.10)" }}
            >
              <Icon name={p.icon} size={22} className="text-muted-foreground" />
            </span>
            <span className="text-[11px] leading-none text-muted-foreground">{p.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

/* Spotlight overlay that mirrors the real tutorial geometry against a live
   [data-tutorial] target. Supports rect (rx/ry 14) and circle, matching
   TutorialStage. */
const SPOTLIGHT_PADDING = 10;
function SpotlightSim({ target, shape, pad = SPOTLIGHT_PADDING }: { target: string; shape: "rect" | "circle"; pad?: number }) {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const raf = useRef<number | null>(null);

  useLayoutEffect(() => {
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tutorial="${target}"]`);
      if (el) setRect(el.getBoundingClientRect());
    };
    measure();
    const onScroll = () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(measure);
    };
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [target]);

  if (!rect) return null;
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const r = Math.max(rect.width, rect.height) / 2 + pad;
  const x = rect.left - pad;
  const y = rect.top - pad;
  const w = rect.width + pad * 2;
  const h = rect.height + pad * 2;

  return (
    <div className="fixed inset-0 z-50 pointer-events-none">
      <svg className="w-full h-full">
        <defs>
          <mask id="lab-spot">
            <rect width="100%" height="100%" fill="white" />
            {shape === "circle" ? (
              <circle cx={cx} cy={cy} r={r} fill="black" />
            ) : (
              <rect x={x} y={y} width={w} height={h} rx={14} ry={14} fill="black" />
            )}
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgb(5,8,20)" opacity={0.88} mask="url(#lab-spot)" />
        {shape === "circle" ? (
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
        ) : (
          <rect x={x} y={y} width={w} height={h} rx={14} ry={14} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth={1} />
        )}
      </svg>
    </div>
  );
}

type Spot = { target: string; shape: "rect" | "circle"; pad?: number };

const MENU_SPOTS: Spot[] = [
  { target: "camp-training-calendar", shape: "rect" },
  { target: "camp-gym-tracker", shape: "rect" },
  { target: "camp-weight-protocol", shape: "rect" },
];
const STRIP_SPOTS: Spot[] = [
  { target: "today-strip", shape: "rect" },
  { target: "today-weight", shape: "circle", pad: 8 },
  { target: "today-sleep", shape: "circle", pad: 8 },
  { target: "today-wellness", shape: "circle", pad: 8 },
];

export default function CampMenuLab() {
  const [spot, setSpot] = useState<Spot | null>(null);
  const same = (a: Spot | null, t: string) => a?.target === t;

  const Chip = ({ s }: { s: Spot }) => (
    <button
      type="button"
      onClick={() => setSpot(same(spot, s.target) ? null : s)}
      className={`rounded-full px-3 py-1.5 text-[12px] font-semibold border transition-colors ${
        same(spot, s.target)
          ? "bg-white/10 border-white/20 text-foreground"
          : "bg-white/[0.04] border-white/[0.08] text-muted-foreground"
      }`}
    >
      {s.target.replace(/^(camp|today)-/, "")}
    </button>
  );

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-5 pt-4 pb-16">
        <header className="pt-1 pb-4">
          <p className="text-micro uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">Your</p>
          <h1 className="text-title font-semibold leading-tight">Camp · menu (shipped)</h1>
        </header>

        <MockTodayStrip />

        <div className="mt-6">
          <GroupedMenu />
        </div>

        {/* Spotlight test controls — tap to simulate each tutorial step. */}
        <div className="mt-6 space-y-3">
          <div>
            <p className="text-micro uppercase tracking-[0.15em] text-muted-foreground/60 font-bold mb-2">
              Menu spotlight (rect)
            </p>
            <div className="flex flex-wrap gap-2">
              {MENU_SPOTS.map((s) => <Chip key={s.target} s={s} />)}
            </div>
          </div>
          <div>
            <p className="text-micro uppercase tracking-[0.15em] text-muted-foreground/60 font-bold mb-2">
              Today strip spotlight (circle)
            </p>
            <div className="flex flex-wrap gap-2">
              {STRIP_SPOTS.map((s) => <Chip key={s.target} s={s} />)}
            </div>
          </div>
        </div>
      </div>

      {spot && <SpotlightSim target={spot.target} shape={spot.shape} pad={spot.pad} />}
    </div>
  );
}
