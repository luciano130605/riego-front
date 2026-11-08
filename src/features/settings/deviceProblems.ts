import { COMMS, resetReasonText } from '@/core/copy';
import { formatAgo } from '@/core/format';
import type { Snapshot } from '@/core/types';

const REJECTED_TEXT = {
  token: 'el token del firmware no coincide con el del servidor (DEVICE_TOKEN)',
  cuerpo: 'mandó un dato que el servidor no entiende (revisá el formato del envío)',
} as const;

/**
 * Errores de comunicación de la placa, tal cual los informa el servidor: envíos fallidos (`failedPosts`), el motivo del
 * último reinicio (`resetReason`) y el último envío rechazado. No se deduce ninguno de las lecturas: si el servidor no
 * informa nada, la lista queda vacía y la pantalla dice "Sin errores registrados".
 */
export function deviceProblems(snapshot: Pick<Snapshot, 'error' | 'now' | 'device'>, now: number = snapshot.now): string[] {
  const out: string[] = [];
  const { device } = snapshot;
  if (snapshot.error) out.push(snapshot.error);

  if (device.failedPosts !== undefined && device.failedPosts > 0) out.push(COMMS.failedPosts(device.failedPosts));
  if (device.resetReason) out.push(COMMS.resets(resetReasonText(device.resetReason)));

  // Un rechazo más nuevo que lo último que la placa mandó bien: intenta enviar y el servidor no la acepta.
  const rejected = device.lastRejected && device.lastRejected.t > device.lastSeen ? device.lastRejected : undefined;
  if (rejected && !snapshot.error) {
    out.push(`El servidor rechazó el último envío de la placa (${formatAgo(now - rejected.t)}): ${REJECTED_TEXT[rejected.reason]}.`);
  }
  return out;
}
