import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Loader2 } from "lucide-react";
import { springs } from "@/lib/motion";

/**
 * iOS-native style alert (UIAlertController look): a 270px rounded card with a
 * centered title + message and full-width, hairline-divided stacked action
 * buttons. Renders to a body portal above everything. `loading` shows a spinner
 * on the destructive action and disables every button (used while a destructive
 * action is in flight, e.g. account deletion).
 */
type AlertAction = {
  label: string;
  style?: "default" | "destructive" | "cancel";
  loadingLabel?: string;
  onPress: () => void;
};

interface IOSAlertProps {
  open: boolean;
  title: string;
  message: string;
  actions: AlertAction[];
  loading?: boolean;
  onBackdrop?: () => void;
}

function actionClasses(style: AlertAction["style"]): string {
  if (style === "destructive") return "text-[hsl(var(--destructive))]";
  if (style === "cancel") return "font-semibold text-[hsl(var(--primary))]";
  return "text-[hsl(var(--primary))]";
}

export default function IOSAlert({
  open,
  title,
  message,
  actions,
  loading = false,
  onBackdrop,
}: IOSAlertProps) {
  const reduce = useReducedMotion();

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={springs.gentle}
          onClick={() => !loading && onBackdrop?.()}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            className="w-[270px] overflow-hidden rounded-[14px] border border-white/[0.08] shadow-2xl"
            style={{ backgroundColor: "hsl(var(--card))" }}
            initial={{ opacity: 0, scale: reduce ? 1 : 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: reduce ? 1 : 0.92 }}
            transition={springs.bouncy}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 pt-5">
              <h2 className="text-center text-[17px] font-semibold text-foreground">
                {title}
              </h2>
              <p className="mt-1 px-1 pb-3 text-center text-[13px] leading-snug text-muted-foreground">
                {message}
              </p>
            </div>

            <div className="flex flex-col border-t border-white/[0.08]">
              {actions.map((action, i) => {
                const isLoadingThis = loading && action.style === "destructive";
                return (
                  <button
                    key={action.label}
                    type="button"
                    disabled={loading}
                    onClick={action.onPress}
                    className={`flex min-h-[44px] w-full items-center justify-center gap-2 text-[17px] transition-colors active:bg-white/[0.04] disabled:opacity-40 ${
                      i > 0 ? "border-t border-white/[0.08]" : ""
                    } ${actionClasses(action.style)}`}
                  >
                    {isLoadingThis && <Loader2 className="h-4 w-4 animate-spin" />}
                    {isLoadingThis ? action.loadingLabel ?? action.label : action.label}
                  </button>
                );
              })}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
