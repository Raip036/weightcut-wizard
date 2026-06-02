// T19: FightWeekFormCard — third and final share template in the recovery
// family. Fired by useFightWeekTrigger when daysToFight === 7 (auto-toast
// 7 days before the user's logged fight date). Celebrates the peaking arc:
// last 5 days of readiness rendered as a vertical bar chart with a
// deterministic "PEAKING ON SCHEDULE" / "FORM CURVE BUILDING" /
// "FORM CURVE DROPPING" status banner.
//
// Mirrors ReadinessFlexCard + ComebackCard visually (CardShell + tabular-
// nums numerics, uppercase eyebrows, story aspect, watermark via
// CardShell.isPremium) so the export reads as a sibling of the existing
// share-card family.
//
// Spec reference: docs/superpowers/specs/2026-06-01-recovery-page-redesign-design.md
// §7.3.c — "FightWeekFormCard". Free tier gets the card watermarked; Pro
// strips the watermark. There's no rate limit — fight week is an event,
// not a recurring action.
import { forwardRef } from "react";
import { CardShell, type AspectRatio } from "../templates/CardShell";

export type FormCurveStatus = "peaking" | "building" | "dropping";

interface FightWeekFormCardProps {
  /** ISO-resolved fight date — drives header copy + bottom meta line. */
  fightDate: Date;
  /** 0–7 inclusive; how many days until the fight. The trigger fires at 7
   *  but we accept the full range so a manual re-open later in the week
   *  still renders honestly. */
  daysOut: number;
  /** Oldest → newest. Length up to 5; nulls render as dimmed empty bars
   *  so a partial history still ships a coherent card. */
  last5Days: Array<{ date: Date; score: number | null }>;
  /** e.g. "@ortiz" — pulled from active camp metadata. The camp schema
   *  currently only carries `eventName`/`name`, not an opponent handle, so
   *  the dashboard passes whichever exists. Rendered without an `@` prefix
   *  if the caller already trimmed one in. */
  opponentHandle?: string;
  /** "@pratik" — derived in the dashboard from UserContext, same as T17/T18. */
  userHandle?: string;
  /** When true: omit watermark + handle (Pro). When false: render both. */
  isPro: boolean;
  aspect?: AspectRatio;
}

// Status banner palette — green for on-pace, amber for neutral build,
// red for a regression so the eye reads the verdict before the bars do.
const STATUS_LABEL: Record<FormCurveStatus, string> = {
  peaking: "PEAKING ON SCHEDULE",
  building: "FORM CURVE BUILDING",
  dropping: "FORM CURVE DROPPING",
};
const STATUS_COLOR: Record<FormCurveStatus, string> = {
  peaking: "#22c55e",
  building: "#f59e0b",
  dropping: "#ef4444",
};

// Deterministic, no-AI status calculation. Kept here (next to the card)
// so the card stays self-contained for the export pipeline; the trigger
// hook re-uses the same exported helper when it builds the toast preview.
export function computeFormCurveStatus(
  scores: Array<number | null>,
): FormCurveStatus {
  // All 5 present + each day ≥ previous - 5 (allow small dips) + today ≥ 75.
  const allPresent = scores.length === 5 && scores.every((s) => s != null);
  if (allPresent) {
    const vals = scores as number[];
    const today = vals[vals.length - 1];
    let monotone = true;
    for (let i = 1; i < vals.length; i++) {
      if (vals[i] < vals[i - 1] - 5) {
        monotone = false;
        break;
      }
    }
    if (monotone && today >= 75) return "peaking";
  }

  // Drop check: today < oldest-with-a-score - 10. We hunt for the oldest
  // non-null instead of assuming index 0 so a partial history still
  // surfaces the regression honestly.
  const today = scores[scores.length - 1];
  if (today != null) {
    let oldest: number | null = null;
    for (const s of scores) {
      if (s != null) {
        oldest = s;
        break;
      }
    }
    if (oldest != null && today < oldest - 10) return "dropping";
  }

  return "building";
}

export const FightWeekFormCard = forwardRef<HTMLDivElement, FightWeekFormCardProps>(
  function FightWeekFormCard(
    {
      fightDate,
      daysOut,
      last5Days,
      opponentHandle,
      userHandle,
      isPro,
      aspect = "story",
    },
    ref,
  ) {
    const s = aspect === "story";

    // Header countdown — "6 DAYS OUT" / "FIGHT DAY" — the trigger fires at
    // 7 but a manual re-open later in the week should still read correctly.
    const countdownLabel =
      daysOut <= 0
        ? "FIGHT DAY"
        : daysOut === 1
          ? "1 DAY OUT"
          : `${daysOut} DAYS OUT`;

    // Bottom meta line — "@pratik vs @ortiz · 6.10". Drop pieces gracefully
    // if any are missing so the line doesn't collapse to a single dot.
    const fightDateLabel = `${fightDate.getMonth() + 1}.${fightDate.getDate()}`;
    const matchupPieces: string[] = [];
    if (userHandle) matchupPieces.push(userHandle);
    if (opponentHandle) {
      matchupPieces.push(userHandle ? `vs ${opponentHandle}` : opponentHandle);
    }
    const matchupLine = [matchupPieces.join(" "), fightDateLabel]
      .filter(Boolean)
      .join(" · ");

    const status = computeFormCurveStatus(last5Days.map((d) => d.score));
    const statusColor = STATUS_COLOR[status];
    const statusLabel = STATUS_LABEL[status];

    return (
      <CardShell ref={ref} aspect={aspect} isPremium={isPro}>
        {/* ── Header strip ──────────────────────────────────────────
            Two-row eyebrow — "FIGHT WEEK" sits on its own line so the
            countdown carries the visual weight. Wide tracking matches
            the rest of the share-card family. */}
        <div style={{ marginBottom: s ? 48 : 28 }}>
          <div
            style={{
              fontSize: s ? 22 : 14,
              fontWeight: 700,
              letterSpacing: "0.32em",
              textTransform: "uppercase",
              color: "rgba(255,255,255,0.55)",
              marginBottom: s ? 10 : 6,
            }}
          >
            Fight Week
          </div>
          <div
            style={{
              fontSize: s ? 56 : 32,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: "#ffffff",
              fontVariantNumeric: "tabular-nums",
              lineHeight: 1,
            }}
          >
            {countdownLabel}
          </div>
        </div>

        {/* ── 5-day bar chart ───────────────────────────────────────
            Vertical bars, oldest → newest left → right. Each bar is
            label + filled track. Null scores render as a dim empty
            track + "—" so a partial week still ships a coherent card. */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            gap: s ? 18 : 10,
            marginBottom: s ? 48 : 28,
            // Fixed-height chart row so the bars share a baseline even
            // when the dashboard hands us fewer than 5 entries.
            height: s ? 520 : 320,
            alignItems: "end",
          }}
        >
          {last5Days.map((d, i) => (
            <DayBar
              key={i}
              date={d.date}
              score={d.score}
              accent={statusColor}
              story={s}
            />
          ))}
        </div>

        {/* ── Status banner ─────────────────────────────────────────
            Centered, color-tinted by status. The deterministic
            calculation lives in computeFormCurveStatus above so the
            card stays purely presentational. */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: s ? 48 : 28,
          }}
        >
          <div
            style={{
              fontSize: s ? 34 : 20,
              fontWeight: 800,
              letterSpacing: "0.16em",
              color: statusColor,
              textAlign: "center",
              // Pill-style outline so the banner reads as a tagged
              // verdict, not a sentence. Same vocabulary as the
              // ComebackCard "COMEBACK" eyebrow.
              padding: s ? "16px 28px" : "10px 18px",
              border: `${s ? 3 : 2}px solid ${statusColor}`,
              borderRadius: s ? 16 : 10,
            }}
          >
            {statusLabel}
          </div>
        </div>

        {/* ── Matchup meta line ─────────────────────────────────────
            "@pratik vs @ortiz · 6.10" — sits at the bottom of the
            content stack, above the watermark CardShell renders for
            free tier. Pro tier still gets this line; only the
            watermark + handle differ. */}
        {matchupLine && (
          <div
            style={{
              marginTop: "auto",
              marginBottom: s ? 100 : 60,
              fontSize: s ? 28 : 18,
              fontWeight: 700,
              letterSpacing: "0.04em",
              color: "rgba(255,255,255,0.65)",
              fontVariantNumeric: "tabular-nums",
              textAlign: "center",
            }}
          >
            {matchupLine}
          </div>
        )}

        {/* ── User handle (free tier only) ──────────────────────────
            Bottom-right pairing with the CardWatermark that CardShell
            renders. Pro tier omits both. The matchup line above
            already carries @userHandle when present, so this is a
            redundant signature for the watermark area — matches the
            sibling cards' bottom-right handle pattern. */}
        {!isPro && userHandle && (
          <div
            style={{
              position: "absolute",
              right: s ? 56 : 40,
              bottom: s ? 96 : 56,
              fontSize: s ? 22 : 14,
              fontWeight: 600,
              color: "rgba(255,255,255,0.45)",
              letterSpacing: "0.04em",
              pointerEvents: "none",
            }}
          >
            {userHandle}
          </div>
        )}
      </CardShell>
    );
  },
);

FightWeekFormCard.displayName = "FightWeekFormCard";

// ── DayBar ────────────────────────────────────────────────────────────
// One column of the 5-day chart: label below + filled track that grows
// from the baseline up to `score/100`. Null score = dim empty track + "—".
interface DayBarProps {
  date: Date;
  score: number | null;
  accent: string;
  story: boolean;
}

function DayBar({ date, score, accent, story }: DayBarProps) {
  const pct = score == null ? 0 : Math.max(0, Math.min(1, score / 100));
  const weekday = date
    .toLocaleDateString("en-US", { weekday: "short" })
    .toUpperCase();
  const display = score == null ? "—" : Math.round(score).toString();
  const isNull = score == null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: story ? 12 : 8,
        height: "100%",
        justifyContent: "flex-end",
      }}
    >
      {/* Score number above the bar — tabular-nums so the column
          widths don't jitter between two- and three-digit days. */}
      <div
        style={{
          fontSize: story ? 32 : 20,
          fontWeight: 800,
          color: isNull ? "rgba(255,255,255,0.3)" : "#ffffff",
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1,
        }}
      >
        {display}
      </div>

      {/* The track itself fills the remaining column height. The fill
          grows from the bottom so the bars read as data, not as a
          progress meter. */}
      <div
        style={{
          width: "100%",
          flex: 1,
          background: "rgba(255,255,255,0.06)",
          borderRadius: story ? 10 : 6,
          overflow: "hidden",
          display: "flex",
          alignItems: "flex-end",
        }}
      >
        <div
          style={{
            width: "100%",
            height: `${pct * 100}%`,
            background: isNull ? "rgba(255,255,255,0.12)" : accent,
            borderRadius: story ? 10 : 6,
            // Subtle gradient on filled bars so the "data" reads as
            // luminous against the dark card body. Skipped for nulls
            // (no signal to celebrate).
            backgroundImage: isNull
              ? undefined
              : `linear-gradient(180deg, ${accent} 0%, ${accent}cc 100%)`,
          }}
        />
      </div>

      {/* Day label below the bar. */}
      <div
        style={{
          fontSize: story ? 22 : 14,
          fontWeight: 700,
          letterSpacing: "0.14em",
          color: "rgba(255,255,255,0.55)",
        }}
      >
        {weekday}
      </div>
    </div>
  );
}
