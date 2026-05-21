import { useEffect, useRef, useState } from "react";
import { Upload, Loader2, X, ImagePlus, Check } from "lucide-react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useToast } from "@/hooks/use-toast";
import { resizeImageToSquareWebp } from "@/lib/imageResize";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { logger } from "@/lib/logger";
import { GymLogoAvatar } from "./GymLogoAvatar";

interface Props {
  gymId: string;
  gymName: string;
  currentLogoUrl: string | null;
  size?: number;
  onUploaded: (newUrl: string | null) => void;
  /** When true, hide the remove button (used in compact contexts) */
  hideRemove?: boolean;
}

const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/**
 * Tap the avatar → file picker → resize to 256×256 webp (or jpeg fallback) →
 * upload to Convex File Storage → patch gyms.logoStorageId. The display URL
 * comes from `currentLogoUrl` (Convex query, derived from logoStorageId
 * server-side), so once the mutation resolves the parent re-renders with
 * the new URL automatically.
 */
export function GymLogoUpload({
  gymId,
  gymName,
  currentLogoUrl,
  size = 56,
  onUploaded,
  hideRemove = false,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<"idle" | "success">("idle");
  const [pulseHint, setPulseHint] = useState<boolean>(currentLogoUrl == null);
  const { toast } = useToast();
  const generateLogoUploadUrl = useMutation(api.gyms.generateLogoUploadUrl);
  const setLogo = useMutation(api.gyms.setLogo);

  // Auto-disable the discoverability pulse after 3s on first render
  useEffect(() => {
    if (!pulseHint) return;
    const t = window.setTimeout(() => setPulseHint(false), 3000);
    return () => window.clearTimeout(t);
  }, [pulseHint]);

  const triggerPicker = () => {
    if (uploading) return;
    triggerHaptic(ImpactStyle.Light);
    inputRef.current?.click();
  };

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = ""; // allow re-selecting same file later

    if (file.type && !ALLOWED_MIME.has(file.type)) {
      toast({
        title: "Unsupported image type",
        description: "Use JPEG, PNG, or WebP.",
        variant: "destructive",
      });
      return;
    }
    if (file.size > MAX_BYTES) {
      toast({
        title: "Image too large",
        description: "Keep it under 5MB",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("File read failed"));
        reader.readAsDataURL(file);
      });

      const { blob, mime, ext } = await resizeImageToSquareWebp(dataUrl, 256, 0.85);
      logger.info("GymLogoUpload: encoded image", {
        gymId,
        size: blob.size,
        type: blob.type || mime,
        ext,
      });

      if (!blob.size) {
        throw new Error("Encoded image is empty — please try a different photo.");
      }

      // 1. Mint a one-time upload URL from Convex (auth-gated to the owner).
      const uploadUrl = await generateLogoUploadUrl({ gymId: gymId as Id<"gyms"> });

      // 2. POST the blob.
      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": mime },
        body: blob,
      });
      if (!uploadRes.ok) {
        throw new Error(`Upload failed (${uploadRes.status})`);
      }
      const { storageId } = (await uploadRes.json()) as {
        storageId: Id<"_storage">;
      };

      // 3. Persist on the gym row — the mutation deletes the previous logo
      //    storage object atomically.
      await setLogo({ gymId: gymId as Id<"gyms">, storageId });

      // Reactive Convex query will surface the fresh URL on the next render.
      // Pass null to clear any stale parent-cached value; the parent re-fetches
      // from `api.gyms.getById` (or its overview) and gets the new URL.
      onUploaded(null);
      setStatus("success");
      window.setTimeout(() => setStatus("idle"), 1000);
      toast({ title: "Logo updated" });
    } catch (err: unknown) {
      logger.error("GymLogoUpload: upload failed", err, { gymId });
      handleUploadError(err);
    } finally {
      setUploading(false);
    }
  };

  const handleUploadError = (err: unknown) => {
    const e = (err ?? {}) as {
      message?: string;
      error?: string;
      statusCode?: number | string;
      name?: string;
    };
    const raw =
      (typeof e.error === "string" && e.error) ||
      e.message ||
      "Unknown error";

    if (/only the gym owner/i.test(raw)) {
      toast({
        title: "Permission denied",
        description: "Only the gym owner can change the logo.",
        variant: "destructive",
      });
      return;
    }

    if (e.name === "TypeError" && /load failed/i.test(raw)) {
      toast({
        title: "Could not upload logo",
        description: "Network error — check your connection and try again.",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Could not upload logo",
      description: raw,
      variant: "destructive",
    });
  };

  const handleRemove = async () => {
    if (uploading || !currentLogoUrl) return;
    setUploading(true);
    triggerHaptic(ImpactStyle.Medium);
    try {
      await setLogo({ gymId: gymId as Id<"gyms">, storageId: null });
      onUploaded(null);
      toast({ title: "Logo removed" });
    } catch (err: unknown) {
      logger.error("GymLogoUpload: remove failed", err, { gymId });
      toast({ title: "Could not remove logo", variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const hasLogo = !!currentLogoUrl;

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={triggerPicker}
        disabled={uploading}
        className={`relative group flex-shrink-0 transition-opacity ${
          uploading ? "opacity-60" : "opacity-100"
        }`}
        aria-label={hasLogo ? "Change gym logo" : "Upload gym logo"}
      >
        {hasLogo ? (
          <>
            <GymLogoAvatar logoUrl={currentLogoUrl} name={gymName} size={size} />
            <span className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-background border border-border flex items-center justify-center shadow-sm">
              {uploading ? (
                <Loader2 className="h-2.5 w-2.5 text-foreground animate-spin" />
              ) : status === "success" ? (
                <Check className="h-2.5 w-2.5 text-emerald-500" />
              ) : (
                <Upload className="h-2.5 w-2.5 text-foreground" />
              )}
            </span>
          </>
        ) : (
          <div
            style={{ width: size, height: size }}
            className={`rounded-xs border-2 border-dashed border-primary/40 bg-primary/5 flex flex-col items-center justify-center text-primary active:bg-primary/10 transition-colors ${
              pulseHint ? "animate-pulse" : ""
            }`}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <ImagePlus className="h-4 w-4" />
                {size >= 56 && (
                  <span className="text-[8px] font-semibold uppercase tracking-wider mt-0.5">
                    Logo
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </button>
      {hasLogo && !hideRemove && (
        <button
          type="button"
          onClick={handleRemove}
          disabled={uploading}
          className="h-8 w-8 rounded-full bg-muted/50 active:bg-destructive/20 transition-colors flex items-center justify-center text-muted-foreground active:text-destructive"
          aria-label="Remove logo"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={onFileChange}
      />
    </div>
  );
}
