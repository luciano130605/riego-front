import type { EwelinkSim } from './api';
import type { EwelinkStatus } from '@/core/types';

const KEY = 'riego-aut:ewelink-sim';
const VALID: EwelinkSim[] = ['vinculada', 'equipo-sin-conexion', 'sin-vincular', 'vencida', 'error'];
const DAY = 24 * 3_600_000;

/** El vínculo simulado se recuerda en este navegador (la "vuelta" de eWeLink recarga la página). */
export function loadEwelinkSim(): EwelinkSim {
  try {
    const v = typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);
    return VALID.includes(v as EwelinkSim) ? (v as EwelinkSim) : 'vinculada';
  } catch {
    return 'vinculada';
  }
}

export function saveEwelinkSim(state: EwelinkSim): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, state);
  } catch {
    // Sin almacenamiento: dura lo que dure la pestaña.
  }
}

/** Lo que respondería `GET /api/ewelink/status` en cada caso. */
export function ewelinkStatusFor(state: EwelinkSim, now: number): EwelinkStatus {
  const base = { configurado: true, region: 'us' as const };
  switch (state) {
    case 'vinculada':
      return { ...base, estado: 'vinculada', venceEl: now + 28 * DAY, dispositivo: { encontrado: true, enLinea: true } };
    case 'equipo-sin-conexion':
      return { ...base, estado: 'vinculada', venceEl: now + 28 * DAY, dispositivo: { encontrado: true, enLinea: false } };
    case 'vencida':
      return { ...base, estado: 'vencida', venceEl: now - 2 * DAY, dispositivo: { encontrado: false, enLinea: false } };
    case 'error':
      return { ...base, estado: 'error', venceEl: now + DAY, error: 'No se pudo renovar el acceso a eWeLink. Probá vincularla de nuevo.', dispositivo: { encontrado: false, enLinea: false } };
    default:
      return { ...base, estado: 'sin-vincular', venceEl: null, dispositivo: { encontrado: false, enLinea: false } };
  }
}
