import { useRef, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { isNativePlatform } from "@/hooks/useIsNative";

const ENTER_DURATION = isNativePlatform ? 0.22 : 0.26;
const EXIT_DURATION = isNativePlatform ? 0.12 : 0.14;
const IOS_EASE = [0.32, 0.72, 0, 1] as const;

interface PageTransitionProps {
  children: React.ReactNode;
}

export function PageTransition({ children }: PageTransitionProps) {
  const location = useLocation();
  const prefersReducedMotion = useReducedMotion();
  const prevPath = useRef(location.pathname);

  useEffect(() => {
    if (prevPath.current !== location.pathname) {
      prevPath.current = location.pathname;
      const main = document.querySelector("main");
      if (main) main.scrollTo(0, 0);
      window.scrollTo(0, 0);
    }
  }, [location.pathname]);

  if (prefersReducedMotion) {
    return (
      <div className="page-transition-container">
        <div className="page-transition-page">{children}</div>
      </div>
    );
  }

  return (
    <div className="page-transition-container">
      <AnimatePresence
        mode="popLayout"
        initial={false}
      >
        <motion.div
          key={location.pathname}
          className="page-transition-page"
          initial={{ opacity: 0, y: 4, scale: 0.995 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: EXIT_DURATION, ease: "easeOut" } }}
          transition={{
            opacity: { duration: ENTER_DURATION, ease: IOS_EASE },
            y: { duration: ENTER_DURATION, ease: IOS_EASE },
            scale: { duration: ENTER_DURATION, ease: IOS_EASE },
          }}
          style={{ willChange: "opacity, transform" }}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
