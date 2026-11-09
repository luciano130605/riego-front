import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '@/core/settings';
import { startLinking, unlink } from '@/features/settings/ewelinkActions';
import { HttpRiego } from './httpRiego';

const BASE = 'http://localhost:3000';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const snapshot = () => ({
  load: 'ready',
  now: Date.now(),
  readings: [],
  events: [],
  settings: DEFAULT_SETTINGS,
  device: { online: true, lastSeen: Date.now(), readEveryMin: 15 },
  isDemo: false,
});

type Call = { method: string; path: string; auth: string | null };

function makeFetch(handler: (c: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const call: Call = { method: init?.method ?? 'GET', path: String(url).replace(BASE, ''), auth: headers.get('Authorization') };
    calls.push(call);
    return handler(call);
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

const memoryStorage = (initial: Record<string, string> = {}) => {
  const data = new Map(Object.entries(initial));
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), removeItem: (k: string) => void data.delete(k), data };
};

const STATUS = {
  ok: true,
  configurado: true,
  estado: 'vinculada',
  region: 'us',
  venceEl: 1_800_000_000_000,
  dispositivo: { encontrado: true, enLinea: true },
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('HttpRiego: GET /api/ewelink/status (público)', () => {
  it('lee el estado sin mandar la sesión', async () => {
    const { fn, calls } = makeFetch(() => json(STATUS));
    const api = new HttpRiego(BASE, { fetch: fn, storage: memoryStorage({ 'riego-aut:token': 'T' }) });
    const res = await api.ewelinkStatus();
    expect(res).toEqual({
      ok: true,
      status: { configurado: true, estado: 'vinculada', region: 'us', venceEl: 1_800_000_000_000, dispositivo: { encontrado: true, enLinea: true } },
    });
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/ewelink/status', auth: null });
  });

  it('cada estado del backend: sin vincular, vencida y error con su texto', async () => {
    for (const body of [
      { ...STATUS, estado: 'sin-vincular', region: null, venceEl: null },
      { ...STATUS, estado: 'vencida' },
      { ...STATUS, estado: 'error', error: 'No se pudo renovar el acceso.' },
    ]) {
      const { fn } = makeFetch(() => json(body));
      const r = await new HttpRiego(BASE, { fetch: fn, storage: null }).ewelinkStatus();
      expect(r.ok && r.status.estado).toBe(body.estado);
    }
  });

  it('un 404 (backend viejo) marca la sección como no disponible; otro error se muestra', async () => {
    const old = makeFetch(() => json({ ok: false, error: 'No existe.' }, 404));
    expect(await new HttpRiego(BASE, { fetch: old.fn, storage: null }).ewelinkStatus()).toEqual({ ok: false, error: 'No existe.', unavailable: true });
    const down = makeFetch(() => json({ ok: false, error: 'Base de datos no disponible.' }, 503));
    expect(await new HttpRiego(BASE, { fetch: down.fn, storage: null }).ewelinkStatus()).toEqual({ ok: false, error: 'Base de datos no disponible.' });
  });

  it('una respuesta rara no se convierte en un estado; sin conexión da el error de red', async () => {
    const weird = makeFetch(() => json({ ok: true, estado: 'quizas' }));
    expect((await new HttpRiego(BASE, { fetch: weird.fn, storage: null }).ewelinkStatus()).ok).toBe(false);
    const fn = vi.fn(async () => {
      throw new TypeError('red');
    }) as unknown as typeof fetch;
    expect(await new HttpRiego(BASE, { fetch: fn, storage: null }).ewelinkStatus()).toEqual({ ok: false, error: 'No se pudo conectar con el servidor.' });
  });
});

describe('HttpRiego: GET /api/ewelink/login (con la sesión del PIN)', () => {
  it('manda el token y devuelve la dirección de eWeLink', async () => {
    const { fn, calls } = makeFetch(() => json({ ok: true, url: 'https://c2ccdn.coolkit.cc/oauth2/authorize?state=abc' }));
    const api = new HttpRiego(BASE, { fetch: fn, storage: memoryStorage({ 'riego-aut:token': 'T0KEN' }) });
    expect(await api.ewelinkLogin()).toEqual({ ok: true, url: 'https://c2ccdn.coolkit.cc/oauth2/authorize?state=abc' });
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/ewelink/login', auth: 'Bearer T0KEN' });
  });

  it('nunca redirige a algo que no sea http(s)', async () => {
    for (const url of ['javascript:alert(1)', '/relativa', undefined]) {
      const { fn } = makeFetch(() => json({ ok: true, url }));
      const r = await new HttpRiego(BASE, { fetch: fn, storage: null }).ewelinkLogin();
      expect(r).toEqual({ ok: false, error: 'El servidor respondió algo inesperado.' });
    }
  });

  it('un 503 (eWeLink sin configurar) se muestra tal cual', async () => {
    const { fn } = makeFetch(() => json({ ok: false, error: 'eWeLink no está configurado: faltan las credenciales.' }, 503));
    expect(await new HttpRiego(BASE, { fetch: fn, storage: null }).ewelinkLogin()).toEqual({
      ok: false,
      error: 'eWeLink no está configurado: faltan las credenciales.',
    });
  });

  it('un 401 cierra la sesión y no redirige', async () => {
    const { fn } = makeFetch(() => json({ ok: false }, 401));
    const api = new HttpRiego(BASE, { fetch: fn, storage: memoryStorage({ 'riego-aut:token': 'vencido' }) });
    const redirected: string[] = [];
    const res = await startLinking(api, (u) => redirected.push(u));
    expect(res).toEqual({ ok: false, error: 'La sesión venció. Entrá de nuevo.' });
    expect(redirected).toEqual([]);
    expect(api.getAuthState().signedIn).toBe(false);
  });

  it('con una dirección buena, la acción redirige', async () => {
    const { fn } = makeFetch(() => json({ ok: true, url: 'https://eu-c2ccdn.coolkit.cc/oauth2/authorize' }));
    const redirected: string[] = [];
    const res = await startLinking(new HttpRiego(BASE, { fetch: fn, storage: null }), (u) => redirected.push(u));
    expect(res).toEqual({ ok: true });
    expect(redirected).toEqual(['https://eu-c2ccdn.coolkit.cc/oauth2/authorize']);
  });
});

describe('HttpRiego: DELETE /api/ewelink/link (desvincular)', () => {
  it('usa DELETE con la sesión y refresca los datos', async () => {
    const { fn, calls } = makeFetch((c) => (c.path === '/api/ewelink/link' ? json({ ok: true }) : json(snapshot())));
    const api = new HttpRiego(BASE, { fetch: fn, storage: memoryStorage({ 'riego-aut:token': 'T0KEN' }) });
    expect(await unlink(api)).toEqual({ ok: true });
    expect(calls.find((c) => c.path === '/api/ewelink/link')).toMatchObject({ method: 'DELETE', auth: 'Bearer T0KEN' });
  });

  it('un error del servidor se muestra y no se da por desvinculada', async () => {
    const { fn } = makeFetch((c) => (c.path === '/api/ewelink/link' ? json({ ok: false, error: 'Base de datos no disponible.' }, 503) : json(snapshot())));
    expect(await unlink(new HttpRiego(BASE, { fetch: fn, storage: null }))).toEqual({ ok: false, error: 'Base de datos no disponible.' });
  });
});
