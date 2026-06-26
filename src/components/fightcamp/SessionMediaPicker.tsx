import { useRef, useState } from "react";
import { Camera, X } from "lucide-react";
import { Capacitor } from "@capacitor/core";
import { Camera as CapCamera, CameraResultType, CameraSource } from "@capacitor/camera";
import { IOSActionSheet } from "@/components/ui/ios-action-sheet";
import { triggerHapticSelection } from "@/lib/haptics";

interface SessionMediaPickerProps {
  mediaPreviewUrl: string | null;
  existingMediaUrl: string | null;
  onMediaSelected: (file: File, previewUrl: string) => void;
  onMediaRemoved: () => void;
}

function isVideo(url: string): boolean {
  return /\.(mp4|mov|webm|avi|m4v)(\?|$)/i.test(url);
}

export function SessionMediaPicker({
  mediaPreviewUrl,
  existingMediaUrl,
  onMediaSelected,
  onMediaRemoved,
}: SessionMediaPickerProps) {
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const displayUrl = mediaPreviewUrl || existingMediaUrl;

  const handleTakePhoto = async () => {
    if (Capacitor.isNativePlatform()) {
      try {
        const perms = await CapCamera.requestPermissions({ permissions: ["camera"] });
        if (perms.camera === "denied") return;

        const photo = await CapCamera.getPhoto({
          quality: 80,
          resultType: CameraResultType.Uri,
          source: CameraSource.Camera,
          width: 1920,
          height: 1920,
        });

        if (photo.webPath) {
          // Route the webPath through `Capacitor.convertFileSrc` so the
          // WebView can read it on BOTH platforms — the raw `file://` URI
          // is sandboxed and silently unreadable by fetch() on Android
          // (no-op-equivalent on iOS WKWebView).
          const response = await fetch(Capacitor.convertFileSrc(photo.webPath));
          const blob = await response.blob();
          const file = new File([blob], `photo-${Date.now()}.jpg`, { type: "image/jpeg" });
          onMediaSelected(file, photo.webPath);
        }
      } catch {
        // User cancelled
      }
    } else {
      // Web fallback: open file input in capture mode
      if (fileInputRef.current) {
        fileInputRef.current.setAttribute("capture", "environment");
        fileInputRef.current.setAttribute("accept", "image/*");
        fileInputRef.current.click();
      }
    }
  };

  const handleChooseFromLibrary = () => {
    if (fileInputRef.current) {
      fileInputRef.current.removeAttribute("capture");
      fileInputRef.current.setAttribute("accept", "image/*,video/*");
      fileInputRef.current.click();
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const previewUrl = URL.createObjectURL(file);
    onMediaSelected(file, previewUrl);

    // Reset input so same file can be re-selected
    e.target.value = "";
  };

  return (
    <div className="space-y-2">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {displayUrl ? (
        <div className="relative rounded-xs overflow-hidden border border-border">
          {isVideo(displayUrl) ? (
            <video
              src={displayUrl}
              className="w-full max-h-48 object-cover rounded-xs"
              controls={false}
              muted
              playsInline
            />
          ) : (
            <img
              src={displayUrl}
              alt="Session media"
              className="w-full max-h-48 object-cover rounded-xs"
            />
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onMediaRemoved();
              triggerHapticSelection();
            }}
            className="absolute top-2 right-2 h-7 w-7 rounded-full bg-black/60 flex items-center justify-center hover:bg-black/80 transition-colors"
          >
            <X className="h-4 w-4 text-white" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { setActionSheetOpen(true); triggerHapticSelection(); }}
          className="w-full py-6 rounded-xs border-2 border-dashed border-border flex flex-col items-center justify-center gap-2 text-muted-foreground hover:border-primary/40 hover:text-primary/70 transition-colors active:scale-[0.98]"
        >
          <Camera className="h-6 w-6" />
          <span className="text-sm font-medium">Add Photo or Video</span>
        </button>
      )}

      {/* Native-iOS action sheet */}
      <IOSActionSheet
        open={actionSheetOpen}
        onOpenChange={setActionSheetOpen}
        title="Add Media"
        actions={[
          { label: "Take Photo", onClick: handleTakePhoto },
          { label: "Choose from Library", onClick: handleChooseFromLibrary },
        ]}
      />
    </div>
  );
}
