import { useEffect, useMemo, useState } from "react";
import { Plus, X, Check } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Input } from "@/components/ui/input";
import { getCustomTypes, addCustomType, removeCustomType } from "@/lib/customSessionTypes";
import { triggerHapticSelection } from "@/lib/haptics";
import {
  MARTIAL_ARTS,
  SANDC,
  REST,
  PRIMARY_CATEGORIES,
  tagsForPrimary,
  type SessionTagDef,
} from "@/lib/sessionTypes";
import { Icon, type IonIconName } from "@/components/ui/Icon";

// The PRIMARY list (martial arts + S&C + Rest); custom martial-art primaries
// are merged in per-user at render time.
const PRIMARY_LIST: readonly string[] = [...MARTIAL_ARTS, SANDC, REST];

const MRU_KEY = (uid: string) => `recent-session-types:${uid}`;

function readMru(userId: string | null): string[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(MRU_KEY(userId));
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === "string").slice(0, 3);
  } catch {
    return [];
  }
}

interface SessionTypePickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string | null;
  /** PRIMARY discipline (martial art / "S&C" / "Rest"). */
  sessionType: string;
  setSessionType: (v: string) => void;
  /** OPTIONAL activity tag. `null` ⇒ none. */
  sessionTag: string | null;
  setSessionTag: (v: string | null) => void;
}

const INPUT_CLASS =
  "h-11 rounded-xs bg-muted/40 dark:bg-white/[0.06] border-border/30 text-[15px] text-foreground placeholder:text-muted-foreground/50 px-4 focus:ring-2 focus:ring-primary/40 focus:border-primary/40 transition-all";

/**
 * Focused bottom-sheet picker for the two-level session model. Collapses the
 * primary-discipline + optional-activity selection out of the log form body
 * (which would otherwise stack two pill grids). Opens from a single summary
 * row; surfaces a "Recent" rail on top so repeat users pick in one tap.
 */
export function SessionTypePickerSheet({
  open,
  onOpenChange,
  userId,
  sessionType,
  setSessionType,
  sessionTag,
  setSessionTag,
}: SessionTypePickerSheetProps) {
  const [customTypes, setCustomTypes] = useState<string[]>([]);
  const [isAddingNew, setIsAddingNew] = useState(false);
  const [newTypeName, setNewTypeName] = useState("");
  const [mru, setMru] = useState<string[]>(() => readMru(userId));

  useEffect(() => {
    if (userId) setCustomTypes(getCustomTypes(userId));
  }, [userId]);

  // Re-read MRU each time the sheet opens so a save since last open surfaces.
  useEffect(() => {
    if (open) setMru(readMru(userId));
  }, [open, userId]);

  const knownPrimaries = useMemo(
    () => new Set<string>([...PRIMARY_LIST, ...customTypes]),
    [customTypes],
  );
  const mruTypes = useMemo(
    () => mru.filter((t) => knownPrimaries.has(t)),
    [mru, knownPrimaries],
  );

  // A stored primary that isn't built-in or a known custom (legacy catch-all)
  // keep it visible as its own pill rather than silently rewriting the row.
  const isLegacySelection = !!sessionType && !knownPrimaries.has(sessionType);

  const tagOptions = useMemo<SessionTagDef[]>(
    () => (sessionType ? tagsForPrimary(sessionType) : []),
    [sessionType],
  );

  const pickPrimary = (picked: string) => {
    setSessionType(picked);
    triggerHapticSelection();
  };

  const handleAddCustomType = () => {
    const trimmed = newTypeName.trim();
    if (!trimmed || !userId) return;
    if (knownPrimaries.has(trimmed)) return;
    const updated = addCustomType(userId, trimmed);
    setCustomTypes(updated);
    setSessionType(trimmed);
    setNewTypeName("");
    setIsAddingNew(false);
  };

  const handleRemoveCustomType = (type: string) => {
    if (!userId) return;
    const updated = removeCustomType(userId, type);
    setCustomTypes(updated);
    if (sessionType === type) {
      const fallbackMru = mruTypes.find((t) => t !== type);
      setSessionType(fallbackMru ?? MARTIAL_ARTS[0]);
    }
  };

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[88vh]">
        <DrawerHeader className="pb-2">
          <DrawerTitle className="text-[17px] font-semibold">Session type</DrawerTitle>
        </DrawerHeader>

        <div className="overflow-y-auto px-4 pb-2 space-y-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* Recent rail */}
          {mruTypes.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/55 px-0.5">
                Recent
              </p>
              <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden snap-x">
                {mruTypes.map((type) => (
                  <SessionTypePill
                    key={`mru-${type}`}
                    type={type}
                    active={sessionType === type}
                    onPick={pickPrimary}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Primary groups: Martial Arts / S&C / Rest */}
          {PRIMARY_CATEGORIES.map((cat) => (
            <div key={cat.label} className="space-y-1.5">
              <p className="text-[9.5px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/55 px-0.5">
                {cat.label}
              </p>
              <div className="flex flex-wrap gap-2">
                {cat.options.map((opt) => (
                  <SessionTypePill
                    key={opt}
                    type={opt}
                    active={sessionType === opt}
                    onPick={pickPrimary}
                  />
                ))}

                {cat.kind === "Martial Arts" && (
                  <>
                    {customTypes.map((type) => (
                      <div key={`custom-${type}`} className="relative">
                        <SessionTypePill
                          type={type}
                          active={sessionType === type}
                          onPick={pickPrimary}
                          extraPadRight
                        />
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); handleRemoveCustomType(type); }}
                          aria-label={`Remove ${type}`}
                          className="absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 rounded-full bg-background/40 flex items-center justify-center text-muted-foreground/60 active:text-destructive transition-colors"
                        >
                          <X className="h-3 w-3" strokeWidth={2.4} />
                        </button>
                      </div>
                    ))}
                    {isLegacySelection && (
                      <SessionTypePill
                        key={`legacy-${sessionType}`}
                        type={sessionType}
                        legacy
                        active
                        onPick={() => { /* already selected */ }}
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => setIsAddingNew(!isAddingNew)}
                      aria-label="Add custom martial art"
                      className="h-10 w-10 rounded-full bg-muted/40 dark:bg-white/[0.06] border border-border/30 flex items-center justify-center active:scale-[0.96] transition-transform"
                    >
                      <Plus className="h-4 w-4 text-foreground/70" strokeWidth={2.4} />
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}

          {isAddingNew && (
            <div className="flex gap-2">
              <Input
                placeholder="e.g. Sambo, Capoeira…"
                value={newTypeName}
                onChange={(e) => setNewTypeName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleAddCustomType(); }}
                className={`${INPUT_CLASS} flex-1`}
                autoFocus
              />
              <button
                type="button"
                onClick={handleAddCustomType}
                disabled={!newTypeName.trim()}
                aria-label="Confirm new type"
                className="h-11 w-11 rounded-xs bg-primary/15 hover:bg-primary/25 text-primary flex items-center justify-center shrink-0 active:scale-[0.96] transition-transform disabled:opacity-40"
              >
                <Check className="h-4 w-4" strokeWidth={2.6} />
              </button>
            </div>
          )}

          {/* Optional activity tag */}
          {tagOptions.length > 0 && (
            <div className="space-y-2 pt-1">
              <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/60">
                Activity <span className="text-muted-foreground/40 normal-case tracking-normal">· optional</span>
              </p>
              <div className="flex flex-wrap gap-2">
                <SessionTagChip
                  label="None"
                  active={!sessionTag}
                  onPick={() => { setSessionTag(null); triggerHapticSelection(); }}
                />
                {tagOptions.map((t) => (
                  <SessionTagChip
                    key={t.id}
                    label={t.id}
                    iconName={t.icon as IonIconName}
                    active={sessionTag === t.id}
                    onPick={() => { setSessionTag(t.id); triggerHapticSelection(); }}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Done: closes the sheet. */}
        <div className="px-4 pt-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <button
            type="button"
            onClick={() => { triggerHapticSelection(); onOpenChange(false); }}
            disabled={!sessionType}
            className="w-full h-12 rounded-xs bg-primary text-primary-foreground text-[15px] font-semibold active:scale-[0.98] transition-transform disabled:opacity-40 disabled:active:scale-100"
          >
            Done
          </button>
        </div>
      </DrawerContent>
    </Drawer>
  );
}

// ── Session-type pill (primary) ────────────────────────────────────────
function SessionTypePill({
  type,
  iconName,
  active,
  onPick,
  legacy = false,
  extraPadRight = false,
}: {
  type: string;
  iconName?: IonIconName;
  active: boolean;
  onPick: (type: string) => void;
  legacy?: boolean;
  extraPadRight?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => onPick(type)}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 h-10 px-3.5 rounded-full text-[13px] font-semibold transition-all active:scale-[0.96] shrink-0 snap-start ${
        active
          ? "bg-primary text-primary-foreground"
          : "bg-muted/40 dark:bg-white/[0.06] border border-border/30 text-foreground/80 hover:bg-muted/60"
      } ${extraPadRight ? "pr-7" : ""}`}
    >
      {iconName && (
        <Icon
          name={iconName}
          size={14}
          className={active ? "text-primary-foreground" : "text-foreground/70"}
        />
      )}
      <span className="leading-none">{type}</span>
      {legacy && (
        <span
          className={`text-[9px] font-semibold uppercase tracking-wider rounded-full px-1.5 py-0.5 ${
            active ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted/60 text-muted-foreground/80"
          }`}
        >
          legacy
        </span>
      )}
    </button>
  );
}

// ── Optional activity-tag chip ─────────────────────────────────────────
function SessionTagChip({
  label,
  iconName,
  active,
  onPick,
}: {
  label: string;
  iconName?: IonIconName;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onPick}
      aria-pressed={active}
      className={`inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[12px] font-semibold transition-all active:scale-[0.96] shrink-0 ${
        active
          ? "bg-primary/15 text-primary border border-primary/40"
          : "bg-muted/30 dark:bg-white/[0.04] border border-border/30 text-muted-foreground hover:bg-muted/50"
      }`}
    >
      {iconName && (
        <Icon
          name={iconName}
          size={12}
          className={active ? "text-primary" : "text-muted-foreground/70"}
        />
      )}
      <span className="leading-none">{label}</span>
    </button>
  );
}
