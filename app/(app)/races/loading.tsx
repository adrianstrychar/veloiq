import { SkBlock, SkRow, SkHeader } from '@/components/veloiq/Skeleton';

// Skeleton wyścigów: nagłówek → karta NAJBLIŻSZY CEL (duża) → lista startów.
export default function RacesLoading() {
  return (
    <div className="flex flex-col gap-4">
      <SkHeader title="VeloIQ" />
      <SkBlock h={280} r={12} />
      <SkRow n={5} h={96} gap={12} />
    </div>
  );
}
