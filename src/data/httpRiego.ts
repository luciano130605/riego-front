import { DEFAULT_SETTINGS, READ_EVERY_MIN } from '@/core/settings';
import type { Settings, Snapshot } from '@/core/types';
import {
  PUSH_KINDS,
  type ActionResult,
  type DeviceTestDetails,
  type DeviceTestResult,
  type PushKeyResult,
  type PushKind,
  type PushPrefs,
  type PushPrefsResult,
  type PushTestResult,
  type RelayDevice,
  type RelayStatus,
  type RiegoApi,
} from './api';
const API_ERROR = 'No se pudo conectar con el servidor.';
/** Respuestas de un proxy cuando el servidor de atrás no está: cuentan como "no responde". */
const GATEWAY_DOWN = new Set([502, 503, 504]);

/** Host de un túnel de VS Code: <id>-<puerto>.<región>.devtunnels.ms → [_, id, '.<región>.devtunnels.ms']. */
const TUNNEL_HOST = /^([a-z0-9]+)-\d+(\.[a-z0-9-]+\.devtunnels\.ms)$/i;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * "http://localhost:3000, https://api.example.com/" → ['http://localhost:3000', 'https://api.example.com']
 *
 * Si la pantalla se abre desde otro equipo de la red (por ejemplo http://192.168.0.192:5173), `localhost`
 * apuntaría a ese equipo y no al servidor: se reemplaza por el host con el que se abrió la pantalla.
 * `pageHost` es ese host (por defecto, el de la página actual).
 */
export function parseBaseUrls(
  value: string | string[],
  pageHost: string | undefined = typeof location === 'undefined' ? undefined : location.hostname,
): string[] {
  const list = Array.isArray(value) ? value : value.split(',');
  const urls = list.map((u) => u.trim().replace(/\/+$/, '')).filter(Boolean);
  if (!pageHost || LOOPBACK.has(pageHost)) return urls;
  // Túneles de VS Code (https://<id>-<puerto>.<región>.devtunnels.ms): cada puerto tiene su propio host, así que
  // http://localhost:3000 pasa a ser https://<id>-3000.<región>.devtunnels.ms (https, sin puerto en la URL).
  const tunnel = TUNNEL_HOST.exec(pageHost);
  const mapped = urls.map((u) => {
    try {
      const url = new URL(u);
      if (!LOOPBACK.has(url.hostname)) return u;
      if (tunnel) {
        const port = url.port || (url.protocol === 'https:' ? '443' : '80');
        return `https://${tunnel[1]}-${port}${tunnel[2]}${url.pathname === '/' ? '' : url.pathname}`;
      }
      url.hostname = pageHost;
      return url.toString().replace(/\/+$/, '');
    } catch {
      return u;
    }
  });
  return [...new Set(mapped)];
}

function isTunnelUrl(base: string): boolean {
  try {
    return new URL(base).hostname.toLowerCase().endsWith('.devtunnels.ms');
  } catch {
    return false;
  }
}

export type HttpRiegoOptions = {
  /** Para tests. Por defecto, el fetch del navegador. */
  fetch?: typeof fetch;
  /** Cada cuánto se vuelve a pedir el snapshot. */
  pollMs?: number;
  /** Cuánto se espera una respuesta antes de darla por perdida. */
  timeoutMs?: number;
};

function isSnapshot(x: unknown): x is Snapshot {
  if (typeof x !== 'object' || x === null) return false;
  const s = x as Record<string, unknown>;
  return (
    typeof s.now === 'number' &&
    Array.isArray(s.readings) &&
    Array.isArray(s.events) &&
    typeof s.settings === 'object' &&
    s.settings !== null &&
    typeof s.device === 'object' &&
    s.device !== null
  );
}

const CAL_POLL_MS = 2000;
/** Rutas de la calibración asistida (la doc del backend todavía no las fija: se cambian acá). */
const CAL_START = '/api/calibration/start';
const CAL_STOP = '/api/calibration/stop';

/** Convierte la respuesta del servidor en ActionResult, sin dar nada por hecho. */
async function toResult(res: Response): Promise<ActionResult> {
  let message: string | undefined;
  try {
    const body: unknown = await res.json();
    if (typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string') {
      message = (body as { error: string }).error;
    }
  } catch {
    // Sin cuerpo JSON: se usa un mensaje genérico.
  }
  if (res.ok) return { ok: true };
  return { ok: false, error: message ?? `El servidor respondió ${res.status}.` };
}

async function readBody(res: Response): Promise<Record<string, unknown>> {
  const data: unknown = await res.json().catch(() => null);
  return typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
}

function errorOf(res: Response, body: Record<string, unknown>): string {
  return typeof body.error === 'string' ? body.error : `El servidor respondió ${res.status}.`;
}

function parsePrefs(x: unknown): PushPrefs | undefined {
  if (typeof x !== 'object' || x === null) return undefined;
  const o = x as Record<string, unknown>;
  // Los tipos que el servidor no mande quedan activados (es el valor por defecto de un dispositivo nuevo).
  return Object.fromEntries(PUSH_KINDS.map((k) => [k, typeof o[k] === 'boolean' ? o[k] : true])) as PushPrefs;
}

/**
 * Habla con el backend por HTTP. Misma semántica que MockRiego para que la pantalla
 * no note la diferencia: snapshot estable (useSyncExternalStore), `load: 'loading'` al
 * arrancar, `error` con los últimos datos conocidos cuando falla la conexión.
 */
export class HttpRiego implements RiegoApi {
  private listeners = new Set<() => void>();
  private snapshot: Snapshot;
  private timer: ReturnType<typeof setInterval> | undefined;
  private offsetMs = 0; // servidor − reloj local
  private seq = 0; // pedidos enviados
  private applied = 0; // último pedido cuya respuesta ya se usó
  /** Mientras hay una calibración en curso se pide el snapshot cada pocos segundos. */
  private calTimer: ReturnType<typeof setInterval> | undefined;

  /** Servidores posibles, en orden de preferencia. Si el actual no responde se prueba el siguiente. */
  private readonly bases: string[];
  private active = 0;
  private readonly fetchFn: typeof fetch;
  private readonly pollMs: number;
  private readonly timeoutMs: number;

  constructor(baseUrl: string | string[], options: HttpRiegoOptions = {}) {
    this.bases = parseBaseUrls(baseUrl);
    if (this.bases.length === 0) throw new Error('Falta la URL del backend.');
    this.fetchFn = options.fetch ?? ((...args) => fetch(...args));
    this.pollMs = options.pollMs ?? 30_000;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.snapshot = {
      load: 'loading',
      now: Date.now(),
      readings: [],
      events: [],
      settings: DEFAULT_SETTINGS,
      device: { online: false, lastSeen: 0, readEveryMin: READ_EVERY_MIN },
      isDemo: false,
    };
  }

  // --- RiegoApi ----------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.timer === undefined) {
      this.timer = setInterval(() => void this.refresh(), this.pollMs);
      void this.refresh();
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.timer !== undefined) {
        clearInterval(this.timer);
        this.timer = undefined;
        this.stopCalPoll();
      }
    };
  };

  getSnapshot = (): Snapshot => this.snapshot;

  /** Hora del servidor, corregida por la diferencia con el reloj local. */
  now = (): number => Date.now() + this.offsetMs;

  updateSettings = (patch: Partial<Settings>): Promise<ActionResult> => this.act('PUT', '/api/settings', patch);

  waterNow = (): Promise<ActionResult> => this.act('POST', '/api/water');

  testRelay = (seconds: number): Promise<ActionResult> => this.act('POST', '/api/relay/test', { seconds });

  /**
   * Prueba del dispositivo conectado. Va SIN `seconds`: así el backend hace la prueba de conexión sobre el dispositivo
   * de prueba. Con `seconds` prendería el regador de verdad (eso es `testRelay`).
   */
  testDevice = async (): Promise<DeviceTestResult> => {
    const sent = await this.authed('POST', '/api/relay/test');
    if ('error' in sent) return { ok: false, error: sent.error };
    const body = await readBody(sent.res);
    if (!sent.res.ok) return { ok: false, error: errorOf(sent.res, body) };
    const message = typeof body.message === 'string' && body.message ? body.message : 'Prueba enviada.';
    const action = body.action === 'ring' || body.action === 'toggle' || body.action === 'status-only' ? body.action : undefined;
    const details: DeviceTestDetails = {
      ...(action ? { action } : {}),
      ...(typeof body.deviceName === 'string' && body.deviceName ? { deviceName: body.deviceName } : {}),
      ...(typeof body.code === 'string' ? { code: body.code } : {}),
      ...(typeof body.before === 'boolean' ? { before: body.before } : {}),
      ...(typeof body.seconds === 'number' ? { seconds: body.seconds } : {}),
    };
    return { ok: true, message, ...(Object.keys(details).length > 0 ? { details } : {}) };
  };

  /** Empieza la calibración: la placa manda lecturas seguidas y acá se siguen cada 2 s. */
  startCalibration = (): Promise<ActionResult> => this.act('POST', CAL_START);

  stopCalibration = (): Promise<ActionResult> => this.act('POST', CAL_STOP);

  relayStatus = async (): Promise<RelayStatus> => {
    try {
      const res = await this.request('/api/relay/status');
      const data: unknown = await res.json().catch(() => null);
      const body = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>;
      if (!res.ok) {
        return { ok: false, error: typeof body.error === 'string' ? body.error : `El servidor respondió ${res.status}.` };
      }
      if (typeof body.online !== 'boolean' || typeof body.on !== 'boolean') {
        return { ok: false, error: 'El servidor respondió algo inesperado.' };
      }
      return {
        ok: true,
        online: body.online,
        on: body.on,
        ...(typeof body.simulated === 'boolean' ? { simulated: body.simulated } : {}),
        ...(typeof body.example === 'boolean' ? { example: body.example } : {}),
        ...(typeof body.maxSeconds === 'number' ? { maxSeconds: body.maxSeconds } : {}),
        ...(typeof body.device === 'object' && body.device !== null ? { device: body.device as RelayDevice } : {}),
      };
    } catch {
      return { ok: false, error: API_ERROR };
    }
  };

  // --- Notificaciones push ----------------------------------------------------------

  /** La clave pública es de lectura libre: va sin sesión. */
  pushPublicKey = async (): Promise<PushKeyResult> => {
    try {
      const res = await this.request('/api/push/public-key');
      const body = await readBody(res);
      if (!res.ok) return { ok: false, error: errorOf(res, body) };
      if (typeof body.publicKey !== 'string' || !body.publicKey) {
        return { ok: false, error: 'El servidor respondió algo inesperado.' };
      }
      return { ok: true, publicKey: body.publicKey };
    } catch {
      return { ok: false, error: API_ERROR };
    }
  };

  pushSubscribe = (
    subscription: PushSubscriptionJSON,
    userAgent?: string,
    prefs?: Partial<PushPrefs>,
  ): Promise<PushPrefsResult> =>
    this.pushPrefsCall('POST', '/api/push/subscribe', {
      subscription,
      ...(userAgent ? { userAgent } : {}),
      ...(prefs ? { prefs } : {}),
    });

  pushUnsubscribe = async (endpoint: string): Promise<ActionResult> => {
    const sent = await this.authed('POST', '/api/push/unsubscribe', { endpoint });
    if ('error' in sent) return { ok: false, error: sent.error };
    return toResult(sent.res);
  };

  pushPreferences = (endpoint: string, prefs: Partial<PushPrefs>): Promise<PushPrefsResult> =>
    this.pushPrefsCall('PATCH', '/api/push/preferences', { endpoint, prefs });

  pushTest = async (endpoint: string, kind?: PushKind): Promise<PushTestResult> => {
    const sent = await this.authed('POST', '/api/push/test', kind ? { endpoint, type: kind } : { endpoint });
    if ('error' in sent) return { ok: false, error: sent.error };
    if (sent.res.ok) return { ok: true };
    return { ok: false, error: errorOf(sent.res, await readBody(sent.res)), status: sent.res.status };
  };

  private async pushPrefsCall(method: 'POST' | 'PATCH', path: string, payload: unknown): Promise<PushPrefsResult> {
    const sent = await this.authed(method, path, payload);
    if ('error' in sent) return { ok: false, error: sent.error };
    const body = await readBody(sent.res);
    if (!sent.res.ok) return { ok: false, error: errorOf(sent.res, body) };
    const prefs = parsePrefs(body.prefs);
    return prefs ? { ok: true, prefs } : { ok: false, error: 'El servidor respondió algo inesperado.' };
  }

  // --- Internos ----------------------------------------------------------------

  /** Pide el snapshot. Si falla, deja los últimos datos con `error`. */
  async refresh(): Promise<void> {
    const id = ++this.seq;
    const t0 = Date.now();
    let next: Snapshot;
    try {
      // Prueba primero el servidor que venía andando y, si falla, los demás.
      let data: Snapshot | undefined;
      for (const i of this.order()) {
        try {
          const res = await this.fetchOn(this.bases[i], '/api/snapshot');
          if (!res.ok) continue;
          const body: unknown = await res.json();
          if (!isSnapshot(body)) continue;
          data = body;
          this.active = i;
          break;
        } catch {
          // Sin conexión o tiempo agotado: se sigue con el siguiente.
        }
      }
      if (!data) throw new Error('Ningún servidor respondió');
      const t1 = Date.now();
      // Si llegó antes una respuesta más nueva, esta ya está vieja.
      if (id < this.applied) return;
      this.offsetMs = data.now - (t0 + t1) / 2;
      const { error: _error, ...rest } = data;
      next = { ...rest, load: 'ready', isDemo: false };
    } catch {
      if (id < this.applied) return;
      const prev = this.snapshot;
      next = { ...prev, load: 'ready', now: this.now(), error: API_ERROR, device: { ...prev.device, online: false } };
    }
    this.applied = id;
    this.snapshot = next;
    for (const l of this.listeners) l();
    this.syncCalPoll();
  }

  private syncCalPoll(): void {
    if (this.snapshot.device.calibration?.active && this.listeners.size > 0) {
      // Mientras calibra, las lecturas llegan en el snapshot: se lo pide seguido en vez de cada 30 s.
      this.calTimer ??= setInterval(() => void this.refresh(), CAL_POLL_MS);
    } else {
      this.stopCalPoll();
    }
  }

  private stopCalPoll(): void {
    if (this.calTimer !== undefined) {
      clearInterval(this.calTimer);
      this.calTimer = undefined;
    }
  }

  /** Índices de los servidores empezando por el que anda (y después los demás, en orden). */
  private order(): number[] {
    return [this.active, ...this.bases.map((_, i) => i).filter((i) => i !== this.active)];
  }

  private fetchOn(base: string, path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    // Los túneles de VS Code muestran una página de advertencia a los navegadores; con este encabezado dejan pasar
    // los pedidos de la pantalla directo al backend.
    if (isTunnelUrl(base)) headers.set('X-Tunnel-Skip-AntiPhishing-Page', 'true');
    return this.fetchFn(base + path, { ...init, headers, signal: AbortSignal.timeout(this.timeoutMs) });
  }

  /**
   * Hace el pedido al servidor que anda; si no responde (sin conexión, tiempo agotado o un 502/503/504
   * del proxy), prueba el otro y se queda con el que contestó.
   */
  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    let failure: unknown;
    let gateway: Response | undefined;
    for (const i of this.order()) {
      try {
        const res = await this.fetchOn(this.bases[i], path, init);
        if (GATEWAY_DOWN.has(res.status)) {
          gateway = res;
          continue;
        }
        this.active = i;
        return res;
      } catch (err) {
        failure = err;
      }
    }
    if (gateway) return gateway;
    throw failure;
  }

  /** Acción que cambia algo en el servidor. Lo que responde el servidor (también un error) se muestra tal cual. */
  private async act(method: 'PUT' | 'POST', path: string, body?: unknown): Promise<ActionResult> {
    const sent = await this.authed(method, path, body);
    if ('error' in sent) return { ok: false, error: sent.error };
    const result = await toResult(sent.res);
    await this.refresh(); // lo que se muestra siempre sale de lo que dice el servidor
    return result;
  }

  /** Pedido de una acción. Solo devuelve error si no hubo conexión. No refresca el snapshot. */
  private async authed(
    method: 'GET' | 'PUT' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<{ res: Response } | { error: string }> {
    const send = () =>
      this.request(path, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    try {
      return { res: await send() };
    } catch {
      return { error: API_ERROR };
    }
  }
}
