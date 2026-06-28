import { disciplineToken, disciplineLabel } from "@/lib/coachColors";

export type RecapTakeaway = {
    discipline: string;
    technique: string;
    cue?: string;
    detail: string;
    steps?: string[];
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
            {(cleanHeadline || debrief?.watchOut) && (
                <div className="space-y-1">
                    {cleanHeadline && (
                        <p className="text-body-sm font-semibold leading-snug text-foreground">
                            {cleanHeadline}
                        </p>
                    )}
                    {debrief?.watchOut && (
                        <p className="text-body-sm leading-snug text-muted-foreground">
                            {cleanText(debrief.watchOut)}
                        </p>
                    )}
                </div>
            )}

            {takeaways.length > 0 && (
                <ul className="space-y-3">
                    {takeaways.map((t, i) => {
                        const token = disciplineToken(t.discipline);
                        const label = disciplineLabel(t.discipline);
                        return (
                            <li
                                key={i}
                                className="py-0.5"
                            >
                                {/* Meta row: discipline label + cue chip */}
                                <div className="flex items-center gap-2 flex-wrap mb-1">
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
                                <p className="text-[15px] font-semibold leading-snug text-foreground">
                                    {cleanText(t.technique)}
                                </p>

                                {/* Detail — quiet supporting note */}
                                <p className="mt-1 text-note text-muted-foreground leading-relaxed">
                                    {cleanText(t.detail)}
                                </p>

                                {/* Steps — always-visible numbered list */}
                                {t.steps && t.steps.length > 0 && (
                                    <ol className="mt-2 space-y-1">
                                        {t.steps.map((step, si) => (
                                            <li
                                                key={si}
                                                className="flex gap-2 text-note text-muted-foreground leading-snug"
                                            >
                                                <span className="shrink-0 tabular-nums font-semibold text-foreground/70">
                                                    {si + 1}.
                                                </span>
                                                <span>{cleanText(step)}</span>
                                            </li>
                                        ))}
                                    </ol>
                                )}
                            </li>
                        );
                    })}
                </ul>
            )}
        </div>
    );
}
