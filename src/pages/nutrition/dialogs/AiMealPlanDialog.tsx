import { format } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface AiMealPlanDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedDate: string;
  aiPrompt: string;
  setAiPrompt: React.Dispatch<React.SetStateAction<string>>;
  generatingPlan: boolean;
  onGenerate: () => void;
  gemBadge: React.ReactNode;
}

export function AiMealPlanDialog({
  open,
  onOpenChange,
  selectedDate,
  aiPrompt,
  setAiPrompt,
  generatingPlan,
  onGenerate,
  gemBadge,
}: AiMealPlanDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100vw-2.5rem)] max-w-[320px] max-h-[85vh] overflow-y-auto rounded-[28px] p-0 border-0 bg-card/95 backdrop-blur-xl shadow-2xl gap-0">
        <div className="px-4 pt-4 pb-3">
          <DialogHeader>
            <DialogTitle className="text-[15px] font-semibold text-center">
              Meal ideas · {format(new Date(selectedDate), "MMM d")}
            </DialogTitle>
          </DialogHeader>
        </div>
        <div className="px-4 pb-4 space-y-2.5">
          <div className="flex flex-wrap gap-1.5">
            {["High protein", "Low carb", "Mediterranean", "Fight week prep"].map((chip) => (
              <button
                key={chip}
                onClick={() => setAiPrompt((prev) => (prev ? `${prev.trimEnd()} ${chip.toLowerCase()}` : chip))}
                className="px-2.5 py-1 rounded-full text-[13px] font-medium bg-muted/40 text-muted-foreground active:bg-muted/60 transition-colors"
              >
                {chip}
              </button>
            ))}
          </div>
          <Textarea
            placeholder="Describe what you'd like to eat..."
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            rows={2}
            className="resize-none text-[13px] rounded-xs border-border/30 bg-muted/20"
          />
          <button
            onClick={onGenerate}
            disabled={generatingPlan}
            className="relative w-full py-2.5 text-[14px] font-semibold text-primary active:bg-muted/50 transition-colors border-t border-border/40 mt-1 disabled:opacity-40"
          >
            {generatingPlan ? (
              "Generating..."
            ) : (
              <>
                Generate Meal Ideas
                {gemBadge && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
                    {gemBadge}
                  </span>
                )}
              </>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
