import { decideWatering } from '@/core/decide';
import { clamp, percentToRaw, rawToPercent } from '@/core/moisture';
import type { PlantSensor, DeviceCalibration, Incident, NightSummary, Reading, SensorStatus, Settings, Snapshot, WaterEvent } from '@/core/types';
import { quietHoursOf, validateQuietHours } from '@/core/quietHours';
import { MAIN_PLANT_ID, MockGarden, type Base } from './mockGarden';
import { loadEwelinkSim, saveEwelinkSim, ewelinkStatusFor } from './mockEwelink';
import { DEFAULT_SETTINGS, READ_EVERY_MIN, sanitizeSettings } from '@/core/settings';
import {
  type ActionResult,
  type EwelinkLoginResult,
  type EwelinkSim,
  type EwelinkStatusResult,
  type DeviceTestResult,
  type WifiSim,
  type Fault,
  type LabApi,
  type PushBackend,
  type PushKind,
  type PushKeyResult,
  type PushPrefs,
  type PushPrefsResult,
  type PushTestResult,
  type RelayStatus,
  type RiegoApi,
  type PlantInput,
  type PlantPatch,
  type SectorInput,
} from './api';

/** Error de las notificaciones cuando no hay un servidor real detrás (el simulador no manda push). */
export const PUSH_NEEDS_BACKEND = 'Las notificaciones necesitan el servidor real: con datos de prueba no se pueden activar.';

// Se siguen exportando desde acá para no romper imports existentes.
export { DEFAULT_SETTINGS, READ_EVERY_MIN, sanitizeSettings };

const MIN = 60_000;
const H = 3_600_000;
const DAY = 24 * H;

// Cómo se comporta la maceta simulada.
const DRY_RATE = 0.008; // fracción por hora del exceso sobre el piso: dm/dt = -k·(m - piso)
const DRY_FLOOR = 8;
const POINTS_PER_SECOND = 3; // humedad que aporta cada segundo de riego
const RELEASE_PER_READING = 0.55; // el agua tarda en repartirse: parte llega en cada lectura
const SOIL_MAX = 92;
const NOISE = 0.35; // ruido del sensor, en puntos de humedad
const HISTORY_DAYS = 30; // alcanza para los resúmenes de 30 días y para comparar semanas
const KEEP_DAYS = 30.5;
const RELAY_MAX_SECONDS = 60; // tope que informa el "servidor" simulado
const CAL_MS = 15 * 60_000; // lo que dura una calibración antes de cortarse sola (igual que el backend)
/** Cuánto silencio aguanta el "servidor" simulado antes de dar la placa por desconectada: un intervalo más 3 min de margen. */
const OFFLINE_AFTER_S = (15 + 3) * 60;
const OFFLINE_FOR_MS = 10 * 60_000; // el escenario "offline": hace 10 minutos que se la dio por desconectada
const RESET_AGO_MS = 2 * 60_000; // el escenario "reinicio reciente": la placa arrancó hace 2 minutos
const CAL_EVERY_MS = 5_000; // en calibración la placa manda una lectura cada 5 s
const CAL_KEEP = 30; // lecturas de calibración que se conservan (igual que el backend)
const CAL_CYCLE = 28; // el sensor simulado va y viene entre el aire y el agua en ciclos de tantas lecturas (≈ 2 min 20 s)
const UPTIME_AT_START_S = 3 * 86_400; // la placa simulada ya lleva 3 días encendida
const START_MOISTURE = 40;
const STORAGE_KEY = 'riego-aut:ajustes:v2';
const API_ERROR = 'No se pudo conectar con el servidor.';
const DEFAULT_LOAD_MS = 600;

// El sensor físico siempre mide igual; la calibración de los ajustes solo cambia cómo se lee.
const SENSOR_DRY_RAW = 3100;
const SENSOR_WET_RAW = 1350;
const BAD_SENSOR_RAW = 4095; // lectura muy alta
const LOW_SENSOR_RAW = 12; // lectura muy baja

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** El simulador arranca con "No molestar" prendido, para que se vean el resumen de la noche y los avisos silenciados. */
const DEMO_SETTINGS: Settings = {
  ...DEFAULT_SETTINGS,
  quietHours: { ...quietHoursOf(DEFAULT_SETTINGS), enabled: true },
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEMO_SETTINGS;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEMO_SETTINGS;
    return sanitizeSettings(DEMO_SETTINGS, parsed as Partial<Settings>);
  } catch {
    return DEMO_SETTINGS;
  }
}

function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Sin almacenamiento (modo privado, iframe): los ajustes duran lo que dure la pestaña.
  }
}

function clearSettings(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ver saveSettings
  }
}

type RawSample = {
  t: number;
  raw: number;
  rssi: number;
  /** Cómo estaba el sensor al tomar esta lectura. */
  sensor: SensorStatus;
  decision?: { water: boolean; reason: string };
};

/**
 * Simulador de la maceta, el sensor y el Sonoff. Corre en el navegador y usa
 * exactamente las mismas funciones de decisión que va a usar el backend.
 */
export class MockRiego implements RiegoApi, LabApi {
  private listeners = new Set<() => void>();
  private snapshot!: Snapshot;
  private timer: ReturnType<typeof setInterval> | undefined;

  private settings: Settings = DEFAULT_SETTINGS;
  /** Sectores y plantas de ejemplo (2 sectores, 4 plantas, una sin sensor). */
  private garden = new MockGarden(DEFAULT_SETTINGS);
  /** Qué planta mira la pantalla (undefined = la vista general). */
  private scope: string | undefined;
  private samples: RawSample[] = [];
  private events: WaterEvent[] = [];
  private moisture = START_MOISTURE; // humedad real de la tierra
  private pending = 0; // agua regada que todavía no llegó al sensor
  private physicsAt = 0;
  private nextReadingAt = 0;
  private offsetMs = 0; // cuánto adelantamos el reloj
  private lastRebuild = 0;
  private rand = mulberry32(7);
  private loaded = false;
  /** Calibración en curso (simulada): cuándo empezó, cuándo se corta y las lecturas que lleva. */
  private cal: { endsAt: number; recent: number[]; count: number; lastSampleAt: number | undefined } | undefined;
  private bootAt = 0;
  /** Cuándo "arrancó" la placa simulada antes de cualquier escenario de reinicio. */
  private bootAtDefault = 0;
  /** Hasta cuándo (reloj real) está prendido el regador de prueba. */
  private relayOnUntil = 0;
  /** Foto congelada mientras la pantalla "no puede hablar con el servidor". */
  private frozen: Snapshot | undefined;
  fault: Fault = 'none';
  wifi: WifiSim = 'connected';
  /** Cómo está el vínculo con eWeLink (de eso depende si el regador responde). */
  ewelink: EwelinkSim = loadEwelinkSim();
  /** Red a la que está conectada la placa simulada, y cuándo se conectó con ella / cuándo olvidó la anterior. */
  private ssid = 'MiCasa-2.4G';
  private lastWifiChange: number | undefined;
  private wifiResetAt: number | undefined;

  /** loadMs: cuánto tarda en "llegar" la primera respuesta (0 = al instante, para tests). */
  constructor(
    private readonly options: {
      loadMs?: number;
      /** Servidor real para las notificaciones push. Sin él, el simulador responde PUSH_NEEDS_BACKEND. */
      backend?: PushBackend;
    } = {},
  ) {
    this.init();
    const wait = this.options.loadMs ?? DEFAULT_LOAD_MS;
    if (wait <= 0) {
      this.loaded = true;
      this.rebuild();
    } else {
      setTimeout(() => {
        this.loaded = true;
        this.publish();
      }, wait);
    }
  }

  // --- RiegoApi ----------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    if (this.timer === undefined) this.timer = setInterval(this.tick, 1000);
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.timer !== undefined) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
    };
  };

  getSnapshot = (): Snapshot => this.snapshot;

  now = (): number => Date.now() + this.offsetMs;

  updateSettings = (patch: Partial<Settings>): Promise<ActionResult> => {
    if (this.fault === 'api-error') return Promise.resolve({ ok: false, error: API_ERROR });
    if (patch.quietHours) {
      // Igual que el servidor: una ventana con "desde" igual a "hasta" (o una hora mal escrita) se rechaza, no se ignora.
      const check = validateQuietHours({ ...quietHoursOf(this.settings), ...patch.quietHours });
      if (!check.ok) return Promise.resolve({ ok: false, error: check.error });
    }
    // La calibración es de la planta que se mira (la principal, si no hay ninguna a la vista).
    const gp = this.scope ? this.garden.find(this.scope) : undefined;
    if (gp && gp.id !== MAIN_PLANT_ID && (patch.rawDry !== undefined || patch.rawWet !== undefined)) {
      gp.rawDry = patch.rawDry ?? gp.rawDry;
      gp.rawWet = patch.rawWet ?? gp.rawWet;
      const { rawDry: _d, rawWet: _w, ...rest } = patch;
      patch = rest;
    }
    this.settings = sanitizeSettings(this.settings, patch);
    saveSettings(this.settings);
    this.publish();
    return Promise.resolve({ ok: true });
  };

  /** Riega la planta que se mira (la principal, si no hay ninguna a la vista). */
  waterNow = (): Promise<ActionResult> =>
    this.scope && this.scope !== MAIN_PLANT_ID ? this.waterPlant(this.scope) : this.waterMain();

  waterPlant = (id: string): Promise<ActionResult> => {
    if (id === MAIN_PLANT_ID) return this.waterMain();
    if (this.fault === 'api-error') return Promise.resolve({ ok: false, error: API_ERROR });
    const res = this.garden.water(id, this.now(), this.settings.waterSeconds);
    if (res.ok) this.publish();
    return Promise.resolve(res);
  };

  // --- Sectores y plantas ---------------------------------------------------------------------------------------

  setPlantScope = (plantId: string | undefined): void => {
    if (plantId === this.scope) return;
    this.scope = plantId;
    this.publish();
  };

  getPlantScope = (): string | undefined => this.scope;

  /** Aplica un cambio del jardín: con la API caída no se hace nada, y lo que cambia el umbral de la principal llega al simulador. */
  private garden_(change: () => ActionResult): Promise<ActionResult> {
    if (this.fault === 'api-error') return Promise.resolve({ ok: false, error: API_ERROR });
    const res = change();
    if (res.ok) {
      this.syncMainLimits();
      this.publish();
    }
    return Promise.resolve(res);
  }

  createSector = (input: SectorInput): Promise<ActionResult> => this.garden_(() => this.garden.createSector(input));
  updateSector = (id: string, patch: Partial<SectorInput>): Promise<ActionResult> => this.garden_(() => this.garden.updateSector(id, patch));
  deleteSector = (id: string): Promise<ActionResult> => this.garden_(() => this.garden.deleteSector(id));
  createPlant = (input: PlantInput): Promise<ActionResult> => this.garden_(() => this.garden.createPlant(input, this.settings));
  updatePlant = (id: string, patch: PlantPatch): Promise<ActionResult> => this.garden_(() => this.garden.updatePlant(id, patch));
  setPlantSensor = (id: string, sensor: PlantSensor | null): Promise<ActionResult> => this.garden_(() => this.garden.setSensor(id, sensor));
  archivePlant = (id: string): Promise<ActionResult> => this.garden_(() => this.garden.archive(id, this.now()));
  restorePlant = (id: string): Promise<ActionResult> => this.garden_(() => this.garden.restore(id));

  /** El umbral y el objetivo que usa el simulador son los efectivos de la planta principal. */
  private syncMainLimits(): void {
    const main = this.garden.find(MAIN_PLANT_ID);
    if (!main) return;
    const eff = this.garden.effective(main);
    this.settings = sanitizeSettings(this.settings, { thresholdPct: eff.thresholdPct, targetPct: eff.targetPct });
    saveSettings(this.settings);
  }

  /** Sectores, plantas y placas del snapshot. */
  private gardenFields(now: number, last: RawSample | undefined): Pick<Snapshot, 'sectors' | 'plants' | 'devices'> {
    const base = this.gardenBase(now, last);
    return { sectors: this.garden.sectors.map((s) => ({ ...s })), plants: this.garden.views(base), devices: this.garden.devices(base) };
  }

  private gardenBase(now: number, last: RawSample | undefined): Base {
    const online = this.cal
      ? this.cal.lastSampleAt !== undefined
      : !!last && now - last.t <= OFFLINE_AFTER_S * 1000;
    const r = last ? this.toReading(last) : undefined;
    return { moisture: r?.moisture ?? null, raw: last?.raw ?? null, at: last?.t ?? null, online, rssi: last?.rssi };
  }

  /** El snapshot de la planta que se mira: sus lecturas, riegos, umbral y calibración. Sin planta, el general. */
  private scoped(built: Snapshot): Snapshot {
    const gp = this.scope ? this.garden.find(this.scope) : undefined;
    if (!gp || gp.archivedAt !== undefined) return built;
    const eff = this.garden.effective(gp);
    const settings = { ...built.settings, thresholdPct: eff.thresholdPct, targetPct: eff.targetPct, rawDry: gp.rawDry, rawWet: gp.rawWet };
    if (gp.id === MAIN_PLANT_ID) return { ...built, settings };
    const base = this.gardenBase(built.now, this.samples[this.samples.length - 1]);
    const readings = gp.sensor ? built.readings.map((r) => ({ ...r, moisture: this.garden.moistureOf(gp, { ...base, moisture: r.moisture }) ?? r.moisture })) : [];
    return { ...built, settings, readings, events: [...gp.events] };
  }

  private waterMain = (): Promise<ActionResult> => {
    if (this.fault === 'api-error') return Promise.resolve({ ok: false, error: API_ERROR });
    const t = this.now();
    const last = this.events[this.events.length - 1];
    // Evita un doble toque mientras todavía está regando.
    if (last && t - last.t < last.seconds * 1000) {
      return Promise.resolve({ ok: false, error: 'La bomba ya está regando.' });
    }
    this.pour(t, this.settings.waterSeconds, 'manual');
    this.publish();
    return Promise.resolve({ ok: true });
  };

  /** Simula la prueba del regador: no crea un evento ni toca la humedad simulada. */
  /** Prueba del dispositivo simulada: responde bien tras ~800 ms. */
  testDevice = (): Promise<DeviceTestResult> =>
    new Promise((resolve) => {
      setTimeout(() => {
        resolve(
          this.fault === 'api-error'
            ? { ok: false, error: API_ERROR }
            : { ok: true, message: 'Prueba simulada', details: { action: 'toggle', code: 'switch_1', before: false } },
        );
      }, 800);
    });

  testRelay = (seconds: number): Promise<ActionResult> => {
    if (this.fault === 'api-error') return Promise.resolve({ ok: false, error: API_ERROR });
    if (!Number.isInteger(seconds) || seconds < 1) return Promise.resolve({ ok: false, error: 'Los segundos no son válidos.' });
    if (seconds > RELAY_MAX_SECONDS) {
      return Promise.resolve({ ok: false, error: `El máximo para una prueba es ${RELAY_MAX_SECONDS} s.` });
    }
    const t = Date.now();
    const last = this.events[this.events.length - 1];
    const watering = !!last && this.now() - last.t < last.seconds * 1000;
    if (t < this.relayOnUntil || watering) return Promise.resolve({ ok: false, error: 'El regador ya está prendido.' });
    this.relayOnUntil = t + seconds * 1000;
    return Promise.resolve({ ok: true });
  };

  pushPublicKey = (): Promise<PushKeyResult> =>
    this.options.backend?.pushPublicKey() ?? Promise.resolve({ ok: false, error: PUSH_NEEDS_BACKEND });

  pushSubscribe = (sub: PushSubscriptionJSON, userAgent?: string, prefs?: Partial<PushPrefs>): Promise<PushPrefsResult> =>
    this.options.backend?.pushSubscribe(sub, userAgent, prefs) ?? Promise.resolve({ ok: false, error: PUSH_NEEDS_BACKEND });

  pushUnsubscribe = (endpoint: string): Promise<ActionResult> =>
    this.options.backend?.pushUnsubscribe(endpoint) ?? Promise.resolve({ ok: false, error: PUSH_NEEDS_BACKEND });

  pushPreferences = (endpoint: string, prefs: Partial<PushPrefs>): Promise<PushPrefsResult> =>
    this.options.backend?.pushPreferences(endpoint, prefs) ?? Promise.resolve({ ok: false, error: PUSH_NEEDS_BACKEND });

  pushTest = (endpoint: string, kind?: PushKind): Promise<PushTestResult> => {
    const backend = this.options.backend;
    if (!backend) return Promise.resolve({ ok: false, error: PUSH_NEEDS_BACKEND });
    return kind ? backend.pushTest(endpoint, kind) : backend.pushTest(endpoint);
  };

  relayStatus = (): Promise<RelayStatus> => {
    if (this.fault === 'api-error') return Promise.resolve({ ok: false, error: API_ERROR });
    return Promise.resolve({
      ok: true,
      // Sin el vínculo con eWeLink (o con el equipo sin conexión) el regador no responde.
      online: this.ewelink === 'vinculada',
      on: Date.now() < this.relayOnUntil,
      simulated: false,
      maxSeconds: RELAY_MAX_SECONDS,
      device: { name: 'Regador (demo)', model: 'Sonoff BASICR2 (simulado)', rssi: -58, firmware: '3.5.0' },
    });
  };

  /**
   * Calibración simulada: el "sensor" da un valor crudo que se mueve: primero la tierra, después sube hasta
   * el valor del aire y se queda quieto, después baja al del agua y se queda quieto, y vuelve a empezar.
   */
  startCalibration = (): Promise<ActionResult> => {
    if (this.fault === 'api-error') return Promise.resolve({ ok: false, error: API_ERROR });
    const gp = this.scope ? this.garden.find(this.scope) : undefined;
    if (gp && !gp.sensor) return Promise.resolve({ ok: false, error: 'La planta no tiene sensor.' });
    const t = this.now();
    this.cal = { endsAt: t + CAL_MS, recent: [], count: 0, lastSampleAt: undefined };
    this.sampleCalibration(t);
    this.publish();
    return Promise.resolve({ ok: true });
  };

  stopCalibration = (): Promise<ActionResult> => {
    if (this.fault === 'api-error') return Promise.resolve({ ok: false, error: API_ERROR });
    this.cal = undefined;
    this.publish();
    return Promise.resolve({ ok: true });
  };

  /** Estado del sensor según la falla que se esté simulando (mientras calibra, la placa lo informa al instante). */
  private faultSensor(): SensorStatus {
    return this.fault === 'bad-sensor'
      ? { ok: false, reason: 'high' }
      : this.fault === 'sensor-low'
        ? { ok: false, reason: 'low' }
        : this.fault === 'sensor-noise'
          ? { ok: false, reason: 'noise' }
          : { ok: true };
  }

  private calibrationState(): DeviceCalibration | undefined {
    return this.cal ? { active: true, until: this.cal.endsAt, recent: [...this.cal.recent] } : undefined;
  }

  /**
   * Valor crudo de la lectura número `i` de la calibración. Cada ciclo de 28 lecturas: la tierra sube hasta el aire y
   * se queda quieta (2 a 12), baja al agua y se queda quieta (15 a 26), y vuelve a empezar. Con una falla de sensor
   * simulada, da el valor de esa falla en vez de este recorrido.
   */
  private calibrationRaw(i: number): number {
    if (this.fault === 'bad-sensor') return BAD_SENSOR_RAW;
    if (this.fault === 'sensor-low') return LOW_SENSOR_RAW;
    if (this.fault === 'sensor-noise') return Math.round(300 + this.rand() * 3400);
    const soil = Math.round(percentToRaw(this.moisture, SENSOR_DRY_RAW, SENSOR_WET_RAW));
    const air = SENSOR_DRY_RAW;
    const water = SENSOR_WET_RAW;
    const k = i % CAL_CYCLE;
    const jitter = (this.rand() - 0.5) * 24;
    const lerp = (a: number, b: number, x: number) => a + (b - a) * Math.min(1, Math.max(0, x));
    if (k < 2) return Math.round(lerp(soil, air, (k + 1) / 3) + jitter * 6); // subiendo hacia el aire
    if (k < 13) return Math.round(air + jitter); // en el aire, quieto
    if (k < 15) return Math.round(lerp(air, water, (k - 12) / 3) + jitter * 6); // yendo al agua
    if (k < 27) return Math.round(water + jitter); // en el agua, quieto
    return Math.round(lerp(water, soil, 0.5) + jitter * 6); // de vuelta hacia la tierra
  }

  /** Toma una lectura de calibración si toca (cada 5 s). Sin wifi o con la placa caída no llega nada. */
  private sampleCalibration(t: number): void {
    if (!this.cal) return;
    if (this.fault === 'offline' || this.wifi !== 'connected') return;
    if (this.cal.lastSampleAt !== undefined && t - this.cal.lastSampleAt < CAL_EVERY_MS) return;
    this.cal.lastSampleAt = t;
    this.cal.recent.push(this.calibrationRaw(this.cal.count++));
    if (this.cal.recent.length > CAL_KEEP) this.cal.recent.splice(0, this.cal.recent.length - CAL_KEEP);
  }

  // --- LabApi ------------------------------------------------------------------

  advance = (hours: number): void => {
    const target = this.now() + hours * H;
    this.readUntil(target);
    this.offsetMs += hours * H;
    this.publish();
  };

  advanceToNextReading = (): void => {
    const target = this.nextReadingAt;
    this.readUntil(target);
    this.offsetMs += Math.max(0, target - this.now());
    this.publish();
  };

  forceMoisture = (pct: number): void => {
    const t = this.now();
    this.advancePhysics(t);
    this.moisture = clamp(pct, 0, 100);
    this.pending = 0;
    this.takeReading(t);
    this.publish();
  };

  setFault = (fault: Fault): void => {
    // Al cortarse la comunicación se queda con lo último que se vio.
    if (fault === 'api-error' && this.fault !== 'api-error') this.frozen = this.snapshot;
    if (fault !== 'api-error') this.frozen = undefined;
    const before = this.fault;
    this.fault = fault;
    if (fault === 'offline') {
      // Se nota enseguida: el reloj avanza hasta que se la dio por desconectada hace 10 minutos.
      const last = this.samples[this.samples.length - 1];
      if (last) {
        const target = last.t + OFFLINE_AFTER_S * 1000 + OFFLINE_FOR_MS;
        if (this.now() < target) this.offsetMs += target - this.now();
      }
    } else if (fault === 'recent-reset') {
      // La placa arrancó hace 2 minutos y ya reportó: el tiempo encendida es chico y quedan los envíos fallidos.
      this.bootAt = this.now() - RESET_AGO_MS;
      this.takeReading(this.now());
    }
    if (before === 'recent-reset' && fault !== 'recent-reset') this.bootAt = this.bootAtDefault;
    this.publish();
  };

  /**
   * Wifi de la placa simulada. Sin conexión y reseteada la placa no reporta: para que se vea enseguida, el reloj
   * avanza una hora (si no, habría que esperar el margen de silencio). Reseteada además queda `wifiResetAt`.
   */
  setEwelink = (state: EwelinkSim): void => {
    if (state === this.ewelink) return;
    this.ewelink = state;
    saveEwelinkSim(state);
    this.publish();
  };

  ewelinkStatus = (): Promise<EwelinkStatusResult> => {
    if (this.fault === 'api-error') return Promise.resolve({ ok: false, error: API_ERROR });
    return Promise.resolve({ ok: true, status: ewelinkStatusFor(this.ewelink, this.now()) });
  };

  /** Simula la ida a eWeLink: devuelve la misma página con `?ewelink=ok` y deja el vínculo hecho (como el callback real). */
  ewelinkLogin = (): Promise<EwelinkLoginResult> => {
    if (this.fault === 'api-error') return Promise.resolve({ ok: false, error: API_ERROR });
    this.setEwelink('vinculada');
    const base = typeof location !== 'undefined' ? `${location.origin}${location.pathname}` : 'http://localhost/';
    return Promise.resolve({ ok: true, url: `${base}?ewelink=ok` });
  };

  ewelinkUnlink = (): Promise<ActionResult> => {
    if (this.fault === 'api-error') return Promise.resolve({ ok: false, error: API_ERROR });
    this.setEwelink('sin-vincular');
    return Promise.resolve({ ok: true });
  };

  setWifi = (wifi: WifiSim): void => {
    if (wifi === this.wifi) return;
    const t = this.now();
    this.wifi = wifi;
    if (wifi === 'reset') {
      this.wifiResetAt = t;
      this.lastWifiChange = t; // el servidor anota también el borrado de la red
    } else {
      this.wifiResetAt = undefined;
    }
    if (wifi === 'connected') {
      this.takeReading(this.now());
    } else {
      this.offsetMs += H;
      this.readUntil(this.now()); // con el wifi caído no se toma ninguna lectura
    }
    this.publish();
  };

  reconnectWifi = (ssid = 'RedNueva-5G'): void => {
    this.ssid = ssid;
    this.wifi = 'connected';
    this.wifiResetAt = undefined;
    this.lastWifiChange = this.now();
    this.takeReading(this.now()); // la placa vuelve a reportar enseguida
    this.publish();
  };

  reset = (): void => {
    clearSettings();
    this.init();
    this.notify();
  };

  // --- Simulación --------------------------------------------------------------

  private init(): void {
    const realNow = Date.now();
    this.rand = mulberry32(7);
    this.fault = 'none';
    this.wifi = 'connected';
    this.ssid = 'MiCasa-2.4G';
    this.wifiResetAt = undefined;
    this.lastWifiChange = realNow - 3 * DAY;
    this.offsetMs = 0;
    this.samples = [];
    this.events = [];
    this.pending = 0;
    this.relayOnUntil = 0;
    this.cal = undefined;
    this.bootAt = realNow - UPTIME_AT_START_S * 1000;
    this.bootAtDefault = this.bootAt;
    this.moisture = START_MOISTURE;

    // La grilla de lecturas queda alineada para que la última sea de hace 4 minutos.
    const start = realNow - HISTORY_DAYS * DAY - 4 * MIN;
    this.physicsAt = start;
    this.nextReadingAt = start;
    this.settings = DEFAULT_SETTINGS; // el historial se arma siempre con la regla por defecto
    this.readUntil(realNow);

    this.settings = loadSettings();
    this.garden.reset(this.settings);
    this.ewelink = 'vinculada';
    saveEwelinkSim('vinculada');
    this.scope = undefined;
    this.lastRebuild = 0;
    this.frozen = undefined;
    this.rebuild();
  }

  /** Lleva la humedad real hasta el instante t, secándose de forma exponencial. */
  private advancePhysics(t: number): void {
    const hours = (t - this.physicsAt) / H;
    if (hours > 0) {
      this.moisture = DRY_FLOOR + (this.moisture - DRY_FLOOR) * Math.exp(-DRY_RATE * hours);
      this.physicsAt = t;
    }
  }

  private noise(): number {
    return (this.rand() + this.rand() - 1) * NOISE;
  }

  private takeReading(t: number): void {
    this.advancePhysics(t);
    const release = this.pending * RELEASE_PER_READING;
    this.moisture = Math.min(SOIL_MAX, this.moisture + release);
    this.pending -= release;

    if (this.fault === 'offline' || this.wifi !== 'connected') return;

    // Escenarios de falla del sensor: lectura muy alta, muy baja o una señal que salta sin sentido.
    const sensor: SensorStatus =
      this.fault === 'bad-sensor'
        ? { ok: false, reason: 'high' }
        : this.fault === 'sensor-low'
          ? { ok: false, reason: 'low' }
          : this.fault === 'sensor-noise'
            ? { ok: false, reason: 'noise' }
            : { ok: true };
    const raw =
      sensor.ok
        ? Math.round(percentToRaw(this.moisture + this.noise(), SENSOR_DRY_RAW, SENSOR_WET_RAW))
        : sensor.reason === 'high'
          ? BAD_SENSOR_RAW
          : sensor.reason === 'low'
            ? LOW_SENSOR_RAW
            : Math.round(300 + this.rand() * 3400); // con ruido: valores "válidos" pero que saltan de un extremo al otro
    const rssi = Math.round(-52 + (this.rand() + this.rand() - 1) * 5);
    const sample: RawSample = { t, raw, rssi, sensor };
    this.samples.push(sample);

    // Con el sensor fallando no se decide ni se riega con lo que dice (el valor con ruido parece de tierra, pero no lo es).
    if (!sensor.ok) {
      sample.decision = { water: false, reason: 'bad-sensor' };
      return;
    }

    const reading = this.toReading(sample);
    const decision = decideWatering({
      reading,
      settings: this.settings,
      events: this.events,
      now: t,
      readEveryMin: READ_EVERY_MIN,
    });
    sample.decision = { water: decision.water, reason: decision.reason };
    if (decision.water) this.pour(t, this.settings.waterSeconds, 'auto');
  }

  private pour(t: number, seconds: number, source: WaterEvent['source']): void {
    this.events.push({ t, seconds, source });
    const room = Math.max(0, SOIL_MAX - this.moisture - this.pending);
    this.pending += Math.min(room, seconds * POINTS_PER_SECOND);
  }

  /** Toma todas las lecturas programadas hasta `target`, una por una y en orden. */
  private readUntil(target: number): void {
    let guard = 0;
    while (this.nextReadingAt <= target && guard++ < 4000) {
      const t = this.nextReadingAt;
      this.nextReadingAt = t + READ_EVERY_MIN * MIN;
      this.takeReading(t);
    }
  }

  private toReading(sample: RawSample): Reading {
    return {
      t: sample.t,
      raw: sample.raw,
      moisture: rawToPercent(sample.raw, this.settings.rawDry, this.settings.rawWet),
      ...(sample.decision ? { decision: sample.decision } : {}),
    };
  }

  private tick = (): void => {
    const t = this.now();
    if (this.cal) {
      // Calibrando: una lectura cada 5 s, hasta que se corta sola.
      if (t >= this.cal.endsAt) this.cal = undefined;
      else this.sampleCalibration(t);
      this.publish();
      return;
    }
    if (this.nextReadingAt <= t) {
      this.readUntil(t);
      this.publish();
    } else if (t - this.lastRebuild >= 30_000) {
      // Mantiene "ahora" al día aunque no lleguen lecturas (por ejemplo si el sensor se cae).
      this.publish();
    }
  };

  private trim(t: number): void {
    const from = t - KEEP_DAYS * DAY;
    if (this.samples.length && this.samples[0].t < from) {
      this.samples = this.samples.filter((s) => s.t >= from);
    }
    if (this.events.length && this.events[0].t < from) {
      this.events = this.events.filter((e) => e.t >= from);
    }
  }

  private rebuild(): void {
    const t = this.now();
    this.trim(t);
    const last = this.samples[this.samples.length - 1];
    this.lastRebuild = t;
    const built: Snapshot = {
      load: this.loaded ? 'ready' : 'loading',
      now: t,
      readings: this.samples.map((s) => this.toReading(s)),
      events: [...this.events],
      settings: this.settings,
      device: {
        online: this.cal
          ? this.cal.lastSampleAt !== undefined && t - this.cal.lastSampleAt <= 3 * CAL_EVERY_MS
          : !!last && t - last.t <= OFFLINE_AFTER_S * 1000,
        offlineAfterSec: this.cal ? 3 * (CAL_EVERY_MS / 1000) : OFFLINE_AFTER_S,
        ...(this.fault === 'recent-reset' ? { resetReason: 'brownout', failedPosts: 3 } : {}),
        // Calibrando, la placa simulada manda una lectura cada 5 s: "reportó" cuando llega la última.
        lastSeen: this.cal ? (this.cal.lastSampleAt ?? last?.t ?? 0) : (last?.t ?? 0),
        readEveryMin: READ_EVERY_MIN,
        rssi: last?.rssi,
        ...(this.wifi === 'reset' ? {} : { ssid: this.ssid }),
        ...(this.wifiResetAt !== undefined ? { wifiResetAt: this.wifiResetAt } : {}),
        ...(this.lastWifiChange !== undefined ? { lastWifiChange: this.lastWifiChange } : {}),
        fw: '1.0.0 (demo)',
        ...(last || this.cal ? { sensor: this.cal ? this.faultSensor() : last!.sensor } : {}),
        ...(last ? { lastRaw: this.cal?.recent.at(-1) ?? last.raw } : {}),
        ...(last ? { uptimeSec: Math.max(0, Math.round((last.t - this.bootAt) / 1000)) } : {}),
        ...(this.cal ? { calibration: this.calibrationState() } : {}),
      },
      incidents: this.demoIncidents(t),
      ...this.gardenFields(t, last),
      relayStatus: { driver: 'fake', connected: true, testAvailable: true },
      relay: { driver: 'fake', connected: true, testAvailable: true },
      isDemo: true,
    };
    this.snapshot =
      this.fault === 'api-error' && this.frozen
        ? { ...this.frozen, now: t, error: API_ERROR, device: { ...this.frozen.device, online: false } }
        : this.scoped(built);
  }

  /**
   * Avisos de ejemplo para la campana: los cruces del umbral de las lecturas simuladas (el último par sale silenciado,
   * como si hubiera caído en "No molestar") y el resumen de la noche que terminó hoy a las 07:00.
   */
  private demoIncidents(now: number): Incident[] {
    const th = this.settings.thresholdPct;
    const out: Incident[] = [];
    const crossings: Incident[] = [];
    let prev: RawSample | undefined;
    for (const sample of this.samples) {
      const r = this.toReading(sample);
      const p = prev ? this.toReading(prev) : undefined;
      if (p && p.moisture >= th && r.moisture < th) {
        crossings.push({ t: r.t, kind: 'humedad-baja', message: `La humedad bajó de ${th} %` });
      } else if (p && p.moisture < th && r.moisture >= th) {
        crossings.push({ t: r.t, kind: 'humedad-recuperada', message: `La humedad volvió a superar ${th} %` });
      }
      prev = sample;
    }
    // Los dos últimos cruces (bajó y volvió a subir) son los silenciados de la demo.
    crossings.slice(-2).forEach((c) => (c.silenced = true));
    // Los avisos de una planta traen cuál es y de qué sector (los cruces del simulador son de la principal).
    const main = this.garden.find(MAIN_PLANT_ID);
    const mainSector = main ? this.garden.sectorOf(main) : undefined;
    if (main && mainSector) {
      for (const c of crossings) Object.assign(c, { plantId: main.id, plantName: main.name, sectorId: mainSector.id, sectorName: mainSector.name });
    }
    out.push(...crossings);
    // Una planta de otro sector que está seca: así la campana muestra más de una planta.
    const tomates = this.garden.find('plant-tomates');
    if (tomates && tomates.sensor) {
      const sector = this.garden.sectorOf(tomates);
      out.push({
        t: now - 3 * 60 * MIN,
        kind: 'necesita-riego',
        message: 'La tierra está seca: hay que regar.',
        plantId: tomates.id,
        plantName: tomates.name,
        sectorId: sector.id,
        sectorName: sector.name,
      });
    }

    // La noche que terminó a las 07:00 de hoy (o de ayer, si todavía no pasaron las 07:00): de 23:00 a 07:00.
    const end = new Date(now);
    end.setHours(7, 0, 0, 0);
    if (end.getTime() > now) end.setDate(end.getDate() - 1);
    const to = end.getTime();
    const from = to - 8 * 60 * MIN;
    const night = this.samples.filter((x) => x.t >= from && x.t <= to).map((x) => this.toReading(x));
    const inNight = (t: number) => t >= from && t <= to;
    const summary: NightSummary = {
      from,
      to,
      ...(night.length > 0
        ? {
            moistureStart: night[0].moisture,
            moistureEnd: night[night.length - 1].moisture,
            moistureMin: Math.min(...night.map((x) => x.moisture)),
          }
        : {}),
      wateringAlerts: crossings.filter((c) => c.kind === 'humedad-baja' && inNight(c.t)).length,
      wateringsAuto: this.events.filter((e) => e.source === 'auto' && inNight(e.t)).length,
      wateringsManual: this.events.filter((e) => e.source === 'manual' && inNight(e.t)).length,
      // Datos de prueba: la placa se desconectó un rato para que se vea la línea.
      offlineMin: 12,
      sensorIssues: 0,
    };
    out.push({ t: to, kind: 'night-summary', message: 'Resumen de la noche', summary });
    return out.sort((a, b) => b.t - a.t);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  private publish(): void {
    this.rebuild();
    this.notify();
  }
}
