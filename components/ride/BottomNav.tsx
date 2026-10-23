'use client';
// Dolna nawigacja VeloIQ: Forma · Plan · Jedź · Trener · Kalendarz (wyścigi są w Kalendarzu).
// + mini-pasek trwającego treningu nad nawigacją na każdej zakładce poza „Jedź”.

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import s from './ride.module.css';
import { useRideContext } from './RideProvider';
import { mmss, hmmss } from './parts';

export const NAV_ROUTES = { forma: '/dashboard', plan: '/plan', ride: '/trening', coach: '/chat', calendar: '/calendar' } as const;

const Icon = ({ d }: { d: string[] }) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d.map((p) => <path key={p} d={p} />)}
  </svg>
);
const ICONS = {
  forma: ['M3 12h4l3-8 4 16 3-8h4'],
  plan: ['M12 3 2 8l10 5 10-5z', 'M2 13l10 5 10-5'],
  coach: ['M13 2 4 14h7l-1 8 9-12h-7z'],
  calendar: ['M5 5h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z', 'M3 10h18M8 3v4M16 3v4'],
};

export function BottomNav() {
  const path = usePathname() ?? '';
  const ride = useRideContext();
  const live = ride.active ? ride.live : null;
  const on = (href: string) => path === href || path.startsWith(href + '/')
    || (href === NAV_ROUTES.calendar && (path === '/races' || path.startsWith('/races/')));
  const item = (href: string, label: string, icon: string[]) => (
    <Link href={href} className={on(href) ? s.navItemActive : s.navItem} aria-current={on(href) ? 'page' : undefined}>
      <Icon d={icon} />{label}
    </Link>
  );
  const onRide = on(NAV_ROUTES.ride);

  return (
    <>
      {live && !onRide && <RideMiniBar />}
      <nav className={s.nav} aria-label="Główna nawigacja">
        <div className={s.navInner}>
          {item(NAV_ROUTES.forma, 'Forma', ICONS.forma)}
          {item(NAV_ROUTES.plan, 'Plan', ICONS.plan)}
          <Link href={NAV_ROUTES.ride} className={s.navRide} aria-current={onRide ? 'page' : undefined}
            aria-label={live ? 'Jedź – trening w toku' : 'Jedź – rozpocznij trening'}>
            {live
              ? <span className={s.navRideBtnLive}>{mmss(live.elapsed)}</span>
              : <span className={s.navRideBtn}>
                  <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="5.5" cy="17" r="3.5" /><circle cx="18.5" cy="17" r="3.5" /><path d="M5.5 17l4-8h6l3 8M9.5 9L8 6H6M15.5 9l-3 8" />
                  </svg>
                </span>}
            {live ? 'W toku' : 'Jedź'}
          </Link>
          {item(NAV_ROUTES.coach, 'Trener', ICONS.coach)}
          {item(NAV_ROUTES.calendar, 'Kalendarz', ICONS.calendar)}
        </div>
      </nav>
    </>
  );
}

export function RideMiniBar() {
  const ride = useRideContext();
  const live = ride.live;
  if (!live) return null;
  const free = live.phase === 'free';
  const p = live.power3s ?? 0;
  const work = live.stepType === 'interval' || live.stepType === 'steady';
  const state = free ? 'jazda swobodna'
    : live.phase === 'autoPaused' ? 'auto-pauza'
    : live.phase === 'armed' || live.phase === 'waiting' ? 'czekam na start'
    : live.targetHigh && p > live.targetHigh ? 'za mocno'
    : work && p < live.targetLow ? 'za słabo' : work ? 'w zakresie' : 'luźno';
  const color = state === 'w zakresie' || state === 'luźno' ? '#5B9B7E' : state === 'za mocno' ? '#D98A57' : state === 'za słabo' ? '#8C7BC0' : '#C99A4E';
  return (
    <Link href={NAV_ROUTES.ride} className={s.miniBar} aria-label="Trening w toku – wróć do jazdy">
      <span className={s.miniTag}>{free ? 'Swobodna' : live.stepType === 'interval' ? 'Interwał' : live.stepName}</span>
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, minWidth: 0 }}>
        <span className={s.miniMain}>{free ? hmmss(live.elapsed) : mmss(live.stepRemaining)} · {p} W</span>
        <span className={s.miniSub} style={{ color }}>{free ? `${hmmss(live.elapsed)} jazdy` : `cel ${live.targetLow}–${live.targetHigh} · ${state}`}</span>
      </span>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#4A8FC7" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6" /></svg>
    </Link>
  );
}
