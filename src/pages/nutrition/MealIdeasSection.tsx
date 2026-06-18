export function MealIdeasSection({ onOpen, lastPlanSummary }: {
  onOpen: () => void; lastPlanSummary?: string | null;
}) {
  return (
    <div className="card-surface rounded-2xl border border-border/40 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-[14px] font-semibold">Meal plan ideas</h3>
          <p className="text-[12px] text-muted-foreground">
            {lastPlanSummary ?? "Generate a full day that hits your targets"}
          </p>
        </div>
        <button type="button" onClick={onOpen}
          className="rounded-xl bg-primary px-3 py-2 text-[12px] font-semibold text-primary-foreground active:scale-[0.98]">
          {lastPlanSummary ? "Open" : "Generate"}
        </button>
      </div>
    </div>
  );
}
