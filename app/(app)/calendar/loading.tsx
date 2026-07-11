import { SkBlock, SkGrid, SkRow, SkHeader } from '@/components/veloiq/Skeleton';

// Skeleton kalendarza: nagłówek → pasek miesiąca → siatka dni (7×5) → lista 14 dni.
export default function CalendarLoading() {
  return (
    <div className="flex flex-col gap-4">
      <SkHeader title="VeloIQ" />
      <SkBlock h={44} r={10} />
      <SkGrid cols={7} n={35} h={60} gap={4} />
      <SkRow n={4} h={58} />
    </div>
  );
}
