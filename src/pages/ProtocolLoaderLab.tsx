import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import wizard from "@/assets/wizard_3D.png";

/* ------------------------------------------------------------------ *
 * Protocol Loader Lab (dev-only, route: /protocol-loader-lab)
 *
 * Premium, blue + wizard themed loading-animation options for the Weight
 * Protocol generation window (5-15s). Pick one to replace the current
 * ProtocolGeneratingOverlay. Not wired into the app.
 * ------------------------------------------------------------------ */

const BLUE = "217 91% 58%";
const hsl = (a = 1) => `hsl(${BLUE} / ${a})`;

const STEPS = [
  "Reading your body and training load",
  "Computing the weight-loss math",
  "Drafting your day-by-day taper",
  "Tuning your rehydration timeline",
];

/** Rotating status line that cycles the generation steps. */
function RotatingStatus({ interval = 2600 }: { interval?: number }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % STEPS.length), interval);
    return () => clearInterval(t);
  }, [interval]);
  return (
    <div className="h-5 overflow-hidden text-center">
      <motion.p key={i} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-[13px] text-muted-foreground">
        {STEPS[i]}
      </motion.p>
    </div>
  );
}

/** Thin shimmer progress bar (indeterminate). */
function ShimmerBar() {
  return (
    <div className="mt-4 h-1 w-40 mx-auto rounded-full overflow-hidden" style={{ background: hsl(0.12) }}>
      <motion.div className="h-full w-1/2 rounded-full" style={{ background: `linear-gradient(90deg, transparent, ${hsl(1)}, transparent)` }} animate={{ x: ["-100%", "200%"] }} transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }} />
    </div>
  );
}

function Wizard({ size = 96 }: { size?: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.img
      src={wizard}
      alt=""
      draggable={false}
      style={{ width: size, height: size, objectFit: "contain", position: "relative", zIndex: 2, filter: `drop-shadow(0 0 18px ${hsl(0.45)})` }}
      animate={reduced ? { y: 0 } : { y: [0, -8, 0] }}
      transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }}
    />
  );
}

/* ── Variation A — Aurora Wizard ── */
function VariantAurora() {
  const reduced = useReducedMotion();
  const motes = useMemo(() => Array.from({ length: 7 }, (_, i) => ({ id: i, x: (i * 47) % 160 - 80, delay: (i % 5) * 0.6, dur: 6 + (i % 4), size: 4 + (i % 3) * 2 })), []);
  return (
    <LoaderFrame label="A · Aurora Wizard">
      {/* aurora wash */}
      {!reduced && (
        <motion.div aria-hidden className="absolute inset-0" style={{ background: `radial-gradient(120% 70% at 50% 100%, ${hsl(0.28)}, transparent 70%)` }} animate={{ opacity: [0.6, 1, 0.6], scale: [1, 1.06, 1] }} transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }} />
      )}
      {/* rising motes */}
      {!reduced && motes.map((m) => (
        <motion.span key={m.id} aria-hidden className="absolute rounded-full" style={{ left: `calc(50% + ${m.x}px)`, bottom: 0, width: m.size, height: m.size, background: hsl(0.7), filter: "blur(0.5px)", boxShadow: `0 0 8px ${hsl(0.9)}` }} initial={{ y: 0, opacity: 0 }} animate={{ y: -220, opacity: [0, 1, 0] }} transition={{ duration: m.dur, repeat: Infinity, ease: "easeOut", delay: m.delay }} />
      ))}
      {/* halo + wizard */}
      <div className="relative flex items-center justify-center">
        {!reduced && (
          <motion.div aria-hidden className="absolute" style={{ width: 150, height: 150, borderRadius: "50%", background: `radial-gradient(circle, ${hsl(0.5)} 0%, ${hsl(0.15)} 40%, transparent 70%)`, filter: "blur(8px)" }} animate={{ opacity: [0.5, 0.85, 0.5], scale: [0.95, 1.08, 0.95] }} transition={{ duration: 3.4, repeat: Infinity, ease: "easeInOut" }} />
        )}
        <Wizard />
      </div>
      <p className="mt-3 text-[10px] uppercase tracking-[0.22em] font-bold" style={{ color: hsl() }}>Conjuring your protocol</p>
      <div className="mt-1"><RotatingStatus /></div>
      <ShimmerBar />
    </LoaderFrame>
  );
}

/* ── Variation B — Spell Orbit (conic spinner + orbiting motes) ── */
function VariantOrbit() {
  const reduced = useReducedMotion();
  const orbiters = useMemo(() => [0, 120, 240].map((angle, i) => ({ angle, dur: 2.4 + i * 0.6, r: 64 })), []);
  return (
    <LoaderFrame label="B · Spell Orbit">
      <div className="relative flex items-center justify-center" style={{ width: 170, height: 170 }}>
        {/* conic spinner ring */}
        {!reduced && (
          <motion.div aria-hidden className="absolute inset-0" style={{ borderRadius: "50%", background: `conic-gradient(from 0deg, transparent 0deg, ${hsl(0.7)} 90deg, transparent 200deg, transparent 360deg)`, WebkitMask: "radial-gradient(circle, transparent 60%, #000 62%, #000 70%, transparent 72%)", mask: "radial-gradient(circle, transparent 60%, #000 62%, #000 70%, transparent 72%)" }} animate={{ rotate: 360 }} transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }} />
        )}
        {/* dashed counter-rotating ring */}
        {!reduced && (
          <motion.div aria-hidden className="absolute" style={{ inset: 10, borderRadius: "50%", border: `1px dashed ${hsl(0.4)}` }} animate={{ rotate: -360 }} transition={{ duration: 9, repeat: Infinity, ease: "linear" }} />
        )}
        {/* orbiting motes */}
        {!reduced && orbiters.map((o, i) => (
          <motion.div key={i} aria-hidden className="absolute inset-0" animate={{ rotate: [o.angle, o.angle + 360] }} transition={{ duration: o.dur, repeat: Infinity, ease: "linear" }}>
            <span className="absolute left-1/2 top-1/2 rounded-full" style={{ width: 6, height: 6, marginLeft: -3, marginTop: -3, transform: `translateY(-${o.r}px)`, background: hsl(1), boxShadow: `0 0 8px ${hsl(0.9)}` }} />
          </motion.div>
        ))}
        <Wizard size={84} />
      </div>
      <p className="mt-3 text-[10px] uppercase tracking-[0.22em] font-bold" style={{ color: hsl() }}>Casting your cut</p>
      <div className="mt-1"><RotatingStatus /></div>
    </LoaderFrame>
  );
}

/* ── Variation C — Channeling (energy column + step list) ── */
function VariantChannel() {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setActive((s) => (s < STEPS.length - 1 ? s + 1 : s)), 2400);
    return () => clearInterval(t);
  }, []);
  return (
    <LoaderFrame label="C · Channeling">
      <div className="relative flex items-center justify-center" style={{ width: 160, height: 150 }}>
        {/* energy column rising behind wizard */}
        {!reduced && (
          <motion.div aria-hidden className="absolute left-1/2 -translate-x-1/2 bottom-0" style={{ width: 60, height: 150, background: `linear-gradient(to top, ${hsl(0.35)}, transparent)`, filter: "blur(10px)", borderRadius: 999 }} animate={{ opacity: [0.5, 1, 0.5], scaleY: [0.9, 1.05, 0.9] }} transition={{ duration: 2.2, repeat: Infinity, ease: "easeInOut" }} />
        )}
        <Wizard size={92} />
      </div>
      <p className="mt-3 text-[10px] uppercase tracking-[0.22em] font-bold" style={{ color: hsl() }}>Building your protocol</p>
      <ul className="mt-3 w-full max-w-[230px] space-y-2 text-left">
        {STEPS.map((s, i) => {
          const done = i < active;
          const isActive = i === active;
          return (
            <li key={s} className="flex items-center gap-2.5">
              <span className="h-4 w-4 shrink-0 flex items-center justify-center">
                {done ? (
                  <span className="h-4 w-4 rounded-full flex items-center justify-center" style={{ background: hsl() }}>
                    <svg viewBox="0 0 24 24" width={10} height={10}><path d="M5 12.5 L10 17.5 L19 7" fill="none" stroke="#0a0a0a" strokeWidth={3.5} strokeLinecap="round" strokeLinejoin="round" /></svg>
                  </span>
                ) : isActive ? (
                  <motion.span className="h-2.5 w-2.5 rounded-full" style={{ background: hsl() }} animate={reduced ? {} : { opacity: [1, 0.4, 1], scale: [1, 1.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />
                ) : (
                  <span className="h-2.5 w-2.5 rounded-full border border-muted-foreground/30" />
                )}
              </span>
              <span className="text-[12.5px]" style={{ color: done ? "hsl(var(--foreground)/0.6)" : isActive ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground)/0.5)" }}>{s}</span>
            </li>
          );
        })}
      </ul>
    </LoaderFrame>
  );
}

function LoaderFrame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[12px] font-semibold text-foreground mb-2">{label}</p>
      <div className="relative overflow-hidden rounded-2xl card-surface border border-primary/20 px-6 py-8 flex flex-col items-center min-h-[300px] justify-center">
        {children}
        <p className="mt-5 text-[11px] text-muted-foreground/60 relative z-10">This usually takes 5-15 seconds.</p>
      </div>
    </div>
  );
}

export default function ProtocolLoaderLab() {
  return (
    <div className="dark min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-md px-5 py-8 space-y-6">
        <header>
          <h1 className="text-2xl font-bold tracking-tight">Protocol Loader Lab</h1>
          <p className="mt-1 text-sm text-muted-foreground">Premium blue + wizard themed loading animations for protocol generation. All loop continuously. Pick one to replace the current overlay.</p>
        </header>
        <VariantAurora />
        <VariantOrbit />
        <VariantChannel />
        <p className="text-[11px] text-muted-foreground/50">Dev-only · route <code>/protocol-loader-lab</code> · not wired in</p>
      </div>
    </div>
  );
}
