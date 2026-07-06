import { useState, useRef } from "react";
import { format } from "date-fns";
import { useConvex, useMutation } from "convex/react";
import { useToast } from "@/hooks/use-toast";
import { useUser } from "@/contexts/UserContext";
import { useSafeAsync } from "@/hooks/useSafeAsync";
import { weightLogSchema } from "@/lib/validation";
import { localCache } from "@/lib/localCache";
import { triggerHapticSuccess, celebrateSuccess } from "@/lib/haptics";
import { logger } from "@/lib/logger";
import { isNativePlatform } from "@/hooks/useIsNative";
import { resyncReminders } from "@/lib/reminderScheduler";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { WeightLog, Profile } from "@/pages/weight/types";

interface UseWeightDataParams {
  profile: Profile | null;
}

export function useWeightData({ profile }: UseWeightDataParams) {
  const { updateCurrentWeight, userId } = useUser();
  const { toast } = useToast();
  const { safeAsync, isMounted } = useSafeAsync();
  const convex = useConvex();
  const logWeightMut = useMutation(api.weight_logs.logWeight);
  const deleteLogMut = useMutation(api.weight_logs.deleteLog);

  const [weightLogs, setWeightLogs] = useState<WeightLog[]>([]);
  const [newWeight, setNewWeight] = useState("");
  const [newDate, setNewDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [loading, setLoading] = useState(false);
  const [editingLogId, setEditingLogId] = useState<string | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [logToDelete, setLogToDelete] = useState<WeightLog | null>(null);
  const weightInputRef = useRef<HTMLInputElement>(null);
  const submittingRef = useRef(false);

  const fetchData = async () => {
    if (!userId) return;

    const cachedLogs = localCache.get<WeightLog[]>(userId, 'weight_logs');
    if (cachedLogs) {
      safeAsync(setWeightLogs)(cachedLogs);
    }

    try {
      const logsData = await convex.query(api.weight_logs.listForUser, { limit: 365 });

      if (!isMounted()) return;

      if (logsData) {
        const typed = logsData.map((r) => ({
          id: r.id as unknown as string,
          date: r.date,
          weight_kg: r.weight_kg,
        }));
        setWeightLogs(typed);
        localCache.set(userId, 'weight_logs', typed);
      }
    } catch (err) {
      logger.error("Error fetching weight logs", err);
    }
  };

  /**
   * Submit a new or edited weight log.
   *
   * Contract:
   *  - Returns the logged `number` on success.
   *  - Returns `null` when the submission was rejected before any mutation
   *    fired (validation failure, no auth, double-submit guard).
   *  - Returns `null` on backend failure — the optimistic update is rolled
   *    back and a toast is shown. Callers MUST handle the null case rather
   *    than treating any falsy return as "in flight".
   */
  const handleAddWeight = async (e: React.FormEvent): Promise<number | null> => {
    e.preventDefault();

    if (submittingRef.current) return null;

    const validationResult = weightLogSchema.safeParse({
      weight_kg: parseFloat(newWeight),
      date: newDate,
    });

    if (!validationResult.success) {
      toast({
        title: "Validation Error",
        description: validationResult.error.errors[0].message,
        variant: "destructive",
      });
      return null;
    }

    if (!userId) {
      toast({
        title: "Session Expired",
        description: "Please sign in again to log your weight.",
        variant: "destructive",
      });
      return null;
    }

    submittingRef.current = true;
    setLoading(true);

    const loggedWeight = parseFloat(newWeight);

    // Optimistic update — show weight in list immediately.
    // For an edit where the date moved, the server-side upsert key is
    // (userId, date) so the row on `originalDate` is NOT updated server-
    // side. Mirror that on the optimistic side: drop the original-date row
    // and append a fresh optimistic row on `newDate`. A subsequent fetchData
    // reconciles either way.
    const prevLogs = [...weightLogs];
    if (editingLogId) {
      const editingLog = prevLogs.find((l) => l.id === editingLogId);
      const dateChanged = editingLog ? editingLog.date !== newDate : false;
      setWeightLogs((prev) => {
        if (dateChanged) {
          // Remove the row on the original date; add a fresh optimistic row
          // on the new date (the existing row at newDate, if any, will be
          // replaced after fetchData picks up the upserted server state).
          const withoutOriginal = prev.filter((l) => l.id !== editingLogId);
          const withoutDup = withoutOriginal.filter((l) => l.date !== newDate);
          return [
            ...withoutDup,
            { id: `optimistic-${Date.now()}`, date: newDate, weight_kg: loggedWeight },
          ].sort((a, b) => a.date.localeCompare(b.date));
        }
        return prev.map((log) =>
          log.id === editingLogId ? { ...log, weight_kg: loggedWeight, date: newDate } : log,
        );
      });
    } else {
      setWeightLogs(prev => {
        const updated = [...prev, { id: `optimistic-${Date.now()}`, date: newDate, weight_kg: loggedWeight }]
          .sort((a, b) => a.date.localeCompare(b.date));
        return updated;
      });
    }

    try {
      // `logWeight` upserts by (userId, date) — covers both insert and edit
      // paths. If the user changed the date during edit, the server keeps
      // the old row; the optimistic state above already mirrors that.
      await logWeightMut({ date: newDate, weightKg: loggedWeight });

      // Mirror to the profile so the rest of the app sees the latest weight.
      // If THIS fails, the log write already succeeded — don't roll back the
      // optimistic state but DO surface the failure so the user knows their
      // profile current_weight_kg may be stale until next sync.
      try {
        await updateCurrentWeight(loggedWeight);
      } catch (profileErr) {
        logger.warn("Profile current_weight_kg update failed (weight log succeeded)", profileErr);
        toast({
          title: "Saved, but profile didn't update",
          description: "Your weight log was saved. The profile current weight may take a moment to sync.",
          variant: "destructive",
        });
      }

      if (userId) {
        const cachedLogs = localCache.get<any[]>(userId, 'dashboard_weight_logs');
        if (cachedLogs) {
          const existingIdx = cachedLogs.findIndex((l: any) => l.date === newDate);
          let updatedLogs: any[];
          if (existingIdx >= 0) {
            updatedLogs = [...cachedLogs];
            updatedLogs[existingIdx] = { date: newDate, weight_kg: loggedWeight };
          } else {
            updatedLogs = [...cachedLogs, { date: newDate, weight_kg: loggedWeight }]
              .sort((a, b) => a.date.localeCompare(b.date));
          }
          if (updatedLogs.length > 30) updatedLogs = updatedLogs.slice(-30);
          localCache.set(userId, 'dashboard_weight_logs', updatedLogs);
        }
      }

      celebrateSuccess();

      // Reschedule adaptive reminders so today's morning weigh-in reminder is
      // suppressed (when the logged date is today) while tomorrow's stays set.
      // Native-only + self-guarded (opt-in flag + granted permission); never
      // blocks or fails the log.
      if (isNativePlatform) {
        const today = format(new Date(), "yyyy-MM-dd");
        resyncReminders({ weightLoggedToday: newDate === today, openedToday: true }).catch(
          (reminderErr) => logger.warn("Reminder resync after weight log failed", reminderErr),
        );
      }

      setNewWeight("");
      setEditingLogId(null);
      setTimeout(() => fetchData(), 500);
      return loggedWeight;
    } catch (err) {
      // Backend failure on the weight-log write itself — fully revert.
      setWeightLogs(prevLogs);
      toast({
        title: "Error",
        description: `Failed to ${editingLogId ? 'update' : 'log'} weight`,
        variant: "destructive",
      });
      return null;
    } finally {
      setLoading(false);
      submittingRef.current = false;
    }
  };

  const handleDeleteLog = async () => {
    if (!logToDelete) return;

    setLoading(true);
    try {
      await deleteLogMut({ id: logToDelete.id as unknown as Id<"weight_logs"> });
      fetchData();
    } catch (err) {
      toast({
        title: "Error",
        description: "Failed to delete weight log",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
      setDeleteDialogOpen(false);
      setLogToDelete(null);
    }
  };

  const handleEditLog = (log: WeightLog) => {
    setNewWeight(log.weight_kg.toString());
    setNewDate(log.date);
    setEditingLogId(log.id);
    weightInputRef.current?.focus();
    triggerHapticSuccess();
  };

  const initiateDelete = (log: WeightLog) => {
    setLogToDelete(log);
    setDeleteDialogOpen(true);
  };

  const getCurrentWeight = () => {
    if (!weightLogs.length) return profile?.current_weight_kg || 0;
    return weightLogs[weightLogs.length - 1].weight_kg;
  };

  return {
    weightLogs,
    newWeight, setNewWeight,
    newDate, setNewDate,
    loading,
    editingLogId,
    deleteDialogOpen, setDeleteDialogOpen,
    logToDelete,
    weightInputRef,
    fetchData,
    handleAddWeight,
    handleDeleteLog,
    handleEditLog,
    initiateDelete,
    getCurrentWeight,
  };
}
