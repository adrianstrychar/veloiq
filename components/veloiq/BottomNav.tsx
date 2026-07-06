'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { C } from '@/lib/theme';

// Historia i Profil CELOWO ukryte do czasu zbudowania stron — zakładka prowadząca
// w 404 łamie kontrakt nawigacji mocniej niż jej brak. Wrócą razem ze stronami.
const NAV_ITEMS = [
  { href: '/dashboard', label: 'Home', icon: '🏠' },
  { href: '/plan', label: 'Plan', icon: '📅' },
  { href: '/races', label: 'Starty', icon: '🏁' },
  { href: '/chat', label: 'Chat', icon: '💬' },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 border-t border-border bg-card">
      <div className="max-w-md mx-auto grid grid-cols-4">
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-1 py-2 text-[11px] ${
                active ? 'font-semibold' : 'text-secondary hover:text-foreground'
              }`}
              // Aktywna zakładka cyan — spójnie z akcentem reszty UI (C.cyan, jak "TERAZ"/bordery).
              style={active ? { color: C.cyan } : undefined}
            >
              <span className="text-lg">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
