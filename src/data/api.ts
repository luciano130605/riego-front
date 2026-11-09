import type { PlantSensor, Settings, Snapshot } from '@/core/types';

/**
 * Lo único que la pantalla sabe del mundo. Hoy lo implementa el simulador
 * (mockRiego.ts); cuando exista el backend, se escribe otra clase con esta
 * misma forma que hable por HTTP y no cambia ningún componente.
 */
/** Resultado de la prueba del dispositivo: el texto sale del servidor. */
export type DeviceTestResult =
  | { ok: true; message: string; details?: DeviceTestDetails }
  | { ok: false; error: string };

/** Lo que hizo la prueba, si el servidor lo informa (si no, se muestra solo su `message`). */
export type DeviceTestDetails = {
  action?: 'ring' | 'toggle' | 'status-only';
  /** Nombre del dispositivo en Smart Life. */
  deviceName?: string;
  /** Función accionada, por ejemplo `switch_1`. */
  code?: string;
  /** Cómo estaba antes de la prueba (true = prendida). */
  before?: boolean;
  seconds?: number;
};

/** Resultado de tomar un punto de la calibración en el servidor. `saved`: con los dos puntos, el servidor ya la guardó. */
export type CaptureResult = { ok: true; saved: boolean } | { ok: false; error: string };

/** Un sector nuevo. */
export type SectorInput = { name: string; thresholdPct: number; targetPct: number };
/** Una planta nueva. `thresholdPct` / `targetPct` null o ausentes = usa el del sector. */
export type PlantInput = {
  name: string;
  sectorId: string;
  sensor?: PlantSensor | null;
  thresholdPct?: number | null;
  targetPct?: number | null;
  auto?: boolean;
};
/** Lo que se puede editar de una planta (mover de sector = cambiar `sectorId`). */
export type PlantPatch = Partial<Pick<PlantInput, 'name' | 'sectorId' | 'thresholdPct' | 'targetPct' | 'auto'>>;

export interface RiegoApi {
  subscribe(listener: () => void): () => void;
  getSnapshot(): Snapshot;
  /** Hora actual del sistema. En el simulador puede estar adelantada. */
  now(): number;
  updateSettings(patch: Partial<Settings>): Promise<ActionResult>;
  /** Riega ya, una tanda con los segundos configurados. */
  waterNow(): Promise<ActionResult>;
  /**
   * Prende el regador `seconds` segundos solo para probarlo. No crea un evento de riego
   * ni toca el historial. Necesita sesión (en el backend real pide el PIN).
   */
  testRelay(seconds: number): Promise<ActionResult>;
  /**
   * Prueba corta del dispositivo conectado (el botón temporal de Configuración → Dispositivo). Devuelve el mensaje del
   * servidor; no se da por buena hasta que responde.
   */
  testDevice(): Promise<DeviceTestResult>;

  // --- Sectores y plantas ---------------------------------------------------------------------------------------
  /**
   * Qué planta mira la pantalla: el snapshot trae SUS lecturas, riegos, umbral y calibración (así los componentes de
   * siempre sirven para cualquier planta). `undefined` = la vista general. Mientras llegan los datos de la nueva
   * planta, `load` vuelve a 'loading'.
   */
  setPlantScope(plantId: string | undefined): void;
  getPlantScope(): string | undefined;
  createSector(input: SectorInput): Promise<ActionResult>;
  updateSector(id: string, patch: Partial<SectorInput>): Promise<ActionResult>;
  deleteSector(id: string): Promise<ActionResult>;
  createPlant(input: PlantInput): Promise<ActionResult>;
  updatePlant(id: string, patch: PlantPatch): Promise<ActionResult>;
  /** Asigna el sensor (placa y canal) o lo quita (null: la planta queda sin sensor). */
  setPlantSensor(id: string, sensor: PlantSensor | null): Promise<ActionResult>;
  /** Archivar conserva todos los datos y libera el canal del sensor. */
  archivePlant(id: string): Promise<ActionResult>;
  restorePlant(id: string): Promise<ActionResult>;
  /** Riega (o anota el riego de) una planta, tenga sensor o no. */
  waterPlant(id: string): Promise<ActionResult>;
  /** Estado del regador (el relé), para saber si se puede probar. */
  relayStatus(): Promise<RelayStatus>;
  /** Empieza la calibración asistida: la placa manda lecturas seguidas (llegan en `snapshot.device.calibration`). */
  startCalibration(): Promise<ActionResult>;
  /** Termina la calibración y la placa vuelve a su ritmo normal. */
  stopCalibration(): Promise<ActionResult>;
  /**
   * Toma un punto de la calibración EN EL SERVIDOR (lo hace con sus propias lecturas de la planta a la vista). Con los
   * dos puntos el servidor valida y la guarda. El simulador no lo tiene: ahí se guarda con `updateSettings`.
   */
  captureCalibration?(point: 'dry' | 'wet'): Promise<CaptureResult>;
  /** Clave pública VAPID del servidor (no necesita sesión). */
  pushPublicKey(): Promise<PushKeyResult>;
  /** Registra (o actualiza) este dispositivo en el servidor. Necesita sesión. Devuelve sus preferencias. */
  pushSubscribe(subscription: PushSubscriptionJSON, userAgent?: string, prefs?: Partial<PushPrefs>): Promise<PushPrefsResult>;
  pushUnsubscribe(endpoint: string): Promise<ActionResult>;
  pushPreferences(endpoint: string, prefs: Partial<PushPrefs>): Promise<PushPrefsResult>;
  /**
   * Manda una notificación de prueba solo a este dispositivo. Sin `kind` es la prueba genérica; con `kind`,
   * el mismo aviso que mandaría de verdad ese tipo (para ver cómo llega cada uno).
   */
  pushTest(endpoint: string, kind?: PushKind): Promise<PushTestResult>;
}

/** Tipos de aviso que manda el servidor. */
export const PUSH_KINDS = [
  'humedad-baja',
  'necesita-riego',
  'humedad-recuperada',
  'riego-iniciado',
  'riego-terminado',
  'riego-cortado',
  'placa-offline',
  'placa-vuelve',
  'sensor-sospechoso',
] as const;
export type PushKind = (typeof PUSH_KINDS)[number];
export type PushPrefs = Record<PushKind, boolean>;

export type PushKeyResult = { ok: true; publicKey: string } | { ok: false; error: string };
export type PushPrefsResult = { ok: true; prefs: PushPrefs } | { ok: false; error: string };
/** `status` es el código HTTP cuando el servidor respondió (410 = la suscripción venció, 404 = no está suscripto). */
export type PushTestResult = { ok: true } | { ok: false; error: string; status?: number };

/** Lo que necesita el simulador para hablar de push con un servidor real (el simulador no manda push por sí solo). */
export type PushBackend = Pick<
  RiegoApi,
  'pushPublicKey' | 'pushSubscribe' | 'pushUnsubscribe' | 'pushPreferences' | 'pushTest'
>;

/** Lo que se sabe del equipo que mueve la bomba. Todo es opcional: solo viene lo que el equipo informa. */
export type RelayDevice = {
  name?: string;
  model?: string;
  /** Señal wifi en dBm (más cerca de 0 es mejor). */
  rssi?: number;
  firmware?: string;
};

/** Resultado de consultar el regador. */
export type RelayStatus =
  | {
      ok: true;
      online: boolean;
      on: boolean;
      /** true si el servidor todavía no tiene un regador conectado (modo aviso): no prende nada. */
      simulated?: boolean;
      /** Segundos máximos que acepta el servidor por orden. */
      maxSeconds?: number;
      /** true si el servidor está en modo ejemplo (credenciales de ejemplo): no hay un Sonoff real. */
      example?: boolean;
      /** Datos del equipo (el Sonoff), los que el servidor logre leer. */
      device?: RelayDevice;
    }
  | { ok: false; error: string };

/** Resultado de una acción. Nunca se da por hecha: la pantalla muestra lo que pasó de verdad. */
export type ActionResult = { ok: true } | { ok: false; error: string };

/** Fallas que se pueden provocar en el simulador para ver cómo reacciona todo. */
export type Fault =
  | 'none'
  | 'offline' // la placa no manda lecturas: se la da por desconectada desde hace 10 minutos
  | 'bad-sensor' // la placa manda la lectura al máximo (4095): saturada, no es una falla del sensor
  | 'recent-reset' // la placa se reinició hace poco (baja tensión) y tuvo envíos fallidos
  | 'sensor-low' // la placa manda una lectura muy baja (sensor desconectado a masa)
  | 'sensor-noise' // la señal del sensor tiene ruido: salta de un valor a otro sin sentido
  | 'api-error'; // la pantalla no puede hablar con el servidor

/** Controles que solo existen mientras los datos son de prueba. */
/** Cómo está el wifi de la placa en el simulador. */
export type WifiSim =
  | 'connected' // conectada y reportando
  | 'offline' // dejó de reportar (por ejemplo, cambió el router)
  | 'reset'; // olvidó su red (IO0) y espera que le carguen una nueva

export interface LabApi {
  readonly fault: Fault;
  readonly wifi: WifiSim;
  /** Cambia el estado del wifi de la placa. Sin conexión o reseteada, la placa deja de reportar. */
  setWifi(wifi: WifiSim): void;
  /** La placa se conecta con otra red (le cargaron el wifi): vuelve a reportar y queda el cambio registrado. */
  reconnectWifi(ssid?: string): void;
  /** Corre el reloj del simulador, generando las lecturas y decisiones intermedias. */
  advance(hours: number): void;
  advanceToNextReading(): void;
  /** Fija la humedad real de la tierra y toma una lectura en el momento. */
  forceMoisture(pct: number): void;
  setFault(fault: Fault): void;
  reset(): void;
}

/** `signedIn`: hay una sesión guardada (el token). Sin ella la pantalla muestra la entrada. */
export type AuthState = { pinRequested: boolean; signedIn: boolean; error?: string };

/**
 * Extensión opcional de RiegoApi para el backend real: la sesión (token) y el pedido de PIN. Con backend, sin sesión
 * se ve la pantalla de entrada; el diálogo del PIN solo sale para confirmar acciones sensibles (activar notificaciones).
 */
export interface AuthApi {
  subscribeAuth(listener: () => void): () => void;
  getAuthState(): AuthState;
  /** Intenta entrar con el PIN. true = quedó la sesión. */
  submitPin(pin: string): Promise<boolean>;
  /** El usuario cerró el diálogo del PIN sin entrar. */
  cancelPin(): void;
  /**
   * Pide el PIN ahora, aunque la sesión siga abierta (para acciones que lo exigen siempre, como activar las
   * notificaciones). true = se puso bien; false = cerraron el diálogo.
   */
  confirmPin(): Promise<boolean>;
  /** Cierra la sesión: borra el token y la pantalla vuelve a la entrada. */
  signOut(): void;
}

export function isAuthApi(api: RiegoApi): api is RiegoApi & AuthApi {
  return typeof (api as Partial<AuthApi>).submitPin === 'function';
}
