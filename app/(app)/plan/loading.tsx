import { SkBlock, SkRow, SkHeader } from '@/components/veloiq/Skeleton';

// Skeleton planu: nagłówek → nawigacja tygodnia → karta suwaka godzin → 7 kart dni.
export default function PlanLoading() {
  return (
    <div className="flex flex-col gap-4">
      <SkHeader title="Plan tygodnia" />
      <SkBlock h={40} r={10} />
      <SkBlock h={120} r={12} />
      <SkRow n={7} h={64} />
    </div>
  );
}
