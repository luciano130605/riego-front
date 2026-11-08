import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUSH_KINDS, type PushPrefs } from './api';
import { HttpRiego } from './httpRiego';
import { MockRiego, PUSH_NEEDS_BACKEND } from './mockRiego';

const BASE = 'https://api.test';
const SUB = { endpoint: 'https://push.test/abc', keys: { p256dh: 'p', auth: 'a' } };
const PREFS = Object.fromEntries(PUSH_KINDS.map((k) => [k, k !== 'placa-vuelve'])) as PushPrefs;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

type Call = { method: string; path: string; auth: string | null; body: unknown };

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
  };
}

const logged = () => memoryStorage({ 'riego-aut:token': 'T0KEN' });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('HttpRiego: notificaciones push', () => {
  it('pushPublicKey va sin sesión', async () => {
    const { fn, calls } = makeFetch(() => json({ publicKey: 'BKEY' }));
    const api = new HttpRiego(BASE, { fetch: fn, storage: logged() });
    expect(await api.pushPublicKey()).toEqual({ ok: true, publicKey: 'BKEY' });
    expect(calls[0]).toMatchObject({ method: 'GET', path: '/api/push/public-key', auth: null });
  });

  it('pushPublicKey: 503 devuelve el motivo del servidor', async () => {
    const { fn } = makeFetch(() => json({ ok: false, error: 'Sin claves VAPID.' }, 503));
    const api = new HttpRiego(BASE, { fetch: fn, storage: null });
    expect(await api.pushPublicKey()).toEqual({ ok: false, error: 'Sin claves VAPID.' });
  });

  it('pushSubscribe manda la suscripción con la sesión y devuelve las preferencias', async () => {
    const { fn, calls } = makeFetch(() => json({ ok: true, prefs: PREFS }));
    const api = new HttpRiego(BASE, { fetch: fn, storage: logged() });
    expect(await api.pushSubscribe(SUB, 'UA')).toEqual({ ok: true, prefs: PREFS });
    expect(calls[0]).toMatchObject({
      method: 'POST',
      path: '/api/push/subscribe',
      auth: 'Bearer T0KEN',
      body: { subscription: SUB, userAgent: 'UA' },
    });
  });

  it('pushSubscribe con 401 pide el PIN y reintenta', async () => {
    let entered = false;
    const { fn, calls } = makeFetch((c) => {
      if (c.path === '/api/login') {
        entered = true;
        return json({ token: 'NUEVO' });
      }
      return entered ? json({ ok: true, prefs: PREFS }) : json({ ok: false }, 401);
    });
    const api = new HttpRiego(BASE, { fetch: fn, storage: memoryStorage() });
    const pending = api.pushSubscribe(SUB);
    await vi.waitFor(() => expect(api.getAuthState().pinRequested).toBe(true));
    expect(await api.submitPin('1234')).toBe(true);
    expect(await pending).toEqual({ ok: true, prefs: PREFS });
    const sent = calls.filter((c) => c.path === '/api/push/subscribe');
    expect(sent).toHaveLength(2);
    expect(sent[1].auth).toBe('Bearer NUEVO');
  });

  it('pushUnsubscribe y pushPreferences usan las rutas del contrato', async () => {
    const { fn, calls } = makeFetch((c) =>
      c.path === '/api/push/unsubscribe' ? json({ ok: true, removed: true }) : json({ ok: true, prefs: PREFS }),
    );
    const api = new HttpRiego(BASE, { fetch: fn, storage: logged() });
    expect(await api.pushUnsubscribe(SUB.endpoint)).toEqual({ ok: true });
    expect(await api.pushPreferences(SUB.endpoint, { 'placa-vuelve': false })).toEqual({ ok: true, prefs: PREFS });
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/push/unsubscribe', body: { endpoint: SUB.endpoint } });
    expect(calls[1]).toMatchObject({
      method: 'PATCH',
      path: '/api/push/preferences',
      body: { endpoint: SUB.endpoint, prefs: { 'placa-vuelve': false } },
    });
  });

  it('pushPreferences: 404 (no suscripto) devuelve el error', async () => {
    const { fn } = makeFetch(() => json({ ok: false, error: 'Este dispositivo no está suscripto.' }, 404));
    const api = new HttpRiego(BASE, { fetch: fn, storage: logged() });
    expect(await api.pushPreferences(SUB.endpoint, {})).toEqual({ ok: false, error: 'Este dispositivo no está suscripto.' });
  });

  it('pushTest: ok, y 410 (venció) trae el status para volver a activar', async () => {
    let status = 200;
    const { fn, calls } = makeFetch(() =>
      status === 200 ? json({ ok: true }) : json({ ok: false, error: 'La suscripción venció.' }, status),
    );
    const api = new HttpRiego(BASE, { fetch: fn, storage: logged() });
    expect(await api.pushTest(SUB.endpoint)).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({ method: 'POST', path: '/api/push/test', body: { endpoint: SUB.endpoint } });
    status = 410;
    expect(await api.pushTest(SUB.endpoint)).toEqual({ ok: false, error: 'La suscripción venció.', status: 410 });
  });

  it('sin conexión devuelve el error de conexión', async () => {
    const fn = vi.fn(async () => {
      throw new Error('red');
    }) as unknown as typeof fetch;
    const api = new HttpRiego(BASE, { fetch: fn, storage: logged() });
    expect(await api.pushTest('x')).toEqual({ ok: false, error: 'No se pudo conectar con el servidor.' });
  });
});

describe('MockRiego: notificaciones push', () => {
  it('sin backend responde PUSH_NEEDS_BACKEND', async () => {
    const mock = new MockRiego({ loadMs: 0 });
    const err = { ok: false, error: PUSH_NEEDS_BACKEND };
    expect(await mock.pushPublicKey()).toEqual(err);
    expect(await mock.pushSubscribe({ endpoint: 'e' })).toEqual(err);
    expect(await mock.pushUnsubscribe('e')).toEqual(err);
    expect(await mock.pushPreferences('e', {})).toEqual(err);
    expect(await mock.pushTest('e')).toEqual(err);
  });

  it('con backend delega cada llamada', async () => {
    const backend = {
      pushPublicKey: vi.fn(async () => ({ ok: true as const, publicKey: 'K' })),
      pushSubscribe: vi.fn(async () => ({ ok: true as const, prefs: PREFS })),
      pushUnsubscribe: vi.fn(async () => ({ ok: true as const })),
      pushPreferences: vi.fn(async () => ({ ok: true as const, prefs: PREFS })),
      pushTest: vi.fn(async () => ({ ok: true as const })),
    };
    const mock = new MockRiego({ loadMs: 0, backend });
    expect(await mock.pushPublicKey()).toEqual({ ok: true, publicKey: 'K' });
    expect(await mock.pushSubscribe({ endpoint: 'e' }, 'UA')).toEqual({ ok: true, prefs: PREFS });
    expect(backend.pushSubscribe).toHaveBeenCalledWith({ endpoint: 'e' }, 'UA', undefined);
    await mock.pushPreferences('e', { 'placa-vuelve': false });
    expect(backend.pushPreferences).toHaveBeenCalledWith('e', { 'placa-vuelve': false });
    await mock.pushUnsubscribe('e');
    expect(await mock.pushTest('e')).toEqual({ ok: true });
    expect(backend.pushTest).toHaveBeenCalledWith('e');
  });
});
