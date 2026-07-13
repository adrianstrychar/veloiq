import { BottomNav } from '@/components/veloiq/BottomNav';
import { ChatProvider } from '@/components/veloiq/ChatStore';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  // ChatProvider owija zakładki → stan czatu przeżywa nawigację (layout nie remontuje się).
  return (
    <ChatProvider>
      <div className="min-h-screen pb-20">
        <main className="max-w-md mx-auto px-4 py-4">{children}</main>
        <BottomNav />
      </div>
    </ChatProvider>
  );
}
