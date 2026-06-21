// Formatowanie daty i czasu po polsku (ETAP 6b)

// "pt., 19.06.2026"
export function formatPolishDate(dateStr: string): string {
  const d = new Date(dateStr);
  const weekday = d.toLocaleDateString('pl-PL', { weekday: 'short' }); // "pt."
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${weekday}, ${dd}.${mm}.${yyyy}`;
}

// sekundy → "1h 36min" lub "45min"
export function formatDuration(seconds: number): string {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const min = Math.round((total % 3600) / 60);
  if (h > 0) return `${h}h ${min}min`;
  return `${min}min`;
}
