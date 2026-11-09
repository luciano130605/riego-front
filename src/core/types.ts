/**
 * Contrato de datos de riego-aut.
 *
 * Es lo único que comparten la pantalla, el backend (Vercel) y el firmware:
 * si cambia acá, cambia en los tres niveles.
 */

export type Reading = {
  /** Momento de la lectura, en ms desde epoch. */
  t: number;
  /** Valor crudo del ADC de la ESP32 (12 bits: 0 a 4095). */
  raw: number;
  /** Humedad de la tierra (0 a 100) según la calibración vigente. */
  moisture: number;
  /**
   * Qué decidió el sistema con esta lectura (si regaba o no, y por qué). Es opcional:
   * las lecturas viejas, de antes de guardar la decisión, no la tienen. `reason` es una
   * de las razones de decide.ts (water, not-needed, soaking, ...).
   */
  decision?: { water: boolean; reason: string };
};

export type WaterSource = 'auto' | 'manual';

export type WaterEvent = {
  t: number;
  /** Segundos que estuvo prendida la bomba (o válvula). */
  seconds: number;
  source: WaterSource;
};

/**
 * Cómo riega el automático:
 * - 'until-target': riega de a poco hasta que la humedad llega al objetivo.
 * - 'fixed': cada riego dura siempre lo mismo.
 */
export type WateringMode = 'until-target' | 'fixed';

/**
 * "No molestar": con la ventana activa no se manda ninguna notificación (los avisos igual quedan en la campana, marcados
 * `silenced`). `from` y `to` son 'HH:mm' en la zona `tz` (IANA); la ventana puede cruzar la medianoche. Al terminar se arma
 * un solo resumen de la noche.
 */
export type QuietHours = { enabled: boolean; from: string; to: string; tz: string };

/**
 * Resumen de la noche: lo arma el servidor al terminar la ventana de "No molestar". Todos los campos son opcionales: lo
 * que falte no se muestra.
 */
export type NightSummary = {
  /** Desde y hasta cuándo cubre (ms desde epoch). */
  from?: number;
  to?: number;
  /** Humedad (%) al empezar y al terminar la noche, y la mínima. */
  moistureStart?: number;
  moistureEnd?: number;
  moistureMin?: number;
  /** Cuántos avisos de riego (humedad bajo el umbral) hubo. */
  wateringAlerts?: number;
  /** Riegos de la noche: los que hizo el automático y los que se anotaron a mano. */
  wateringsAuto?: number;
  wateringsManual?: number;
  /** Minutos que la placa estuvo sin conexión. */
  offlineMin?: number;
  /** Cuántos problemas del sensor hubo. */
  sensorIssues?: number;
};

/**
 * Un aviso que el servidor registró (los de la campana). `silenced`: salió dentro de "No molestar", así que no llegó
 * como notificación al celular. El tipo 'night-summary' trae el `summary`.
 */
export type Incident = {
  t: number;
  kind: string;
  message: string;
  silenced?: boolean;
  summary?: NightSummary;
};

export type Settings = {
  /** Si está en true, el sistema riega solo cuando corresponde. */
  auto: boolean;
  mode: WateringMode;
  /** Se empieza a regar cuando la humedad baja de este valor (%). */
  thresholdPct: number;
  /** En modo 'until-target', se riega hasta llegar a este valor (%). */
  targetPct: number;
  /**
   * Cuánto dura cada tanda de bomba. En 'fixed' es el riego entero; en
   * 'until-target' es una tanda y se repiten, con una pausa para que el agua
   * se reparta, hasta llegar al objetivo.
   */
  waterSeconds: number;
  /** Tope de seguridad: segundos de bomba en un mismo riego ('until-target'). */
  maxCycleSeconds: number;
  /** Mínimo de horas entre dos riegos. */
  minIntervalHours: number;
  /** Tope de riegos en 24 h. null = sin tope, los que haga falta. */
  maxPerDay: number | null;
  /** Lectura cruda con la tierra seca (calibración). */
  rawDry: number;
  /** Lectura cruda con la tierra mojada (calibración). */
  rawWet: number;
  /** No molestar. Opcional: un servidor viejo no lo manda y se toma el valor por defecto (apagado). */
  quietHours?: QuietHours;
};

/** Por qué el sensor de humedad no sirve: señal con ruido, lectura muy baja o lectura muy alta. */
export type SensorFaultReason = 'noise' | 'low' | 'high';

/** Estado del sensor de humedad según el servidor. */
export type SensorStatus =
  | { ok: true }
  /** `reason` puede faltar si la placa avisó la falla sin decir el motivo; `at` es cuándo lo informó (ms desde epoch). */
  | { ok: false; reason?: SensorFaultReason; at?: number };

export type DeviceStatus = {
  /** El servidor da la placa por conectada. La pantalla muestra exactamente esto: no lo recalcula. */
  online: boolean;
  /** Segundos sin reportar a partir de los cuales el servidor da la placa por desconectada (`online: false`). */
  offlineAfterSec?: number;
  /** Envíos de la placa que fallaron desde su último reinicio, si los informa. */
  failedPosts?: number;
  /** Por qué se reinició la placa la última vez (por ejemplo "brownout"), si lo informa. */
  resetReason?: string;
  /** Última vez que la placa mandó algo, en ms desde epoch. */
  lastSeen: number;
  /** Cada cuántos minutos la placa manda una lectura. */
  readEveryMin: number;
  /** Señal de wifi de la placa en dBm (más cerca de 0 es mejor), si la manda. */
  rssi?: number;
  /**
   * Qué puede hacer el sistema con el agua: 'aviso' = todavía no hay regador conectado, solo avisa
   * cuando la planta necesita agua y el riego es manual; 'real' = hay regador y riega solo.
   * Si el servidor no lo informa se asume 'real'.
   */
  relay?: 'aviso' | 'real';
  /** Estado del sensor de humedad (funcionando o con falla y por qué). Si el servidor no lo informa, no se sabe. */
  sensor?: SensorStatus;
  /** Último valor crudo recibido (también durante la calibración). */
  lastRaw?: number;
  /** Versión del firmware de la placa, si la informa. */
  fw?: string;
  /** Segundos que llevaba encendida la placa cuando mandó su última lectura, si lo informa. */
  uptimeSec?: number;
  /** Primera vez que la placa mandó una lectura al servidor, en ms desde epoch. */
  firstSeen?: number;
  /**
   * Último envío de la placa que el servidor rechazó: 'token' = el token del firmware no coincide con el del
   * servidor, 'cuerpo' = mandó algo que el servidor no entiende. Sirve para diagnosticar una placa que "conecta"
   * pero no aparece.
   */
  lastRejected?: { t: number; status: number; reason: 'token' | 'cuerpo' };
  /** La placa está mandando valores SIMULADOS (firmware en modo simulado): esas lecturas no se usan para nada. */
  sim?: boolean;
  /** Nombre de la red wifi a la que la placa dice estar conectada, si lo informa. */
  ssid?: string;
  /**
   * Cuándo se borró el wifi de la placa (botón IO0 apretado) y todavía no volvió a conectarse a ninguna red, en ms
   * desde epoch. Desaparece cuando la placa se conecta de nuevo. Mientras exista, la placa no puede reportar.
   */
  wifiResetAt?: number;
  /** Último cambio de wifi que avisó la placa (borrado o conexión a una red), en ms desde epoch. */
  lastWifiChange?: number;
  /** Calibración asistida: mientras está activa la placa manda lecturas seguidas (no van al historial). */
  calibration?: DeviceCalibration;
};

/** `until`: cuándo se corta sola (ms desde epoch). `recent`: últimas lecturas crudas, la más nueva al final. */
export type DeviceCalibration = { active: boolean; until: number; recent: number[] };

/** Estado del regador (Smart Life u otro): si el servidor lo informa. Aparte de `device.relay`, que dice el modo. */
export type RelayLink = {
  driver: 'tuya' | 'ewelink' | 'notify' | 'fake';
  connected: boolean;
  /** true si hay un regador al que se le puede mandar una prueba (el botón "Probar dispositivo"). */
  testAvailable?: boolean;
  /** Nombre del dispositivo de prueba en Smart Life, si lo trae. */
  testDeviceName?: string;
};

export type Snapshot = {
  /** 'loading' hasta que llegan los primeros datos. */
  load: 'loading' | 'ready';
  /** Mensaje si no se pudo hablar con el servidor. Los datos son los últimos conocidos. */
  error?: string;
  now: number;
  readings: Reading[];
  events: WaterEvent[];
  settings: Settings;
  device: DeviceStatus;
  /** Avisos registrados por el servidor (campana), del más nuevo al más viejo. Un servidor viejo no los manda. */
  incidents?: Incident[];
  /** El regador y si está conectado. Un backend viejo no lo manda: entonces no se muestra nada. */
  relayStatus?: RelayLink;
  /** Igual que `relayStatus` (el backend manda los dos). */
  relay?: RelayLink;
  /** true mientras los datos son simulados (todavía sin backend). */
  isDemo: boolean;
};
