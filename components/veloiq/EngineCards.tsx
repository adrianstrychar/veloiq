'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { C } from '@/lib/theme';
import type { FtpDisplay } from '@/lib/ftp';

interface EngineCardsProps {
  ftp: FtpDisplay;
  vo2Estimate: number | null; // z silnika VO2 (vo2_estimate); null = brak danych → kafel ukryty
}

function IconBox({ children, bg, border }: { children: string; bg: string; border: string }) {
  return (
    <div style={{
      width: 46, height: 46, borderRadius: 10, flexShrink: 0,
      background: bg, border: `1.5px solid ${border}`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 22,
    }}>
      {children}
    </div>
  );
}

function Tag({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: 9, padding: '2px 6px', borderRadius: 4,
      background: color + '22', color, fontWeight: 600,
      letterSpacing: '0.04em', textTransform: 'uppercase' as const,
    }}>
      {label}
    </span>
  );
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
      padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14,
    }}>
      {children}
    </div>
  );
}

function RightBadge({ badge, sub }: { badge: string; sub: string }) {
  return (
    <div style={{ marginLeft: 'auto', textAlign: 'right' as const, flexShrink: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{badge}</div>
      <div style={{ fontSize: 9, color: C.muted, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

// ── Kafel FTP ─────────────────────────────────────────────────────────────────

function FtpCard({ f }: { f: FtpDisplay }) {
  const valueColor = f.est ? C.yellow : C.cyan;
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);

  // Najprostsza akceptacja estymaty: tap w chip → POST /api/ftp/accept → refresh.
  // Do tego momentu silnik pisze tylko ftp_estimate — ręczne FTP zostaje nietknięte.
  async function acceptEstimate() {
    if (accepting) return;
    setAccepting(true);
    try {
      const res = await fetch('/api/ftp/accept', { method: 'POST' });
      if (!res.ok) throw new Error(`accept failed (${res.status})`);
      router.refresh();
    } catch (e) {
      console.error('ftp accept failed', e);
    } finally {
      setAccepting(false);
    }
  }

  return (
    <CardShell>
      <IconBox bg={C.cyan + '1A'} border={C.cyan + '44'}>⚡</IconBox>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>FTP</span>
          <Tag label={f.tag} color={f.tagColor} />
        </div>

        {f.empty ? (
          <div style={{ fontSize: 12, color: C.muted, lineHeight: 1.4 }}>
            Brak miernika i danych —{' '}
            <span style={{ color: C.cyan, cursor: 'pointer' }}>ustaw ręcznie</span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
            <span style={{ fontSize: 28, fontWeight: 700, color: valueColor, lineHeight: 1 }}>
              {f.est ? '~' : ''}{f.value}
            </span>
            <span style={{ fontSize: 11, color: C.muted }}>
              W{f.wkg ? ` · ${f.wkg} W/kg` : ''}{f.sinceLabel ? ` · ${f.sinceLabel}` : ''}
            </span>
          </div>
        )}

        {f.pendingEstimate != null && (
          <button
            onClick={acceptEstimate}
            disabled={accepting}
            title="Estymata z 28-dniowej krzywej mocy — tap, żeby przyjąć jako FTP"
            style={{
              alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 5,
              background: C.yellow + '1A', color: C.yellow, border: `1px solid ${C.yellow}44`,
              borderRadius: 6, padding: '3px 8px', fontSize: 10.5, fontWeight: 600,
              cursor: accepting ? 'default' : 'pointer', opacity: accepting ? 0.6 : 1,
            }}
          >
            ~{f.pendingEstimate} W szac. · {accepting ? 'zapisuję…' : 'przyjmij'}
          </button>
        )}
      </div>

      <RightBadge badge={f.badge} sub={f.badgeSub} />
    </CardShell>
  );
}

// ── Kafel VO2max ──────────────────────────────────────────────────────────────
// Wartość z silnika (estymata ACSM z 5-min mocy) — oznaczona "szacunek", bo to nie pomiar lab.
// Bez percentyla, bez "M30" (nie mamy wieku/płci), bez "top X%". null → kafel się nie renderuje.
function Vo2Card({ vo2Estimate }: { vo2Estimate: number }) {
  return (
    <CardShell>
      <IconBox bg={C.green + '1A'} border={C.green + '44'}>🫁</IconBox>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Pułap tlenowy
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
          <span style={{ fontSize: 28, fontWeight: 700, color: C.green, lineHeight: 1 }}>{vo2Estimate}</span>
          <span style={{ fontSize: 11, color: C.muted }}>ml/kg/min</span>
        </div>
      </div>

      <RightBadge badge="Szacunek" sub="z mocy 5-min" />
    </CardShell>
  );
}

// ── EngineCards ───────────────────────────────────────────────────────────────

export function EngineCards({ ftp, vo2Estimate }: EngineCardsProps) {
  return (
    <div style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
      gap: 10,
    }}>
      <FtpCard f={ftp} />
      {vo2Estimate != null && <Vo2Card vo2Estimate={vo2Estimate} />}
    </div>
  );
}
