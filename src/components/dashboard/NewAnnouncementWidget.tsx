import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { Icon, type IonIconName } from "@/components/ui/Icon";
import { useMyGyms } from "@/hooks/coach/useMyGyms";
import { useGymAnnouncements } from "@/hooks/coach/useGymAnnouncements";
import { triggerHaptic } from "@/lib/haptics";
import { ImpactStyle } from "@capacitor/haptics";

interface Props {
  userId: string | null;
}

const DISMISSED_KEY = "wcw_announcement_alerts_dismissed";

function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISSED_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeDismissed(ids: string[]): void {
  try {
    localStorage.setItem(DISMISSED_KEY, JSON.stringify(Array.from(new Set(ids))));
  } catch {
    /* ignore quota errors */
  }
}

/**
 * Real-time alert that surfaces fresh gym announcements + fight offers
 * above the Fight Form ring on the fighter's dashboard.
 *
 * Reactivity: `useGymAnnouncements` is a Convex `useQuery` that
 * re-emits the moment a coach posts an announcement / fight offer, so
 * the widget appears live without a refresh.
 *
 * Dismiss model: the previous version used a "dismissed for the rest
 * of the day" sessionStorage flag, which silently swallowed any new
 * announcement that landed after the user had dismissed today's
 * batch. Switched to a per-id allowlist persisted in localStorage:
 * once the user taps the alert the *currently visible* ids are
 * marked seen, but a fresh fight offer minted ten minutes later
 * pops the alert again immediately.
 */
export default function NewAnnouncementWidget({ userId }: Props) {
  const navigate = useNavigate();
  const { gyms } = useMyGyms(userId);
  const gymIds = useMemo(() => gyms.map((g) => g.gym_id), [gyms]);
  const { announcements } = useGymAnnouncements(userId, gymIds);

  const [dismissedIds, setDismissedIds] = useState<string[]>(() => readDismissed());

  // Re-read dismissed list on focus so cross-tab dismissal stays in sync.
  useEffect(() => {
    const onFocus = () => setDismissedIds(readDismissed());
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const visible = useMemo(
    () => announcements.filter((a) => !dismissedIds.includes(a.id)),
    [announcements, dismissedIds]
  );
  const count = visible.length;
  const latest = visible[0];
  // Promote a fight offer to the headline (and switch icon/copy) even
  // if a plain text announcement happens to be newer, coaches care
  // most about getting fighters to act on offers.
  const headline = useMemo(
    () => visible.find((a) => a.kind === "fight_offer") ?? latest,
    [visible, latest],
  );
  const isFightOffer = headline?.kind === "fight_offer";
  const show = count > 0 && !!headline;

  // Fire a haptic the first time a NEW alert lands. Tracked by the
  // headline's id so the same alert doesn't ping repeatedly across
  // re-renders. Skipped on the very first mount so the user doesn't
  // get a haptic for stale alerts they've never seen.
  const [lastPingedId, setLastPingedId] = useState<string | null>(null);
  useEffect(() => {
    if (!headline) return;
    if (lastPingedId === null) {
      // First mount, just record the id so we don't ping for it.
      setLastPingedId(headline.id);
      return;
    }
    if (headline.id !== lastPingedId) {
      // A new alert landed after the widget was already mounted.
      triggerHaptic(isFightOffer ? ImpactStyle.Heavy : ImpactStyle.Light);
      setLastPingedId(headline.id);
    }
  }, [headline, lastPingedId, isFightOffer]);

  const handleTap = useCallback(() => {
    const ids = visible.map((a) => a.id);
    writeDismissed([...dismissedIds, ...ids]);
    setDismissedIds((prev) => Array.from(new Set([...prev, ...ids])));
    triggerHaptic(ImpactStyle.Light);
    navigate("/my-gym");
  }, [visible, dismissedIds, navigate]);

  // Visual variants, fight offer is louder (primary fill, larger
  // pulse, distinct icon) so it's instantly distinguishable from a
  // plain text announcement.
  const cardClass = isFightOffer
    ? "w-full card-glow rounded-2xl bg-primary/[0.08] p-3 flex items-center gap-3 active:scale-[0.99] transition-all"
    : "w-full card-surface rounded-2xl p-3 flex items-center gap-3 active:scale-[0.99] transition-all";
  const iconBg = isFightOffer ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary";
  const iconName: IonIconName = isFightOffer ? "flashOutline" : "notificationsOutline";
  const headlineCopy = isFightOffer
    ? "New fight offer"
    : count === 1
      ? "New announcement"
      : `${count} new announcements`;

  return (
    <AnimatePresence initial={false}>
      {show && headline && (
        <motion.button
          key={`new-announcement-${headline.id}`}
          type="button"
          onClick={handleTap}
          aria-label={isFightOffer ? "View new fight offer" : "View new announcements"}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ type: "spring", damping: 26, stiffness: 320 }}
          className={cardClass}
        >
          <span className={`relative flex h-9 w-9 rounded-full items-center justify-center flex-shrink-0 ${iconBg}`}>
            {/* Live pulse, louder for fight offers. */}
            <span className={`absolute inset-0 rounded-full animate-ping ${isFightOffer ? "bg-primary/40" : "bg-primary/25"}`} aria-hidden />
            <Icon name={iconName} size={16} className="relative" />
            {count > 1 && (
              <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-primary text-primary-foreground text-[9px] font-bold flex items-center justify-center tabular-nums">
                {count > 9 ? "9+" : count}
              </span>
            )}
          </span>
          <div className="flex-1 min-w-0 text-left">
            <p className={`text-[12px] font-semibold ${isFightOffer ? "text-primary" : ""}`}>
              {headlineCopy}
            </p>
            <p className="text-[11px] text-muted-foreground truncate">
              {headline.sender_name} · {headline.gym_name}
            </p>
          </div>
          <Icon name="chevronForwardOutline" size={12} className="text-muted-foreground/40 flex-shrink-0" />
        </motion.button>
      )}
    </AnimatePresence>
  );
}
