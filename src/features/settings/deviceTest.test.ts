import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceTestResult } from '@/data/api';
import { MockRiego } from '@/data/mockRiego';
import { DeviceTest, OK_VISIBLE_MS } from './deviceTest';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function deferred() {
  let resolve!: (r: DeviceTestResult) => void;
  const promise = new Promise<DeviceTestResult>((r) => (resolve = r));
  return { promise, resolve };
}

describe('DeviceTest', () => {
  it('no da la prueba por buena hasta que el servidor responde', async () => {
    const d = deferred();
    const t = new DeviceTest({ testDevice: () => d.promise });
    const run = t.run();
    expect(t.getState()).toEqual({ phase: 'testing' });
    d.resolve({ ok: true, message: 'Listo.' });
    await run;
    expect(t.getState()).toEqual({ phase: 'ok', message: 'Listo.' });
  });

  it('el éxito se ve 4 s y vuelve al reposo', async () => {
    const t = new DeviceTest({ testDevice: async () => ({ ok: true, message: 'Listo.' }) });
    await t.run();
    vi.advanceTimersByTime(OK_VISIBLE_MS - 1);
    expect(t.getState().phase).toBe('ok');
    vi.advanceTimersByTime(1);
    expect(t.getState().phase).toBe('idle');
  });

  it('el error del servidor se muestra tal cual y no vuelve solo', async () => {
    const t = new DeviceTest({ testDevice: async () => ({ ok: false, error: 'El regador ya está prendido.' }) });
    await t.run();
    vi.advanceTimersByTime(60_000);
    expect(t.getState()).toEqual({ phase: 'error', error: 'El regador ya está prendido.' });
  });

  it('evita el doble clic: mientras prueba, otro pedido no manda nada', async () => {
    const d = deferred();
    const testDevice = vi.fn(() => d.promise);
    const t = new DeviceTest({ testDevice });
    const first = t.run();
    await t.run();
    await t.run();
    expect(testDevice).toHaveBeenCalledTimes(1);
    d.resolve({ ok: true, message: 'ok' });
    await first;
  });

  it('si la llamada explota queda como error de conexión', async () => {
    const t = new DeviceTest({ testDevice: () => Promise.reject(new Error('x')) });
    await t.run();
    expect(t.getState()).toEqual({ phase: 'error', error: 'No se pudo conectar con el servidor.' });
  });

  it('desmontar y volver a montar (React en desarrollo) no pierde la respuesta', async () => {
    const d = deferred();
    const t = new DeviceTest({ testDevice: () => d.promise });
    t.attach();
    const run = t.run();
    t.dispose(); // StrictMode: cleanup del primer montaje
    t.attach(); // segundo montaje
    d.resolve({ ok: true, message: 'Listo.' });
    await run;
    expect(t.getState()).toEqual({ phase: 'ok', message: 'Listo.' });
  });

  it('con el simulador responde "Prueba simulada" tras ~800 ms', async () => {
    const api = new MockRiego({ loadMs: 0 });
    expect(api.getSnapshot().relay?.testAvailable).toBe(true);
    const t = new DeviceTest(api);
    const run = t.run();
    await vi.advanceTimersByTimeAsync(799);
    expect(t.getState().phase).toBe('testing');
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(t.getState()).toMatchObject({ phase: 'ok', message: 'Prueba simulada', details: { action: 'toggle', code: 'switch_1' } });
  });
});
