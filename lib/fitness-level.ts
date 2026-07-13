// Poziom formy z W/kg. Progi + logika PRZENIESIONE do lib/level.ts (jedno źródło jako DANE —
// czytają je kafel, wykres FtpHero i milestone'y prognozy). Ten plik = re-eksport dla back-compat
// istniejących importów (ftp.ts, Progress.tsx). Nowy kod importuj wprost z '@/lib/level'.
export { wkgCategory, wkgLabel, wkgCategoryTitle, WKG_LEVELS, nextWkgLevel, type WkgLevel } from '@/lib/level';
