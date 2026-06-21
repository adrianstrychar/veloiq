// CTL/ATL/TSB calculations (sekcja 11)

// TSS dla aktywności z miernikiem mocy
export function calculateTSSfromPower(
  durationSeconds: number,
  normalizedPower: number,
  ftp: number
): number {
  const intensityFactor = normalizedPower / ftp;
  return (durationSeconds * normalizedPower * intensityFactor) / (ftp * 3600) * 100;
}

// TSS z HR (gdy brak mocy) — metoda Banister
export function calculateTSSfromHR(
  durationSeconds: number,
  avgHR: number,
  hrmax: number,
  hrrest: number = 45 // typowe RHR dla kolarza
): number {
  const hours = durationSeconds / 3600;
  const hrReserve = (avgHR - hrrest) / (hrmax - hrrest);
  const estimatedIF = hrReserve * 0.89;
  return hours * Math.pow(estimatedIF, 2) * 100;
}

// CTL — 42-dniowa wykładnicza średnia krocząca
export function updateCTL(previousCTL: number, todayTSS: number): number {
  return previousCTL + (todayTSS - previousCTL) / 42;
}

// ATL — 7-dniowa wykładnicza średnia krocząca
export function updateATL(previousATL: number, todayTSS: number): number {
  return previousATL + (todayTSS - previousATL) / 7;
}

// TSB — forma/świeżość
export function calculateTSB(ctl: number, atl: number): number {
  return ctl - atl;
}

// Interpretacja TSB dla UI
export function interpretTSB(tsb: number): {
  label: string;
  color: string;
  emoji: string;
} {
  if (tsb > 25) return { label: 'Bardzo świeży', color: '#00E5A0', emoji: '🟢' };
  if (tsb > 5) return { label: 'Świeży', color: '#00E5A0', emoji: '🟢' };
  if (tsb > -10) return { label: 'Normalny', color: '#4ECDC4', emoji: '🔵' };
  if (tsb > -20) return { label: 'Zmęczony', color: '#FF8C42', emoji: '🟡' };
  return { label: 'Przetrenowany', color: '#FF4757', emoji: '🔴' };
}

// Pełne przeliczenie historii CTL/ATL/TSB z listy aktywności
export function calculateFitnessHistory(
  activities: Array<{ date: string; tss: number }>,
  startCTL: number = 0,
  startATL: number = 0
): Array<{ date: string; ctl: number; atl: number; tsb: number }> {
  if (activities.length === 0) return [];

  // Zsumuj TSS per dzień
  const tssByDate = new Map<string, number>();
  for (const activity of activities) {
    tssByDate.set(activity.date, (tssByDate.get(activity.date) ?? 0) + activity.tss);
  }

  const dates = Array.from(tssByDate.keys()).sort();
  const startDate = new Date(dates[0]);
  const endDate = new Date(dates[dates.length - 1]);

  let ctl = startCTL;
  let atl = startATL;
  const result: Array<{ date: string; ctl: number; atl: number; tsb: number }> = [];

  // Generuj wszystkie dni (włącznie z dniami bez aktywności)
  for (
    let current = new Date(startDate);
    current <= endDate;
    current.setDate(current.getDate() + 1)
  ) {
    const dateStr = current.toISOString().slice(0, 10);
    const todayTSS = tssByDate.get(dateStr) ?? 0;

    ctl = updateCTL(ctl, todayTSS);
    atl = updateATL(atl, todayTSS);

    result.push({
      date: dateStr,
      ctl: Math.round(ctl * 100) / 100,
      atl: Math.round(atl * 100) / 100,
      tsb: Math.round(calculateTSB(ctl, atl) * 100) / 100,
    });
  }

  return result;
}
