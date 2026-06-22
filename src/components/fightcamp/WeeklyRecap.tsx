import { disciplineToken, disciplineLabel } from "@/lib/coachColors";

export type RecapTakeaway = {
    discipline: string;
    technique: string;
    cue?: string;
    detail: string;
    sourceSessionDate?: string;
};

export type RecapDebrief = {
    takeaways: RecapTakeaway[];
    watchOut?: string;
};

/** Strip typographic dashes from AI-generated strings. */
function cleanText(s: string): string {
    return s.replace(/—/g, " - ").replace(/–/g, "-");
}

/**
 * Renders a week's coach-voice debrief: the headline sentence, the concrete
 * takeaways distilled from session notes (discipline-tinted, technique as the
 * bold headline, cue chip, quiet detail), and an optional "watch-out". Stats
 * strip is rendered by the parent section, not here. Replaces FlashcardDeck.
 */
export function WeeklyRecap({
    headline,
    debrief,
}: {
    headline: string;
    debrief?: RecapDebrief;
}) {
    const takeaways = debrief?.takeaways ?? [];
    const cleanHeadline = cleanText(headline || "");

    return (
        <div className="space-y-4">
            {cleanHeadline && (
                <p className="text-body-sm font-semibold leading-snug text-foreground">
                    {cleanHeadline}
                </p>
            )}

            {takeaways.length > 0 && (
                <ul className="space-y-2.5">
                    {takeaways.map((t, i) => {
                        const token = disciplineToken(t.discipline);
                        const label = disciplineLabel(t.discipline);
                        return (
                            <li
                                key={i}
                                className="relative overflow-hidden card-surface rounded-2xl border border-border/60 pl-4 pr-3.5 py-3.5"
                            >
                                {/* Discipline accent stripe */}
                                <span
                                    aria-hidden
                                    className="absolute inset-y-0 left-0 w-1 rounded-l-2xl"
                                    style={{ backgroundColor: `hsl(var(${token}))` }}
                                />
                                {/* Faint discipline wash */}
                                <span
                                    aria-hidden
                                    className="absolute inset-0 pointer-events-none"
                                    style={{
                                        background: `linear-gradient(90deg, hsl(var(${token}) / 0.06), transparent 50%)`,
                                    }}
                                />

                                {/* Meta row: discipline label + cue chip */}
                                <div className="relative flex items-center gap-2 flex-wrap mb-1">
                                    <span
                                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                                        style={{
                                            backgroundColor: `hsl(var(${token}) / 0.14)`,
                                            color: `hsl(var(${token}))`,
                                        }}
                                    >
                                        {label}
                                    </span>
                                    {t.cue && (
                                        <span
                                            className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium"
                                            style={{
                                                backgroundColor: `hsl(var(${token}) / 0.10)`,
                                                color: `hsl(var(${token}))`,
                                            }}
                                        >
                                            {cleanText(t.cue)}
                                        </span>
                                    )}
                                </div>

                                {/* Technique — the headline */}
                                <p className="relative text-[15px] font-semibold leading-snug text-foreground">
                                    {cleanText(t.technique)}
                                </p>

                                {/* Detail — quiet supporting note */}
                                <p className="relative mt-1 text-note text-muted-foreground leading-relaxed line-clamp-3">
                                    {cleanText(t.detail)}
                                </p>
                            </li>
                        );
                    })}
                </ul>
            )}

            {debrief?.watchOut && (
                <div className="rounded-2xl border border-func-warning-yellow/30 bg-func-warning-yellow/5 px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-func-warning-yellow mb-1">
                        Watch out
                    </p>
                    <p className="text-note text-muted-foreground leading-relaxed">
                        {cleanText(debrief.watchOut)}
                    </p>
                </div>
            )}
        </div>
    );
}
