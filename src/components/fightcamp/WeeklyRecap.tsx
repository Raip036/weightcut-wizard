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
                <ul className="space-y-2.5">
                    {takeaways.map((t, i) => {
                        const token = disciplineToken(t.discipline);
                        const label = disciplineLabel(t.discipline);
                        return (
                            <li
                                key={i}
                                className="relative overflow-hidden card-surface rounded-lg border border-border/60 pl-4 pr-3.5 py-3"
                            >
                                {/* Discipline accent stripe + faint wash so each
                                    takeaway is colour-coded at a glance. */}
                                <span
                                    aria-hidden
                                    className="absolute inset-y-0 left-0 w-1"
                                    style={{ backgroundColor: `hsl(var(${token}))` }}
                                />
                                <span
                                    aria-hidden
                                    className="absolute inset-0 pointer-events-none"
                                    style={{
                                        background: `linear-gradient(90deg, hsl(var(${token}) / 0.06), transparent 45%)`,
                                    }}
                                />
                                <div className="relative flex items-center gap-2 flex-wrap">
                                    <span
                                        className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider"
                                        style={{
                                            backgroundColor: `hsl(var(${token}) / 0.14)`,
                                            color: `hsl(var(${token}))`,
                                        }}
                                    >
                                        {label}
                                    </span>
                                    <span className="text-body-sm font-semibold text-foreground">
                                        {t.technique}
                                    </span>
                                    {t.cue && (
                                        <span
                                            className="ml-auto inline-flex items-center px-2 py-0.5 rounded-full text-note font-medium"
                                            style={{
                                                backgroundColor: `hsl(var(${token}) / 0.1)`,
                                                color: `hsl(var(${token}))`,
                                            }}
                                        >
                                            {t.cue}
                                        </span>
                                    )}
                                </div>
                                <p className="relative mt-1.5 text-note text-muted-foreground leading-relaxed">
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
