import { ADC_MAX, isSaneRaw, rawToPercent } from './moisture';

/**
 * Calibración asistida del sensor capacitivo. Funciones puras: toman lecturas crudas y devuelven
 * números o un veredicto, sin React ni reloj. El sensor da valores MÁS ALTOS en seco que en agua.
 */

/** Cuántas lecturas se miran para decidir si el valor está quieto y para sacar la mediana. */
export const STABLE_WINDOW = 10;
/** Si entre la mayor y la menor de esas lecturas hay menos que esto (en cuentas), está estable. */
export const STABLE_RANGE = 80;
/** Diferencia mínima entre el valor en seco y en mojado para que la calibración sirva. */
export const MIN_SPAN = 300;
/** Cuántas lecturas se dibujan en el mini gráfico: 24 lecturas de 5 s son los últimos 2 minutos. */
export const CHART_POINTS = 24;

/** Mediana de una lista de números. null si está vacía. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Las últimas `n` lecturas crudas. La lista viene como la entrega el backend: la más nueva al final.
 * Las que no son un número finito (un dato corrupto) se descartan.
 */
export function lastSamples(raws: number[], n: number): number[] {
  return raws.filter((r) => Number.isFinite(r)).slice(-n);
}

export type Stability = {
  stable: boolean;
  /** Mayor menos menor de las últimas lecturas. null si todavía no hay las suficientes. */
  range: number | null;
  /** Cuántas lecturas hay de las que se necesitan. */
  have: number;
  need: number;
};

/** Estable = hay al menos STABLE_WINDOW lecturas y entre la mayor y la menor hay menos de STABLE_RANGE. */
export function stability(raws: number[]): Stability {
  const last = lastSamples(raws, STABLE_WINDOW);
  if (last.length < STABLE_WINDOW) {
    return { stable: false, range: null, have: last.length, need: STABLE_WINDOW };
  }
  const range = Math.max(...last) - Math.min(...last);
  return { stable: range < STABLE_RANGE, range, have: last.length, need: STABLE_WINDOW };
}

/** Valor que se toma para un paso: la mediana de las últimas lecturas, o null si no está estable. */
export function captureValue(raws: number[]): number | null {
  if (!stability(raws).stable) return null;
  const m = median(lastSamples(raws, STABLE_WINDOW));
  return m === null ? null : Math.round(m);
}

/** Cuántas lecturas reales (las últimas) se usan para la mediana cuando el servidor captura un punto. */
export const CAPTURE_SAMPLES = 5;

export type Capture = { ok: true; value: number } | { ok: false; error: string };

/**
 * Captura de un punto: mediana de las últimas CAPTURE_SAMPLES lecturas. Hacen falta todas y que estén quietas
 * (entre la mayor y la menor, menos de STABLE_RANGE); si no, no se toma nada.
 */
export function captureMedian(raws: number[]): Capture {
  const last = lastSamples(raws, CAPTURE_SAMPLES);
  if (last.length < CAPTURE_SAMPLES) {
    return { ok: false, error: `Todavía hay ${last.length} de ${CAPTURE_SAMPLES} lecturas: esperá unos segundos.` };
  }
  if (Math.max(...last) - Math.min(...last) >= STABLE_RANGE) {
    return { ok: false, error: 'La lectura todavía se mueve: esperá a que se quede quieta y reintentá.' };
  }
  return { ok: true, value: Math.round(median(last) as number) };
}

export type Validation = { ok: true } | { ok: false; error: string };

/**
 * El valor en seco tiene que ser mayor que el mojado y la diferencia, de al menos MIN_SPAN cuentas.
 * Con este módulo el aire da el máximo del ADC (4095): como punto SECO es válido. El mojado sí tiene que ser creíble.
 */
export function validateCalibration(rawDry: number, rawWet: number): Validation {
  const dryOk = Number.isFinite(rawDry) && rawDry > 40 && rawDry <= ADC_MAX; // el aire puede dar 4095 o cerca
  if (!dryOk || !isSaneRaw(rawWet)) {
    return { ok: false, error: 'El sensor da un valor imposible: revisá el cableado y el pin.' };
  }
  if (rawDry <= rawWet) {
    return {
      ok: false,
      error:
        'El valor en seco tiene que ser mayor que el mojado (el sensor da valores más altos en seco). Repetí los pasos en orden.',
    };
  }
  if (rawDry - rawWet < MIN_SPAN) {
    return { ok: false, error: 'El sensor casi no cambia entre aire y agua: revisá el cableado y el pin.' };
  }
  return { ok: true };
}

/** Vista previa: qué porcentaje de humedad daría el valor crudo actual con la calibración nueva. */
export function previewPercent(raw: number, rawDry: number, rawWet: number): number {
  return rawToPercent(raw, rawDry, rawWet);
}
