"use node";

/**
 * Curated technique / combo reference for the Training Missions generator
 * (anti-hallucination grounding — improvement #6).
 *
 * The generation model is told to compose drills ONLY from the techniques,
 * combinations, positions and constraint-games listed here for the relevant
 * discipline. It may still choose reps / rounds / cues freely, but it must
 * not invent techniques outside this vetted set. This keeps physically-
 * attempted advice biomechanically real for an audience that will try it.
 *
 * Pure data + string formatting — no Convex/Node deps, safe to import into
 * the node action. Keep entries concise and correct; this is a coach's
 * cheat-sheet, not an encyclopedia.
 */

export interface DisciplineReference {
  /** Canonical label used in the prompt header. */
  label: string;
  /** Named techniques / weapons / positions for this art. */
  techniques: string[];
  /** Canonical combinations (striking) or sequences (grappling). */
  combos: string[];
  /** Defensive / reactive tools that counter the noted problem. */
  defenses: string[];
  /** Situational-sparring constraint games that isolate a skill. */
  constraints: string[];
}

// Boxing numbering used across striking arts: 1 jab, 2 cross, 3 lead hook,
// 4 rear hook, 5 lead uppercut, 6 rear uppercut. Kicks/knees/elbows are
// named in words.
const REFERENCE: Record<string, DisciplineReference> = {
  "muay thai": {
    label: "Muay Thai",
    techniques: [
      "teep (push kick) — lead and rear",
      "roundhouse kick — low / body / head",
      "switch kick",
      "knees — straight, curving, in the clinch",
      "elbows — horizontal, up, spinning",
      "long guard (vs head kick / pressure)",
      "clinch / plum (double collar tie)",
      "check (shin block) the low/body kick",
    ],
    combos: [
      "1-2 (jab-cross)",
      "1-2-3 (jab-cross-lead hook)",
      "1-2-low kick",
      "1-2-3-low kick",
      "jab then low kick (1-low)",
      "cross-hook-low kick (2-3-low)",
      "teep then cross (set up with the teep, follow the cross)",
      "catch the teep then 2 (cross)",
      "long guard entry into a knee",
      "2 then horizontal elbow (2-elbow) in close",
    ],
    defenses: [
      "parry / scoop the teep with the lead hand, then step in",
      "catch the teep, sweep or counter as their foot drops",
      "check the low kick with the shin",
      "long guard to absorb and walk through head kicks",
      "off-balance / pummel for inside control in the clinch",
    ],
    constraints: [
      "kicking-range-only round: both stay long, score with kicks/teeps only",
      "clinch-only positional: start in the plum, hunt off-balances and knees",
      "defend-then-counter: you may only attack right after you block/parry/catch",
      "must exit on an angle after every exchange (no straight-line retreat)",
    ],
  },
  boxing: {
    label: "Boxing",
    techniques: [
      "jab (1) — to head and body",
      "cross (2)",
      "lead hook (3) / rear hook (4)",
      "lead uppercut (5) / rear uppercut (6)",
      "slip, roll (under hooks), shoulder roll, parry, catch, pull",
      "footwork — pivot, lateral step, cut the angle",
    ],
    combos: [
      "1-1 (double jab)",
      "1-2",
      "1-2-3 (jab-cross-lead hook)",
      "2-3-2 (cross-hook-cross)",
      "1-6-3 (jab-rear uppercut-lead hook)",
      "jab to the body then cross (1b-2)",
      "slip the cross then return 2 (slip-2)",
      "roll under the hook then 3 (roll-3)",
    ],
    defenses: [
      "slip outside the jab and counter 2",
      "catch the jab, parry the cross",
      "roll under the lead hook into a body shot",
      "pivot off the lead foot to escape the pocket",
    ],
    constraints: [
      "jab-only round (offense and defense built off the 1)",
      "body-only round: every shot lands below the chest",
      "defense-only then counter-only: one partner attacks, one only defends, then swap",
      "on-the-ropes escape: start trapped, work out via slip + pivot",
    ],
  },
  kickboxing: {
    label: "Kickboxing",
    techniques: [
      "jab (1) / cross (2) / hooks (3,4) / uppercuts (5,6)",
      "roundhouse kick — low / body / head",
      "front kick / push kick",
      "switch kick, question-mark kick",
      "check the low/body kick with the shin",
      "slip, roll, parry, footwork",
    ],
    combos: [
      "1-2-low kick",
      "1-2-3-head kick",
      "cross-hook-low kick (2-3-low)",
      "jab then rear roundhouse (1-kick)",
      "switch kick off a feinted jab",
      "catch the kick then 3-2",
    ],
    defenses: [
      "check the low kick with the shin, return your own kick",
      "catch the body/round kick then counter 3-2",
      "parry the jab and step in past their kicking range",
    ],
    constraints: [
      "kicks-only round, then hands-only round",
      "defend-then-counter: attack only after a block/check/catch",
      "must change levels (head/body/legs) every combination",
    ],
  },
  mma: {
    label: "MMA",
    techniques: [
      "boxing (1-6), low/body/head kicks, teeps, knees, elbows",
      "level change, penetration step, double leg, single leg, body lock",
      "sprawl, whizzer, underhooks, cage wrestling",
      "guard, half guard, side control, mount, back control",
      "ground-and-pound posture, submissions (RNC, armbar, triangle, guillotine)",
    ],
    combos: [
      "1-2 into a level change for the double leg",
      "low kick to set up the takedown (kick-shot)",
      "jab-cross then clinch to the body lock",
      "catch the kick then drive into a single leg",
      "post and pass to side control then ground-and-pound",
    ],
    defenses: [
      "sprawl and spin behind on the shot",
      "frame and hip-escape to recover guard",
      "underhook to wall-walk back up against the cage",
      "check the low kick, then counter or close to the clinch",
    ],
    constraints: [
      "cage-pin positional: one pins, one works back to centre",
      "shot-defense round: one only shoots, one only sprawls/defends, then swap",
      "stand-up-only with takedown threat (must defend the level change)",
      "ground positional from guard / side control, reset on pass or sweep",
    ],
  },
  bjj: {
    label: "Brazilian Jiu-Jitsu",
    techniques: [
      "positions: closed guard, open guard, half guard, side control, mount, back, knee-on-belly, turtle",
      "submissions: armbar, triangle, kimura, americana, guillotine, rear naked choke, cross-collar choke, omoplata, straight ankle lock",
      "sweeps: scissor, hip-bump, flower, butterfly elevator",
      "passes: knee-cut, torreando (bullfighter), leg drag, stack",
      "retention: hip escape (shrimp), knee shield, framing, granby roll",
    ],
    combos: [
      "hip escape to knee shield, then recover full guard",
      "scissor sweep, miss it, switch to hip-bump",
      "knee-cut pass; they frame, switch to the leg drag",
      "armbar from mount; they hide the arm, transition to the triangle",
      "kimura grip from side control: clear the cross-face and hip out BEFORE gripping the wrist",
    ],
    defenses: [
      "frame on the cross-face and hip-escape to recover guard",
      "two-on-one (Russian tie) to strip a grip",
      "underhook and turn-in to escape side control",
      "hide the elbow and re-pummel to stop the armbar",
    ],
    constraints: [
      "positional sparring from a fixed position, reset on escape/pass/sweep",
      "submission-only or sweep-only constraint round",
      "guard-retention game: passer vs retainer, reset when guard is passed",
      "grip-fight-first: must win the grip before any attack scores",
    ],
  },
  wrestling: {
    label: "Wrestling",
    techniques: [
      "stance and motion, level change, penetration step",
      "double leg, single leg, high crotch, ankle pick, snap down",
      "ties: collar tie, underhook, two-on-one (Russian tie), wrist control",
      "defense: sprawl, whizzer, hip heist, front headlock, spin-behind",
      "finishes: run the pipe, lift, far-ankle, dump",
    ],
    combos: [
      "snap down to a front headlock, then go-behind",
      "set up the collar tie, then shoot the high crotch",
      "fake the single, re-shoot the double",
      "sprawl on their shot, then spin behind to the back",
      "two-on-one to drag them past, take the back",
    ],
    defenses: [
      "sprawl heavy, hips down, then peel the hands and spin behind",
      "whizzer and limp-arm out of a single leg",
      "front headlock to stop the shot, then snap and circle",
      "hand-fight to break grips before they set their tie",
    ],
    constraints: [
      "ties-only hand-fighting round: win position, no shots",
      "shot-defense positional: one shoots, one only sprawls/defends, then swap",
      "down-man escape: start on bottom, work to escape or reverse on the whistle",
      "30s 'score from a tie' games from a neutral collar tie",
    ],
  },
  // Generic conditioning block for strength / running sessions — technique
  // combos don't apply; keep prescriptions concrete and load-aware instead.
  conditioning: {
    label: "Strength & Conditioning",
    techniques: [
      "compound lifts, plyometrics, sprints, interval/energy-system work",
      "core / grip / posterior-chain accessory work",
      "mobility and movement prep",
    ],
    combos: [
      "fight-specific intervals (e.g. 5x[3 min hard / 1 min easy] to mirror rounds)",
      "strength then power on the same movement (e.g. squat then jump)",
      "stay-technical-while-tired finisher (light skill work at high heart rate)",
    ],
    defenses: [],
    constraints: [
      "energy-system round matched to fight rounds (work:rest = round:break)",
      "technical-under-fatigue: perform a skill cleanly after a hard interval",
    ],
  },
};

// Generic striking + grappling fallback for "sparring" / unknown disciplines.
const GENERIC: DisciplineReference = {
  label: "Striking & Grappling (general)",
  techniques: [
    "striking: jab-cross-hooks-uppercuts (1-6), low/body/head kicks, teeps, knees",
    "defense: slip, parry, check the kick, frame, sprawl, hip escape",
    "grappling: level change, double/single leg, guard, side control, mount, back",
  ],
  combos: [
    "1-2-3 (jab-cross-lead hook)",
    "1-2-low kick",
    "catch the kick then counter 3-2",
    "level change off the 1-2 into a double leg",
    "hip escape to recover guard, then sweep",
  ],
  defenses: [
    "defend-then-counter off a block, parry or catch",
    "sprawl and spin behind on a takedown attempt",
    "frame and hip-escape to recover guard",
  ],
  constraints: [
    "defend-then-counter: attack only after a successful defence",
    "positional sparring from a fixed range or position, reset each rep",
    "single-trigger round: only score off one specific stimulus",
  ],
};

/** Replicates the sport-normalisation in src/lib/coachColors.ts so the
 *  grounding key matches the discipline the user logged. */
function referenceKey(sport: string): string {
  const key = (sport ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return "generic";
  if (key.includes("muay") || key === "thai") return "muay thai";
  if (key.includes("kick")) return "kickboxing";
  if (key.startsWith("box")) return "boxing";
  if (key.includes("mma") || key.includes("mixed")) return "mma";
  if (
    key.includes("bjj") ||
    key.includes("jiu") ||
    key.includes("grappl") ||
    key.includes("nogi") ||
    key.includes("no gi")
  )
    return "bjj";
  if (key.startsWith("wrest")) return "wrestling";
  if (
    key.startsWith("strength") ||
    key.includes("s&c") ||
    key.startsWith("run") ||
    key.includes("cardio") ||
    key.includes("condition")
  )
    return "conditioning";
  return "generic"; // "sparring" and any unknown discipline
}

/**
 * Build the TECHNIQUE REFERENCE prompt block for a discipline. Injected
 * into the generation stage so the model composes drills from vetted
 * primitives rather than inventing technique.
 */
export function buildGroundingBlock(sport: string): string {
  const ref = REFERENCE[referenceKey(sport)] ?? GENERIC;
  const lines: string[] = [
    `=== TECHNIQUE REFERENCE (${ref.label}) — compose drills ONLY from these; do NOT invent techniques outside this set. You may still choose reps, rounds, durations and cues. ===`,
    `Techniques / tools:`,
    ...ref.techniques.map((t) => `  - ${t}`),
    `Combinations / sequences:`,
    ...ref.combos.map((c) => `  - ${c}`),
  ];
  if (ref.defenses.length) {
    lines.push(`Defensive / counter tools:`);
    lines.push(...ref.defenses.map((d) => `  - ${d}`));
  }
  lines.push(`Situational-sparring constraint games:`);
  lines.push(...ref.constraints.map((c) => `  - ${c}`));
  return lines.join("\n");
}
