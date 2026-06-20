import { C } from '@/lib/theme';

export type FtpSource = 'measured' | 'estimated' | 'none';

export interface FtpDisplay {
  value: number | null;
  wkg: string | null;
  tag: string;
  tagColor: string;
  badge: string;
  badgeSub: string;
  est: boolean;
  empty: boolean;
}

export function ftpDisplay(
  source: FtpSource,
  ftp: number | null,
  ftpEst: number | null,
  mass: number | null
): FtpDisplay {
  const wkg = (val: number | null) =>
    val && mass ? (val / mass).toFixed(2) : null;

  switch (source) {
    case 'measured':
      return {
        value: ftp,
        wkg: wkg(ftp),
        tag: '● zmierzone',
        tagColor: C.green,
        badge: 'Zawodnik',
        badgeSub: 'top 4% · VeloIQ',
        est: false,
        empty: false,
      };
    case 'estimated':
      return {
        value: ftpEst,
        wkg: wkg(ftpEst),
        tag: '~ szac. ze Stravy',
        tagColor: C.yellow,
        badge: 'Szacowane',
        badgeSub: 'podłącz miernik',
        est: true,
        empty: false,
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
