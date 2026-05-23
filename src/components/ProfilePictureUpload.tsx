import { useState, useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Upload, X, Loader2 } from "lucide-react";
import Cropper from "react-easy-crop";
import { Area } from "react-easy-crop";
import { resizeImageToSquareWebp } from "@/lib/imageResize";
import { logger } from "@/lib/logger";

interface ProfilePictureUploadProps {
  currentAvatarUrl?: string;
  onUploadSuccess: (url: string) => void;
  size?: "sm" | "lg";
  showRemove?: boolean;
}

// Allowed image MIME types for avatar uploads.
const ALLOWED_MIME = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const OUTPUT_SIZE_PX = 512; // 512×512 is plenty for retina avatars

const createImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve(image), { once: true });
    image.addEventListener("error", (error) => reject(error), { once: true });
    image.src = url;
  });

/**
 * Crop to the user-selected area first, then return a dataUrl. The resize
 * step (in `handleUpload`) re-encodes the cropped output to webp/jpeg and
 * shrinks it to OUTPUT_SIZE_PX×OUTPUT_SIZE_PX — so this canvas only needs
 * to be big enough to capture the crop, not the final upload dimensions.
 */
async function getCroppedDataUrl(imageSrc: string, pixelCrop: Area): Promise<string> {
  const image = await createImage(imageSrc);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No 2d context");

  canvas.width = pixelCrop.width;
  canvas.height = pixelCrop.height;
  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    pixelCrop.width,
    pixelCrop.height,
  );
  // Use JPEG here because it's just an intermediate; the resize step picks
  // webp/jpeg based on browser support.
  return canvas.toDataURL("image/jpeg", 0.95);
}

export function ProfilePictureUpload({
  currentAvatarUrl,
  onUploadSuccess,
  size = "lg",
  showRemove = true,
}: ProfilePictureUploadProps) {
  const avatarClass = size === "sm" ? "h-10 w-10" : "h-20 w-20";
  const iconClass = size === "sm" ? "h-4 w-4" : "h-6 w-6";
  const overlayIconClass = size === "sm" ? "h-4 w-4" : "h-5 w-5";
  const [isOpen, setIsOpen] = useState(false);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  // Convex mutations for the avatar-upload flow.
  const generateUploadUrl = useMutation(api.profiles.generateAvatarUploadUrl);
  const setAvatar = useMutation(api.profiles.setAvatar);

  const onCropComplete = useCallback((_: Area, croppedPx: Area) => {
    setCroppedAreaPixels(croppedPx);
  }, []);

  const onFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];

    // MIME validation. Some pickers report empty file.type on iOS; fall back
    // to the broader `image/*` check the input accept attribute already
    // enforces, but still reject anything we recognize as wrong.
    if (file.type && !ALLOWED_MIME.has(file.type)) {
      toast({
        variant: "destructive",
        title: "Unsupported image type",
        description: "Please choose a JPEG, PNG, or WebP image.",
      });
      return;
    }

    if (file.size > MAX_BYTES) {
      toast({
        variant: "destructive",
        title: "File too large",
        description: "Please select an image under 5MB",
      });
      return;
    }

    const reader = new FileReader();
    reader.addEventListener("load", () => {
      setImageSrc(reader.result as string);
      setIsOpen(true);
    });
    reader.readAsDataURL(file);
  };

  const handleUpload = async () => {
    if (!imageSrc || !croppedAreaPixels) return;

    setUploading(true);
    try {
      // 1. Crop to a dataUrl, then resize to a 512×512 webp/jpeg blob. The
      //    resize step keeps avatar storage tiny (~25-40 KB per upload)
      //    instead of multi-megabyte camera frames.
      const croppedDataUrl = await getCroppedDataUrl(imageSrc, croppedAreaPixels);
      const { blob, mime } = await resizeImageToSquareWebp(
        croppedDataUrl,
        OUTPUT_SIZE_PX,
        0.88,
      );
      if (!blob.size) {
        throw new Error("Image encoding produced an empty file");
      }

      // 2. Ask Convex for a one-time POST URL and stream the blob to it.
      const uploadUrl = await generateUploadUrl({});
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

      // 3. Persist the storage id on the profile. The Convex mutation
      //    deletes the previous avatar storage atomically — no race risk.
      await setAvatar({ storageId });

      toast({
        title: "Success",
        description: "Profile picture updated successfully",
      });

      // The new public URL flows back through `profiles.getMine` reactivity
      // (UserContext re-renders); pass an empty string to signal "refresh
      // from the server" and avoid a stale local override.
      onUploadSuccess("");
      setIsOpen(false);
      setImageSrc(null);
    } catch (err) {
      logger.error("Avatar upload failed", err);
      const msg = err instanceof Error ? err.message : "Upload failed";
      toast({
        variant: "destructive",
        title: "Upload failed",
        description: msg,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = async () => {
    if (uploading) return;
    setUploading(true);
    try {
      await setAvatar({ storageId: null });
      toast({ title: "Success", description: "Profile picture removed" });
      onUploadSuccess("");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to remove";
      toast({
        variant: "destructive",
        title: "Failed to remove",
        description: msg,
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <div className="flex items-center gap-3">
        <label
          className={`relative ${avatarClass} cursor-pointer group shrink-0`}
          aria-label="Upload profile photo"
        >
          {currentAvatarUrl ? (
            <img
              src={currentAvatarUrl}
              alt="Profile"
              className={`${avatarClass} rounded-full object-cover`}
            />
          ) : (
            <div className={`${avatarClass} rounded-full bg-muted flex items-center justify-center`}>
              <Upload className={`${iconClass} text-muted-foreground`} />
            </div>
          )}
          <div className="absolute inset-0 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 group-active:opacity-100 transition-opacity flex items-center justify-center">
            <Upload className={`${overlayIconClass} text-white`} />
          </div>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onFileChange}
            className="hidden"
          />
        </label>
        {showRemove && currentAvatarUrl && (
          <Button
            variant="destructive"
            size="icon"
            onClick={handleRemove}
            disabled={uploading}
            aria-label="Remove photo"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-[10003] bg-black/80 animate-in fade-in duration-200"
            onClick={() => !uploading && setIsOpen(false)}
          />
          <div className="fixed left-1/2 top-[env(safe-area-inset-top,1rem)] z-[10004] -translate-x-1/2 w-[calc(100vw-2rem)] sm:max-w-lg sm:top-1/2 sm:-translate-y-1/2 max-h-[calc(100vh-var(--keyboard-inset,0px)-2rem)] overflow-y-auto border bg-background p-4 sm:p-6 rounded-xs space-y-3 sm:space-y-4 mt-2 sm:mt-0">
            <div className="flex items-center justify-between">
              <h3 className="text-base sm:text-lg font-semibold">Crop Profile Picture</h3>
              <button
                onClick={() => !uploading && setIsOpen(false)}
                disabled={uploading}
                className="rounded-sm opacity-70 hover:opacity-100 transition-opacity min-h-[44px] min-w-[44px] flex items-center justify-center disabled:opacity-40"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="relative h-[55vw] max-h-64 sm:max-h-80 w-full">
              {imageSrc && (
                <Cropper
                  image={imageSrc}
                  crop={crop}
                  zoom={zoom}
                  aspect={1}
                  cropShape="round"
                  showGrid={false}
                  onCropChange={setCrop}
                  onZoomChange={setZoom}
                  onCropComplete={onCropComplete}
                />
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Zoom</label>
              <input
                type="range"
                min={1}
                max={3}
                step={0.1}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="w-full"
              />
            </div>
            <div className="flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2">
              <Button variant="outline" onClick={() => setIsOpen(false)} disabled={uploading}>
                Cancel
              </Button>
              <Button onClick={handleUpload} disabled={uploading}>
                {uploading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Uploading...
                  </>
                ) : (
                  "Upload"
                )}
              </Button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
