import { Bell, User } from "lucide-react";
import { BottomNav } from "@/components/BottomNav";
import HeroFightForm from "@/components/dashboardlab/HeroFightForm";
import TodayLogCircles from "@/components/dashboardlab/TodayLogCircles";
import StatTiles from "@/components/dashboardlab/StatTiles";
import CampStatusLine from "@/components/dashboardlab/CampStatusLine";

/* ------------------------------------------------------------------ *
 * THROWAWAY MOCK LAB - /dashboard-lab
 *
 * Dashboard redesign: a bold, iOS-native, low-clutter take inspired by
 * premium fitness apps, kept in the dark blue-wizard theme.
 *
 *   Greeting · Fight Form hero · Quick-log shortcuts · Today tiles · Camp status
 *
 * Bold cut: hero + 2 to 3 essential cards, everything secondary tucked away.
 * Uses real design tokens (bg-card, card-glow, --primary, --energy, etc).
 * The real BottomNav is rendered unmodified for an authentic preview.
 *
 * Delete this file + its route after sign-off.
 * ------------------------------------------------------------------ */

const DashboardLab = () => {
  return (
    <div className="min-h-screen w-full bg-background text-foreground">
      <div
        className="mx-auto w-full max-w-md px-4 pt-3 safe-area-inset-top"
        style={{ paddingBottom: "calc(5.5rem + env(safe-area-inset-bottom, 0px))" }}
      >
        {/* Greeting header (inspired by the reference top row) */}
        <header className="flex items-center justify-between py-2">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-card border border-white/[0.06]">
              <User className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="leading-tight">
              <p className="section-header">GOOD MORNING</p>
              <p className="text-lg font-display font-semibold tracking-tight">Pratik</p>
            </div>
          </div>
          <button
            type="button"
            className="card-press flex h-11 w-11 items-center justify-center rounded-full bg-card border border-white/[0.06]"
            aria-label="Notifications"
          >
            <Bell className="h-5 w-5 text-muted-foreground" />
          </button>
        </header>

        {/* Staggered content */}
        <div className="dashboard-enter-stagger space-y-5 pt-2">
          <HeroFightForm score={82} label="Sharp" deltaToday={3} phase="Camp · 18 days out" />

          <TodayLogCircles />

          <section className="space-y-3">
            <p className="section-header">TODAY</p>
            <StatTiles />
          </section>

          <CampStatusLine status="on_track" message="1.2 kg ahead of pace" daysToFight={18} />
        </div>
      </div>

      {/* Real navigation, unmodified, for an authentic preview */}
      <BottomNav />
    </div>
  );
};

export default DashboardLab;
