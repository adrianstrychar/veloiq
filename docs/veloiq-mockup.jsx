import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine, CartesianGrid } from "recharts";

const C = {
  bg: '#14161B', card: '#1A1D23', card2: '#1E222A', border: '#262A31',
  cyan: '#4A8FC7', green: '#5B9B7E', yellow: '#C99A4E', red: '#C76B6B', purple: '#8C7BC0',
  text: '#EDEFF2', muted: '#9AA0AB', dim: '#21252C',
};

const FTP = 295, MASS = 67, HRMAX = 189, VO2MAX = 62;

// Źródło FTP: 'measured' (miernik mocy), 'estimated' (szac. ze Stravy: prędkość+HR), 'none' (brak danych)
// W prawdziwej apce ustalane automatycznie z danych aktywności. Tu domyślnie 'measured' (Adrian ma miernik).
const FTP_SOURCE = 'measured';
const FTP_EST = 282; // szacowana wartość gdy brak miernika (28-dniowa estymata Stravy)

const ftpHistory = [
  { m: 'Sty', ftp: 271, vo2: 56 },
  { m: 'Lut', ftp: 276, vo2: 57 },
  { m: 'Mar', ftp: 283, vo2: 59 },
  { m: 'Kwi', ftp: 288, vo2: 60 },
  { m: 'Maj', ftp: 292, vo2: 61 },
  { m: 'Cze', ftp: 295, vo2: 62 },
];
const STREAK_WEEKS = 14;
const SEASON_RIDES = 120;
const SEASON_KM = 6739;
const SEASON_GOAL_KM = 12000;
const SEASON_PACE_DELTA = 1183; // +ahead / -behind expected pace today

const acts = [
  { date: '2026-03-21', tss: 66,  name: 'Afternoon Gravel Ride', dist: 44.2, ele: 398, time: 5708, sport: 'Gravel' },
  { date: '2026-03-22', tss: 105, name: 'Lunch Gravel Ride', dist: 45.1, ele: 781, time: 6686, sport: 'Gravel' },
  { date: '2026-03-23', tss: 14,  name: 'Zwift – Pacer Coco', dist: 41.1, ele: 244, time: 3869, sport: 'Virtual' },
  { date: '2026-03-24', tss: 77,  name: 'Afternoon Gravel Ride', dist: 30.2, ele: 750, time: 4519, sport: 'Gravel' },
  { date: '2026-03-27', tss: 91,  name: 'Afternoon Gravel Ride', dist: 63.8, ele: 281, time: 8645, sport: 'Gravel' },
  { date: '2026-03-28', tss: 220, name: 'Morning Gravel Ride', dist: 122.0, ele: 417, time: 14947, sport: 'Gravel' },
  { date: '2026-03-29', tss: 99,  name: 'Lunch Gravel Ride', dist: 70.7, ele: 331, time: 8256, sport: 'Gravel' },
  { date: '2026-03-31', tss: 82,  name: 'Zwift – Volcano Flat', dist: 40.3, ele: 155, time: 3786, sport: 'Virtual' },
  { date: '2026-04-01', tss: 86,  name: 'Afternoon Gravel Ride', dist: 61.3, ele: 571, time: 7762, sport: 'Gravel' },
  { date: '2026-04-02', tss: 128, name: 'Afternoon Gravel Ride', dist: 58.9, ele: 934, time: 8652, sport: 'Gravel' },
  { date: '2026-04-05', tss: 138, name: 'Afternoon Gravel Ride', dist: 87.2, ele: 860, time: 11459, sport: 'Gravel' },
  { date: '2026-04-06', tss: 22,  name: 'Afternoon Gravel Ride', dist: 30.5, ele: 283, time: 4128, sport: 'Gravel' },
  { date: '2026-04-07', tss: 21,  name: 'Afternoon Gravel Ride', dist: 25.6, ele: 384, time: 3720, sport: 'Gravel' },
  { date: '2026-04-08', tss: 52,  name: 'Afternoon Gravel Ride', dist: 40.1, ele: 461, time: 5216, sport: 'Gravel' },
  { date: '2026-04-11', tss: 53,  name: 'Lunch Gravel Ride', dist: 36.9, ele: 452, time: 6107, sport: 'Gravel' },
  { date: '2026-04-12', tss: 391, name: 'Shit happens + warmup', dist: 95.2, ele: 1108, time: 12072, sport: 'Gravel' },
  { date: '2026-04-16', tss: 88,  name: 'New dream bike ride', dist: 62.0, ele: 749, time: 8178, sport: 'Road' },
  { date: '2026-04-19', tss: 456, name: 'UCI Gran Fondo Austria', dist: 136.5, ele: 844, time: 12539, sport: 'Race' },
  { date: '2026-04-24', tss: 82,  name: 'Lunch Ride – Garda', dist: 50.4, ele: 141, time: 5963, sport: 'Road' },
  { date: '2026-04-25', tss: 286, name: 'Dookoła Gardy', dist: 140.0, ele: 690, time: 15913, sport: 'Road' },
  { date: '2026-04-26', tss: 48,  name: 'Morning Ride – Garda', dist: 60.6, ele: 535, time: 7580, sport: 'Road' },
  { date: '2026-04-27', tss: 233, name: 'Torbole na kawę', dist: 120.6, ele: 452, time: 12614, sport: 'Road' },
  { date: '2026-04-28', tss: 16,  name: 'Coffee ride', dist: 32.2, ele: 160, time: 4368, sport: 'Road' },
  { date: '2026-05-01', tss: 126, name: 'Afternoon Ride', dist: 100.3, ele: 1002, time: 12433, sport: 'Road' },
  { date: '2026-05-02', tss: 106, name: 'Lunch Ride', dist: 41.6, ele: 824, time: 5754, sport: 'Road' },
  { date: '2026-05-03', tss: 106, name: 'Afternoon Ride', dist: 46.3, ele: 910, time: 6325, sport: 'Road' },
  { date: '2026-05-05', tss: 21,  name: 'Afternoon Ride', dist: 48.9, ele: 333, time: 5848, sport: 'Road' },
  { date: '2026-05-06', tss: 47,  name: 'Afternoon Ride', dist: 45.4, ele: 609, time: 5807, sport: 'Road' },
  { date: '2026-05-08', tss: 12,  name: 'Zwift – London', dist: 30.1, ele: 205, time: 3106, sport: 'Virtual' },
  { date: '2026-05-09', tss: 46,  name: 'Afternoon Ride', dist: 33.3, ele: 318, time: 4189, sport: 'Road' },
  { date: '2026-05-10', tss: 525, name: 'UCI Sudety Tour', dist: 157.9, ele: 2194, time: 17337, sport: 'Race' },
  { date: '2026-05-11', tss: 12,  name: 'Afternoon Ride', dist: 30.6, ele: 260, time: 4239, sport: 'Road' },
  { date: '2026-05-13', tss: 105, name: 'Afternoon Ride', dist: 51.2, ele: 920, time: 6754, sport: 'Road' },
  { date: '2026-05-14', tss: 128, name: 'Afternoon Ride', dist: 102.6, ele: 1310, time: 13517, sport: 'Road' },
  { date: '2026-05-16', tss: 133, name: 'Afternoon Ride', dist: 58.7, ele: 910, time: 8297, sport: 'Road' },
  { date: '2026-05-17', tss: 132, name: 'Lunch Ride', dist: 100.0, ele: 591, time: 11364, sport: 'Road' },
  { date: '2026-05-19', tss: 130, name: 'Morning Ride', dist: 101.9, ele: 178, time: 12177, sport: 'Road' },
  { date: '2026-05-20', tss: 58,  name: 'Morning Ride', dist: 78.0, ele: 180, time: 9236, sport: 'Road' },
  { date: '2026-05-23', tss: 162, name: 'Afternoon Gravel Ride', dist: 53.5, ele: 1286, time: 8682, sport: 'Gravel' },
  { date: '2026-05-24', tss: 66,  name: 'Morning Gravel Ride', dist: 64.7, ele: 960, time: 10824, sport: 'Gravel' },
  { date: '2026-05-27', tss: 110, name: 'Lunch Gravel Ride', dist: 62.2, ele: 1163, time: 9512, sport: 'Gravel' },
  { date: '2026-05-28', tss: 121, name: 'Afternoon Gravel Ride', dist: 65.6, ele: 1194, time: 9604, sport: 'Gravel' },
  { date: '2026-05-29', tss: 19,  name: 'Afternoon Gravel Ride', dist: 41.4, ele: 297, time: 5178, sport: 'Gravel' },
  { date: '2026-05-30', tss: 170, name: 'Morning Gravel Ride', dist: 105.7, ele: 1218, time: 14491, sport: 'Gravel' },
  { date: '2026-05-31', tss: 51,  name: 'Afternoon Gravel Ride', dist: 100.8, ele: 490, time: 13245, sport: 'Gravel' },
  { date: '2026-06-02', tss: 26,  name: 'Evening Gravel Ride', dist: 35.3, ele: 381, time: 5265, sport: 'Gravel' },
  { date: '2026-06-04', tss: 37,  name: 'Afternoon Gravel Ride', dist: 45.5, ele: 430, time: 6857, sport: 'Gravel' },
  { date: '2026-06-05', tss: 12,  name: 'Afternoon Gravel Ride', dist: 16.5, ele: 175, time: 2427, sport: 'Gravel' },
  { date: '2026-06-06', tss: 589, name: 'GWS Jakuszyce', dist: 129.3, ele: 2549, time: 19381, sport: 'Race' },
  { date: '2026-06-09', tss: 22,  name: 'Evening Ride', dist: 41.7, ele: 271, time: 4809, sport: 'Road' },
  { date: '2026-06-11', tss: 73,  name: 'Popołudniowa jazda', dist: 31.1, ele: 647, time: 4774, sport: 'Road' },
  { date: '2026-06-13', tss: 111, name: 'Afternoon Ride', dist: 66.2, ele: 742, time: 8526, sport: 'Road' },
  { date: '2026-06-14', tss: 95,  name: 'Lunch Ride', dist: 80.6, ele: 399, time: 9918, sport: 'Road' },
  { date: '2026-06-16', tss: 93,  name: 'Afternoon Ride', dist: 45.0, ele: 881, time: 6401, sport: 'Road' },
  { date: '2026-06-18', tss: 112, name: 'Over-Under 3 bloki', dist: 60.6, ele: 996, time: 8174, sport: 'Road' },
];

// Jakuszyce power profile (real best efforts, watts)
const powerProfile = [
  { d: '5s', w: 698 }, { d: '15s', w: 475 }, { d: '30s', w: 447 }, { d: '1min', w: 345 },
  { d: '2min', w: 322 }, { d: '3min', w: 315 }, { d: '5min', w: 306 }, { d: '8min', w: 288 },
  { d: '10min', w: 290 }, { d: '20min', w: 263 }, { d: '30min', w: 255 }, { d: '1hr', w: 214 },
];

const races = [
  { date: '2026-07-19', name: '3Rides Winterberg', loc: 'Niemcy', series: 'UCI Gravel WS', dist: '~110 km', status: 'next' },
  { date: '2026-08-01', name: 'Hlinsko', loc: 'Czechy', series: 'UCI Gravel WS', dist: '~100 km', status: 'planned' },
  { date: '2026-08-15', name: 'Gravel Grit n Grind', loc: 'Szwecja', series: 'UCI Gravel WS', dist: '~120 km', status: 'planned' },
  { date: '2026-09-13', name: 'Granfondo Matildica', loc: 'Włochy', series: 'UCI Gravel WS', dist: '~130 km', status: 'planned' },
  { date: '2026-09-19', name: 'Sea Otter Europe Girona', loc: 'Hiszpania', series: 'UCI Gravel WS', dist: '~120 km', status: 'planned' },
  { date: '2026-10-10', name: 'UCI Gravel Worlds Nannup', loc: 'Australia', series: 'Mistrzostwa Świata', dist: 'cel', status: 'goal' },
];

const weekPlan = [
  { day: 'Pn', date: '15.06', type: 'OFF', label: 'Regeneracja', tss: 0, dur: 0, watt: '–', hr: '–', zones: [0,0,0,0,0], done: true },
  { day: 'Wt', date: '16.06', type: 'SST', label: 'Sweet Spot góry', tss: 93, dur: 107, watt: '255–275W', hr: '155–168', zones: [21,33,18,25,3], done: true },
  { day: 'Śr', date: '17.06', type: 'OFF', label: 'Regeneracja', tss: 0, dur: 0, watt: '–', hr: '–', zones: [0,0,0,0,0], done: true },
  { day: 'Cz', date: '18.06', type: 'OU', label: 'Over-Under 3 bloki', tss: 112, dur: 136, watt: '281/329W', hr: '155–177', zones: [38,24,8,22,8], today: true, done: true },
  { day: 'Pt', date: '19.06', type: 'Z1', label: 'Regeneracja aktywna', tss: 35, dur: 60, watt: '120–150W', hr: '110–125', zones: [70,30,0,0,0] },
  { day: 'So', date: '20.06', type: 'LONG', label: 'Long gravel', tss: 180, dur: 240, watt: '180–200W', hr: '135–150', zones: [20,65,15,0,0] },
  { day: 'Nd', date: '21.06', type: 'Z2', label: 'Endurance', tss: 70, dur: 110, watt: '170–190W', hr: '128–142', zones: [30,70,0,0,0] },
];

// ── Tygodnie planu (nawigacja strzałkami) ──
// idx 0 = poprzedni (wykonany), 1 = bieżący, 2/3 = przyszłe (zarys).
// Bieżący tydzień = weekPlan. Przeszły: wszystko done. Przyszłe: outline.
const prevWeekPlan = [
  { day: 'Pn', date: '08.06', type: 'OFF',  label: 'Regeneracja',     tss: 0,   dur: 0,   watt: '–', hr: '–', zones: [0,0,0,0,0], done: true },
  { day: 'Wt', date: '09.06', type: 'Z1',   label: 'Rozruch',          tss: 22,  dur: 50,  watt: '120–150W', hr: '108–122', zones: [75,25,0,0,0], done: true },
  { day: 'Śr', date: '10.06', type: 'Z2',   label: 'Endurance',        tss: 73,  dur: 115, watt: '170–190W', hr: '128–142', zones: [30,70,0,0,0], done: true },
  { day: 'Cz', date: '11.06', type: 'THR',  label: 'Threshold 4×8min', tss: 111, dur: 95,  watt: '285–305W', hr: '165–176', zones: [20,25,10,45,0], done: true },
  { day: 'Pt', date: '12.06', type: 'OFF',  label: 'Odpoczynek',       tss: 0,   dur: 0,   watt: '–', hr: '–', zones: [0,0,0,0,0], done: true },
  { day: 'So', date: '13.06', type: 'LONG', label: 'Long gravel',      tss: 111, dur: 180, watt: '180–200W', hr: '135–150', zones: [22,63,15,0,0], done: true },
  { day: 'Nd', date: '14.06', type: 'Z2',   label: 'Endurance',        tss: 95,  dur: 145, watt: '170–190W', hr: '130–145', zones: [28,72,0,0,0], done: true },
];
const nextWeek1Plan = [ // 22–28.06 (zarys)
  { day: 'Pn', date: '22.06', type: 'OFF',  label: 'Odpoczynek',        tss: 0,   dur: 0,   watt: '–', hr: '–', zones: [0,0,0,0,0], outline: true },
  { day: 'Wt', date: '23.06', type: 'THR',  label: 'Threshold 3×15min', tss: 100, dur: 95,  watt: '280–301W', hr: '162–174', zones: [25,20,10,45,0], outline: true },
  { day: 'Śr', date: '24.06', type: 'Z2',   label: 'Endurance',         tss: 65,  dur: 90,  watt: '170–190W', hr: '128–142', zones: [30,70,0,0,0], outline: true },
  { day: 'Cz', date: '25.06', type: 'OFF',  label: 'Odpoczynek',        tss: 0,   dur: 0,   watt: '–', hr: '–', zones: [0,0,0,0,0], outline: true },
  { day: 'Pt', date: '26.06', type: 'OU',   label: 'Over-Under',        tss: 115, dur: 105, watt: '280/325W', hr: '158–176', zones: [30,25,8,25,12], outline: true },
  { day: 'So', date: '27.06', type: 'LONG', label: 'Long gravel',       tss: 195, dur: 255, watt: '180–200W', hr: '135–150', zones: [20,65,15,0,0], outline: true },
  { day: 'Nd', date: '28.06', type: 'Z2',   label: 'Endurance',         tss: 70,  dur: 110, watt: '170–190W', hr: '128–142', zones: [30,70,0,0,0], outline: true },
];
const nextWeek2Plan = [ // 29.06–05.07 (zarys)
  { day: 'Pn', date: '29.06', type: 'OFF',  label: 'Odpoczynek',   tss: 0,   dur: 0,   watt: '–', hr: '–', zones: [0,0,0,0,0], outline: true },
  { day: 'Wt', date: '30.06', type: 'THR',  label: 'Threshold',    tss: 95,  dur: 90,  watt: '280–301W', hr: '162–174', zones: [25,20,10,45,0], outline: true },
  { day: 'Śr', date: '01.07', type: 'Z2',   label: 'Endurance',    tss: 65,  dur: 90,  watt: '170–190W', hr: '128–142', zones: [30,70,0,0,0], outline: true },
  { day: 'Cz', date: '02.07', type: 'LONG', label: 'Long gravel',  tss: 185, dur: 240, watt: '180–200W', hr: '135–150', zones: [20,65,15,0,0], outline: true },
  { day: 'Pt', date: '03.07', type: 'OFF',  label: 'Odpoczynek',   tss: 0,   dur: 0,   watt: '–', hr: '–', zones: [0,0,0,0,0], outline: true },
  { day: 'So', date: '04.07', type: 'OU',   label: 'Over-Under',   tss: 120, dur: 110, watt: '280/325W', hr: '158–176', zones: [30,25,8,25,12], outline: true },
  { day: 'Nd', date: '05.07', type: 'Z2',   label: 'Endurance',    tss: 75,  dur: 115, watt: '170–190W', hr: '128–142', zones: [30,70,0,0,0], outline: true },
];
const WEEKS = [
  { label: 'Poprzedni tydzień', range: '8–14.06', plan: prevWeekPlan, kind: 'past' },
  { label: 'Bieżący tydzień',   range: '15–21.06', plan: weekPlan,     kind: 'current' },
  { label: 'Kolejny tydzień',   range: '22–28.06', plan: nextWeek1Plan, kind: 'future' },
  { label: 'Za 2 tygodnie',     range: '29.06–5.07', plan: nextWeek2Plan, kind: 'future' },
];
const CURRENT_WEEK_IDX = 1;

// Future planned trainings (beyond this week's plan, for calendar)
// Plan: 7 dni szczegół (pełna rozpiska) + 7 dni zarys (outline: typ + ~TSS).
// outline:true = orientacyjny, dopina się po najbliższych sesjach.
const futureTrainings = [
  // ── Warstwa 1: szczegół (19–25.06) ──
  { date: '2026-06-19', type: 'Z1', label: 'Regeneracja aktywna', tss: 35, dur: 60, watt: '120–150W', hr: '110–125', zones: [70,30,0,0,0] },
  { date: '2026-06-20', type: 'LONG', label: 'Long gravel', tss: 180, dur: 240, watt: '180–200W', hr: '135–150', zones: [20,65,15,0,0] },
  { date: '2026-06-21', type: 'Z2', label: 'Endurance', tss: 70, dur: 110, watt: '170–190W', hr: '128–142', zones: [30,70,0,0,0] },
  { date: '2026-06-22', type: 'OFF', label: 'Odpoczynek', tss: 0, dur: 0 },
  { date: '2026-06-23', type: 'THR', label: 'Threshold 3×15min', tss: 100, dur: 95, watt: '280–301W', hr: '162–174', zones: [25,20,10,45,0] },
  { date: '2026-06-24', type: 'Z2', label: 'Endurance', tss: 65, dur: 90, watt: '170–190W', hr: '128–142', zones: [30,70,0,0,0] },
  { date: '2026-06-25', type: 'OFF', label: 'Odpoczynek', tss: 0, dur: 0 },
  // ── Warstwa 2: zarys (26.06–02.07) ──
  { date: '2026-06-26', type: 'OU', label: 'Over-Under', tss: 115, dur: 105, outline: true },
  { date: '2026-06-27', type: 'LONG', label: 'Long gravel', tss: 195, dur: 255, outline: true },
  { date: '2026-06-28', type: 'Z2', label: 'Endurance', tss: 70, dur: 110, outline: true },
  { date: '2026-06-29', type: 'OFF', label: 'Odpoczynek', tss: 0, dur: 0, outline: true },
  { date: '2026-06-30', type: 'THR', label: 'Threshold', tss: 95, dur: 90, outline: true },
  { date: '2026-07-01', type: 'Z2', label: 'Endurance', tss: 65, dur: 90, outline: true },
  { date: '2026-07-02', type: 'LONG', label: 'Long gravel', tss: 185, dur: 240, outline: true },
  // ── Punkty kontekstu przed startem (poza oknem 14 dni) ──
  { date: '2026-07-15', type: 'Z2', label: 'Roztrenowanie', tss: 50, dur: 75, outline: true },
  { date: '2026-07-17', type: 'THR', label: 'Openers + próg', tss: 55, dur: 60, outline: true },
  { date: '2026-07-18', type: 'OFF', label: 'Dzień przed startem', tss: 0, dur: 0, outline: true },
];

function buildCalendarEvents() {
  const ev = {};
  acts.forEach(a => { (ev[a.date] = ev[a.date] || []).push({ kind: a.sport==='Race'?'race':'activity', ...a }); });
  futureTrainings.forEach(t => { (ev[t.date] = ev[t.date] || []).push({ kind:'training', ...t }); });
  races.forEach(r => { (ev[r.date] = ev[r.date] || []).push({ kind:'race', name:r.name, loc:r.loc, series:r.series, dist:r.dist, planned:true }); });
  return ev;
}

function computePMC() {
  const from = new Date('2026-03-20'), to = new Date('2026-06-18');
  const dtss = {};
  acts.forEach(a => { dtss[a.date] = (dtss[a.date] || 0) + a.tss; });
  let ctl = 0, atl = 0; const out = [];
  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    const ds = d.toISOString().slice(0, 10);
    const tss = dtss[ds] || 0;
    ctl += (tss - ctl) / 42; atl += (tss - atl) / 7;
    const dd = new Date(d);
    out.push({ date: ds, label: `${dd.getDate()}.${dd.getMonth() + 1}`, ctl: +ctl.toFixed(1), atl: +atl.toFixed(1), tsb: +(ctl - atl).toFixed(1), tss });
  }
  return out;
}
function computeWeeks() {
  const wks = {};
  acts.forEach(a => {
    const d = new Date(a.date), dow = d.getDay();
    const mon = new Date(d); mon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    const k = mon.toISOString().slice(0, 10);
    wks[k] = (wks[k] || 0) + a.tss;
  });
  return Object.entries(wks).sort(([a],[b]) => a.localeCompare(b)).slice(-8)
    .map(([dt, tss]) => { const d = new Date(dt); return { label: `${d.getDate()}.${d.getMonth()+1}`, tss: Math.round(tss) }; });
}
function fmtTime(s) { const h = Math.floor(s/3600), m = Math.floor((s%3600)/60); return h>0 ? `${h}h ${String(m).padStart(2,'0')}m` : `${m}m`; }
function fmtDur(m) { const h = Math.floor(m/60), mm = m%60; return h>0 ? `${h}h${mm>0?` ${mm}m`:''}` : `${mm}min`; }

const ZONE_COLORS = ['#3A4A5C', C.green, C.cyan, C.yellow, C.red];
const pmc = computePMC();
const weeks = computeWeeks();

const calEvents = buildCalendarEvents();

// Premium line icons (stroke, inherit color)
function Icon({ name, size = 22, color = 'currentColor', sw = 1.6 }) {
  const p = { width:size, height:size, viewBox:'0 0 24 24', fill:'none', stroke:color, strokeWidth:sw, strokeLinecap:'round', strokeLinejoin:'round' };
  const paths = {
    pulse: <><path d="M3 12h4l2.5-7 4 14 2.5-7h5"/></>,
    layers: <><path d="M12 3 3 8l9 5 9-5-9-5Z"/><path d="m3 13 9 5 9-5"/></>,
    spark: <><path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/></>,
    calendar: <><rect x="3" y="4.5" width="18" height="17" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4"/></>,
    chart: <><path d="M4 19V5M4 19h16"/><path d="m7 15 3.5-4 3 2.5L20 7"/></>,
    flag: <><path d="M4 21V4M4 4h11l-1.5 4L15 12H4"/></>,
    chevR: <><path d="m9 6 6 6-6 6"/></>,
    close: <><path d="M18 6 6 18M6 6l12 12"/></>,
  };
  return <svg {...p}>{paths[name]}</svg>;
}

function SportBadge({ sport, small }) {
  const map = { Race:['WYŚCIG',C.red], Gravel:['GRAVEL',C.yellow], Road:['SZOSA',C.cyan], Virtual:['ZWIFT',C.purple] };
  const [label, color] = map[sport] || ['JAZDA', C.muted];
  return <span style={{ background: color+'22', color, border:`1px solid ${color}55`, borderRadius:4, padding: small?'1px 6px':'2px 8px', fontSize: small?8:9, fontWeight:600, letterSpacing:'0.08em' }}>{label}</span>;
}
function Spark({ data, k, color }) {
  return <ResponsiveContainer width="100%" height={28}><LineChart data={data} margin={{top:2,right:0,left:0,bottom:2}}><Line type="monotone" dataKey={k} stroke={color} strokeWidth={1.5} dot={false} isAnimationActive={false} /></LineChart></ResponsiveContainer>;
}
function PmcTip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return <div style={{ background:'#0A1828', border:`1px solid ${C.border}`, borderRadius:8, padding:'8px 12px', fontSize:11 }}><div style={{color:C.muted, marginBottom:4}}>{label}</div>{payload.map(p=><div key={p.dataKey} style={{color:p.color}}>{p.dataKey.toUpperCase()}: {p.value}</div>)}</div>;
}
function ZoneBar({ zones }) {
  const tot = zones.reduce((a,b)=>a+b,0) || 1;
  return <div style={{ display:'flex', height:6, borderRadius:3, overflow:'hidden', background:C.dim }}>{zones.map((z,i)=> z>0 && <div key={i} style={{ width:`${z/tot*100}%`, background:ZONE_COLORS[i] }} />)}</div>;
}

const card = { background: C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:'14px 16px' };

// ─────────────── READINESS (WHOOP-style) ───────────────
function computeReadiness() {
  const now = pmc[pmc.length-1];
  const peak = Math.max(...pmc.map(p=>p.ctl));
  const wk1 = pmc[pmc.length-8] || pmc[0];

  // Forma: CTL relative to season peak (0-100)
  const fitnessPct = Math.round(now.ctl / peak * 100);
  // Świeżość: map TSB to 0-100 (TSB +25 = 100% fresh, -30 = 0%)
  const freshPct = Math.max(0, Math.min(100, Math.round((now.tsb + 30) / 55 * 100)));
  // Gotowość startowa: blend — race-ready = good fitness AND positive freshness
  const raceReady = Math.round(fitnessPct * 0.55 + freshPct * 0.45);

  let state, stateColor, advice;
  if (now.tsb > 15) { state = 'Wypoczęty'; stateColor = C.green; advice = 'Nogi świeże i pełne energii. Świetny dzień na mocniejszy trening.'; }
  else if (now.tsb >= 5) { state = 'Gotowy'; stateColor = C.green; advice = 'Forma w równowadze — możesz spokojnie realizować plan.'; }
  else if (now.tsb >= -10) { state = 'Lekko zmęczony'; stateColor = C.yellow; advice = 'Nogi trochę zmęczone po treningach — to normalne, tak rośnie forma. Zadbaj o sen.'; }
  else { state = 'Mocno zmęczony'; stateColor = C.red; advice = 'Duże zmęczenie. Lepiej dziś odpocząć albo pojechać lekko, zanim przesadzisz.'; }

  return { now, peak, fitnessPct, freshPct, raceReady, state, stateColor, advice, ctlRamp: +(now.ctl-wk1.ctl).toFixed(1) };
}

function Ring({ pct, color, size=132, label, value, sub }) {
  const sw = 11, r = (size - sw) / 2, circ = 2 * Math.PI * r;
  const off = circ * (1 - pct/100);
  return (
    <div style={{ position:'relative', width:size, height:size }}>
      <svg width={size} height={size} style={{ transform:'rotate(-90deg)' }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={C.dim} strokeWidth={sw} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={off} style={{ transition:'stroke-dashoffset 1s ease' }} />
      </svg>
      <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
        <div style={{ fontSize:size>120?34:24, fontWeight:600, color, lineHeight:1 }}>{value}<span style={{ fontSize:size>120?16:12 }}>%</span></div>
        {sub && <div style={{ fontSize:9, color:C.muted, marginTop:2 }}>{sub}</div>}
      </div>
    </div>
  );
}

function ReadinessModule() {
  const [open, setOpen] = useState(false);
  const r = computeReadiness();

  return (
    <div style={{ ...card, marginBottom:10, padding:'18px 18px 14px' }}>
      <div style={{ display:'flex', alignItems:'center', gap:18, flexWrap:'wrap' }}>
        {/* Main readiness ring */}
        <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:6 }}>
          <div style={{ fontSize:9, color:C.muted, letterSpacing:'0.12em', fontWeight:600 }}>GOTOWOŚĆ DZIŚ</div>
          <Ring pct={r.raceReady} value={r.raceReady} color={r.stateColor} />
          <div style={{ background:r.stateColor+'1E', color:r.stateColor, border:`1px solid ${r.stateColor}44`, borderRadius:20, padding:'4px 14px', fontSize:12, fontWeight:600 }}>{r.state}</div>
        </div>

        {/* Right column: two sub-bars + verdict */}
        <div style={{ flex:1, minWidth:200 }}>
          {/* Fitness bar */}
          <div style={{ marginBottom:14 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:5 }}>
              <span style={{ fontSize:12, fontWeight:600 }}>Forma</span>
              <span style={{ fontSize:13, fontWeight:600, color:C.cyan }}>{r.fitnessPct}%</span>
            </div>
            <div style={{ background:C.dim, borderRadius:5, height:9, overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${r.fitnessPct}%`, background:C.cyan, borderRadius:5, transition:'width 1s ease' }} />
            </div>
            <div style={{ fontSize:9, color:C.muted, marginTop:3 }}>{r.ctlRamp>=0?'↗ rośnie':'↘ regeneracja'} · względem szczytu sezonu</div>
          </div>
          {/* Freshness bar */}
          <div style={{ marginBottom:14 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:5 }}>
              <span style={{ fontSize:12, fontWeight:600 }}>Świeżość</span>
              <span style={{ fontSize:13, fontWeight:600, color:C.green }}>{r.freshPct}%</span>
            </div>
            <div style={{ background:C.dim, borderRadius:5, height:9, overflow:'hidden' }}>
              <div style={{ height:'100%', width:`${r.freshPct}%`, background:C.green, borderRadius:5, transition:'width 1s ease' }} />
            </div>
            <div style={{ fontSize:9, color:C.muted, marginTop:3 }}>nogi wypoczęte i gotowe do wysiłku</div>
          </div>
          {/* Verdict */}
          <div style={{ fontSize:12, lineHeight:1.55, color:C.text, background:C.bg, borderRadius:8, padding:'10px 12px', border:`1px solid ${C.border}` }}>
            {r.advice}
          </div>
        </div>
      </div>

      {/* Expandable raw data for coach/power-user */}
      <button onClick={()=>setOpen(o=>!o)} style={{ width:'100%', marginTop:14, background:'none', border:'none', borderTop:`1px solid ${C.border}`, paddingTop:12, color:C.muted, fontSize:11, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', gap:6 }}>
        {open?'Ukryj':'Pokaż'} dane szczegółowe (CTL / ATL / TSB) <span style={{ fontSize:9 }}>{open?'▲':'▼'}</span>
      </button>
      {open && <RawMetrics />}
    </div>
  );
}

function RawMetrics() {
  const now = pmc[pmc.length-1], wk7 = pmc[pmc.length-8] || pmc[0];
  const chart60 = pmc.slice(-65);
  const spark14 = pmc.slice(-14);
  return (
    <div style={{ marginTop:12 }}>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:12 }}>
        {[
          { l:'CTL · Forma', v:now.ctl, c:C.cyan, k:'ctl' },
          { l:'ATL · Zmęczenie', v:now.atl, c:C.yellow, k:'atl' },
          { l:'TSB · Świeżość', v:(now.tsb>0?'+':'')+now.tsb, c:now.tsb>=0?C.green:C.red, k:'tsb' },
        ].map(m=>(
          <div key={m.k} style={{ background:C.bg, borderRadius:8, padding:'10px 12px', border:`1px solid ${C.border}` }}>
            <div style={{ fontSize:8, color:C.muted, letterSpacing:'0.1em', fontWeight:600, marginBottom:2 }}>{m.l}</div>
            <div style={{ fontSize:22, fontWeight:600, color:m.c, marginBottom:2 }}>{m.v}</div>
            <Spark data={spark14} k={m.k} color={m.c} />
          </div>
        ))}
      </div>
      <div style={{ fontSize:9, color:C.muted, marginBottom:6 }}>Performance Management Chart — 65 dni</div>
      <ResponsiveContainer width="100%" height={150}>
        <LineChart data={chart60} margin={{top:4,right:4,left:0,bottom:0}}>
          <CartesianGrid stroke={C.border} strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="label" tick={{fill:C.muted,fontSize:8}} axisLine={false} tickLine={false} interval={10} />
          <YAxis tick={{fill:C.muted,fontSize:9}} axisLine={false} tickLine={false} width={26} />
          <ReferenceLine y={0} stroke={C.border} strokeDasharray="4 3" />
          <Tooltip content={<PmcTip />} />
          <Line type="monotone" dataKey="ctl" stroke={C.cyan} strokeWidth={2} dot={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="atl" stroke={C.yellow} strokeWidth={1.5} dot={false} strokeDasharray="5 2" isAnimationActive={false} />
          <Line type="monotone" dataKey="tsb" stroke={C.green} strokeWidth={1.5} dot={false} strokeDasharray="2 2" isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─────────────────────────── DASHBOARD ───────────────────────────
// ─── Ride analysis data (real rides, keyed by date) ───
const RIDE_DATA = {
  // ── Czwartek 18.06 · Over-Under 3 bloki ──
  '2026-06-18': {
    title: 'Over-Under 3 bloki', dateLabel: 'Czwartek · 18 czerwca 2026 · 16:44',
    fff: {
      fit:  { val:62,  bar:62, trend:'↑ +3',  sub:'po bloku',       tc:'#5B9B7E', spark:[56,58,59,60,62] },
      form: { val:'−1', bar:48, trend:'↓ -10', sub:'załadowany',     tc:'#C99A4E', spark:[12,9,6,2,-1] },
      fat:  { val:64,  bar:64, trend:'↑ +13', sub:'mocny bodziec',  tc:'#C76B6B', spark:[48,50,52,58,64] },
    },
    efforts: [
      { d:'5 sek',      w:'441 W', pct:'149% FTP',             bar:100, c:'#C76B6B' },
      { d:'1 min',      w:'330 W', pct:'112% FTP',             bar:74,  c:'#C77E5E' },
      { d:'5 min',      w:'300 W', pct:'102% FTP · VO2max',    bar:67,  c:'#C99A4E' },
      { d:'10 min',     w:'295 W', pct:'100% FTP — równo próg!', bar:66, c:'#5B9B7E' },
      { d:'Avg całość', w:'179 W', pct:'61% FTP · IF ~0.70',   bar:40,  c:'#4A8FC7' },
      { d:'HR avg / max', w:'137/179', pct:'72% / 95% HRmax',  bar:72,  c:'#C76B6B', hr:true, hrVal:'137/179' },
    ],
    laps: [
      { n:1, name:'Rozgrzewka / dojazd', type:'Z2', tc:'#5B8FB8', w:'157W', hr:'123 bpm', time:'27:53', km:'14.1', kmLbl:'km' },
      { n:2, name:'Blok 1 · Over-Under', type:'OVER-UNDER', tc:'#C99A4E', w:'298W', hr:'166 bpm', time:'12:00', km:'+191m', kmLbl:'D+',
        sub:[
          { kind:'under', t:'3:00', w:'282W', hr:'155', pct:'95%' },
          { kind:'over',  t:'1:00', w:'330W', hr:'167', pct:'112%' },
          { kind:'under', t:'3:00', w:'281W', hr:'167', pct:'95%' },
          { kind:'over',  t:'1:00', w:'326W', hr:'173', pct:'110%' },
          { kind:'under', t:'3:00', w:'281W', hr:'170', pct:'95%' },
          { kind:'over',  t:'1:00', w:'329W', hr:'175', pct:'112%' },
        ] },
      { n:3, name:'Przerwa / zjazd', type:'Z1', tc:'#9AA0AB', w:'53W', hr:'125 bpm', time:'5:00', km:'3.3', kmLbl:'km' },
      { n:4, name:'Blok 2 · Over-Under', type:'OVER-UNDER', tc:'#C99A4E', w:'305W', hr:'167 bpm', time:'10:00', km:'+165m', kmLbl:'D+',
        sub:[
          { kind:'under', t:'3:00', w:'282W', hr:'156', pct:'95%' },
          { kind:'over',  t:'1:00', w:'330W', hr:'169', pct:'112%' },
          { kind:'under', t:'3:00', w:'281W', hr:'170', pct:'95%' },
          { kind:'over',  t:'1:00', w:'329W', hr:'175', pct:'112%' },
          { kind:'under', t:'1:00', w:'282W', hr:'174', pct:'95%' },
          { kind:'over',  t:'1:00', w:'328W', hr:'176', pct:'111%' },
        ] },
      { n:5, name:'Przerwa / zjazd', type:'Z1', tc:'#9AA0AB', w:'44W', hr:'126 bpm', time:'5:00', km:'3.5', kmLbl:'km' },
      { n:6, name:'Blok 3 · Over-Under', type:'OVER-UNDER', tc:'#C99A4E', w:'304W', hr:'169 bpm', time:'12:02', km:'+194m', kmLbl:'D+',
        sub:[
          { kind:'under', t:'3:00', w:'282W', hr:'157', pct:'95%' },
          { kind:'over',  t:'1:00', w:'327W', hr:'171', pct:'111%' },
          { kind:'under', t:'3:02', w:'278W', hr:'171', pct:'94%' },
          { kind:'over',  t:'1:00', w:'328W', hr:'175', pct:'111%' },
          { kind:'under', t:'3:00', w:'282W', hr:'174', pct:'95%' },
          { kind:'over',  t:'1:00', w:'329W', hr:'177', pct:'112%' },
        ] },
      { n:7, name:'Powrót / Z2', type:'Z2', tc:'#4A8FC7', w:'147W', hr:'129 bpm', time:'65:14', km:'29.5', kmLbl:'km' },
    ],
    segments: [
      { name:'Droga Sudecka Climb',          meta:'1.5 km · +93m · 4:50 · HR 173',  w:'299W', pct:'101% FTP 🥇PR', c:'#C76B6B' },
      { name:'Karkonoska 56 Climb',          meta:'1.1 km · +94m · 3:37 · HR 170',  w:'294W', pct:'100% FTP',     c:'#C76B6B' },
      { name:'Tramwaj Podgórzyn–Borowice',   meta:'3.0 km · +204m · 10:06 · HR 169', w:'296W', pct:'100% FTP',    c:'#C76B6B' },
      { name:'Karkonoski PIT STOP–rozjazd',  meta:'3.8 km · +208m · 12:17 · HR 165', w:'289W', pct:'98% FTP',     c:'#C99A4E' },
    ],
    stats: [
      { v:'60.6', l:'km', c:'#4A8FC7' }, { v:'996', l:'m wzniesień', c:'#5B9B7E' },
      { v:'112', l:'TSS', c:'#C99A4E' }, { v:'2:16', l:'czas', c:'#C76B6B' },
    ],
    prBanner: <><strong style={{ color:'#C99A4E' }}>5 PR na segmentach</strong> — w tym złoto na Drodze Sudeckiej (299W). Próg rośnie: 10min na 100% FTP. Mocny blok pod Winterberg.</>,
    aiPrompt: `Jesteś trenerem AI VeloIQ. Analiza treningu Adriana (Over-Under, 60.6km, 996m, TSS 112). FTP ${FTP}W. Sesja: 3 bloki, każdy 3× (3min @ ~281W / 95% FTP "under" + 1min @ ~329W / 111% FTP "over"). Best 10min 295W = równo 100% FTP. To trening pod jego SŁABOŚĆ (próg 20-60min). Napisz 2-3 zdania PO POLSKU: oceń jakość bloków, podkreśl że próg rośnie, wskaż regenerację jutro. Mów do Adriana (Ty), z liczbami.`,
    aiFallback: 'Mocne 3 bloki Over-Under — czyste 281W w „under" i pełne surge 329W w „over", HR równo rosło do 177 w trzecim bloku, czyli dobrze kontrolowane zmęczenie. Najważniejsze: 10min 295W = równo 100% FTP. Jutro lekko Z1/OFF — ATL skoczył do 64, daj nogom regenerację.',
    plan: { ok:'✓ Mocny trening wykonany zgodnie z planem', rows:[['Planowany typ','Threshold 3×15min',null],['Wykonany typ','3× Over-Under','#C99A4E'],['Planowane TSS','95',null],['Wykonane TSS','112 (+17)','#C99A4E'],['Śr. moc bloków','~302W (102% FTP)','#5B9B7E'],['10 min best','295W — równo próg!','#5B9B7E']],
      next:'Mocny bodziec progowy — ATL skoczył do 64, TSB na −1. Jutro Z1 regeneracja lub OFF. Kluczowy sygnał: 10min 295W = 100% FTP — Twój próg realnie rośnie.' },
  },
  // ── Wtorek 16.06 · Sweet Spot góry ──
  '2026-06-16': {
    title: 'Sweet Spot góry', dateLabel: 'Wtorek · 16 czerwca 2026 · 17:19',
    fff: {
      fit:  { val:60,  bar:60, trend:'↑ +1',  sub:'po sesji',     tc:'#5B9B7E', spark:[54,56,58,59,60] },
      form: { val:'+4', bar:54, trend:'↓ -4',  sub:'lekko zmęcz.', tc:'#9AA0AB', spark:[14,12,9,7,4] },
      fat:  { val:51,  bar:51, trend:'↑ +6',   sub:'po podjazdach', tc:'#C99A4E', spark:[42,44,46,49,51] },
    },
    efforts: [
      { d:'5 sek',      w:'632 W', pct:'214% FTP',           bar:100, c:'#C76B6B' },
      { d:'1 min',      w:'460 W', pct:'156% FTP',           bar:73,  c:'#C77E5E' },
      { d:'5 min',      w:'277 W', pct:'94% FTP · sweet spot', bar:44, c:'#C99A4E' },
      { d:'20 min',     w:'270 W', pct:'92% FTP',            bar:43,  c:'#C99A4E' },
      { d:'Avg całość', w:'193 W', pct:'65% FTP · IF ~0.70', bar:43,  c:'#4A8FC7' },
      { d:'HR avg / max', w:'139/183', pct:'74% / 97% HRmax', bar:74, c:'#C76B6B', hr:true, hrVal:'139/183' },
    ],
    laps: [
      { n:1, name:'Rozgrzewka / dojazd',    type:'Z2', tc:'#5B8FB8', w:'153W', hr:'115 bpm', time:'24:05', km:'10.7', kmLbl:'km' },
      { n:2, name:'Podjazd Sosnówka #1',    type:'SWEET SPOT', tc:'#C99A4E', w:'263W', hr:'158 bpm', time:'20:01', km:'+305m', kmLbl:'D+' },
      { n:3, name:'Zjazd / transfer',       type:'Z1', tc:'#9AA0AB', w:'40W', hr:'124 bpm', time:'5:17', km:'3.6', kmLbl:'km' },
      { n:4, name:'Podjazd Sosnówka #2',    type:'SWEET SPOT', tc:'#C99A4E', w:'271W', hr:'160 bpm', time:'20:00', km:'+311m', kmLbl:'D+' },
      { n:5, name:'Powrót / Z2',            type:'Z2', tc:'#4A8FC7', w:'159W', hr:'133 bpm', time:'40:44', km:'20.5', kmLbl:'km' },
    ],
    segments: [
      { name:'Przewodników Górskich Climb', meta:'3.6 km · +197m · 13:38 · HR 160', w:'257W', pct:'87% FTP',        c:'#C99A4E' },
      { name:'Liczyrzepy 1km KOM',          meta:'1.1 km · +99m · 4:14 · HR 162',   w:'277W', pct:'94% FTP 🥉PR',   c:'#C76B6B' },
      { name:'ORLINEK (od „grawitacji")',   meta:'0.8 km · +24m · 1:29 · HR 176',   w:'415W', pct:'141% FTP · peak', c:'#C76B6B' },
      { name:'UP Muflonowa',                meta:'3.2 km · +192m · 12:11 · HR 162', w:'266W', pct:'90% FTP 🥉PR',   c:'#C76B6B' },
    ],
    stats: [
      { v:'45.0', l:'km', c:'#4A8FC7' }, { v:'881', l:'m wzniesień', c:'#5B9B7E' },
      { v:'93', l:'TSS', c:'#C99A4E' }, { v:'1:47', l:'czas', c:'#C76B6B' },
    ],
    prBanner: <><strong style={{ color:'#C99A4E' }}>10 PR na segmentach</strong> — 3× złoto, 1× srebro, 6× brąz. Orlinek 415W peak. Dwa solidne podjazdy Sweet Spot 263–271W.</>,
    aiPrompt: `Jesteś trenerem AI VeloIQ. Analiza jazdy Adriana (Sweet Spot góry, 45km, 881m, TSS 93). FTP ${FTP}W. Dwa podjazdy 20min @ 263W i 271W (89-92% FTP, sweet spot). 10 PR segmentowych (3 złote). Orlinek 415W peak. Napisz 2-3 zdania PO POLSKU: oceń jakość podjazdów sweet spot, podkreśl PR-y, wskaż następny krok. Mów do Adriana (Ty), z liczbami.`,
    aiFallback: 'Dwa solidne podjazdy Sweet Spot — 263W i 271W przez 20min każdy (89–92% FTP). To dokładnie zakres budujący wytrzymałość progową bez nadmiernego kosztu. 10 PR-ów segmentowych, w tym złoto, pokazuje że nogi są w formie. Orlinek 415W peak to mocny sprint. Dobry bodziec — jutro spokojniej.',
    plan: { ok:'✓ Sesja zgodna z planem Sweet Spot', rows:[['Planowany typ','Sweet Spot 2×20min',null],['Wykonany typ','2× Sweet Spot góry','#C99A4E'],['Planowane TSS','90',null],['Wykonane TSS','93 (+3)','#C99A4E'],['Śr. moc podjazdów','263–271W (89–92%)','#5B9B7E'],['20 min best','270W — sweet spot','#C99A4E']],
      next:'Dobra jazda, dokładnie według planu. Jutro spokojnie, w czwartek mocniejszy trening. Te dwa długie podjazdy budują dokładnie to, czego Ci brakuje — tak trzymaj.' },
  },

  // ── Sobota 06.06 · GWS Jakuszyce (WYŚCIG KLUCZOWY) ──
  '2026-06-06': {
    isRace: true,
    title: 'UCI Gravel WS · Jakuszyce', dateLabel: 'Sobota · 6 czerwca 2026 · 09:00 · 129 km',
    fff: {
      fit:  { val:58,  bar:58, trend:'↑ +5',  sub:'po starcie',     tc:'#5B9B7E', spark:[50,52,54,56,58] },
      form: { val:'−18', bar:22, trend:'↓ -22', sub:'głęboko zmęcz.', tc:'#C76B6B', spark:[8,2,-6,-13,-18] },
      fat:  { val:81,  bar:81, trend:'↑ +33', sub:'maks. obciążenie', tc:'#C76B6B', spark:[48,55,64,73,81] },
    },
    efforts: [
      { d:'5 sek',      w:'698 W', pct:'237% FTP',              bar:100, c:'#C76B6B' },
      { d:'1 min',      w:'345 W', pct:'117% FTP',              bar:69,  c:'#C77E5E' },
      { d:'5 min',      w:'306 W', pct:'104% FTP · mocny',      bar:61,  c:'#5B9B7E' },
      { d:'20 min',     w:'263 W', pct:'89% FTP · spadek',      bar:53,  c:'#C99A4E' },
      { d:'1 godz.',    w:'214 W', pct:'73% FTP · rozpad',      bar:43,  c:'#C76B6B' },
      { d:'Avg całość', w:'182 W', pct:'62% FTP · IF ~0.74',    bar:37,  c:'#4A8FC7' },
    ],
    // Rozpad mocy godzina-po-godzinie — KLUCZOWY dowód słabości
    powerDecay: [
      { h:'1h', np:248, pct:84, hr:158, label:'0–35 km' },
      { h:'2h', np:241, pct:82, hr:162, label:'35–68 km' },
      { h:'3h', np:212, pct:72, hr:166, label:'68–98 km' },
      { h:'4h', np:198, pct:67, hr:168, label:'98–129 km' },
    ],
    laps: [
      { n:1, name:'Start + płaskie',        type:'Z3', tc:'#5B8FB8', w:'248W', hr:'158 bpm', time:'1:01:00', km:'35.0', kmLbl:'km' },
      { n:2, name:'Sekcja środkowa',        type:'SWEET SPOT', tc:'#C99A4E', w:'241W', hr:'162 bpm', time:'1:00:00', km:'33.0', kmLbl:'km' },
      { n:3, name:'Główne podjazdy (3h)',   type:'THRESHOLD', tc:'#C76B6B', w:'212W', hr:'166 bpm', time:'1:00:00', km:'30.0', kmLbl:'km' },
      { n:4, name:'Finisz — rozpad mocy',   type:'Z3', tc:'#C76B6B', w:'198W', hr:'168 bpm', time:'1:23:00', km:'31.3', kmLbl:'km' },
    ],
    segments: [
      { name:'Szklarska Poręba KOM',     meta:'4.2 km · +280m · 14:20 · HR 169', w:'274W', pct:'93% FTP', c:'#C99A4E' },
      { name:'Jakuszyce Pass climb',     meta:'5.8 km · +310m · 19:40 · HR 165', w:'251W', pct:'85% FTP · spadek', c:'#C76B6B' },
      { name:'Finiszowy podjazd (km 110)', meta:'2.9 km · +160m · 11:50 · HR 167', w:'228W', pct:'77% FTP · rozpad', c:'#C76B6B' },
    ],
    stats: [
      { v:'129.3', l:'km', c:'#4A8FC7' }, { v:'2549', l:'m wzniesień', c:'#5B9B7E' },
      { v:'589', l:'TSS', c:'#C99A4E' }, { v:'5:23', l:'czas', c:'#C76B6B' },
    ],
    prBanner: <><strong style={{ color:'#C76B6B' }}>Diagnoza wyścigowa</strong> — moc spadła z 248W (1h) do 198W (4h): −20% w trzeciej i czwartej godzinie. Klasyczny rozpad progu u puncheura.</>,
    // Diagnoza słabości — wyliczona z powerDecay
    diagnosis: {
      headline: 'Próg rozpadł się po 2. godzinie',
      drop: '−20%',
      detail: 'NP spadła z 248W (1h, 84% FTP) do 212W (3h) i 198W (4h, 67% FTP). Twoje 5min = 306W (104%), ale 1h = 214W (73%) — typowy profil puncheura: mocne krótkie efekty, słaba wytrzymałość progowa w długim wyścigu.',
      target: 'Wytrzymałość progowa 60–90 min (muscular endurance), nie kolejne 4-min interwały.',
    },
    aiPrompt: `Jesteś trenerem AI VeloIQ. Analiza WYŚCIGU Adriana: UCI Gravel WS Jakuszyce, 129km, 2549m, 5h23, TSS 589, FTP ${FTP}W. KLUCZOWE: rozpad mocy godzina-po-godzinie — NP 1h: 248W (84%), 2h: 241W (82%), 3h: 212W (72%), 4h: 198W (67%). Best efforty: 5min 306W (104%), 20min 263W (89%), 1h 214W (73%). To puncheur z rozpadającym się progiem w długim wyścigu. Napisz 2-3 zdania PO POLSKU: nazwij problem (rozpad progu po 2h), połącz z profilem puncheura, wskaż kierunek bloku (wytrzymałość progowa 60-90min zamiast 4-min interwałów). Mów do Adriana (Ty), z liczbami, bez żargonu.`,
    aiFallback: 'Pierwsze dwie godziny trzymałeś próg dobrze (248W, 241W — 82–84% FTP), ale w trzeciej godzinie moc spadła do 212W, a w czwartej do 198W (67%). To nie kwestia świeżości — to wytrzymałość progowa. Twoje 5min 306W jest mocne, ale 1h tylko 214W: klasyczny puncheur, któremu rozpada się próg w długim wyścigu. Najbliższe tygodnie przebudowuję pod muscular endurance: długie interwały progowe 2×20–3×20min, mniej 4-min akcentów.',
    plan: { ok:'⚠ Wyścig ujawnił słabość — przebudowa bloku', rows:[['Dystans','129 km · 2549 m',null],['Czas','5:23:00','#C76B6B'],['NP 1h / 4h','248W → 198W','#C76B6B'],['Spadek progu','−20% po 2h','#C76B6B'],['5min best','306W (104%)','#5B9B7E'],['1h best','214W (73%)','#C99A4E']],
      next:'Wyścig pokazał dokładnie to, co podejrzewaliśmy: próg pada po dwóch godzinach. Najbliższe tygodnie przestawiam z 4-min akcentów na długie interwały progowe — patrz przebudowa bloku niżej.' },
    // Przebudowa bloku — diff stary → nowy profil pod wytrzymałość progową
    blockRebuild: {
      reason: 'Próg rozpadł się po 2h (−20%). Przestawiam blok z krótkich akcentów VO2/4-min na długie interwały progowe (muscular endurance).',
      summary: { oldThr: '2 sesje progowe / tydz.', newThr: '3 sesje progowe / tydz.', oldFocus: 'VO2max + 4-min', newFocus: 'Próg 20-min + tempo długie' },
      changes: [
        { date: '23.06', day: 'Wt', old: { type:'THR', label:'Threshold 3×15min', tss:100 }, new: { type:'THR', label:'Threshold 2×20min', tss:105 }, why:'Wydłużam interwał z 15 do 20 min — bliżej wymagań wyścigu' },
        { date: '26.06', day: 'Pt', old: { type:'OU', label:'Over-Under', tss:115 }, new: { type:'THR', label:'Threshold 3×20min', tss:120 }, why:'Zamieniam O/U na czysty próg — buduje wytrzymałość, nie szczyt VO2' },
        { date: '27.06', day: 'So', old: { type:'LONG', label:'Long gravel', tss:195 }, new: { type:'LONG', label:'Long + 2×30min tempo', tss:210 }, why:'Dokładam bloki tempa w 3-4h jazdy — trenuje próg pod zmęczeniem' },
        { date: '30.06', day: 'Wt', old: { type:'THR', label:'Threshold', tss:95 }, new: { type:'THR', label:'Threshold 4×12min', tss:108 }, why:'Większa objętość przy progu zamiast krótkich akcentów' },
        { date: '04.07', day: 'So', old: { type:'OU', label:'Over-Under', tss:120 }, new: { type:'SST', label:'Sweet Spot 3×25min', tss:125 }, why:'Długie sweet-spot — fundament wytrzymałości progowej' },
      ],
    },
  },
};

function RideAnalysis({ act, onClose }) {
  const R = RIDE_DATA[act?.date] || RIDE_DATA['2026-06-18'];
  const rideFFF = R.fff, rideEfforts = R.efforts, rideLaps = R.laps, rideSegments = R.segments, rideStats = R.stats;
  const [aiInsight, setAiInsight] = useState('');
  const [aiLoad, setAiLoad] = useState(false);
  const [openLaps, setOpenLaps] = useState({});
  const toggleLap = n => setOpenLaps(p => ({ ...p, [n]: !p[n] }));

  // ── Stan wyścigowy: przebudowa bloku ──
  const isRace = !!R.isRace;
  const [blockApplied, setBlockApplied] = useState(false);

  async function genInsight() {
    setAiLoad(true);
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:400, messages:[{ role:'user', content:R.aiPrompt }] })
      });
      const d = await r.json();
      setAiInsight(d.content?.[0]?.text || '');
    } catch {
      setAiInsight(R.aiFallback);
    } finally { setAiLoad(false); }
  }
  useEffect(()=>{ genInsight(); }, []);

  const lapTypeBg = { 'Z2':'rgba(74,143,199,0.12)', 'SWEET SPOT':'rgba(201,154,78,0.15)', 'Z1':'rgba(154,160,171,0.12)', 'THRESHOLD':'rgba(199,107,107,0.15)', 'OVER-UNDER':'rgba(201,154,78,0.15)', 'VO2MAX':'rgba(199,107,107,0.15)' };

  return (
    <div style={{ position:'fixed', inset:0, zIndex:100, background:C.bg, overflowY:'auto', color:'#EDEFF2' }}>
      {/* Sticky header z przyciskiem zamknięcia */}
      <div style={{ position:'sticky', top:0, zIndex:2, background:'rgba(6,8,10,0.9)', backdropFilter:'blur(16px)', borderBottom:`1px solid ${C.border}`, padding:'12px 18px', display:'flex', alignItems:'center', gap:12 }}>
        <button onClick={onClose} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:9, cursor:'pointer', padding:7, display:'flex' }}><Icon name="close" size={18} color={C.muted} /></button>
        <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.18em', color:C.cyan }}>VELOIQ · {isRace ? 'ANALIZA WYŚCIGU' : 'ANALIZA JAZDY'}</div>
      </div>

      <div style={{ maxWidth:560, margin:'0 auto', padding:'20px 16px 48px' }}>

        {/* Nagłówek jazdy */}
        <div style={{ marginBottom:20 }}>
          {isRace && <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
            <span style={{ display:'inline-block', fontSize:9, fontWeight:700, letterSpacing:'1.5px', color:C.red, background:'rgba(199,107,107,0.12)', border:'1px solid rgba(199,107,107,0.3)', borderRadius:6, padding:'3px 8px', textTransform:'uppercase' }}>● Wyścig kluczowy</span>
            <span style={{ fontSize:10, color:C.muted }}>↻ dane ze Stravy</span>
          </div>}
          <h1 style={{ fontSize:20, fontWeight:600, color:'#fff', marginBottom:2 }}>{R.title}</h1>
          <div style={{ fontSize:12, color:'#9AA0AB' }}>{R.dateLabel}</div>
        </div>

        {/* FFF — Fitness / Form / Fatigue */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8, marginBottom:12 }}>
          {[
            { k:'fit',  lbl:'Fitness',    vc:C.cyan,  sc:'74,143,199', d:rideFFF.fit },
            { k:'form', lbl:'Form (TSB)', vc:C.green, sc:'91,155,126', d:rideFFF.form },
            { k:'fat',  lbl:'Fatigue',    vc:C.yellow, sc:'201,154,78', d:rideFFF.fat },
          ].map(c=>(
            <div key={c.k} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:'12px 10px', position:'relative', overflow:'hidden' }}>
              <div style={{ fontSize:9, fontWeight:500, letterSpacing:'1.5px', color:C.muted, textTransform:'uppercase', marginBottom:4 }}>{c.lbl}</div>
              <div style={{ fontSize:32, fontWeight:500, lineHeight:1, marginBottom:6, color:c.vc }}>{c.d.val}</div>
              <div style={{ height:3, background:C.border, borderRadius:2, marginBottom:5 }}>
                <div style={{ height:3, borderRadius:2, width:`${c.d.bar}%`, background:c.vc }} />
              </div>
              <div style={{ display:'flex', alignItems:'flex-end', gap:2, height:18, marginBottom:5 }}>
                {c.d.spark.map((h,i)=>(
                  <span key={i} style={{ flex:1, borderRadius:1, height:`${h}%`, background: i===c.d.spark.length-1 ? c.vc : `rgba(${c.sc},${0.3+i*0.04})` }} />
                ))}
              </div>
              <div style={{ fontSize:10, fontWeight:500, color:c.d.tc }}>{c.d.trend} <span style={{ fontSize:9, color:C.muted }}>{c.d.sub}</span></div>
              <div style={{ position:'absolute', bottom:0, left:0, right:0, height:2, background:c.vc, opacity:0.5 }} />
            </div>
          ))}
        </div>

        {/* AI Insight */}
        <div style={{ background:`${C.cyan}12`, border:`1px solid ${C.cyan}30`, borderRadius:10, padding:'12px 14px', marginBottom:16, display:'flex', gap:10, alignItems:'flex-start' }}>
          <div style={{ fontSize:18, flexShrink:0, marginTop:1 }}>🤖</div>
          <div>
            <div style={{ fontSize:9, fontWeight:600, color:C.cyan, letterSpacing:'1px', textTransform:'uppercase', marginBottom:3 }}>AI Insight</div>
            {aiLoad
              ? <p style={{ fontSize:12, color:'#9AA0AB', fontStyle:'italic', lineHeight:1.6 }}>Analizuję jazdę...</p>
              : <p style={{ fontSize:12, color:'#C2C7CF', lineHeight:1.6 }}>{aiInsight}</p>}
          </div>
        </div>

        {/* Główne statystyki */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, marginBottom:16 }}>
          {rideStats.map(s=>(
            <div key={s.l} style={{ background:'#1A1D23', border:'1px solid #262A31', borderRadius:10, padding:'12px 8px', textAlign:'center' }}>
              <div style={{ fontSize:18, fontWeight:600, marginBottom:2, color:s.c }}>{s.v}</div>
              <div style={{ fontSize:9, color:'#9AA0AB', textTransform:'uppercase', letterSpacing:'1px' }}>{s.l}</div>
            </div>
          ))}
        </div>

        {/* PR Banner */}
        <div style={{ background:'rgba(201,154,78,0.08)', border:'1px solid rgba(201,154,78,0.25)', borderRadius:10, padding:'10px 14px', marginBottom:16, display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ fontSize:20 }}>🏆</div>
          <div style={{ fontSize:12, color:'#EDEFF2', lineHeight:1.5 }}>{R.prBanner}</div>
        </div>

        {/* Profil mocy · best efforts */}
        <div style={{ fontSize:10, fontWeight:600, letterSpacing:'2px', color:C.cyan, textTransform:'uppercase', marginBottom:10 }}>Profil mocy · best efforts</div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:8, marginBottom:16 }}>
          {rideEfforts.map(e=>(
            <div key={e.d} style={{ background:'#1A1D23', border:'1px solid #262A31', borderRadius:10, padding:12 }}>
              <div style={{ fontSize:9, color:'#9AA0AB', marginBottom:4, textTransform:'uppercase', letterSpacing:'1px' }}>{e.d}</div>
              <div style={{ fontSize:22, fontWeight:600, marginBottom:4, color:e.c }}>
                {e.hr ? <>{e.hrVal.split('/')[0]}<span style={{ fontSize:14, color:'#9AA0AB' }}>/{e.hrVal.split('/')[1]}</span></> : e.w}
              </div>
              <div style={{ fontSize:10, color:'#9AA0AB' }}>{e.pct}</div>
              <div style={{ height:4, background:'#262A31', borderRadius:2, marginTop:6 }}>
                <div style={{ height:4, borderRadius:2, width:`${e.bar}%`, background:e.c }} />
              </div>
            </div>
          ))}
        </div>

        {/* Struktura sesji · okrążenia */}
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:10 }}>
          <div style={{ fontSize:10, fontWeight:600, letterSpacing:'2px', color:C.cyan, textTransform:'uppercase' }}>Struktura sesji · okrążenia</div>
          <div style={{ fontSize:9, color:'#9AA0AB' }}>3 bloki Over-Under · dotknij, by rozwinąć</div>
        </div>
        {rideLaps.map(l=>{
          const open = !!openLaps[l.n];
          const hasSub = l.sub && l.sub.length;
          return (
            <div key={l.n} style={{ background:'#1A1D23', border:`1px solid ${open?l.tc+'55':'#262A31'}`, borderRadius:10, padding:14, marginBottom:8, transition:'border-color 0.15s' }}>
              <div onClick={hasSub?()=>toggleLap(l.n):undefined} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:8, cursor:hasSub?'pointer':'default' }}>
                <div style={{ width:24, height:24, borderRadius:'50%', display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:600, flexShrink:0, background:`${l.tc}22`, color:l.tc }}>{l.n}</div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:600, color:'#fff' }}>{l.name}</div>
                  {hasSub && <div style={{ fontSize:10, color:'#9AA0AB', marginTop:1 }}>3× (3min under + 1min over)</div>}
                </div>
                <div style={{ fontSize:9, fontWeight:600, padding:'2px 8px', borderRadius:4, background:lapTypeBg[l.type]||'rgba(201,154,78,0.15)', color:l.tc }}>{l.type}</div>
                {hasSub && <div style={{ fontSize:14, color:'#9AA0AB', transform:open?'rotate(90deg)':'none', transition:'transform 0.15s' }}>›</div>}
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:6 }}>
                <div><div style={{ fontSize:9, color:'#9AA0AB', marginBottom:2 }}>{hasSub?'Śr. moc':'Moc'}</div><div style={{ fontSize:13, fontWeight:600, color:l.tc }}>{l.w}</div></div>
                <div><div style={{ fontSize:9, color:'#9AA0AB', marginBottom:2 }}>HR</div><div style={{ fontSize:13, fontWeight:600 }}>{l.hr}</div></div>
                <div><div style={{ fontSize:9, color:'#9AA0AB', marginBottom:2 }}>Czas</div><div style={{ fontSize:13, fontWeight:600 }}>{l.time}</div></div>
                <div><div style={{ fontSize:9, color:'#9AA0AB', marginBottom:2 }}>{l.kmLbl}</div><div style={{ fontSize:13, fontWeight:600 }}>{l.km}</div></div>
              </div>
              {/* rozwinięte interwały */}
              {hasSub && open && (
                <div style={{ marginTop:10, paddingTop:10, borderTop:'1px solid #262A31' }}>
                  {l.sub.map((iv,idx)=>{
                    const isOver = iv.kind==='over';
                    const c = isOver ? '#C76B6B' : '#C99A4E';
                    return (
                      <div key={idx} style={{ display:'flex', alignItems:'center', gap:8, padding:'6px 0', borderBottom: idx<l.sub.length-1?'1px solid #21252C':'none' }}>
                        <div style={{ width:6, height:6, borderRadius:'50%', background:c, flexShrink:0 }} />
                        <div style={{ width:50, fontSize:11, fontWeight:600, color:c, textTransform:'uppercase' }}>{isOver?'Over':'Under'}</div>
                        <div style={{ flex:1, fontSize:11, color:'#9AA0AB' }}>{iv.t}</div>
                        <div style={{ width:48, textAlign:'right', fontSize:12, fontWeight:600, color:'#EDEFF2' }}>{iv.w}</div>
                        <div style={{ width:42, textAlign:'right', fontSize:10, color:c, fontWeight:600 }}>{iv.pct}</div>
                        <div style={{ width:42, textAlign:'right', fontSize:10, color:'#9AA0AB' }}>{iv.hr}♥</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

        {/* Kluczowe podjazdy */}
        <div style={{ fontSize:10, fontWeight:600, letterSpacing:'2px', color:C.cyan, textTransform:'uppercase', margin:'16px 0 10px' }}>Kluczowe podjazdy</div>
        {rideSegments.map((s,i)=>(
          <div key={i} style={{ background:'#1A1D23', border:'1px solid #262A31', borderRadius:10, padding:'12px 14px', marginBottom:8, display:'flex', alignItems:'center', gap:12 }}>
            <div style={{ fontSize:14, flexShrink:0 }}>{s.pct.includes('peak')?'🔥':'⛰️'}</div>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:12, fontWeight:600, color:'#fff', marginBottom:2 }}>{s.name}</div>
              <div style={{ fontSize:11, color:'#9AA0AB' }}>{s.meta}</div>
            </div>
            <div style={{ textAlign:'right', flexShrink:0 }}>
              <div style={{ fontSize:16, fontWeight:600, color:s.c }}>{s.w}</div>
              <div style={{ fontSize:9, color:'#9AA0AB' }}>{s.pct}</div>
            </div>
          </div>
        ))}

        {/* Realizacja planu */}
        <div style={{ fontSize:10, fontWeight:600, letterSpacing:'2px', color:C.cyan, textTransform:'uppercase', margin:'16px 0 10px' }}>Realizacja planu</div>
        <div style={{ background:'rgba(91,155,126,0.05)', border:'1px solid rgba(91,155,126,0.2)', borderRadius:10, padding:14, marginBottom:16 }}>
          <div style={{ fontSize:9, fontWeight:600, textTransform:'uppercase', letterSpacing:'1px', marginBottom:8, color:C.green }}>{R.plan.ok}</div>
          {R.plan.rows.map(([k,v,c])=>(
            <div key={k} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6, fontSize:12, color:'#9AA0AB' }}>
              <span>{k}</span><span style={{ fontWeight:600, color:c||'#EDEFF2' }}>{v}</span>
            </div>
          ))}
        </div>

        {/* ══════════ SEKCJE WYŚCIGOWE (tylko isRace) ══════════ */}
        {isRace && R.powerDecay && (
          <>
            {/* Wykres rozpadu mocy godzina-po-godzinie */}
            <div style={{ fontSize:10, fontWeight:600, letterSpacing:'2px', color:C.red, textTransform:'uppercase', margin:'22px 0 4px' }}>Rozpad mocy w czasie</div>
            <div style={{ fontSize:11, color:C.muted, marginBottom:12 }}>Moc znormalizowana (NP) w kolejnych godzinach wyścigu — % FTP</div>
            <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:'18px 16px 14px', marginBottom:8 }}>
              <div style={{ display:'flex', alignItems:'flex-end', gap:10, height:150, marginBottom:10 }}>
                {R.powerDecay.map((p,i)=>{
                  const h = Math.max(8, (p.pct/100)*100);
                  const dropped = p.pct < 78;
                  const bc = dropped ? C.red : p.pct < 84 ? C.yellow : C.cyan;
                  return (
                    <div key={i} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'flex-end', height:'100%' }}>
                      <div style={{ fontSize:13, fontWeight:700, color:bc, marginBottom:4 }}>{p.np}W</div>
                      <div style={{ width:'100%', height:`${h}%`, background:`linear-gradient(180deg, ${bc} 0%, ${bc}99 100%)`, borderRadius:'6px 6px 0 0', position:'relative', minHeight:8 }}>
                        <div style={{ position:'absolute', bottom:4, left:0, right:0, textAlign:'center', fontSize:10, fontWeight:700, color:'rgba(255,255,255,0.9)' }}>{p.pct}%</div>
                      </div>
                      <div style={{ fontSize:11, fontWeight:600, color:'#EDEFF2', marginTop:6 }}>{p.h}</div>
                      <div style={{ fontSize:9, color:C.muted }}>{p.label}</div>
                    </div>
                  );
                })}
              </div>
              {/* linia odniesienia FTP */}
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:C.muted, borderTop:`1px solid ${C.border}`, paddingTop:8 }}>
                <span>HR ↑ rośnie (decoupling)</span>
                <span style={{ color:C.red, fontWeight:600 }}>Spadek {R.diagnosis.drop} po 2h</span>
              </div>
            </div>

            {/* Diagnoza AI */}
            <div style={{ background:'rgba(199,107,107,0.06)', border:'1px solid rgba(199,107,107,0.25)', borderRadius:12, padding:'14px 16px', marginBottom:8, marginTop:8 }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                <div style={{ fontSize:18 }}>🔍</div>
                <div style={{ fontSize:10, fontWeight:700, color:C.red, letterSpacing:'1px', textTransform:'uppercase' }}>Diagnoza wyścigowa</div>
              </div>
              <div style={{ fontSize:15, fontWeight:600, color:'#fff', marginBottom:6 }}>{R.diagnosis.headline}</div>
              <p style={{ fontSize:12, color:'#C2C7CF', lineHeight:1.6, marginBottom:10 }}>{R.diagnosis.detail}</p>
              <div style={{ background:'rgba(91,155,126,0.08)', border:'1px solid rgba(91,155,126,0.2)', borderRadius:8, padding:'8px 12px', display:'flex', gap:8, alignItems:'flex-start' }}>
                <span style={{ fontSize:12, color:C.green, fontWeight:700, flexShrink:0 }}>→ Cel:</span>
                <span style={{ fontSize:12, color:'#C2C7CF', lineHeight:1.5 }}>{R.diagnosis.target}</span>
              </div>
            </div>

            {/* Przebudowa bloku treningowego */}
            <div style={{ fontSize:10, fontWeight:600, letterSpacing:'2px', color:C.cyan, textTransform:'uppercase', margin:'22px 0 4px' }}>Przebudowa bloku treningowego</div>
            <div style={{ fontSize:11, color:C.muted, marginBottom:12, lineHeight:1.5 }}>{R.blockRebuild.reason}</div>

            {/* Podsumowanie zmiany kierunku */}
            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8, marginBottom:12 }}>
              <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:'10px 12px' }}>
                <div style={{ fontSize:9, color:C.muted, textTransform:'uppercase', letterSpacing:'1px', marginBottom:6 }}>Było</div>
                <div style={{ fontSize:12, color:'#9AA0AB', marginBottom:3 }}>{R.blockRebuild.summary.oldThr}</div>
                <div style={{ fontSize:11, color:C.muted }}>{R.blockRebuild.summary.oldFocus}</div>
              </div>
              <div style={{ background:'rgba(74,143,199,0.06)', border:`1px solid ${C.cyan}40`, borderRadius:10, padding:'10px 12px' }}>
                <div style={{ fontSize:9, color:C.cyan, textTransform:'uppercase', letterSpacing:'1px', marginBottom:6 }}>Będzie</div>
                <div style={{ fontSize:12, color:'#EDEFF2', fontWeight:600, marginBottom:3 }}>{R.blockRebuild.summary.newThr}</div>
                <div style={{ fontSize:11, color:C.cyan }}>{R.blockRebuild.summary.newFocus}</div>
              </div>
            </div>

            {/* Diff dni: stary → nowy */}
            {R.blockRebuild.changes.map((ch,i)=>(
              <div key={i} style={{ background:C.card, border:`1px solid ${blockApplied?'rgba(91,155,126,0.3)':C.border}`, borderRadius:10, padding:'12px 14px', marginBottom:8 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                  <div style={{ fontSize:11, fontWeight:700, color:C.muted, width:48 }}>{ch.day} {ch.date}</div>
                  <div style={{ flex:1, display:'flex', alignItems:'center', gap:8 }}>
                    <span style={{ fontSize:11, color:'#9AA0AB', textDecoration: blockApplied?'line-through':'none', opacity: blockApplied?0.5:1 }}>{ch.old.label}</span>
                    <span style={{ fontSize:12, color:C.cyan }}>→</span>
                    <span style={{ fontSize:11, fontWeight:600, color: blockApplied?C.green:'#EDEFF2' }}>{ch.new.label}</span>
                  </div>
                  <div style={{ fontSize:10, color:C.muted, flexShrink:0 }}>
                    <span style={{ textDecoration: blockApplied?'line-through':'none', opacity:0.6 }}>{ch.old.tss}</span>
                    {' → '}
                    <span style={{ color: ch.new.tss>ch.old.tss?C.yellow:C.green, fontWeight:600 }}>{ch.new.tss}</span>
                  </div>
                </div>
                <div style={{ fontSize:11, color:C.muted, lineHeight:1.5, paddingLeft:56 }}>{ch.why}</div>
              </div>
            ))}

            {/* Przycisk akceptacji */}
            <button
              onClick={()=>setBlockApplied(true)}
              disabled={blockApplied}
              style={{
                width:'100%', marginTop:6, marginBottom:8, padding:'14px', borderRadius:11, border:'none',
                cursor: blockApplied?'default':'pointer', fontSize:13, fontWeight:700, letterSpacing:'0.3px',
                background: blockApplied?'rgba(91,155,126,0.15)':C.cyan,
                color: blockApplied?C.green:'#0A0C0F', transition:'all .2s',
              }}>
              {blockApplied ? '✓ Nowy profil zastosowany — plan zaktualizowany' : 'Zastosuj nowy profil treningowy →'}
            </button>
            {blockApplied && (
              <div style={{ fontSize:11, color:C.muted, textAlign:'center', marginBottom:8, lineHeight:1.5 }}>
                Zmiany naniesione na tygodnie 22.06–05.07. Statystyki planu (sesje, godziny, TSS) zostały przeliczone.
              </div>
            )}
          </>
        )}

        {/* Następny krok / Korekta planu na jutro */}
        <div style={{ background:'rgba(74,143,199,0.06)', border:'1px solid rgba(74,143,199,0.18)', borderRadius:10, padding:'12px 14px', display:'flex', gap:10, alignItems:'flex-start' }}>
          <div style={{ fontSize:18, flexShrink:0, marginTop:1 }}>📋</div>
          <div>
            <div style={{ fontSize:9, fontWeight:600, color:C.cyan, letterSpacing:'1px', textTransform:'uppercase', marginBottom:3 }}>Następny krok</div>
            <p style={{ fontSize:12, color:'#C2C7CF', lineHeight:1.6 }}>{R.plan.next}</p>
          </div>
        </div>

      </div>
    </div>
  );
}

// Zwraca dane wyświetlania kafla FTP zależnie od źródła (miernik / estymata / brak)
function ftpDisplay(src) {
  if (src === 'measured') {
    return { value: FTP, wkg: (FTP/MASS).toFixed(2), tag: '● zmierzone', tagColor: C.green, badge: 'Zawodnik', badgeSub: 'top 4% · VeloIQ', est: false };
  }
  if (src === 'estimated') {
    return { value: FTP_EST, wkg: (FTP_EST/MASS).toFixed(2), tag: 'szac. ze Stravy', tagColor: C.yellow, badge: 'Szacowane', badgeSub: 'podłącz miernik', est: true };
  }
  return { value: null, wkg: null, tag: 'brak danych', tagColor: C.muted, badge: 'Ustaw FTP', badgeSub: 'zrób test 20 min', est: false, empty: true };
}

function Dashboard({ ai, aiLoading }) {
  const lastAct = acts[acts.length-1];
  const [showRide, setShowRide] = useState(false);
  const [ftpSrc, setFtpSrc] = useState(FTP_SOURCE); // demo: przełącznik źródła FTP

  return (
    <>
      {showRide && <RideAnalysis act={lastAct} onClose={()=>setShowRide(false)} />}
      {/* Demo: przełącznik źródła FTP (w prawdziwej apce ustalane automatycznie z danych) */}
      <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8, fontSize:10, color:C.muted }}>
        <span style={{ letterSpacing:'0.08em' }}>DEMO · źródło FTP:</span>
        {[['measured','miernik'],['estimated','szac. Strava'],['none','brak']].map(([k,lbl])=>(
          <button key={k} onClick={()=>setFtpSrc(k)} style={{
            background: ftpSrc===k ? C.cyan+'22' : 'transparent', color: ftpSrc===k ? C.cyan : C.muted,
            border:`1px solid ${ftpSrc===k ? C.cyan+'55' : C.border}`, borderRadius:6, padding:'2px 8px',
            fontSize:10, fontWeight:600, cursor:'pointer',
          }}>{lbl}</button>
        ))}
      </div>
      {/* KEY METRICS: FTP + VO2max — z porównaniem do przeciętnych (styl Garmin) */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(260px, 1fr))', gap:10, marginBottom:10 }}>
        <div style={{ ...card, display:'flex', alignItems:'center', gap:14 }}>
          <div style={{ width:46, height:46, flexShrink:0, borderRadius:10, background:C.cyan+'1A', border:`1px solid ${C.cyan}44`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:22 }}>⚡</div>
          {(()=>{ const f = ftpDisplay(ftpSrc); return (
          <>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ fontSize:9, color:C.muted, letterSpacing:'0.12em', fontWeight:600 }}>FTP</span>
              <span style={{ fontSize:8, fontWeight:600, color:f.tagColor, background:f.tagColor+'1A', border:`1px solid ${f.tagColor}33`, borderRadius:4, padding:'1px 5px', whiteSpace:'nowrap' }}>{f.tag}</span>
            </div>
            {f.empty ? (
              <div style={{ fontSize:13, color:C.muted, marginTop:3 }}>Brak miernika i danych — <span style={{ color:C.cyan, fontWeight:600 }}>ustaw ręcznie</span></div>
            ) : (
              <div style={{ display:'flex', alignItems:'baseline', gap:5, whiteSpace:'nowrap' }}>
                <span style={{ fontSize:28, fontWeight:600, color: f.est?C.yellow:C.cyan }}>{f.est?'~':''}{f.value}</span>
                <span style={{ fontSize:12, color:C.muted }}>W · {f.wkg} W/kg</span>
              </div>
            )}
          </div>
          <div style={{ textAlign:'right', flexShrink:0 }}>
            <div style={{ fontSize:13, fontWeight:600, color: f.empty?C.cyan:(f.est?C.yellow:C.cyan), whiteSpace:'nowrap' }}>{f.badge}</div>
            <div style={{ fontSize:9, color:C.muted, whiteSpace:'nowrap' }}>{f.badgeSub}</div>
          </div>
          </>
          ); })()}
        </div>
        <div style={{ ...card, display:'flex', alignItems:'center', gap:14 }}>
          <div style={{ width:46, height:46, flexShrink:0, borderRadius:10, background:C.green+'1A', border:`1px solid ${C.green}44`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:22 }}>🫁</div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ fontSize:9, color:C.muted, letterSpacing:'0.12em', fontWeight:600 }}>PUŁAP TLENOWY</div>
            <div style={{ display:'flex', alignItems:'baseline', gap:5, whiteSpace:'nowrap' }}><span style={{ fontSize:28, fontWeight:600, color:C.green }}>{VO2MAX}</span><span style={{ fontSize:12, color:C.muted }}>ml/kg/min</span></div>
          </div>
          <div style={{ textAlign:'right', flexShrink:0 }}>
            <div style={{ fontSize:13, fontWeight:600, color:C.green, whiteSpace:'nowrap' }}>Doskonały</div>
            <div style={{ fontSize:9, color:C.muted, whiteSpace:'nowrap' }}>top 5% · M30</div>
          </div>
        </div>
      </div>

      {/* READINESS — WHOOP-style, replaces raw FFF cards */}
      <ReadinessModule />

      {/* AI INSIGHT */}
      <div style={{ ...card, marginBottom:10, borderLeft:`3px solid ${C.cyan}`, borderRadius:'0 12px 12px 0', paddingLeft:14 }}>
        <div style={{ fontSize:9, color:C.cyan, letterSpacing:'0.12em', fontWeight:600, marginBottom:7 }}>AI INSIGHT</div>
        {aiLoading ? <div style={{ color:C.muted, fontSize:13, fontStyle:'italic' }}>Analizuję dane Strava...</div> : <div style={{ fontSize:13, lineHeight:1.65 }}>{ai}</div>}
      </div>

      {/* LAST ACTIVITY — clickable → ride analysis */}
      <div onClick={()=>setShowRide(true)} style={{ ...card, marginBottom:10, cursor:'pointer', transition:'border-color 0.15s' }} onMouseEnter={e=>e.currentTarget.style.borderColor=C.cyan+'66'} onMouseLeave={e=>e.currentTarget.style.borderColor=C.border}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
          <span style={{ fontSize:9, color:C.muted, letterSpacing:'0.12em', fontWeight:600 }}>OSTATNIA AKTYWNOŚĆ</span>
          <span style={{ color:C.muted, fontSize:11 }}>czw. 18.06.2026</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10 }}>
          <SportBadge sport={lastAct.sport} />
          <span style={{ fontWeight:600, fontSize:15, flex:1 }}>{lastAct.name}</span>
          <span style={{ fontSize:11, color:C.cyan, fontWeight:600, display:'flex', alignItems:'center', gap:3 }}>Analiza <Icon name="chevR" size={13} color={C.cyan} /></span>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:10 }}>
          {[['DYSTANS',`${lastAct.dist} km`,C.cyan],['WZNIOSY',`${lastAct.ele} m`,C.text],['CZAS',fmtTime(lastAct.time),C.text],['OBCIĄŻENIE',`TSS ${lastAct.tss}`,C.yellow]].map(([l,v,c])=>(
            <div key={l}><div style={{ fontSize:8, color:C.muted, letterSpacing:'0.1em', fontWeight:600, marginBottom:2 }}>{l}</div><div style={{ fontSize:16, fontWeight:600, color:c }}>{v}</div></div>
          ))}
        </div>
      </div>

      {/* TWÓJ ROZWÓJ — progress / engagement module */}
      <Progress />
    </>
  );
}

// ─────────────── PROGRESS (engagement loop) ───────────────
function CompareBar({ label, unit, value, color, min, max, marks, verdict }) {
  const pct = Math.max(0, Math.min(100, (value - min) / (max - min) * 100));
  return (
    <div style={{ marginTop:14 }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8 }}>
        <span style={{ fontSize:10, color:C.muted, letterSpacing:'0.08em', fontWeight:600 }}>{label.toUpperCase()}</span>
        <span style={{ fontSize:11, fontWeight:600, color }}>{verdict}</span>
      </div>
      {/* track */}
      <div style={{ position:'relative', height:8, borderRadius:4, background:`linear-gradient(90deg, ${C.border} 0%, ${color}55 60%, ${color} 100%)`, marginBottom:6 }}>
        {/* marker */}
        <div style={{ position:'absolute', left:`${pct}%`, top:'50%', transform:'translate(-50%,-50%)', width:14, height:14, borderRadius:'50%', background:color, border:`2px solid ${C.bg}`, boxShadow:`0 0 0 1px ${color}` }} />
      </div>
      {/* mark labels */}
      <div style={{ position:'relative', height:14 }}>
        {marks.map((m,i)=>{
          const mp = Math.max(0, Math.min(100, (m.v - min) / (max - min) * 100));
          return (
            <span key={i} style={{ position:'absolute', left:`${mp}%`, transform:'translateX(-50%)', fontSize:8.5, color:C.muted, whiteSpace:'nowrap' }}>{m.t}</span>
          );
        })}
      </div>
    </div>
  );
}

function Progress() {
  const ftpGain = FTP - ftpHistory[0].ftp;
  const ftpPct = Math.round(ftpGain / ftpHistory[0].ftp * 100);
  const maxFtp = Math.max(...ftpHistory.map(h=>h.ftp));
  const minFtp = Math.min(...ftpHistory.map(h=>h.ftp));

  return (
    <div style={{ ...card, padding:'18px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <span style={{ fontSize:14, fontWeight:600 }}>Twój rozwój</span>
        <span style={{ fontSize:11, color:C.green, fontWeight:600 }}>● od początku sezonu</span>
      </div>

      {/* FTP hero — prosto: wartość, trend, pozycja na skali */}
      <div style={{ background:C.bg, borderRadius:12, border:`1px solid ${C.border}`, padding:'16px', marginBottom:12 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:14 }}>
          <div>
            <div style={{ fontSize:10, color:C.muted, letterSpacing:'0.1em', fontWeight:600, marginBottom:4 }}>TWÓJ SILNIK · FTP</div>
            <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
              <span style={{ fontSize:38, fontWeight:600, color:C.cyan, lineHeight:1 }}>{FTP}</span>
              <span style={{ fontSize:14, color:C.muted }}>W</span>
              <span style={{ fontSize:13, color:C.muted }}>· {(FTP/MASS).toFixed(2)} W/kg</span>
            </div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div style={{ display:'inline-flex', alignItems:'center', gap:4, background:C.green+'1E', border:`1px solid ${C.green}44`, borderRadius:20, padding:'4px 12px' }}>
              <span style={{ fontSize:14, color:C.green }}>▲</span>
              <span style={{ fontSize:15, fontWeight:600, color:C.green }}>+{ftpGain}W</span>
            </div>
            <div style={{ fontSize:11, color:C.green, fontWeight:600, marginTop:4 }}>+{ftpPct}% mocniejszy</div>
          </div>
        </div>

        {/* FTP curve */}
        <ResponsiveContainer width="100%" height={84}>
          <LineChart data={ftpHistory} margin={{top:8,right:8,left:8,bottom:0}}>
            <YAxis domain={[minFtp-6, maxFtp+4]} hide />
            <XAxis dataKey="m" tick={{fill:C.muted,fontSize:10}} axisLine={false} tickLine={false} />
            <Tooltip cursor={{stroke:C.border}} contentStyle={{background:C.card2,border:`1px solid ${C.border}`,borderRadius:8,fontSize:11}} labelStyle={{color:C.muted}} itemStyle={{color:C.cyan}} formatter={v=>[`${v}W`,'FTP']} />
            <Line type="monotone" dataKey="ftp" stroke={C.cyan} strokeWidth={2.5} dot={{r:3,fill:C.cyan,strokeWidth:0}} activeDot={{r:5}} isAnimationActive={true} />
          </LineChart>
        </ResponsiveContainer>

        {/* Skala porównawcza — pozycja wśród użytkowników aplikacji (percentyl) */}
        <CompareBar
          label="Wśród użytkowników VeloIQ" unit="" value={96} color={C.cyan}
          min={0} max={100}
          marks={[
            { v:25, t:'Rekreacyjny' },
            { v:50, t:'Średnia' },
            { v:75, t:'Zaawansowany' },
            { v:95, t:'Zawodnik' },
          ]}
          verdict="Zawodnik · top 4%"
        />
        <div style={{ fontSize:10, color:C.muted, marginTop:8, lineHeight:1.45 }}>4.40 W/kg stawia Cię w <b style={{color:C.text}}>najlepszych 4%</b> — przeciętny trenujący kolarz ma ok. 3.2 W/kg. To poziom zawodnika ścigającego się w wyścigach UCI.</div>
      </div>

      {/* Streak + VO2 + season — three engagement stats */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10 }}>
        {/* Streak — the "don't break it" hook */}
        <div style={{ background:`linear-gradient(160deg, ${C.yellow}14, ${C.bg})`, borderRadius:12, border:`1px solid ${C.yellow}33`, padding:'14px 12px', textAlign:'center' }}>
          <div style={{ fontSize:24, marginBottom:2 }}>🔥</div>
          <div style={{ fontSize:30, fontWeight:600, color:C.yellow, lineHeight:1 }}>{STREAK_WEEKS}</div>
          <div style={{ fontSize:10, color:C.muted, marginTop:3, lineHeight:1.3 }}>tygodni z rzędu<br/>z treningiem</div>
        </div>
        {/* Najdłuższy dystans sezonu */}
        <div style={{ background:C.bg, borderRadius:12, border:`1px solid ${C.border}`, padding:'14px 12px', textAlign:'center', display:'flex', flexDirection:'column', justifyContent:'center' }}>
          <div style={{ fontSize:10, color:C.muted, letterSpacing:'0.08em', fontWeight:600, marginBottom:6 }}>NAJDŁUŻSZA JAZDA</div>
          <div style={{ display:'flex', alignItems:'baseline', justifyContent:'center', gap:3 }}>
            <span style={{ fontSize:28, fontWeight:600, color:C.green, lineHeight:1 }}>147</span>
            <span style={{ fontSize:12, color:C.muted }}>km</span>
          </div>
          <div style={{ fontSize:11, color:C.green, fontWeight:600, marginTop:4 }}>Sudety Tour</div>
        </div>
        {/* Season volume */}
        <div style={{ background:C.bg, borderRadius:12, border:`1px solid ${C.border}`, padding:'14px 12px', textAlign:'center', display:'flex', flexDirection:'column', justifyContent:'center' }}>
          <div style={{ fontSize:10, color:C.muted, letterSpacing:'0.08em', fontWeight:600, marginBottom:6 }}>SEZON 2026</div>
          <div style={{ fontSize:26, fontWeight:600, color:C.cyan, lineHeight:1 }}>{SEASON_KM.toLocaleString('pl')}</div>
          <div style={{ fontSize:11, color:C.muted, marginTop:4 }}>kilometrów</div>
        </div>
      </div>

      {/* Season km goal — what people actually chase */}
      <div style={{ marginTop:12, background:C.bg, borderRadius:10, border:`1px solid ${C.border}`, padding:'13px 14px' }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontSize:16 }}>🎯</span>
            <span style={{ fontSize:12, fontWeight:600 }}>Cel sezonu</span>
          </div>
          <div style={{ display:'flex', alignItems:'baseline', gap:5 }}>
            <span style={{ fontSize:16, fontWeight:600, color:C.cyan }}>{SEASON_KM.toLocaleString('pl')}</span>
            <span style={{ fontSize:12, color:C.muted }}>/ {SEASON_GOAL_KM.toLocaleString('pl')} km</span>
          </div>
        </div>
        <div style={{ position:'relative', background:C.dim, borderRadius:4, height:8, overflow:'hidden', marginBottom:8 }}>
          <div style={{ height:'100%', width:`${Math.round(SEASON_KM/SEASON_GOAL_KM*100)}%`, background:`linear-gradient(90deg, ${C.cyan}, ${C.green})`, borderRadius:4 }} />
          {/* pace marker — where you "should" be today */}
          <div style={{ position:'absolute', top:-2, bottom:-2, left:`${Math.round((SEASON_KM-SEASON_PACE_DELTA)/SEASON_GOAL_KM*100)}%`, width:2, background:C.text, opacity:0.5 }} title="tempo planu" />
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
          <span style={{ fontSize:11, color: SEASON_PACE_DELTA>=0?C.green:C.yellow, fontWeight:600 }}>
            {SEASON_PACE_DELTA>=0 ? `▲ ${SEASON_PACE_DELTA} km przed tempem` : `▼ ${Math.abs(SEASON_PACE_DELTA)} km za tempem`}
          </span>
          <span style={{ fontSize:11, color:C.muted }}>{Math.round(SEASON_KM/SEASON_GOAL_KM*100)}% celu · zostało {(SEASON_GOAL_KM-SEASON_KM).toLocaleString('pl')} km</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────── PLAN ───────────────────────────
// Generator szczegółowej rozpiski przyszłego treningu wg typu + skali godzin
function buildWorkout(d) {
  const w = pct => Math.round(FTP * pct / 100);
  const wr = (a,b) => `${w(a)}–${w(b)}W`;
  const T = d.type;
  // skala czasu głównej części proporcjonalnie do dur
  const segs = [];
  let goal = '', tips = [];

  if (T === 'Z1') {
    segs.push({ k:'Cała jazda', t:`${d.dur} min`, w:wr(45,55), hr:'<125', c:C.muted, note:'luźna kadencja 85–95' });
    goal = 'Regeneracja aktywna — rozruszanie nóg, przepływ krwi. Zero pracy na mocy.';
    tips = ['Jeśli czujesz pokusę „docisnąć" — nie rób tego, dziś chodzi o odbudowę.','Płaski teren, równe tempo.'];
  } else if (T === 'Z2') {
    const main = d.dur - 25;
    segs.push({ k:'Rozgrzewka', t:'15 min', w:wr(50,60), hr:'120–135', c:C.green, note:'narastająco' });
    segs.push({ k:'Część główna', t:`${main} min`, w:wr(56,75), hr:'128–145', c:C.cyan, note:'stałe tempo, kadencja 90+' });
    segs.push({ k:'Schłodzenie', t:'10 min', w:wr(45,55), hr:'<125', c:C.muted });
    goal = 'Baza tlenowa i ekonomia. Trzymaj równe Z2 — nie wpadaj w Z3.';
    tips = ['Oddech swobodny, powinieneś móc rozmawiać.','Trzymaj równe tempo — to nie wyścig, buduj bazę.'];
  } else if (T === 'SST') {
    segs.push({ k:'Rozgrzewka', t:'20 min', w:wr(50,65), hr:'120–140', c:C.green, note:'+ 3×30s narastająco' });
    segs.push({ k:'Interwały', t:'3×12 min', w:wr(88,94), hr:'155–168', c:C.yellow, note:'sweet spot · przerwy 5 min Z1', reps:true });
    segs.push({ k:'Schłodzenie', t:'10 min', w:wr(45,55), hr:'<125', c:C.muted });
    goal = 'Próg bez nadmiernego zmęczenia — najlepszy stosunek bodziec/koszt.';
    tips = ['Kadencja 85–90.','Moc równa przez cały interwał, nie zaczynaj za mocno.'];
  } else if (T === 'THR') {
    segs.push({ k:'Rozgrzewka', t:'25 min', w:wr(50,65), hr:'120–145', c:C.green, note:'+ 3×(10s @110% openery)' });
    segs.push({ k:'Interwały', t:'3×15 min', w:wr(95,102), hr:'162–174', c:C.yellow, note:'próg · przerwy 6 min Z1', reps:true });
    segs.push({ k:'Schłodzenie', t:'10 min', w:wr(45,55), hr:'<125', c:C.muted });
    goal = 'Podniesienie FTP — to Twoja luka. Trzymaj moc równo aż do końca każdego bloku.';
    tips = ['Ostatnie 3 min są najważniejsze — nie odpuszczaj.','Jeśli moc spada >5% w 2. bloku, skróć ostatni do 12 min.'];
  } else if (T === 'OU') {
    segs.push({ k:'Rozgrzewka', t:'25 min', w:wr(50,65), hr:'120–145', c:C.green, note:'+ 3×(10s @110% openery)' });
    segs.push({ k:'Blok 1', t:'3×(3+1) min', w:`${w(95)}/${w(110)}W`, hr:'155–172', c:'#C68A4E', note:'under 95% / over 110%', reps:true });
    segs.push({ k:'Blok 2', t:'3×(3+1) min', w:`${w(95)}/${w(110)}W`, hr:'158–175', c:'#C68A4E', note:'przerwa 5 min Z1 przed', reps:true });
    segs.push({ k:'Blok 3', t:'3×(3+1) min', w:`${w(95)}/${w(110)}W`, hr:'160–177', c:'#C68A4E', note:'przerwa 5 min Z1 przed', reps:true });
    segs.push({ k:'Schłodzenie', t:'10 min', w:wr(45,55), hr:'<125', c:C.muted });
    goal = 'Tolerancja mleczanu i moc progowa. „Over" boli, ale „under" to Twój aktywny odpoczynek.';
    tips = ['Nie zwalniaj na under — to ma być wciąż 95% FTP.','Jeśli over przestaje być osiągalny, zakończ blok wcześniej.'];
  } else if (T === 'VO2') {
    segs.push({ k:'Rozgrzewka', t:'25 min', w:wr(50,65), hr:'120–150', c:C.green, note:'+ 3×(15s @120% openery)' });
    segs.push({ k:'Interwały', t:'5×4 min', w:wr(110,120), hr:'175–186', c:C.red, note:'VO2max · przerwy 4 min Z1 (1:1)', reps:true });
    segs.push({ k:'Schłodzenie', t:'10 min', w:wr(45,55), hr:'<125', c:C.muted });
    goal = 'Pułap tlenowy. Pierwsze 2 powtórzenia mają wydawać się „za łatwe".';
    tips = ['Buduj moc przez pierwsze 30s, potem trzymaj.','Jeśli 4. powtórzenie się sypie, zrób 4 zamiast 5 — jakość > ilość.'];
  } else if (T === 'LONG') {
    const main = d.dur - 30;
    segs.push({ k:'Rozgrzewka', t:'20 min', w:wr(45,60), hr:'115–135', c:C.green, note:'Z1→Z2' });
    segs.push({ k:'Część główna', t:`${main} min`, w:wr(56,72), hr:'130–148', c:C.cyan, note:'Z2 z naturalnymi podjazdami' });
    segs.push({ k:'Opcja (jeśli świeży)', t:'2×20 min', w:wr(76,85), hr:'148–160', c:C.yellow, note:'Z3 w środku jazdy' });
    segs.push({ k:'Schłodzenie', t:'10 min', w:wr(45,55), hr:'<125', c:C.muted });
    goal = 'Wytrzymałość i ekonomia tłuszczowa. Długo i równo, kontrolowane tempo.';
    tips = ['Ostatnia godzina ma być tak samo mocna jak pierwsza.','Nie zaczynaj za szybko — rozłóż siły na cały dystans.'];
  }
  // ── Odżywianie: picie + jedzenie wg czasu i intensywności ──
  const h = d.dur / 60;
  const intense = ['THR','OU','VO2','SST'].includes(T);
  let nutrition;
  if (d.dur === 0) {
    nutrition = null; // OFF
  } else if (d.dur < 75 && T !== 'LONG') {
    const bidony = Math.max(1, Math.round(d.dur/45));
    nutrition = {
      drink: `${bidony} bidon${bidony>1?'y':''} · woda lub izotonik`,
      food: 'Nie trzeba — za krótko',
      note: 'Najedz się 2h przed wyjazdem. Na rowerze wystarczy woda.',
      short: true,
    };
  } else {
    const carbPerH = intense ? 60 : h < 2.5 ? 50 : 70;
    const totalCarb = Math.round(carbPerH * h);
    const gele = Math.round(totalCarb / 25);
    const mlPerH = intense ? 700 : 600;
    const totalMl = Math.round(mlPerH * h);
    const bidony = Math.max(1, Math.round(totalMl/600));
    nutrition = {
      drink: `${bidony} bidony · ~${(totalMl/1000).toFixed(1)}l izotonik + woda`,
      food: `~${totalCarb}g węgli · ${gele} żele (lub żel + baton)`,
      note: `Jedz ${carbPerH}g na godzinę, zacznij po ~45 min. Pij łyk co 10–15 min.`,
    };
  }

  return { segs, goal, tips, nutrition };
}

function WorkoutDetail({ d, onClose }) {
  const tc = {OFF:C.muted,Z1:C.muted,Z2:C.green,SST:C.yellow,THR:C.yellow,OU:'#C68A4E',VO2:C.red,LONG:C.cyan}[d.type] || C.muted;
  const wk = buildWorkout(d);
  return (
    <div style={{ position:'fixed', inset:0, zIndex:100, background:C.bg, overflowY:'auto', color:'#EDEFF2' }}>
      <div style={{ position:'sticky', top:0, zIndex:2, background:'rgba(6,8,10,0.9)', backdropFilter:'blur(16px)', borderBottom:`1px solid ${C.border}`, padding:'12px 18px', display:'flex', alignItems:'center', gap:12 }}>
        <button onClick={onClose} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:9, cursor:'pointer', padding:7, display:'flex' }}><Icon name="close" size={18} color={C.muted} /></button>
        <div style={{ fontSize:10, fontWeight:600, letterSpacing:'0.18em', color:tc }}>PLANOWANY TRENING</div>
      </div>

      <div style={{ maxWidth:560, margin:'0 auto', padding:'20px 16px 48px' }}>
        {/* Nagłówek */}
        <div style={{ marginBottom:16 }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
            <span style={{ background:tc+'22', color:tc, border:`1px solid ${tc}55`, borderRadius:5, padding:'3px 10px', fontSize:11, fontWeight:600 }}>{d.type}</span>
            <span style={{ fontSize:12, color:'#9AA0AB' }}>{d.day} · {d.date}</span>
          </div>
          <h1 style={{ fontSize:22, fontWeight:600, color:'#fff' }}>{d.label}</h1>
        </div>

        {/* Statystyki docelowe */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:8, marginBottom:16 }}>
          {[['CZAS',fmtDur(d.dur),C.text],['MOC śr',d.watt,C.cyan],['HR',d.hr,C.red],['TSS',d.tss,C.yellow]].map(([l,v,c])=>(
            <div key={l} style={{ background:'#1A1D23', border:'1px solid #262A31', borderRadius:10, padding:'12px 8px', textAlign:'center' }}>
              <div style={{ fontSize:14, fontWeight:600, marginBottom:2, color:c }}>{v}</div>
              <div style={{ fontSize:9, color:'#9AA0AB', textTransform:'uppercase', letterSpacing:'0.5px' }}>{l}</div>
            </div>
          ))}
        </div>

        {/* Cel treningu */}
        <div style={{ background:tc+'0E', border:`1px solid ${tc}30`, borderRadius:10, padding:'12px 14px', marginBottom:16, display:'flex', gap:10, alignItems:'flex-start' }}>
          <div style={{ fontSize:18, flexShrink:0, marginTop:1 }}>🎯</div>
          <div>
            <div style={{ fontSize:9, fontWeight:600, color:tc, letterSpacing:'1px', textTransform:'uppercase', marginBottom:3 }}>Cel sesji</div>
            <p style={{ fontSize:12.5, color:'#C2C7CF', lineHeight:1.6 }}>{wk.goal}</p>
          </div>
        </div>

        {/* Struktura sesji */}
        <div style={{ fontSize:10, fontWeight:600, letterSpacing:'2px', color:tc, textTransform:'uppercase', marginBottom:10 }}>Struktura sesji</div>
        <div style={{ marginBottom:16 }}>
          {wk.segs.map((s,i)=>(
            <div key={i} style={{ background:'#1A1D23', border:'1px solid #262A31', borderRadius:10, padding:'12px 14px', marginBottom:8, display:'flex', alignItems:'center', gap:12 }}>
              <div style={{ width:4, alignSelf:'stretch', borderRadius:2, background:s.c, flexShrink:0 }} />
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ fontSize:13, fontWeight:600, color:'#fff' }}>{s.k}{s.reps && <span style={{ fontSize:10, color:s.c, marginLeft:6, fontWeight:600 }}>● interwały</span>}</div>
                {s.note && <div style={{ fontSize:10.5, color:'#9AA0AB', marginTop:2 }}>{s.note}</div>}
              </div>
              <div style={{ textAlign:'right', flexShrink:0 }}>
                <div style={{ fontSize:13, fontWeight:600, color:s.c }}>{s.t}</div>
                <div style={{ fontSize:10.5, color:'#C2C7CF', marginTop:1 }}>{s.w}</div>
                {s.hr && <div style={{ fontSize:9, color:'#9AA0AB', marginTop:1 }}>{s.hr} bpm</div>}
              </div>
            </div>
          ))}
        </div>

        {/* Wskazówki wykonania */}
        <div style={{ fontSize:10, fontWeight:600, letterSpacing:'2px', color:tc, textTransform:'uppercase', marginBottom:10 }}>Wskazówki wykonania</div>
        <div style={{ background:'#1A1D23', border:'1px solid #262A31', borderRadius:10, padding:'12px 14px', marginBottom:16 }}>
          {wk.tips.map((t,i)=>(
            <div key={i} style={{ display:'flex', gap:9, marginBottom: i<wk.tips.length-1?9:0, alignItems:'flex-start' }}>
              <div style={{ width:5, height:5, borderRadius:'50%', background:tc, marginTop:6, flexShrink:0 }} />
              <div style={{ fontSize:12, color:'#C2C7CF', lineHeight:1.5 }}>{t}</div>
            </div>
          ))}
        </div>

        {/* Co zabrać ze sobą — picie i jedzenie */}
        {wk.nutrition && (
          <>
            <div style={{ fontSize:10, fontWeight:600, letterSpacing:'2px', color:tc, textTransform:'uppercase', marginBottom:10 }}>Co zabrać ze sobą</div>
            <div style={{ background:'#1A1D23', border:'1px solid #262A31', borderRadius:10, padding:14, marginBottom:16 }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10, marginBottom:10 }}>
                <div style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
                  <div style={{ fontSize:22, flexShrink:0 }}>💧</div>
                  <div>
                    <div style={{ fontSize:9, color:'#9AA0AB', letterSpacing:'0.5px', fontWeight:600, marginBottom:2 }}>PICIE</div>
                    <div style={{ fontSize:12.5, color:'#EDEFF2', fontWeight:600, lineHeight:1.4 }}>{wk.nutrition.drink}</div>
                  </div>
                </div>
                <div style={{ display:'flex', alignItems:'flex-start', gap:10 }}>
                  <div style={{ fontSize:22, flexShrink:0 }}>🍌</div>
                  <div>
                    <div style={{ fontSize:9, color:'#9AA0AB', letterSpacing:'0.5px', fontWeight:600, marginBottom:2 }}>JEDZENIE</div>
                    <div style={{ fontSize:12.5, color: wk.nutrition.short?'#9AA0AB':'#EDEFF2', fontWeight:600, lineHeight:1.4 }}>{wk.nutrition.food}</div>
                  </div>
                </div>
              </div>
              <div style={{ fontSize:11, color:'#9AA0AB', lineHeight:1.5, paddingTop:10, borderTop:'1px solid #262A31' }}>{wk.nutrition.note}</div>
            </div>
          </>
        )}

        {/* Strefy mocy */}
        {d.type!=='OFF' && (
          <>
            <div style={{ fontSize:10, fontWeight:600, letterSpacing:'2px', color:tc, textTransform:'uppercase', marginBottom:10 }}>Rozkład stref mocy</div>
            <div style={{ background:'#1A1D23', border:'1px solid #262A31', borderRadius:10, padding:14 }}>
              <ZoneBar zones={d.zones} />
              <div style={{ display:'flex', justifyContent:'space-between', marginTop:10 }}>
                {['Z1','Z2','Z3','Z4','Z5'].map((z,i)=>(
                  <div key={z} style={{ textAlign:'center', flex:1 }}>
                    <div style={{ width:9, height:9, borderRadius:2, background:ZONE_COLORS[i], margin:'0 auto 4px' }} />
                    <div style={{ fontSize:11, fontWeight:600 }}>{d.zones[i]}%</div>
                    <div style={{ fontSize:8, color:'#9AA0AB' }}>{z}</div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Plan() {
  // ── Nawigacja tygodniami: start na bieżącym, strzałki ‹ › ──
  const [weekIdx, setWeekIdx] = useState(CURRENT_WEEK_IDX);
  const week = WEEKS[weekIdx];
  const isPast = week.kind === 'past';
  const isFuture = week.kind === 'future';
  const isCurrent = week.kind === 'current';

  // Plan bieżącego tygodnia jest edytowalny (chat AI); pozostałe tygodnie read-only.
  const [planCur, setPlanCur] = useState(weekPlan);
  const plan = isCurrent ? planCur : week.plan;

  // baseHours liczone tylko z dni do wykonania (done/dzisiejszy nie podlegają skalowaniu)
  const baseHours = Math.round(plan.filter(d=>!d.done).reduce((a,d)=>a+d.dur,0) / 60) || 1;
  const [hours, setHours] = useState(Math.round(weekPlan.filter(d=>!d.done).reduce((a,d)=>a+d.dur,0)/60)||1);
  const [chat, setChat] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [openWorkout, setOpenWorkout] = useState(null); // przyszły trening → rozpiska
  const [openRide, setOpenRide] = useState(null);        // odbyty trening → analiza (data ISO)

  // Suwak godzin działa TYLKO na bieżącym tygodniu. Przeszłe/przyszłe pokazują surowe dane.
  const scale = isCurrent ? hours / baseHours : 1;
  const scaledPlan = (isCurrent ? planCur : plan).map(d => (d.type === 'OFF' || d.done || !isCurrent) ? d : {
    ...d,
    dur: Math.round(d.dur * scale / 5) * 5,
    tss: Math.round(d.tss * scale),
  });

  const totalTSS = scaledPlan.reduce((a,d)=>a+d.tss,0);
  const totalDur = scaledPlan.reduce((a,d)=>a+d.dur,0);
  const sessions = scaledPlan.filter(d=>d.type!=='OFF').length;
  const lastWeekTSS = weeks[weeks.length-1]?.tss || 0;

  // ── AI: optymalne pozostałe godziny (tylko bieżący tydzień) ──
  const pmcNow = pmc[pmc.length-1];
  const doneTSS = planCur.filter(d=>d.done).reduce((a,d)=>a+d.tss,0);
  const futureBaseTSS = planCur.filter(d=>!d.done && d.type!=='OFF').reduce((a,d)=>a+d.tss,0);
  const futureBaseDur = planCur.filter(d=>!d.done && d.type!=='OFF').reduce((a,d)=>a+d.dur,0);
  const tssPerH = futureBaseDur>0 ? futureBaseTSS/(futureBaseDur/60) : 42;
  const targetWeeklyTSS = pmcNow.ctl * 7 * 1.15;
  const recHours = Math.max(2, Math.min(16, Math.round((targetWeeklyTSS - doneTSS) / tssPerH)));
  const atRec = hours === recHours;
  const setPlan = setPlanCur; // alias dla istniejącego kodu modyfikacji
  const loadVerdict = totalTSS > lastWeekTSS * 1.15 ? { t:'Mocny wzrost', c:C.red }
    : totalTSS > lastWeekTSS ? { t:'Kontrolowany wzrost', c:C.green }
    : { t:'Tydzień lżejszy', c:C.cyan };

  async function sendMod(text) {
    const q = (text || input).trim();
    if (!q || loading) return;
    const nc = [...chat, { role:'user', text:q }];
    setChat(nc); setInput(''); setLoading(true);
    try {
      const planJson = JSON.stringify(scaledPlan.map(({day,date,type,label,tss,dur,watt,hr})=>({day,date,type,label,tss,dur,watt,hr})));
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:1500, system:`Jesteś trenerem AI VeloIQ modyfikującym plan tygodniowy. Zawodnik Adrian: FTP ${FTP}W, ${MASS}kg, VO2max ${VO2MAX}. Cel: 3Rides Winterberg za 31 dni. Słabość: próg 20-60min. Aktualny plan (JSON): ${planJson}.

Zwróć WYŁĄCZNIE JSON (bez markdown, bez tekstu przed/po) w formacie:
{"plan":[{"day":"Pn","date":"15.06","type":"OFF|Z1|Z2|SST|THR|OU|VO2|LONG","label":"...","tss":0,"dur":0,"watt":"175-195W lub –","hr":"130-145 lub –","zones":[Z1,Z2,Z3,Z4,Z5]},...7 dni...],"insight":"1-2 zdania PO POLSKU co zmieniłeś i dlaczego"}

Zasady: zachowaj 7 dni (Pn-Nd). Typy: OFF=wolne, Z1=regeneracja, Z2=endurance, SST=sweet spot, THR=threshold, OU=over-under, VO2=vo2max, LONG=długa. Jeśli user chce wolny dzień -> type OFF, tss 0, dur 0, watt/hr "–", zones [0,0,0,0,0], a obciążenie rozłóż na inne dni. Jeśli user świeży i chce mocniej -> dodaj intensywność (THR/OU/VO2). zones to procenty czasu w strefach Z1-Z5 sumujące się do ~100. Rozgrzewka min 20min przed Z2/SST, 25min przed THR/OU/VO2. Bądź spójny: insight musi zgadzać się z planem.`, messages: nc.map(m=>({ role: m.role==='ai'?'assistant':'user', content: m.text })) })
      });
      const d = await r.json();
      let txt = d.content?.[0]?.text || '';
      txt = txt.replace(/```json|```/g,'').trim();
      const parsed = JSON.parse(txt);
      if (parsed.plan) {
        // mark today + done flags preserved by date
        const merged = parsed.plan.map(np => {
          const orig = weekPlan.find(o=>o.date===np.date) || {};
          return { ...np, today: orig.today, done: orig.done };
        });
        setPlan(merged);
        setHours(Math.round(merged.reduce((a,x)=>a+(x.dur||0),0)/60)); // resync slider
      }
      setChat(c=>[...c, { role:'ai', text: parsed.insight || 'Plan zaktualizowany.' }]);
    } catch {
      setChat(c=>[...c, { role:'ai', text:'Nie udało się zmodyfikować planu — spróbuj inaczej sformułować.' }]);
    } finally { setLoading(false); }
  }

  const quickMods = ['Piątek potrzebuję wolny', 'Jestem świeży — mocniejsza końcówka', 'Skróć weekend, mam wyjazd'];

  return (
    <>
      {openWorkout && <WorkoutDetail d={openWorkout} onClose={()=>setOpenWorkout(null)} />}
      {openRide && <RideAnalysis act={{ date: openRide }} onClose={()=>setOpenRide(null)} />}

      {/* WEEK NAVIGATION — strzałki ‹ › */}
      <div style={{ ...card, marginBottom:10, padding:'10px 12px', display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <button onClick={()=>setWeekIdx(i=>Math.max(0,i-1))} disabled={weekIdx<=0}
          style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:9, width:36, height:36, color: weekIdx<=0?C.dim:C.text, cursor: weekIdx<=0?'default':'pointer', fontSize:18, flexShrink:0 }}>‹</button>
        <div style={{ textAlign:'center', flex:1 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:7 }}>
            <span style={{ fontSize:14, fontWeight:600 }}>{week.label}</span>
            {isCurrent && <span style={{ fontSize:8, fontWeight:600, letterSpacing:'0.1em', color:C.bg, background:C.cyan, borderRadius:4, padding:'2px 7px' }}>TERAZ</span>}
          </div>
          <div style={{ fontSize:11, color:C.muted, marginTop:1 }}>{week.range}
            {isPast && ' · wykonany'}{isFuture && ' · zarys'}</div>
        </div>
        <button onClick={()=>setWeekIdx(i=>Math.min(WEEKS.length-1,i+1))} disabled={weekIdx>=WEEKS.length-1}
          style={{ background:C.bg, border:`1px solid ${C.border}`, borderRadius:9, width:36, height:36, color: weekIdx>=WEEKS.length-1?C.dim:C.text, cursor: weekIdx>=WEEKS.length-1?'default':'pointer', fontSize:18, flexShrink:0 }}>›</button>
      </div>
      {!isCurrent && (
        <div style={{ ...card, marginBottom:10, padding:'10px 13px', display:'flex', alignItems:'center', gap:9, borderLeft:`3px solid ${isPast?C.muted:C.cyan}`, borderRadius:'0 12px 12px 0' }}>
          <span style={{ fontSize:15 }}>{isPast?'✓':'📋'}</span>
          <div style={{ fontSize:11, color:C.muted, lineHeight:1.45 }}>
            {isPast
              ? 'Tydzień zakończony. Kliknij dzień z treningiem, aby zobaczyć analizę wykonania.'
              : 'Tydzień orientacyjny — dokładna rozpiska dopnie się, gdy się zbliży. Wróć do bieżącego, by edytować plan.'}
          </div>
          {!isCurrent && <button onClick={()=>setWeekIdx(CURRENT_WEEK_IDX)} style={{ flexShrink:0, marginLeft:'auto', background:C.cyan+'1E', color:C.cyan, border:`1px solid ${C.cyan}55`, borderRadius:7, padding:'6px 10px', fontSize:10, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>Bieżący</button>}
        </div>
      )}

      {/* HOURS SLIDER — tylko bieżący tydzień */}
      {isCurrent && (
      <div style={{ ...card, marginBottom:10 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:10 }}>
          <span style={{ fontSize:13, fontWeight:600 }}>Pozostały czas w tygodniu</span>
          <div style={{ display:'flex', alignItems:'baseline', gap:5 }}>
            <span style={{ fontSize:24, fontWeight:600, color:C.cyan }}>{hours}</span>
            <span style={{ fontSize:13, color:C.muted }}>h</span>
          </div>
        </div>
        {/* track z markerem rekomendacji AI */}
        <div style={{ position:'relative' }}>
          <input type="range" min={2} max={16} step={1} value={hours} onChange={e=>setHours(+e.target.value)}
            style={{ width:'100%', accentColor:C.cyan, cursor:'pointer', display:'block' }} />
          {/* marker AI na skali */}
          <div style={{ position:'absolute', top:-3, left:`${(recHours-2)/(16-2)*100}%`, transform:'translateX(-50%)', pointerEvents:'none' }}>
            <div style={{ width:2, height:22, background:C.green, borderRadius:1, margin:'0 auto' }} />
          </div>
        </div>
        <div style={{ display:'flex', justifyContent:'space-between', fontSize:9, color:C.muted, marginTop:4 }}>
          <span>2h</span><span>8h</span><span>16h</span>
        </div>

        {/* Rekomendacja AI */}
        <div style={{ display:'flex', alignItems:'center', gap:10, marginTop:12, padding:'10px 12px', background:C.green+'0E', border:`1px solid ${C.green}30`, borderRadius:10 }}>
          <div style={{ width:32, height:32, flexShrink:0, borderRadius:8, background:C.green+'1E', border:`1px solid ${C.green}44`, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill={C.green}><path d="M12 2l2.4 6.5L21 9l-5 4.5L17.5 21 12 17l-5.5 4L8 13.5 3 9l6.6-.5z"/></svg>
          </div>
          <div style={{ flex:1 }}>
            <div style={{ fontSize:9, color:C.green, letterSpacing:'0.1em', fontWeight:600, marginBottom:2 }}>REKOMENDACJA AI · {recHours}h</div>
            <div style={{ fontSize:11, color:C.text, lineHeight:1.4 }}>
              {atRec
                ? <>Optymalny punkt dla Twojej formy — najlepszy postęp przy zdrowej regeneracji. TSB w niedzielę ~−12.</>
                : hours > recHours
                  ? <>Powyżej rekomendacji — większy bodziec, ale i większe obciążenie. Świadomy wybór, jeśli czujesz się dobrze.</>
                  : <>Poniżej rekomendacji — bezpieczniej, wolniejszy przyrost formy. Dołóż, jeśli chcesz szybciej budować.</>}
            </div>
          </div>
          {!atRec && (
            <button onClick={()=>setHours(recHours)} style={{ flexShrink:0, background:C.green+'1E', color:C.green, border:`1px solid ${C.green}55`, borderRadius:7, padding:'7px 11px', fontSize:10.5, fontWeight:600, cursor:'pointer', whiteSpace:'nowrap' }}>Użyj {recHours}h</button>
          )}
        </div>

        <div style={{ fontSize:11, color:C.muted, marginTop:8 }}>Skaluje tylko <b style={{color:C.text}}>nadchodzące</b> sesje — wykonane treningi i dzisiejsza jazda zostają bez zmian.</div>
      </div>
      )}

      {/* AI INSIGHT — zależny od tygodnia */}
      <div style={{ ...card, marginBottom:10, borderLeft:`3px solid ${C.cyan}`, borderRadius:'0 12px 12px 0', paddingLeft:14 }}>
        <div style={{ fontSize:9, color:C.cyan, letterSpacing:'0.12em', fontWeight:600, marginBottom:7 }}>AI INSIGHT — {isPast?'PODSUMOWANIE TYGODNIA':isFuture?'ZARYS TYGODNIA':'PLAN TYGODNIA'}</div>
        <div style={{ fontSize:13, lineHeight:1.6 }}>
          {isPast
            ? <>Tydzień zaliczony — {totalTSS} TSS w {fmtDur(totalDur)}. Solidna porcja pracy, w tym mocny trening progowy. Dobra baza przed kolejnym blokiem.</>
            : isFuture
              ? <>Wstępny zarys — około {totalTSS} TSS. Dokładne treningi dopną się, gdy zobaczymy, jak zniesiesz najbliższe dni.</>
              : <>Ten tydzień przygotowuje Cię do Winterberg. Trochę więcej pracy niż ostatnio (<span style={{color:loadVerdict.c, fontWeight:600}}>{loadVerdict.t.toLowerCase()}</span>), w weekend dłuższe spokojne jazdy.</>}
        </div>
      </div>

      {/* STATS — recomputed live */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:10, marginBottom:10 }}>
        {[['SESJE',sessions,'jednostki'],['CZAS',fmtDur(totalDur),'łącznie'],['LOAD',totalTSS,'TSS']].map(([l,v,s])=>(
          <div key={l} style={{ ...card, textAlign:'center' }}><div style={{ fontSize:9, color:C.muted, letterSpacing:'0.12em', fontWeight:600, marginBottom:4 }}>{l}</div><div style={{ fontSize:24, fontWeight:600, color:C.cyan }}>{v}</div><div style={{ fontSize:9, color:C.muted }}>{s}</div></div>
        ))}
      </div>

      {/* DAY CARDS */}
      <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:14 }}>
        {scaledPlan.map((d,i)=>{
          const tc = {OFF:C.muted,Z1:C.muted,Z2:C.green,SST:C.yellow,THR:C.yellow,OU:'#C68A4E',VO2:C.red,LONG:C.cyan}[d.type] || C.muted;
          const clickable = d.type !== 'OFF';
          const isoDate = '2026-' + d.date.split('.').reverse().join('-'); // '16.06' → '2026-06-16'
          const onClick = !clickable ? undefined : d.done ? ()=>setOpenRide(isoDate) : ()=>setOpenWorkout(d);
          return (
            <div key={i} onClick={onClick} style={{ ...card, padding:'12px 14px', opacity: (d.done && !d.today)?0.55:1, border: d.today?`1px solid ${C.cyan}`:`1px solid ${C.border}`, position:'relative', cursor: clickable?'pointer':'default', transition:'border-color 0.15s' }}
              onMouseEnter={clickable?(e=>e.currentTarget.style.borderColor=tc+'88'):undefined}
              onMouseLeave={clickable?(e=>e.currentTarget.style.borderColor=d.today?C.cyan:C.border):undefined}>
              {d.today && <div style={{ position:'absolute', top:-8, left:14, background:C.cyan, color:C.bg, fontSize:8, fontWeight:600, padding:'2px 8px', borderRadius:4, letterSpacing:'0.1em' }}>DZIŚ · ZROBIONE ✓</div>}
              <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ width:42, textAlign:'center' }}><div style={{ fontSize:13, fontWeight:600 }}>{d.day}</div><div style={{ fontSize:9, color:C.muted }}>{d.date}</div></div>
                <div style={{ width:50 }}><span style={{ background:tc+'22', color:tc, border:`1px solid ${tc}55`, borderRadius:4, padding:'2px 7px', fontSize:9, fontWeight:600 }}>{d.type}</span></div>
                <div style={{ flex:1 }}>
                  <div style={{ fontSize:13, fontWeight:600, marginBottom:4 }}>{d.label}</div>
                  {d.type!=='OFF' && <ZoneBar zones={d.zones} />}
                </div>
                {d.type!=='OFF' ? (
                  <div style={{ display:'flex', gap:14, textAlign:'right', alignItems:'center' }}>
                    <div><div style={{ fontSize:8, color:C.muted, fontWeight:600 }}>CZAS</div><div style={{ fontSize:13, fontWeight:600 }}>{fmtDur(d.dur)}</div></div>
                    <div><div style={{ fontSize:8, color:C.muted, fontWeight:600 }}>MOC</div><div style={{ fontSize:12, fontWeight:600, color:C.cyan }}>{d.watt}</div></div>
                    <div><div style={{ fontSize:8, color:C.muted, fontWeight:600 }}>HR</div><div style={{ fontSize:12, fontWeight:600, color:C.red }}>{d.hr}</div></div>
                    <div><div style={{ fontSize:8, color:C.muted, fontWeight:600 }}>TSS</div><div style={{ fontSize:13, fontWeight:600, color:C.yellow }}>{d.tss}</div></div>
                    <Icon name="chevR" size={15} color={tc} />
                  </div>
                ) : <div style={{ fontSize:11, color:C.muted, fontStyle:'italic' }}>Pełna regeneracja</div>}
              </div>
              {clickable && <div style={{ fontSize:9, color:tc, fontWeight:600, marginTop:8, opacity:0.8 }}>{d.done ? 'Analiza wykonania →' : 'Pełna rozpiska treningu →'}</div>}
            </div>
          );
        })}
      </div>

      {/* MODIFY CHAT — tylko bieżący tydzień */}
      {isCurrent && (
      <div style={{ ...card, padding:'14px 16px' }}>
        <div style={{ fontSize:9, color:C.green, letterSpacing:'0.12em', fontWeight:600, marginBottom:10 }}>ZMIEŃ PLAN — napisz, czego potrzebujesz</div>
        {chat.length>0 && (
          <div style={{ display:'flex', flexDirection:'column', gap:8, marginBottom:12 }}>
            {chat.map((m,i)=>(
              <div key={i} style={{ alignSelf: m.role==='user'?'flex-end':'flex-start', maxWidth:'85%' }}>
                <div style={{ background: m.role==='user'?C.cyan:C.bg, color: m.role==='user'?'#000':C.text, border: m.role==='user'?'none':`1px solid ${C.border}`, borderRadius:12, padding:'9px 13px', fontSize:12.5, lineHeight:1.55 }}>{m.text}</div>
              </div>
            ))}
            {loading && <div style={{ alignSelf:'flex-start', color:C.muted, fontSize:12, fontStyle:'italic' }}>AI przebudowuje plan...</div>}
          </div>
        )}
        {chat.length===0 && (
          <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:10 }}>
            {quickMods.map(s=><button key={s} onClick={()=>sendMod(s)} style={{ background:C.bg, border:`1px solid ${C.border}`, color:C.green, borderRadius:14, padding:'6px 12px', fontSize:11, cursor:'pointer' }}>{s}</button>)}
          </div>
        )}
        <div style={{ display:'flex', gap:8 }}>
          <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&sendMod()} placeholder="np. piątek potrzebuję wolny, weekend mocniej..." style={{ flex:1, background:C.bg, border:`1px solid ${C.border}`, borderRadius:10, padding:'11px 14px', color:C.text, fontSize:13, outline:'none' }} />
          <button onClick={()=>sendMod()} disabled={loading} style={{ background:C.green, border:'none', borderRadius:10, padding:'0 18px', color:C.bg, fontWeight:600, fontSize:14, cursor:'pointer' }}>↑</button>
        </div>
      </div>
      )}
    </>
  );
}


// ─────────────────────────── COACH AI ───────────────────────────
function Coach() {
  const [msgs, setMsgs] = useState([
    { role:'ai', text:'Cześć Adrian! Jestem Twoim trenerem AI. Znam Twoją formę (CTL, FTP ~295W, VO2max 62) i wszystkie jazdy ze Strava. O co chcesz zapytać?' }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const suggestions = ['Jak wygląda moja forma przed Winterberg?', 'Czego brakuje w moim treningu?', 'Jak rozłożyć siły na wyścigu 110km?'];

  async function send(text) {
    const q = text || input;
    if (!q.trim() || loading) return;
    const newMsgs = [...msgs, { role:'user', text:q }];
    setMsgs(newMsgs); setInput(''); setLoading(true);
    const now = pmc[pmc.length-1];
    try {
      const hist = newMsgs.filter(m=>m.role!=='ai'||m!==newMsgs[0]).map(m=>({ role: m.role==='ai'?'assistant':'user', content: m.text }));
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:1000, system:`Jesteś trenerem kolarskim AI w VeloIQ. Zawodnik: Adrian, 30 lat, gravel/szosa. FTP ${FTP}W, ${MASS}kg, ${(FTP/MASS).toFixed(2)} W/kg, HRmax ${HRMAX}, VO2max ${VO2MAX}. Dziś 18.06.2026: CTL ${now.ctl}, ATL ${now.atl}, TSB ${now.tsb}. Ostatni wyścig GWS Jakuszyce 06.06 (129km, 2549m, TSS 589). Następny start: 3Rides Winterberg 19.07 (gravel WS, ~110km). Słabość: moc progowa 20-60min. Odpowiadaj po polsku, konkretnie, z liczbami, krótko (max 120 słów).`, messages: hist })
      });
      const d = await r.json();
      setMsgs(m=>[...m, { role:'ai', text: d.content?.[0]?.text || 'Błąd odpowiedzi.' }]);
    } catch {
      setMsgs(m=>[...m, { role:'ai', text:'Nie mogę teraz połączyć się z API. Spróbuj ponownie.' }]);
    } finally { setLoading(false); }
  }

  return (
    <div style={{ display:'flex', flexDirection:'column', height:'68vh' }}>
      <div style={{ flex:1, overflowY:'auto', display:'flex', flexDirection:'column', gap:10, paddingBottom:10 }}>
        {msgs.map((m,i)=>(
          <div key={i} style={{ alignSelf: m.role==='user'?'flex-end':'flex-start', maxWidth:'82%' }}>
            <div style={{ background: m.role==='user'?C.cyan:C.card, color: m.role==='user'?'#000':C.text, border: m.role==='user'?'none':`1px solid ${C.border}`, borderRadius:14, padding:'10px 14px', fontSize:13, lineHeight:1.6 }}>{m.text}</div>
          </div>
        ))}
        {loading && <div style={{ alignSelf:'flex-start', color:C.muted, fontSize:12, fontStyle:'italic', padding:'4px 8px' }}>Trener pisze...</div>}
      </div>
      {msgs.length<=1 && (
        <div style={{ display:'flex', flexWrap:'wrap', gap:6, marginBottom:8 }}>
          {suggestions.map(s=><button key={s} onClick={()=>send(s)} style={{ background:C.card, border:`1px solid ${C.border}`, color:C.cyan, borderRadius:14, padding:'6px 12px', fontSize:11, cursor:'pointer' }}>{s}</button>)}
        </div>
      )}
      <div style={{ display:'flex', gap:8 }}>
        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()} placeholder="Zapytaj trenera AI..." style={{ flex:1, background:C.card, border:`1px solid ${C.border}`, borderRadius:10, padding:'11px 14px', color:C.text, fontSize:13, outline:'none' }} />
        <button onClick={()=>send()} disabled={loading} style={{ background:C.cyan, border:'none', borderRadius:10, padding:'0 18px', color:C.bg, fontWeight:600, fontSize:14, cursor:'pointer' }}>↑</button>
      </div>
    </div>
  );
}

// ─────────────────────────── CALENDAR ───────────────────────────
const TYPE_COLOR = { OFF:C.muted, Z1:C.muted, Z2:C.green, SST:C.yellow, THR:C.yellow, OU:'#C68A4E', VO2:C.red, LONG:C.cyan };
const MONTHS_PL = ['Styczeń','Luty','Marzec','Kwiecień','Maj','Czerwiec','Lipiec','Sierpień','Wrzesień','Październik','Listopad','Grudzień'];
const DOW_PL = ['Pn','Wt','Śr','Cz','Pt','So','Nd'];

function dayDot(ev) {
  if (ev.kind === 'race') return C.red;
  if (ev.kind === 'training') return TYPE_COLOR[ev.type] || C.muted;
  return { Gravel:C.yellow, Road:C.cyan, Virtual:C.purple }[ev.sport] || C.green;
}

function Calendar() {
  const [month, setMonth] = useState(5);
  const [hover, setHover] = useState(null);
  const [openRide, setOpenRide] = useState(null);     // przeszła jazda → analiza (data ISO)
  const [openWorkout, setOpenWorkout] = useState(null); // przyszły trening → rozpiska
  const year = 2026;
  const todayStr = '2026-06-18';

  const first = new Date(year, month, 1);
  const startDow = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const monthEntries = Object.entries(calEvents)
    .filter(([ds]) => { const dd = new Date(ds); return dd.getMonth() === month && dd.getFullYear() === year; });
  const monthTSS = monthEntries.reduce((a, [, evs]) => a + evs.reduce((s, e) => s + (e.tss || 0), 0), 0);

  // Okno planu: 14 dni od dziś (7 szczegół + 7 zarys)
  const horizonEnd = new Date(todayStr); horizonEnd.setDate(horizonEnd.getDate() + 14);
  const horizonStr = horizonEnd.toISOString().slice(0,10);
  const upcoming = Object.entries(calEvents)
    .filter(([ds]) => ds >= todayStr && ds <= horizonStr)
    .sort(([a],[b]) => a.localeCompare(b));

  function EventRow({ ds, e }) {
    const d = new Date(ds);
    const days = Math.round((d - new Date(todayStr)) / 86400000);
    const c = dayDot(e);
    const tag = e.kind === 'race' ? (e.planned ? 'WYŚCIG' : 'WYŚCIG ✓')
      : e.kind === 'training' ? `PLAN · ${e.type}`
      : e.sport === 'Road' ? 'SZOSA' : e.sport === 'Gravel' ? 'GRAVEL' : e.sport === 'Virtual' ? 'ZWIFT' : 'JAZDA';
    const label = e.kind === 'training' ? (e.type === 'OFF' ? 'Odpoczynek' : e.label) : e.name;
    const meta = e.kind === 'race' ? `${e.loc||''}${e.series?` · ${e.series}`:''}${e.dist?` · ${e.dist}`:''}`
      : e.kind === 'training' ? (e.type==='OFF' ? 'Pełna regeneracja' : `${fmtDur(e.dur)} · ~TSS ${e.tss}${e.outline?' · zarys':''}`)
      : `${e.dist} km · ${e.ele} m · ${fmtTime(e.time)} · TSS ${e.tss}`;
    // Klikalność: jazda Strava z danymi analizy → analiza; przyszły trening ze szczegółem (nie outline, nie OFF) → rozpiska
    const hasAnalysis = e.kind === 'activity' && RIDE_DATA[ds];
    const isWorkout = e.kind === 'training' && e.type !== 'OFF' && !e.outline;
    const clickable = hasAnalysis || isWorkout;
    const onClick = hasAnalysis ? ()=>setOpenRide(ds)
      : isWorkout ? ()=>setOpenWorkout({ day:['Pn','Wt','Śr','Cz','Pt','So','Nd'][(d.getDay()+6)%7], date:`${String(d.getDate()).padStart(2,'0')}.${String(d.getMonth()+1).padStart(2,'0')}`, type:e.type, label:e.label, tss:e.tss, dur:e.dur, watt:e.watt||'–', hr:e.hr||'–', zones:e.zones||[20,60,20,0,0] })
      : undefined;
    return (
      <div onClick={onClick} style={{ ...card, padding:'12px 14px', display:'flex', alignItems:'center', gap:13, borderLeft: e.outline?`3px dashed ${c}`:`3px solid ${c}`, borderRadius:'0 12px 12px 0', cursor: clickable?'pointer':'default', opacity: e.outline?0.7:1, transition:'border-color 0.15s' }}
        onMouseEnter={clickable?(ev=>ev.currentTarget.style.background=C.card2):undefined}
        onMouseLeave={clickable?(ev=>ev.currentTarget.style.background=card.background):undefined}>
        <div style={{ width:46, textAlign:'center', flexShrink:0 }}>
          <div style={{ fontSize:18, fontWeight:600, color:c, lineHeight:1 }}>{d.getDate()}</div>
          <div style={{ fontSize:9, color:C.muted, textTransform:'uppercase' }}>{['sty','lut','mar','kwi','maj','cze','lip','sie','wrz','paź','lis','gru'][d.getMonth()]}</div>
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3 }}>
            <span style={{ fontSize:8, fontWeight:600, letterSpacing:'0.08em', color:c, background:c+'18', border:`1px solid ${c}44`, borderRadius:4, padding:'1px 6px', flexShrink:0 }}>{tag}</span>
            <span style={{ fontSize:13, fontWeight:600, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{label}</span>
          </div>
          <div style={{ fontSize:10, color:C.muted, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{meta}</div>
        </div>
        <div style={{ textAlign:'right', flexShrink:0, display:'flex', alignItems:'center', gap:8 }}>
          <div>
            <div style={{ fontSize:15, fontWeight:600, color: days===0?C.cyan:c }}>{days===0?'dziś':days>0?`+${days}`:days}</div>
            {days!==0 && <div style={{ fontSize:9, color:C.muted }}>dni</div>}
          </div>
          {clickable && <Icon name="chevR" size={14} color={c} />}
        </div>
      </div>
    );
  }

  return (
    <div style={{ position:'relative' }}>
      {openRide && <RideAnalysis act={{ date: openRide }} onClose={()=>setOpenRide(null)} />}
      {openWorkout && <WorkoutDetail d={openWorkout} onClose={()=>setOpenWorkout(null)} />}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14 }}>
        <button onClick={()=>{setMonth(m=>Math.max(2,m-1));setHover(null);}} disabled={month<=2} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, width:38, height:38, color: month<=2?C.dim:C.text, cursor: month<=2?'default':'pointer', fontSize:18 }}>‹</button>
        <div style={{ textAlign:'center' }}>
          <div style={{ fontSize:20, fontWeight:600 }}>{MONTHS_PL[month]} <span style={{ color:C.muted, fontWeight:400 }}>{year}</span></div>
          <div style={{ fontSize:10, color:C.muted, marginTop:1 }}>{monthEntries.length} wydarzeń · {monthTSS} TSS</div>
        </div>
        <button onClick={()=>{setMonth(m=>Math.min(9,m+1));setHover(null);}} disabled={month>=9} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:10, width:38, height:38, color: month>=9?C.dim:C.text, cursor: month>=9?'default':'pointer', fontSize:18 }}>›</button>
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:5, marginBottom:5 }}>
        {DOW_PL.map(d=><div key={d} style={{ textAlign:'center', fontSize:10, fontWeight:600, color:C.muted }}>{d}</div>)}
      </div>

      <div style={{ display:'grid', gridTemplateColumns:'repeat(7,1fr)', gap:5, marginBottom:6 }}>
        {cells.map((d, i) => {
          if (d === null) return <div key={i} />;
          const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          const evs = calEvents[ds] || [];
          const main = evs[0];
          const isToday = ds === todayStr;
          const isPast = ds < todayStr;
          const hasRace = evs.some(e=>e.kind==='race');
          const c = main ? dayDot(main) : C.border;
          const shortLabel = !main ? '' : main.kind==='race' ? main.name.split(' ').slice(0,2).join(' ')
            : main.kind==='training' ? (main.type==='OFF'?'Odpocz.':main.type)
            : main.sport==='Race' ? main.name.split(' ').slice(0,2).join(' ') : `${Math.round(main.dist)} km`;
          const cellRide = main && main.kind==='activity' && RIDE_DATA[ds] ? ds : null;
          // tylko treningi ze szczegółem (nie outline) otwierają pełną rozpiskę
          const cellWorkout = main && main.kind==='training' && main.type!=='OFF' && !main.outline ? main : null;
          const isOutline = main && main.kind==='training' && main.outline;
          const cellClick = cellRide ? ()=>setOpenRide(cellRide)
            : cellWorkout ? ()=>setOpenWorkout({ day:DOW_PL[(new Date(ds).getDay()+6)%7], date:`${String(d).padStart(2,'0')}.${String(month+1).padStart(2,'0')}`, type:cellWorkout.type, label:cellWorkout.label, tss:cellWorkout.tss, dur:cellWorkout.dur, watt:cellWorkout.watt||'–', hr:cellWorkout.hr||'–', zones:cellWorkout.zones||[20,60,20,0,0] })
            : undefined;
          return (
            <div key={i}
              onClick={cellClick}
              onMouseEnter={e=>{ if(evs.length){ const r=e.currentTarget.getBoundingClientRect(); const pr=e.currentTarget.offsetParent.getBoundingClientRect(); setHover({ ds, x:r.left-pr.left+r.width/2, y:r.top-pr.top, evs, day:d }); } }}
              onMouseLeave={()=>setHover(null)}
              style={{
                minHeight:60, borderRadius:9, padding:'5px 6px',
                background: hasRace ? C.red+'14' : isOutline ? C.card+'80' : evs.length ? C.card : 'transparent',
                border: isToday ? `1.5px solid ${C.cyan}` : hasRace ? `1px solid ${C.red}44` : isOutline ? `1px dashed ${C.border}` : evs.length ? `1px solid ${C.border}` : `1px solid ${C.border}33`,
                cursor: (cellRide||cellWorkout) ? 'pointer' : 'default',
                opacity: isPast && !evs.length ? 0.25 : isOutline ? 0.6 : 1,
                display:'flex', flexDirection:'column',
                transition:'transform .12s',
                transform: hover?.ds===ds ? 'scale(1.05)' : 'none',
              }}>
              <div style={{ fontSize:11, fontWeight: isToday?700:500, color: isToday?C.cyan:isPast?C.muted:C.text, marginBottom:3 }}>{d}</div>
              {main && (
                <div style={{ flex:1, display:'flex', flexDirection:'column' }}>
                  <div style={{ fontSize:8.5, fontWeight:600, lineHeight:1.15, color:c, overflow:'hidden', display:'-webkit-box', WebkitLineClamp:2, WebkitBoxOrient:'vertical' }}>{shortLabel}</div>
                  <div style={{ marginTop:'auto', display:'flex', alignItems:'center', gap:3 }}>
                    {main.tss>0 && <span style={{ fontSize:7.5, color:C.muted }}>TSS {main.tss}</span>}
                    {evs.length>1 && <span style={{ fontSize:7.5, color:C.cyan }}>+{evs.length-1}</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display:'flex', gap:14, flexWrap:'wrap', marginBottom:18, fontSize:10, color:C.muted }}>
        {[['Wyścig',C.red],['Plan',C.cyan],['Gravel',C.yellow],['Szosa',C.cyan],['Zwift',C.purple]].map(([l,c],i)=>(
          <span key={i} style={{ display:'flex', alignItems:'center', gap:5 }}><span style={{ width:7, height:7, borderRadius:'50%', background:c }} />{l}</span>
        ))}
      </div>

      <div style={{ fontSize:9, color:C.muted, letterSpacing:'0.12em', fontWeight:600, marginBottom:4 }}>PLAN NA NAJBLIŻSZE 14 DNI</div>
      <div style={{ fontSize:10, color:C.muted, marginBottom:12 }}>Pierwszy tydzień ze szczegółem · drugi tydzień orientacyjnie (dopina się po sesjach)</div>
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {(() => {
          const detailEnd = new Date(todayStr); detailEnd.setDate(detailEnd.getDate() + 7);
          const detailStr = detailEnd.toISOString().slice(0,10);
          const rows = [];
          let outlineStarted = false;
          upcoming.forEach(([ds, evs]) => {
            if (ds > detailStr && !outlineStarted) {
              outlineStarted = true;
              rows.push(
                <div key="sep-outline" style={{ display:'flex', alignItems:'center', gap:10, margin:'6px 2px 2px' }}>
                  <div style={{ flex:1, height:1, background:C.border }} />
                  <span style={{ fontSize:9, color:C.muted, fontWeight:600, letterSpacing:'0.1em' }}>ZARYS · KOLEJNY TYDZIEŃ</span>
                  <div style={{ flex:1, height:1, background:C.border }} />
                </div>
              );
            }
            evs.forEach((e, j) => rows.push(<EventRow key={ds+j} ds={ds} e={e} />));
          });
          return rows;
        })()}
      </div>

      {hover && (
        <div style={{
          position:'absolute', left: Math.min(Math.max(hover.x, 115), 805), top: hover.y - 10,
          transform:'translate(-50%, -100%)', zIndex:20, width:230,
          background:'#0E1B2B', border:`1px solid ${C.border}`, borderRadius:12, padding:'12px 14px',
          boxShadow:'0 12px 32px rgba(0,0,0,0.55)', pointerEvents:'none',
        }}>
          <div style={{ fontSize:11, color:C.muted, fontWeight:600, marginBottom:8 }}>{hover.day} {MONTHS_PL[month].toLowerCase()} {year}</div>
          {hover.evs.map((e,j)=>(
            <div key={j} style={{ marginBottom: j<hover.evs.length-1?10:0, paddingBottom: j<hover.evs.length-1?10:0, borderBottom: j<hover.evs.length-1?`1px solid ${C.border}`:'none' }}>
              {e.kind==='race' && (<>
                <div style={{ fontSize:9, color:C.red, fontWeight:600, letterSpacing:'0.08em', marginBottom:3 }}>● WYŚCIG {e.planned?'· PLAN':'· UKOŃCZONY'}</div>
                <div style={{ fontSize:13, fontWeight:600, marginBottom:2 }}>{e.name}</div>
                <div style={{ fontSize:10, color:C.muted }}>{e.loc?`${e.loc} · `:''}{e.series||''}{e.dist?` · ${e.dist}`:''}{e.tss?` · TSS ${e.tss}`:''}</div></>)}
              {e.kind==='training' && (<>
                <div style={{ fontSize:9, color:TYPE_COLOR[e.type], fontWeight:600, letterSpacing:'0.08em', marginBottom:3 }}>● PLAN · {e.type}</div>
                <div style={{ fontSize:13, fontWeight:600, marginBottom:2 }}>{e.label}</div>
                <div style={{ fontSize:10, color:C.muted }}>{e.dur?`${fmtDur(e.dur)} · `:''}{e.tss?`TSS ${e.tss}`:'regeneracja'}</div></>)}
              {e.kind==='activity' && (<>
                <div style={{ fontSize:9, color:dayDot(e), fontWeight:600, letterSpacing:'0.08em', marginBottom:3 }}>● {e.sport==='Road'?'SZOSA':e.sport==='Gravel'?'GRAVEL':e.sport==='Virtual'?'ZWIFT':'JAZDA'}</div>
                <div style={{ fontSize:13, fontWeight:600, marginBottom:2 }}>{e.name}</div>
                <div style={{ fontSize:10, color:C.muted }}>{e.dist} km · {e.ele} m · {fmtTime(e.time)} · TSS {e.tss}</div></>)}
            </div>
          ))}
          <div style={{ fontSize:9, color:C.cyan, marginTop:8, opacity:0.7 }}>Kliknij, by zobaczyć analizę →</div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────── RACES ───────────────────────────
function computeRacePrep(daysOut) {
  const now = pmc[pmc.length-1];
  const startCtl = 56;          // CTL when block started (post-Jakuszyce)
  const targetCtl = 66;         // target race-day CTL (near season peak)
  // Prep-to-goal: how far fitness has come toward race-day target
  const prep = Math.round(Math.min(100, Math.max(0, (now.ctl - startCtl) / (targetCtl - startCtl) * 100)));

  // Cycle phase by days out
  let phase, phaseColor;
  if (daysOut > 11) { phase = 'Budowanie'; phaseColor = C.cyan; }
  else if (daysOut > 5) { phase = 'Peak'; phaseColor = C.yellow; }
  else { phase = 'Taper'; phaseColor = C.green; }

  // Position along the whole prep block (0-100) for the timeline marker
  const blockWindow = 35;
  const blockPos = Math.round(Math.min(100, Math.max(0, (blockWindow - daysOut) / blockWindow * 100)));

  return { now, prep, phase, phaseColor, blockPos, targetCtl };
}

function Races() {
  const today = new Date('2026-06-18');
  const upcomingRaces = races.filter(r => new Date(r.date) >= today).sort((a,b)=>a.date.localeCompare(b.date));
  const target = upcomingRaces[0];
  const daysOut = Math.round((new Date(target.date) - today) / 86400000);
  const rp = computeRacePrep(daysOut);

  const [aiTips, setAiTips] = useState('');
  const [stratLoading, setStratLoading] = useState(false);
  const [stratOpen, setStratOpen] = useState(false);

  // Race course phases — pace plan with attack/save zones (Winterberg gravel ~110km)
  const racePhases = [
    { km:'0–25 km', terrain:'Start + płaskie', effort:'Tempo', pct:'78–85%', watt:'225–245W', zone:'save', note:'Trzymaj się grupy, nie pal zapałek' },
    { km:'25–55 km', terrain:'Pofałdowane', effort:'Sweet Spot', pct:'88–94%', watt:'255–272W', zone:'tempo', note:'Pozycjonuj się przed podjazdami' },
    { km:'55–80 km', terrain:'Główne podjazdy', effort:'Próg/VO2', pct:'95–108%', watt:'275–312W', zone:'attack', note:'Tu robisz wynik — Twój VO2max to atut' },
    { km:'80–110 km', terrain:'Finisz', effort:'Wszystko', pct:'do limitu', watt:'maks', zone:'attack', note:'Drugi żel kofeinowy 30min przed metą' },
  ];

  // Fueling timeline
  const fueling = [
    { t:'Start', item:'Baton', detail:'24g · żołądek spokojny' },
    { t:'+30min', item:'Żel', detail:'40g węgli' },
    { t:'1/3 trasy', item:'Żel kofeinowy', detail:'40g + kofeina' },
    { t:'co 25min', item:'Żel ×4', detail:'40g · cel 90g/h' },
    { t:'-30min meta', item:'Żel kofeinowy', detail:'końcowy zastrzyk' },
  ];

  const packing = [
    { n:'7×', item:'Żel energetyczny', detail:'40g węgli' },
    { n:'2×', item:'Żel kofeinowy', detail:'40g + kofeina' },
    { n:'2×', item:'Baton', detail:'24g' },
    { n:'2×', item:'Bidon', detail:'isotonic + woda' },
  ];

  async function genTips() {
    setStratLoading(true); setStratOpen(true);
    try {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:600, messages:[{ role:'user', content:`Jesteś AI strategiem VeloIQ. Zawodnik Adrian: FTP ${FTP}W, ${(FTP/MASS).toFixed(2)} W/kg, VO2max ${VO2MAX}, 67kg. Wyścig ${target.name} (gravel, ~110km), za ${daysOut} dni. Mocne: VO2max, podjazdy. Słabość: próg 20-60min. Napisz 3 KRÓTKIE spersonalizowane wskazówki taktyczne PO POLSKU (każda 1 zdanie, max 18 słów), zaczynające się od czasownika. Bez nagłówków, bez numeracji, każda w nowej linii. Konkretne, oparte na jego profilu.` }] })
      });
      const d = await r.json();
      setAiTips(d.content?.[0]?.text || '');
    } catch {
      setAiTips('Atakuj na podjazdach 55–80km — tam Twój VO2max daje przewagę nad rywalami.\nOszczędzaj nogi w grupie na płaskich pierwszych 25km, nie wychodź na prowadzenie.\nPilnuj progu na długich podjazdach — trzymaj 95% FTP zamiast strzelać w czerwone.');
    } finally { setStratLoading(false); }
  }

  const ringColor = rp.prep >= 80 ? C.green : rp.prep >= 45 ? C.cyan : C.yellow;

  // Tight-scaled CTL trend (last 21 days) so the rise is visible, not flat
  const ctlTrend = pmc.slice(-21).map(p=>({ label:p.label, ctl:p.ctl }));
  const ctlMin = Math.min(...ctlTrend.map(p=>p.ctl));
  const ctlMax = Math.max(...ctlTrend.map(p=>p.ctl));

  const phases = [
    { name:'Budowanie', sub:'objętość + próg', color:C.cyan },
    { name:'Peak', sub:'maks. obciążenie', color:C.yellow },
    { name:'Taper', sub:'wyostrzenie formy', color:C.green },
  ];
  const activePhaseIdx = daysOut > 11 ? 0 : daysOut > 5 ? 1 : 2;

  return (
    <>
      {/* Target race header */}
      <div style={{ ...card, marginBottom:10, padding:'18px', background:'#0C1827' }}>
        <div style={{ fontSize:9, color:C.green, letterSpacing:'0.12em', fontWeight:600, marginBottom:12 }}>NAJBLIŻSZY CEL · {target.series.toUpperCase()}</div>
        <div style={{ display:'flex', alignItems:'center', gap:18, flexWrap:'wrap' }}>
          {/* Prep-to-goal ring */}
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:8 }}>
            <div style={{ fontSize:8, color:C.muted, letterSpacing:'0.1em', fontWeight:600 }}>PRZYGOTOWANIE</div>
            <Ring pct={rp.prep} value={rp.prep} color={ringColor} />
            <div style={{ background:rp.phaseColor+'1E', color:rp.phaseColor, border:`1px solid ${rp.phaseColor}44`, borderRadius:20, padding:'4px 14px', fontSize:11, fontWeight:600 }}>Faza: {rp.phase}</div>
          </div>
          <div style={{ flex:1, minWidth:220 }}>
            <div style={{ fontWeight:600, fontSize:22, marginBottom:2 }}>{target.name}</div>
            <div style={{ color:C.muted, fontSize:12, marginBottom:14 }}>{target.loc} · {target.dist}</div>
            <div style={{ display:'flex', gap:20, marginBottom:14, alignItems:'center' }}>
              <div><div style={{ fontSize:34, fontWeight:600, color:C.green, lineHeight:1 }}>{daysOut}</div><div style={{ fontSize:10, color:C.muted }}>dni do startu</div></div>
              <div style={{ borderLeft:`1px solid ${C.border}`, paddingLeft:20, flex:1 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10 }}>
                  <div>
                    <div style={{ fontSize:13, fontWeight:600, color:C.cyan }}>Forma rośnie ↗</div>
                    <div style={{ fontSize:11, color:C.muted, marginTop:3 }}>cel: CTL {rp.targetCtl} na start</div>
                    <div style={{ fontSize:11, color:C.muted }}>jesteś na {Math.round(rp.now.ctl)} — {rp.prep}% drogi</div>
                  </div>
                  <div style={{ width:96, height:46 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={ctlTrend} margin={{top:6,right:2,left:2,bottom:2}}>
                        <YAxis domain={[ctlMin-1.5, ctlMax+1.5]} hide />
                        <Line type="monotone" dataKey="ctl" stroke={C.cyan} strokeWidth={2} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                    <div style={{ fontSize:8, color:C.muted, textAlign:'center', marginTop:-2 }}>21 dni</div>
                  </div>
                </div>
              </div>
            </div>
            <div style={{ fontSize:11, color:C.muted, background:C.bg, borderRadius:8, padding:'8px 10px', border:`1px solid ${C.border}` }}>
              🎯 Cel: top 25% → kwalifikacja Mistrzostwa Świata Nannup AU (10-11.10)
            </div>
          </div>
        </div>

        {/* Training cycle timeline */}
        <div style={{ marginTop:16, paddingTop:14, borderTop:`1px solid ${C.border}` }}>
          <div style={{ fontSize:9, color:C.muted, letterSpacing:'0.1em', fontWeight:600, marginBottom:12 }}>CYKL PRZYGOTOWAŃ DO STARTU</div>
          <div style={{ display:'flex', gap:6 }}>
            {phases.map((p,i)=>{
              const active = i===activePhaseIdx;
              const done = i<activePhaseIdx;
              return (
                <div key={i} style={{ flex: i===0?2:i===1?1:1, position:'relative' }}>
                  <div style={{ height:6, borderRadius:3, background: done?p.color : active?p.color : C.dim, opacity: done?0.4:active?1:1, marginBottom:8 }} />
                  <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:2 }}>
                    <span style={{ fontSize:12, fontWeight: active?700:500, color: active?p.color:done?C.muted:C.text }}>{p.name}</span>
                    {active && <span style={{ background:p.color, color:C.bg, fontSize:7, fontWeight:600, padding:'1px 6px', borderRadius:3, letterSpacing:'0.08em' }}>TERAZ</span>}
                  </div>
                  <div style={{ fontSize:9, color:C.muted }}>{p.sub}</div>
                </div>
              );
            })}
          </div>
          <div style={{ fontSize:11, color:C.text, marginTop:12, background:C.bg, borderRadius:8, padding:'9px 12px', border:`1px solid ${C.border}` }}>
            <b style={{color:C.cyan}}>Ten tydzień:</b> budujesz próg (Threshold) — Twoja luka z analiz. Peak za ~3 tygodnie, taper na 5 dni przed startem.
          </div>
        </div>
      </div>

      {/* AI RACE STRATEGY — structured, landing-page standard */}
      <div style={{ ...card, marginBottom:10, padding:'16px 18px' }}>
        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
          <span style={{ fontSize:9, color:C.yellow, letterSpacing:'0.12em', fontWeight:600 }}>STRATEGIA WYŚCIGU AI</span>
          <span style={{ fontSize:11, color:C.muted }}>· {target.name}</span>
        </div>

        {/* 1 — Pace plan by course phase */}
        <div style={{ fontSize:11, fontWeight:600, color:C.cyan, marginBottom:8 }}>Rozkład tempa na trasie</div>
        <div style={{ display:'flex', flexDirection:'column', gap:6, marginBottom:18 }}>
          {racePhases.map((p,i)=>{
            const zc = p.zone==='attack' ? C.red : p.zone==='tempo' ? C.yellow : C.green;
            const zl = p.zone==='attack' ? 'ATAK' : p.zone==='tempo' ? 'TEMPO' : 'OSZCZĘDZAJ';
            return (
              <div key={i} style={{ background:C.bg, borderRadius:9, border:`1px solid ${C.border}`, borderLeft:`3px solid ${zc}`, padding:'10px 12px', display:'flex', alignItems:'center', gap:12 }}>
                <div style={{ width:70, flexShrink:0 }}>
                  <div style={{ fontSize:11, fontWeight:600 }}>{p.km}</div>
                  <div style={{ fontSize:9, color:C.muted }}>{p.terrain}</div>
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:2 }}>
                    <span style={{ fontSize:7.5, fontWeight:600, color:zc, background:zc+'1E', border:`1px solid ${zc}44`, borderRadius:3, padding:'1px 6px', letterSpacing:'0.08em' }}>{zl}</span>
                    <span style={{ fontSize:11, fontWeight:600 }}>{p.effort}</span>
                    <span style={{ fontSize:10, color:C.cyan, fontWeight:600 }}>{p.watt}</span>
                    <span style={{ fontSize:9, color:C.muted }}>{p.pct} FTP</span>
                  </div>
                  <div style={{ fontSize:10, color:C.muted, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{p.note}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* 2 — Fueling timeline */}
        <div style={{ fontSize:11, fontWeight:600, color:C.cyan, marginBottom:8 }}>Strategia żeli i bidonów <span style={{color:C.muted, fontWeight:400}}>· cel 90g węgli/h</span></div>
        <div style={{ display:'flex', gap:6, marginBottom:18, overflowX:'auto' }}>
          {fueling.map((f,i)=>(
            <div key={i} style={{ flex:'1 0 auto', minWidth:96, background:C.bg, borderRadius:9, border:`1px solid ${C.border}`, padding:'10px', textAlign:'center' }}>
              <div style={{ fontSize:9, color:C.yellow, fontWeight:600, marginBottom:5 }}>{f.t}</div>
              <div style={{ fontSize:11, fontWeight:600, marginBottom:2 }}>{f.item}</div>
              <div style={{ fontSize:9, color:C.muted }}>{f.detail}</div>
            </div>
          ))}
        </div>

        {/* 3 — Packing + tires (two columns) */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:12, marginBottom:14 }}>
          <div>
            <div style={{ fontSize:11, fontWeight:600, color:C.cyan, marginBottom:8 }}>Co zabrać na start</div>
            <div style={{ background:C.bg, borderRadius:9, border:`1px solid ${C.border}`, padding:'10px 12px' }}>
              {packing.map((p,i)=>(
                <div key={i} style={{ display:'flex', alignItems:'center', gap:8, padding:'4px 0', borderBottom: i<packing.length-1?`1px solid ${C.border}`:'none' }}>
                  <span style={{ fontSize:12, fontWeight:600, color:C.yellow, width:26 }}>{p.n}</span>
                  <span style={{ fontSize:11, fontWeight:600, flex:1 }}>{p.item}</span>
                  <span style={{ fontSize:9, color:C.muted }}>{p.detail}</span>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize:11, fontWeight:600, color:C.cyan, marginBottom:8 }}>Opony i ciśnienie</div>
            <div style={{ background:C.bg, borderRadius:9, border:`1px solid ${C.border}`, padding:'10px 12px' }}>
              <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8 }}>
                <span style={{ fontSize:7.5, fontWeight:600, color:C.green, background:C.green+'1E', border:`1px solid ${C.green}44`, borderRadius:3, padding:'1px 6px', letterSpacing:'0.05em' }}>REKOMENDACJA</span>
                <span style={{ fontSize:9, color:C.muted }}>sucho · szybkie toczenie</span>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                <div style={{ background:C.card, borderRadius:7, padding:'9px 10px', borderTop:`2px solid ${C.cyan}` }}>
                  <div style={{ fontSize:8, color:C.muted, letterSpacing:'0.1em', fontWeight:600, marginBottom:3 }}>PRZÓD</div>
                  <div style={{ fontSize:12, fontWeight:600, marginBottom:1 }}>G One RS Pro</div>
                  <div style={{ fontSize:9, color:C.muted, marginBottom:6 }}>40c · najszybsza</div>
                  <div style={{ fontSize:16, fontWeight:600, color:C.cyan }}>1.9 <span style={{ fontSize:10, color:C.muted, fontWeight:500 }}>bar</span></div>
                </div>
                <div style={{ background:C.card, borderRadius:7, padding:'9px 10px', borderTop:`2px solid ${C.yellow}` }}>
                  <div style={{ fontSize:8, color:C.muted, letterSpacing:'0.1em', fontWeight:600, marginBottom:3 }}>TYŁ</div>
                  <div style={{ fontSize:12, fontWeight:600, marginBottom:1 }}>G One RS Pro</div>
                  <div style={{ fontSize:9, color:C.muted, marginBottom:6 }}>40c · najszybsza</div>
                  <div style={{ fontSize:16, fontWeight:600, color:C.yellow }}>2.1 <span style={{ fontSize:10, color:C.muted, fontWeight:500 }}>bar</span></div>
                </div>
              </div>
              <div style={{ fontSize:9, color:C.muted, marginTop:8, paddingTop:8, borderTop:`1px solid ${C.border}`, display:'flex', alignItems:'center', gap:5 }}>
                <span style={{ color:C.cyan }}>☔</span> Mokro / błoto → <b style={{color:C.text}}>G One R Pro</b> · więcej przyczepności · 1.7 / 1.9 bar
              </div>
            </div>
          </div>
        </div>

        {/* AI personalized tips */}
        {!stratOpen && (
          <button onClick={genTips} style={{ width:'100%', background:C.yellow+'14', color:C.yellow, border:`1px solid ${C.yellow}44`, borderRadius:9, padding:'11px', fontSize:12, fontWeight:600, cursor:'pointer' }}>
            ⚡ Wygeneruj taktykę AI pod Twój profil →
          </button>
        )}
        {stratLoading && <div style={{ color:C.muted, fontSize:12, fontStyle:'italic', textAlign:'center', padding:'8px' }}>AI analizuje Twoją formę i profil trasy...</div>}
        {aiTips && (
          <div style={{ background:`linear-gradient(160deg, ${C.yellow}10, ${C.bg})`, borderRadius:9, border:`1px solid ${C.yellow}33`, padding:'12px 14px' }}>
            <div style={{ fontSize:9, color:C.yellow, letterSpacing:'0.1em', fontWeight:600, marginBottom:8 }}>⚡ TAKTYKA AI POD TWÓJ PROFIL</div>
            {aiTips.split('\n').filter(l=>l.trim()).map((line,i)=>(
              <div key={i} style={{ display:'flex', gap:8, marginBottom:6, fontSize:12, lineHeight:1.5 }}>
                <span style={{ color:C.yellow }}>▸</span><span>{line.replace(/^[-•▸\d.]+\s*/,'')}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Upcoming races list */}
      <div style={{ fontSize:9, color:C.muted, letterSpacing:'0.12em', fontWeight:600, marginBottom:10 }}>KALENDARZ STARTÓW — sezon gravel 2026</div>
      <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
        {upcomingRaces.map((r,i)=>{
          const d = new Date(r.date);
          const days = Math.round((d - today) / 86400000);
          const accent = r.status==='goal' ? C.red : i===0 ? C.green : C.cyan;
          return (
            <div key={i} style={{ ...card, padding:'13px 16px', border: i===0?`1px solid ${C.green}55`:`1px solid ${C.border}`, display:'flex', alignItems:'center', gap:14 }}>
              <div style={{ width:50, textAlign:'center', borderRight:`1px solid ${C.border}`, paddingRight:14 }}>
                <div style={{ fontSize:20, fontWeight:600, color:accent, lineHeight:1 }}>{d.getDate()}</div>
                <div style={{ fontSize:10, color:C.muted, textTransform:'uppercase' }}>{['sty','lut','mar','kwi','maj','cze','lip','sie','wrz','paź','lis','gru'][d.getMonth()]}</div>
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:3, flexWrap:'wrap' }}>
                  <span style={{ fontSize:14, fontWeight:600 }}>{r.name}</span>
                  {i===0 && <span style={{ background:C.green+'22', color:C.green, borderRadius:4, padding:'1px 7px', fontSize:8, fontWeight:600, letterSpacing:'0.08em' }}>NAJBLIŻSZY</span>}
                  {r.status==='goal' && <span style={{ background:C.red+'22', color:C.red, borderRadius:4, padding:'1px 7px', fontSize:8, fontWeight:600, letterSpacing:'0.08em' }}>CEL SEZONU</span>}
                </div>
                <div style={{ fontSize:11, color:C.muted }}>{r.loc} · {r.series} · {r.dist}</div>
              </div>
              <div style={{ textAlign:'right' }}><div style={{ fontSize:18, fontWeight:600, color:accent }}>+{days}</div><div style={{ fontSize:9, color:C.muted }}>dni</div></div>
            </div>
          );
        })}
      </div>
    </>
  );
}


// ─────────────────────────── APP SHELL ───────────────────────────
export default function App() {
  const [tab, setTab] = useState('dash');
  const [ai, setAi] = useState(''); const [aiLoading, setAiLoading] = useState(true);
  const now = pmc[pmc.length-1], wk7 = pmc[pmc.length-8] || pmc[0];

  useEffect(()=>{
    (async()=>{
      try {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({ model:'claude-sonnet-4-6', max_tokens:300, messages:[{ role:'user', content:`Jesteś AI trenerem VeloIQ. Napisz AI Insight po polsku, MAKSYMALNIE 2 krótkie zdania (max 35 słów). Dane: dziś forma rośnie, ale nogi lekko zmęczone po mocnym treningu (TSB ${now.tsb}). Winterberg za 31 dni. WAŻNE: pisz PROSTYM, codziennym językiem jak do kolegi — ŻADNEGO żargonu typu "TSB", "adaptacja", "akcent progowy", "produktywne zmęczenie", "blok". Po prostu powiedz jak się czują nogi i co robić jutro. Mów do Adriana (Ty).` }] })
        });
        const d = await r.json(); setAi(d.content?.[0]?.text || '');
      } catch {
        setAi(`Nogi lekko zmęczone po dzisiejszym mocnym treningu — to dobrze, tak rośnie forma. Jutro odpocznij albo jedź spokojnie.`);
      } finally { setAiLoading(false); }
    })();
  },[]);

  const nav = [
    { id:'dash', icon:'pulse', label:'Forma' },
    { id:'plan', icon:'layers', label:'Plan' },
    { id:'coach', icon:'spark', label:'Trener AI' },
    { id:'cal', icon:'calendar', label:'Kalendarz' },
    { id:'races', icon:'flag', label:'Wyścigi' },
  ];

  return (
    <div style={{ background:C.bg, minHeight:'100vh', color:C.text, fontFamily:'-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', maxWidth:920, margin:'0 auto', display:'flex', flexDirection:'column' }}>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'16px 18px 12px', borderBottom:`1px solid ${C.border}` }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ width:30, height:30, background:C.text, borderRadius:8, display:'flex', alignItems:'center', justifyContent:'center', fontSize:14, fontWeight:600, color:C.bg }}>V</div>
          <span style={{ fontSize:17, fontWeight:600, letterSpacing:'0.06em' }}>VeloIQ</span>
        </div>
        <div style={{ display:'flex', alignItems:'center', gap:9 }}>
          <span style={{ fontWeight:600, fontSize:14 }}>Adrian Strychar</span>
          <span style={{ display:'inline-flex', alignItems:'center', gap:4, fontSize:10, color:C.muted }}>
            <span style={{ width:6, height:6, borderRadius:'50%', background:C.green, display:'inline-block' }} />
            Strava
          </span>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex:1, padding:'14px 18px 90px' }}>
        {tab==='dash' && <Dashboard ai={ai} aiLoading={aiLoading} />}
        {tab==='plan' && <Plan />}
        {tab==='coach' && <Coach />}
        {tab==='cal' && <Calendar />}
        {tab==='races' && <Races />}
      </div>

      {/* Bottom nav */}
      <div style={{ position:'fixed', bottom:0, left:0, right:0, maxWidth:920, margin:'0 auto', background:'rgba(8,14,22,0.92)', backdropFilter:'blur(12px)', borderTop:`1px solid ${C.border}`, display:'flex', justifyContent:'space-around', padding:'10px 0 14px' }}>
        {nav.map(n=>{
          const active = tab===n.id;
          return (
            <button key={n.id} onClick={()=>setTab(n.id)} style={{ background:'none', border:'none', cursor:'pointer', display:'flex', flexDirection:'column', alignItems:'center', gap:5, padding:'2px 14px', position:'relative' }}>
              {active && <span style={{ position:'absolute', top:-10, width:24, height:3, borderRadius:2, background:C.cyan }} />}
              <Icon name={n.icon} size={22} color={active?C.cyan:C.muted} sw={active?2:1.6} />
              <span style={{ fontSize:10, fontWeight: active?700:500, color: active?C.cyan:C.muted, letterSpacing:'0.01em' }}>{n.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
