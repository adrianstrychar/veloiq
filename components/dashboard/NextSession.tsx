import { Card, CardTitle } from '@/components/ui/Card';

interface NextSessionProps {
  day: string; // np. "Wtorek"
  title: string; // np. "Threshold 2×20min @270-285W"
  durationMinutes: number;
  tssTarget: number;
}

export function NextSession({ day, title, durationMinutes, tssTarget }: NextSessionProps) {
  const hours = (durationMinutes / 60).toFixed(1).replace('.0', '');

  return (
    <Card>
      <CardTitle>Następna sesja — dziś</CardTitle>
      <p className="text-base font-semibold">{title}</p>
      <p className="text-sm text-secondary mt-1">
        {day} · {hours}h · TSS ~{tssTarget}
      </p>
      <div className="flex gap-2 mt-3">
        <button className="flex-1 rounded-xl bg-accent text-background text-sm font-semibold py-2">
          Zobacz szczegóły
        </button>
        <button className="flex-1 rounded-xl border border-border text-sm font-semibold py-2">
          Pobierz FIT
        </button>
      </div>
    </Card>
  );
}
