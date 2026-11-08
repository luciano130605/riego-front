const MIN = 60_000;
const H = 3_600_000;
const DAY = 86_400_000;

const WEEKDAY_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** Número con coma decimal (es-AR). */
export function num(n: number, digits = 0): string {
  return new Intl.NumberFormat('es-AR', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

/** "hace 6 min", "hace 2 h 10 min", "hace 1 d 16 h". */
export function formatAgo(ms: number): string {
  const m = Math.max(0, Math.round(ms / MIN));
  if (m < 1) return 'recién';
  return `hace ${formatDuration(m / 60)}`;
}

/** Duración corta a partir de horas: "45 min", "2 h 10 min", "1 d 3 h". */
export function formatDuration(hours: number): string {
  const totalMin = Math.max(0, Math.round(hours * 60));
  if (totalMin < 60) return `${totalMin} min`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h < 24) return m ? `${h} h ${m} min` : `${h} h`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return rh ? `${d} d ${rh} h` : `${d} d`;
}

/** Segundos de bomba: "30 s" por debajo del minuto y "1 min", "1 min 30 s" desde ahí. */
export function formatSeconds(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

const hm = new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function timeHM(t: number): string {
  return hm.format(t);
}

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Días de calendario entre t y now (0 = mismo día, 1 = ayer). */
export function dayDiff(t: number, now: number): number {
  return Math.round((startOfDay(now) - startOfDay(t)) / DAY);
}

/** "hoy", "ayer" o "lun 2". */
export function dayLabel(t: number, now: number): string {
  const diff = dayDiff(t, now);
  if (diff === 0) return 'hoy';
  if (diff === 1) return 'ayer';
  const d = new Date(t);
  return `${WEEKDAY_SHORT[d.getDay()]} ${d.getDate()}`;
}

export function dayAndTime(t: number, now: number): string {
  return `${dayLabel(t, now)} ${timeHM(t)}`;
}

const longDay = new Intl.DateTimeFormat('es-AR', { weekday: 'short', day: 'numeric', month: 'long' });

/** "jue, 5 de noviembre, 15:41". */
export function longDateTime(t: number): string {
  return `${longDay.format(t)}, ${timeHM(t)}`;
}

/** Intensidad de la señal wifi a partir de los dBm (más cerca de 0 es mejor). */
export function rssiQuality(dbm: number): 'excelente' | 'buena' | 'regular' | 'débil' {
  if (dbm >= -55) return 'excelente';
  if (dbm >= -67) return 'buena';
  if (dbm >= -75) return 'regular';
  return 'débil';
}

export const HOUR_MS = H;
