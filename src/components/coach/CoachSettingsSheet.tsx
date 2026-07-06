/**
 * Coach settings: iOS-style grouped list inside a bottom sheet.
 *
 * Sections:
 *   1. Account  : coach's identity (name)
 *   2. Gym      : full editor: logo, name, location, invite code, disciplines, roster size, about
 *   3. (always) Danger zone : sign out, delete account
 *
 * Pattern: each row shows label (left) + current value (right, muted) + chevron.
 * Tap toggles inline edit mode; only one row can be open at a time. Save
 * fires on blur or "Done"; cancel via tap-outside or X.
 */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Check,
  ChevronRight,
  Loader2,
  Copy,
  LogOut,
  Trash2,
  X,
} from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth, useUser, useProfile } from "@/contexts/UserContext";
import { useCoachData, type GymRow } from "@/hooks/coach/useCoachData";
import { GymLogoUpload } from "@/components/coach/GymLogoUpload";
import { useToast } from "@/hooks/use-toast";
import { useAction, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { logger } from "@/lib/logger";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";
import { globalLoading } from "@/lib/globalLoading";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { Id } from "../../../convex/_generated/dataModel";
import DeleteReasonPrompt, { type DeleteReasonValue } from "@/components/DeleteReasonPrompt";

const DISCIPLINES = [
  "MMA",
  "BJJ",
  "Boxing",
  "Muay Thai",
  "Wrestling",
  "Kickboxing",
  "Judo",
  "Strength",
] as const;

type EditKey =
  | "name"
  | "gym_name"
  | "gym_location"
  | "gym_disciplines"
  | "gym_count"
  | "gym_about"
  | null;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CoachSettingsSheet({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { signOut } = useAuth();
  const { userId } = useUser();
  const { userName, setUserName } = useProfile();
  const [logoutOpen, setLogoutOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Optional exit-reason picker shown after the delete confirmation, right
  // before the destructive call. Mirrors the fighter (BottomNav) flow.
  const [reasonOpen, setReasonOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const deleteAccount = useAction(api.actions.deleteAccount.run);
  const setUserNameMut = useMutation(api.profiles.setUserName);
  const updateGym = useMutation(api.gyms.update);

  // Editing state: only one row is open at a time, and `draft` holds
  // the current value being edited.
  const [editing, setEditing] = useState<EditKey>(null);
  const [draft, setDraft] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // Reset on close so reopening shows clean state.
  useEffect(() => {
    if (!open) {
      setEditing(null);
      setDraft(null);
    }
  }, [open]);

  const { gyms } = useCoachData(userId);
  const primaryGym: GymRow | undefined = gyms[0];

  // Display values for each row.
  const disciplineLabel = useMemo(() => {
    if (!primaryGym?.disciplines || primaryGym.disciplines.length === 0) return "None";
    if (primaryGym.disciplines.length <= 2) return primaryGym.disciplines.join(", ");
    return `${primaryGym.disciplines.slice(0, 2).join(", ")} +${primaryGym.disciplines.length - 2}`;
  }, [primaryGym?.disciplines]);

  const openEdit = (key: EditKey, initialDraft: any) => {
    triggerHaptic(ImpactStyle.Light);
    setEditing(key);
    setDraft(initialDraft);
  };

  const cancelEdit = () => {
    setEditing(null);
    setDraft(null);
  };

  const saveName = async () => {
    if (!userId || typeof draft !== "string" || !draft.trim() || draft === userName) {
      cancelEdit();
      return;
    }
    setSaving(true);
    try {
      await setUserNameMut({ displayName: draft.trim() });
      setUserName(draft.trim());
      toast({ title: "Name updated" });
      cancelEdit();
    } catch (err) {
      logger.error("CoachSettings: save name failed", err);
      toast({ title: "Could not update name", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const saveGymField = async (
    field: "name" | "location" | "disciplines" | "fighterCount" | "about",
    value: any,
  ) => {
    if (!primaryGym) return;
    setSaving(true);
    try {
      await updateGym({
        gymId: primaryGym.id as Id<"gyms">,
        [field]: value,
      } as any);
      toast({ title: "Saved" });
      cancelEdit();
    } catch (err: any) {
      logger.error(`CoachSettings: save gym ${field} failed`, err);
      toast({
        title: "Could not save",
        description: err?.message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const copyCode = async () => {
    if (!primaryGym) return;
    triggerHaptic(ImpactStyle.Light);
    try {
      await navigator.clipboard.writeText(primaryGym.invite_code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
      toast({ title: "Invite code copied" });
    } catch {
      toast({ title: "Copy failed", variant: "destructive" });
    }
  };

  const handleLogout = async () => {
    if (loggingOut) return;
    setLoggingOut(true);
    globalLoading.show("Signing out…");
    try {
      await signOut();
      onOpenChange(false);
      setLogoutOpen(false);
      navigate("/auth");
      globalLoading.hideAfterPaint();
      toast({ title: "Signed out" });
    } catch {
      globalLoading.hide();
    } finally {
      setLoggingOut(false);
    }
  };

  // `reason` is the optional exit reason from the picker. Undefined = skipped,
  // in which case we send nothing and the server records "not_given". The
  // reason never blocks deletion.
  const handleDelete = async (reason?: DeleteReasonValue) => {
    setDeleting(true);
    globalLoading.show("Deleting account…", "This may take a moment");
    try {
      await deleteAccount(reason ? { reason } : {});
      await signOut();
      onOpenChange(false);
      setReasonOpen(false);
      navigate("/auth");
      globalLoading.hideAfterPaint();
      toast({ title: "Account deleted" });
    } catch (err: any) {
      logger.error("CoachSettings: delete failed", err);
      globalLoading.hide();
      setReasonOpen(false);
      toast({
        title: "Could not delete account",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side="bottom"
          className="rounded-t-3xl p-0 max-h-[90vh] overflow-y-auto [&>button]:hidden"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)" }}
        >
          {/* Grabber */}
          <div className="flex justify-center pt-2 pb-1">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/25" aria-hidden />
          </div>

          {/* Header: transparent so the sheet's own background shows through */}
          <div className="px-5 pt-2 pb-3 flex items-center justify-between">
            <SheetTitle className="text-[19px] font-bold tracking-tight">Settings</SheetTitle>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close settings"
              className="h-9 w-9 rounded-full flex items-center justify-center text-muted-foreground/80 bg-muted/40 active:bg-muted/60 transition-colors"
            >
              <X className="h-4 w-4" strokeWidth={2.4} />
            </button>
          </div>

          <div className="px-5 pt-4 space-y-5">
            {/* ── ACCOUNT ───────────────────────────────────────────── */}
            <Group label="Account">
              <Row
                label="Name"
                value={userName || "Set your name"}
                isOpen={editing === "name"}
                onOpen={() => openEdit("name", userName ?? "")}
                onCancel={cancelEdit}
                expanded={
                  <RowEditor>
                    <Input
                      value={draft ?? ""}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder="Your name"
                      autoFocus
                      className="h-10 rounded-xs bg-muted/40 border-border/30 text-[14px]"
                    />
                    <SaveButton onClick={saveName} disabled={saving || !String(draft ?? "").trim() || draft === userName} loading={saving} />
                  </RowEditor>
                }
              />
            </Group>

            {/* ── GYM ───────────────────────────────────────────────── */}
            {primaryGym && (
              <Group label="Gym">
                {/* Logo: embeds the existing GymLogoUpload so the tap-target is
                    the picker itself, no inline-edit mode needed. */}
                <div className="flex items-center gap-3 px-3 py-3">
                  <span className="text-[13px] text-foreground/85 flex-1">Logo</span>
                  <GymLogoUpload
                    gymId={primaryGym.id}
                    gymName={primaryGym.name}
                    currentLogoUrl={primaryGym.logo_url}
                    size={36}
                    onUploaded={() => { /* reactive via useCoachData */ }}
                    hideRemove
                  />
                </div>
                <Divider />

                <Row
                  label="Name"
                  value={primaryGym.name}
                  isOpen={editing === "gym_name"}
                  onOpen={() => openEdit("gym_name", primaryGym.name)}
                  onCancel={cancelEdit}
                  expanded={
                    <RowEditor>
                      <Input
                        value={draft ?? ""}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="Gym name"
                        autoFocus
                        className="h-10 rounded-xs bg-muted/40 border-border/30 text-[14px]"
                      />
                      <SaveButton
                        onClick={() => saveGymField("name", String(draft ?? "").trim())}
                        disabled={saving || !String(draft ?? "").trim() || draft === primaryGym.name}
                        loading={saving}
                      />
                    </RowEditor>
                  }
                />
                <Divider />

                <Row
                  label="Location"
                  value={primaryGym.location || "Add a location"}
                  muted={!primaryGym.location}
                  isOpen={editing === "gym_location"}
                  onOpen={() => openEdit("gym_location", primaryGym.location ?? "")}
                  onCancel={cancelEdit}
                  expanded={
                    <RowEditor>
                      <Input
                        value={draft ?? ""}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="City, country"
                        autoFocus
                        className="h-10 rounded-xs bg-muted/40 border-border/30 text-[14px]"
                      />
                      <SaveButton
                        onClick={() => saveGymField("location", String(draft ?? "").trim() || null)}
                        disabled={saving || draft === (primaryGym.location ?? "")}
                        loading={saving}
                      />
                    </RowEditor>
                  }
                />
                <Divider />

                {/* Invite code: read-only with inline copy */}
                <button
                  onClick={copyCode}
                  className="w-full flex items-center justify-between px-3 py-3 active:bg-muted/30 transition-colors"
                >
                  <span className="text-[13px] text-foreground/85">Invite code</span>
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-[12px] font-semibold tracking-widest tabular-nums text-foreground">
                      {primaryGym.invite_code}
                    </span>
                    {copied ? (
                      <Check className="h-3.5 w-3.5 text-func-recovery-green" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </span>
                </button>
                <Divider />

                <Row
                  label="Disciplines"
                  value={disciplineLabel}
                  muted={!primaryGym.disciplines || primaryGym.disciplines.length === 0}
                  isOpen={editing === "gym_disciplines"}
                  onOpen={() => openEdit("gym_disciplines", primaryGym.disciplines ?? [])}
                  onCancel={cancelEdit}
                  expanded={
                    <RowEditor>
                      <div className="flex flex-wrap gap-2">
                        {DISCIPLINES.map((d) => {
                          const arr: string[] = draft ?? [];
                          const active = arr.includes(d);
                          return (
                            <button
                              key={d}
                              type="button"
                              onClick={() => {
                                triggerHaptic(ImpactStyle.Light);
                                setDraft(active ? arr.filter((x) => x !== d) : [...arr, d]);
                              }}
                              className={`min-h-[32px] px-3 rounded-xs border text-[12px] font-medium transition active:scale-[0.97] flex items-center gap-1 ${
                                active
                                  ? "bg-primary text-primary-foreground border-primary"
                                  : "bg-muted/30 text-foreground border-border/40"
                              }`}
                            >
                              {active && <Check className="h-3 w-3" />}
                              {d}
                            </button>
                          );
                        })}
                      </div>
                      <SaveButton
                        onClick={() => saveGymField("disciplines", (draft as string[])?.length ? draft : null)}
                        disabled={saving}
                        loading={saving}
                      />
                    </RowEditor>
                  }
                />
                <Divider />

                <Row
                  label="Roster size"
                  value={primaryGym.fighter_count != null ? String(primaryGym.fighter_count) : "Not set"}
                  muted={primaryGym.fighter_count == null}
                  isOpen={editing === "gym_count"}
                  onOpen={() => openEdit("gym_count", primaryGym.fighter_count != null ? String(primaryGym.fighter_count) : "")}
                  onCancel={cancelEdit}
                  expanded={
                    <RowEditor>
                      <Input
                        value={draft ?? ""}
                        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
                        placeholder="e.g. 12"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoFocus
                        className="h-10 rounded-xs bg-muted/40 border-border/30 text-[14px]"
                      />
                      <SaveButton
                        onClick={() => {
                          const n = Number(String(draft ?? "").trim());
                          saveGymField("fighterCount", Number.isFinite(n) && n >= 0 ? n : null);
                        }}
                        disabled={saving}
                        loading={saving}
                      />
                    </RowEditor>
                  }
                />
                <Divider />

                <Row
                  label="About"
                  value={primaryGym.about || "Add a line"}
                  muted={!primaryGym.about}
                  isOpen={editing === "gym_about"}
                  onOpen={() => openEdit("gym_about", primaryGym.about ?? "")}
                  onCancel={cancelEdit}
                  expanded={
                    <RowEditor>
                      <textarea
                        value={draft ?? ""}
                        onChange={(e) => setDraft(e.target.value)}
                        placeholder="One line on what makes your gym yours."
                        rows={3}
                        maxLength={200}
                        autoFocus
                        className="w-full resize-none rounded-xs bg-muted/40 border border-border/30 p-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                      <SaveButton
                        onClick={() => saveGymField("about", String(draft ?? "").trim() || null)}
                        disabled={saving || draft === (primaryGym.about ?? "")}
                        loading={saving}
                      />
                    </RowEditor>
                  }
                />
              </Group>
            )}

            {/* ── PREFERENCES (theme only, single inline row) ───────── */}
            <Group label="Preferences">
              <div className="flex items-center justify-between px-3 py-3">
                <span className="text-[13px] text-foreground/85">Theme</span>
                <ThemeToggle />
              </div>
            </Group>

            {/* ── DANGER ZONE ─────────────────────────────────────────── */}
            <Group label="Account actions">
              <button
                onClick={() => setLogoutOpen(true)}
                className="w-full flex items-center gap-3 px-3 py-3 active:bg-muted/30 transition-colors text-left"
              >
                <LogOut className="h-4 w-4 text-muted-foreground" strokeWidth={2} />
                <span className="text-[13px] flex-1">Sign out</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
              </button>
              <Divider />
              <button
                onClick={() => setDeleteOpen(true)}
                className="w-full flex items-center gap-3 px-3 py-3 active:bg-destructive/10 transition-colors text-left"
              >
                <Trash2 className="h-4 w-4 text-destructive/90" strokeWidth={2} />
                <div className="flex-1">
                  <p className="text-[13px] font-medium text-destructive">Delete account</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Permanently removes your account, gym, and data.</p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground/40" />
              </button>
            </Group>
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={logoutOpen} onOpenChange={setLogoutOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-center">Sign out?</AlertDialogTitle>
            <AlertDialogDescription className="text-center">
              You'll need your email and password to sign back in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-row justify-center sm:justify-center gap-2">
            <AlertDialogCancel disabled={loggingOut} className="mt-0">Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleLogout} disabled={loggingOut}>
              {loggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign out"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete account permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes your account, your gym, and removes all athletes from it.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setDeleteOpen(false); setReasonOpen(true); }}
              disabled={deleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Delete forever"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Optional exit-reason picker; any pick (or Skip) deletes. */}
      <DeleteReasonPrompt
        open={reasonOpen}
        loading={deleting}
        onPick={(reason) => handleDelete(reason)}
        onSkip={() => handleDelete()}
        onDismiss={() => setReasonOpen(false)}
      />
    </>
  );
}

// ── Sub-components ──────────────────────────────────────────────────

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <p className="px-1 mb-1.5 text-[10px] uppercase tracking-[0.14em] font-bold text-muted-foreground/70">
        {label}
      </p>
      <div className="rounded-xs card-surface overflow-hidden">
        {children}
      </div>
    </section>
  );
}

function Divider() {
  return <div className="h-px bg-border/30 ml-3" aria-hidden />;
}

function Row({
  label,
  value,
  muted = false,
  isOpen,
  onOpen,
  onCancel,
  expanded,
}: {
  label: string;
  value: string;
  muted?: boolean;
  isOpen: boolean;
  onOpen: () => void;
  onCancel: () => void;
  expanded: React.ReactNode;
}) {
  if (isOpen) {
    return (
      <div className="px-3 py-3 bg-primary/[0.04]">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[13px] font-semibold text-foreground">{label}</span>
          <button
            onClick={onCancel}
            className="text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            Cancel
          </button>
        </div>
        {expanded}
      </div>
    );
  }
  return (
    <button
      onClick={onOpen}
      className="w-full flex items-center justify-between gap-3 px-3 py-3 active:bg-muted/30 transition-colors"
    >
      <span className="text-[13px] text-foreground/85 flex-shrink-0">{label}</span>
      <span className="flex items-center gap-1.5 min-w-0">
        <span className={`text-[13px] text-right truncate ${muted ? "text-muted-foreground/60" : "text-foreground"}`}>
          {value}
        </span>
        <ChevronRight className="h-4 w-4 text-muted-foreground/40 flex-shrink-0" />
      </span>
    </button>
  );
}

function RowEditor({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-2">{children}</div>;
}

function SaveButton({
  onClick,
  disabled,
  loading,
}: {
  onClick: () => void;
  disabled: boolean;
  loading: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="self-end h-9 px-4 rounded-xs bg-primary text-primary-foreground text-[13px] font-semibold active:scale-[0.97] transition-transform disabled:opacity-40"
    >
      {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
    </button>
  );
}
