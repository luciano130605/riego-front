import type { DeviceTestDetails } from '@/data/api';

/** Nombre que se muestra si Smart Life no trae el del dispositivo de prueba. */
export const FALLBACK_TEST_NAME = 'Enchufe TV Lucho';

/** "toma 1" para `switch_1`; cualquier otra función se nombra tal cual. */
function partName(code: string | undefined): string {
  const m = /^switch_(\d+)$/i.exec(code ?? '');
  if (m) return `toma ${m[1]}`;
  return code ? `función ${code}` : 'toma 1';
}

export function testDeviceName(fromServer?: string, fromSnapshot?: string): string {
  return fromServer?.trim() || fromSnapshot?.trim() || FALLBACK_TEST_NAME;
}

/** Antes de probar: qué va a hacer el botón. */
export function testHint(snapshotName?: string): string {
  return `Si la toma 1 de “${testDeviceName(undefined, snapshotName)}” está apagada la prende, y si está prendida la apaga.`;
}

/** Después de probar: lo que hizo de verdad. Si el servidor no da el detalle, su mensaje tal cual. */
export function testResultText(message: string, details: DeviceTestDetails | undefined, snapshotName?: string): string {
  if (!details || details.action === undefined || details.action === 'status-only') return message;
  const name = testDeviceName(details.deviceName, snapshotName);
  if (details.action === 'ring') return `Sonó “${name}”.`;
  const part = partName(details.code);
  // `before` es cómo estaba: si estaba prendida, ahora quedó apagada, y al revés.
  return details.before === true ? `Se apagó la ${part} de “${name}”.` : `Se prendió la ${part} de “${name}”.`;
}
