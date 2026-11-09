import type { DeviceTestDetails, DeviceTestResult, RiegoApi } from '@/data/api';

/**
 * Estado del botón "Probar dispositivo". No usa React: evita el doble clic (mientras prueba ignora más pedidos), no da
 * la prueba por buena hasta que el servidor responde y deja el resultado a la vista un rato.
 */
export type DeviceTestState =
  | { phase: 'idle' }
  | { phase: 'testing' }
  | { phase: 'ok'; message: string; details?: DeviceTestDetails }
  | { phase: 'error'; error: string };

/** Cuánto queda a la vista el mensaje de éxito. */
export const OK_VISIBLE_MS = 4000;

type Api = Pick<RiegoApi, 'testDevice'>;

export class DeviceTest {
  private state: DeviceTestState = { phase: 'idle' };
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private alive = true;

  constructor(private readonly api: Api) {}

  subscribe = (l: () => void): (() => void) => {
    this.listeners.add(l);
    return () => void this.listeners.delete(l);
  };

  getState = (): DeviceTestState => this.state;

  run = async (): Promise<void> => {
    if (this.state.phase === 'testing') return; // doble clic
    clearTimeout(this.timer);
    this.set({ phase: 'testing' });
    let res: DeviceTestResult;
    try {
      res = await this.api.testDevice();
    } catch {
      res = { ok: false, error: 'No se pudo conectar con el servidor.' };
    }
    if (!this.alive) return;
    if (res.ok) {
      this.set({ phase: 'ok', message: res.message, ...(res.details ? { details: res.details } : {}) });
      this.timer = setTimeout(() => this.set({ phase: 'idle' }), OK_VISIBLE_MS);
    } else {
      this.set({ phase: 'error', error: res.error });
    }
  };

  /** Se llama al montar. React en desarrollo monta, desmonta y vuelve a montar: tras `dispose` tiene que poder seguir. */
  attach(): void {
    this.alive = true;
  }

  dispose(): void {
    this.alive = false;
    clearTimeout(this.timer);
  }

  private set(next: DeviceTestState): void {
    this.state = next;
    for (const l of this.listeners) l();
  }
}
