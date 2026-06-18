import { memo, useEffect, useRef } from "react";
import { isNativePlatform } from "@/hooks/useIsNative";

// Energy Core atmosphere — a single canvas that draws the reactor's living
// glow: a HOLLOW core halo (transparent at the dead centre so the score
// number always stays crisp) plus a field of motes that spiral INWARD from
// the containment ring and dissolve at an absorption radius. The active
// colour (tier when scored, cyan when calibrating) and the fill fraction
// (score / charge) drive the glow size, brightness and particle density.
//
// This replaces the old halo + two conic ribbons + up to 84 box-shadowed DOM
// particles. One canvas with `globalCompositeOperation = "lighter"` is far
// cheaper on iOS WKWebView than dozens of independently-animating layers with
// blur/box-shadow, so it doubles as the native perf fix for the heaviest
// dashboard screen — no CSS blur filters, no per-frame box-shadow re-raster.

const DPR = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
const TAU = Math.PI * 2;

interface AtmosphereProps {
  /** Render the core glow (scored or calibrating). */
  show: boolean;
  /** Render the inward particle field. */
  showParticles: boolean;
  isCalib: boolean;
  /** "r, g, b" triplet — tier colour when scored, cyan when calibrating. */
  labelRgb: string;
  /** 0..1 score (scored) or charge (calibrating) — scales glow + density. */
  fraction: number;
  particleCount: number;
  size: number;
  radius: number;
}

interface Mote {
  ang: number;
  rad: number;
  vr: number;
  vang: number;
  size: number;
  seed: number;
}

// Orbital-band particle — circles the perimeter (never travels inward).
interface Orbital {
  ang: number;
  rad: number;
  vang: number;
  size: number;
  seed: number;
  trail: boolean;
}

function parseRgb(s: string): [number, number, number] {
  const parts = s.split(",").map((x) => parseInt(x.trim(), 10));
  return [parts[0] || 148, parts[1] || 163, parts[2] || 184];
}
function rgba(c: [number, number, number], a: number) {
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

function FightFormRingAtmosphereInner(props: AtmosphereProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // Latest props read by the rAF loop without re-subscribing the effect.
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let motes: Mote[] = [];
    let orbitals: Orbital[] = [];
    let lastColorKey = "";
    let raf = 0;
    let lastT = 0;

    const spawn = (R: number): Mote => ({
      ang: Math.random() * TAU,
      rad: R - 6 + Math.random() * 10,
      vr: 0.22 + Math.random() * 0.5,
      vang: (Math.random() < 0.5 ? 1 : -1) * (0.006 + Math.random() * 0.012),
      size: 0.9 + Math.random() * 1.6,
      seed: Math.random() * TAU,
    });

    // Orbital band — circles the arc radius, all one direction, a few faster
    // and a few carrying a short faint trail for "flow". Count scales with the
    // fill fraction (sparse At Risk, dense Sharp), capped on native.
    const spawnOrbital = (R: number): Orbital => {
      const fast = Math.random() < 0.3;
      return {
        ang: Math.random() * TAU,
        rad: R - 10 + Math.random() * 13, // hugs the arc, stays inside canvas
        vang: (0.0035 + Math.random() * 0.0035) * (fast ? 1.9 : 1),
        size: 0.9 + Math.random() * 1.6,
        seed: Math.random() * TAU,
        trail: Math.random() < 0.28,
      };
    };
    const orbitalWant = (frac: number) => {
      const raw = Math.round(14 + frac * 12); // ~14..26
      return isNativePlatform ? Math.min(raw, 14) : raw;
    };

    const draw = (now: number) => {
      const p = propsRef.current;
      const size = p.size;
      const R = p.radius;
      const cx = size / 2;
      const cy = size / 2;
      const rgb = parseRgb(p.labelRgb);
      const frac = Math.max(0, Math.min(1, p.fraction));
      const absorbR = R * 0.42;

      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, size, size);
      const dt = reduce ? 0 : Math.min(48, now - (lastT || now));

      // Recolour both fields cleanly when the tier/calibration colour flips.
      const colorKey = p.labelRgb;
      if (colorKey !== lastColorKey) {
        motes = [];
        orbitals = [];
        lastColorKey = colorKey;
      }

      // ── Hollow core glow (transparent centre, recessive) ──────────────
      if (p.show) {
        const baseR = 0.27 * R + frac * 0.22 * R;
        const breathe = reduce ? 1 : 1 + Math.sin(now * 0.0016) * 0.05;
        const rr = baseR * breathe;
        const bright = 0.2 + frac * 0.4;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        const g = ctx.createRadialGradient(cx, cy, rr * 0.45, cx, cy, rr * 2.2);
        g.addColorStop(0, rgba(rgb, 0));
        g.addColorStop(0.32, rgba(rgb, 0.2 * bright));
        g.addColorStop(0.6, rgba(rgb, 0.12 * bright));
        g.addColorStop(1, rgba(rgb, 0));
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, rr * 2.2, 0, TAU);
        ctx.fill();
        ctx.restore();
      }

      if (p.showParticles) {
        // ── Inward-spiral particles (thinned so the orbital band leads) ──
        const want = Math.round(p.particleCount * 0.6);
        while (motes.length < want) motes.push(spawn(R));
        if (motes.length > want) motes.length = want;

        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < motes.length; i++) {
          const m = motes[i];
          if (!reduce) {
            m.rad -= m.vr * (dt / 16.7);
            m.ang += m.vang * (dt / 16.7);
          }
          if (m.rad <= absorbR) {
            motes[i] = spawn(R);
            continue;
          }
          const range = R - absorbR;
          let prog = 1 - (m.rad - absorbR) / range; // 0 edge → 1 absorb ring
          prog = Math.max(0, Math.min(1, prog));
          let alpha = (0.14 + prog * 0.8) * 0.8;
          if (prog > 0.8) alpha *= (1 - (prog - 0.8) / 0.2) * 0.85 + 0.15;
          const twinkle = reduce ? 1 : 0.75 + 0.25 * Math.sin(now * 0.01 + m.seed);
          const px = cx + Math.cos(m.ang) * m.rad;
          const py = cy + Math.sin(m.ang) * m.rad;
          const sz = m.size * (0.7 + prog * 0.9);
          const pg = ctx.createRadialGradient(px, py, 0, px, py, sz * 3);
          pg.addColorStop(0, `rgba(255,255,255,${(alpha * twinkle * 0.9).toFixed(3)})`);
          pg.addColorStop(0.5, rgba(rgb, alpha * twinkle * 0.7));
          pg.addColorStop(1, rgba(rgb, 0));
          ctx.fillStyle = pg;
          ctx.beginPath();
          ctx.arc(px, py, sz * 3, 0, TAU);
          ctx.fill();
        }
        ctx.restore();

        // ── Orbital band — flows AROUND the perimeter, tier/cyan tinted ──
        const owant = orbitalWant(frac);
        while (orbitals.length < owant) orbitals.push(spawnOrbital(R));
        if (orbitals.length > owant) orbitals.length = owant;

        const bandBright = 0.55 + frac * 0.45;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        for (let i = 0; i < orbitals.length; i++) {
          const o = orbitals[i];
          if (!reduce) {
            o.ang += o.vang * (dt / 16.7);
            if (o.ang > TAU) o.ang -= TAU;
          }
          const twinkle = reduce ? 1 : 0.7 + 0.3 * Math.sin(now * 0.006 + o.seed);
          const alpha = 0.5 * bandBright * twinkle;
          const px = cx + Math.cos(o.ang) * o.rad;
          const py = cy + Math.sin(o.ang) * o.rad;
          const sz = o.size;
          if (o.trail && !reduce) {
            for (let k = 1; k <= 2; k++) {
              const ta = o.ang - o.vang * k * 4;
              const tx = cx + Math.cos(ta) * o.rad;
              const ty = cy + Math.sin(ta) * o.rad;
              const talpha = alpha * (0.22 / k);
              const tg = ctx.createRadialGradient(tx, ty, 0, tx, ty, sz * 2.4);
              tg.addColorStop(0, rgba(rgb, talpha));
              tg.addColorStop(1, rgba(rgb, 0));
              ctx.fillStyle = tg;
              ctx.beginPath();
              ctx.arc(tx, ty, sz * 2.4, 0, TAU);
              ctx.fill();
            }
          }
          const pg = ctx.createRadialGradient(px, py, 0, px, py, sz * 3);
          pg.addColorStop(0, `rgba(255,255,255,${(alpha * 0.9).toFixed(3)})`);
          pg.addColorStop(0.45, rgba(rgb, alpha * 0.8));
          pg.addColorStop(1, rgba(rgb, 0));
          ctx.fillStyle = pg;
          ctx.beginPath();
          ctx.arc(px, py, sz * 3, 0, TAU);
          ctx.fill();
        }
        ctx.restore();
      }

      lastT = now;
    };

    if (reduce) {
      // Single static frame — no loop.
      draw(0);
      return;
    }
    const frame = (now: number) => {
      draw(now);
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  if (!props.show && !props.showParticles) return null;

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="absolute inset-0 pointer-events-none"
      width={Math.round(props.size * DPR)}
      height={Math.round(props.size * DPR)}
      style={{ width: props.size, height: props.size }}
    />
  );
}

export const FightFormRingAtmosphere = memo(FightFormRingAtmosphereInner);
