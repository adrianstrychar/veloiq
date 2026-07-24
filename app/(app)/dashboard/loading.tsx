import { SkBlock, SkHeader } from '@/components/veloiq/Skeleton';

// Skeleton dashboardu (ETAP 3 order): header → gotowość → AI insight → streak → ostatnia jazda → silnik.
export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-4">
      <SkHeader title="VeloIQ" />
      <SkBlock h={190} r={16} />
      <SkBlock h={72} r={16} />
      <SkBlock h={48} r={16} />
      <SkBlock h={128} r={16} />
      <SkBlock h={280} r={16} />
    </div>
  );
}
