import { Card, CardTitle } from '@/components/ui/Card';

interface RaceCountdownProps {
  name: string;
  date: string; // ISO date
  formLabel: string; // np. "DOBRA"
  formProgress: number; // 0-100
  formColor: string;
}

export function RaceCountdown({ name, date, formLabel, formProgress, formColor }: RaceCountdownProps) {
  const daysLeft = Math.max(
    0,
    Math.ceil((new Date(date).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
  );

  return (
    <Card>
      <CardTitle>Najbliższy start</CardTitle>
      <p className="text-base font-semibold">
        {name} — za {daysLeft} {daysLeft === 1 ? 'dzień' : 'dni'}
      </p>
      <div className="flex items-center gap-2 mt-2">
        <div className="flex-1 h-2 rounded-full bg-border overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.min(100, Math.max(0, formProgress))}%`, backgroundColor: formColor }}
          />
        </div>
        <span className="text-[11px] font-semibold" style={{ color: formColor }}>
          {formLabel}
        </span>
      </div>
    </Card>
  );
}
