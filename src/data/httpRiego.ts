import { DEFAULT_SETTINGS, READ_EVERY_MIN } from '@/core/settings';
import type { PlantSensor, Settings, Snapshot } from '@/core/types';
import {
  PUSH_KINDS,
  type ActionResult,
  type CaptureResult,
  type AuthApi,
  type AuthState,
  type DeviceTestDetails,
  type PlantInput,
  type PlantPatch,
  type SectorInput,
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
import { LOGIN_NETWORK, loginErrorText } from './loginError';

const API_ERROR = LOGIN_NETWORK;
const SESSION_EXPIRED = 'La sesión venció. Entrá de nuevo.';
const TOKEN_KEY = 'riego-aut:token';
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

type TokenStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function defaultStorage(): TokenStorage | null {
  try {
    // Fuera del navegador (tests, servidor) no hay dónde guardar: la sesión dura lo que dure el objeto.
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * La calibración en curso llega en `devices[]` (por placa y canal). Si es la del canal de la planta que se mira, pasa a
 * `device.calibration`, que es donde la pantalla ya la lee.
 */
export function withCalibration(data: Snapshot, scope: string | undefined): Snapshot {
  if (data.device.calibration || !data.devices || !data.plants) return data;
  const plant = scope ? data.plants.find((p) => p.id === scope) : data.plants[0];
  const sensor = plant?.sensor;
  const cal = sensor ? data.devices.find((d) => d.id === sensor.deviceId)?.calibration : undefined;
  if (!sensor || !cal || cal.channel !== sensor.channel) return data;
  return { ...data, device: { ...data.device, calibration: { active: true, until: cal.until, recent: cal.recent } } };
}

export type HttpRiegoOptions = {
  /** Para tests. Por defecto, el fetch del navegador. */
  fetch?: typeof fetch;
  /** Cada cuánto se vuelve a pedir el snapshot. */
  pollMs?: number;
  /** Cuánto se espera una respuesta antes de darla por perdida. */
  timeoutMs?: number;
  /** Dónde se guarda el token de sesión. null = solo en memoria. */
  storage?: TokenStorage | null;
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
export class HttpRiego implements RiegoApi, AuthApi {
  private listeners = new Set<() => void>();
  private authListeners = new Set<() => void>();
  private auth: AuthState = { pinRequested: false, signedIn: false };
  private pinWaiters: Array<(ok: boolean) => void> = [];
  private token: string | undefined;
  /** Qué planta mira la pantalla (undefined = la vista general: la primera planta). */
  private scope: string | undefined;
  private readonly storage: TokenStorage | null;
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
    this.storage = options.storage === undefined ? defaultStorage() : options.storage;
    try {
      this.token = this.storage?.getItem(TOKEN_KEY) ?? undefined;
    } catch {
      this.token = undefined;
    }
    this.auth = { pinRequested: false, signedIn: this.token !== undefined };
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

  updateSettings = (patch: Partial<Settings>): Promise<ActionResult> => {
    // La calibración de una planta la guarda el servidor al tomar sus dos puntos (`captureCalibration`): el PUT de ajustes
    // sin planta iría a la primera, no a la que se mira.
    if (this.scope && (patch.rawDry !== undefined || patch.rawWet !== undefined)) {
      return Promise.resolve({ ok: false, error: 'La calibración de una planta se guarda al tomar sus dos puntos.' });
    }
    return this.act('PUT', '/api/settings', patch);
  };

  /** Con una planta a la vista riega esa; en la vista general, la primera (como siempre). */
  waterNow = (): Promise<ActionResult> =>
    this.scope ? this.act('POST', `/api/plants/${encodeURIComponent(this.scope)}/water`) : this.act('POST', '/api/water');

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
  startCalibration = (): Promise<ActionResult> => this.act('POST', this.calPath('start'));

  stopCalibration = (): Promise<ActionResult> => this.act('POST', this.calPath('stop'));

  /** La calibración es de la planta que se mira; sin planta a la vista, la ruta de siempre (la primera). */
  private calPath(action: 'start' | 'stop'): string {
    return this.scope ? `/api/plants/${encodeURIComponent(this.scope)}/calibration/${action}` : action === 'start' ? CAL_START : CAL_STOP;
  }

  captureCalibration = async (point: 'dry' | 'wet'): Promise<CaptureResult> => {
    const path = this.scope ? `/api/plants/${encodeURIComponent(this.scope)}/calibration/capture` : '/api/calibration/capture';
    const sent = await this.authed('POST', path, { point });
    if ('error' in sent) return { ok: false, error: sent.error };
    const body = await readBody(sent.res);
    if (!sent.res.ok) return { ok: false, error: errorOf(sent.res, body) };
    const saved = body.saved === true;
    if (saved) await this.refresh(); // al guardar cambian rawDry y rawWet de la planta
    return { ok: true, saved };
  };

  // --- Sectores y plantas ----------------------------------------------------------------------------------------

  setPlantScope = (plantId: string | undefined): void => {
    if (plantId === this.scope) return;
    this.scope = plantId;
    // Los datos de la planta anterior no se muestran mientras llegan los de la nueva.
    this.snapshot = { ...this.snapshot, load: 'loading' };
    for (const l of this.listeners) l();
    void this.refresh();
  };

  getPlantScope = (): string | undefined => this.scope;

  createSector = (input: SectorInput): Promise<ActionResult> => this.act('POST', '/api/sectors', input);

  updateSector = (id: string, patch: Partial<SectorInput>): Promise<ActionResult> =>
    this.act('PUT', `/api/sectors/${encodeURIComponent(id)}`, patch);

  deleteSector = (id: string): Promise<ActionResult> => this.act('DELETE', `/api/sectors/${encodeURIComponent(id)}`);

  createPlant = (input: PlantInput): Promise<ActionResult> => this.act('POST', '/api/plants', input);

  updatePlant = (id: string, patch: PlantPatch): Promise<ActionResult> =>
    this.act('PUT', `/api/plants/${encodeURIComponent(id)}`, patch);

  setPlantSensor = (id: string, sensor: PlantSensor | null): Promise<ActionResult> =>
    this.act('PUT', `/api/plants/${encodeURIComponent(id)}/sensor`, { sensor });

  archivePlant = (id: string): Promise<ActionResult> => this.act('DELETE', `/api/plants/${encodeURIComponent(id)}`);

  restorePlant = (id: string): Promise<ActionResult> => this.act('POST', `/api/plants/${encodeURIComponent(id)}/restore`);

  waterPlant = (id: string): Promise<ActionResult> => this.act('POST', `/api/plants/${encodeURIComponent(id)}/water`);

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

  // --- AuthApi -----------------------------------------------------------------

  subscribeAuth = (listener: () => void): (() => void) => {
    this.authListeners.add(listener);
    return () => {
      this.authListeners.delete(listener);
    };
  };

  getAuthState = (): AuthState => this.auth;

  submitPin = async (pin: string): Promise<boolean> => {
    try {
      const res = await this.request('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin }),
      });
      const body = await readBody(res);
      if (res.ok && typeof body.token === 'string') {
        this.saveToken(body.token);
        this.flushPinWaiters(true);
        this.setAuth({ pinRequested: false });
        return true;
      }
      const serverMessage = typeof body.error === 'string' ? body.error : undefined;
      this.setAuth({
        pinRequested: this.auth.pinRequested,
        error: loginErrorText(res.status, res.headers.get('retry-after'), serverMessage),
      });
      return false;
    } catch {
      this.setAuth({ pinRequested: this.auth.pinRequested, error: API_ERROR });
      return false;
    }
  };

  /** Abre el diálogo del PIN aunque la sesión siga abierta: así el PIN se pide siempre para lo sensible. */
  confirmPin = (): Promise<boolean> => this.askPin();

  /** Cierra la sesión: se olvida el token y la pantalla vuelve a la entrada. */
  signOut = (): void => this.expireSession();

  cancelPin = (): void => {
    if (!this.auth.pinRequested) return;
    this.flushPinWaiters(false);
    this.setAuth({ pinRequested: false });
  };

  // --- Internos ----------------------------------------------------------------

  /** Pide el snapshot. Si falla, deja los últimos datos con `error`. */
  async refresh(): Promise<void> {
    const id = ++this.seq;
    const t0 = Date.now();
    const scope = this.scope;
    const path = scope ? `/api/snapshot?plantId=${encodeURIComponent(scope)}` : '/api/snapshot';
    let next: Snapshot;
    try {
      // Prueba primero el servidor que venía andando y, si falla, los demás.
      let data: Snapshot | undefined;
      for (const i of this.order()) {
        try {
          const res = await this.fetchOn(this.bases[i], path);
          // La planta ya no existe (se borró o se archivó en otro lado): se vuelve a la vista general.
          if (res.status === 404 && scope !== undefined && this.scope === scope) {
            this.scope = undefined;
            return this.refresh();
          }
          if (res.status === 401) this.expireSession();
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
      // Si llegó antes una respuesta más nueva, o se cambió de planta mientras tanto, esta ya está vieja.
      if (id < this.applied || scope !== this.scope) return;
      this.offsetMs = data.now - (t0 + t1) / 2;
      const { error: _error, ...rest } = data;
      next = { ...withCalibration(rest as Snapshot, scope), load: 'ready', isDemo: false };
    } catch {
      if (id < this.applied || scope !== this.scope) return;
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
        if (res.status === 401 && path !== '/api/login') this.expireSession();
        return res;
      } catch (err) {
        failure = err;
      }
    }
    if (gateway) return gateway;
    throw failure;
  }

  /** Acción que cambia algo en el servidor. Si el servidor dice 401, se cierra la sesión y la acción falla. */
  private async act(method: 'PUT' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<ActionResult> {
    const sent = await this.authed(method, path, body);
    if ('error' in sent) return { ok: false, error: sent.error };
    const result = await toResult(sent.res);
    await this.refresh(); // lo que se muestra siempre sale de lo que dice el servidor
    return result;
  }

  /** Pedido con el token de sesión. Ante un 401 cierra la sesión y devuelve el error. No refresca el snapshot. */
  private async authed(
    method: 'GET' | 'PUT' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<{ res: Response } | { error: string }> {
    const send = () =>
      this.request(path, {
        method,
        headers: {
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    try {
      const res = await send();
      // `request` ya cerró la sesión: la pantalla vuelve a la entrada y la acción no se da por hecha.
      if (res.status === 401) return { error: SESSION_EXPIRED };
      return { res };
    } catch {
      return { error: API_ERROR };
    }
  }

  private askPin(): Promise<boolean> {
    return new Promise((resolve) => {
      this.pinWaiters.push(resolve);
      this.setAuth({ pinRequested: true });
    });
  }

  private flushPinWaiters(ok: boolean): void {
    const waiters = this.pinWaiters;
    this.pinWaiters = [];
    for (const w of waiters) w(ok);
  }

  private setAuth(next: Omit<AuthState, 'signedIn'>): void {
    this.auth = { ...next, signedIn: this.token !== undefined };
    for (const l of this.authListeners) l();
  }

  /** Sin sesión: se borra el token, se cierra cualquier diálogo del PIN y las acciones que esperaban fallan. */
  private expireSession(): void {
    this.clearToken();
    this.flushPinWaiters(false);
    this.setAuth({ pinRequested: false });
  }

  private saveToken(token: string): void {
    this.token = token;
    try {
      this.storage?.setItem(TOKEN_KEY, token);
    } catch {
      // Sin almacenamiento: la sesión dura lo que dure la pestaña.
    }
  }

  private clearToken(): void {
    this.token = undefined;
    try {
      this.storage?.removeItem(TOKEN_KEY);
    } catch {
      // ver saveToken
    }
  }
}
