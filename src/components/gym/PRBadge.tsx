import { motion } from "motion/react";
import { springs } from "@/lib/motion";
import { Trophy } from "lucide-react";
import type { PRType } from "@/pages/gym/types";

interface PRBadgeProps {
  type: PRType;
  isNew?: boolean;
}

const PR_LABELS: Record<PRType, string> = {
  weight: "Weight PR",
  reps: "Rep PR",
  volume: "Volume PR",
  "1rm": "1RM PR",
};

export function PRBadge({ type, isNew }: PRBadgeProps) {
  return (
    <motion.span
      initial={isNew ? { scale: 0, opacity: 0 } : false}
      animate={{ scale: 1, opacity: 1 }}
      transition={springs.bouncy}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
        isNew
          ? "bg-func-warning-yellow/20 text-func-warning-yellow ring-1 ring-func-warning-yellow/30"
          : "bg-func-warning-yellow/10 text-func-warning-yellow/80"
      }`}
    >
      <Trophy className="h-3 w-3" />
      {PR_LABELS[type]}
    </motion.span>
  );
}
