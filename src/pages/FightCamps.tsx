import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/../convex/_generated/api";
import type { Id } from "@/../convex/_generated/dataModel";
import { useAuth } from "@/contexts/UserContext";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Trophy, Trash2, GitCompareArrows, X, CheckSquare, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { DeleteConfirmDialog } from "@/components/DeleteConfirmDialog";
import { SwipeToDelete } from "@/components/ui/SwipeToDelete";
import { ShareCardDialog } from "@/components/share/ShareCardDialog";
import { CampComparisonCard } from "@/components/share/cards/CampComparisonCard";
import { NextCampFlow } from "@/components/fightcamp/NextCampFlow";
import { CampLimitProGate } from "@/components/fightcamp/CampLimitProGate";
import { useSubscription } from "@/hooks/useSubscription";
import { logger } from "@/lib/logger";

interface FightCamp {
  id: string;
  name: string;
  event_name: string | null;
  fight_date: string;
  profile_pic_url: string | null;
  is_completed: boolean;
  starting_weight_kg: number | null;
  end_weight_kg: number | null;
  total_weight_cut: number | null;
  weight_via_dehydration: number | null;
  weight_via_carb_reduction: number | null;
  weigh_in_timing: string | null;
}

export default function FightCamps() {
  const { userId, hasProfile } = useAuth();
  const rawCamps = useQuery(api.fight_camp.listCamps, userId ? {} : "skip");
  const activeCamp = useQuery(api.fight_camp.getActiveCamp, userId ? {} : "skip");
  const createCampMut = useMutation(api.fight_camp.createCamp);
  const deleteCampMut = useMutation(api.fight_camp.deleteCamp);
  const [nextCampOpen, setNextCampOpen] = useState(false);
  // Free-tier gate: creating ANY camp beyond the onboarding one is Pro. We
  // check upfront so free users see the animated upsell instead of bouncing
  // off the server's PRO_FEATURE_REQUIRED error.
  const { checkFeatureAccess, handlePaywallError } = useSubscription();
  const [campGateOpen, setCampGateOpen] = useState(false);
  /** Run `action` if the user may create a camp; otherwise show the Pro gate. */
  const guardCreate = (action: () => void) => {
    if (checkFeatureAccess("MULTIPLE_FIGHT_CAMPS")) action();
    else setCampGateOpen(true);
  };

  // Map Convex camelCase rows → legacy snake_case shape used by share cards.
  const camps = useMemo<FightCamp[]>(() => {
    if (!rawCamps) return [];
    return [...rawCamps]
      .sort((a: any, b: any) => (b.fightDate as string).localeCompare(a.fightDate as string))
      .map((r: any) => ({
        id: r._id,
        name: r.name,
        event_name: r.eventName ?? null,
        fight_date: r.fightDate,
        profile_pic_url: r.profilePicUrl ?? null,
        is_completed: r.isCompleted ?? false,
        starting_weight_kg: r.startingWeightKg ?? null,
        end_weight_kg: r.endWeightKg ?? null,
        total_weight_cut: r.totalWeightCut ?? null,
        weight_via_dehydration: r.weightViaDehydration ?? null,
        weight_via_carb_reduction: r.weightViaCarbReduction ?? null,
        weigh_in_timing: r.weighInTiming ?? null,
      }));
  }, [rawCamps]);

  const loading = rawCamps === undefined;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [campToDelete, setCampToDelete] = useState<FightCamp | null>(null);
  const [newCamp, setNewCamp] = useState({
    name: "",
    event_name: "",
    fight_date: "",
  });
  const [compareMode, setCompareMode] = useState(false);
  const [selectedCamps, setSelectedCamps] = useState<string[]>([]);
  const [compareDialogOpen, setCompareDialogOpen] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedForDelete, setSelectedForDelete] = useState<string[]>([]);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [creating, setCreating] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleCreateCamp = async () => {
    if (creating) return;
    if (!newCamp.name.trim() || !newCamp.fight_date) {
      toast({ title: "Error", description: "Name and fight date are required", variant: "destructive" });
      return;
    }
    if (!userId) return;
    setCreating(true);
    try {
      await createCampMut({
        name: newCamp.name.trim(),
        fightDate: newCamp.fight_date,
        eventName: newCamp.event_name.trim() || undefined,
      });
      setDialogOpen(false);
      setNewCamp({ name: "", event_name: "", fight_date: "" });
    } catch (err) {
      // A free user who slipped past the upfront gate hits the server's
      // PRO_FEATURE_REQUIRED, show the paywall instead of a generic error.
      if (handlePaywallError(err)) {
        setDialogOpen(false);
      } else {
        logger.warn("Create fight camp threw", { error: err });
        toast({ title: "Error", description: "Couldn't create camp. Check your connection.", variant: "destructive" });
      }
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteCamp = async () => {
    if (!campToDelete) return;
    try {
      await deleteCampMut({ id: campToDelete.id as Id<"fight_camps"> });
    } catch {
      toast({ title: "Error", description: "Failed to delete fight camp", variant: "destructive" });
    }
    setDeleteDialogOpen(false);
    setCampToDelete(null);
  };

  const initiateDelete = (camp: FightCamp) => {
    setCampToDelete(camp);
    setDeleteDialogOpen(true);
  };

  const handleBulkDelete = async () => {
    if (!userId || selectedForDelete.length === 0 || bulkDeleting) return;
    setBulkDeleting(true);
    try {
      // Convex has no batch-delete; fan out and swallow individual failures so a
      // partial success still leaves the UI in a sane state.
      await Promise.allSettled(
        selectedForDelete.map((id) => deleteCampMut({ id: id as Id<"fight_camps"> })),
      );
      toast({ title: "Deleted", description: `${selectedForDelete.length} camp${selectedForDelete.length === 1 ? '' : 's'} removed.` });
      setSelectedForDelete([]);
      setSelectMode(false);
    } finally {
      setBulkDeleting(false);
      setBulkDeleteOpen(false);
    }
  };

  // Mirrors the previous post-mount useEffect: silence unused-var lint while
  // we keep the userId-gated render path tidy.
  useEffect(() => { void userId; }, [userId]);

  const toggleSelectMode = () => {
    const next = !selectMode;
    setSelectMode(next);
    setSelectedForDelete([]);
    if (next) {
      setCompareMode(false);
      setSelectedCamps([]);
    }
  };

  const allSelected = camps.length > 0 && selectedForDelete.length === camps.length;
  const toggleSelectAll = () => {
    if (allSelected) setSelectedForDelete([]);
    else setSelectedForDelete(camps.map((c) => c.id));
  };

  // Lifetime stats hero, derived from the camps list. Declared BEFORE any
  // conditional early return so hook ordering stays identical across the
  // loading → loaded transition (Rules of Hooks).
  const stats = useMemo(() => {
    const total = camps.length;
    const completed = camps.filter((c) => c.is_completed).length;
    const lifetimeCut = camps.reduce(
      (sum, c) => sum + (c.is_completed && c.total_weight_cut ? c.total_weight_cut : 0),
      0,
    );
    return {
      total,
      completed,
      lifetimeCut: Math.round(lifetimeCut * 10) / 10,
    };
  }, [camps]);

  if (loading) {
    return (
      <div className="space-y-3 px-5 py-3 sm:p-5 md:p-6 max-w-2xl mx-auto">
        <Skeleton className="h-7 w-32" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="card-surface p-4 space-y-3">
              <div className="flex items-center gap-3.5">
                <Skeleton className="h-11 w-11 rounded-full shrink-0" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
              <Skeleton className="h-12 w-full rounded-xs" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Partition camps into the live "Current camp" and finished "Past camps"
  // so it's obvious what's active vs. history. The active camp (from
  // getActiveCamp) gets the highlighted "Current" treatment; completed camps
  // get a muted card + "Done" badge and stay tappable for looking back.
  const activeCampId =
    (activeCamp as { _id?: string } | null | undefined)?._id ?? null;
  const currentCamps = camps.filter((c) => !c.is_completed);
  const pastCamps = camps.filter((c) => c.is_completed);

  const renderCampCard = (camp: FightCamp) => {
    const completed = camp.is_completed;
    const isActive = !completed && camp.id === activeCampId;
    return (
      // Swipe left to delete (touch-first). Disabled in select/compare modes
      // where a tap already selects, so the gesture can't fight those flows.
      <SwipeToDelete
        key={camp.id}
        enabled={!selectMode && !compareMode}
        onDelete={() => initiateDelete(camp)}
      >
      <div
        className={`group relative card-surface p-4 active:scale-[0.98] transition-all duration-200 overflow-hidden ${
          isActive ? "border border-primary/30 card-glow" : ""
        } ${completed ? "opacity-[0.92]" : ""} ${
          compareMode && selectedCamps.includes(camp.id) ? "ring-2 ring-primary" : ""
        } ${
          selectMode && selectedForDelete.includes(camp.id) ? "ring-2 ring-destructive" : ""
        }`}
      >
        <div onClick={() => {
          if (selectMode) {
            setSelectedForDelete((prev) =>
              prev.includes(camp.id) ? prev.filter((id) => id !== camp.id) : [...prev, camp.id]
            );
            return;
          }
          if (compareMode) {
            setSelectedCamps((prev) => {
              if (prev.includes(camp.id)) return prev.filter((id) => id !== camp.id);
              if (prev.length >= 2) return prev;
              const next = [...prev, camp.id];
              if (next.length === 2) setCompareDialogOpen(true);
              return next;
            });
          } else {
            navigate(`/fight-camps/${camp.id}`);
          }
        }} className="cursor-pointer">
        {selectMode && (
          <div className={`absolute top-3 right-3 h-5 w-5 rounded-full border-2 flex items-center justify-center ${
            selectedForDelete.includes(camp.id)
              ? "bg-destructive border-destructive"
              : "border-muted-foreground/40 bg-background/40"
          }`}>
            {selectedForDelete.includes(camp.id) && <Check className="h-3 w-3 text-destructive-foreground" />}
          </div>
        )}
          <div className="flex items-start gap-3">
            {camp.profile_pic_url ? (
              <img
                src={camp.profile_pic_url}
                alt={camp.name}
                className="w-9 h-9 rounded-full object-cover border border-border shrink-0"
              />
            ) : (
              <div className={`w-9 h-9 rounded-full flex items-center justify-center border border-border shrink-0 ${
                isActive ? "bg-primary/10" : completed ? "bg-func-recovery-green/10" : "bg-muted"
              }`}>
                <Trophy className={`w-4 h-4 ${
                  isActive ? "text-primary" : completed ? "text-func-recovery-green" : "text-muted-foreground"
                }`} />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 min-w-0">
                <h3 className="font-bold text-sm leading-tight truncate">{camp.name}</h3>
                {isActive && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary shrink-0">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    Current
                  </span>
                )}
                {completed && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-func-recovery-green/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-func-recovery-green shrink-0">
                    <Check className="h-3 w-3" strokeWidth={3} />
                    Done
                  </span>
                )}
              </div>
              {camp.event_name && (
                <p className="text-xs text-primary font-medium truncate">{camp.event_name}</p>
              )}
              <p className="text-xs text-muted-foreground mt-0.5">{format(new Date(camp.fight_date), "MMM dd, yyyy")}</p>
            </div>
          </div>

          {/* Metrics Strip */}
          {(camp.starting_weight_kg || camp.total_weight_cut) ? (
            <div className="mt-3 bg-muted/50 rounded-xs p-2.5 flex items-center justify-around border border-border">
              <div className="text-center">
                <p className="text-[13px] uppercase tracking-widest text-muted-foreground mb-0.5">Start</p>
                <p className="text-sm font-bold">{camp.starting_weight_kg ? `${camp.starting_weight_kg}kg` : '-'}</p>
              </div>
              <div className="h-5 w-px bg-border" />
              <div className="text-center">
                <p className="text-[13px] uppercase tracking-widest text-muted-foreground mb-0.5">Cut</p>
                <p className="text-sm font-bold text-primary">{camp.total_weight_cut ? `-${camp.total_weight_cut.toFixed(1)}kg` : '-'}</p>
              </div>
              <div className="h-5 w-px bg-border" />
              <div className="text-center">
                <p className="text-[13px] uppercase tracking-widest text-muted-foreground mb-0.5">End</p>
                <p className="text-sm font-bold">{camp.end_weight_kg ? `${camp.end_weight_kg}kg` : '-'}</p>
              </div>
            </div>
          ) : (
            <p className="mt-2 text-xs text-muted-foreground pl-[3.25rem]">No weight data yet</p>
          )}
        </div>

        {!selectMode && (
          <Button
            variant="ghost"
            size="icon"
            onClick={(e) => {
              e.stopPropagation();
              initiateDelete(camp);
            }}
            aria-label="Delete camp"
            className="absolute top-3 right-3 h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-muted/50 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
      </SwipeToDelete>
    );
  };

  return (
    <div
      className="animate-page-in space-y-4 px-5 py-3 sm:p-5 md:p-6 max-w-2xl mx-auto"
      style={
        selectMode && selectedForDelete.length > 0
          ? { paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 9rem)" }
          : undefined
      }
    >
        {/* Header row, title + chrome icons (select / compare / new) */}
        <div className="flex items-center justify-between">
          <h1 className="text-[28px] font-bold tracking-tight min-w-0 truncate">
            {selectMode ? "Select camps" : compareMode ? "Compare camps" : "Fight camps"}
          </h1>
          <div className="flex items-center gap-1.5 shrink-0">
            {selectMode ? (
              <>
                {camps.length > 0 && (
                  <button
                    onClick={toggleSelectAll}
                    className="h-8 px-3 rounded-full text-[12px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 active:scale-95 transition-all"
                  >
                    {allSelected ? "Clear" : "All"}
                  </button>
                )}
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Exit select mode"
                  onClick={toggleSelectMode}
                  className="rounded-full h-8 w-8"
                >
                  <X className="h-4 w-4" />
                </Button>
              </>
            ) : (
              <>
                {camps.length > 0 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Select camps"
                    onClick={toggleSelectMode}
                    className="rounded-full h-8 w-8"
                  >
                    <CheckSquare className="h-4 w-4" />
                  </Button>
                )}
                {camps.length >= 2 && (
                  <Button
                    size="icon"
                    variant={compareMode ? "default" : "ghost"}
                    aria-label={compareMode ? "Exit compare mode" : "Compare camps"}
                    onClick={() => {
                      setCompareMode(!compareMode);
                      setSelectedCamps([]);
                    }}
                    className="rounded-full h-8 w-8"
                  >
                    {compareMode ? <X className="h-4 w-4" /> : <GitCompareArrows className="h-4 w-4" />}
                  </Button>
                )}
                <button
                  onClick={() => guardCreate(() => setDialogOpen(true))}
                  className="h-8 w-8 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60 active:scale-95 transition-all"
                  aria-label="New fight camp"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </>
            )}
          </div>
        </div>

        {/* Lifetime stats hero, only when we actually have camps to brag
            about. New users see the empty-state card instead, which has its
            own onboarding tone. */}
        {!compareMode && !selectMode && camps.length > 0 && (
          <div className="rounded-xs card-surface overflow-hidden">
            <div className="grid grid-cols-3 divide-x divide-border/40">
              <div className="py-4 px-2 text-center">
                <p className="text-[26px] font-bold tabular-nums tracking-tight">{stats.total}</p>
                <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/70 mt-0.5">
                  {stats.total === 1 ? "Camp" : "Camps"}
                </p>
              </div>
              <div className="py-4 px-2 text-center">
                <p className="text-[26px] font-bold tabular-nums tracking-tight text-primary">
                  {stats.lifetimeCut > 0 ? `${stats.lifetimeCut}` : "-"}
                  {stats.lifetimeCut > 0 && <span className="text-[13px] text-primary/70 font-medium ml-0.5">kg</span>}
                </p>
                <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/70 mt-0.5">
                  Cut total
                </p>
              </div>
              <div className="py-4 px-2 text-center">
                <p className="text-[26px] font-bold tabular-nums tracking-tight">
                  {stats.completed}<span className="text-[18px] text-muted-foreground/60">/{stats.total}</span>
                </p>
                <p className="text-[10px] uppercase tracking-[0.12em] font-semibold text-muted-foreground/70 mt-0.5">
                  Completed
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Primary CTA, only brand-new users (no profile yet) get routed to
            the full 13-step onboarding. Returning users who deleted their
            camps already have a profile, so the slim NextCampFlow is enough
            and avoids re-asking the questions they've already answered. */}
        {!compareMode && !selectMode && (
          <Button
            onClick={() => {
              if (camps.length === 0 && !hasProfile) navigate("/onboarding?startCamp=1");
              else setNextCampOpen(true);
            }}
            className="w-full h-12 rounded-xs gap-2"
          >
            <Plus className="h-4 w-4" strokeWidth={2.6} />
            {camps.length === 0 ? "Start your first camp" : "Start a new fight camp"}
          </Button>
        )}

        {/* Compare mode hint */}
        {compareMode && (
          <p className="text-sm text-muted-foreground">
            Select 2 camps to compare ({selectedCamps.length}/2)
          </p>
        )}

        {/* Select mode hint */}
        {selectMode && (
          <p className="text-sm text-muted-foreground">
            {selectedForDelete.length === 0
              ? "Tap camps to select"
              : `${selectedForDelete.length} selected`}
          </p>
        )}

        {/* Camp List */}
        {camps.length === 0 ? (
          <div className="card-surface p-6 text-center space-y-3">
            <div className="h-10 w-10 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
              <Trophy className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h3 className="text-sm font-bold">No Camps Yet</h3>
              <p className="text-muted-foreground text-xs mt-0.5">Start tracking your first preparation.</p>
            </div>
            {/* Brand-new users go through full onboarding so we capture all
                the fight-specific data (target weight, weigh-in style,
                athlete type). Returning users who deleted their camps but
                still have a profile get the slim NextCampFlow instead so we
                don't re-ask the 13-step onboarding they already completed. */}
            <Button
              onClick={() => {
                if (hasProfile) setNextCampOpen(true);
                else navigate("/onboarding?startCamp=1");
              }}
              variant="outline"
              className="rounded-xs mt-2 border-border hover:bg-muted"
            >
              {hasProfile ? "Start a new fight camp" : "Start camp onboarding"}
            </Button>
          </div>
        ) : (
          <div className="space-y-6">
            {currentCamps.length > 0 && (
              <div className="space-y-3">
                {pastCamps.length > 0 && (
                  <h2 className="px-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                    Current camp
                  </h2>
                )}
                <div className="space-y-3">{currentCamps.map(renderCampCard)}</div>
              </div>
            )}
            {pastCamps.length > 0 && (
              <div className="space-y-3">
                <h2 className="px-0.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground/70">
                  Past camps
                </h2>
                <div className="space-y-3">{pastCamps.map(renderCampCard)}</div>
              </div>
            )}
          </div>
        )}

      <DeleteConfirmDialog
        open={deleteDialogOpen}
        onOpenChange={setDeleteDialogOpen}
        onConfirm={handleDeleteCamp}
        title="Delete Fight Camp"
        itemName={campToDelete?.name}
      />

      <DeleteConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={setBulkDeleteOpen}
        onConfirm={handleBulkDelete}
        title={`Delete ${selectedForDelete.length} Camp${selectedForDelete.length === 1 ? "" : "s"}`}
        itemName={selectedForDelete.length === 1 ? camps.find((c) => c.id === selectedForDelete[0])?.name : `${selectedForDelete.length} fight camps`}
      />

      {/* Floating bulk delete bar */}
      {selectMode && selectedForDelete.length > 0 && (
        <div
          className="fixed left-0 right-0 z-40 px-5 pointer-events-none"
          style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 5rem)" }}
        >
          <div className="mx-auto max-w-2xl pointer-events-auto">
            <Button
              onClick={() => setBulkDeleteOpen(true)}
              disabled={bulkDeleting}
              variant="destructive"
              className="w-full h-11 rounded-xs flex items-center justify-center gap-2"
            >
              <Trash2 className="h-4 w-4" />
              <span>Delete {selectedForDelete.length} camp{selectedForDelete.length === 1 ? "" : "s"}</span>
            </Button>
          </div>
        </div>
      )}

      {/* New Camp Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(open) => { if (!creating) setDialogOpen(open); }}>
        <DialogContent className="w-[calc(100vw-2.5rem)] max-w-[320px] rounded-[28px] p-0 border-0 bg-card/95 backdrop-blur-xl gap-0">
          <div className="px-4 pt-4 pb-3">
            <DialogHeader>
              <DialogTitle className="text-[15px] font-semibold text-center">New Fight Camp</DialogTitle>
            </DialogHeader>
          </div>
          <div className="px-4 space-y-2.5">
            <div className="space-y-1">
              <Label htmlFor="camp-name" className="text-muted-foreground pl-0.5 text-[13px]">Camp Name</Label>
              <Input
                id="camp-name"
                placeholder="e.g. Summer 2025"
                value={newCamp.name}
                onChange={(e) => setNewCamp({ ...newCamp, name: e.target.value })}
                className="h-8 text-[13px] rounded-xs border-border/30 bg-muted/20"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="event-name" className="text-muted-foreground pl-0.5 text-[13px]">Event (Optional)</Label>
              <Input
                id="event-name"
                placeholder="e.g. UFC 300"
                value={newCamp.event_name}
                onChange={(e) => setNewCamp({ ...newCamp, event_name: e.target.value })}
                className="h-8 text-[13px] rounded-xs border-border/30 bg-muted/20"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fight-date" className="text-muted-foreground pl-0.5 text-[13px]">Fight Date</Label>
              <Input
                id="fight-date"
                type="date"
                value={newCamp.fight_date}
                onChange={(e) => setNewCamp({ ...newCamp, fight_date: e.target.value })}
                className="h-8 text-[13px] rounded-xs border-border/30 bg-muted/20 block w-full"
              />
            </div>
          </div>
          <div className="border-t border-border/40 mt-3">
            <button
              onClick={handleCreateCamp}
              disabled={creating}
              className="w-full py-2.5 text-[14px] font-semibold text-primary active:bg-muted/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed disabled:active:bg-transparent"
            >
              {creating ? "Creating…" : "Create Camp"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Camp comparison share dialog */}
      {selectedCamps.length === 2 && (() => {
        const campA = camps.find((c) => c.id === selectedCamps[0]);
        const campB = camps.find((c) => c.id === selectedCamps[1]);
        if (!campA || !campB) return null;
        return (
          <ShareCardDialog
            open={compareDialogOpen}
            onOpenChange={(open) => {
              setCompareDialogOpen(open);
              if (!open) {
                setSelectedCamps([]);
                setCompareMode(false);
              }
            }}
            title="Compare Camps"
            shareTitle="Camp Comparison"
            shareText="Check out my camp comparison on FightCamp Wizard"
          >
            {({ cardRef, aspect }) => (
              <CampComparisonCard ref={cardRef} campA={campA} campB={campB} aspect={aspect} />
            )}
          </ShareCardDialog>
        );
      })()}

      {/* Slim next-camp flow, wraps up the current camp (if any) then runs
          a 5-step wizard so the user can stack a new camp without revisiting
          the full onboarding screens. */}
      <NextCampFlow
        open={nextCampOpen}
        onOpenChange={setNextCampOpen}
        activeCamp={activeCamp ?? null}
      />

      {/* Free-tier "one camp" Pro gate, shown when a free user taps any
          new-camp entry point on this page. */}
      <CampLimitProGate open={campGateOpen} onClose={() => setCampGateOpen(false)} />
    </div>
  );
}
