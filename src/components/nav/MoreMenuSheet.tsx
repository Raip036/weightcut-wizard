import { Settings, LogOut, ChevronRight, Users, X } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { triggerHapticWarning } from "@/lib/haptics";
import { GymLogoAvatar } from "@/components/coach/GymLogoAvatar";

interface MoreMenuItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface MoreMenuSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  menuItems: MoreMenuItem[];
  onItemClick: (url: string) => void;
  onSettings: () => void;
  onLogout: () => void;
  onMyGym?: () => void;
  /** Optional gym info for replacing the generic Users icon with a real logo */
  gymLogoUrl?: string | null;
  gymName?: string | null;
}

export function MoreMenuSheet({ open, onOpenChange, menuItems, onItemClick, onSettings, onLogout, onMyGym, gymLogoUrl, gymName }: MoreMenuSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
      <SheetContent
        side="bottom"
        className="h-[70vh] max-h-[85vh] rounded-t-2xl flex flex-col p-0 gap-0 bg-background border-t border-border [&>button]:hidden"
      >
        {/* Close button — pinned to the top-right corner of the sheet itself
            so it sits above the menu list rather than sharing a horizontal
            lane with the "Profile" row's chevron below. `modal={false}` +
            `[&>button]:hidden` strips the Radix-provided X and the backdrop
            dismiss, so this is the canonical exit affordance on iOS where
            drag-down isn't obvious. */}
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          aria-label="Close menu"
          className="absolute right-3 top-3 z-10 h-9 w-9 rounded-full flex items-center justify-center text-muted-foreground/80 bg-muted/40 dark:bg-white/[0.06] border border-border/30 active:text-foreground active:bg-muted/60 transition-colors"
        >
          <X className="h-4 w-4" strokeWidth={2.4} />
        </button>

        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1 shrink-0">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/25" aria-hidden />
        </div>
        <SheetHeader className="px-5 pb-2 pt-1 text-left shrink-0 pr-14">
          <SheetTitle className="text-lg font-semibold text-foreground">More</SheetTitle>
        </SheetHeader>
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-4 scrollbar-hide scroll-touch overscroll-contain" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 6rem)" }}>
          {/* Nav links group */}
          <div className="rounded-xs bg-muted/40 dark:bg-muted overflow-hidden border border-border">
            {menuItems.map((item) => (
              <button
                key={item.url}
                type="button"
                onClick={() => onItemClick(item.url)}
                className="w-full flex items-center gap-3 px-4 py-3 touch-manipulation text-left border-b border-border last:border-b-0 active:bg-muted/60 transition-colors duration-100 focus:outline-none focus-visible:outline-none"
              >
                <span className="flex-1 text-[15px] font-medium text-foreground">{item.title}</span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
              </button>
            ))}
          </div>

          {/* Account group: My gym (prominent) → Settings → Logout */}
          <div className="mt-3 rounded-xs bg-muted/40 dark:bg-muted overflow-hidden border border-border">
            {onMyGym && (
              <button
                type="button"
                onClick={onMyGym}
                className="w-full flex items-center gap-3 px-4 py-3 touch-manipulation text-left border-b border-border active:bg-muted/60 transition-colors duration-100 focus:outline-none focus-visible:outline-none"
              >
                {gymLogoUrl || gymName ? (
                  <GymLogoAvatar logoUrl={gymLogoUrl ?? null} name={gymName ?? "Gym"} size={32} />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xs bg-primary/15">
                    <Users className="h-[18px] w-[18px] text-primary" />
                  </span>
                )}
                <span className="flex-1 text-[15px] font-medium text-foreground truncate">
                  {gymName || "My gym"}
                </span>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
              </button>
            )}
            <button
              type="button"
              onClick={onSettings}
              className="w-full flex items-center gap-3 px-4 py-3 touch-manipulation text-left border-b border-border active:bg-muted/60 transition-colors duration-100 focus:outline-none focus-visible:outline-none"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xs bg-muted-foreground/10">
                <Settings className="h-[18px] w-[18px] text-muted-foreground" />
              </span>
              <span className="flex-1 text-[15px] font-medium text-foreground">Settings</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
            </button>
            <button
              type="button"
              onClick={() => { onLogout(); triggerHapticWarning(); }}
              className="w-full flex items-center gap-3 px-4 py-3 touch-manipulation text-left active:bg-muted/60 transition-colors duration-100 focus:outline-none focus-visible:outline-none"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xs bg-destructive/10">
                <LogOut className="h-[18px] w-[18px] text-destructive" />
              </span>
              <span className="flex-1 text-[15px] font-medium text-destructive">Log out</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/60" />
            </button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
