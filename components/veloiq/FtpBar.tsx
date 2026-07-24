import { C, F, RADIUS } from '@/lib/theme';
import type { FtpDisplay } from '@/lib/ftp';

// Pasek FTP (ETAP 3.5 v2) — pierwszy element dashboardu, pełna szerokość (span2). Szybki rzut oka na
// aktualne FTP: wartość · W/kg · tag (zmierzone/szac.) · data ostatniej zmiany · poziom (kategoria W/kg).
// Dane 1:1 z FtpDisplay (to samo źródło co hero w EngineCard) — karta "Twój silnik" (wykres/prognoza/VO2)
// zostaje niezmieniona. Zielony/żółty akcent niesie informację o źródle (zmierzone vs szacunek).

export function FtpBar({ ftp }: { ftp: FtpDisplay }) {
  // Brak FTP → kompaktowa zachęta zamiast pustego paska (pełny prompt jest w EngineCard).
  if (ftp.empty || ftp.value == null) {
    return (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.card, padding: '0.9rem 1.15rem', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted, fontWeight: 700 }}>FTP</span>
        <span style={{ fontSize: 12.5, color: C.muted }}>Ustaw FTP w profilu — zrób test 20 min albo jeźdź z miernikiem.</span>
      </div>
    );
  }

  const color = ftp.est ? C.yellow : C.cyan;
  return (
    <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.card, padding: '0.9rem 1.15rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap' }}>
      {/* lewa: FTP + W/kg + tag źródła */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', minWidth: 0 }}>
        <span style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted, fontWeight: 700, alignSelf: 'center' }}>FTP</span>
        <span style={{ fontFamily: F.display, fontSize: 30, fontWeight: 700, color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
          {ftp.est ? '~' : ''}{ftp.value}<span style={{ fontSize: 14, color: C.muted, fontWeight: 500 }}> W</span>
        </span>
        {ftp.wkg && <span style={{ fontSize: 13, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>· {ftp.wkg} W/kg</span>}
        <span style={{
          fontSize: 9, padding: '2px 7px', borderRadius: 4, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase',
          background: ftp.tagColor + '22', color: ftp.tagColor, alignSelf: 'center',
        }}>{ftp.tag}</span>
      </div>

      {/* prawa: data ostatniej zmiany + poziom (kategoria W/kg) */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        {ftp.sinceLabel && <span style={{ fontSize: 11, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>{ftp.sinceLabel}</span>}
        <span style={{
          fontSize: 10.5, fontWeight: 700, letterSpacing: '0.02em', color,
          background: color + '1A', border: `1px solid ${color}33`, borderRadius: RADIUS.pill, padding: '3px 10px',
        }}>{ftp.badge}</span>
      </div>
    </div>
  );
}
