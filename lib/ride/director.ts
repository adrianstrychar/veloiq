// „Dyrektor Enzo” – lektor z nagranych klipów (offline). Komunikat silnika (klucz + zmienne)
// → lista klipów: emocjonalne wejście + liczby. Ta sama logika jest w iOS (DirectorVoice.swift).

export interface VoicePack { id: string; name: string; clips: Record<string, { file: string; dur: number }> }

const r5 = (v: number) => Math.round(v / 5) * 5;
const num = (v: unknown) => (typeof v === 'number' ? v : parseFloat(String(v ?? '')));

/** "15 minut", "1 minuta 30 sekund", "45 sekund" → [minuty, sekundy]. */
export function parseDur(d: unknown): [number, number] {
  const t = String(d ?? '');
  const m = /(\d+)\s*minut/.exec(t), s = /(\d+)\s*sekund/.exec(t);
  return [m ? +m[1] : 0, s ? +s[1] : 0];
}

const LEAD_FOR: Record<string, string> = {
  armNext: 'arm', autoStart: 'go', intervalStart: 'go', warmupStart: 'warmup', recoveryStart: 'recovery',
  cooldownStart: 'cooldown', steadyStart: 'steady', tenSec: 'ten', goNow: 'goNow', waiting: 'waiting',
  autoPause: 'pause', autoResume: 'resume', manualPause: 'pause', manualResume: 'resume', earlyStop: 'early',
  seriesEnd: 'seriesEnd', hrUp: 'hr', tooHigh: 'tooHigh', tooLow: 'tooLow', recoveryTooHigh: 'recTooHigh',
  cadenceLow: 'cadLow', cadenceHigh: 'cadHigh', half: 'half', lastMinute: 'last', praise: 'praise',
  planDone: 'done', freeStart: 'free', effort: 'effort',
  powerLost: 'powerLost', powerBack: 'powerBack', hrLost: 'hrLost', hrBack: 'hrBack',
};
/** Komunikaty, których dyrektor nie mówi (są tylko na ekranie). */
const SILENT = new Set(['seriesPrev', 'restInfo']);

export class DirectorComposer {
  private last: Record<string, number> = {};
  constructor(private pack: VoicePack, private rnd: () => number = Math.random) {}

  private has(id: string) { return !!this.pack.clips[id]; }
  private lead(ev: string): string | null {
    const ids = Object.keys(this.pack.clips).filter((k) => k.startsWith(`lead.${ev}.`));
    if (!ids.length) return null;
    // losowo, ale nigdy ten sam wariant dwa razy z rzędu
    let i = Math.floor(this.rnd() * ids.length);
    if (ids.length > 1 && ids.indexOf(ids[i]) === this.last[ev]) i = (i + 1) % ids.length;
    this.last[ev] = i;
    return ids[i];
  }
  private dur(d: unknown): string[] {
    const [m, s] = parseDur(d);
    const out: string[] = [];
    if (m && this.has(`min.${m}`)) out.push(`min.${m}`);
    if (s) {
      const opts = [5, 10, 15, 20, 30, 40, 45];
      const near = opts.reduce((a, b) => (Math.abs(b - s) < Math.abs(a - s) ? b : a));
      if (this.has(`sec.${near}`)) out.push(`sec.${near}`);
    }
    return out;
  }
  private range(low: unknown, high: unknown): string[] {
    const l = r5(num(low)), h = r5(num(high));
    return this.has(`from.${l}`) && this.has(`to.${h}`) ? [`from.${l}`, `to.${h}`] : this.has(`w.${h}`) ? [`w.${h}`] : [];
  }
  private watts(v: unknown): string[] { const w = r5(num(v)); return this.has(`w.${w}`) ? [`w.${w}`] : []; }

  /** null = nie mów nic; [] = brak nagrania → użyj głosu systemowego. */
  compose(key: string, vars: Record<string, string | number>): string[] | null {
    if (SILENT.has(key)) return null;
    const ev = LEAD_FOR[key];
    const lead = ev ? this.lead(ev) : null;
    if (!lead) return [];
    const seg = [lead];
    switch (key) {
      case 'armNext': {
        const n = num(vars.n), t = num(vars.total);
        if (this.has(`int.${n}.${t}`)) seg.push(`int.${n}.${t}`);
        seg.push(...this.dur(vars.dur), ...this.range(vars.low, vars.high));
        break;
      }
      case 'autoStart': case 'intervalStart': case 'steadyStart':
        seg.push(...this.dur(vars.dur), ...this.range(vars.low, vars.high)); break;
      case 'warmupStart': case 'recoveryStart': seg.push(...this.dur(vars.dur)); break;
      case 'seriesEnd': {
        seg.push(...this.watts(vars.avg));
        const p = Math.round(num(vars.pct));
        if (this.has(`pct.${p}`)) seg.push(`pct.${p}`);
        break;
      }
      case 'hrUp': { const d = Math.round(num(vars.d)); if (this.has(`hr.${d}`)) seg.splice(0, 1, `hr.${d}`, lead); break; }
      case 'tooHigh': { const d = r5(num(vars.delta)); if (this.has(`sub.${d}`)) seg.push(`sub.${d}`); break; }
      case 'tooLow': { const d = r5(num(vars.delta)); if (this.has(`add.${d}`)) seg.push(`add.${d}`); break; }
      case 'half': seg.push(...this.watts(vars.avg)); break;
      case 'effort': seg.push(...this.dur(vars.dur), ...this.watts(vars.avg)); break;
    }
    return seg;
  }
}

/** Odtwarzanie w przeglądarce (symulacja web) – kolejka klipów z /voice/<id>/. */
export class WebDirectorPlayer {
  private queue: string[] = [];
  private audio?: HTMLAudioElement;
  constructor(private base: string, private pack: VoicePack) {}
  play(ids: string[], interrupt = false) {
    if (interrupt) { this.queue = []; this.audio?.pause(); this.audio = undefined; }
    this.queue.push(...(this.pack.clips['fx.beep'] ? ['fx.beep'] : []), ...ids);
    if (!this.audio) this.next();
  }
  private next() {
    const id = this.queue.shift();
    if (!id) { this.audio = undefined; return; }
    const a = new Audio(`${this.base}/${this.pack.clips[id].file}`);
    this.audio = a;
    a.onended = () => this.next();
    a.onerror = () => this.next();
    a.play().catch(() => this.next());
  }
}
