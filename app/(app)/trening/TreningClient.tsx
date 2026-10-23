'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import { useRideContext } from '@/components/ride/RideProvider';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { RideApp } from '@/components/ride/RideApp';
import { saveRide } from '@/lib/ride/save-ride';
import { isNativeRide } from '@/lib/ride/ride-client';
import type { WorkoutScript } from '@/lib/ride/workout-script';

export function TreningClient({ plan, planLabel, ftp, firstName }: { plan: WorkoutScript | null; planLabel?: string; ftp: number; firstName?: string }) {
  const router = useRouter();
  const ride = useRideContext();
  // imię dla Dyrektora (rzadko, w kluczowych momentach)
  useEffect(() => { if (firstName) ride.setVoice({ name: firstName }); }, [firstName]); // eslint-disable-line react-hooks/exhaustive-deps
  const sb = useMemo(() => createBrowserSupabaseClient(), []);

  return (
    <RideApp
      plan={plan}
      planLabel={planLabel}
      ftp={ftp}
      onSave={async (summary, samples, script, settings, startedAt) => {
        await saveRide(sb, {
          summary, samples, script, startedAt, outdoor: settings.outdoor, ftp,
          source: isNativeRide() ? 'veloiq-ios' : 'veloiq-web-sim',
        });
      }}
      onAskCoach={() => router.push('/chat')}
    />
  );
}
