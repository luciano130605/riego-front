import { captureValue, stability, validateCalibration, type Stability, type Validation } from '@/core/calibration';
import type { CaptureResult, RiegoApi } from '@/data/api';

/**
 * Controlador de la calibración asistida. No usa React: guarda el estado de los dos pasos (aire y agua),
 * sigue las lecturas que llegan en `snapshot.device.calibration` y se asegura de llamar a `stopCalibration`
 * al terminar o al cerrar. La pantalla (CalibrationDialog) solo lo dibuja.
 */

export type CalPhase =
  | 'idle'
  | 'starting' // pidiéndole al servidor que empiece
  | 'running' // la placa manda lecturas seguidas
  | 'error' // no se pudo empezar
  | 'ended'; // terminó (a mano, por tiempo o porque se guardó)

export type CalStep = 'air' | 'water' | 'review';
export type CalEnd = 'finished' | 'timeout' | 'saved';

export type FlowState = {
  phase: CalPhase;
  step: CalStep;
  end?: CalEnd;
  /** Últimas lecturas crudas, la más nueva al final. */
  recent: number[];
  lastRaw: number | null;
  stability: Stability;
  /** Lo que queda de calibración, en ms. */
  remainingMs: number;
  rawDry: number | null;
  rawWet: number | null;
  /** Si el rango seco/mojado sirve. Existe cuando ya están los dos valores; si no sirve, trae el motivo y no se puede guardar. */
  check?: Validation;
  /** Último problema de la pantalla (no se pudo empezar, no está estable, validación, no se guardó...). */
  problem?: string;
  /** La placa dejó de mandar lecturas seguidas (o se cayó la conexión con el servidor). */
  waiting: boolean;
  saving: boolean;
};

type Api = Pick<RiegoApi, 'subscribe' | 'getSnapshot' | 'now' | 'startCalibration' | 'stopCalibration' | 'captureCalibration'>;

/** Si pasa más que esto sin lecturas nuevas de la placa, se avisa que se está esperando. */
const SILENCE_MS = 12_000;
const TICK_MS = 500;

export class CalibrationFlow {
  /** Los puntos que tomó el servidor (si la API los toma ahí), para esperarlos antes de dar por guardada la calibración. */
  private serverCaptures: { dry?: Promise<CaptureResult>; wet?: Promise<CaptureResult> } = {};
  private listeners = new Set<() => void>();
  private state: FlowState;
  private unsubscribe: (() => void) | undefined;
  private ticker: ReturnType<typeof setInterval> | undefined;
  private startTimer: ReturnType<typeof setTimeout> | undefined;
  private startPromise: Promise<void> | undefined;
  private stopped = false; // ya se mandó (o no hace falta mandar) el stop
  private disposed = false;

  constructor(private readonly api: Api) {
    this.state = this.build({ phase: 'idle', step: 'air', rawDry: null, rawWet: null, saving: false });
  }

  // --- Estado observable (useSyncExternalStore) --------------------------------

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };

  getState = (): FlowState => this.state;

  private set(patch: Partial<FlowState>): void {
    this.state = this.build({ ...this.state, ...patch });
    for (const l of this.listeners) l();
  }

  /** Completa lo que sale del snapshot (lecturas, estabilidad, cuenta regresiva). */
  private build(base: Pick<FlowState, 'phase' | 'step' | 'rawDry' | 'rawWet' | 'saving'> & Partial<FlowState>): FlowState {
    const snap = this.api.getSnapshot();
    const cal = snap.device.calibration;
    const recent = cal?.recent ?? [];
    const now = this.api.now();
    const silent = snap.device.lastSeen > 0 && now - snap.device.lastSeen > SILENCE_MS;
    return {
      ...base,
      recent,
      lastRaw: recent.length ? recent[recent.length - 1] : (snap.device.lastRaw ?? null),
      stability: stability(recent),
      remainingMs: base.phase === 'running' && cal ? Math.max(0, cal.until - now) : 0,
      waiting: base.phase === 'running' && (!!snap.error || silent || recent.length === 0),
    };
  }

  // --- Ciclo de vida -----------------------------------------------------------

  /**
   * Arranca. El pedido se manda en el siguiente turno del reloj: si el componente se monta, se desmonta y se
   * vuelve a montar enseguida (StrictMode), el primer arranque se cancela y no queda un start/stop cruzado.
   */
  start(): void {
    if (this.disposed || this.startTimer !== undefined || this.state.phase !== 'idle') return;
    this.startTimer = setTimeout(() => {
      this.startTimer = undefined;
      this.startPromise = this.doStart();
    }, 0);
  }

  private async doStart(): Promise<void> {
    this.set({ phase: 'starting' });
    const res = await this.api.startCalibration();
    if (!res.ok) {
      this.stopped = true; // no llegó a empezar: no hay nada que parar
      this.set({ phase: 'error', problem: res.error });
      return;
    }
    this.stopped = false;
    if (this.disposed) return; // se cerró mientras arrancaba: dispose() ya se ocupa del stop
    this.unsubscribe = this.api.subscribe(() => this.refresh());
    this.ticker = setInterval(() => this.refresh(), TICK_MS);
    this.set({ phase: 'running', problem: undefined });
  }

  /** Vuelve a mirar el snapshot: lecturas nuevas, cuenta regresiva y si la calibración se cortó sola. */
  private refresh(): void {
    if (this.state.phase !== 'running') return;
    const cal = this.api.getSnapshot().device.calibration;
    if (!cal || !cal.active || this.api.now() >= cal.until) {
      void this.end('timeout');
      return;
    }
    this.set({});
  }

  private clearTimers(): void {
    clearInterval(this.ticker);
    this.ticker = undefined;
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  /** Termina y le dice al servidor que pare (una sola vez). */
  private async end(reason: CalEnd): Promise<void> {
    this.clearTimers();
    this.set({ phase: 'ended', end: reason, saving: false });
    await this.sendStop();
  }

  private async sendStop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    await this.api.stopCalibration();
  }

  /** "Terminar": corta la calibración sin guardar nada. */
  finish(): Promise<void> {
    return this.end('finished');
  }

  /** Al cerrar el diálogo o desmontar: se asegura de que la placa vuelva a su ritmo normal. */
  dispose(): void {
    this.disposed = true;
    clearTimeout(this.startTimer);
    this.startTimer = undefined;
    this.clearTimers();
    if (this.startPromise) {
      // Si todavía estaba arrancando, el stop va cuando termine de arrancar.
      void this.startPromise.then(() => this.sendStop());
    }
  }

  // --- Pasos ------------------------------------------------------------------

  /** Paso 1: toma la mediana de las últimas lecturas, si el valor está quieto, como "seco". */
  useAsDry(): void {
    if (this.state.phase !== 'running' || this.state.step !== 'air') return;
    const v = captureValue(this.state.recent);
    if (v === null) {
      this.set({ problem: 'El valor todavía se mueve. Esperá a que esté estable.' });
      return;
    }
    this.serverCaptures = { dry: this.api.captureCalibration?.('dry') };
    this.set({ rawDry: v, rawWet: null, step: 'water', problem: undefined });
  }

  /** Paso 2: lo mismo con el sensor en el agua, como "mojado". Revisa los dos valores juntos (`check`). */
  useAsWet(): void {
    if (this.state.phase !== 'running' || this.state.step !== 'water' || this.state.rawDry === null) return;
    const v = captureValue(this.state.recent);
    if (v === null) {
      this.set({ problem: 'El valor todavía se mueve. Esperá a que esté estable.' });
      return;
    }
    // Se fija igual: el resultado se muestra con el aviso (rango muy chico o valores invertidos) y no deja guardar.
    this.serverCaptures.wet = this.api.captureCalibration?.('wet');
    this.set({ rawWet: v, step: 'review', check: validateCalibration(this.state.rawDry, v), problem: undefined });
  }

  /** Vuelve a empezar los pasos (sin cortar la calibración). */
  restart(): void {
    if (this.state.phase !== 'running') return;
    this.set({ step: 'air', rawDry: null, rawWet: null, check: undefined, problem: undefined });
  }

  /** 'none' = la API no toma puntos en el servidor; 'saved' = ya la guardó; 'failed' = no pudo (el problema ya se avisó). */
  private async awaitServerCapture(): Promise<'none' | 'saved' | 'failed'> {
    const { dry, wet } = this.serverCaptures;
    if (!dry || !wet) return 'none';
    const [d, w] = await Promise.all([dry, wet]);
    const bad = !d.ok ? d : !w.ok ? w : undefined;
    if (bad && !bad.ok) {
      this.set({ saving: false, problem: bad.error });
      return 'failed';
    }
    if (w.ok && w.saved) return 'saved';
    this.set({ saving: false, problem: 'El servidor todavía no tiene los dos puntos. Volvé a tomarlos.' });
    return 'failed';
  }

  /** Guarda la calibración con updateSettings y termina. Si no se pudo guardar, lo dice y sigue. */
  async save(save: (patch: { rawDry: number; rawWet: number }) => Promise<boolean>): Promise<void> {
    const { rawDry, rawWet } = this.state;
    if (this.state.phase !== 'running' || rawDry === null || rawWet === null) return;
    const check = validateCalibration(rawDry, rawWet);
    if (!check.ok) {
      this.set({ problem: check.error });
      return;
    }
    this.set({ saving: true, problem: undefined });
    // Si el servidor toma los puntos, él guarda la calibración de ESTA planta al tener los dos: se espera su respuesta y no
    // se manda un PUT de ajustes (que iría a la primera planta).
    const server = await this.awaitServerCapture();
    if (server === 'failed') return;
    const ok = server === 'saved' ? true : await save({ rawDry, rawWet });
    if (!ok) {
      this.set({ saving: false, problem: 'No se pudo guardar la calibración. Probá de nuevo.' });
      return;
    }
    await this.end('saved');
  }
}
