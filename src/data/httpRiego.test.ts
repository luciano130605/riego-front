import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/core/settings';
import type { Snapshot } from '@/core/types';
import { HttpRiego } from './httpRiego';

const BASE = 'https://api.test';

function serverSnapshot(over: Partial<Snapshot> = {}): Snapshot {
  return {
    load: 'ready',
    now: Date.now(),
    readings: [{ t: Date.now() - 60_000, raw: 2000, moisture: 62 }],
    events: [],
    settings: DEFAULT_SETTINGS,
    device: { online: true, lastSeen: Date.now() - 60_000, readEveryMin: 15 },
    isDemo: false,
    ...over,
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Call = { method: string; path: string; auth: string | null; body: unknown };

/** fetch simulado: cada ruta responde con lo que diga `handler`. */
function makeFetch(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call: Call = {
      method: init?.method ?? 'GET',
      path: String(url).replace(BASE, ''),
      auth: headers.get('Authorization'),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    return handler(call);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('HttpRiego: lectura', () => {
  it('arranca en loading y pasa a ready con los datos del servidor', async () => {
    const { fn } = makeFetch(() => json(serverSnapshot()));
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    expect(api.getSnapshot().load).toBe('loading');
    expect(api.getSnapshot().isDemo).toBe(false);

    const listener = vi.fn();
    api.subscribe(listener);
    await vi.advanceTimersByTimeAsync(0);
    const s = api.getSnapshot();
    expect(s.load).toBe('ready');
    expect(s.error).toBeUndefined();
    expect(s.readings).toHaveLength(1);
    expect(listener).toHaveBeenCalled();
  });

  it('devuelve el mismo objeto hasta que hay datos nuevos (useSyncExternalStore)', async () => {
    const { fn } = makeFetch(() => json(serverSnapshot()));
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    expect(api.getSnapshot()).toBe(api.getSnapshot());
    api.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getSnapshot()).toBe(api.getSnapshot());
  });

  it('corrige now() con la hora del servidor', async () => {
    const { fn } = makeFetch(() => json(serverSnapshot({ now: Date.now() + 3_600_000 })));
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    api.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(Math.abs(api.now() - (Date.now() + 3_600_000))).toBeLessThan(1000);
  });

  it('consulta cada 30 s mientras haya alguien suscripto y deja de hacerlo al irse', async () => {
    const { fn, calls } = makeFetch(() => json(serverSnapshot()));
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    const off = api.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(calls).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(calls).toHaveLength(4);
    off();
    await vi.advanceTimersByTimeAsync(120_000);
    expect(calls).toHaveLength(4);
    expect(calls.every((c) => c.path === '/api/snapshot')).toBe(true);
  });

  it('si falla el fetch muestra el error con los últimos datos y se recupera solo', async () => {
    let down = false;
    const { fn } = makeFetch(() => {
      if (down) throw new TypeError('Failed to fetch');
      return json(serverSnapshot());
    });
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    api.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);

    down = true;
    await vi.advanceTimersByTimeAsync(30_000);
    const bad = api.getSnapshot();
    expect(bad.error).toBe('No se pudo conectar con el servidor.');
    expect(bad.readings).toHaveLength(1); // últimos datos conocidos
    expect(bad.device.online).toBe(false);
    expect(bad.load).toBe('ready');

    down = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.getSnapshot().error).toBeUndefined();
    expect(api.getSnapshot().device.online).toBe(true);
  });

  it('un 503 o una respuesta rara también cuentan como error', async () => {
    const answers = [json({ ok: false }, 503), json({ cualquier: 'cosa' })];
    const { fn } = makeFetch(() => answers.shift()!);
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    api.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getSnapshot().error).toBeDefined();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(api.getSnapshot().error).toBeDefined();
  });

  it('ignora una respuesta vieja que llega después de una más nueva', async () => {
    const pending: Array<(r: Response) => void> = [];
    const { fn } = makeFetch(() => new Promise<Response>((resolve) => pending.push(resolve)));
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    const first = api.refresh();
    const second = api.refresh();
    pending[1](json(serverSnapshot({ readings: [], events: [{ t: 1, seconds: 5, source: 'auto' }] })));
    await second;
    pending[0](json(serverSnapshot({ readings: [], events: [] })));
    await first;
    expect(api.getSnapshot().events).toHaveLength(1);
  });
});

describe('HttpRiego: túneles de VS Code', () => {
  it('manda el encabezado que evita la página de advertencia solo a hosts devtunnels.ms', async () => {
    const seen: Array<{ url: string; skip: string | null }> = [];
    const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      seen.push({ url: String(url), skip: new Headers(init?.headers).get('X-Tunnel-Skip-AntiPhishing-Page') });
      return json(serverSnapshot());
    }) as unknown as typeof fetch;
    await new HttpRiego('https://j3prwv26-3000.brs.devtunnels.ms', { fetch: fn, storage: null }).refresh();
    await new HttpRiego('http://localhost:3000', { fetch: fn, storage: null }).refresh();
    expect(seen).toEqual([
      { url: 'https://j3prwv26-3000.brs.devtunnels.ms/api/snapshot', skip: 'true' },
      { url: 'http://localhost:3000/api/snapshot', skip: null },
    ]);
  });
});

describe('HttpRiego: acciones', () => {
  it('updateSettings manda un PUT con el token y vuelve a leer el snapshot', async () => {
    const { fn, calls } = makeFetch((c) => (c.path === '/api/snapshot' ? json(serverSnapshot()) : json({ ok: true })));
    const storage = memoryStorage({ 'riego-aut:token': 'tok123' });
    const api = new HttpRiego(BASE, { fetch: fn, storage });
    const result = await api.updateSettings({ waterSeconds: 8 });
    expect(result).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({ method: 'PUT', path: '/api/settings', auth: 'Bearer tok123', body: { waterSeconds: 8 } });
    expect(calls[1]).toMatchObject({ method: 'GET', path: '/api/snapshot' });
    expect(api.getSnapshot().load).toBe('ready');
  });

  it('waterNow manda un POST a /api/water', async () => {
    const { fn, calls } = makeFetch((c) => (c.path === '/api/snapshot' ? json(serverSnapshot()) : json({ ok: true })));
    const api = new HttpRiego(BASE, { fetch: fn, storage: memoryStorage({ 'riego-aut:token': 't' }) });
    expect(await api.waterNow()).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/water' });
  });

  it('devuelve el motivo del servidor cuando rechaza (por ejemplo, doble clic)', async () => {
    const { fn } = makeFetch((c) =>
      c.path === '/api/snapshot' ? json(serverSnapshot()) : json({ ok: false, error: 'La bomba ya está regando.' }, 409),
    );
    const api = new HttpRiego(BASE, { fetch: fn, storage: memoryStorage({ 'riego-aut:token': 't' }) });
    expect(await api.waterNow()).toEqual({ ok: false, error: 'La bomba ya está regando.' });
  });

  it('si no hay conexión no da la acción por hecha', async () => {
    const { fn } = makeFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    expect(await api.waterNow()).toEqual({ ok: false, error: 'No se pudo conectar con el servidor.' });
    expect(await api.updateSettings({ auto: false })).toEqual({ ok: false, error: 'No se pudo conectar con el servidor.' });
  });
});

describe('HttpRiego: PIN', () => {
  function authServer(validPin = '1234') {
    return makeFetch((c) => {
      if (c.path === '/api/snapshot') return json(serverSnapshot());
      if (c.path === '/api/login') {
        const pin = (c.body as { pin: string }).pin;
        return pin === validPin ? json({ token: 'nuevo-token' }) : json({ ok: false, error: 'PIN incorrecto.' }, 401);
      }
      return c.auth === 'Bearer nuevo-token' ? json({ ok: true }) : json({ ok: false, error: 'No autorizado.' }, 401);
    });
  }

  it('ante un 401 pide el PIN, guarda el token y reintenta la acción', async () => {
    const { fn, calls } = authServer();
    const storage = memoryStorage();
    const api = new HttpRiego(BASE, { fetch: fn, storage });
    const auth = vi.fn();
    api.subscribeAuth(auth);

    const pending = api.waterNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getAuthState().pinRequested).toBe(true);
    expect(auth).toHaveBeenCalled();

    expect(await api.submitPin('1234')).toBe(true);
    expect(await pending).toEqual({ ok: true });
    expect(api.getAuthState().pinRequested).toBe(false);
    expect(storage.data.get('riego-aut:token')).toBe('nuevo-token');
    const water = calls.filter((c) => c.path === '/api/water');
    expect(water).toHaveLength(2);
    expect(water[1].auth).toBe('Bearer nuevo-token');
  });

  it('con un PIN incorrecto el diálogo sigue abierto y muestra el motivo', async () => {
    const { fn } = authServer();
    const api = new HttpRiego(BASE, { fetch: fn, storage: memoryStorage() });
    void api.waterNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(await api.submitPin('0000')).toBe(false);
    expect(api.getAuthState()).toMatchObject({ pinRequested: true, error: expect.stringContaining('PIN') });
  });

  it('si se cancela, la acción falla sin dar nada por hecho', async () => {
    const { fn } = authServer();
    const api = new HttpRiego(BASE, { fetch: fn, storage: memoryStorage() });
    const pending = api.updateSettings({ auto: false });
    await vi.advanceTimersByTimeAsync(0);
    api.cancelPin();
    expect(await pending).toEqual({ ok: false, error: 'Hace falta el PIN para hacer cambios.' });
    expect(api.getAuthState().pinRequested).toBe(false);
  });

  it('un token vencido se descarta y se vuelve a pedir el PIN', async () => {
    const { fn } = authServer();
    const storage = memoryStorage({ 'riego-aut:token': 'vencido' });
    const api = new HttpRiego(BASE, { fetch: fn, storage });
    void api.waterNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getAuthState().pinRequested).toBe(true);
    expect(storage.data.has('riego-aut:token')).toBe(false);
  });

  it('dos acciones pendientes se resuelven con un solo PIN', async () => {
    const { fn } = authServer();
    const api = new HttpRiego(BASE, { fetch: fn, storage: memoryStorage() });
    const a = api.waterNow();
    const b = api.updateSettings({ auto: true });
    await vi.advanceTimersByTimeAsync(0);
    await api.submitPin('1234');
    expect(await a).toEqual({ ok: true });
    expect(await b).toEqual({ ok: true });
  });
});

describe('HttpRiego: regador', () => {
  it('relayStatus lee el estado, el modo y el tope que informa el servidor', async () => {
    const { fn, calls } = makeFetch((c) =>
      c.path === '/api/relay/status' ? json({ ok: true, online: true, on: false, simulated: true, maxSeconds: 30 }) : json(serverSnapshot()),
    );
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    expect(await api.relayStatus()).toEqual({ ok: true, online: true, on: false, simulated: true, maxSeconds: 30 });
    const call = calls.find((c) => c.path === '/api/relay/status')!;
    expect(call.method).toBe('GET');
    expect(call.auth).toBeNull(); // es público: no pide PIN
  });

  it('relayStatus informa el error si el servidor falla, no responde o contesta algo raro', async () => {
    const down = new HttpRiego(BASE, { fetch: makeFetch(() => json({ ok: false, error: 'Base caída' }, 503)).fn, storage: null });
    expect(await down.relayStatus()).toEqual({ ok: false, error: 'Base caída' });

    const gone = new HttpRiego(BASE, { fetch: (() => Promise.reject(new Error('red'))) as unknown as typeof fetch, storage: null });
    expect(await gone.relayStatus()).toEqual({ ok: false, error: 'No se pudo conectar con el servidor.' });

    const odd = new HttpRiego(BASE, { fetch: makeFetch(() => json({ hola: 1 })).fn, storage: null });
    expect(await odd.relayStatus()).toMatchObject({ ok: false });
  });

  it('testRelay manda los segundos con la sesión y devuelve el motivo si el servidor lo rechaza', async () => {
    const storage = memoryStorage({ 'riego-aut:token': 'T0KEN' });
    const { fn, calls } = makeFetch((c) =>
      c.path === '/api/relay/test'
        ? (c.body as { seconds: number }).seconds > 10
          ? json({ ok: false, error: 'El máximo para una prueba es 10 s.' }, 400)
          : json({ ok: true })
        : json(serverSnapshot()),
    );
    const api = new HttpRiego(BASE, { fetch: fn, storage });
    expect(await api.testRelay(5)).toEqual({ ok: true });
    const sent = calls.find((c) => c.path === '/api/relay/test')!;
    expect(sent).toMatchObject({ method: 'POST', auth: 'Bearer T0KEN', body: { seconds: 5 } });
    expect(await api.testRelay(20)).toEqual({ ok: false, error: 'El máximo para una prueba es 10 s.' });
  });

  it('testRelay con 401 pide el PIN y, si se entra, reintenta', async () => {
    let logged = false;
    const { fn, calls } = makeFetch((c) => {
      if (c.path === '/api/login') {
        logged = true;
        return json({ token: 'NUEVO' });
      }
      if (c.path === '/api/relay/test') return logged ? json({ ok: true }) : json({ ok: false, error: 'No autorizado.' }, 401);
      return json(serverSnapshot());
    });
    const api = new HttpRiego(BASE, { fetch: fn, storage: memoryStorage() });
    const pending = api.testRelay(2);
    await vi.waitFor(() => expect(api.getAuthState().pinRequested).toBe(true));
    expect(await api.submitPin('1234')).toBe(true);
    expect(await pending).toEqual({ ok: true });
    const tests = calls.filter((c) => c.path === '/api/relay/test');
    expect(tests).toHaveLength(2);
    expect(tests[1].auth).toBe('Bearer NUEVO');
  });

  it('testRelay: si cancelan el PIN, falla con un mensaje claro', async () => {
    const { fn } = makeFetch((c) => (c.path === '/api/relay/test' ? json({ ok: false }, 401) : json(serverSnapshot())));
    const api = new HttpRiego(BASE, { fetch: fn, storage: memoryStorage() });
    const pending = api.testRelay(2);
    await vi.waitFor(() => expect(api.getAuthState().pinRequested).toBe(true));
    api.cancelPin();
    expect(await pending).toEqual({ ok: false, error: 'Hace falta el PIN para hacer cambios.' });
  });
});

describe('HttpRiego: dos servidores (local y Railway)', () => {
  const LOCAL = 'http://localhost:3000';
  const REMOTE = 'https://api.test';

  /** fetch que solo contesta los servidores marcados como "arriba". */
  function twoServers(up: { local: boolean; remote: boolean }) {
    const hits: string[] = [];
    const fn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      const isLocal = u.startsWith(LOCAL);
      hits.push(isLocal ? 'local' : 'remote');
      if (isLocal ? !up.local : !up.remote) throw new TypeError('Failed to fetch');
      return json(u.endsWith('/api/snapshot') ? serverSnapshot() : { ok: true });
    });
    return { fn: fn as unknown as typeof fetch, hits };
  }

  it('parseBaseUrls acepta una lista con espacios y barras finales', async () => {
    const { parseBaseUrls } = await import('./httpRiego');
    expect(parseBaseUrls(' http://localhost:3000/ , https://a.b ,')).toEqual(['http://localhost:3000', 'https://a.b']);
    expect(parseBaseUrls('')).toEqual([]);
  });

  it('parseBaseUrls: abierta desde un túnel de VS Code, localhost:3000 pasa al túnel del puerto 3000 (https)', async () => {
    const { parseBaseUrls } = await import('./httpRiego');
    const page = 'j3prwv26-5173.brs.devtunnels.ms';
    expect(parseBaseUrls('http://localhost:3000,https://api.example.com', page)).toEqual([
      'https://j3prwv26-3000.brs.devtunnels.ms',
      'https://api.example.com',
    ]);
    expect(parseBaseUrls('http://127.0.0.1:8080', page)).toEqual(['https://j3prwv26-8080.brs.devtunnels.ms']);
    // Un host que parece de túnel pero no es devtunnels.ms no se toca como túnel.
    expect(parseBaseUrls('http://localhost:3000', 'abc-5173.example.com')).toEqual(['http://abc-5173.example.com:3000']);
  });

  it('parseBaseUrls cambia localhost por el host desde el que se abrió la pantalla (acceso por la red)', async () => {
    const { parseBaseUrls } = await import('./httpRiego');
    const value = 'http://localhost:3000,http://127.0.0.1:3000,https://api.example.com';
    expect(parseBaseUrls(value, '192.168.0.192')).toEqual(['http://192.168.0.192:3000', 'https://api.example.com']);
    // En la propia PC (localhost) o sin página, queda como está.
    expect(parseBaseUrls('http://localhost:3000', 'localhost')).toEqual(['http://localhost:3000']);
    expect(parseBaseUrls('http://localhost:3000', '127.0.0.1')).toEqual(['http://localhost:3000']);
    expect(parseBaseUrls('http://localhost:3000', undefined)).toEqual(['http://localhost:3000']);
    expect(() => new HttpRiego('  ', { storage: null })).toThrow();
  });

  it('usa el primero si responde y no toca el otro', async () => {
    const { fn, hits } = twoServers({ local: true, remote: true });
    const api = new HttpRiego(`${LOCAL},${REMOTE}`, { fetch: fn, storage: null });
    await api.refresh();
    expect(api.getSnapshot().error).toBeUndefined();
    expect(hits).toEqual(['local']);
  });

  it('si el primero (local) no responde, pasa al segundo (Railway) y se queda ahí', async () => {
    const { fn, hits } = twoServers({ local: false, remote: true });
    const api = new HttpRiego(`${LOCAL},${REMOTE}`, { fetch: fn, storage: null });
    await api.refresh();
    expect(api.getSnapshot().error).toBeUndefined();
    expect(hits).toEqual(['local', 'remote']);
    hits.length = 0;
    await api.refresh();
    expect(hits).toEqual(['remote']); // ya no vuelve a probar el que estaba caído primero
  });

  it('y al revés: si Railway se cae, vuelve al local', async () => {
    const up = { local: false, remote: true };
    const { fn, hits } = twoServers(up);
    const api = new HttpRiego(`${LOCAL},${REMOTE}`, { fetch: fn, storage: null });
    await api.refresh(); // queda en Railway
    up.remote = false;
    up.local = true;
    hits.length = 0;
    await api.refresh();
    expect(api.getSnapshot().error).toBeUndefined();
    expect(hits).toEqual(['remote', 'local']);
  });

  it('un 502 del proxy cuenta como caído y las acciones también pasan al otro servidor', async () => {
    const calls: string[] = [];
    const fn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u);
      if (u.startsWith(LOCAL)) return json({ error: 'Bad gateway' }, 502);
      return json(u.endsWith('/api/snapshot') ? serverSnapshot() : { ok: true });
    }) as unknown as typeof fetch;
    const api = new HttpRiego(`${LOCAL},${REMOTE}`, { fetch: fn, storage: memoryStorage({ 'riego-aut:token': 'T' }) });
    expect(await api.waterNow()).toEqual({ ok: true });
    expect(calls[0]).toBe(`${LOCAL}/api/water`);
    expect(calls[1]).toBe(`${REMOTE}/api/water`);
  });

  it('si ninguno responde, muestra el error de conexión con los últimos datos', async () => {
    const { fn } = twoServers({ local: false, remote: false });
    const api = new HttpRiego(`${LOCAL},${REMOTE}`, { fetch: fn, storage: null });
    await api.refresh();
    expect(api.getSnapshot().error).toBe('No se pudo conectar con el servidor.');
  });
});

describe('HttpRiego: calibración', () => {
  const calibrating = (recent: number[]) =>
    serverSnapshot({
      device: {
        online: true,
        lastSeen: Date.now(),
        readEveryMin: 15,
        calibration: { active: true, until: Date.now() + 600_000, recent },
      },
    });

  it('startCalibration y stopCalibration llaman a su ruta con la sesión', async () => {
    const storage = memoryStorage({ 'riego-aut:token': 'T0KEN' });
    const { fn, calls } = makeFetch((c) => (c.path.startsWith('/api/calibration') ? json({ ok: true }) : json(serverSnapshot())));
    const api = new HttpRiego(BASE, { fetch: fn, storage });
    expect(await api.startCalibration()).toEqual({ ok: true });
    expect(await api.stopCalibration()).toEqual({ ok: true });
    const sent = calls.filter((c) => c.path.startsWith('/api/calibration'));
    expect(sent.map((c) => `${c.method} ${c.path}`)).toEqual(['POST /api/calibration/start', 'POST /api/calibration/stop']);
    expect(sent.every((c) => c.auth === 'Bearer T0KEN')).toBe(true);
  });

  it('con 401 pide el PIN, y si el servidor la rechaza devuelve el motivo', async () => {
    const { fn } = makeFetch((c) =>
      c.path === '/api/calibration/start' ? json({ ok: false, error: 'Ya hay una calibración en curso.' }, 409) : json(serverSnapshot()),
    );
    const api = new HttpRiego(BASE, { fetch: fn, storage: memoryStorage({ 'riego-aut:token': 'T' }) });
    expect(await api.startCalibration()).toEqual({ ok: false, error: 'Ya hay una calibración en curso.' });
  });

  it('mientras hay una calibración activa pide el snapshot cada 2 s (no cada 30 s) y se detiene al terminar', async () => {
    let active = true;
    let n = 0;
    const { fn, calls } = makeFetch(() => {
      n++;
      return json(active ? calibrating([3000 + n]) : serverSnapshot());
    });
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    const unsub = api.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getSnapshot().device.calibration?.recent).toEqual([3001]);
    const before = calls.length;
    await vi.advanceTimersByTimeAsync(6_100);
    expect(calls.length - before).toBe(3); // cada 2 s
    expect(api.getSnapshot().device.calibration?.recent.length).toBe(1);
    active = false;
    await vi.advanceTimersByTimeAsync(2_100); // el siguiente pedido ya no trae calibración
    expect(api.getSnapshot().device.calibration).toBeUndefined();
    const after = calls.length;
    await vi.advanceTimersByTimeAsync(10_000); // y vuelve al ritmo normal (30 s): ningún pedido más
    expect(calls.length).toBe(after);
    unsub();
  });

  it('al dejar de mirar (nadie suscripto) corta el sondeo rápido', async () => {
    const { fn, calls } = makeFetch(() => json(calibrating([3000])));
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    const unsub = api.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    unsub();
    const n = calls.length;
    await vi.advanceTimersByTimeAsync(20_000);
    expect(calls.length).toBe(n);
  });
});

describe('HttpRiego: confirmPin (pedir el PIN aunque la sesión siga abierta)', () => {
  it('olvida el token y abre el diálogo; con el PIN correcto devuelve true y guarda la sesión nueva', async () => {
    const storage = memoryStorage({ 'riego-aut:token': 'viejo' });
    const { fn } = makeFetch((c) => (c.path === '/api/login' ? json({ token: 'nuevo' }) : json(serverSnapshot())));
    const api = new HttpRiego(BASE, { fetch: fn, storage });
    const pending = api.confirmPin();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getAuthState().pinRequested).toBe(true);
    expect(storage.data.has('riego-aut:token')).toBe(false); // la sesión vieja ya no sirve
    expect(await api.submitPin('1234')).toBe(true);
    expect(await pending).toBe(true);
    expect(storage.data.get('riego-aut:token')).toBe('nuevo');
    expect(api.getAuthState().pinRequested).toBe(false);
  });

  it('si cierran el diálogo sin poner el PIN devuelve false', async () => {
    const { fn } = makeFetch(() => json(serverSnapshot()));
    const api = new HttpRiego(BASE, { fetch: fn, storage: memoryStorage({ 'riego-aut:token': 'viejo' }) });
    const pending = api.confirmPin();
    await vi.advanceTimersByTimeAsync(0);
    api.cancelPin();
    expect(await pending).toBe(false);
  });

  it('con un PIN incorrecto el diálogo sigue abierto y no se activa nada', async () => {
    const { fn } = makeFetch((c) => (c.path === '/api/login' ? json({ ok: false, error: 'PIN incorrecto.' }, 401) : json(serverSnapshot())));
    const api = new HttpRiego(BASE, { fetch: fn, storage: memoryStorage() });
    let settled = false;
    void api.confirmPin().then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(await api.submitPin('0000')).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(false);
    expect(api.getAuthState()).toMatchObject({ pinRequested: true });
  });
});

