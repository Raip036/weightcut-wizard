/**
 * GymSessionCard: shareable image card for a completed gym session.
 *
 * Visual language matches TrainingCalendarCard:
 *  - FightCamp Wizard brand header (from CardShell)
 *  - Centred period label: session type up top, "date · duration" sub-line
 *  - Equal flex spacers around the hero stats so they sit halfway between
 *    header and exercise list
 *  - Strava-style hero column: Exercises / Sets / Volume stacked vertically,
 *    huge bold white numbers
 *  - Bottom block: one row per exercise with GitHub-contribution-style green
 *    cubes, one cube per set, intensity scaled to weight relative to the
 *    session's heaviest set so the user's hardest lifts visually pop
 *
 * Aspect handling:
 *  - Square (1080×1080): tighter cube size, up to 8 exercise rows
 *  - Story  (1080×1920): bigger cubes, up to 12 exercise rows
 *
 * The "top set" for each exercise is the heaviest non-warm-up set (tie-
 * broken by reps). Warm-ups always render at intensity level 0; work sets
 * scale across 4 levels of green based on (weight / session max).
 */
import { forwardRef, useMemo } from "react";
import { CardShell, type AspectRatio } from "../templates/CardShell";
import { StravaStat, StravaPeriodLabel } from "../templates/StravaStat";
import { usePremium } from "@/hooks/usePremium";
import type { ExerciseGroup, GymSet, SessionType } from "@/pages/gym/types";

interface GymSessionCardProps {
  sessionType: SessionType | string;
  date: string;
  durationMinutes: number | null;
  exerciseGroups: ExerciseGroup[];
  totalVolume: number;
  aspect?: AspectRatio;
  transparent?: boolean;
}

// GitHub contribution palette (dark theme). Five steps from "no activity"
// (warm-up / bodyweight) up to "peak" (top set in the session). Index 0 is
// reserved for warm-ups so they read as a discount on the rest of the row.
const GH_COLORS_DARK = ["#161b22", "#0e4429", "#006d32", "#26a641", "#39d353"];
// Transparent mode sits over a photo backdrop, so we tilt the palette
// brighter and lean on a faint white border to keep cubes legible against
// uncontrolled imagery.
const GH_COLORS_TRANSPARENT = ["rgba(255,255,255,0.18)", "#1a7f3c", "#26a641", "#39d353", "#5dee75"];

// Choose the "best" set: heaviest non-warm-up; tie-break by reps. Pure
// bodyweight sets count as weight=0 so bodyweight exercises surface the
// highest-rep set.
function pickTopSet(sets: GymSet[]): GymSet | null {
  const eligible = sets.filter((s) => !s.is_warmup);
  if (eligible.length === 0) return null;
  return [...eligible].sort((a, b) => {
    const aw = a.weight_kg ?? 0;
    const bw = b.weight_kg ?? 0;
    if (bw !== aw) return bw - aw;
    return b.reps - a.reps;
  })[0];
}

function formatVolumeForCard(volume: number): string {
  if (volume >= 10000) return `${(volume / 1000).toFixed(1)}k`;
  return Math.round(volume).toLocaleString();
}

function formatDateLabel(dateStr: string): string {
  try {
    const d = new Date(dateStr + "T12:00:00");
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[d.getMonth()]} ${d.getDate()}`;
  } catch {
    return dateStr;
  }
}

function formatWeightLabel(kg: number | null, isBodyweight: boolean): string {
  if (isBodyweight) return "BW";
  if (kg === null || kg === 0) return "-";
  const formatted = kg % 1 === 0 ? `${kg}` : kg.toFixed(1);
  return `${formatted}kg`;
}

interface RowData {
  name: string;
  // Per-set intensity levels (0-4) used to paint the cubes.
  setLevels: number[];
  // Top-set weight label (e.g. "100kg", "BW") shown next to the cubes so
  // the actual lift is legible at a glance, not just the heatmap.
  topWeightLabel: string;
}

export const GymSessionCard = forwardRef<HTMLDivElement, GymSessionCardProps>(
  ({ sessionType, date, durationMinutes, exerciseGroups, totalVolume, aspect = "square", transparent }, ref) => {
    const { isPremium } = usePremium();
    const s = aspect === "story";

    // Session-wide max weight powers the cube intensity scale. Falls back to
    // the heaviest exercise-local set when nothing is loaded with weight.
    const sessionMaxWeight = useMemo(() => {
      let max = 0;
      for (const g of exerciseGroups) {
        for (const set of g.sets) {
          if (set.is_warmup) continue;
          const w = set.weight_kg ?? 0;
          if (w > max) max = w;
        }
      }
      return max;
    }, [exerciseGroups]);

    const rows = useMemo<RowData[]>(() => {
      return exerciseGroups.map((g) => {
        const setLevels = g.sets.map((set) => {
          if (set.is_warmup) return 0;
          // Bodyweight / unweighted work sets land at level 2 so they still
          // read as "work done" without faking absolute intensity.
          const w = set.weight_kg ?? 0;
          if (sessionMaxWeight <= 0 || w <= 0) return 2;
          const ratio = w / sessionMaxWeight;
          if (ratio >= 1) return 4;
          if (ratio >= 0.75) return 3;
          if (ratio >= 0.5) return 2;
          return 1;
        });
        const top = pickTopSet(g.sets);
        const topWeightLabel = top
          ? formatWeightLabel(top.weight_kg, top.is_bodyweight)
          : "-";
        return { name: g.exercise.name, setLevels, topWeightLabel };
      });
    }, [exerciseGroups, sessionMaxWeight]);

    const totalSets = useMemo(
      () =>
        rows.reduce(
          (sum, r) => sum + r.setLevels.filter((lvl) => lvl > 0).length,
          0,
        ),
      [rows],
    );

    // Show every exercise, no truncation. Past a comfortable row count the
    // text shrinks proportionally so a 12- or 15-exercise session still fits
    // the card cleanly rather than clipping or pushing into the bottom
    // brand area.
    const visibleRows = rows;

    // Pick a uniform scale based on the row count. ≤8 rows = full size
    // (matches the design baseline the user signed off on). Beyond that the
    // whole row block (text + weight column + cubes + gaps) compresses by
    // the same factor so proportions stay consistent.
    const ROW_COMFORT_THRESHOLD = 8;
    const rowCount = rows.length;
    const scale = rowCount <= ROW_COMFORT_THRESHOLD
      ? 1
      : Math.max(0.55, ROW_COMFORT_THRESHOLD / rowCount);

    const cubeSize = Math.round((s ? 32 : 20) * scale);
    const cubeGap = Math.max(3, Math.round((s ? 7 : 5) * scale));
    const cubeRadius = Math.max(2, Math.round((s ? 6 : 4) * scale));
    const rowGap = Math.max(6, Math.round((s ? 20 : 12) * scale));
    const nameFontSize = Math.round((s ? 60 : 28) * scale);
    const weightFontSize = Math.round((s ? 48 : 24) * scale);
    // Fixed width for the weight column: keeps "100kg" lined up across
    // every row regardless of how many cubes the row has. Scales with the
    // text so the column doesn't waste space when the type shrinks.
    const weightColumnWidth = Math.round((s ? 220 : 110) * scale);
    // Shrink the bottom block's own padding alongside the text so dense
    // sessions don't pay double for the bordered container's chrome.
    const blockPaddingY = Math.round((s ? 28 : 14) * (0.7 + 0.3 * scale));
    const blockPaddingX = Math.round((s ? 32 : 18) * (0.7 + 0.3 * scale));

    const palette = transparent ? GH_COLORS_TRANSPARENT : GH_COLORS_DARK;
    const durationLabel = durationMinutes != null && durationMinutes > 0 ? `${durationMinutes} min` : null;
    const subLine = durationLabel ? `${formatDateLabel(date)} · ${durationLabel}` : formatDateLabel(date);
    const volumeDisplay = formatVolumeForCard(totalVolume);

    return (
      <CardShell ref={ref} aspect={aspect} isPremium={isPremium} transparent={transparent}>
        <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
          {/* Period label: session type as the title, date·duration sub-line */}
          <StravaPeriodLabel text={String(sessionType).toUpperCase()} s={s} transparent={transparent} />
          <div
            style={{
              marginTop: s ? -28 : -10,
              marginBottom: s ? 16 : 6,
              textAlign: "center",
              fontSize: s ? 22 : 13,
              fontWeight: 600,
              letterSpacing: "0.08em",
              color: transparent ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.45)",
              textTransform: "uppercase",
            }}
          >
            {subLine}
          </div>

          {/* Top spacer pushes the vertical stats group down */}
          <div style={{ flex: 1, minHeight: s ? 24 : 8 }} />

          {/* Vertical stats column: Strava style, stacked. */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: s ? 28 : 12,
            }}
          >
            <StravaStat label="Exercises" value={String(rows.length)} s={s} transparent={transparent} />
            <StravaStat label="Sets" value={String(totalSets)} s={s} transparent={transparent} />
            <StravaStat label="Volume" value={volumeDisplay} unit="kg" s={s} transparent={transparent} />
          </div>

          {/* Bottom spacer mirrors the top one so the stat column sits
              roughly half-way between header and the exercise grid below. */}
          <div style={{ flex: 1, minHeight: s ? 24 : 8 }} />

          {/* Bottom: GitHub-style per-exercise rows. Cubes scale in green
              intensity with set weight relative to the session's heaviest
              set, so the user's hardest lifts visually pop.

              Negative inline margins break the block out of CardShell's
              horizontal padding so the exercise list fills more of the
              card's bottom area, keeping the cubes large and legible at
              export resolution. */}
          <div
            style={{
              background: transparent ? "rgba(0,0,0,0.3)" : "rgba(255,255,255,0.03)",
              border: transparent ? "1px solid rgba(255,255,255,0.18)" : "1px solid rgba(255,255,255,0.06)",
              borderRadius: s ? 24 : 12,
              padding: `${blockPaddingY}px ${blockPaddingX}px`,
              marginInline: s ? -32 : -20,
              marginBottom: s ? 12 : 4,
            }}
          >
            {visibleRows.length === 0 ? (
              <div
                style={{
                  textAlign: "center",
                  fontSize: s ? 24 : 15,
                  fontWeight: 600,
                  color: transparent ? "rgba(255,255,255,0.7)" : "rgba(255,255,255,0.35)",
                  padding: s ? 24 : 12,
                }}
              >
                No exercises logged
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: rowGap }}>
                {visibleRows.map((row, i) => (
                  // Row layout: [name flex:1] [cubes content-sized] [weight
                  // fixed width, right-aligned]. The weight is the LAST
                  // child so its right edge sits flush with the row's right
                  // edge; with a fixed weight column width, its left edge
                  // is constant across every row regardless of how many
                  // cubes precede it, so 100kg / 60kg / BW all line up
                  // vertically.
                  <div
                    key={`${i}-${row.name}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: s ? 24 : 12,
                    }}
                  >
                    <div
                      style={{
                        fontSize: nameFontSize,
                        fontWeight: 500,
                        color: "#ffffff",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        letterSpacing: "-0.02em",
                        lineHeight: 1.05,
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      {row.name}
                    </div>
                    {/* Set cubes: sit between the name and the weight
                        column so the weight column stays anchored right. */}
                    <div
                      style={{
                        display: "flex",
                        gap: cubeGap,
                        flexShrink: 0,
                      }}
                    >
                      {row.setLevels.map((lvl, j) => (
                        <div
                          key={j}
                          style={{
                            width: cubeSize,
                            height: cubeSize,
                            borderRadius: cubeRadius,
                            background: palette[lvl] ?? palette[0],
                            // A faint inset border keeps cubes legible on
                            // both the dark gradient and transparent photo
                            // backgrounds without bleeding into the row gap.
                            boxShadow: transparent
                              ? "inset 0 0 0 1px rgba(255,255,255,0.18)"
                              : "inset 0 0 0 1px rgba(255,255,255,0.04)",
                          }}
                        />
                      ))}
                    </div>
                    {/* Top set weight: primary-tinted hero accent. Fixed
                        column width + right alignment keeps every weight
                        in one tidy vertical column regardless of cube
                        count above/below. */}
                    <div
                      style={{
                        width: weightColumnWidth,
                        flexShrink: 0,
                        textAlign: "right",
                        fontSize: weightFontSize,
                        fontWeight: 800,
                        color: "hsl(var(--primary))",
                        fontVariantNumeric: "tabular-nums",
                        letterSpacing: "-0.02em",
                        lineHeight: 1.05,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {row.topWeightLabel}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardShell>
    );
  },
);

GymSessionCard.displayName = "GymSessionCard";
