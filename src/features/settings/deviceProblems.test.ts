import { describe, expect, it } from 'vitest';
import type { DeviceStatus, Snapshot } from '@/core/types';
import { deviceProblems } from './deviceProblems';

const NOW = 1_800_000_000_000;
const MIN = 60_000;

const snap = (device: Partial<DeviceStatus> = {}, error?: string): Pick<Snapshot, 'error' | 'now' | 'device'> => ({
  now: NOW,
  ...(error ? { error } : {}),
  device: { online: true, lastSeen: NOW - MIN, readEveryMin: 15, ...device },
});

describe('deviceProblems: lo que informa el servidor', () => {
  it('sin nada que informar la lista queda vacía (la pantalla dice "Sin errores registrados")', () => {
    expect(deviceProblems(snap())).toEqual([]);
  });

  it('muestra los envíos fallidos y el motivo del reinicio si vienen', () => {
    const out = deviceProblems(snap({ failedPosts: 3, resetReason: 'brownout' }));
    expect(out).toEqual(['Envíos fallidos: 3', 'Reinicios: baja tensión (brownout)']);
  });

  it('con 0 envíos fallidos no hay nada que mostrar', () => {
    expect(deviceProblems(snap({ failedPosts: 0 }))).toEqual([]);
  });

  it('un motivo de reinicio que no se conoce se muestra tal cual', () => {
    expect(deviceProblems(snap({ resetReason: 'raro-123' }))).toEqual(['Reinicios: raro-123']);
  });

  it('con la placa en línea nunca dice "no llegan lecturas", aunque la última lectura sea vieja', () => {
    const out = deviceProblems(snap({ online: true, lastSeen: NOW - 5 * 60 * MIN }));
    expect(out.join(' ')).not.toMatch(/no llegan|todavía no llegó/i);
  });

  it('sin la placa conectada tampoco inventa un error de lecturas: eso lo dice la fila de conexión', () => {
    expect(deviceProblems(snap({ online: false, lastSeen: NOW - 60 * MIN }))).toEqual([]);
  });

  it('no deduce nada del valor crudo: un 4095 no es un "error de comunicación"', () => {
    expect(deviceProblems(snap({ lastRaw: 4095 }))).toEqual([]);
  });

  it('muestra el error de conexión con el servidor y el último envío rechazado', () => {
    expect(deviceProblems(snap({}, 'No se pudo conectar con el servidor.'))).toEqual(['No se pudo conectar con el servidor.']);
    const out = deviceProblems(snap({ lastSeen: NOW - 30 * MIN, lastRejected: { t: NOW - 2 * MIN, status: 401, reason: 'token' } }));
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('DEVICE_TOKEN');
  });

  it('un rechazo anterior a la última lectura buena ya no se muestra', () => {
    expect(deviceProblems(snap({ lastSeen: NOW - MIN, lastRejected: { t: NOW - 10 * MIN, status: 401, reason: 'token' } }))).toEqual([]);
  });
});
