import { SkBlock, SkRow, SkHeader } from '@/components/veloiq/Skeleton';

// Natychmiast po dotknięciu „Jedź” – zanim serwer policzy plan i odprawę.
export default function TreningLoading() {
  return (
    <div className="flex flex-col gap-4">
      <SkHeader title="Trening dziś" />
      <SkBlock h={220} r={14} />
      <SkRow n={2} h={72} />
      <SkBlock h={48} r={12} />
    </div>
  );
}
