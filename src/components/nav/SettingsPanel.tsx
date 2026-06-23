import { Icon, type IonIconName } from "@/components/ui/Icon";
import { Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ProfilePictureUpload } from "@/components/ProfilePictureUpload";
import { Capacitor } from "@capacitor/core";
import { useState, type ReactNode } from "react";
import { getSettings, saveSettings, scheduleReminder, cancelReminder, type ReminderSettings } from "@/lib/weightReminder";
import { useSubscription } from "@/hooks/useSubscription";
import { restorePurchases, isPremiumFromCustomerInfo, presentCustomerCenter } from "@/lib/purchases";
import { PremiumBadge } from "@/components/subscription/PremiumBadge";
import { ShimmerCrownBadge } from "@/components/subscription/ShimmerCrownBadge";
import { useProfile } from "@/contexts/UserContext";
import { useToast as useToastSub } from "@/hooks/use-toast";

/* ────────────────────────────────────────────────────────────────────
 * iOS-native settings primitives.
 * `Section` wraps grouped rows in a rounded container with optional
 * caption header + footer. `Row` renders a single cell with a colored
 * icon tile, label, optional sublabel, and a trailing slot. Mirrors
 * the visual rhythm of iOS' Settings.app grouped tables.
 * ──────────────────────────────────────────────────────────────────── */

function Section({
  header,
  footer,
  children,
}: {
  header?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mt-5 first:mt-2">
      {header && (
        <p className="px-4 pb-1.5 text-[11px] uppercase tracking-[0.06em] text-muted-foreground/70 font-semibold">
          {header}
        </p>
      )}
      <div className="rounded-2xl card-surface overflow-hidden divide-y divide-border/30">
        {children}
      </div>
      {footer && (
        <p className="px-4 pt-1.5 text-[11px] text-muted-foreground/60 leading-snug">
          {footer}
        </p>
      )}
    </div>
  );
}

// `color` is retained on the row API so call sites don't change, but icons no
// longer sit on coloured tiles; they render as plain glyphs. Everything is
// white except the destructive "red" action (Delete Account), which stays red.
type TileColor =
  | "brand" | "indigo" | "orange" | "red";

function IconTile({ name, color, glyphClass }: { name: IonIconName; color: TileColor; glyphClass?: string }) {
  const tone = color === "red" ? "text-destructive" : "text-foreground";
  return (
    <span className={`flex h-7 w-7 items-center justify-center shrink-0 ${glyphClass ?? tone}`}>
      <Icon name={name} size={20} />
    </span>
  );
}

interface RowProps {
  icon?: { name: IonIconName; color: TileColor };
  label: string;
  sublabel?: string;
  /** Trailing slot: value text, Switch, or chevron. Replaces the default chevron when set. */
  trailing?: ReactNode;
  destructive?: boolean;
  onClick?: () => void;
  href?: string;
  disabled?: boolean;
  /** When true, no chevron rendered and the row is non-interactive layout (used for Switch rows). */
  asStatic?: boolean;
}

function Row({ icon, label, sublabel, trailing, destructive, onClick, href, disabled, asStatic }: RowProps) {
  const labelClasses = destructive
    ? "text-[15px] font-normal text-destructive"
    : "text-[15px] font-normal text-foreground";

  const inner = (
    <>
      {icon && <IconTile name={icon.name} color={icon.color} />}
      <div className="flex-1 min-w-0">
        <p className={labelClasses}>{label}</p>
        {sublabel && (
          <p className="text-[12.5px] text-muted-foreground/85 leading-tight mt-0.5">{sublabel}</p>
        )}
      </div>
      {trailing !== undefined ? (
        trailing
      ) : !asStatic ? (
        <Icon name="chevronForwardOutline" size={14} className="text-muted-foreground/45 shrink-0" />
      ) : null}
    </>
  );

  const baseClass = "w-full flex items-center gap-3 px-4 py-3 min-h-[48px] text-left transition-colors";
  const activeClass = asStatic ? "" : "active:bg-white/[0.04]";

  if (href) {
    return (
      <Link to={href} className={`${baseClass} ${activeClass}`}>
        {inner}
      </Link>
    );
  }
  if (asStatic) {
    return <div className={`${baseClass}`}>{inner}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`${baseClass} ${activeClass} disabled:opacity-50`}
    >
      {inner}
    </button>
  );
}

/* ────────────────────────────────────────────────────────────────────
 * Subscription section: Premium status OR upgrade + restore.
 * ──────────────────────────────────────────────────────────────────── */

function SubscriptionSection() {
  const { isPremium, rawTier, expiresAt, openPaywall } = useSubscription();
  const { refreshProfile } = useProfile();
  const { toast } = useToastSub();
  const [restoringPurchases, setRestoringPurchases] = useState(false);

  const handleRestore = async () => {
    setRestoringPurchases(true);
    try {
      const info = await restorePurchases();
      if (info && isPremiumFromCustomerInfo(info)) {
        await new Promise((r) => setTimeout(r, 2000));
        await refreshProfile();
        toast({ title: "Purchases restored!", description: "Premium access has been restored." });
      } else {
        toast({ title: "No active subscription found", description: "If you believe this is an error, contact support." });
      }
    } catch {
      toast({ title: "Restore failed", description: "Please try again.", variant: "destructive" as const });
    } finally {
      setRestoringPurchases(false);
    }
  };

  if (isPremium) {
    const expiryLabel = expiresAt
      ? `Renews ${expiresAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
      : "Active";
    const planLabel = rawTier === "premium_lifetime" ? "Lifetime" : rawTier === "premium_annual" ? "Annual" : "Monthly";

    return (
      <Section header="Subscription">
        <Row
          icon={{ name: "ribbonOutline", color: "brand" }}
          label="Premium"
          sublabel={`${planLabel} · ${expiryLabel}`}
          trailing={<PremiumBadge />}
          asStatic
        />
        <Row
          icon={{ name: "settingsOutline", color: "brand" }}
          label="Manage Subscription"
          onClick={() => presentCustomerCenter()}
        />
      </Section>
    );
  }

  // Non-premium: Upgrade gets its own glowing hero card so it pops off the
  // page. Restore Purchases drops down into a normal grouped section below
  // (lower hierarchy; most users don't need it, and iOS Settings hides
  // utility rows below CTA banners too).
  return (
    <>
      <button
        type="button"
        onClick={openPaywall}
        className="mt-5 w-full flex items-center gap-3 px-4 py-3.5 rounded-2xl text-left transition-transform active:scale-[0.99] bg-gradient-to-br from-primary/25 via-primary/10 to-primary/[0.04] ring-1 ring-primary/40 shadow-[0_0_28px_-4px_rgba(33,97,241,0.55),inset_0_0_24px_-8px_rgba(33,97,241,0.45)]"
      >
        <ShimmerCrownBadge size={38} />
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-semibold text-foreground">Upgrade to Pro</p>
          <p className="text-[12.5px] text-foreground/70 leading-tight mt-0.5">
            Unlimited AI · Advanced insights
          </p>
        </div>
        <Icon name="chevronForwardOutline" size={14} className="text-primary/70 shrink-0" />
      </button>
      <Section>
        <Row
          icon={{ name: "refreshOutline", color: "brand" }}
          label="Restore Purchases"
          onClick={handleRestore}
          disabled={restoringPurchases}
          trailing={null}
        />
      </Section>
    </>
  );
}

interface SettingsPanelProps {
  open: boolean;
  onClose: () => void;
  userName: string;
  userEmail: string;
  avatarUrl: string | null;
  editedName: string;
  setEditedName: (name: string) => void;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  onAvatarChange: (url: string) => void;
  onSave: () => void;
  onReplayTutorial: () => void;
  onDeleteAccount: () => void;
  goalType?: 'cutting' | 'losing';
  onToggleGoalType?: (fighterMode: boolean) => void;
}

export function SettingsPanel({
  open, onClose,
  userName, userEmail, avatarUrl,
  editedName, setEditedName,
  theme, onToggleTheme,
  onAvatarChange, onSave,
  onReplayTutorial,
  onDeleteAccount,
  goalType,
  onToggleGoalType,
}: SettingsPanelProps) {
  const [reminderSettings, setReminderSettings] = useState<ReminderSettings>(getSettings);
  const [timePickerOpen, setTimePickerOpen] = useState(false);
  const [medicalOpen, setMedicalOpen] = useState(false);

  if (!open) return null;

  const handleToggle = async (checked: boolean) => {
    const next = { ...reminderSettings, enabled: checked };
    setReminderSettings(next);
    saveSettings(next);
    if (checked) {
      await scheduleReminder(next.hour, next.minute);
    } else {
      await cancelReminder();
      setTimePickerOpen(false);
    }
  };

  const handleTimeChange = async (field: "hour12" | "minute" | "ampm", value: number | string) => {
    let { hour, minute } = reminderSettings;
    const currentAmpm = hour < 12 ? "AM" : "PM";
    let hour12 = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;

    if (field === "hour12") hour12 = value as number;
    if (field === "minute") minute = value as number;
    const newAmpm = field === "ampm" ? (value as string) : currentAmpm;

    if (newAmpm === "AM") {
      hour = hour12 === 12 ? 0 : hour12;
    } else {
      hour = hour12 === 12 ? 12 : hour12 + 12;
    }

    const next: ReminderSettings = { enabled: true, hour, minute };
    setReminderSettings(next);
    saveSettings(next);
    await scheduleReminder(hour, minute);
  };

  void userName;

  return (
    <>
      <div
        className="fixed inset-0 z-[10001] bg-black/60 animate-in fade-in duration-200"
        onClick={onClose}
      />
      <div
        className="fixed inset-x-0 bottom-0 z-[10002] bg-background border-0 rounded-t-2xl animate-in slide-in-from-bottom duration-300 flex flex-col"
        style={{ maxHeight: "92dvh" }}
      >
        {/* Drag handle */}
        <div className="flex justify-center pt-2.5 pb-1 shrink-0">
          <div className="w-9 h-1 rounded-full bg-muted-foreground/25" />
        </div>

        {/* iOS-style large title header. */}
        <div className="px-4 pt-2 pb-3 shrink-0 flex items-center justify-between">
          <h2 className="text-[26px] font-bold tracking-tight">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close settings"
            className="h-8 w-8 rounded-full bg-muted/40 flex items-center justify-center text-muted-foreground active:bg-muted/60 transition-colors"
          >
            <Icon name="closeOutline" size={16} />
          </button>
        </div>

        <div
          className="px-3 overflow-y-auto overscroll-contain scrollbar-hide"
          style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.5rem)" }}
        >
          {/* Profile card: distinct from grouped sections (hero, not a row) */}
          <div className="rounded-2xl bg-muted/15 p-4 flex items-center gap-3.5">
            <ProfilePictureUpload
              size="lg"
              showRemove={false}
              currentAvatarUrl={avatarUrl || undefined}
              onUploadSuccess={onAvatarChange}
            />
            <div className="flex-1 min-w-0">
              <Input
                id="name"
                value={editedName}
                onChange={(e) => setEditedName(e.target.value)}
                placeholder="Your name"
                className="h-9 text-[15px] font-medium rounded-lg border-border/30 bg-background/40 px-3"
              />
              {userEmail && (
                <p className="text-[12.5px] text-muted-foreground mt-1.5 ml-1 truncate">{userEmail}</p>
              )}
            </div>
          </div>

          <SubscriptionSection />

          {/* Preferences */}
          <Section header="Preferences">
            <Row
              icon={
                theme === "dark"
                  ? { name: "moonOutline", color: "indigo" }
                  : { name: "sunnyOutline", color: "orange" }
              }
              label={theme === "dark" ? "Dark Mode" : "Light Mode"}
              onClick={onToggleTheme}
            />
            {onToggleGoalType && (
              <Row
                icon={{ name: "trophyOutline", color: "brand" }}
                label="Fighter Mode"
                sublabel="Track fight-camp-specific goals"
                trailing={
                  <Switch
                    checked={goalType === "cutting"}
                    onCheckedChange={onToggleGoalType}
                  />
                }
                asStatic
              />
            )}
            {Capacitor.isNativePlatform() && (() => {
              const h = reminderSettings.hour;
              const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
              const ampm = h < 12 ? "AM" : "PM";
              const displayMinute = String(reminderSettings.minute).padStart(2, "0");
              const subtitle = reminderSettings.enabled
                ? `${displayHour}:${displayMinute} ${ampm}`
                : "Off";

              return (
                <>
                  <div
                    className="w-full flex items-center gap-3 px-4 py-3 min-h-[48px] cursor-pointer transition-colors active:bg-white/[0.04]"
                    onClick={() => {
                      if (reminderSettings.enabled) setTimePickerOpen(!timePickerOpen);
                    }}
                  >
                    <IconTile name="notificationsOutline" color="brand" />
                    <div className="flex-1 min-w-0">
                      <p className="text-[15px] text-foreground">Weight Reminder</p>
                      <p className="text-[12.5px] text-muted-foreground/85 leading-tight mt-0.5">{subtitle}</p>
                    </div>
                    <Switch
                      checked={reminderSettings.enabled}
                      onCheckedChange={handleToggle}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </div>
                  {timePickerOpen && reminderSettings.enabled && (() => {
                    const curHour24 = reminderSettings.hour;
                    const curHour12 = curHour24 === 0 ? 12 : curHour24 > 12 ? curHour24 - 12 : curHour24;
                    const curAmpm = curHour24 < 12 ? "AM" : "PM";
                    const sc = "h-8 rounded-lg bg-background/40 text-[14px] font-medium px-2.5 appearance-none text-foreground border border-border/30";
                    return (
                      <div className="flex items-center gap-2 px-4 pb-3 pt-1 pl-[60px]">
                        <select value={curHour12} onChange={(e) => handleTimeChange("hour12", Number(e.target.value))} className={sc}>
                          {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (<option key={h} value={h}>{h}</option>))}
                        </select>
                        <span className="text-muted-foreground text-[14px]">:</span>
                        <select value={reminderSettings.minute} onChange={(e) => handleTimeChange("minute", Number(e.target.value))} className={sc}>
                          {[0, 15, 30, 45].map((m) => (<option key={m} value={m}>{String(m).padStart(2, "0")}</option>))}
                        </select>
                        <select value={curAmpm} onChange={(e) => handleTimeChange("ampm", e.target.value)} className={sc}>
                          <option value="AM">AM</option><option value="PM">PM</option>
                        </select>
                      </div>
                    );
                  })()}
                </>
              );
            })()}
          </Section>

          {/* Help & Legal */}
          <Section header="Help & Legal">
            <Row
              icon={{ name: "bookOutline", color: "brand" }}
              label="Replay Tutorial"
              onClick={onReplayTutorial}
            />
            <Row
              icon={{ name: "shieldCheckmarkOutline", color: "brand" }}
              label="Privacy Policy"
              href="/legal?tab=privacy"
            />
            <Row
              icon={{ name: "documentTextOutline", color: "brand" }}
              label="Terms of Service"
              href="/legal?tab=terms"
            />
            <Row
              icon={{ name: "mailOutline", color: "brand" }}
              label="Support"
              trailing={
                <span className="text-[13px] text-muted-foreground tabular-nums">
                  weightcutwizard@gmail.com
                </span>
              }
              onClick={() => window.open("mailto:weightcutwizard@gmail.com", "_blank")}
            />
          </Section>

          {/* About */}
          <Section header="About">
            <button
              type="button"
              onClick={() => setMedicalOpen((v) => !v)}
              className="w-full flex items-center gap-3 px-4 py-3 min-h-[48px] text-left transition-colors active:bg-white/[0.04]"
              aria-expanded={medicalOpen}
            >
              <IconTile name="medkitOutline" color="brand" />
              <div className="flex-1 min-w-0">
                <p className="text-[15px] text-foreground">Medical Disclaimer</p>
              </div>
              <Icon
                name="chevronForwardOutline"
                size={14}
                className={`text-muted-foreground/45 shrink-0 transition-transform ${medicalOpen ? "rotate-90" : ""}`}
              />
            </button>
            {medicalOpen && (
              <p className="text-[13px] text-muted-foreground leading-snug px-4 pb-3 pt-1 pl-[60px]">
                This app is for informational purposes only. Not a substitute for professional medical advice. Consult a healthcare provider before changing your diet or training.
              </p>
            )}
          </Section>

          {/* Account / Danger */}
          <Section header="Account">
            <Row
              icon={{ name: "trashOutline", color: "red" }}
              label="Delete Account"
              destructive
              onClick={onDeleteAccount}
              trailing={null}
            />
          </Section>

          {/* Save */}
          <div className="mt-5">
            <button
              onClick={onSave}
              className="w-full py-3.5 rounded-2xl bg-primary text-primary-foreground text-[15px] font-semibold active:scale-[0.99] transition-transform"
            >
              Save Changes
            </button>
          </div>

          <p className="text-center text-[11px] text-muted-foreground/40 pt-3">
            Version {__APP_VERSION__}
          </p>
        </div>
      </div>
    </>
  );
}
