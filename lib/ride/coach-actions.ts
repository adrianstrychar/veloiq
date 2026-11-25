// Polecenia, które trener AI (Enzo) może wydać w trakcie jazdy – wspólne dla telefonu i licznika Garmin.
// Format: next | pause | resume | cancel | lap | repeat | drink | route:start | route:rejoin |
//         extend:±SEK | bias:±PROC | eat:G | page:<strona licznika>
/** Akcja z odpowiedzi modelu → tylko znane polecenia z bezpiecznymi zakresami (reszta = null). */
export function cleanAction(a: unknown): string | null {
  if (typeof a !== 'string') return null;
  const x = a.trim().toLowerCase();
  if (['next', 'pause', 'resume', 'cancel', 'lap', 'repeat', 'drink', 'route:start', 'route:rejoin'].includes(x)) return x;
  let m = /^extend:(-?\d{1,4})$/.exec(x);
  if (m) { const v = Math.max(-1800, Math.min(1800, Number(m[1]))); return v ? `extend:${v}` : null; }
  m = /^bias:([+-]?\d{1,2})$/.exec(x);
  if (m) { const v = Math.max(-25, Math.min(25, Number(m[1]))); return `bias:${m[1].startsWith('+') && v > 0 ? '+' : ''}${v}`; }
  m = /^eat:(\d{1,3})$/.exec(x);
  if (m) return `eat:${Math.max(5, Math.min(120, Number(m[1])))}`;
  m = /^page:(mapa|trasa|wykres|paliwo|podjazd|wysilek|trening|okrazenia|enzo)$/.exec(x);
  if (m) return `page:${m[1]}`;
  return null;
}

