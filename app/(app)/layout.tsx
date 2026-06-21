import Link from 'next/link';

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Home', icon: '🏠' },
  { href: '/plan', label: 'Plan', icon: '📅' },
  { href: '/races', label: 'Starty', icon: '🏁' },
  { href: '/chat', label: 'Chat', icon: '💬' },
  { href: '/history', label: 'Historia', icon: '📊' },
  { href: '/profile', label: 'Profil', icon: '👤' },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen pb-20">
      <main className="max-w-md mx-auto px-4 py-4">{children}</main>

      <nav className="fixed bottom-0 left-0 right-0 border-t border-border bg-card">
        <div className="max-w-md mx-auto grid grid-cols-6">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center gap-1 py-2 text-[11px] text-secondary hover:text-foreground"
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}
