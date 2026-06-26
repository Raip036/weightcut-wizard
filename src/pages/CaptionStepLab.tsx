import { useState } from "react";
import { CaptionStep } from "@/pages/nutrition/dialogs/quickAdd/CaptionStep";

/* THROWAWAY lab — /caption-lab. Renders the redesigned CaptionStep in a
   sheet-like frame to eyeball the layout. Delete after sign-off. */
export default function CaptionStepLab() {
  const [desc, setDesc] = useState("");
  const [extra, setExtra] = useState<string[]>([]);
  // A 1x1 transparent base64 stand-in for an extra-angle thumbnail.
  const STUB =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  return (
    <div className="min-h-screen w-full bg-black/60 flex items-end justify-center">
      <div className="w-full max-w-md rounded-t-2xl bg-background border-t border-white/10 max-h-[92vh] overflow-y-auto">
        <div className="px-5 pt-4 pb-2 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add a meal</h2>
          <span className="text-muted-foreground">✕</span>
        </div>
        <CaptionStep
          imageBase64="stub"
          imagePreviewUrl="https://picsum.photos/seed/meal/600/600"
          description={desc}
          onDescriptionChange={setDesc}
          onAnalyze={() => {}}
          onRetake={() => {}}
          extraPhotos={extra}
          onAddAngle={() => setExtra((p) => (p.length >= 2 ? p : [...p, STUB]))}
          onRemoveAngle={(i) => setExtra((p) => p.filter((_, idx) => idx !== i))}
          onToast={() => {}}
        />
      </div>
    </div>
  );
}
