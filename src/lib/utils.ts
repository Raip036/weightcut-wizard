import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Strip em/en dashes (— –) from AI-generated copy — they read as a tell-tale
 * sign of AI text. Swaps the dash (and any surrounding spaces) for a comma so
 * the sentence still flows naturally, then trims.
 */
export function stripDashes(text: string): string {
  return text.replace(/\s*[—–]\s*/g, ", ").trim();
}
