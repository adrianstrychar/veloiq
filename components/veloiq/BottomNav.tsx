'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { C } from '@/lib/theme';

// Ikony 1:1 z mockupu (docs/veloiq-mockup.jsx → Icon): premium line icons, stroke, inherit color.
type IconName = 'pulse' | 'layers' | 'spark' | 'calendar' | 'flag';

const ICON_PATHS: Record<IconName, React.ReactNode> = {
  pulse: <path d="M3 12h4l2.5-7 4 14 2.5-7h5" />,
  layers: (
    <>
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="m3 13 9 5 9-5" />
    </>
  ),
  spark: <path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z" />,
  calendar: (
    <>
      <rect x="3" y="4.5" width="18" height="17" rx="2.5" />
      <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    </>
  ),
  flag: <path d="M4 21V4M4 4h11l-1.5 4L15 12H4" />,
};

function Icon({ name, size = 22, color = 'currentColor', sw = 1.6 }: { name: IconName; size?: number; color?: string; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round">
      {ICON_PATHS[name]}
    </svg>
  );
}

// Skład i kolejność zakładek 1:1 z mockupem (nav w App): Forma / Plan / Trener AI / Kalendarz / Wyścigi.
const NAV_ITEMS: Array<{ href: string; label: string; icon: IconName }> = [
  { href: '/dashboard', label: 'Forma', icon: 'pulse' },
  { href: '/plan', label: 'Plan', icon: 'layers' },
  { href: '/chat', label: 'Trener AI', icon: 'spark' },
  { href: '/calendar', label: 'Kalendarz', icon: 'calendar' },
  { href: '/races', label: 'Wyścigi', icon: 'flag' },
];

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="fixed bottom-0 left-0 right-0"
      style={{ background: 'rgba(8,14,22,0.92)', backdropFilter: 'blur(12px)', borderTop: `1px solid ${C.border}` }}
    >
      <div className="max-w-md mx-auto flex justify-around" style={{ padding: '10px 0 14px' }}>
        {NAV_ITEMS.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className="flex flex-col items-center relative"
              style={{ gap: 5, padding: '2px 14px' }}
            >
              {/* Aktywna zakładka jak w mockupie: pigułka 24×3 cyan nad ikoną + grubszy stroke + label 700 */}
              {active && <span style={{ position: 'absolute', top: -10, width: 24, height: 3, borderRadius: 2, background: C.cyan }} />}
              <Icon name={item.icon} size={22} color={active ? C.cyan : C.muted} sw={active ? 2 : 1.6} />
              <span style={{ fontSize: 10, fontWeight: active ? 700 : 500, color: active ? C.cyan : C.muted, letterSpacing: '0.01em' }}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
