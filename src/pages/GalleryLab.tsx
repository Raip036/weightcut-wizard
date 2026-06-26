// THROWAWAY MOCK LAB - /gallery-lab. Delete after sign-off.
//
// Two directions for the Training Library Gallery, inspired by Pinterest
// (masonry) and BeReal (moments feed). Uses picsum placeholder photos.
import { useState } from "react";
import { Play } from "lucide-react";
import { disciplineToken, disciplineLabel } from "@/lib/coachColors";

type Shot = {
  id: string;
  sport: string;
  caption: string;
  time: string;
  kind: "photo" | "video";
  w: number;
  h: number;
};

const SHOTS: Shot[] = [
  { id: "a1", sport: "BJJ", caption: "Guard retention drills", time: "Mon · 7:12pm", kind: "photo", w: 400, h: 540 },
  { id: "a2", sport: "Muay Thai", caption: "Pad rounds", time: "Mon · 6:03pm", kind: "video", w: 400, h: 300 },
  { id: "a3", sport: "Boxing", caption: "Sparring, 5 rounds", time: "Sun · 11:20am", kind: "photo", w: 400, h: 600 },
  { id: "a4", sport: "Strength", caption: "Deadlift PR, 180kg", time: "Sat · 9:40am", kind: "photo", w: 400, h: 400 },
  { id: "a5", sport: "Wrestling", caption: "Takedown chains", time: "Fri · 8:15pm", kind: "video", w: 400, h: 500 },
  { id: "a6", sport: "BJJ", caption: "Open mat", time: "Thu · 7:50pm", kind: "photo", w: 400, h: 340 },
  { id: "a7", sport: "Muay Thai", caption: "Clinch work", time: "Wed · 6:30pm", kind: "photo", w: 400, h: 560 },
  { id: "a8", sport: "Strength", caption: "Posterior chain", time: "Tue · 7:05am", kind: "photo", w: 400, h: 420 },
];

const img = (s: Shot) => `https://picsum.photos/seed/wcw-${s.id}/${s.w}/${s.h}`;
const inset = (s: Shot) => `https://picsum.photos/seed/wcw-in-${s.id}/200/260`;
const color = (sport: string) => `hsl(var(${disciplineToken(sport)}))`;

function DisciplinePill({ sport, dark }: { sport: string; dark?: boolean }) {
  return (
    <span
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 ${
        dark ? "bg-black/45 backdrop-blur-sm" : ""
      }`}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color(sport) }} />
      <span className="text-[11px] font-semibold text-white">{disciplineLabel(sport)}</span>
    </span>
  );
}

/* ── Direction A: Pinterest masonry ─────────────────────────────── */
function Masonry() {
  return (
    <div className="columns-2 gap-2 [column-fill:_balance]">
      {SHOTS.map((s) => (
        <button
          key={s.id}
          className="card-press relative mb-2 block w-full break-inside-avoid overflow-hidden rounded-2xl"
        >
          <img src={img(s)} alt="" className="w-full object-cover" loading="lazy" />
          {s.kind === "video" && (
            <span className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm">
              <Play className="h-3 w-3 fill-white text-white" />
            </span>
          )}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent p-2.5">
            <DisciplinePill sport={s.sport} />
            <p className="mt-0.5 pl-1 text-[10px] font-medium text-white/65">{s.time}</p>
          </div>
        </button>
      ))}
    </div>
  );
}

/* ── Direction B: BeReal moments feed ───────────────────────────── */
function Feed() {
  return (
    <div className="space-y-4">
      {SHOTS.map((s) => (
        <div
          key={s.id}
          className="overflow-hidden rounded-3xl border border-white/[0.06] bg-card"
        >
          <div className="relative">
            <img src={img(s)} alt="" className="aspect-[4/5] w-full object-cover" loading="lazy" />
            <div className="absolute left-3 top-3 rounded-full bg-black/45 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
              {s.time}
            </div>
            {/* BeReal-style front-cam inset */}
            <img
              src={inset(s)}
              alt=""
              loading="lazy"
              className="absolute right-3 top-3 h-[88px] w-[68px] rounded-xl border-2 border-black/60 object-cover shadow-lg"
            />
            {s.kind === "video" && (
              <span className="absolute bottom-3 right-3 flex h-7 w-7 items-center justify-center rounded-full bg-black/45 backdrop-blur-sm">
                <Play className="h-3.5 w-3.5 fill-white text-white" />
              </span>
            )}
            <div className="absolute bottom-3 left-3">
              <DisciplinePill sport={s.sport} dark />
            </div>
          </div>
          <p className="px-4 py-3 text-[13.5px] leading-snug text-foreground/90">{s.caption}</p>
        </div>
      ))}
    </div>
  );
}

export default function GalleryLab() {
  const [dir, setDir] = useState<"masonry" | "feed">("masonry");

  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <div className="mx-auto w-full max-w-md px-4 pb-16 pt-4">
        <header className="pt-1">
          <p className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground/70 font-bold">Your</p>
          <h1 className="text-[22px] font-semibold leading-tight">Training Gallery</h1>
        </header>

        {/* Direction toggle (lab only) */}
        <div className="mt-3 flex gap-2">
          {([["masonry", "Masonry (Pinterest)"], ["feed", "Moments (BeReal)"]] as const).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setDir(k)}
              className={`rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors ${
                dir === k ? "bg-primary text-white" : "bg-card text-muted-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="mt-4">{dir === "masonry" ? <Masonry /> : <Feed />}</div>
      </div>
    </div>
  );
}
