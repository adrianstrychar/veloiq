'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { C } from '@/lib/theme';
import type { Sex } from '@/lib/onboarding';

interface Prefill {
  name: string | null;
  weight: number | null;
  sex: Sex | null;
  ftp: number | null;
  ftpFromStrava: boolean;
}

const inputStyle: React.CSSProperties = {
  width: '100%', background: C.bg, border: `1px solid ${C.border}`, borderRadius: 8,
  color: C.text, fontSize: 16, padding: '10px 12px', outline: 'none',
};
const labelStyle: React.CSSProperties = { fontSize: 12, color: C.muted, fontWeight: 600, letterSpacing: '0.04em', marginBottom: 6, display: 'block' };

function Toggle<T extends string>({ value, onChange, options }: { value: T | null; onChange: (v: T) => void; options: { v: T; label: string }[] }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {options.map((o) => (
        <button key={o.v} type="button" onClick={() => onChange(o.v)}
          style={{
            flex: 1, padding: '10px 12px', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer',
            background: value === o.v ? C.cyan + '22' : C.bg,
            border: `1px solid ${value === o.v ? C.cyan : C.border}`,
            color: value === o.v ? C.cyan : C.muted,
          }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function OnboardingForm({ prefill }: { prefill: Prefill }) {
  const router = useRouter();
  const [weight, setWeight] = useState<string>(prefill.weight != null ? String(prefill.weight) : '');
  const [sex, setSex] = useState<Sex | null>(prefill.sex);
  const [hasPowerMeter, setHasPowerMeter] = useState<boolean | null>(null); // JEDYNE pytanie, którego Strava nie odpowie
  const [ftp, setFtp] = useState<string>(prefill.ftp != null ? String(prefill.ftp) : '');
  const [ftpLater, setFtpLater] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const canSubmit = hasPowerMeter != null && !saving; // waga/FTP mogą zostać puste (default w tle)

  async function submit() {
    setSaving(true); setErr(null);
    // ftp_source: pusto/"później" → manual (default policzy serwer); wartość z prefillu Strava niezmieniona
    // → strava_profile; wpisana ręcznie → manual.
    const ftpNum = !ftpLater && ftp.trim() ? Math.round(Number(ftp)) : null;
    const ftpSource = ftpNum != null && prefill.ftpFromStrava && ftpNum === prefill.ftp ? 'strava_profile' : 'manual';
    try {
      const res = await fetch('/api/onboarding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          weight: weight.trim() ? Number(weight) : null,
          sex,
          hasPowerMeter,
          ftp: ftpNum,
          ftpSource,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? 'Nie udało się zapisać profilu.');
      }
      router.push('/dashboard');
      router.refresh(); // re-run gate (server layout) → przepuści na dashboard
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Błąd zapisu.');
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '0 auto', padding: '32px 20px', minHeight: '100vh' }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: C.text, marginBottom: 6 }}>
        Cześć{prefill.name ? `, ${prefill.name.split(' ')[0]}` : ''}! 👋
      </div>
      <div style={{ fontSize: 14, color: C.muted, marginBottom: 28, lineHeight: 1.5 }}>
        Skonfigurujmy profil — 20 sekund. Resztę (formę, FTP z historii) policzymy sami z Twojej Stravy.
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
        <div>
          <label style={labelStyle}>WAGA (KG)</label>
          <input style={inputStyle} type="number" inputMode="decimal" placeholder="np. 70"
            value={weight} onChange={(e) => setWeight(e.target.value)} />
        </div>

        <div>
          <label style={labelStyle}>PŁEĆ</label>
          <Toggle value={sex} onChange={setSex} options={[{ v: 'M', label: 'Mężczyzna' }, { v: 'F', label: 'Kobieta' }]} />
        </div>

        <div>
          <label style={labelStyle}>MASZ MIERNIK MOCY?</label>
          <Toggle value={hasPowerMeter == null ? null : (hasPowerMeter ? 'yes' : 'no')}
            onChange={(v) => setHasPowerMeter(v === 'yes')}
            options={[{ v: 'yes', label: 'Tak' }, { v: 'no', label: 'Nie' }]} />
        </div>

        <div>
          <label style={labelStyle}>{hasPowerMeter ? 'TWÓJ FTP (W)' : 'FTP (JEŚLI ZNASZ, W)'}</label>
          <input style={{ ...inputStyle, opacity: ftpLater ? 0.4 : 1 }} type="number" inputMode="numeric"
            placeholder={hasPowerMeter ? 'np. 250' : 'zostaw puste — policzymy z HR/historii'}
            value={ftpLater ? '' : ftp} disabled={ftpLater} onChange={(e) => setFtp(e.target.value)} />
          <button type="button" onClick={() => setFtpLater((v) => !v)}
            style={{ marginTop: 8, background: 'none', border: 'none', color: ftpLater ? C.cyan : C.muted, fontSize: 12, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}>
            {ftpLater ? '↩ jednak wpiszę FTP' : 'Nie znam — ustawię później'}
          </button>
        </div>

        {err && <div style={{ color: C.red, fontSize: 13 }}>{err}</div>}

        <button type="button" onClick={submit} disabled={!canSubmit}
          style={{
            marginTop: 8, padding: '14px', borderRadius: 10, fontSize: 16, fontWeight: 700, cursor: canSubmit ? 'pointer' : 'not-allowed',
            background: canSubmit ? C.cyan : C.border, color: canSubmit ? C.bg : C.muted, border: 'none',
          }}>
          {saving ? 'Zapisuję…' : 'Zaczynamy →'}
        </button>
        {hasPowerMeter == null && (
          <div style={{ fontSize: 12, color: C.muted, textAlign: 'center', marginTop: -8 }}>Zaznacz, czy masz miernik mocy</div>
        )}
      </div>
    </div>
  );
}
