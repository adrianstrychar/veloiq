import { Card, CardTitle } from '@/components/ui/Card';

interface MetricCardProps {
  title: string;
  value: number;
  label: string;
  color?: string;
  // 0-100, renders a small progress bar; omit for text-only state (e.g. TSB)
  progress?: number;
  stateLabel?: string;
}

export function MetricCard({ title, value, label, color = '#4ECDC4', progress, stateLabel }: MetricCardProps) {
  return (
    <Card>
      <CardTitle>{title}</CardTitle>
      <div className="text-[48px] font-bold leading-none" style={{ color }}>
        {value > 0 ? '+' : ''}
        {value}
      </div>
      <div className="text-[11px] text-secondary mt-1">{label}</div>
      {progress !== undefined ? (
        <div className="mt-2 h-1.5 w-full rounded-full bg-border overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.min(100, Math.max(0, progress))}%`, backgroundColor: color }}
          />
        </div>
      ) : stateLabel ? (
        <div className="mt-2 text-[11px] font-semibold" style={{ color }}>
          {stateLabel}
        </div>
      ) : null}
    </Card>
  );
}
