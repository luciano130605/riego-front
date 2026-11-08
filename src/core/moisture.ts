export const ADC_MAX = 4095;

/** Desde este porcentaje la tierra se considera muy húmeda. */
export const WET_FROM = 80;

export type Level = 'dry' | 'ok' | 'wet';

/**
 * Convierte el valor crudo del sensor a porcentaje usando los dos puntos de
 * calibración. Funciona igual si el sensor sube o baja al mojarse, porque
 * interpola entre "seco" y "mojado" sin asumir cuál es mayor.
 */
export function rawToPercent(raw: number, rawDry: number, rawWet: number): number {
  if (rawDry === rawWet) return 0;
  const p = ((raw - rawDry) / (rawWet - rawDry)) * 100;
  return Math.min(100, Math.max(0, p));
}

export function percentToRaw(pct: number, rawDry: number, rawWet: number): number {
  return rawDry + ((rawWet - rawDry) * pct) / 100;
}

/**
 * Un valor pegado a los extremos del ADC casi siempre es un cable suelto
 * o un corto, no tierra seca o mojada. En ese caso no se debe regar.
 */
export function isSaneRaw(raw: number): boolean {
  return Number.isFinite(raw) && raw > 40 && raw < ADC_MAX - 40;
}

/** Por fuera de este rango la lectura no puede ser tierra: casi seguro es el sensor desconectado o con el cable suelto. */
export const SENSOR_RAW_MIN = 100;
export const SENSOR_RAW_MAX = 4000;

/**
 * ¿La lectura puede venir de un sensor conectado? Es el criterio con el que la pantalla dice "Sensor no
 * conectado", el mismo del aviso "sensor sospechoso" del servidor. Es más estricto que `isSaneRaw`, que solo
 * decide si el riego automático confía en el dato.
 */
export function isSensorConnected(raw: number): boolean {
  return Number.isFinite(raw) && raw >= SENSOR_RAW_MIN && raw <= SENSOR_RAW_MAX;
}

export function levelOf(moisture: number, thresholdPct: number): Level {
  if (moisture < thresholdPct) return 'dry';
  if (moisture >= WET_FROM) return 'wet';
  return 'ok';
}

export function clamp(x: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, x));
}
