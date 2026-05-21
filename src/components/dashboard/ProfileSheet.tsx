import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Settings, Pencil, ChevronRight, User, LogOut } from "lucide-react";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import { useProfile, useUser, useAuth } from "@/contexts/UserContext";

interface ProfileSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProfileSheet({ open, onOpenChange }: ProfileSheetProps) {
  const navigate = useNavigate();
  const { avatarUrl, userName } = useProfile();
  const { userId } = useUser();
  const { signOut } = useAuth();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const initials =
    (userName ?? "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s) => s[0]?.toUpperCase() ?? "")
      .join("") || "U";

  function go(path: string) {
    onOpenChange(false);
    setTimeout(() => navigate(path), 120);
  }

  function openSettings() {
    onOpenChange(false);
    setTimeout(
      () => window.dispatchEvent(new CustomEvent("wcw:open-settings")),
      150,
    );
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
      setConfirmOpen(false);
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="rounded-t-2xl border-0 bg-card/95 backdrop-blur-xl p-0 focus:outline-none"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)" }}
        >
          {/* Identity block */}
          <div className="flex items-center gap-4 px-5 pt-6 pb-4">
            <Avatar className="h-16 w-16 border border-border/30 shrink-0">
              <AvatarImage src={avatarUrl || undefined} className="object-cover" />
              <AvatarFallback
                className="text-xl font-semibold"
                style={{ backgroundColor: '#7B31EA', color: '#8B7EEA' }}
              >
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-body-sm font-semibold leading-tight truncate">
                {userName || "Athlete"}
              </p>
              <p className="text-note text-muted-foreground mt-0.5">Your profile</p>
            </div>
          </div>

          <div className="h-px bg-border/40 mx-5" />

          {/* Nav actions */}
          <div className="px-3 py-3 space-y-1">
            <SheetRow
              icon={<User className="h-4 w-4" />}
              label="View Profile"
              onPress={() => go(`/profile/${userId}`)}
            />
            <SheetRow
              icon={<Pencil className="h-4 w-4" />}
              label="Edit Profile"
              onPress={() => go("/goals")}
            />
            <SheetRow
              icon={<Settings className="h-4 w-4" />}
              label="Settings"
              onPress={openSettings}
            />
          </div>

          <div className="h-px bg-border/40 mx-5" />

          {/* Sign out */}
          <div className="px-3 pt-3 pb-1">
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              className="w-full flex items-center gap-3 rounded-xs px-3 py-3.5 active:bg-destructive/5 transition-colors text-left"
            >
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-destructive/10 text-destructive shrink-0">
                <LogOut className="h-4 w-4" />
              </span>
              <span className="flex-1 text-note font-medium text-destructive">Sign Out</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Confirmation dialog */}
      <AlertDialog open={confirmOpen} onOpenChange={(o) => { if (!signingOut) setConfirmOpen(o); }}>
        <AlertDialogContent className="max-w-[240px] rounded-xs p-0 border-0 bg-card/90 backdrop-blur-xl overflow-hidden gap-0">
          <VisuallyHidden><AlertDialogTitle>Sign Out</AlertDialogTitle></VisuallyHidden>
          <AlertDialogDescription asChild>
            <div className="pt-4 pb-3 px-4 text-center">
              <p className="text-body-sm font-semibold text-foreground">Sign Out</p>
              <p className="text-note text-muted-foreground mt-0.5 leading-snug">
                Are you sure? You'll need to sign in again.
              </p>
            </div>
          </AlertDialogDescription>
          <div className="border-t border-border/40">
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              className="w-full py-2.5 text-body-sm font-semibold text-destructive active:bg-muted/50 transition-colors disabled:opacity-40"
            >
              {signingOut ? "Signing out…" : "Sign Out"}
            </button>
            <div className="border-t border-border/40" />
            <button
              onClick={() => setConfirmOpen(false)}
              disabled={signingOut}
              className="w-full py-2.5 text-body-sm font-normal text-primary active:bg-muted/50 transition-colors disabled:opacity-40"
            >
              Cancel
            </button>
          </div>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function SheetRow({
  icon,
  label,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  onPress: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPress}
      className="w-full flex items-center gap-3 rounded-xs px-3 py-3.5 active:bg-white/5 transition-colors text-left"
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary shrink-0">
        {icon}
      </span>
      <span className="flex-1 text-note font-medium">{label}</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}
