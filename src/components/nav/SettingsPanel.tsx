import { Moon, Sun, ChevronRight, BookOpen, Bell, Trash2, Shield, FileText, LifeBuoy, Heart, Trophy, Zap, RotateCcw, Crown, TrendingDown } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { ProfilePictureUpload } from "@/components/ProfilePictureUpload";
import { Capacitor } from "@capacitor/core";
import { useState } from "react";
import { getSettings, saveSettings, scheduleReminder, cancelReminder, type ReminderSettings } from "@/lib/weightReminder";
import { useSubscription } from "@/hooks/useSubscription";
import { restorePurchases, isPremiumFromCustomerInfo, presentCustomerCenter } from "@/lib/purchases";
import { PremiumBadge } from "@/components/subscription/PremiumBadge";
import { useProfile } from "@/contexts/UserContext";
import { useToast as useToastSub } from "@/hooks/use-toast";

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
      <div className="rounded-xs bg-muted/20 overflow-hidden divide-y divide-border/20">
        <div className="flex items-center justify-between px-3 py-2">
          <div className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-primary shrink-0" />
            <p className="text-[13px] font-medium">Premium</p>
            <PremiumBadge />
          </div>
          <p className="text-[13px] text-muted-foreground">{planLabel} · {expiryLabel}</p>
        </div>
        <button type="button" onClick={() => presentCustomerCenter()}
          className="w-full flex items-center justify-between px-3 py-2 active:bg-muted/40 transition-colors text-left">
          <p className="text-[13px] text-foreground">Manage Subscription</p>
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xs bg-muted/20 overflow-hidden divide-y divide-border/20">
      <button type="button" onClick={openPaywall}
        className="w-full flex items-center justify-between px-3 py-2 active:bg-muted/40 transition-colors text-left">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-primary shrink-0" />
          <div>
            <p className="text-[13px] font-medium">Upgrade to Premium</p>
            <p className="text-[13px] text-muted-foreground">Unlimited AI</p>
          </div>
        </div>
        <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
      </button>
      <button type="button" onClick={handleRestore} disabled={restoringPurchases}
        className="w-full flex items-center justify-between px-3 py-2 active:bg-muted/40 transition-colors text-left disabled:opacity-50">
        <div className="flex items-center gap-2">
          <RotateCcw className="h-4 w-4 text-muted-foreground shrink-0" />
          <p className="text-[13px] font-medium">Restore Purchases</p>
        </div>
      </button>
    </div>
  );
}

/**
 * Single-row "View your plan" entry that mirrors the same affordance on
 * Goals + Dashboard. Detects the plan via `localStorage.wcw_cut_plan` —
 * the same source `/cut-plan` and `/weight-plan` read — and routes to
 * the matching CutPlanReview screen so the user lands on the canonical
 * InlinePlanDisplay timeline. Renders nothing when no plan is present
 * so settings stays tidy for users who skipped the AI generator.
 */
function PlanLinkSection({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const raw = typeof window !== "undefined" ? window.localStorage.getItem("wcw_cut_plan") : null;
  if (!raw) return null;

  let planType: "weight_loss" | "weight_cut" = "weight_cut";
  let summary = "";
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.planType === "weight_loss") planType = "weight_loss";
    if (parsed?.totalWeeks && parsed?.weeklyLossTarget) {
      summary = `${parsed.totalWeeks} weeks · ${parsed.weeklyLossTarget}`;
    }
  } catch {
    // Malformed payload — still surface the row so the user can re-open
    // the plan screen (which will show its own empty state).
  }

  const route = planType === "weight_loss" ? "/weight-plan" : "/cut-plan";
  const label = planType === "weight_loss" ? "View Weight Loss Plan" : "View Cut Plan";

  return (
    <div className="rounded-xs bg-muted/20 overflow-hidden divide-y divide-border/20">
      <button
        type="button"
        onClick={() => {
          onClose();
          // Defer one tick so the sheet close animation can start before
          // the route change — feels less jarring than an instant swap.
          setTimeout(() => navigate(route), 50);
        }}
        className="w-full flex items-center justify-between px-3 py-2 active:bg-muted/40 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <TrendingDown className="h-4 w-4 text-primary shrink-0" />
          <div>
            <p className="text-[13px] font-medium">{label}</p>
            {summary && <p className="text-[13px] text-muted-foreground">{summary}</p>}
          </div>
        </div>
        <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
      </button>
    </div>
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

  return (
    <>
      <div className="fixed inset-0 z-[10001] bg-black/60 animate-in fade-in duration-200" onClick={onClose} />
      <div className="fixed inset-x-0 bottom-0 z-[10002] bg-card/95 backdrop-blur-xl border-0 rounded-t-xl animate-in slide-in-from-bottom duration-300 flex flex-col" style={{ maxHeight: "85dvh" }}>
        {/* Drag handle */}
        <div className="flex justify-center pt-2.5 pb-1 shrink-0">
          <div className="w-9 h-1 rounded-full bg-muted-foreground/20" />
        </div>
        <div className="px-4 pb-1.5 shrink-0">
          <h2 className="text-[15px] font-semibold">Settings</h2>
        </div>

        <div className="px-3 space-y-2 overflow-y-auto overscroll-contain" style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}>
          {/* Profile */}
          <div className="rounded-xs bg-muted/20 p-3">
            <div className="flex items-center gap-3">
              <ProfilePictureUpload
                size="sm"
                showRemove={false}
                currentAvatarUrl={avatarUrl || undefined}
                onUploadSuccess={onAvatarChange}
              />
              <div className="flex-1 min-w-0">
                <Input id="name" value={editedName} onChange={(e) => setEditedName(e.target.value)} placeholder="Your name"
                  className="h-8 text-[13px] rounded-xs border-border/30 bg-muted/20" />
              </div>
            </div>
            {userEmail && <p className="text-[13px] text-muted-foreground mt-1.5 pl-[52px] truncate">{userEmail}</p>}
          </div>

          {/* Subscription */}
          <SubscriptionSection />

          {/* Cut/Weight Plan — only renders when a plan exists locally. */}
          <PlanLinkSection onClose={onClose} />

          {/* Preferences */}
          <div className="rounded-xs bg-muted/20 overflow-hidden divide-y divide-border/20">
            <button type="button" onClick={onToggleTheme}
              className="w-full flex items-center justify-between px-3 py-2 active:bg-muted/40 transition-colors text-left">
              <div className="flex items-center gap-2">
                {theme === "dark" ? <Moon className="h-4 w-4 text-primary shrink-0" /> : <Sun className="h-4 w-4 text-primary shrink-0" />}
                <p className="text-[13px] font-medium">{theme === "dark" ? "Dark Mode" : "Light Mode"}</p>
              </div>
              <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
            </button>

            {onToggleGoalType && (
              <div className="flex items-center justify-between px-3 py-2">
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-primary shrink-0" />
                  <p className="text-[13px] font-medium">Fighter Mode</p>
                </div>
                <Switch checked={goalType === 'cutting'} onCheckedChange={onToggleGoalType} />
              </div>
            )}

            {Capacitor.isNativePlatform() && (() => {
              const h = reminderSettings.hour;
              const displayHour = h === 0 ? 12 : h > 12 ? h - 12 : h;
              const ampm = h < 12 ? "AM" : "PM";
              const displayMinute = String(reminderSettings.minute).padStart(2, "0");

              return (
                <>
                  <div className="flex items-center justify-between px-3 py-2 cursor-pointer"
                    onClick={() => { if (reminderSettings.enabled) setTimePickerOpen(!timePickerOpen); }}>
                    <div className="flex items-center gap-2">
                      <Bell className="h-4 w-4 text-primary shrink-0" />
                      <div>
                        <p className="text-[13px] font-medium">Reminder</p>
                        {reminderSettings.enabled && <p className="text-[13px] text-muted-foreground">{displayHour}:{displayMinute} {ampm}</p>}
                      </div>
                    </div>
                    <Switch checked={reminderSettings.enabled} onCheckedChange={handleToggle} onClick={(e) => e.stopPropagation()} />
                  </div>
                  {timePickerOpen && reminderSettings.enabled && (() => {
                    const curHour24 = reminderSettings.hour;
                    const curHour12 = curHour24 === 0 ? 12 : curHour24 > 12 ? curHour24 - 12 : curHour24;
                    const curAmpm = curHour24 < 12 ? "AM" : "PM";
                    const sc = "h-7 rounded-md bg-muted/30 text-[13px] font-medium px-2 appearance-none text-foreground";
                    return (
                      <div className="flex items-center gap-1.5 px-3 pb-2">
                        <select value={curHour12} onChange={(e) => handleTimeChange("hour12", Number(e.target.value))} className={sc}>
                          {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (<option key={h} value={h}>{h}</option>))}
                        </select>
                        <span className="text-muted-foreground text-[13px]">:</span>
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
          </div>

          {/* Help */}
          <div className="rounded-xs bg-muted/20 overflow-hidden divide-y divide-border/20">
            <button type="button" onClick={onReplayTutorial}
              className="w-full flex items-center justify-between px-3 py-2 active:bg-muted/40 transition-colors text-left">
              <div className="flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-primary shrink-0" />
                <p className="text-[13px] font-medium">Replay Tutorial</p>
              </div>
              <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
            </button>
            <Link to="/legal?tab=privacy" className="flex items-center justify-between px-3 py-2 active:bg-muted/40 transition-colors">
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
                <p className="text-[13px] font-medium">Privacy Policy</p>
              </div>
              <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
            </Link>
            <Link to="/legal?tab=terms" className="flex items-center justify-between px-3 py-2 active:bg-muted/40 transition-colors">
              <div className="flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                <p className="text-[13px] font-medium">Terms of Service</p>
              </div>
              <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
            </Link>
            <button type="button" onClick={() => window.open("mailto:weightcutwizard@gmail.com", "_blank")}
              className="w-full flex items-center justify-between px-3 py-2 active:bg-muted/40 transition-colors text-left">
              <div className="flex items-center gap-2">
                <LifeBuoy className="h-4 w-4 text-muted-foreground shrink-0" />
                <p className="text-[13px] font-medium">Support</p>
              </div>
              <p className="text-[13px] text-muted-foreground shrink-0">weightcutwizard@gmail.com</p>
            </button>
          </div>

          {/* Medical + Danger zone */}
          <div className="rounded-xs bg-muted/20 overflow-hidden divide-y divide-border/20">
            <details className="group">
              <summary className="flex items-center justify-between px-3 py-2 cursor-pointer list-none active:bg-muted/40 transition-colors">
                <div className="flex items-center gap-2">
                  <Heart className="h-4 w-4 text-amber-500 shrink-0" />
                  <p className="text-[13px] font-medium">Medical Disclaimer</p>
                </div>
                <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0 transition-transform group-open:rotate-90" />
              </summary>
              <p className="text-[13px] text-muted-foreground leading-snug px-3 pb-2">
                This app is for informational purposes only. Not a substitute for professional medical advice. Consult a healthcare provider before changing your diet or training.
              </p>
            </details>
            <button type="button" onClick={onDeleteAccount}
              className="w-full flex items-center gap-2 px-3 py-2 active:bg-muted/40 transition-colors text-left">
              <Trash2 className="h-4 w-4 text-destructive shrink-0" />
              <p className="text-[13px] font-medium text-destructive">Delete Account</p>
            </button>
          </div>

          {/* Save */}
          <div className="border-t border-border/30">
            <button onClick={onSave} className="w-full py-2.5 text-[14px] font-semibold text-primary active:bg-muted/50 transition-colors">
              Save Changes
            </button>
          </div>

          <p className="text-center text-[13px] text-muted-foreground/40 pb-1">v{__APP_VERSION__}</p>
        </div>
      </div>
    </>
  );
}
