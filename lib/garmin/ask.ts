// VeloIQ na Garmin Edge – Enzo odpowiada NA EKRANIE licznika (bez głosu).
// Ten sam trener i te same dane co w rozmowie głosowej z telefonu (app/api/ride/ask), ale odpowiedź
// jest czytana jednym spojrzeniem w trakcie jazdy: bardzo krótka, z liczbami, bez ozdobników.
// Prompt celowo osobny od głosowego – tamten jest pisany „do ucha” (liczby słownie, bez skrótów).
import Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { plainText } from './sync';

const MODEL = 'claude-haiku-4-5-20251001'; // szybko – zawodnik czeka na rowerze

const SYSTEM = `Jesteś Enzo – włoski dyrektor sportowy, trener zawodnika VeloIQ. Zawodnik JEDZIE TERAZ na rowerze i zadał pytanie z licznika Garmin. Twoja odpowiedź pojawi się NA EKRANIE licznika.
ZASADY ODPOWIEDZI:
- Po polsku. KRÓTKO: najwyżej 2 zdania, maks. ok. 22 słowa – zawodnik czyta w ruchu. Najpierw konkret (liczba), potem ewentualnie jedno słowo motywacji.
- Zwykły tekst: bez list, emoji, markdown. Skróty W, bpm, min, km są OK.
- Opieraj się WYŁĄCZNIE na danych z STAN JAZDY i PROFIL. Nie wymyślaj liczb ani sytuacji na trasie (nie wiesz, co robią inni kolarze). Czego nie wiesz – powiedz krótko.
- Bezpieczeństwo ponad plan: ból w klatce, zawroty głowy, duszność, ostry ból stawu → każ przerwać trening i odpocząć; przy niepokojących objawach – kontakt z lekarzem.
- Jedzenie/picie: konkretnie (np. 60–90 g węglowodanów na godzinę przy dłuższej jeździe, kilka łyków co 10–15 minut).
- Styl Enzo: ciepły, energiczny, czasem „Forza!” albo „Bravissimo!”, ale bez przesady.
- Jeśli zawodnik WPROST prosi o sterowanie jazdą: „następny krok/pomiń” → action "next", „pauza/zatrzymaj” → "pause", „wznów” → "resume", „falstart/anuluj start interwału” → "cancel". Inaczej action null.
Zwróć WYŁĄCZNIE JSON: {"say": "…", "action": null}`;

const mmss = (sec: unknown) => {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  return `${Math.floor(s / 60)} min ${s % 60} s`;
};

export function stateLines(st: Record<string, unknown>, ath: { name?: string | null; ftp_watts?: number | null; hrmax?: number | null; weight_kg?: number | null } | null): string {
  const step = st.step as Record<string, unknown> | undefined;
  return [
    `PROFIL: ${ath?.name ?? 'zawodnik'}, FTP ${ath?.ftp_watts ?? st.ftp ?? '?'} W, HRmax ${ath?.hrmax ?? '?'}, waga ${ath?.weight_kg ?? '?'} kg.`,
    `STAN JAZDY: trening „${st.workout ?? '?'}”, jazda trwa ${mmss(st.elapsedSec)}, faza ${st.phase ?? '?'}.`,
    `Moc: teraz (3 s) ${st.power3s ?? '?'} W, ostatnie 30 s ${st.power30s ?? '?'} W, średnio cała jazda ${st.avgPowerRide ?? '?'} W, NP ${st.np ?? '?'} W, TSS ${st.tss ?? '?'}. Tętno ${st.hr ?? 'brak'}.`,
    step ? `Krok: ${step.name} (${step.type}${step.intervalNo ? `, interwał ${step.intervalNo} z ${step.intervalCount}` : ''}), cel ${step.targetLow}–${step.targetHigh} W, średnio w kroku ${step.avgPower} W, minęło ${mmss(step.elapsedSec)}, zostało ${mmss(step.remainingSec)}${step.hrHigh ? `, strefa tętna ${step.hrLow ?? '–'}–${step.hrHigh}` : ''}.` : 'Jazda swobodna (bez planu).',
    st.nextStep ? `Następny krok: ${JSON.stringify(st.nextStep)}.` : '',
    st.planRemainingSec != null ? `Do końca planu: ${mmss(st.planRemainingSec)}.` : '',
    Array.isArray(st.series) && st.series.length ? `Zrobione serie: ${JSON.stringify(st.series)}.` : '',
    st.readiness != null ? `Gotowość dziś: ${st.readiness}% (${st.readyState ?? ''})${st.recovery != null ? `, regeneracja WHOOP rano ${st.recovery}%` : ''}.` : '',
    `Kadencja ${st.cadence ?? 'brak'}, praca ${st.kJ ?? '?'} kJ (≈ tyle samo kcal)${st.wbalPct != null ? `, zapas beztlenowy W' ${st.wbalPct}%` : ''}${st.distanceKm != null ? `, dystans ${st.distanceKm} km, prędkość ${st.speedKmh} km/h` : ''}.`,
    st.sinceEatSec != null ? `Ostatnie jedzenie ${mmss(st.sinceEatSec)} temu, picie ${mmss(st.sinceDrinkSec)} temu.` : '',
  ].filter(Boolean).join('\n');
}

export type EnzoAction = 'next' | 'pause' | 'resume' | 'cancel' | null;

export function parseAnswer(raw: string): { say: string; action: EnzoAction } {
  let say = raw.trim(), action: EnzoAction = null;
  const m = say.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]) as { say?: string; action?: string | null };
      if (j.say) say = j.say;
      if (j.action === 'next' || j.action === 'pause' || j.action === 'resume' || j.action === 'cancel') action = j.action;
    } catch { /* zostaje surowy tekst */ }
  }
  // ekran licznika: bez markdownu i znaków, których nie ma w czcionkach urządzenia
  return { say: plainText(say.replace(/[*_#`]/g, '')).slice(0, 260), action };
}

export async function askEnzoForScreen(admin: SupabaseClient, userId: string, question: string, state: Record<string, unknown>) {
  const { data: ath } = await admin.from('athletes').select('name, ftp_watts, hrmax, weight_kg').eq('user_id', userId).maybeSingle();
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const msg = await anthropic.messages.create({
    model: MODEL, max_tokens: 200, system: SYSTEM,
    messages: [{ role: 'user', content: `${stateLines(state, ath)}\n\nPYTANIE ZAWODNIKA: „${question}”` }],
  });
  return parseAnswer(msg.content.map((c) => (c.type === 'text' ? c.text : '')).join(''));
}
