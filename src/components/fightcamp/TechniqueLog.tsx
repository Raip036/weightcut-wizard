import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import { Input } from "@/components/ui/input";
import { Loader2 } from "lucide-react";
import { disciplineToken, disciplineLabel } from "@/lib/coachColors";

type TechniqueRow = {
    _id: string;
    discipline: string;
    technique: string;
    cue?: string;
    detail: string;
    steps?: string[];
    timesLogged: number;
};

/**
 * All-time technique log: every weekly-recap takeaway accumulates here. A
 * searchable, discipline-grouped reference the athlete builds over time.
 * Reads `training_techniques.listTechniques`; filtering is client-side over
 * the (capped) result set.
 */
export function TechniqueLog() {
    const techniquesRaw = useQuery(api.training_techniques.listTechniques, {}) as
        | TechniqueRow[]
        | undefined;
    const [q, setQ] = useState("");

    const grouped = useMemo(() => {
        const list = techniquesRaw ?? [];
        const needle = q.trim().toLowerCase();
        const filtered = needle
            ? list.filter(
                  (t) =>
                      t.technique.toLowerCase().includes(needle) ||
                      t.detail.toLowerCase().includes(needle) ||
                      t.discipline.toLowerCase().includes(needle) ||
                      (t.cue ?? "").toLowerCase().includes(needle),
              )
            : list;
        const map = new Map<string, TechniqueRow[]>();
        for (const t of filtered) {
            const arr = map.get(t.discipline) ?? [];
            arr.push(t);
            map.set(t.discipline, arr);
        }
        return Array.from(map.entries());
    }, [techniquesRaw, q]);

    if (techniquesRaw === undefined) {
        return (
            <div className="flex items-center justify-center min-h-[120px] text-note text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Loading techniques…
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <Input
                placeholder="Search your technique log"
                value={q}
                onChange={(e) => setQ(e.target.value)}
            />

            {grouped.length === 0 && (
                <p className="text-note text-muted-foreground text-center py-8">
                    {techniquesRaw.length === 0
                        ? "No techniques logged yet. Generate a weekly recap to start your log."
                        : "No techniques match your search."}
                </p>
            )}

            {grouped.map(([discipline, items]) => {
                const token = disciplineToken(discipline);
                return (
                    <div key={discipline} className="space-y-2">
                        <h4
                            className="text-micro uppercase tracking-wider font-bold"
                            style={{ color: `hsl(var(${token}))` }}
                        >
                            {disciplineLabel(discipline)}
                        </h4>
                        <ul className="space-y-2">
                            {items.map((t) => (
                                <li
                                    key={t._id}
                                    className="relative overflow-hidden card-surface rounded-lg border border-border/60 pl-3.5 pr-3 py-2.5"
                                >
                                    <span
                                        aria-hidden
                                        className="absolute inset-y-0 left-0 w-1"
                                        style={{ backgroundColor: `hsl(var(${token}))` }}
                                    />
                                    <div className="relative flex items-center gap-2 flex-wrap">
                                        <span className="text-body-sm font-semibold text-foreground">
                                            {t.technique}
                                        </span>
                                        {t.cue && (
                                            <span
                                                className="inline-flex items-center px-2 py-0.5 rounded-full text-note font-medium"
                                                style={{
                                                    backgroundColor: `hsl(var(${token}) / 0.1)`,
                                                    color: `hsl(var(${token}))`,
                                                }}
                                            >
                                                {t.cue}
                                            </span>
                                        )}
                                        {t.timesLogged > 1 && (
                                            <span className="ml-auto text-note text-muted-foreground/70 tabular-nums">
                                                ×{t.timesLogged}
                                            </span>
                                        )}
                                    </div>
                                    <p className="relative mt-1 text-note text-muted-foreground leading-relaxed">
                                        {t.detail}
                                    </p>
                                    {t.steps && t.steps.length > 0 && (
                                        <ol className="relative mt-2 space-y-1">
                                            {t.steps.map((step, si) => (
                                                <li
                                                    key={si}
                                                    className="flex gap-2 text-note text-muted-foreground leading-snug"
                                                >
                                                    <span className="shrink-0 tabular-nums font-semibold text-foreground/70">
                                                        {si + 1}.
                                                    </span>
                                                    <span>{step}</span>
                                                </li>
                                            ))}
                                        </ol>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </div>
                );
            })}
        </div>
    );
}
