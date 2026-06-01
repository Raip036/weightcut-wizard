/**
 * Sports-science research blocks interpolated into the AI system prompt
 * for weight-protocol generation. Static module — no logic, just two
 * exported strings consumed by:
 *   - convex/actions/generateFightPlan.ts (WP-T6)
 *   - convex/actions/generateRehydrationProtocol.ts (WP-T7)
 *
 * These ground Claude on real research instead of letting it invent numbers.
 * Section headers are stable so the AI can parse and cite them back.
 */

export const FIGHT_PLAN_RESEARCH: string = `## CARB DEPLETION
Standard taper: 3g/kg (T-7..T-6) → 2g/kg (T-5) → 1g/kg (T-4) → <50g/day (T-3..T-0).
~1.5-2% BM loss from this lever alone. Glycogen binds ~3g water per gram, so
depleting 300-500g glycogen liberates 1.2-2L water.
ISSN 2025 minimum during camp: 3.0-4.0 g/kg carbs, 1.2-2.0 g/kg protein. Below
50g/day for >7 days risks performance and lean-mass losses — do not extend.
Source: Reale GSSI SSE #183 (2018); ISSN 2025 position stand (PMC11894756).

## WATER LOADING + RESTRICTION
Reale 2018 protocol: 100 mL/kg/day for 3 days (load), then 15 mL/kg on D-1 (restrict).
Adds ~0.6-1% BM loss vs restriction alone. Hyponatremia rare under this protocol
(intakes >10L in <6h are the actual danger pattern).
D-1 floor: 15 mL/kg (~1L for 70kg athlete). Weigh-in day: <300mL total.
Always scale by mL/kg, never prescribe absolute litres without scaling.
Source: Reale et al. 2018 IJSNEM (PMID 29182412); Reale GSSI SSE #183.

## SODIUM REDUCTION
Start at D-2 (48h out) — earlier is counterproductive (chronic depletion hurts
water loading). Targets (practitioner convention, NOT peer-reviewed):
D-2: 1000 mg/day. D-1: <500 mg/day. D-0: near zero.
Post-weigh-in: 50-90 mmol/L Na+ ORS at 1-1.5 L/hr (ISSN 2025).
Hyponatremia danger: sodium reduction + continued high water intake. Never combine.
Source: ISSN 2025; Reale GSSI SSE #183; Maughan & Leiper 1995.

## FIBRE REDUCTION
<10 g/day for 48-96h → ~1-1.5% BM from clearing gut residue.
D-4 to D-3: transition to low-residue (~15g). D-2: <10g. D-1: <5g.
Eliminate: whole grains, legumes, raw veg (esp. cruciferous), fruits with skins,
nuts, seeds, high-FODMAP foods (onion, garlic, asparagus, mushrooms).
DO NOT recommend laxatives (magnesium citrate) — electrolyte loss, cramping,
unpredictable timing. Flag as high-risk if user asks.
Source: Reale GSSI SSE #183; ISSN 2025; Burke et al. BJSM 2017.

## SAUNA / HEAT — FINAL 1-3 KG ONLY
NOT for first 4kg of a cut. Standard: 10-15 min sessions, 5-10 min cool-downs,
total ≤30-45 min, max 1-3 sessions in final 24h. Always supervised.
NCAA wrestler deaths in 1997 (3 in 6 weeks) all from sauna + sweat suit + fluid
restriction stacking. Never stack heat with laxatives or aggressive water cuts.
HWI alternative: 37.8°C immersion 20min + 40min wrap, repeated once. Epsom salt
shows no significant added effect over plain hot water (Barley 2020).
Source: ISSN 2025; Barley 2020/2022; Oppliger 1996 ACSM.

## TRAINING TAPER
Last moderate session: T-7. Reduced technical T-6 to T-5. Last skill work T-4.
Movement only T-3 to T-1. Rest weigh-in day. Continued hard training during
glycogen depletion destroys CNS recovery and post-weigh-in performance.
Source: Reale GSSI SSE #183; Mujika & Padilla 2003 tapering.

## SLEEP & CAFFEINE
Target 8-9h/night through fight week; expect degradation D-1 onward.
Caffeine taper: halve normal intake by D-3, eliminate by D-1. Reintroduce
strategically post-weigh-in at 3-6 mg/kg ~60 min pre-walkout.
Dehydration disrupts sleep via dry mucous membranes, cramping, cortisol.
Source: Reale GSSI SSE #183; Carr et al. JISSN; Grgic 2020 ISSN caffeine stand.

## SAFETY THRESHOLDS
Unsupervised cap: 5% BM. Supervised cap: 8% BM (Burke BJSM 2017 consensus).
UFC PI claims up to 10% achievable with supervision but never recommend >10%.
Female: cap 1-2% below male equivalents. Account for luteal-phase 1-2kg retention.
First-time cutter: 3-5% BM max, diet/water levers only, no heat.
ABORT triggers: orthostatic hypotension, mental confusion, dark/brown urine,
chest pain, HR >100 bpm resting, vomiting, syncope.
Source: Burke et al. BJSM 2017; UFC PI Vol 1 (2018) Vol 2 (2021); Brechney 2023 JISSN.

## UNCERTAINTY FLAGS — DO NOT INVENT
Specific mg/day sodium targets: practitioner convention, not peer-reviewed.
Day-by-day absolute water litres (without mL/kg scaling): NEVER do this.
Magnesium citrate "safe" doses for fight week: none exist in literature.
Caffeine "detox" timelines specific to combat: general sport-science only.
When uncertain, output: "This is practitioner convention, not established by
peer-reviewed research — consult your nutrition coach before relying on this
number."

## TONE FOR THE ATHLETE
Second person. No emojis. No hedging. Each *Copy field ≤ 140 chars, single
sentence. The athlete reads this at 6am dehydrated and tired — write so they
can act on it in 4 seconds.`;

export const REHYDRATION_RESEARCH: string = `## THE DIY ORAL REHYDRATION SOLUTION
Combat-adapted WHO ORS, per 1 liter of water (hypotonic, ~245 mOsm/L):
- 30-50 g glucose (sugar / dextrose / maltodextrin) — energy + SGLT1 cotransport
- 1.0-1.5 g table salt (NaCl) — 400-600 mg sodium
- 0.5 g lite salt / NoSalt (KCl) — ~260 mg potassium
- 1/2 lemon juice — citrate buffer + palatability
SGLT1 cotransport pulls Na+ and glucose together; water follows osmotically.
Without glucose, sodium absorption slows. Without sodium, water sits in lumen
and can trigger diarrhea. Hypotonic > isotonic > hypertonic for rapid uptake.
Total volume target = 150% of mass lost.
Pacing cap: ≤1000 mL/hr in H+0..H+2, ≤800 mL/hr thereafter.
Source: WHO/UNICEF (2006); Shirreffs & Maughan 2000; Hunt et al. 1992.

## COMMERCIAL EQUIVALENTS (when DIY isn't practical)
LMNT (1000mg Na/sachet, 200mg K, no carbs — pair with rice/banana).
Liquid I.V. (500mg Na, 370mg K, 11g sugar).
DripDrop (330mg Na, 185mg K, 7g sugar).
Pedialyte (1035mg Na/L, 780mg K, 25g sugar — closest to true WHO ORS).

## CARB REFUELING (POST-CUT GLYCOGEN REPLENISHMENT)
Window 1 (H+0..H+4): 1.0-1.2 g/kg/hr high-GI carbs. White rice, white bread,
bagels, mashed potato, dextrose, maltodextrin, sports gels.
Window 2 (H+4..H+12): taper to 0.6-0.8 g/kg/hr around meals.
Window 3 (H+12..H+24): normal meals.
24-hour total: 8-10 g/kg body weight.
AVOID in window 1: brown rice, oats, beans, lentils, high-fibre breads, anything
with significant fat (slows gastric emptying).
Protein: 0.3-0.4 g/kg every 3-4 hours regardless. 4:1 carb:protein ratio is
ONLY helpful when carb intake is suboptimal — when carbs maxed, adding protein
doesn't speed glycogen further (modern consensus).
Source: Burke 2017 J Appl Physiol; Jeukendrup 2014 Sports Med; Ivy 2002 (historical 4:1).

## SODIUM TIMING — A CURVE NOT A BOLUS
H+0..H+4: 800-1500 mg/hr (front-load plasma volume expansion).
H+4..H+12: 400-600 mg/hr (intracellular phase, potassium becomes important).
H+12..H+24: 200-400 mg/hr (maintenance with normal meals).
24-hour total: 8,000-15,000 mg depending on cut depth.
Stop if nausea — vomiting reverses all rehydration progress.
Source: Maughan & Leiper 1995; Shirreffs et al. 1996 MSSE; UFC PI 2018/2021.

## DO NOTS — STARK SAFETY LIST
- Chugging plain water → suppresses ADH, dilutional hyponatremia. Combat fatality:
  Leandro Souza 2013.
- High-fat heavy meals in H+0..H+4 → slows gastric emptying to a crawl.
- Aggressive caffeine before rehydration is underway → mildly diuretic.
- Spicy / high-fibre / raw veg / beans → GI risk during a vomiting-catastrophic window.
- Alcohol → diuretic, hepatic burden, impairs glycogen synthesis (Crowe 2014).
- Overhydrating beyond 200% of mass lost → bloating, slow footwork, rare hyponatremia.

## CRAMP + PRE-FIGHT TACTICS
Magnesium glycinate 200-400 mg evening before (weak evidence but generally safe).
Pickle juice 30-60 ml for acute cramp relief in ~85 seconds (oropharyngeal reflex,
not electrolytes — Miller 2010). Sodium broth 200-400 ml as palatable Na vehicle.
Caffeine: 3-6 mg/kg 45-60 min pre-walkout. Lower end for caffeine-naive.
Source: Miller 2010 MSSE; Schwellnus 2009 BJSM; Grgic 2020 ISSN.

## FEEL CHECKS
Urine: pale straw (1-2 on 8-point chart). Frequency: every 2-3 hours by H+6.
Weigh-back: 80-100% of mass lost. Over pre-cut weight by >1-2% = overhydration.
Subjective: thirst gone, not bloated, normal mental sharpness, no facial puffiness.
Last solid food 3-4 hours pre-walkout. Last meaningful drink 30 min out.
Empty bladder 5-10 min before walking out.
Source: Armstrong 1994 IJSN; Cheuvront & Sawka 2005 GSSI.

## CUT-DEPTH VARIATION
<3% BM: standard protocol simplified, 1.5× mass-lost fluid sufficient.
3-5%: full standard protocol, 24h gap recommended.
5-8%: extended timeline mandatory, aggressive Na front-loading. Performance
recovery on <8h gap is UNLIKELY — warn the athlete.
>8%: not validated by published research. Medical disclaimer first, then survival
floor framing — not a performance protocol.

## UNCERTAINTY FLAGS — DO NOT INVENT
Exact mg/hr sodium for an individual athlete: ranges only, never single numbers.
DIY ORS dosages outside the 30-50g glucose / 1-1.5g NaCl / 0.5g KCl envelope:
do not extrapolate. IV rehydration: prohibited by USADA/WADA above 100mL/12h
unless medically indicated — never recommend.
Glycogen-restoration timelines for <8h weigh-in-to-fight gaps: extrapolated from
endurance literature, not validated in combat sports.
When uncertain, output: "This is practitioner convention, not established by
peer-reviewed research — consult your nutrition coach before relying on this
number."

## TONE FOR THE ATHLETE
Second person. No emojis. No hedging. The athlete reads this between weigh-in
and fight while exhausted and hungry. Each *Copy field ≤ 140 chars, single sentence.
keyAction: imperative, ≤80 chars. Cautions: max 3, each ≤80 chars.`;
