'use client';

import { useEffect, useState } from 'react';
import { C } from '@/lib/theme';
import { createBrowserSupabaseClient } from '@/lib/supabase-browser';
import { RideAnalysis, type RideActivity } from './RideAnalysis';

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
  'name, activity_date, type, distance_km, elevation_m, duration_seconds, tss, avg_watts, avg_hr, best_efforts, laps, details_synced_at, strava_activity_id, avg_cadence, normalized_power, intensity_factor, calories, avg_speed:raw_data->average_speed, max_speed:raw_data->max_speed, kilojoules:raw_data->kilojoules, map_polyline:raw_data->map->summary_polyline';

export function LastActivityCard({ activity, ftp }: LastActivityCardProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState(false);
  const [data, setData] = useState<LastActivityRow>(activity);

  // Po router.refresh() (np. SyncButton) page.tsx przekazuje świeży `activity`.
  // useState liczy wartość początkową tylko przy pierwszym renderze, więc bez tego
  // karta trzymałaby starą jazdę. Reset `data` gdy props się zmieni → React przerysowuje.
  // Bezpieczne dla wzbogacenia: page.tsx selectuje też best_efforts/laps/details_synced_at,
  // a sync-details zapisuje je do DB — więc świeży props zawiera komplet (nic nie ginie).
  useEffect(() => {
    setData(activity);
  }, [activity]);

  // "czw. 18.06.2026" — jak w mockupie
  const formattedDate = data.activity_date
    ? (() => {
        const d = new Date(data.activity_date);
        const wd = d.toLocaleDateString('pl-PL', { weekday: 'short' });
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        return `${wd} ${dd}.${mm}.${d.getFullYear()}`;
      })()
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
          borderRadius: 10, padding: '14px 16px',
          display: 'flex', flexDirection: 'column', gap: 12,
          cursor: 'pointer', transition: 'border-color 120ms',
        }}
      >
        {/* Label sekcji + data */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Ostatnia aktywność
          </div>
          {formattedDate && <div style={{ fontSize: 11, color: C.muted }}>{formattedDate}</div>}
        </div>

        {/* Badge + nazwa + Analiza › */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <SportBadge type={data.type} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: 15, fontWeight: 600, color: C.text,
              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
              {data.name ?? 'Jazda'}
            </div>
          </div>
          <div style={{ fontSize: 12, color: C.cyan, fontWeight: 600, flexShrink: 0 }}>
            {loading ? 'Pobieram…' : 'Analiza ›'}
          </div>
        </div>

        {/* Siatka 4 metryk */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
          <Metric label="Dystans" value={data.distance_km != null ? `${Math.round(data.distance_km)}` : '—'} unit="km" color={C.cyan} />
          <Metric label="Wznosy" value={data.elevation_m != null ? `${data.elevation_m}` : '—'} unit="m" color={C.text} />
          <Metric label="Czas" value={data.duration_seconds != null ? hhmm(data.duration_seconds) : '—'} unit="" color={C.text} />
          <Metric label="Obciążenie" value={data.tss != null ? `${Math.round(data.tss)}` : '—'} unit="TSS" color={C.yellow} />
        </div>
      </div>

      {open && (
        <RideAnalysis activity={data} activityId={data.strava_activity_id} ftp={ftp} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

// Kompaktowy czas h:mm do ciasnej siatki metryk.
function hhmm(seconds: number): string {
  const t = Math.round(seconds);
  const h = Math.floor(t / 3600);
  const m = Math.round((t % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

// Ikona dyscypliny w kolorowym kwadraciku (SportBadge z mockupu).
function SportBadge({ type }: { type: string | null }) {
  const t = (type ?? '').toLowerCase();
  const icon = t.includes('run') ? '🏃' : t.includes('gravel') ? '🚵' : t.includes('virtual') ? '🖥️' : '🚴';
  return (
    <div style={{
      width: 40, height: 40, borderRadius: 10, flexShrink: 0,
      background: C.cyan + '1A', border: `1.5px solid ${C.cyan}44`,
      display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20,
    }}>
      {icon}
    </div>
  );
}

// Pojedyncza metryka: label 8px uppercase + wartość 16px + jednostka.
function Metric({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <div style={{ fontSize: 8, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 700, color, lineHeight: 1 }}>
        {value}{unit && <span style={{ fontSize: 10, color: C.muted, fontWeight: 400 }}> {unit}</span>}
      </div>
    </div>
  );
}
