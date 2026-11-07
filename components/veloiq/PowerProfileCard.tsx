import { C, F, RADIUS } from '@/lib/theme';
import { CardLabel } from './CardLabel';
import type { PowerProfile } from '@/lib/power-profile';

// Profil mocy: krzywa najlepszych mocy (12 mies. vs ostatnie 4 tyg.), typ kolarza, słabsza strona,
// CP i W′. Wykres w SVG (oś czasu logarytmiczna: 5 s … 60 min), bez bibliotek.

const W = 320, H = 130, PX = 8, PY = 10;

export function PowerProfileCard({ profile }: { profile: PowerProfile }) {
  const pts = profile.curve.filter((c) => c.year != null);
  if (pts.length < 3) return null;
  const maxW = Math.max(...profile.curve.map((c) => Math.max(c.year ?? 0, c.recent ?? 0)));
  const minW = Math.min(...profile.curve.filter((c) => c.year != null).map((c) => c.year!)) * 0.85;
  const lx = (sec: number) => PX + ((Math.log(sec) - Math.log(5)) / (Math.log(3600) - Math.log(5))) * (W - 2 * PX);
  const ly = (w: number) => H - PY - ((w - minW) / Math.max(1, maxW - minW)) * (H - 2 * PY);
  const line = (key: 'year' | 'recent') => profile.curve
    .filter((c) => c[key] != null)
    .map((c, i) => `${i ? 'L' : 'M'}${lx(c.sec).toFixed(1)},${ly(c[key]!).toFixed(1)}`).join('');
  const tiles = profile.curve.filter((c) => ['5s', '1min', '5min', '20min'].includes(c.key));

  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.card, padding: '1.05rem 1.15rem', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <CardLabel>Profil mocy</CardLabel>
        <span style={{ fontSize: 10.5, color: C.muted }}>
          <span style={{ color: C.cyan }}>━</span> 12 mies. {profile.hasRecent && <><span style={{ color: C.green, marginLeft: 6 }}>┅</span> 4 tyg.</>}
        </span>
      </div>

      {profile.type && (
        <div>
          <div style={{ fontFamily: F.display, fontSize: 20, fontWeight: 700, color: C.text }}>{profile.type.name}</div>
          <div style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>{profile.type.desc}</div>
        </div>
      )}

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} role="img" aria-label="Krzywa mocy: najlepsze średnie moce od 5 sekund do 60 minut" style={{ display: 'block' }}>
        {profile.curve.map((c) => (
          <g key={c.key}>
            <line x1={lx(c.sec)} x2={lx(c.sec)} y1={PY} y2={H - PY} stroke={C.border} strokeWidth={1} />
            <text x={lx(c.sec)} y={H - 1} fontSize={8} fill={C.muted} textAnchor={c.sec === 5 ? 'start' : c.sec === 3600 ? 'end' : 'middle'}>{c.label}</text>
          </g>
        ))}
        <path d={line('year')} fill="none" stroke={C.cyan} strokeWidth={2.5} strokeLinejoin="round" />
        {profile.hasRecent && <path d={line('recent')} fill="none" stroke={C.green} strokeWidth={2} strokeDasharray="4 3" strokeLinejoin="round" />}
      </svg>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8 }}>
        {tiles.map((c) => (
          <div key={c.key} style={{ background: C.card2, borderRadius: 10, padding: '8px 8px', minWidth: 0 }}>
            <div style={{ fontSize: 9.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{c.label}</div>
            <div style={{ fontFamily: F.display, fontSize: 17, fontWeight: 700, color: C.text }}>{c.year ?? '—'}<span style={{ fontSize: 10, color: C.muted }}> W</span></div>
            <div style={{ fontSize: 10.5, color: C.muted }}>{c.wkg != null ? `${c.wkg.toFixed(1).replace('.', ',')} W/kg` : ' '}</div>
            {c.pctOfYear != null && (
              <div style={{ fontSize: 10.5, color: c.pctOfYear >= 97 ? C.green : c.pctOfYear >= 90 ? C.text : C.yellow }}>teraz {c.pctOfYear}%</div>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, color: C.muted, lineHeight: 1.5 }}>
        {profile.weakness && <span>Do poprawy: <b style={{ color: C.text, fontWeight: 600 }}>{profile.weakness}</b>.</span>}
        {profile.cp != null && profile.wPrime != null && (
          <span>
            Moc krytyczna <b style={{ color: C.text, fontWeight: 600 }}>{profile.cp} W</b> · rezerwa na ataki (W′) <b style={{ color: C.text, fontWeight: 600 }}>{profile.wPrime.toFixed(1).replace('.', ',')} kJ</b>
          </span>
        )}
        {profile.hasRecent && <span style={{ fontSize: 11 }}>„teraz” = najlepsza moc z ostatnich 4 tygodni względem najlepszej z 12 miesięcy.</span>}
      </div>
    </div>
  );
}
