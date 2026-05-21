import { useState, useEffect } from "react";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { triggerHapticSelection, triggerHapticSuccess } from "@/lib/haptics";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";

const SPORTS = ["BJJ", "Muay Thai", "Wrestling", "Boxing", "MMA"] as const;

interface TechniqueLogDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLog: (name: string, sport: string, notes?: string) => Promise<void>;
  existingTechniqueNames: string[];
}

export function TechniqueLogDialog({
  open,
  onOpenChange,
  onLog,
  existingTechniqueNames,
}: TechniqueLogDialogProps) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [sport, setSport] = useState<string>("BJJ");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);

  // Autocomplete
  useEffect(() => {
    if (name.length < 2) {
      setSuggestions([]);
      return;
    }
    const lower = name.toLowerCase();
    const matches = existingTechniqueNames
      .filter((t) => t.toLowerCase().includes(lower))
      .slice(0, 5);
    setSuggestions(matches);
  }, [name, existingTechniqueNames]);

  const handleSubmit = async () => {
    if (!name.trim()) return;
    setIsSubmitting(true);
    try {
      await onLog(name.trim(), sport, notes.trim() || undefined);
      triggerHapticSuccess();
      setName("");
      setNotes("");
      setSuggestions([]);
      onOpenChange(false);
    } catch {
      toast({
        title: "Failed to log technique",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="safe-area-inset-bottom">
        <DrawerHeader>
          <DrawerTitle>Log Technique</DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-6 space-y-4">
          {/* Technique name */}
          <div className="relative">
            <Input
              placeholder="Technique name (e.g. Anaconda Choke)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-base"
              autoComplete="off"
            />
            {suggestions.length > 0 && (
              <div className="absolute left-0 right-0 top-full mt-1 z-20 rounded-xs border border-border/50 bg-background shadow-lg overflow-hidden">
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setName(s);
                      setSuggestions([]);
                    }}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-muted/50 active:bg-muted transition-colors"
                    style={{ touchAction: "manipulation" }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sport pills */}
          <div className="flex flex-wrap gap-2">
            {SPORTS.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setSport(s);
                  triggerHapticSelection();
                }}
                className={`px-4 py-2 rounded-xs text-sm font-medium min-h-[44px] transition-colors ${
                  sport === s
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted"
                }`}
                style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Notes */}
          <Textarea
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="text-base resize-none"
          />

          {/* Submit */}
          <Button
            onClick={handleSubmit}
            disabled={!name.trim() || isSubmitting}
            className="w-full min-h-[44px] rounded-xs"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Logging...
              </>
            ) : (
              "Log & Generate"
            )}
          </Button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}
