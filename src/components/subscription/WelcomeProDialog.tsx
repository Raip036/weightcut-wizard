import { useEffect, useState } from "react";
import { Zap, Crown, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface WelcomeProDialogProps {
  open: boolean;
  onClose: () => void;
}

export function WelcomeProDialog({ open, onClose }: WelcomeProDialogProps) {
  const [stage, setStage] = useState(0); // 0=hidden, 1=icon, 2=text, 3=button

  useEffect(() => {
    if (!open) { setStage(0); return; }
    // Staggered reveal
    const t1 = setTimeout(() => setStage(1), 100);
    const t2 = setTimeout(() => setStage(2), 500);
    const t3 = setTimeout(() => setStage(3), 900);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[10004] flex items-center justify-center p-6">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 animate-in fade-in duration-500" onClick={onClose} />

      {/* Dialog */}
      <div className="relative w-full max-w-[320px] rounded-[28px] border border-primary/20 bg-background animate-in zoom-in-90 fade-in slide-in-from-bottom-4 duration-500 overflow-hidden">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 h-8 w-8 flex items-center justify-center rounded-full bg-white/5 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Top glow */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-64 h-32 bg-gradient-to-b from-primary/25 to-transparent blur-3xl rounded-full pointer-events-none" />

        <div className="relative px-6 pt-10 pb-6 flex flex-col items-center text-center">
          {/* Animated icon */}
          <div
            className={`transition-all duration-700 ease-out ${
              stage >= 1 ? "opacity-100 scale-100" : "opacity-0 scale-50"
            }`}
          >
            <div className="relative">
              <div className="h-20 w-20 rounded-[22px] bg-gradient-to-br from-primary via-primary to-secondary flex items-center justify-center">
                <Crown className="h-10 w-10 text-primary-foreground" />
              </div>
              {/* Pulse ring */}
              <div className="absolute inset-0 rounded-[22px] bg-primary/20 animate-ping" style={{ animationDuration: "2s" }} />
            </div>
          </div>

          {/* Text */}
          <div
            className={`mt-5 transition-all duration-600 ease-out ${
              stage >= 2 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
          >
            <h2 className="text-2xl font-black tracking-tight text-foreground">
              You're Pro
            </h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-[240px] leading-relaxed">
              Unlimited AI access unlocked. Every feature is yours.
            </p>
          </div>

          {/* Feature pills */}
          <div
            className={`mt-5 flex flex-wrap justify-center gap-1.5 transition-all duration-600 ease-out ${
              stage >= 2 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
            }`}
            style={{ transitionDelay: "150ms" }}
          >
            {["Unlimited AI", "No Ads", "All Features", "Priority"].map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 text-primary">
                <Zap className="h-2.5 w-2.5" />
                {tag}
              </span>
            ))}
          </div>

          {/* Button */}
          <div
            className={`w-full mt-6 transition-all duration-500 ease-out ${
              stage >= 3 ? "opacity-100 translate-y-0" : "opacity-0 translate-y-3"
            }`}
          >
            <Button
              onClick={onClose}
              className="w-full h-12 rounded-xs text-[15px] font-bold bg-gradient-to-r from-primary to-secondary text-primary-foreground active:scale-[0.97] transition-transform"
            >
              Let's Go
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
