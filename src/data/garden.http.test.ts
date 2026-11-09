import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/core/settings';
import type { PlantView } from '@/core/types';
import { HttpRiego } from './httpRiego';

const BASE = 'http://localhost:3000';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const plant: PlantView = {
  id: 'plant-main',
  name: 'Monstera',
  sectorId: 'sector-interior',
  sensor: { deviceId: 'default', channel: 'main' },
  thresholdPct: null,
  targetPct: null,
  rawDry: 3100,
  rawWet: 1350,
  auto: true,
  sectorName: 'Interior',
  effectiveThresholdPct: 35,
  effectiveTargetPct: 55,
  moisture: 48,
  lastRaw: 2255,
  lastReadingAt: Date.now(),
  status: 'ok',
};

const snapshot = (extra: Record<string, unknown> = {}) => ({
  load: 'ready',
  now: Date.now(),
  readings: [],
  events: [],
  settings: DEFAULT_SETTINGS,
  device: { online: true, lastSeen: Date.now(), readEveryMin: 15 },
  isDemo: false,
  sectors: [{ id: 'sector-interior', name: 'Interior', thresholdPct: 35, targetPct: 55 }],
  plants: [plant],
  devices: [{ id: 'default', name: 'Placa', isDefault: true, online: true, lastSeen: Date.now() }],
  ...extra,
});

type Call = { method: string; path: string; body?: unknown };

function makeFetch(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      method: init?.method ?? 'GET',
      path: String(url).replace(BASE, ''),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return handler(call);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const ok = () => json({ ok: true });

describe('HttpRiego: sectores, plantas y placas llegan en el snapshot', () => {
  it('pasa tal cual sectors, plants y devices; un backend viejo no los manda', async () => {
    const { fn } = makeFetch(() => json(snapshot()));
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    await api.refresh();
    expect(api.getSnapshot().sectors).toHaveLength(1);
    expect(api.getSnapshot().plants![0]).toMatchObject({ id: 'plant-main', status: 'ok', effectiveThresholdPct: 35 });
    expect(api.getSnapshot().devices![0].id).toBe('default');

    const old = makeFetch(() => json({ ...snapshot(), sectors: undefined, plants: undefined, devices: undefined }));
    const api2 = new HttpRiego(BASE, { fetch: old.fn, storage: null });
    await api2.refresh();
    expect(api2.getSnapshot().plants).toBeUndefined();
  });
});

describe('HttpRiego: el ámbito (la planta que se mira)', () => {
  it('pide el snapshot con ?plantId= y vuelve a "cargando" hasta que llegan los datos', async () => {
    const { fn, calls } = makeFetch(() => json(snapshot()));
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    await api.refresh();
    expect(calls.at(-1)!.path).toBe('/api/snapshot');

    api.setPlantScope('plant-tomates');
    expect(api.getPlantScope()).toBe('plant-tomates');
    expect(api.getSnapshot().load).toBe('loading');
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.at(-1)!.path).toBe('/api/snapshot?plantId=plant-tomates');
    expect(api.getSnapshot().load).toBe('ready');

    api.setPlantScope(undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls.at(-1)!.path).toBe('/api/snapshot');
  });

  it('una respuesta de la planta anterior que llega tarde no pisa a la nueva', async () => {
    let release!: (r: Response) => void;
    const slow = new Promise<Response>((r) => (release = r));
    let n = 0;
    const { fn } = makeFetch((c) => {
      if (c.path === '/api/snapshot?plantId=a') return slow;
      n++;
      return json(snapshot({ readings: [{ t: 1, raw: 2000, moisture: 99 }] }));
    });
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    api.setPlantScope('a');
    await vi.advanceTimersByTimeAsync(0);
    api.setPlantScope('b');
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getSnapshot().readings[0]?.moisture).toBe(99);
    release(json(snapshot({ readings: [{ t: 1, raw: 2000, moisture: 11 }] })));
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getSnapshot().readings[0]?.moisture).toBe(99); // sigue la de "b"
    expect(n).toBeGreaterThan(0);
  });

  it('si la planta ya no existe (404) vuelve a la vista general', async () => {
    const { fn, calls } = makeFetch((c) => (c.path.includes('plantId=gone') ? json({ ok: false, error: 'No existe esa planta.' }, 404) : json(snapshot())));
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    api.setPlantScope('gone');
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getPlantScope()).toBeUndefined();
    expect(calls.at(-1)!.path).toBe('/api/snapshot');
    expect(api.getSnapshot().load).toBe('ready');
  });

  it('regar y calibrar van a la planta que se mira; sin ninguna, a las rutas de siempre', async () => {
    const { fn, calls } = makeFetch((c) => (c.path === '/api/snapshot' || c.path.startsWith('/api/snapshot?') ? json(snapshot()) : ok()));
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    await api.waterNow();
    await api.startCalibration();
    await api.stopCalibration();
    api.setPlantScope('p 1');
    await vi.advanceTimersByTimeAsync(0);
    await api.waterNow();
    await api.startCalibration();
    await api.stopCalibration();
    const acts = calls.filter((c) => c.method === 'POST').map((c) => c.path);
    expect(acts).toEqual([
      '/api/water',
      '/api/calibration/start',
      '/api/calibration/stop',
      '/api/plants/p%201/water',
      '/api/plants/p%201/calibration/start',
      '/api/plants/p%201/calibration/stop',
    ]);
  });
});

describe('HttpRiego: alta, edición y baja', () => {
  function server() {
    return makeFetch((c) => (c.path.startsWith('/api/snapshot') ? json(snapshot()) : ok()));
  }
  const acts = (calls: Call[]) => calls.filter((c) => !c.path.startsWith('/api/snapshot')).map((c) => ({ ...c }));

  it('sectores: POST, PUT parcial y DELETE', async () => {
    const { fn, calls } = server();
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    expect(await api.createSector({ name: 'Terraza', thresholdPct: 30, targetPct: 60 })).toEqual({ ok: true });
    expect(await api.updateSector('s1', { thresholdPct: 25 })).toEqual({ ok: true });
    expect(await api.deleteSector('s1')).toEqual({ ok: true });
    expect(acts(calls)).toEqual([
      { method: 'POST', path: '/api/sectors', body: { name: 'Terraza', thresholdPct: 30, targetPct: 60 } },
      { method: 'PUT', path: '/api/sectors/s1', body: { thresholdPct: 25 } },
      { method: 'DELETE', path: '/api/sectors/s1', body: undefined },
    ]);
  });

  it('plantas: crear, editar (mover de sector, umbral propio, automático), sensor, archivar, restaurar y regar', async () => {
    const { fn, calls } = server();
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    await api.createPlant({ name: 'Albahaca', sectorId: 's1', sensor: { deviceId: 'default', channel: 'ch2' }, thresholdPct: 40 });
    await api.updatePlant('p1', { sectorId: 's2', thresholdPct: null, auto: false });
    await api.setPlantSensor('p1', { deviceId: 'default', channel: 'main' });
    await api.setPlantSensor('p1', null);
    await api.archivePlant('p1');
    await api.restorePlant('p1');
    await api.waterPlant('p1');
    expect(acts(calls)).toEqual([
      { method: 'POST', path: '/api/plants', body: { name: 'Albahaca', sectorId: 's1', sensor: { deviceId: 'default', channel: 'ch2' }, thresholdPct: 40 } },
      { method: 'PUT', path: '/api/plants/p1', body: { sectorId: 's2', thresholdPct: null, auto: false } },
      { method: 'PUT', path: '/api/plants/p1/sensor', body: { sensor: { deviceId: 'default', channel: 'main' } } },
      { method: 'PUT', path: '/api/plants/p1/sensor', body: { sensor: null } },
      { method: 'DELETE', path: '/api/plants/p1', body: undefined },
      { method: 'POST', path: '/api/plants/p1/restore', body: undefined },
      { method: 'POST', path: '/api/plants/p1/water', body: undefined },
    ]);
  });

  it('un 409 o un 400 del servidor se muestra tal cual y no se da nada por hecho', async () => {
    const { fn } = makeFetch((c) => {
      if (c.path.startsWith('/api/snapshot')) return json(snapshot());
      if (c.path === '/api/plants/p1/sensor') return json({ ok: false, error: 'Ese canal ya lo usa otra planta.' }, 409);
      if (c.path === '/api/sectors') return json({ ok: false, error: 'El objetivo tiene que ser al menos 5 puntos mayor que el umbral.' }, 400);
      return json({ ok: false, error: 'No existe.' }, 404);
    });
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    expect(await api.setPlantSensor('p1', { deviceId: 'default', channel: 'main' })).toEqual({ ok: false, error: 'Ese canal ya lo usa otra planta.' });
    expect(await api.createSector({ name: 'X', thresholdPct: 40, targetPct: 42 })).toEqual({
      ok: false,
      error: 'El objetivo tiene que ser al menos 5 puntos mayor que el umbral.',
    });
    expect(await api.deleteSector('nope')).toEqual({ ok: false, error: 'No existe.' });
  });

  it('un 401 cierra la sesión y la acción no se da por hecha', async () => {
    const { fn } = makeFetch((c) => (c.path.startsWith('/api/snapshot') ? json(snapshot()) : json({ ok: false }, 401)));
    const api = new HttpRiego(BASE, { fetch: fn, storage: { getItem: () => 'x', setItem: () => {}, removeItem: () => {} } });
    expect(await api.createSector({ name: 'Z', thresholdPct: 30, targetPct: 55 })).toEqual({ ok: false, error: 'La sesión venció. Entrá de nuevo.' });
    expect(api.getAuthState().signedIn).toBe(false);
  });
});

describe('HttpRiego: calibración de la planta que se mira', () => {
  const dev = (calibration: unknown) => ({ id: 'default', name: 'Placa', isDefault: true, online: true, lastSeen: Date.now(), calibrating: { channel: 'main' }, calibration });

  it('el estado que llega en devices[] pasa a device.calibration (solo si es el canal de la planta)', async () => {
    const cal = { channel: 'main', until: 999, recent: [2000, 2001], points: { dry: 3100 } };
    const { fn } = makeFetch(() => json(snapshot({ devices: [dev(cal)] })));
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    await api.refresh();
    expect(api.getSnapshot().device.calibration).toEqual({ active: true, until: 999, recent: [2000, 2001] });

    const other = makeFetch(() => json(snapshot({ devices: [dev({ ...cal, channel: 'ch2' })] })));
    const api2 = new HttpRiego(BASE, { fetch: other.fn, storage: null });
    await api2.refresh();
    expect(api2.getSnapshot().device.calibration).toBeUndefined();
  });

  it('un device.calibration de otro canal o de otra placa no se toma por propio', async () => {
    const other = { active: true, until: 5, recent: [1] };
    // La placa calibra el canal ch2, pero la planta a la vista usa "main": no hay calibración para ella.
    const { fn } = makeFetch(() => json(snapshot({ device: { online: true, lastSeen: 1, readEveryMin: 15, calibration: other }, devices: [dev({ channel: 'ch2', until: 5, recent: [1] })] })));
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    await api.refresh();
    expect(api.getSnapshot().device.calibration).toBeUndefined();
    // Mismo nombre de canal, pero en otra placa: tampoco.
    const b = makeFetch(() => json(snapshot({ devices: [{ ...dev({ channel: 'main', until: 5, recent: [1] }), id: 'dev-terraza' }] })));
    const api2 = new HttpRiego(BASE, { fetch: b.fn, storage: null });
    await api2.refresh();
    expect(api2.getSnapshot().device.calibration).toBeUndefined();
  });

  it('tomar un punto va a la planta que se mira; con los dos, el servidor guarda y se actualiza', async () => {
    let saved = false;
    const { fn, calls } = makeFetch((c) =>
      c.path.endsWith('/calibration/capture') ? json(c.body && (c.body as { point: string }).point === 'wet' ? { ok: true, point: 'wet', value: 1350, saved: (saved = true), rawDry: 3100, rawWet: 1350 } : { ok: true, point: 'dry', value: 3100, saved: false, pending: {} }) : json(snapshot()),
    );
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    expect(await api.captureCalibration!('dry')).toEqual({ ok: true, saved: false });
    api.setPlantScope('p1');
    await vi.advanceTimersByTimeAsync(0);
    expect(await api.captureCalibration!('wet')).toEqual({ ok: true, saved: true });
    expect(saved).toBe(true);
    const caps = calls.filter((c) => c.path.endsWith('/capture'));
    expect(caps.map((c) => [c.path, c.body])).toEqual([
      ['/api/calibration/capture', { point: 'dry' }],
      ['/api/plants/p1/calibration/capture', { point: 'wet' }],
    ]);
  });

  it('un 409 del servidor (por ejemplo, lecturas que se mueven) se muestra tal cual', async () => {
    const { fn } = makeFetch((c) => (c.path.endsWith('/capture') ? json({ ok: false, error: 'Las lecturas todavía se mueven.' }, 409) : json(snapshot())));
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    expect(await api.captureCalibration!('dry')).toEqual({ ok: false, error: 'Las lecturas todavía se mueven.' });
  });

  it('con una planta a la vista, guardar rawDry/rawWet por ajustes no va a la primera planta', async () => {
    const { fn, calls } = makeFetch(() => json(snapshot()));
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    api.setPlantScope('p1');
    await vi.advanceTimersByTimeAsync(0);
    const res = await api.updateSettings({ rawDry: 3000, rawWet: 1300 });
    expect(res.ok).toBe(false);
    expect(calls.some((c) => c.path === '/api/settings')).toBe(false);
  });
});
