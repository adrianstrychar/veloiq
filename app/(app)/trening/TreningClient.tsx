'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef } from 'react';
import { useRideContext } from '@/components/ride/RideProvider';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { RideApp } from '@/components/ride/RideApp';
import { saveRide } from '@/lib/ride/save-ride';
import { isNativeRide } from '@/lib/ride/ride-client';
import type { RideBriefing, WorkoutScript } from '@/lib/ride/workout-script';

export function TreningClient({ plan, planLabel, ftp, firstName, briefing }: { plan: WorkoutScript | null; planLabel?: string; ftp: number; firstName?: string; briefing?: RideBriefing }) {
  const router = useRouter();
  const ride = useRideContext();
  // imię dla Dyrektora (rzadko, w kluczowych momentach)
  useEffect(() => { if (firstName) ride.setVoice({ name: firstName }); }, [firstName]); // eslint-disable-line react-hooks/exhaustive-deps
  const sb = useMemo(() => createBrowserSupabaseClient(), []);
  const lastRideId = useRef<string | null>(null);

  return (
    <RideApp
      plan={plan}
      planLabel={planLabel}
      ftp={ftp}
      briefing={briefing}
      onSave={async (summary, samples, script, settings, startedAt) => {
        const saved = await saveRide(sb, {
          summary, samples, script, startedAt, outdoor: settings.outdoor, ftp,
          source: isNativeRide() ? 'veloiq-ios' : 'veloiq-web-sim',
        });
        lastRideId.current = saved.id;
        // jazda z telefonu → lista aktywności, kalendarz, plan, silnik FTP (nie blokuje „Zapisano”)
        void fetch('/api/rides/import', { method: 'POST' }).then(() => router.refresh()).catch(() => {});
      }}
      onAskCoach={() => router.push('/chat')}
      onExportStrava={async () => {
        const r = await fetch('/api/rides/strava', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rideId: lastRideId.current }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.message ?? 'Nie udało się wysłać na Stravę.');
        router.refresh();
        return j as { url?: string; pending?: boolean; already?: boolean };
      }}
    />
  );
}
