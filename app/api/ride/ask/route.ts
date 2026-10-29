import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createAdminSupabaseClient } from '@/lib/supabase';
import { verifyRideToken } from '@/lib/ride/ride-token';

export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-haiku-4-5-20251001'; // szybko – zawodnik czeka na rowerze

const SYSTEM = `Jesteś Enzo – włoski dyrektor sportowy w radiu wyścigowym, trener zawodnika VeloIQ. Zawodnik JEDZIE TERAZ na rowerze i zadał Ci pytanie głosem przez słuchawki.
ZASADY ODPOWIEDZI:
- Po polsku, mówione (bez list, emoji, markdown, skrótów typu „W/kg” – pisz „watów”, „uderzeń”). Liczby cyframi.
- KRÓTKO: 1–2 zdania, maks. ok. 30 słów. Najpierw konkret, potem ewentualnie krótka motywacja.
- Opieraj się WYŁĄCZNIE na danych z STAN JAZDY i PROFIL. Nie wymyślaj liczb. Czego nie wiesz – powiedz krótko.
- Bezpieczeństwo ponad plan: ból w klatce, zawroty głowy, duszność, ostry ból stawu → każ przerwać trening i odpocząć; przy niepokojących objawach – kontakt z lekarzem.
- Jedzenie/picie: konkretnie (np. ok. 60–90 g węglowodanów na godzinę przy dłuższej jeździe, kilka łyków co 10–15 minut).
- Styl Enzo: ciepły, energiczny, czasem „Forca!” albo „Brawissimo!”, ale bez przesady.
- Jeśli zawodnik WPROST prosi o sterowanie jazdą: „następny krok/pomiń” → action "next", „pauza/zatrzymaj” → "pause", „wznów” → "resume". Inaczej action null.
Zwróć WYŁĄCZNIE JSON: {"say": "…", "action": null}`;

function mmss(sec: unknown) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

export async function POST(req: NextRequest) {
  const userId = verifyRideToken(req.headers.get('authorization')?.replace(/^Bearer\s+/i, ''));
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { question?: unknown; state?: Record<string, unknown> };
  const question = String(body.question ?? '').trim().slice(0, 400);
  if (!question) return NextResponse.json({ error: 'empty' }, { status: 400 });
  const st = body.state ?? {};

  const admin = createAdminSupabaseClient();
  const { data: ath } = await admin.from('athletes').select('name, ftp_watts, hrmax, weight_kg').eq('user_id', userId).maybeSingle();

  const step = st.step as Record<string, unknown> | undefined;
  const lines = [
    `PROFIL: ${ath?.name ?? 'zawodnik'}, FTP ${ath?.ftp_watts ?? st.ftp ?? '?'} W, HRmax ${ath?.hrmax ?? '?'}, waga ${ath?.weight_kg ?? '?'} kg.`,
    `STAN JAZDY: trening „${st.workout ?? '?'}”, jazda trwa ${mmss(st.elapsedSec)}, faza ${st.phase ?? '?'}.`,
    `Moc: teraz (3 s) ${st.power3s ?? '?'} W, ostatnie 30 s ${st.power30s ?? '?'} W, średnio cała jazda ${st.avgPowerRide ?? '?'} W. Tętno ${st.hr ?? 'brak'}.`,
    step ? `Krok: ${step.name} (${step.type}${step.intervalNo ? `, interwał ${step.intervalNo} z ${step.intervalCount}` : ''}), cel ${step.targetLow}–${step.targetHigh} W, średnio w kroku ${step.avgPower} W, minęło ${mmss(step.elapsedSec)}, zostało ${mmss(step.remainingSec)}${step.hrHigh ? `, strefa tętna ${step.hrLow ?? '–'}–${step.hrHigh}` : ''}.` : 'Jazda swobodna (bez planu).',
    st.nextStep ? `Następny krok: ${JSON.stringify(st.nextStep)}.` : '',
    st.planRemainingSec != null ? `Do końca planu: ${mmss(st.planRemainingSec)}.` : '',
    Array.isArray(st.series) && st.series.length ? `Zrobione serie: ${JSON.stringify(st.series)}.` : '',
    st.readiness != null ? `Gotowość dziś: ${st.readiness}% (${st.readyState ?? ''}).` : '',
    `Kadencja ${st.cadence ?? 'brak'}, praca ${st.kJ ?? '?'} kJ (≈ tyle samo kcal)${st.distanceKm != null ? `, dystans ${st.distanceKm} km, prędkość ${st.speedKmh} km/h` : ''}.`,
    st.route ? `Trasa GPX: ${JSON.stringify(st.route)} (metry).` : '',
    st.sinceEatSec != null ? `Ostatnie jedzenie ${mmss(st.sinceEatSec)} temu, picie ${mmss(st.sinceDrinkSec)} temu.` : '',
  ].filter(Boolean).join('\n');

  try {
    const msg = await anthropic.messages.create({
      model: MODEL, max_tokens: 220, system: SYSTEM,
      messages: [{ role: 'user', content: `${lines}\n\nPYTANIE ZAWODNIKA: „${question}”` }],
    });
    const raw = msg.content.map((c) => (c.type === 'text' ? c.text : '')).join('').trim();
    let say = raw, action: string | null = null;
    const m = raw.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        const j = JSON.parse(m[0]) as { say?: string; action?: string | null };
        if (j.say) say = j.say;
        if (j.action === 'next' || j.action === 'pause' || j.action === 'resume') action = j.action;
      } catch { /* zostaje surowy tekst */ }
    }
    return NextResponse.json({ say: say.replace(/[*_#`]/g, '').slice(0, 400), action });
  } catch (e) {
    console.error('[ride/ask]', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'ai_unavailable' }, { status: 502 });
  }
}
