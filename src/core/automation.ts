import { AUTO_MODE } from './copy';
import type { Snapshot } from './types';

/**
 * Qué se ve según el interruptor "Automático" (`settings.auto`). Es la ÚNICA fuente de verdad: los componentes miran
 * esto y no repiten la regla. Con el automático apagado desaparece todo lo que pertenece a las reglas automáticas; los
 * valores de esas reglas siguen guardados y reaparecen al volver a prender.
 */
export type AutomationView = {
  /** Todavía no llegaron los datos: no se muestra nada que dependa del modo, ni automático ni manual. */
  loading: boolean;
  /** `settings.auto`. Mientras carga no vale (mirá `loading`). */
  autoEnabled: boolean;
  show: {
    /**
     * La tarjeta "Riego" con "Regar ahora" / "Anotar riego". En manual no tiene sentido: no hay nada que pedirle a la
     * bomba, y el riego se nota cuando sube la humedad.
     */
    waterNow: boolean;
    /** La tarjeta "Próximo riego (automático)". */
    nextWatering: boolean;
    /** Textos de estado de las reglas automáticas: "En espera", pausa entre tandas, intervalo mínimo, etc. */
    ruleStatus: boolean;
    /** En Configuración → Automatización: modo, duración, tope de seguridad, intervalo mínimo y máximo por día. */
    autoSettings: boolean;
    /**
     * En Configuración: el umbral y el objetivo de humedad. Se ven siempre (con datos): no son solo del riego automático,
     * también son los de los avisos al celular (llegó al umbral, humedad recuperada, riego terminado).
     */
    alertThresholds: boolean;
    /** La pestaña "Datos de riego" de Configuración (probar el regador, resumen, riegos, decisiones del automático). */
    wateringData: boolean;
  };
  /** Qué dice el marcador de umbral de la barra de humedad. */
  thresholdLabel: (pct: number) => string;
  /** Subtítulo del encabezado. */
  subtitle: string;
};

/**
 * `plantAuto`: el interruptor Automático de la planta que se mira (sin planta a la vista, no cuenta). Para regar solo
 * hacen falta los dos: el general (`settings.auto`) y el de la planta.
 */
export function automationView(s: Pick<Snapshot, 'load' | 'settings'>, plantAuto?: boolean): AutomationView {
  const loading = s.load !== 'ready';
  const autoEnabled = !loading && s.settings.auto && (plantAuto ?? true);
  return {
    loading,
    autoEnabled,
    show: {
      waterNow: autoEnabled,
      nextWatering: autoEnabled,
      ruleStatus: autoEnabled,
      autoSettings: autoEnabled,
      alertThresholds: !loading,
      wateringData: autoEnabled,
    },
    // Los avisos al celular usan este mismo umbral, así que el marcador se queda aun en manual, dicho como aviso.
    thresholdLabel: autoEnabled || loading ? AUTO_MODE.thresholdAuto : AUTO_MODE.thresholdManual,
    subtitle: loading ? AUTO_MODE.subtitleLoading : autoEnabled ? AUTO_MODE.subtitleAuto : AUTO_MODE.subtitleManual,
  };
}
