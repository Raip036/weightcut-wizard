import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { triggerHapticSelection } from "@/lib/haptics";
import type { GraphNode, TechniqueLevel } from "@/types/technique";

const LEVELS: TechniqueLevel[] = ["seen", "drilled", "landed", "mastered"];

const LEVEL_LABELS: Record<TechniqueLevel, string> = {
  seen: "Seen",
  drilled: "Drilled",
  landed: "Landed",
  mastered: "Mastered",
};

const LEVEL_STYLES: Record<TechniqueLevel, string> = {
  seen: "bg-muted text-muted-foreground",
  drilled: "bg-blue-500/20 text-blue-400",
  landed: "bg-green-500/20 text-green-400",
  mastered: "bg-amber-400/20 text-amber-400",
};

interface TechniqueDetailSheetProps {
  node: GraphNode | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateLevel: (techniqueId: string, level: TechniqueLevel) => void;
  connectedNodes: GraphNode[];
}

export function TechniqueDetailSheet({
  node,
  open,
  onOpenChange,
  onUpdateLevel,
  connectedNodes,
}: TechniqueDetailSheetProps) {
  if (!node) return null;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent
        className="scroll-touch"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
      >
        <DrawerHeader>
          <DrawerTitle>{node.label}</DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-4 space-y-5">
          {/* Meta info */}
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span className="px-2 py-1 rounded-xs bg-muted/50">{node.sport}</span>
            {node.category && (
              <span className="px-2 py-1 rounded-xs bg-muted/50">{node.category}</span>
            )}
            {node.timesLogged > 0 && (
              <span className="px-2 py-1 rounded-xs bg-muted/50">
                Logged {node.timesLogged}x
              </span>
            )}
          </div>

          {/* Level selector */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">Proficiency Level</p>
            <div className="flex gap-2">
              {LEVELS.map((level) => (
                <button
                  key={level}
                  onClick={() => {
                    triggerHapticSelection();
                    onUpdateLevel(node.id, level);
                  }}
                  className={`flex-1 min-h-[44px] rounded-xs text-xs font-medium transition-colors ${
                    node.level === level
                      ? LEVEL_STYLES[level] + " ring-1 ring-current"
                      : "bg-muted/30 text-muted-foreground hover:bg-muted/50"
                  }`}
                  style={{ touchAction: "manipulation", WebkitTapHighlightColor: "transparent" }}
                >
                  {LEVEL_LABELS[level]}
                </button>
              ))}
            </div>
          </div>

          {/* Connected techniques */}
          {connectedNodes.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Connected Techniques</p>
              <div className="space-y-1.5">
                {connectedNodes.map((cn) => (
                  <div
                    key={cn.id}
                    className="flex items-center justify-between px-3 py-2 rounded-xs bg-muted/30 text-sm"
                  >
                    <span>{cn.label}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-xs ${LEVEL_STYLES[cn.level]}`}>
                      {LEVEL_LABELS[cn.level]}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
