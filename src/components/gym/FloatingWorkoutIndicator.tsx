import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Dumbbell } from "lucide-react";
import { triggerHapticSelection } from "@/lib/haptics";
import { useActiveGymSession } from "@/hooks/useActiveGymSession";

export function FloatingWorkoutIndicator() {
  const { startedAt } = useActiveGymSession();
  const [elapsed, setElapsed] = useState("");
  const navigate = useNavigate();
  const location = useLocation();

  // Update elapsed time display
  useEffect(() => {
    if (!startedAt) return;
    const tick = () => {
      const secs = Math.floor((Date.now() - startedAt) / 1000);
      const m = Math.floor(secs / 60);
      const s = secs % 60;
      setElapsed(`${m}:${s.toString().padStart(2, "0")}`);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startedAt]);

  // Don't show on the gym tracker page itself
  if (!startedAt || location.pathname === "/gym") return null;

  return (
    <button
      onClick={() => { triggerHapticSelection(); navigate("/gym"); }}
      className="fixed z-[9998] left-4 flex items-center gap-2 px-3.5 py-2 rounded-full bg-func-recovery-green text-white active:scale-95 transition-transform md:hidden animate-in slide-in-from-left duration-300"
      // BottomNav baseline = `safe-area-inset-bottom + 0.5rem`; raised FAB
      // pokes ~2rem above that. 7.5rem here keeps the workout pill clear of
      // the FAB on devices with large safe-area insets (notch iPhones).
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 7.5rem)" }}
    >
      <Dumbbell className="h-4 w-4" />
      <span className="text-xs font-bold tabular-nums">{elapsed}</span>
    </button>
  );
}
