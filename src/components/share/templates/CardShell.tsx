import { ReactNode, forwardRef } from "react";
import { CardWatermark } from "./CardWatermark";

export type AspectRatio = "square" | "story";

interface CardShellProps {
  children: ReactNode;
  aspect?: AspectRatio;
  isPremium?: boolean;
  transparent?: boolean;
}

const DIMENSIONS: Record<AspectRatio, { width: number; height: number }> = {
  square: { width: 1080, height: 1080 },
  story: { width: 1080, height: 1920 },
};

export const CardShell = forwardRef<HTMLDivElement, CardShellProps>(
  ({ children, aspect = "square", isPremium = false, transparent = false }, ref) => {
    const { width, height } = DIMENSIONS[aspect];
    const s = aspect === "story";

    return (
      <div
        ref={ref}
        style={{
          width,
          height,
          position: "relative",
          overflow: "hidden",
          fontFamily:
            'Satoshi, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          color: "#ffffff",
          ...(transparent && { textShadow: "0 2px 8px rgba(0,0,0,1), 0 0 24px rgba(0,0,0,0.7)" }),
          background: transparent
            ? "none"
            : "radial-gradient(ellipse at 20% 0%, hsl(var(--primary) / 0.15) 0%, transparent 50%), " +
              "radial-gradient(ellipse at 80% 100%, hsl(var(--primary) / 0.1) 0%, transparent 50%), " +
              "linear-gradient(180deg, #0a0a0a 0%, #080808 50%, #050505 100%)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Top bar: text-only brand watermark, logo removed, text enlarged */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            padding: s ? "64px 56px 0" : "40px 40px 0",
          }}
        >
          <span
            style={{
              fontSize: s ? 56 : 34,
              fontWeight: 800,
              letterSpacing: "-0.02em",
              color: transparent ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.85)",
            }}
          >
            FightCamp Wizard
          </span>
        </div>

        {/* Card content */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            padding: s ? "40px 56px 100px" : "24px 40px 72px",
            justifyContent: s ? "center" : "flex-start",
          }}
        >
          {children}
        </div>

        {/* Watermark for free users */}
        {!isPremium && <CardWatermark large={s} />}
      </div>
    );
  }
);

CardShell.displayName = "CardShell";
