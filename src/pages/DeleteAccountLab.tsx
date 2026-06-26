// THROWAWAY MOCK LAB - /delete-lab. Delete after sign-off.
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Trash2, Check } from "lucide-react";
import { springs } from "@/lib/motion";
import IOSAlert from "@/components/ui/IOSAlert";

type Step = "idle" | "warn" | "confirm" | "deleting" | "done";

export default function DeleteAccountLab() {
  const [step, setStep] = useState<Step>("idle");

  const handleConfirmDelete = () => {
    setStep("deleting");
    setTimeout(() => {
      setStep("done");
      setTimeout(() => setStep("idle"), 2000);
    }, 1400);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-md px-4 py-10">
        <p className="mb-6 text-center text-sm text-muted-foreground">
          Mock preview of the two-step delete flow.
        </p>

        <div className="overflow-hidden rounded-2xl border border-border/50 bg-card">
          <div className="px-4 py-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Settings
          </div>
          <button
            type="button"
            onClick={() => setStep("warn")}
            className="flex min-h-[52px] w-full items-center gap-3 border-t border-border/50 px-4 text-left transition-colors active:bg-white/[0.04]"
          >
            <Trash2 className="h-5 w-5 text-destructive" />
            <span className="text-[15px] text-destructive">Delete Account</span>
          </button>
        </div>
      </div>

      {/* STEP 1: warning */}
      <IOSAlert
        open={step === "warn"}
        title="Delete Account?"
        message="This permanently deletes your account and all of your data. Your fight camps, logs, weight history, and progress will be gone. This cannot be undone."
        onBackdrop={() => setStep("idle")}
        actions={[
          {
            label: "Delete Account",
            style: "destructive",
            onPress: () => setStep("confirm"),
          },
          {
            label: "Cancel",
            style: "cancel",
            onPress: () => setStep("idle"),
          },
        ]}
      />

      {/* STEP 2: final confirm */}
      <IOSAlert
        open={step === "confirm" || step === "deleting"}
        title="Are you absolutely sure?"
        message="This is your last chance. Your account and everything in it will be permanently erased."
        loading={step === "deleting"}
        onBackdrop={() => setStep("idle")}
        actions={[
          {
            label: "Confirm Delete",
            style: "destructive",
            loadingLabel: "Deleting...",
            onPress: handleConfirmDelete,
          },
          {
            label: "Cancel",
            style: "cancel",
            onPress: () => setStep("idle"),
          },
        ]}
      />

      {/* Done toast */}
      <AnimatePresence>
        {step === "done" && (
          <motion.div
            className="pointer-events-none fixed inset-0 z-[90] flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={springs.gentle}
          >
            <motion.div
              className="flex items-center gap-2 rounded-full border border-white/[0.08] px-5 py-3 shadow-xl"
              style={{ backgroundColor: "hsl(var(--card))" }}
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={springs.bouncy}
            >
              <Check className="h-5 w-5 text-[hsl(var(--primary))]" />
              <span className="text-[15px] font-medium text-foreground">
                Account deleted
              </span>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
