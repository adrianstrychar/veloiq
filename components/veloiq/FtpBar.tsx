'use client';

import { useState } from 'react';
import { Pencil } from 'lucide-react';
import { C, F, RADIUS } from '@/lib/theme';
import { FtpEditor } from './FtpEditor';
import type { FtpDisplay } from '@/lib/ftp';

// Pasek FTP (ETAP 3.5 v2) — pierwszy element dashboardu, pełna szerokość (span2). Szybki rzut oka na
// aktualne FTP: wartość · W/kg · tag (zmierzone/szac.) · data ostatniej zmiany · poziom (kategoria W/kg).
// Dane 1:1 z FtpDisplay (to samo źródło co hero w EngineCard) — karta "Twój silnik" (wykres/prognoza/VO2)
// zostaje niezmieniona. Zielony/żółty akcent niesie informację o źródle (zmierzone vs szacunek).

export function FtpBar({ ftp }: { ftp: FtpDisplay }) {
  const [editing, setEditing] = useState(false);
  if (editing) return <FtpEditor current={ftp.value} onClose={() => setEditing(false)} />;
  const editBtn = (
    <button onClick={() => setEditing(true)} aria-label="Zmień FTP ręcznie"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'transparent', border: `1px solid ${C.border}`, borderRadius: 6, padding: '3px 8px', color: C.muted, fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
      <Pencil size={11} strokeWidth={2} /> zmień
    </button>
  );
  // Brak FTP → kompaktowa zachęta zamiast pustego paska (pełny prompt jest w EngineCard).
  if (ftp.empty || ftp.value == null) {
    return (
      <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.card, padding: '0.9rem 1.15rem', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: F.mono, fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: C.muted, fontWeight: 700 }}>FTP</span>
        <span style={{ fontSize: 12.5, color: C.muted }}>Wpisz FTP albo zrób test 20 min / jeźdź z miernikiem.</span>
        {editBtn}
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
        {editBtn}
      </div>
    </div>
  );
}
