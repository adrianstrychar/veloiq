'use client';

import { useState } from 'react';
import { C } from '@/lib/theme';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { RideAnalysis, type RideActivity } from './RideAnalysis';
import { formatDuration } from '@/lib/format';

// Pełny wiersz jazdy potrzebny do analizy + identyfikacja do sync-details
export interface LastActivityRow extends RideActivity {
  strava_activity_id: number;
  details_synced_at: string | null;
}

interface LastActivityCardProps {
  activity: LastActivityRow;
  ftp: number | null;
}

// Kolumny dociągane po sync-details (te same pola co RideActivity)
const ACTIVITY_SELECT =
  'name, activity_date, type, distance_km, elevation_m, duration_seconds, tss, avg_watts, avg_hr, best_efforts, laps, details_synced_at, strava_activity_id';

export function LastActivityCard({ activity, ftp }: LastActivityCardProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState(false);
  const [data, setData] = useState<LastActivityRow>(activity);

  const formattedDate = data.activity_date
    ? new Date(data.activity_date).toLocaleDateString('pl-PL', {
        weekday: 'short', day: '2-digit', month: '2-digit',
      })
    : null;

  const intensity = data.avg_watts
    ? `${data.avg_watts}W avg`
    : data.avg_hr
    ? `HR avg ${data.avg_hr}`
    : null;

  async function handleOpen() {
    if (loading) return;

    // Jeśli brak szczegółów — dociągnij ze Stravy, potem otwórz
    if (!data.details_synced_at) {
      setLoading(true);
      try {
        const res = await fetch(`/api/activities/${data.strava_activity_id}/sync-details`, {
          method: 'POST',
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? `sync failed (${res.status})`);
        }
        // Odczytaj świeży wiersz z bazy (laps + best_efforts)
        const supabase = createBrowserSupabaseClient();
        const { data: fresh } = await supabase
          .from('strava_activities')
          .select(ACTIVITY_SELECT)
          .eq('strava_activity_id', data.strava_activity_id)
          .maybeSingle();
        if (fresh) setData(fresh as unknown as LastActivityRow);
      } catch (e) {
        console.error('sync-details failed', e);
        // mimo błędu otwieramy modal — pokaże fallbacki "brak danych"
      } finally {
        setLoading(false);
      }
    }
    setOpen(true);
  }

  return (
    <>
      <div
        onClick={handleOpen}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        style={{
          background: C.card,
          border: `1px solid ${hover ? C.cyan : C.border}`,
          borderRadius: 8, padding: '10px 12px',
          display: 'flex', flexDirection: 'column', gap: 4,
          cursor: 'pointer', transition: 'border-color 120ms',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Ostatnia aktywność
          </div>
          <div style={{ fontSize: 10, color: C.cyan, fontWeight: 600 }}>
            {loading ? 'Pobieram szczegóły…' : 'Analiza ›'}
          </div>
        </div>
        <div style={{ fontSize: 13, color: C.text }}>
          {data.name ? `${data.name} · ` : ''}{formattedDate}
          {data.distance_km ? ` · ${data.distance_km} km` : ''}
          {intensity ? ` · ${intensity}` : ''}
        </div>
        <div style={{ fontSize: 12, color: C.muted }}>
          TSS {Math.round(data.tss ?? 0)}
          {data.duration_seconds ? ` · ${formatDuration(data.duration_seconds)}` : ''}
        </div>
      </div>

      {open && (
        <RideAnalysis activity={data} activityId={data.strava_activity_id} ftp={ftp} onClose={() => setOpen(false)} />
      )}
    </>
  );
}
