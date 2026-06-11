import { Card, CardTitle } from '@/components/ui/Card';

interface LastActivityProps {
  date: string; // ISO date
  distanceKm: number;
  avgHr?: number | null;
  avgWatts?: number | null;
  tss: number;
  zone?: string;
}

export function LastActivity({ date, distanceKm, avgHr, avgWatts, tss, zone }: LastActivityProps) {
  const formattedDate = new Date(date).toLocaleDateString('pl-PL', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
  });

  const intensity = avgWatts ? `avg ${avgWatts}W` : avgHr ? `HR avg ${avgHr}` : '—';

  return (
    <Card>
      <CardTitle>Ostatnia aktywność</CardTitle>
      <p className="text-sm">
        {formattedDate} · {distanceKm}km · {intensity}
      </p>
      <p className="text-sm text-secondary mt-1">
        TSS {tss}
        {zone ? ` · ${zone}` : ''}
      </p>
    </Card>
  );
}
