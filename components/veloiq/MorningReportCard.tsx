'use client';

// Raport poranny (WHOOP) na pulpicie: jak spałeś i jak się zregenerowałeś + co to znaczy dla dzisiejszego
// treningu. Odciążenie zapisuje się samo (przycisk „Przywróć plan”), dokładanie czeka na „Zatwierdź”.
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { C, F, RADIUS } from '@/lib/theme';
import { CardLabel } from './CardLabel';
import type { MorningView } from '@/lib/morning/view';

const LV = { green: C.green, yellow: C.yellow, red: C.red } as const;

const btn = (primary: boolean): React.CSSProperties => ({
  flex: 1, minHeight: 42, borderRadius: 10, fontSize: 13.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
  background: primary ? C.green : 'transparent', color: primary ? C.bg : C.muted,
  border: primary ? 'none' : `1px solid ${C.border}`,
});

const STATUS_TXT: Record<string, { text: string; color: string }> = {
  reverted: { text: 'Przywrócono plan sprzed porannej zmiany.', color: C.muted },
  accepted: { text: 'Zatwierdzone – plan na dziś zaktualizowany.', color: C.green },
  dismissed: { text: 'Plan bez zmian.', color: C.muted },
  stale: { text: 'Plan zmieniony ręcznie po porannym raporcie – zostawiam Twoją wersję.', color: C.muted },
};

export function MorningReportCard({ report, className }: { report: MorningView; className?: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(report.status);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const color = report.level ? LV[report.level] : C.cyan;

  useEffect(() => { setStatus(report.status); }, [report.status]);
  useEffect(() => {
    fetch('/api/morning/seen', { method: 'POST', body: JSON.stringify({ date: report.date }) }).catch(() => undefined);
  }, [report.date]);

  async function act(action: 'revert' | 'accept' | 'dismiss') {
    if (busy) return;
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/morning/${action}`, { method: 'POST', body: JSON.stringify({ date: report.date }) });
      const j = await r.json().catch(() => ({}));
      if (j.ok) {
        setStatus(action === 'revert' ? 'reverted' : action === 'accept' ? 'accepted' : 'dismissed');
        router.refresh();
      } else setMsg({ text: j.error ?? 'Nie udało się.', ok: false });
    } catch {
      setMsg({ text: 'Brak połączenia – spróbuj jeszcze raz.', ok: false });
    } finally { setBusy(false); }
  }

  const showChanges = report.changes.length > 0 && status !== 'dismissed' && status !== 'reverted';

  return (
    <div className={className} style={{
      background: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${color}`, borderRadius: RADIUS.card,
      padding: '1.05rem 1.15rem', display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <CardLabel color={color}>Raport poranny{report.at ? ` · ${report.at}` : ''}</CardLabel>
        <CardLabel>WHOOP</CardLabel>
      </div>
      <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.45 }}>{report.headline}</div>
      <div style={{ fontFamily: F.display, fontSize: 19, fontWeight: 600, color: C.text, lineHeight: 1.25 }}>{report.title}</div>
      <div style={{ fontSize: 13.5, color: C.text, lineHeight: 1.5, opacity: 0.9 }}>{report.reason}</div>

      {showChanges && (
        <div style={{ background: C.card2, borderRadius: RADIUS.inner, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 5 }}>
          {report.changes.map((c) => (
            <div key={c.day} style={{ fontSize: 12.5, lineHeight: 1.4, color: C.text }}>
              <span style={{ fontFamily: F.mono, fontSize: 10.5, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em', marginRight: 6 }}>{c.day}</span>
              <span style={{ color: C.faint, textDecoration: 'line-through' }}>{c.from}</span>
              <span style={{ color: C.muted }}> → </span>
              <span>{c.to}</span>
            </div>
          ))}
        </div>
      )}

      {report.tips.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {report.tips.map((t) => <div key={t} style={{ fontSize: 12.5, color: C.muted, lineHeight: 1.45 }}>{t}</div>)}
        </div>
      )}

      {status === 'applied' && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ fontSize: 12, color: C.muted }}>Plan zaktualizowany automatycznie.</span>
          <button onClick={() => void act('revert')} disabled={busy} style={{ ...btn(false), flex: '0 0 auto', padding: '0 14px', minHeight: 36, opacity: busy ? 0.6 : 1 }}>
            {busy ? 'Przywracam…' : 'Przywróć plan'}
          </button>
        </div>
      )}
      {status === 'proposed' && (
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => void act('accept')} disabled={busy} style={{ ...btn(true), opacity: busy ? 0.6 : 1 }}>{busy ? 'Zapisuję…' : 'Zatwierdź'}</button>
          <button onClick={() => void act('dismiss')} disabled={busy} style={{ ...btn(false), opacity: busy ? 0.6 : 1 }}>Nie, dzięki</button>
        </div>
      )}
      {status && STATUS_TXT[status] && <div style={{ fontSize: 12.5, color: STATUS_TXT[status].color }}>{STATUS_TXT[status].text}</div>}
      {msg && <div style={{ fontSize: 12.5, color: msg.ok ? C.green : C.yellow }}>{msg.text}</div>}
    </div>
  );
}
