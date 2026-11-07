'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { C, F, RADIUS } from '@/lib/theme';
import { CardLabel } from './CardLabel';
import { fmtSleep, whoopLevel, type WhoopState } from '@/lib/whoop-summary';

// Karta WHOOP na pulpicie: poranna regeneracja (HRV, tętno spoczynkowe vs Twoja norma), sen
// (fazy, % potrzeby), obciążenie wczoraj i 14 dni regeneracji. Bez połączenia – przycisk „Połącz WHOOP”.

const LV = { green: C.green, yellow: C.yellow, red: C.red } as const;
const HIDE_KEY = 'veloiq.whoop.cta.hidden';

const FLASH: Record<string, { text: string; ok?: boolean }> = {
  connected: { text: 'WHOOP połączony – pobrałem ostatnie 30 dni.', ok: true },
  denied: { text: 'Połączenie z WHOOP anulowane.' },
  state: { text: 'Sesja połączenia wygasła – spróbuj jeszcze raz.' },
  failed: { text: 'WHOOP nie potwierdził połączenia – spróbuj jeszcze raz.' },
  sync_failed: { text: 'WHOOP połączony, ale pobieranie danych się nie udało – kliknij „Synchronizuj”.' },
  migration: { text: 'Brakuje tabel WHOOP – uruchom migrację 024_whoop.sql w Supabase Studio.' },
  not_configured: { text: 'Brak kluczy WHOOP na serwerze (WHOOP_CLIENT_ID / WHOOP_CLIENT_SECRET w Vercelu).' },
  save_failed: { text: 'Nie udało się zapisać połączenia z WHOOP.' },
  no_athlete: { text: 'Najpierw dokończ konfigurację profilu.' },
};

function ago(iso: string | null): string {
  if (!iso) return 'jeszcze nie';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 2) return 'przed chwilą';
  if (m < 60) return `${m} min temu`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h temu` : `${Math.round(h / 24)} d temu`;
}

const btn = (bg: string, fg: string): React.CSSProperties => ({
  background: bg, color: fg, border: 'none', borderRadius: 10, padding: '9px 14px', fontSize: 13, fontWeight: 600,
  cursor: 'pointer', textDecoration: 'none', display: 'inline-block', fontFamily: 'inherit',
});
const linkBtn: React.CSSProperties = { background: 'none', border: 'none', color: C.muted, fontSize: 11.5, cursor: 'pointer', padding: 0, fontFamily: 'inherit' };

export function WhoopCard({ state, flash, className }: { state: WhoopState | null; flash?: string | null; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState<'sync' | 'off' | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok?: boolean } | null>(flash ? FLASH[flash] ?? null : null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    try { setHidden(localStorage.getItem(HIDE_KEY) === '1'); } catch { /* brak storage */ }
    if (flash) {
      // usuń ?whoop=… z adresu, żeby odświeżenie nie pokazywało komunikatu ponownie
      const u = new URL(window.location.href);
      u.searchParams.delete('whoop');
      window.history.replaceState(null, '', u.toString());
    }
  }, [flash]);

  async function sync() {
    setBusy('sync'); setMsg(null);
    try {
      const r = await fetch('/api/whoop/sync?days=7', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      setMsg(j.ok ? { text: `Zsynchronizowano (${j.days} dni).`, ok: true } : { text: j.message ?? 'Synchronizacja nie powiodła się.' });
      router.refresh();
    } finally { setBusy(null); }
  }
  async function disconnect() {
    if (!window.confirm('Odłączyć WHOOP? Pobrane dni zostaną w historii, nowe przestaną spływać.')) return;
    setBusy('off');
    try { await fetch('/api/whoop/disconnect', { method: 'POST' }); router.refresh(); } finally { setBusy(null); }
  }

  const wrap: React.CSSProperties = {
    background: C.card, border: `1px solid ${C.border}`, borderRadius: RADIUS.card, padding: '1.05rem 1.15rem',
    display: 'flex', flexDirection: 'column', gap: 12,
  };
  const flashEl = msg && <div style={{ fontSize: 12.5, color: msg.ok ? C.green : C.yellow }}>{msg.text}</div>;

  // ── brak połączenia: dyskretne zaproszenie (do ukrycia) ──
  if (!state?.connected) {
    if (hidden && !msg) return null;
    return (
      <div className={className} style={wrap}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <CardLabel>WHOOP</CardLabel>
          <button style={linkBtn} aria-label="Ukryj" onClick={() => { setHidden(true); try { localStorage.setItem(HIDE_KEY, '1'); } catch { /* */ } }}>Ukryj</button>
        </div>
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
          Masz WHOOP? Połącz go, a gotowość na dziś uwzględni poranną regenerację, HRV, tętno spoczynkowe i sen. Enzo powie o tym na rozgrzewce.
        </div>
        {flashEl}
        <div><a href="/api/whoop/auth" style={btn(C.text, C.bg)}>Połącz WHOOP</a></div>
      </div>
    );
  }

  const t = state.today;
  const lv = t?.level ?? null;
  const col = lv ? LV[lv] : C.muted;
  const last14 = state.history.slice(-14);
  const stages = t && t.sleepMin ? [
    { k: 'Głęboki', v: t.deepMin ?? 0, c: C.purple },
    { k: 'REM', v: t.remMin ?? 0, c: C.cyan },
    { k: 'Lekki', v: Math.max(0, t.sleepMin - (t.deepMin ?? 0) - (t.remMin ?? 0)), c: '#3A4250' },
  ] : null;

  const tile = (label: string, value: string, sub: string | null, subColor?: string) => (
    <div style={{ background: C.card2, borderRadius: 10, padding: '8px 9px', minWidth: 0 }}>
      <div style={{ fontSize: 9.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
      <div style={{ fontFamily: F.display, fontSize: 17, fontWeight: 700, color: C.text, whiteSpace: 'nowrap' }}>{value}</div>
      <div style={{ fontSize: 10.5, color: subColor ?? C.muted, minHeight: 14 }}>{sub ?? ' '}</div>
    </div>
  );

  return (
    <div className={className} style={wrap}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <CardLabel>WHOOP · regeneracja</CardLabel>
        <span style={{ fontSize: 10.5, color: C.muted }}>sync {ago(state.lastSyncAt)}</span>
      </div>

      {state.needsReauth && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 13, color: C.yellow }}>Połączenie z WHOOP wygasło – połącz ponownie, żeby dane dalej spływały.</div>
          <div><a href="/api/whoop/auth" style={btn(C.text, C.bg)}>Połącz ponownie WHOOP</a></div>
        </div>
      )}

      {t && t.recovery != null ? (
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <div style={{ textAlign: 'center', minWidth: 84 }}>
            <div style={{ fontFamily: F.display, fontSize: 40, fontWeight: 700, color: col, lineHeight: 1 }}>{t.recovery}<span style={{ fontSize: 18 }}>%</span></div>
            <div style={{ fontSize: 11, color: C.muted, marginTop: 4 }}>{lv === 'green' ? 'gotowy na wysiłek' : lv === 'yellow' ? 'umiarkowanie' : 'odpuść dziś'}</div>
            {t.calibrating && <div style={{ fontSize: 10, color: C.muted }}>WHOOP się kalibruje</div>}
          </div>
          <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
            {tile('HRV', t.hrv != null ? `${t.hrv} ms` : '—',
              t.hrvPct != null ? `${t.hrvPct >= 0 ? '+' : ''}${t.hrvPct}% vs norma` : null,
              t.hrvPct != null ? (t.hrvPct <= -15 ? C.red : t.hrvPct <= -5 ? C.yellow : C.green) : undefined)}
            {tile('Tętno rano', t.rhr != null ? `${t.rhr}` : '—',
              t.rhrDelta != null ? `${t.rhrDelta >= 0 ? '+' : ''}${t.rhrDelta} vs norma` : null,
              t.rhrDelta != null ? (t.rhrDelta >= 5 ? C.red : t.rhrDelta >= 3 ? C.yellow : C.green) : undefined)}
            {tile('Sen', t.sleepMin != null ? fmtSleep(t.sleepMin).replace(' min', '') : '—',
              t.sleepPerf != null ? `${t.sleepPerf}% potrzeby` : null,
              t.sleepPerf != null ? (t.sleepPerf < 70 ? C.red : t.sleepPerf < 85 ? C.yellow : C.green) : undefined)}
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.5 }}>
          Dzisiejsza regeneracja jeszcze nie spłynęła z WHOOP – pojawia się po pobudce, gdy WHOOP przeliczy sen.
        </div>
      )}

      {stages && (
        <div>
          <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', background: C.dim }}>
            {stages.map((s) => <div key={s.k} style={{ width: `${(s.v / Math.max(1, t!.sleepMin!)) * 100}%`, background: s.c }} />)}
          </div>
          <div style={{ display: 'flex', gap: 10, marginTop: 5, fontSize: 10.5, color: C.muted, flexWrap: 'wrap' }}>
            {stages.map((s) => <span key={s.k}><span style={{ color: s.c === '#3A4250' ? C.muted : s.c }}>●</span> {s.k} {fmtSleep(s.v).replace(' min', '')}</span>)}
            {t?.sleepNeedMin ? <span>potrzeba {fmtSleep(t.sleepNeedMin).replace(' min', '')}</span> : null}
          </div>
        </div>
      )}

      {last14.length >= 3 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 44 }} role="img" aria-label="Regeneracja WHOOP z ostatnich 14 dni">
            {last14.map((d) => {
              const v = d.recovery_score;
              const c = v != null ? LV[whoopLevel(v)!] : C.dim;
              return <div key={d.date} title={`${d.date}: ${v ?? '—'}%`} style={{ flex: 1, height: `${Math.max(6, v ?? 6)}%`, background: c, borderRadius: 2, opacity: d.date === t?.date ? 1 : 0.75 }} />;
            })}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: C.muted, marginTop: 3 }}>
            <span>regeneracja · 14 dni</span>
            {t?.strainYesterday != null && <span>strain wczoraj {t.strainYesterday.toFixed(1).replace('.', ',')}</span>}
          </div>
        </div>
      )}

      {flashEl}
      <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
        <button style={{ ...linkBtn, color: C.cyan, fontSize: 12.5 }} disabled={!!busy} onClick={sync}>{busy === 'sync' ? 'Synchronizuję…' : '⟳ Synchronizuj'}</button>
        <button style={linkBtn} disabled={!!busy} onClick={disconnect}>{busy === 'off' ? 'Odłączam…' : 'Odłącz'}</button>
      </div>
    </div>
  );
}
