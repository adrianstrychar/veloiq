// „Dyrektor Enzo” – lektor z nagranych klipów (offline). Komunikat silnika (klucz + zmienne)
// → lista klipów: emocjonalne wejście + liczby. Ta sama logika jest w iOS (DirectorVoice.swift).

export interface VoicePack { id: string; name: string; clips: Record<string, { file: string; dur: number; it?: boolean }> }

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
  hrHigh: 'hrHigh', hrRecovered: 'hrRec', status: 'status',
  listen: 'listen', repeat: 'repeat', think: 'think', offline: 'offline', doneCmd: 'doneCmd', left: 'left', power: 'power',
};
/** Komunikaty, których dyrektor nie mówi (są tylko na ekranie). */
const SILENT = new Set(['seriesPrev', 'restInfo']);

export class DirectorComposer {
  private last: Record<string, number> = {};
  private lastIt = -1e9;      // ostatnie włoskie wtrącenie (ms) – nie częściej niż co 3 min
  private lastName = -1e9;    // ostatnie imię – nie częściej niż co 8 min
  private nameIds: string[] = [];
  constructor(private pack: VoicePack, private rnd: () => number = Math.random, private now: () => number = () => Date.now()) {}

  /** Imię zawodnika (bez polskich znaków, małe litery) – jeśli paczka ma jego nagrania. */
  setName(name?: string) {
    const slug = (name ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ł/g, 'l').toLowerCase().split(/\s+/)[0] ?? '';
    this.nameIds = slug ? Object.keys(this.pack.clips).filter((k) => k.startsWith(`name.${slug}.`)) : [];
  }

  private has(id: string) { return !!this.pack.clips[id]; }
  private lead(ev: string): string | null {
    let ids = Object.keys(this.pack.clips).filter((k) => k.startsWith(`lead.${ev}.`));
    if (!ids.length) return null;
    // włoskie „Forza / Bravissimo / Dai” to przyprawa – świeżo użyte → wybierz polski wariant
    const plain = ids.filter((k) => !this.pack.clips[k].it);
    if (this.now() - this.lastIt < 180_000 && plain.length) ids = plain;
    // losowo, ale nigdy ten sam wariant dwa razy z rzędu
    let i = Math.floor(this.rnd() * ids.length);
    if (ids.length > 1 && ids.indexOf(ids[i]) === this.last[ev]) i = (i + 1) % ids.length;
    this.last[ev] = i;
    if (this.pack.clips[ids[i]].it) this.lastIt = this.now();
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
  private bpm(v: unknown): string[] { const h = Math.round(num(v)); return this.has(`hrv.${h}`) ? [`hrv.${h}`] : []; }
  /** Losowy wariant z grupy (np. hrs.ok.*), bez powtórzenia pod rząd. */
  private pick(prefix: string): string[] {
    const ids = Object.keys(this.pack.clips).filter((k) => k.startsWith(`${prefix}.`));
    if (!ids.length) return [];
    let i = Math.floor(this.rnd() * ids.length);
    if (ids.length > 1 && i === this.last[prefix]) i = (i + 1) % ids.length;
    this.last[prefix] = i;
    return [ids[i]];
  }

  /** null = nie mów nic; [] = brak nagrania → użyj głosu systemowego. */
  compose(key: string, vars: Record<string, string | number>): string[] | null {
    if (SILENT.has(key)) return null;
    // komunikaty bez stałego wejścia: odliczanie, odprawa
    if (key === 'count') { const id = `cnt.${num(vars.n)}`; return this.has(id) ? [id] : null; }
    if (key === 'readiness') {
      const r = Math.min(100, Math.max(20, r5(num(vars.pct))));
      const lv = String(vars.level ?? 'yellow');
      const lead = this.lead(lv === 'green' ? 'readyGreen' : lv === 'red' ? 'readyRed' : 'readyYellow');
      const heavy = num(vars.heavy) ? this.lead('yHeavy') : null;
      return [...(this.has(`rd.${r}`) ? [`rd.${r}`] : []), ...(lead ? [lead] : []), ...(heavy ? [heavy] : [])];
    }
    if (key === 'condition') {
      const id = `cond.${Math.round(num(vars.n))}`;
      const lv = String(vars.level ?? 'ok');
      const lead = this.lead(lv === 'good' ? 'condGood' : lv === 'bad' ? 'condBad' : 'condOk');
      return [...(this.has(id) ? [id] : []), ...(lead ? [lead] : [])];
    }
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
        const d = Math.round(num(vars.hrUp));
        if (d && this.has(`hr.${d}`)) { seg.push(`hr.${d}`); const l = this.lead('hr'); if (l) seg.push(l); }
        break;
      }
      case 'hrUp': { const d = Math.round(num(vars.d)); if (this.has(`hr.${d}`)) seg.splice(0, 1, `hr.${d}`, lead); break; }
      case 'tooHigh': { const d = r5(num(vars.delta)); if (this.has(`sub.${d}`)) seg.push(`sub.${d}`); break; }
      case 'tooLow': { const d = r5(num(vars.delta)); if (this.has(`add.${d}`)) seg.push(`add.${d}`); break; }
      case 'half': seg.push(...this.watts(vars.avg)); break;
      case 'effort': seg.push(...this.dur(vars.dur), ...this.watts(vars.avg)); break;
      case 'hrHigh': seg.push(...this.bpm(vars.hr)); break;
      case 'hrRecovered': { const b = this.bpm(vars.hr); if (b.length) seg.unshift(...b); break; }
      case 'status': {
        seg.push(...this.watts(vars.avg));
        const b = this.bpm(vars.hr);
        if (b.length) { seg.push(...b); if (vars.hrState) seg.push(...this.pick(`hrs.${vars.hrState}`)); }
        break;
      }
    }
    // imię tylko w kluczowych momentach i rzadko – wtedy działa
    const peak = ['autoStart', 'intervalStart', 'lastMinute', 'seriesEnd', 'planDone', 'praise', 'effort'].includes(key);
    if (peak && this.nameIds.length && this.now() - this.lastName > 480_000 && this.rnd() < 0.5) {
      this.lastName = this.now();
      seg.unshift(this.nameIds[Math.floor(this.rnd() * this.nameIds.length)]);
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
