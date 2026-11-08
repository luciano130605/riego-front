import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/core/settings';
import type { Snapshot } from '@/core/types';
import type { ActionResult } from '@/data/api';
import { CalibrationFlow } from './calibrationFlow';

const T0 = new Date(2026, 5, 10, 12, 0, 0).getTime();
const MIN = 60_000;

/** API de mentira: la calibración y las lecturas se mueven con lo que haga el test. */
function fakeApi(opts: { startResult?: ActionResult; calMs?: number } = {}) {
  let listeners: Array<() => void> = [];
  const state = {
    now: T0,
    calibration: undefined as Snapshot['device']['calibration'],
    lastSeen: T0,
    error: undefined as string | undefined,
  };
  const calls: string[] = [];
  const snapshot = (): Snapshot => ({
    load: 'ready',
    now: state.now,
    readings: [],
    events: [],
    settings: DEFAULT_SETTINGS,
    device: { online: true, lastSeen: state.lastSeen, readEveryMin: 15, calibration: state.calibration },
    isDemo: false,
    ...(state.error ? { error: state.error } : {}),
  });
  const api = {
    subscribe: (l: () => void) => {
      listeners.push(l);
      return () => {
        listeners = listeners.filter((x) => x !== l);
      };
    },
    getSnapshot: snapshot,
    now: () => state.now,
    startCalibration: vi.fn(async (): Promise<ActionResult> => {
      calls.push('start');
      const res = opts.startResult ?? { ok: true };
      if (res.ok) state.calibration = { active: true, until: state.now + (opts.calMs ?? 10 * MIN), recent: [] };
      return res;
    }),
    stopCalibration: vi.fn(async (): Promise<ActionResult> => {
      calls.push('stop');
      state.calibration = undefined;
      return { ok: true };
    }),
  };
  /** La placa manda lecturas: se agregan a `recent` y pasa el tiempo. */
  const feed = (raws: number[], everyMs = 1000) => {
    for (const raw of raws) {
      state.now += everyMs;
      state.lastSeen = state.now;
      if (state.calibration) state.calibration = { ...state.calibration, recent: [...state.calibration.recent, raw].slice(-30) };
      for (const l of listeners) l();
    }
  };
  return { api, state, calls, feed };
}

const calm = (center: number) => Array.from({ length: 10 }, (_, i) => center + (i % 3) - 1);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function started(opts?: Parameters<typeof fakeApi>[0]) {
  const f = fakeApi(opts);
  const flow = new CalibrationFlow(f.api);
  flow.start();
  await vi.advanceTimersByTimeAsync(0);
  return { ...f, flow };
}

describe('CalibrationFlow: arranque y cierre', () => {
  it('llama a start, queda corriendo y muestra la cuenta regresiva', async () => {
    const { flow, calls, state } = await started();
    expect(calls).toEqual(['start']);
    expect(flow.getState().phase).toBe('running');
    expect(flow.getState().remainingMs).toBe(10 * MIN);
    state.now += 90_000;
    await vi.advanceTimersByTimeAsync(500);
    expect(flow.getState().remainingMs).toBe(10 * MIN - 90_000);
    flow.dispose();
  });

  it('si no se puede empezar, queda en error con el motivo y no manda un stop de más', async () => {
    const { flow, calls } = await started({ startResult: { ok: false, error: 'Hace falta el PIN.' } });
    expect(flow.getState()).toMatchObject({ phase: 'error', problem: 'Hace falta el PIN.' });
    flow.dispose();
    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toEqual(['start']);
  });

  it('"Terminar" llama a stop una sola vez', async () => {
    const { flow, calls } = await started();
    await flow.finish();
    expect(flow.getState()).toMatchObject({ phase: 'ended', end: 'finished' });
    flow.dispose();
    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toEqual(['start', 'stop']);
  });

  it('al cerrar el diálogo (dispose) en plena calibración llama a stop', async () => {
    const { flow, calls } = await started();
    flow.dispose();
    await vi.advanceTimersByTimeAsync(10);
    expect(calls).toEqual(['start', 'stop']);
  });

  it('si se cierra antes de que salga el pedido (doble montaje), no manda ni start ni stop', async () => {
    const f = fakeApi();
    const flow = new CalibrationFlow(f.api);
    flow.start();
    flow.dispose();
    await vi.advanceTimersByTimeAsync(10);
    expect(f.calls).toEqual([]);
  });

  it('si se cierra mientras arrancaba, el stop va cuando termina de arrancar', async () => {
    const f = fakeApi();
    let release!: () => void;
    f.api.startCalibration.mockImplementationOnce(
      () =>
        new Promise<ActionResult>((resolve) => {
          release = () => resolve({ ok: true });
        }),
    );
    const flow = new CalibrationFlow(f.api);
    flow.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(flow.getState().phase).toBe('starting');
    flow.dispose();
    release();
    await vi.advanceTimersByTimeAsync(10);
    expect(f.api.stopCalibration).toHaveBeenCalledTimes(1);
  });

  it('cuando pasa el tiempo, termina solo y llama a stop', async () => {
    const { flow, calls, state } = await started({ calMs: 30_000 });
    state.now += 31_000;
    await vi.advanceTimersByTimeAsync(500);
    expect(flow.getState()).toMatchObject({ phase: 'ended', end: 'timeout' });
    expect(calls).toEqual(['start', 'stop']);
  });
});

describe('CalibrationFlow: lecturas y estabilidad', () => {
  it('sigue las lecturas en vivo y dice si está estable (menos de 80 cuentas en las últimas 10)', async () => {
    const { flow, feed } = await started();
    feed([3100, 3101, 3099]);
    expect(flow.getState().lastRaw).toBe(3099);
    expect(flow.getState().stability).toMatchObject({ stable: false, have: 3 });
    feed(calm(3100));
    expect(flow.getState().stability.stable).toBe(true);
    feed([2500]);
    expect(flow.getState().stability.stable).toBe(false);
    flow.dispose();
  });

  it('avisa que está esperando si la placa deja de mandar lecturas seguidas', async () => {
    const { flow, feed, state } = await started();
    feed(calm(3100));
    expect(flow.getState().waiting).toBe(false);
    state.now += 20_000; // 20 s sin lecturas
    await vi.advanceTimersByTimeAsync(500);
    expect(flow.getState().waiting).toBe(true);
    flow.dispose();
  });

  it('si se cae la conexión con el servidor, también queda esperando', async () => {
    const { flow, feed, state } = await started();
    feed(calm(3100));
    state.error = 'No se pudo conectar con el servidor.';
    await vi.advanceTimersByTimeAsync(500);
    expect(flow.getState().waiting).toBe(true);
    flow.dispose();
  });
});

describe('CalibrationFlow: los dos pasos', () => {
  it('no deja usar el valor mientras se mueve', async () => {
    const { flow, feed } = await started();
    feed([3000, 2500, 3050, 2800, 3100, 2600, 3000, 2900, 3000, 2700]);
    flow.useAsDry();
    expect(flow.getState().step).toBe('air');
    expect(flow.getState().rawDry).toBeNull();
    expect(flow.getState().problem).toContain('se mueve');
    flow.dispose();
  });

  it('paso 1: toma la mediana de las últimas 10 como seco y pasa al agua', async () => {
    const { flow, feed } = await started();
    feed(calm(3100));
    flow.useAsDry();
    expect(flow.getState()).toMatchObject({ step: 'water', rawDry: 3100, problem: undefined });
    flow.dispose();
  });

  it('paso 2: toma el mojado, valida y pasa a la revisión', async () => {
    const { flow, feed } = await started();
    feed(calm(3100));
    flow.useAsDry();
    feed(calm(1350));
    flow.useAsWet();
    expect(flow.getState()).toMatchObject({ step: 'review', rawDry: 3100, rawWet: 1350 });
    flow.dispose();
  });

  it('si el sensor casi no cambia entre aire y agua, muestra el resultado con el aviso y no deja guardar', async () => {
    const { flow, feed, calls } = await started();
    feed(calm(3100));
    flow.useAsDry();
    feed(calm(2900)); // 200 de diferencia: menos de 300
    flow.useAsWet();
    expect(flow.getState()).toMatchObject({ step: 'review', rawDry: 3100, rawWet: 2900 });
    const check = flow.getState().check;
    expect(check?.ok).toBe(false);
    expect(check?.ok === false && check.error).toContain('casi no cambia');
    const save = vi.fn(async () => true);
    await flow.save(save);
    expect(save).not.toHaveBeenCalled();
    expect(flow.getState().problem).toContain('casi no cambia');
    expect(calls).toEqual(['start']); // sigue calibrando para poder repetir
    flow.dispose();
  });

  it('si los valores parecen invertidos (mojado más alto que seco), lo avisa y se puede repetir', async () => {
    const { flow, feed } = await started();
    feed(calm(1350));
    flow.useAsDry(); // el usuario lo hizo en agua primero
    feed(calm(3100));
    flow.useAsWet();
    const check = flow.getState().check;
    expect(check?.ok === false && check.error).toContain('mayor que el mojado');
    flow.restart();
    expect(flow.getState()).toMatchObject({ step: 'air', rawDry: null, rawWet: null, check: undefined, problem: undefined });
    flow.dispose();
  });

  it('con un rango bueno el resultado queda aprobado', async () => {
    const { flow, feed } = await started();
    feed(calm(3100));
    flow.useAsDry();
    feed(calm(1350));
    flow.useAsWet();
    expect(flow.getState().check).toEqual({ ok: true });
    flow.dispose();
  });

  it('guardar: llama a save con los dos valores, termina y llama a stop', async () => {
    const { flow, feed, calls } = await started();
    feed(calm(3100));
    flow.useAsDry();
    feed(calm(1350));
    flow.useAsWet();
    const save = vi.fn(async () => true);
    await flow.save(save);
    expect(save).toHaveBeenCalledWith({ rawDry: 3100, rawWet: 1350 });
    expect(flow.getState()).toMatchObject({ phase: 'ended', end: 'saved' });
    expect(calls).toEqual(['start', 'stop']);
  });

  it('si no se pudo guardar, lo avisa y la calibración sigue para reintentar', async () => {
    const { flow, feed, calls } = await started();
    feed(calm(3100));
    flow.useAsDry();
    feed(calm(1350));
    flow.useAsWet();
    await flow.save(async () => false);
    expect(flow.getState()).toMatchObject({ phase: 'running', step: 'review', saving: false });
    expect(flow.getState().problem).toContain('No se pudo guardar');
    expect(calls).toEqual(['start']);
    flow.dispose();
  });

  it('no guarda si todavía faltan los dos valores', async () => {
    const { flow } = await started();
    const save = vi.fn(async () => true);
    await flow.save(save);
    expect(save).not.toHaveBeenCalled();
    flow.dispose();
  });
});
