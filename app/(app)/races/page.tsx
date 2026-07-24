import { createServerSupabaseClient } from '@/lib/supabase';
import { Races, type RaceRow } from '@/components/veloiq/Races';
import { type CtlPoint } from '@/lib/race-prep';
import { localTodayISO } from '@/lib/plan';
import { reassembleStrategy, type RaceStrategy, type StrategyRace } from '@/lib/ai/race-strategy';
import { type RouteAnalysis } from '@/lib/route/detect-climbs';

// Po rozdzieleniu zakładek (mockup): /races = Wyścigi (lista startów), /calendar = Kalendarz.
// Segmented control [Lista | Kalendarz] (RacesView) usunięty — każdy widok ma własną trasę.
export default async function RacesPage() {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id')
    .eq('user_id', user?.id ?? '')
    .single();

  const [{ data: races }, { data: metrics }] = await Promise.all([
    supabase
      .from('race_calendar')
      .select('id, date, name, location, series, distance_km, elevation_m, discipline, priority, target_ctl, qualification_goal')
      .eq('athlete_id', athlete?.id ?? '')
      .order('date', { ascending: true }),
    supabase
      .from('fitness_metrics')
      .select('date, ctl')
      .eq('athlete_id', athlete?.id ?? '')
      .order('date', { ascending: true }),
  ]);

  const ctlSeries: CtlPoint[] = (metrics ?? []).map((m) => ({
    date: m.date as string,
    ctl: Number(m.ctl),
  }));

  // Strategia najbliższego startu z cache (race_plans) — SSR, żeby karta od razu miała bloki
  // (bez ponownej generacji). Brak wiersza → null → RaceStrategy pokaże "Generuj strategię".
  const today = localTodayISO();
  const raceList = (races ?? []) as RaceRow[];
  const nextRace = raceList.find((r) => r.date >= today);
  let nextRaceStrategy: RaceStrategy | null = null;
  let nextRaceRoute: { name: string | null; analysis: RouteAnalysis } | null = null;
  if (nextRace) {
    const { data: plan } = await supabase
      .from('race_plans')
      .select('tactical_plan, race_nutrition_plan, tire_recommendations, target_avg_watts, target_if, route_analysis, route_name')
      .eq('athlete_id', athlete?.id ?? '')
      .eq('race_id', nextRace.id)
      .maybeSingle();
    if (plan?.tactical_plan) {
      const sr: StrategyRace = {
        name: nextRace.name, date: nextRace.date, distance_km: nextRace.distance_km,
        elevation_m: nextRace.elevation_m, discipline: nextRace.discipline, location: nextRace.location,
      };
      nextRaceStrategy = reassembleStrategy(plan, sr);
    }
    // Trasa (GPX) może istnieć niezależnie od strategii (wgrana, jeszcze bez przeliczenia).
    if (plan?.route_analysis) {
      nextRaceRoute = { name: (plan.route_name as string | null) ?? null, analysis: plan.route_analysis as RouteAnalysis };
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-md mx-auto">
      <header className="flex items-center justify-between py-2">
        <span className="text-lg font-bold">VeloIQ</span>
        <span className="text-sm text-secondary">Wyścigi</span>
      </header>

      <Races races={raceList} ctlSeries={ctlSeries} today={today} nextRaceStrategy={nextRaceStrategy} nextRaceRoute={nextRaceRoute} />
    </div>
  );
}
