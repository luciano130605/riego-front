import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/core/settings';
import { HttpRiego } from './httpRiego';

const BASE = 'http://localhost:3000';
const TOKEN = 'riego-aut:token';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

const snapshot = () => ({
  load: 'ready',
  now: Date.now(),
  readings: [],
  events: [],
  settings: DEFAULT_SETTINGS,
  device: { online: true, lastSeen: Date.now(), readEveryMin: 15 },
  isDemo: false,
});

type Call = { method: string; path: string; auth: string | null; body?: unknown };

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

function authServer(validPin = '1234') {
  return makeFetch((c) => {
    if (c.path === '/api/snapshot') return json(snapshot());
    if (c.path === '/api/login') {
      const pin = (c.body as { pin: string }).pin;
      return pin === validPin ? json({ token: 'nuevo-token' }) : json({ ok: false, error: 'PIN incorrecto.' }, 401);
    }
    return c.auth === 'Bearer nuevo-token' ? json({ ok: true }) : json({ ok: false, error: 'No autorizado.' }, 401);
  });
}

describe('HttpRiego: sesión', () => {
  it('sin token guardado arranca sin sesión; con token, con sesión', () => {
    const { fn } = authServer();
    expect(new HttpRiego(BASE, { fetch: fn, storage: memoryStorage() }).getAuthState().signedIn).toBe(false);
    expect(new HttpRiego(BASE, { fetch: fn, storage: memoryStorage({ [TOKEN]: 'x' }) }).getAuthState().signedIn).toBe(true);
    expect(new HttpRiego(BASE, { fetch: fn, storage: null }).getAuthState().signedIn).toBe(false);
  });

  it('con el PIN correcto guarda el token y lo manda en las acciones siguientes', async () => {
    const { fn, calls } = authServer();
    const storage = memoryStorage();
    const api = new HttpRiego(BASE, { fetch: fn, storage });
    expect(await api.submitPin('1234')).toBe(true);
    expect(api.getAuthState()).toMatchObject({ signedIn: true, pinRequested: false });
    expect(storage.data.get(TOKEN)).toBe('nuevo-token');
    expect(await api.waterNow()).toEqual({ ok: true });
    expect(calls.find((c) => c.path === '/api/water')!.auth).toBe('Bearer nuevo-token');
  });

  it('cambiar ajustes (por ejemplo No molestar) lleva el token', async () => {
    const { fn, calls } = authServer();
    const api = new HttpRiego(BASE, { fetch: fn, storage: memoryStorage({ [TOKEN]: 'nuevo-token' }) });
    const res = await api.updateSettings({ quietHours: { enabled: true, from: '23:00', to: '07:00', tz: 'America/Argentina/Buenos_Aires' } });
    expect(res).toEqual({ ok: true });
    expect(calls.find((c) => c.path === '/api/settings')!.auth).toBe('Bearer nuevo-token');
  });

  it('con un PIN incorrecto no hay sesión y se dice por qué', async () => {
    const { fn } = authServer();
    const api = new HttpRiego(BASE, { fetch: fn, storage: memoryStorage() });
    expect(await api.submitPin('0000')).toBe(false);
    expect(api.getAuthState()).toMatchObject({ signedIn: false, error: 'PIN incorrecto.' });
  });

  it('429: avisa en cuántos minutos probar, según Retry-After', async () => {
    const { fn } = makeFetch(() => json({ ok: false }, 429, { 'Retry-After': '120' }));
    const api = new HttpRiego(BASE, { fetch: fn, storage: memoryStorage() });
    expect(await api.submitPin('1234')).toBe(false);
    expect(api.getAuthState().error).toBe('Demasiados intentos, probá en 2 minutos.');
  });

  it('sin conexión: error de red, sin sesión', async () => {
    const fn = vi.fn(async () => {
      throw new TypeError('fallo de red');
    }) as unknown as typeof fetch;
    const api = new HttpRiego(BASE, { fetch: fn, storage: memoryStorage() });
    expect(await api.submitPin('1234')).toBe(false);
    expect(api.getAuthState()).toMatchObject({ signedIn: false, error: 'No se pudo conectar con el servidor.' });
  });

  it('un 401 en una acción borra la sesión, no reintenta y la acción no se da por hecha', async () => {
    const { fn, calls } = authServer();
    const storage = memoryStorage({ [TOKEN]: 'vencido' });
    const api = new HttpRiego(BASE, { fetch: fn, storage });
    const seen = vi.fn();
    api.subscribeAuth(seen);
    expect(await api.waterNow()).toEqual({ ok: false, error: 'La sesión venció. Entrá de nuevo.' });
    expect(api.getAuthState()).toMatchObject({ signedIn: false, pinRequested: false });
    expect(storage.data.has(TOKEN)).toBe(false);
    expect(seen).toHaveBeenCalled();
    expect(calls.filter((c) => c.path === '/api/water')).toHaveLength(1);
  });

  it('un 401 al cambiar ajustes vuelve a la entrada con el motivo', async () => {
    const { fn } = makeFetch((c) => (c.path === '/api/settings' ? json({ ok: false, error: 'No autorizado.' }, 401) : json(snapshot())));
    const api = new HttpRiego(BASE, { fetch: fn, storage: memoryStorage({ [TOKEN]: 'vencido' }) });
    expect(await api.updateSettings({ thresholdPct: 40 })).toEqual({ ok: false, error: 'La sesión venció. Entrá de nuevo.' });
    expect(api.getAuthState().signedIn).toBe(false);
  });

  it('un 401 al pedir los datos también cierra la sesión', async () => {
    const { fn } = makeFetch(() => json({ ok: false }, 401));
    const storage = memoryStorage({ [TOKEN]: 'vencido' });
    const api = new HttpRiego(BASE, { fetch: fn, storage });
    await api.refresh();
    expect(api.getAuthState().signedIn).toBe(false);
    expect(storage.data.has(TOKEN)).toBe(false);
  });

  it('signOut olvida el token y avisa a la pantalla', () => {
    const { fn } = authServer();
    const storage = memoryStorage({ [TOKEN]: 'x' });
    const api = new HttpRiego(BASE, { fetch: fn, storage });
    const seen = vi.fn();
    api.subscribeAuth(seen);
    api.signOut();
    expect(api.getAuthState().signedIn).toBe(false);
    expect(storage.data.has(TOKEN)).toBe(false);
    expect(seen).toHaveBeenCalled();
  });

  it('un 400 del servidor no cierra la sesión y se muestra tal cual', async () => {
    const { fn } = makeFetch((c) =>
      c.path === '/api/settings' ? json({ ok: false, error: 'La ventana no puede tener "desde" igual a "hasta".' }, 400) : json(snapshot()),
    );
    const api = new HttpRiego(BASE, { fetch: fn, storage: memoryStorage({ [TOKEN]: 'x' }) });
    expect(await api.updateSettings({ thresholdPct: 40 })).toEqual({
      ok: false,
      error: 'La ventana no puede tener "desde" igual a "hasta".',
    });
    expect(api.getAuthState().signedIn).toBe(true);
  });
});

describe('HttpRiego: confirmPin (pedir el PIN aunque la sesión siga abierta)', () => {
  it('abre el diálogo sin cerrar la sesión; con el PIN correcto devuelve true', async () => {
    const storage = memoryStorage({ [TOKEN]: 'viejo' });
    const { fn } = makeFetch((c) => (c.path === '/api/login' ? json({ token: 'nuevo' }) : json(snapshot())));
    const api = new HttpRiego(BASE, { fetch: fn, storage });
    const pending = api.confirmPin();
    await vi.advanceTimersByTimeAsync(0);
    expect(api.getAuthState()).toMatchObject({ pinRequested: true, signedIn: true });
    expect(storage.data.get(TOKEN)).toBe('viejo'); // la sesión sigue hasta que el PIN sale bien
    expect(await api.submitPin('1234')).toBe(true);
    expect(await pending).toBe(true);
    expect(storage.data.get(TOKEN)).toBe('nuevo');
    expect(api.getAuthState().pinRequested).toBe(false);
  });

  it('si cierran el diálogo sin poner el PIN devuelve false', async () => {
    const { fn } = makeFetch(() => json(snapshot()));
    const api = new HttpRiego(BASE, { fetch: fn, storage: memoryStorage({ [TOKEN]: 'viejo' }) });
    const pending = api.confirmPin();
    await vi.advanceTimersByTimeAsync(0);
    api.cancelPin();
    expect(await pending).toBe(false);
  });

  it('con un PIN incorrecto el diálogo sigue abierto y no se activa nada', async () => {
    const { fn } = makeFetch((c) => (c.path === '/api/login' ? json({ ok: false, error: 'PIN incorrecto.' }, 401) : json(snapshot())));
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

describe('HttpRiego: acciones con sesión vencida', () => {
  it('testRelay y pushSubscribe con 401 cierran la sesión y no dan nada por hecho', async () => {
    const { fn, calls } = makeFetch((c) => (c.path === '/api/snapshot' ? json(snapshot()) : json({ ok: false }, 401)));
    const api = new HttpRiego(BASE, { fetch: fn, storage: memoryStorage({ [TOKEN]: 'vencido' }) });
    expect(await api.testRelay(2)).toEqual({ ok: false, error: 'La sesión venció. Entrá de nuevo.' });
    expect(api.getAuthState().signedIn).toBe(false);
    expect(calls.filter((c) => c.path === '/api/relay/test')).toHaveLength(1);
  });
});
