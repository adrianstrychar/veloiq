import { SkBlock, SkGrid, SkHeader } from '@/components/veloiq/Skeleton';

// Skeleton dashboardu: nagłówek → EngineCards (2 kafle) → pierścień gotowości → insight → ostatnia jazda → progress.
export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-4">
      <SkHeader title="VeloIQ" />
      <SkGrid cols={2} n={2} h={92} />
      <SkBlock h={190} r={12} />
      <SkBlock h={72} r={12} />
      <SkBlock h={128} />
      <SkBlock h={220} r={12} />
    </div>
  );
}
