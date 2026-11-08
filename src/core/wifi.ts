import type { DeviceStatus } from './types';

/**
 * Cómo está el wifi de la placa, para decidir si hay que mostrar la guía para cargar una red nueva.
 * - connected: la placa reporta a tiempo.
 * - offline: dejó de reportar (se pasó de largo el próximo reporte): puede haber cambiado el router o la clave.
 * - reset: olvidó su red (IO0) y espera una nueva; sigue así hasta que vuelva a mandar una lectura.
 * - unknown: todavía no hay datos o no se puede hablar con el servidor, así que no se sabe (no se muestra nada).
 */
export type WifiState = 'connected' | 'offline' | 'reset' | 'unknown';

export function wifiState(
  device: Pick<DeviceStatus, 'lastSeen' | 'wifiResetAt'>,
  ctx: { reporting: boolean; loading: boolean; serverError: boolean },
): WifiState {
  if (ctx.loading || ctx.serverError) return 'unknown';
  // Una lectura posterior al reseteo quiere decir que ya se reconectó, aunque el servidor tarde en borrar `wifiResetAt`.
  if (device.wifiResetAt !== undefined && device.lastSeen <= device.wifiResetAt) return 'reset';
  return ctx.reporting ? 'connected' : 'offline';
}

/** ¿Hay que mostrar los pasos para cargar un wifi? */
export const needsWifiGuide = (state: WifiState): boolean => state === 'offline' || state === 'reset';
