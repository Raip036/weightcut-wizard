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

/**
 * Renders a week's coach-voice debrief: the headline sentence, the concrete
 * takeaways distilled from session notes (discipline-tinted, optional cue
 * pill), and an optional "watch-out". Stats strip is rendered by the parent
 * section, not here. Replaces the old FlashcardDeck.
 */
export function WeeklyRecap({
    headline,
    debrief,
}: {
    headline: string;
    debrief?: RecapDebrief;
}) {
    const takeaways = debrief?.takeaways ?? [];
    const cleanHeadline = (headline || "").replace(/—/g, " - ").replace(/–/g, "-");

    return (
        <div className="space-y-4">
            {cleanHeadline && (
                <p className="text-body-sm font-semibold leading-snug text-foreground">
                    {cleanHeadline}
                </p>
            )}

            {takeaways.length > 0 && (
                <ul className="space-y-3">
                    {takeaways.map((t, i) => {
                        const token = disciplineToken(t.discipline);
                        const label = disciplineLabel(t.discipline);
                        return (
                            <li
                                key={i}
                                className="card-surface rounded-xs border border-border/60 px-4 py-3"
                            >
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span
                                        className="inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wider"
                                        style={{
                                            backgroundColor: "hsl(var(--muted) / 0.4)",
                                            color: `hsl(var(${token}))`,
                                            borderColor: "hsl(var(--border))",
                                        }}
                                    >
                                        {label}
                                    </span>
                                    <span className="text-body-sm font-semibold text-foreground">
                                        {t.technique}
                                    </span>
                                    {t.cue && (
                                        <span className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full bg-muted/40 text-note font-medium text-muted-foreground">
                                            {t.cue}
                                        </span>
                                    )}
                                </div>
                                <p className="mt-1.5 text-note text-muted-foreground leading-relaxed">
                                    {t.detail}
                                </p>
                            </li>
                        );
                    })}
                </ul>
            )}

            {debrief?.watchOut && (
                <div className="rounded-xs border border-func-warning-yellow/30 bg-func-warning-yellow/5 px-4 py-3">
                    <span className="text-note font-bold uppercase tracking-wider text-func-warning-yellow">
                        Watch out
                    </span>
                    <p className="mt-1 text-note text-muted-foreground leading-relaxed">
                        {debrief.watchOut}
                    </p>
                </div>
            )}
        </div>
    );
}
