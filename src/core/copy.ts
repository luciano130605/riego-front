import type { Cycle } from './cycles';
import type { Decision, Reason } from './decide';
import type { Forecast } from './forecast';
import { dayDiff, formatAgo, formatDuration, formatSeconds, HOUR_MS, num } from './format';
import type { CycleEnd, Period } from './stats';
import type { Settings } from './types';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

function partOfDay(hour: number): string {
  if (hour < 6) return 'de madrugada';
  if (hour < 12) return 'a la mañana';
  if (hour < 19) return 'a la tarde';
  return 'a la noche';
}

/** "hoy a la tarde", "mañana a la mañana", "el viernes a la noche". */
export function whenLabel(t: number, now: number): string {
  const diff = -dayDiff(t, now);
  const date = new Date(t);
  const day = diff <= 0 ? 'hoy' : diff === 1 ? 'mañana' : `el ${WEEKDAYS[date.getDay()]}`;
  return `${day} ${partOfDay(date.getHours())}`;
}

export type ForecastCopy = {
  headline: string;
  detail?: string;
  rate?: string;
};

export function forecastCopy(f: Forecast, now: number): ForecastCopy {
  switch (f.kind) {
    case 'now':
      return { headline: 'Ya está bajo el umbral' };
    case 'stable':
      return { headline: 'No se está secando', detail: 'Por ahora no hace falta regar.' };
    case 'far':
      return { headline: 'Faltan más de dos semanas' };
    case 'unknown':
      return {
        headline: 'Todavía no se puede estimar',
        detail: 'Hacen falta unas horas de lecturas después del último riego.',
      };
    case 'in': {
      const days = Math.round(f.hours / 24);
      const headline =
        f.hours < 2
          ? 'Riego estimado en menos de 2 h'
          : f.hours < 24
            ? `Riego estimado en unas ${Math.round(f.hours)} h`
            : `Riego estimado en ${Math.max(1, days)} ${days <= 1 ? 'día' : 'días'}`;
      return {
        headline,
        detail: `Hacia ${whenLabel(now + f.hours * HOUR_MS, now)}.`,
        rate: `Baja ${num(f.ratePerHour, 1)} puntos por hora.`,
      };
    }
  }
}

/** Por qué el sistema riega o no riega en este momento. */
export function decisionCopy(d: Decision, settings: Settings): string {
  switch (d.reason) {
    case 'water':
      return settings.mode === 'until-target'
        ? `Riega ${formatSeconds(settings.waterSeconds)} en la próxima lectura y sigue hasta llegar a ${settings.targetPct} %.`
        : `Riega ${formatSeconds(settings.waterSeconds)} en la próxima lectura.`;
    case 'soaking':
      return `Pausa para que el agua se reparta. Vuelve a medir en ${formatDuration(d.waitHours ?? 0)}.`;
    case 'target-reached':
      return `Llegó a ${settings.targetPct} %. Termina el riego.`;
    case 'cycle-limit':
      return `Alcanzó el tope de ${formatSeconds(settings.maxCycleSeconds)} de bomba por riego. No sigue.`;
    case 'not-needed':
      return 'No hace falta regar.';
    case 'auto-off':
      return 'El automático está apagado. Regá a mano o activalo.';
    case 'too-soon':
      return `Espera ${formatDuration(d.waitHours ?? 0)} desde el último riego.`;
    case 'daily-cap':
      return d.waitHours === undefined
        ? 'No puede regar: el máximo por día es 0.'
        : `Llegó al máximo de riegos por día. Se libera en ${formatDuration(d.waitHours)}.`;
    case 'bad-sensor':
      return 'El sensor no da una lectura confiable. No riega hasta revisarlo.';
    case 'stale':
      return 'No llegan lecturas nuevas. No riega hasta que vuelvan.';
  }
}

export type StatusKey = 'ok' | 'dry' | 'wet' | 'error';

export const STATUS_TEXT: Record<StatusKey, string> = {
  ok: 'Humedad adecuada',
  dry: 'Necesita agua',
  wet: 'Humedad elevada',
  error: 'Sin lectura confiable',
};

export type NextWatering = { headline: string; detail: string };

type NextWateringInput = {
  decision: Decision;
  forecast: Forecast;
  openCycle: Cycle | undefined;
  settings: Settings;
  now: number;
};

/** Qué dice la tarjeta "Próximo riego (automático)" según lo que decidió el sistema. */
export function nextWateringCopy({ decision, forecast, openCycle, settings, now }: NextWateringInput): NextWatering {
  const condition = `Cuando la humedad baje de ${settings.thresholdPct} %`;
  switch (decision.reason) {
    case 'auto-off':
      return { headline: 'Automático apagado', detail: 'No riega solo. Se activa con el interruptor de arriba.' };
    case 'soaking': {
      const done = openCycle ? `Lleva ${openCycle.seconds} s de bomba. ` : '';
      return {
        headline: 'Riego en curso',
        detail: `${done}Pausa para que el agua se reparta; vuelve a medir en ${formatDuration(decision.waitHours ?? 0)}.`,
      };
    }
    case 'water':
      return {
        headline: 'Riega en la próxima lectura',
        detail:
          settings.mode === 'until-target'
            ? `Sigue hasta llegar a ${settings.targetPct} %.`
            : `Riega ${formatSeconds(settings.waterSeconds)}.`,
      };
    case 'target-reached':
      return { headline: 'Riego terminado', detail: `Llegó a ${settings.targetPct} %.` };
    case 'cycle-limit':
      return {
        headline: 'Riego cortado por seguridad',
        detail: `Alcanzó ${formatSeconds(settings.maxCycleSeconds)} de bomba sin llegar a ${settings.targetPct} %. Conviene revisar la bomba y el sensor.`,
      };
    case 'too-soon':
    case 'daily-cap':
      return { headline: condition, detail: decisionCopy(decision, settings) };
    case 'bad-sensor':
    case 'stale':
      return { headline: 'En pausa', detail: decisionCopy(decision, settings) };
    case 'not-needed': {
      switch (forecast.kind) {
        case 'in':
          return { headline: condition, detail: `Según el ritmo actual, ${whenLabel(now + forecast.hours * HOUR_MS, now)}.` };
        case 'stable':
          return { headline: condition, detail: 'Por ahora no se está secando.' };
        case 'far':
          return { headline: condition, detail: 'Faltan más de dos semanas.' };
        default:
          return { headline: condition, detail: 'Esperando más lecturas para estimar cuándo.' };
      }
    }
  }
}

/** Estado de la automatización en una palabra, para la tarjeta de modo. */
export function automationState(d: Decision, auto: boolean): { label: string; active: boolean } {
  if (!auto) return { label: 'Apagada', active: false };
  switch (d.reason) {
    case 'water':
    case 'soaking':
      return { label: 'Regando', active: true };
    case 'bad-sensor':
    case 'stale':
      return { label: 'En pausa', active: false };
    case 'cycle-limit':
      return { label: 'Cortada por seguridad', active: false };
    default:
      return { label: 'En espera', active: false };
  }
}

/** Descripción corta de cómo riega el modo automático con los ajustes actuales. */
export function modeDescription(settings: Settings): string {
  if (!settings.auto) return 'El riego es manual';
  return settings.mode === 'until-target'
    ? `Riega hasta llegar a ${settings.targetPct} %`
    : `Riega ${formatSeconds(settings.waterSeconds)} cuando la humedad baja`;
}

/** Motivo de una decisión en una línea, para el registro de decisiones. */
const REASON_LABEL: Record<Reason, string> = {
  water: 'Regó',
  'not-needed': 'Humedad suficiente',
  'auto-off': 'Automático apagado',
  'too-soon': 'Esperando entre riegos',
  'daily-cap': 'Máximo diario alcanzado',
  soaking: 'Pausa entre tandas',
  'target-reached': 'Llegó al objetivo',
  'cycle-limit': 'Tope de seguridad alcanzado',
  'bad-sensor': 'Sensor con valor imposible',
  stale: 'Sin lecturas nuevas',
};

export function reasonLabel(reason: string): string {
  return REASON_LABEL[reason as Reason] ?? 'Motivo desconocido';
}

/** Cómo terminó un riego. */
export const CYCLE_END_LABEL: Record<CycleEnd, string> = {
  target: 'Llegó al objetivo',
  limit: 'Cortado por el tope de seguridad',
  'auto-off': 'Automático apagado',
  'in-progress': 'En curso',
  unconfirmed: 'Sin confirmar',
  manual: 'Riego a mano',
};

export const PERIOD_LABEL: Record<Period, string> = {
  '24h': '24 h',
  '7d': '7 días',
  '30d': '30 días',
};

// --- Modo aviso (todavía no hay regador conectado) -------------------------------------------

/** Textos de la pantalla cuando el servidor solo avisa y el riego es manual. */
export const AVISO = {
  /** Interruptor del encabezado y de Configuración (en vez de "Automático" / "Regar solo"). */
  switchLabel: 'Avisos',
  switchAria: 'Avisos de riego',
  /** La línea que explica qué hace el interruptor. */
  line: 'Te avisa cuando la planta necesita agua. El riego es manual.',
  on: 'Avisos activados.',
  off: 'Avisos apagados.',
  chip: 'Solo avisos',
  chipTitle: 'Todavía no hay un regador conectado: el sistema solo avisa y el riego es manual.',
  subtitle: 'Monitoreo y avisos de riego',
  /** "Regar ahora" pasa a ser un registro de un riego hecho a mano. */
  noteButton: 'Anotar riego',
  noting: 'Anotando',
  noted: 'Riego anotado.',
  noteConfirm: 'Anotar igual',
  noteBody: 'Se va a registrar un riego hecho a mano. No se prende ninguna bomba.',
  noteFailed: 'No se pudo anotar el riego.',
  cardTitle: 'Próximo riego (estimado)',
  lastNoted: 'Último riego anotado',
  noneNoted: 'Sin riegos anotados',
  testBlocked: 'Todavía no hay un regador conectado, así que no se puede probar.',
  modeTitle: 'Solo avisos',
  modeOff: 'Sin avisos',
} as const;

/** Texto del banner cuando hay una alerta abierta. */
export function needsWaterText(moisture: number, targetPct: number): string {
  return `La planta necesita agua: ${num(moisture)} % (objetivo ${targetPct} %)`;
}

/** Qué dice la tarjeta de "próximo riego" en modo aviso: cuándo se estima que va a necesitar agua. */
export function nextAlertCopy(input: {
  decision: Decision;
  forecast: Forecast;
  settings: Settings;
  now: number;
}): NextWatering {
  const { decision, forecast, settings, now } = input;
  const off = !settings.auto;
  const offNote = off ? ' Los avisos están apagados.' : '';
  if (decision.reason === 'bad-sensor' || decision.reason === 'stale') {
    return { headline: 'En pausa', detail: decisionCopy(decision, settings) };
  }
  if (forecast.kind === 'now') {
    return {
      headline: 'Ya necesita agua',
      detail: `La humedad está bajo ${settings.thresholdPct} %. Regá a mano y anotalo.${offNote}`,
    };
  }
  switch (forecast.kind) {
    case 'in':
      return {
        headline: `Necesitará agua ${whenLabel(now + forecast.hours * HOUR_MS, now)}`,
        detail: `Según el ritmo actual, cuando baje de ${settings.thresholdPct} %.${offNote}`,
      };
    case 'stable':
      return { headline: 'Por ahora no se está secando', detail: `Todavía no necesita agua.${offNote}` };
    case 'far':
      return { headline: 'Faltan más de dos semanas', detail: `Todavía no necesita agua.${offNote}` };
    default:
      return {
        headline: `Cuando la humedad baje de ${settings.thresholdPct} %`,
        detail: `Esperando más lecturas para estimar cuándo.${offNote}`,
      };
  }
}

// --- Estado del sensor ------------------------------------------------------------------------

/** Estado del sensor de humedad (Configuración → Dispositivo). */
export const SENSOR_STATE = {
  ok: 'Sensor funcionando',
  /** El valor crudo está pegado al máximo del conversor: no es una falla del sensor, casi siempre es el contacto. */
  saturated: 'Lectura al máximo: revisá que las púas toquen la tierra o el cable AO',
  fault: 'Sensor con falla',
  reasonLabel: 'Motivo',
  reason: {
    noise: 'Ruido en la señal',
    low: 'Lectura muy baja',
  },
  unknown: 'La placa no lo informa',
  /** Con la placa desconectada no hay cómo saber cómo está el sensor. */
  noData: 'Sin datos recientes',
} as const;

/** "Sin conexión desde hace 10 min". Menos de un minuto se dice como tal (no "desde recién"). */
export function offlineSince(ms: number): string {
  return `Sin conexión desde ${ms < 60_000 ? 'hace menos de 1 min' : formatAgo(ms)}`;
}

/** Errores de comunicación de la placa. */
export const COMMS = {
  none: 'Sin errores registrados',
  failedPosts: (n: number): string => `Envíos fallidos: ${n}`,
  resets: (reason: string): string => `Reinicios: ${reason}`,
} as const;

/** Por qué se reinició la placa, dicho en palabras. Si no se conoce el código, se muestra tal cual. */
const RESET_REASONS: Record<string, string> = {
  poweron: 'se encendió',
  brownout: 'baja tensión (brownout)',
  sw: 'reinicio por software',
  panic: 'error del firmware',
  wdt: 'se colgó (watchdog)',
  int_wdt: 'se colgó (watchdog)',
  task_wdt: 'se colgó (watchdog)',
  deepsleep: 'despertó del sueño',
  ext: 'botón de reinicio',
};

export function resetReasonText(code: string): string {
  return RESET_REASONS[code.trim().toLowerCase()] ?? code;
}

export const SENSOR = {
  /** Lo que se muestra en lugar de la humedad cuando no hay un sensor que la mida. */
  disconnected: 'No hay sensor',
  impossible: 'El valor que llega no es de tierra: el cable está suelto o el sensor desconectado. Revisá el cableado.',
  empty: 'Todavía no llegó ninguna lectura. Revisá que la placa esté encendida, con wifi y con el sensor conectado.',
  lastData: 'último dato',
  noSignal: (ago: string): string => `Sin señal ${ago}`,
} as const;


// --- Notificaciones push ----------------------------------------------------------------------

/** Textos de la pestaña Notificaciones. */
export const NOTIF = {
  insecure: 'Las notificaciones necesitan https o localhost. Abrí la pantalla desde una dirección segura (en esta PC, localhost).',
  unsupported: 'Este navegador no permite notificaciones push.',
  ios: 'En iPhone y iPad hay que agregar la app a la pantalla de inicio (Compartir → Agregar a inicio) y abrirla desde ahí para recibir notificaciones.',
  blocked:
    'Bloqueaste las notificaciones de este sitio. Habilitalas desde el candado de la barra de direcciones y volvé a tocar “Activar”.',
  off: 'Desactivadas en este dispositivo.',
  on: 'Activadas en este dispositivo. Llegan aunque el navegador esté cerrado.',
  denied: 'No permitiste las notificaciones, así que quedan desactivadas.',
  activated: 'Notificaciones activadas.',
  deactivated: 'Notificaciones desactivadas.',
  testSent: 'Listo: te mandamos una notificación de prueba.',
  testExpired: 'La suscripción de este dispositivo venció. Desactivá y volvé a activar las notificaciones.',
  testKindSent: (label: string): string => `Te mandamos la prueba de “${label}”. Mirá este dispositivo.`,
  testAllRunning: (n: number, total: number): string => `Mandando la prueba ${n} de ${total}…`,
  testAllDone: (total: number): string => `Listo: te mandamos las ${total} pruebas, una de cada aviso. Mirá este dispositivo.`,
  testAllStopped: (sent: number, total: number, label: string, error: string): string =>
    `Se mandaron ${sent} de ${total}. Se frenó en “${label}”: ${error}`,
} as const;

/** Avisos que manda el servidor, con los nombres que ve el usuario. */
export const PUSH_KIND_COPY = {
  'humedad-baja': { label: 'Llegó al umbral', hint: 'Cuando la humedad baja del umbral de riego.' },
  'necesita-riego': { label: 'Hora de regar', hint: 'Cuando hay que regar. Se repite si la tierra sigue seca.' },
  'humedad-recuperada': { label: 'Humedad recuperada', hint: 'Cuando la tierra vuelve a quedar sobre el umbral.' },
  'riego-iniciado': { label: 'Riego iniciado', hint: 'Cada vez que la bomba empieza a regar.' },
  'riego-terminado': { label: 'Riego terminado', hint: 'Cuando el riego llega a la humedad objetivo.' },
  'riego-cortado': { label: 'Riego cortado por seguridad', hint: 'Si el tope de seguridad corta el riego sin llegar al objetivo.' },
  'placa-offline': { label: 'La placa dejó de reportar', hint: 'Si la placa se queda sin corriente o sin wifi.' },
  'placa-vuelve': { label: 'La placa volvió', hint: 'Cuando la placa retoma las lecturas.' },
  'sensor-sospechoso': { label: 'Falla del sensor', hint: 'Si el sensor da un valor imposible (cable suelto).' },
} as const;

// --- Wi-Fi de la placa -------------------------------------------------------------------------

export const WIFI = {
  section: 'Wi-Fi',
  network: 'Red actual',
  signal: 'Señal',
  lastChange: 'Último cambio de red',
  unknown: 'La placa no lo informa',
  noNetwork: 'Sin red: la placa olvidó la anterior',
  noChange: 'Sin cambios registrados',
  noSignal: 'Sin dato',
  offlineTitle: 'La placa está sin conexión',
  offlineLead: 'Si cambiaste de router o de contraseña, tenés que cargarle el wifi de nuevo:',
  resetTitle: 'La placa olvidó la red y espera una nueva',
  resetLead: 'Ya está lista para recibir un wifi. Falta cargarlo:',
  /** Los pasos para cargar una red nueva. */
  steps: [
    'Mantené apretado el botón IO0 de la placa 5 segundos para olvidar la red.',
    'Desde el celular, conectate a la red riego-aut-setup.',
    'Elegí tu wifi, poné la contraseña y guardá.',
  ],
  /** Lo que dice la campana cuando la placa se conectó con otra red. */
  updated: (ssid?: string): string => (ssid ? `Wi-Fi actualizado: ${ssid}` : 'Wi-Fi actualizado'),
  serverDown: 'No hay conexión con el servidor: no se sabe cómo está el wifi de la placa. Se muestran los últimos datos.',
} as const;

// --- Calibración del sensor ---------------------------------------------------------------------

export const CAL = {
  section: 'Calibración del sensor',
  intro: 'Valores crudos que da la placa con la tierra seca y con la tierra mojada. De ahí sale el porcentaje de humedad.',
  label: 'Calibración asistida',
  idle: 'Inactiva. Te guía para medir el sensor en el aire y en agua; mientras calibra, la placa manda una lectura cada 5 segundos.',
  starting: 'Iniciando la calibración…',
  running: (left: string): string => `Calibrando · quedan ${left}`,
  endedSaved: 'Terminada: la calibración quedó guardada.',
  endedTimeout: 'Terminada: se acabó el tiempo y no se guardó nada.',
  endedFinished: 'Terminada sin guardar cambios.',
  startFailed: (why: string): string => `No se pudo iniciar la calibración. ${why}`,
  start: 'Empezar calibración',
  finish: 'Terminar',
  again: 'Calibrar de nuevo',
  blockedServer: 'No hay conexión con el servidor, así que no se puede calibrar.',
  blockedBoard: 'La placa está sin conexión: encendela y revisá el wifi para calibrar.',
  waiting: 'Esperando lecturas de la placa. Revisá que esté encendida y con wifi.',
  faultBefore: 'El sensor tiene una falla: arreglala antes de calibrar.',
  faultNow: 'No se puede fijar ningún valor mientras el sensor falle.',
  live: 'Valor crudo en vivo',
  chart: 'Últimos 2 minutos',
  stable: 'Estable',
  gathering: (have: number, need: number): string => `Juntando lecturas (${have} de ${need})`,
  moving: (range: number): string => `Moviéndose (variación de ${range} cuentas)`,
  stableDef: (need: number, limit: number): string => `Estable = las últimas ${need} lecturas varían menos de ${limit} cuentas.`,
  step1: '1. Sensor al aire: fijar seco',
  step2: '2. Sensor en agua (hasta la línea): fijar mojado',
  fixDry: 'Fijar seco',
  fixWet: 'Fijar mojado',
  capturedDry: (v: number): string => `Seco fijado: ${v}`,
  capturedWet: (v: number): string => `Mojado fijado: ${v}`,
  result: 'Resultado',
  dry: 'Seco (0 %)',
  wet: 'Mojado (100 %)',
  span: 'Diferencia',
  minSpan: (n: number): string => `mínimo ${n}`,
  preview: (raw: number | null, pct: string): string =>
    `Con estos valores, la lectura de ahora (${raw ?? 'Sin dato'}) daría ${pct} de humedad.`,
  repeat: 'Repetir',
  save: 'Guardar calibración',
  saving: 'Guardando…',
  saved: 'Calibración guardada.',
  saveFailed: 'No se pudo guardar la calibración. Probá de nuevo.',
  storedValues: 'Valores guardados',
  storedDry: 'Tierra seca (0 %)',
  storedDryHint: 'Valor crudo con el sensor al aire o en tierra seca.',
  storedWet: 'Tierra mojada (100 %)',
  storedWetHint: 'Valor crudo con el sensor en agua o en tierra empapada.',
} as const;

// --- Modo automático / manual (interruptor "Automático") -------------------------------------------

export const AUTO_MODE = {
  /** Mientras llegan los datos todavía no se sabe en qué modo está. */
  subtitleLoading: 'Monitoreo y riego',
  subtitleAuto: 'Monitoreo y riego automático',
  subtitleManual: 'Monitoreo y riego manual',
  /** Marcador del umbral en la barra de humedad: con el automático prendido dispara un riego; apagado, solo un aviso. */
  thresholdAuto: (pct: number): string => `Riega bajo ${pct} %`,
  thresholdManual: (pct: number): string => `Aviso bajo ${pct} %`,
  /** Tarjeta "Modo" apagado el automático (sin regador conectado, el riego igual es manual). */
  manualValue: 'Manual',
  avisoOffDetail: 'Avisos apagados. El riego es manual.',
} as const;

// --- No molestar y resumen de la noche --------------------------------------------------------------------------

export const QUIET = {
  section: 'No molestar',
  label: 'No molestar',
  from: 'Desde',
  to: 'Hasta',
  /** La ventana vigente. */
  window: (from: string, to: string): string => `De ${from} a ${to}`,
  hintOn: (from: string, to: string): string =>
    `De ${from} a ${to}. En ese horario no te mandamos notificaciones y a la mañana te llega un resumen de la noche.`,
  hintOff: (from: string, to: string): string =>
    `Apagado. Si lo prendés, de ${from} a ${to} no te mandamos notificaciones y a la mañana te llega un resumen de la noche.`,
  sameTime: '“Desde” y “hasta” no pueden ser la misma hora.',
  invalidTime: 'Elegí una hora válida.',
  on: 'No molestar activado.',
  off: 'No molestar desactivado.',
  saved: 'Horario guardado.',
} as const;

export const BELL = {
  nightSummary: 'Resumen de la noche',
  silenced: 'silenciado',
  dismiss: 'Descartar aviso',
  dismissSummary: 'Descartar el resumen de la noche',
} as const;

