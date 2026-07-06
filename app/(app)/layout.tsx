import { BottomNav } from '@/components/veloiq/BottomNav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen pb-20">
      <main className="max-w-md mx-auto px-4 py-4">{children}</main>
      <BottomNav />
    </div>
  );
}
