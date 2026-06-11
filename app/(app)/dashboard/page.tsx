import { createServerSupabaseClient } from '@/lib/supabase';
import { interpretTSB } from '@/lib/fitness';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { NextSession } from '@/components/dashboard/NextSession';
import { RaceCountdown } from '@/components/dashboard/RaceCountdown';
import { LastActivity } from '@/components/dashboard/LastActivity';

const DAY_NAMES_PL: Record<number, string> = {
  0: 'sunday',
  1: 'monday',
  2: 'tuesday',
  3: 'wednesday',
  4: 'thursday',
  5: 'friday',
  6: 'saturday',
};

const DAY_LABELS_PL: Record<string, string> = {
  monday: 'Poniedziałek',
  tuesday: 'Wtorek',
  wednesday: 'Środa',
  thursday: 'Czwartek',
  friday: 'Piątek',
  saturday: 'Sobota',
  sunday: 'Niedziela',
};

interface PlanDay {
  day: string;
  date: string;
  type: string;
  title: string;
  duration_minutes: number;
  tss_target: number;
}

export default async function DashboardPage() {
  const supabase = createServerSupabaseClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: athlete } = await supabase
    .from('athletes')
    .select('id, name')
    .eq('user_id', user?.id ?? '')
    .single();

  const athleteId = athlete?.id;

  const [{ data: metrics }, { data: weeklyPlan }, { data: race }, { data: lastActivity }] =
    await Promise.all([
      supabase
        .from('fitness_metrics')
        .select('ctl, atl, tsb')
        .eq('athlete_id', athleteId)
        .order('date', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('weekly_plans')
        .select('plan_json')
        .eq('athlete_id', athleteId)
        .order('week_start', { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('race_calendar')
        .select('name, date')
        .eq('athlete_id', athleteId)
        .eq('priority', 'A')
        .gte('date', new Date().toISOString().slice(0, 10))
        .order('date', { ascending: true })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('strava_activities')
        .select('activity_date, distance_km, avg_hr, avg_watts, tss')
        .eq('athlete_id', athleteId)
        .order('activity_date', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

  const ctl = metrics?.ctl ?? 0;
  const atl = metrics?.atl ?? 0;
  const tsb = metrics?.tsb ?? 0;
  const tsbInfo = interpretTSB(tsb);

  const todayKey = DAY_NAMES_PL[new Date().getDay()];
  const planDays = (weeklyPlan?.plan_json?.days ?? []) as PlanDay[];
  const todaySession = planDays.find((d) => d.day === todayKey && d.type !== 'rest');

  // TSB zwykle mieści się w zakresie -30..+30 — przeskaluj do paska 0-100
  const tsbProgress = ((tsb + 30) / 60) * 100;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between py-2">
        <span className="text-lg font-bold">VeloIQ</span>
        <span className="text-sm text-secondary">
          Cześć, {athlete?.name ?? 'Zawodniku'} 👋
        </span>
      </header>

      <div className="grid grid-cols-3 gap-3">
        <MetricCard title="Forma" value={Math.round(ctl)} label="CTL" color="#4ECDC4" progress={(ctl / 150) * 100} />
        <MetricCard title="Zmęczenie" value={Math.round(atl)} label="ATL" color="#FF8C42" progress={(atl / 150) * 100} />
        <MetricCard title="Świeżość" value={Math.round(tsb)} label="TSB" color={tsbInfo.color} progress={tsbProgress} stateLabel={tsbInfo.label} />
      </div>

      {todaySession && (
        <NextSession
          day={DAY_LABELS_PL[todaySession.day] ?? todaySession.day}
          title={todaySession.title}
          durationMinutes={todaySession.duration_minutes}
          tssTarget={todaySession.tss_target}
        />
      )}

      {race && (
        <RaceCountdown
          name={race.name}
          date={race.date}
          formLabel={tsbInfo.label}
          formProgress={tsbProgress}
          formColor={tsbInfo.color}
        />
      )}

      {lastActivity && (
        <LastActivity
          date={lastActivity.activity_date}
          distanceKm={lastActivity.distance_km}
          avgHr={lastActivity.avg_hr}
          avgWatts={lastActivity.avg_watts}
          tss={lastActivity.tss}
        />
      )}

      <div className="grid grid-cols-2 gap-3">
        <a href="/chat" className="rounded-xl bg-card border border-border text-center text-sm font-semibold py-3">
          💬 Chat z trenerem
        </a>
        <a href="/plan" className="rounded-xl bg-card border border-border text-center text-sm font-semibold py-3">
          📅 Plan tygodnia
        </a>
      </div>
    </div>
  );
}
