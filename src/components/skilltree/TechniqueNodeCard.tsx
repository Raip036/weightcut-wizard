import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import type { GraphNode } from "@/types/technique";

const LEVEL_COLORS: Record<string, string> = {
  seen: "border-l-muted-foreground/40",
  drilled: "border-l-blue-500",
  landed: "border-l-func-recovery-green",
  mastered: "border-l-func-warning-yellow",
};

interface TechniqueNodeCardProps {
  node: GraphNode;
  onTap: (node: GraphNode) => void;
}

export function TechniqueNodeCard({ node, onTap }: TechniqueNodeCardProps) {
  const handleTap = () => {
    triggerHaptic(ImpactStyle.Light);
    onTap(node);
  };

  return (
    <button
      onClick={handleTap}
      className={`
        w-[120px] min-h-[52px] px-3 py-2
        card-surface rounded-xs border border-border/50
        border-l-[3px] ${LEVEL_COLORS[node.level] || LEVEL_COLORS.seen}
        text-left select-none cursor-pointer
        active:scale-[0.97] transition-transform duration-100
      `}
      style={{
        touchAction: "manipulation",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <p className="text-xs font-medium text-foreground leading-tight truncate">
        {node.label}
      </p>
      {node.timesLogged > 0 && (
        <span className="mt-0.5 inline-block text-[10px] text-muted-foreground">
          {node.timesLogged}x
        </span>
      )}
    </button>
  );
}
