import { useRef, useState, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";
import { captureCardAsBlob, downloadCardImage, shareCardImage } from "@/lib/shareUtils";
import { logger } from "@/lib/logger";
import { track, EVENTS } from "@/lib/analytics";

export function useShareCard() {
  const cardRef = useRef<HTMLDivElement>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const { toast } = useToast();

  const captureAndDownload = useCallback(async (filename?: string, transparent?: boolean, type?: string) => {
    if (!cardRef.current) return;
    setIsCapturing(true);
    try {
      const blob = await captureCardAsBlob(cardRef.current, { transparent });
      downloadCardImage(blob, filename ?? `weightcut-wizard-${Date.now()}.png`);
      // Fired only after a successful export (capture + download both threw-free).
      track(EVENTS.SHARE_CARD_SHARED, { type, method: "download" });
    } catch (e) {
      logger.error("Capture failed", e);
      toast({ title: "Failed to capture image", variant: "destructive" });
    } finally {
      setIsCapturing(false);
    }
  }, [toast]);

  const captureAndShare = useCallback(async (title?: string, text?: string, transparent?: boolean, type?: string) => {
    if (!cardRef.current) return;
    setIsCapturing(true);
    try {
      const blob = await captureCardAsBlob(cardRef.current, { transparent });
      await shareCardImage(
        blob,
        title ?? "FightCamp Wizard",
        text ?? "Check out my stats on FightCamp Wizard"
      );
      // Fired only after the share sheet resolves without throwing.
      track(EVENTS.SHARE_CARD_SHARED, { type, method: "share" });
    } catch (e) {
      logger.error("Share failed", e);
      toast({ title: "Failed to share image", variant: "destructive" });
    } finally {
      setIsCapturing(false);
    }
  }, [toast]);

  return { cardRef, isCapturing, captureAndDownload, captureAndShare };
}
