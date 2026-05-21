import { useState } from "react";

interface Props {
  logoUrl: string | null | undefined;
  name: string;
  size?: number;
  className?: string;
}

/**
 * Square rounded gym logo with single-letter fallback. Handles broken URLs
 * gracefully and matches the app's minimal Apple-Fitness aesthetic
 * (rounded-xs, muted bg, no flashy iconography).
 */
export function GymLogoAvatar({ logoUrl, name, size = 32, className = "" }: Props) {
  const [errored, setErrored] = useState(false);
  const dimension = { width: size, height: size };
  const showImage = logoUrl && !errored;
  const initial = (name?.trim()?.[0] || "G").toUpperCase();

  if (showImage) {
    return (
      <img
        key={logoUrl}
        src={logoUrl as string}
        alt={`${name} logo`}
        style={dimension}
        className={`rounded-xs object-cover bg-muted/40 flex-shrink-0 ${className}`}
        onError={() => setErrored(true)}
        loading="lazy"
      />
    );
  }

  return (
    <div
      style={dimension}
      className={`rounded-xs bg-muted/60 flex items-center justify-center flex-shrink-0 ${className}`}
      aria-label={`${name} logo`}
    >
      <span className="text-[12px] font-semibold text-muted-foreground">{initial}</span>
    </div>
  );
}
