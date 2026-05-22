import * as ionIcons from "ionicons/icons";

export type IonIconName = keyof typeof ionIcons;

export interface IconProps {
  name: IonIconName;
  size?: number;
  className?: string;
  "aria-label"?: string;
  "data-testid"?: string;
}

const DATA_URI_PREFIX = "data:image/svg+xml;utf8,";
const svgCache = new Map<string, string>();

function normalizeSvg(raw: string): string {
  const svg = raw.startsWith(DATA_URI_PREFIX) ? raw.slice(DATA_URI_PREFIX.length) : raw;
  return svg
    .replace(/<svg /, '<svg width="100%" height="100%" ')
    .replace(/class='ionicon-fill-none ionicon-stroke-width'/g, 'fill="none" stroke="currentColor" stroke-width="32" stroke-miterlimit="10"')
    .replace(/class='ionicon-stroke-width'/g, 'stroke="currentColor" stroke-width="32"')
    .replace(/class='ionicon'/, 'fill="currentColor"');
}

function getSvg(name: IonIconName): string {
  const cached = svgCache.get(name);
  if (cached) return cached;
  const normalized = normalizeSvg(ionIcons[name] as string);
  svgCache.set(name, normalized);
  return normalized;
}

export function Icon({
  name,
  size = 20,
  className = "",
  "aria-label": ariaLabel,
  "data-testid": testId,
}: IconProps) {
  const ariaProps =
    ariaLabel !== undefined
      ? ({ role: "img", "aria-label": ariaLabel } as const)
      : ({ "aria-hidden": true } as const);

  return (
    <span
      className={`inline-flex shrink-0 leading-none ${className}`}
      style={{ width: size, height: size }}
      data-testid={testId}
      {...ariaProps}
      dangerouslySetInnerHTML={{ __html: getSvg(name) }}
    />
  );
}
