import { C } from '@/lib/theme';

export type FtpSource = 'measured' | 'estimated' | 'none';

// Próg pokazania chipa estymaty przy wartości ręcznej (spójny z progiem wzrostu hybrydy).
const PENDING_ESTIMATE_MIN_DELTA_W = 5;

export interface FtpDisplay {
  value: number | null;
  wkg: string | null;
  tag: string;
  tagColor: string;
  badge: string;
  badgeSub: string;
  est: boolean;
  empty: boolean;
  sinceLabel: string | null;      // "od 28.06" — data ostatniej zmiany wyświetlanej wartości
  pendingEstimate: number | null; // estymata silnika ≠ wyświetlane → chip "tap = przyjmij"
}

// ISO timestamp → "od 28.06" (null gdy brak daty — ręczna wartość sprzed silnika).
function sinceLabelOf(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return `od ${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function ftpDisplay(
  source: FtpSource,
  ftp: number | null,
  ftpEst: number | null,
  mass: number | null,
  ftpUpdatedAt: string | null = null
): FtpDisplay {
  const wkg = (val: number | null) =>
    val && mass ? (val / mass).toFixed(2) : null;

  switch (source) {
    case 'measured': {
      // Cicha estymata silnika obok ręcznej/wyświetlanej wartości: chip do akceptacji,
      // gdy różnica jest znacząca. Silnik NIE nadpisuje ftp_watts bez tej akceptacji.
      const est = ftpEst != null ? Math.round(ftpEst) : null;
      const pending = est != null && ftp != null && Math.abs(est - ftp) >= PENDING_ESTIMATE_MIN_DELTA_W ? est : null;
      return {
        value: ftp,
        wkg: wkg(ftp),
        tag: '● zmierzone',
        tagColor: C.green,
        badge: 'Zawodnik',
        badgeSub: 'top 4% · VeloIQ',
        est: false,
        empty: false,
        sinceLabel: sinceLabelOf(ftpUpdatedAt),
        pendingEstimate: pending,
      };
    }
    case 'estimated':
      return {
        value: ftpEst != null ? Math.round(ftpEst) : null,
        wkg: wkg(ftpEst),
        tag: '~ szac. ze Stravy',
        tagColor: C.yellow,
        badge: 'Szacowane',
        badgeSub: 'podłącz miernik',
        est: true,
        empty: ftpEst == null,
        sinceLabel: null,
        pendingEstimate: null,
      };
    case 'none':
    default:
      return {
        value: null,
        wkg: null,
        tag: 'brak danych',
        tagColor: C.muted,
        badge: 'Ustaw FTP',
        badgeSub: 'zrób test 20 min',
        est: false,
        empty: true,
        sinceLabel: null,
        pendingEstimate: null,
      };
  }
}

// Wyprowadź source z danych profilu.
// TODO: docelowo czyta training_mode z bazy, gdy onboarding to zapisze.
export function deriveFtpSource(
  trainingMode: string | null,
  hasPowerMeter: boolean | null,
  ftpWatts: number | null,
  hasHrActivities: boolean
): FtpSource {
  // Jeśli training_mode jest ustawiony — ufamy mu wprost
  if (trainingMode === 'power' && ftpWatts) return 'measured';
  if (trainingMode === 'hr' || trainingMode === 'basic') {
    return hasHrActivities ? 'estimated' : 'none';
  }
  // Fallback prowizoryczny gdy brak training_mode
  if (hasPowerMeter && ftpWatts) return 'measured';
  if (hasHrActivities) return 'estimated';
  return 'none';
}
