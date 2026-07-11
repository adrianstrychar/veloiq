import { SkBlock, SkHeader } from '@/components/veloiq/Skeleton';

// Skeleton czatu: nagłówek → dymki rozmowy (naprzemienne) → pasek wejścia.
export default function ChatLoading() {
  return (
    <div className="flex flex-col gap-4">
      <SkHeader title="Trener AI" />
      <SkBlock h={56} w="75%" r={14} />
      <SkBlock h={72} w="85%" r={14} style={{ marginLeft: 'auto' }} />
      <SkBlock h={56} w="70%" r={14} />
      <SkBlock h={48} r={12} style={{ marginTop: 24 }} />
    </div>
  );
}
