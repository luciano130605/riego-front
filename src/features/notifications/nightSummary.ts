import type { NightSummary } from '@/core/types';

const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** 75 → "1 h 15 min"; 40 → "40 min"; 120 → "2 h". */
export function minutesLabel(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

/**
 * Las líneas del resumen de la noche, en pocas oraciones. Lo que el servidor no manda no se muestra, y lo que vale
 * cero (sin desconexión, sin problemas del sensor) tampoco, para que se lea de un vistazo.
 */
export function nightSummaryLines(s: NightSummary): string[] {
  const lines: string[] = [];

  const { moistureStart: a, moistureEnd: b, moistureMin: min } = s;
  if (a !== undefined && b !== undefined) {
    lines.push(`La humedad pasó de ${Math.round(a)} % a ${Math.round(b)} %${min !== undefined ? ` (mínima ${Math.round(min)} %)` : ''}.`);
  } else if (min !== undefined) {
    lines.push(`La humedad mínima fue ${Math.round(min)} %.`);
  } else if (b !== undefined) {
    lines.push(`La humedad terminó en ${Math.round(b)} %.`);
  }

  if (s.wateringAlerts !== undefined) {
    lines.push(
      s.wateringAlerts === 0
        ? 'No hubo avisos de riego.'
        : `Hubo ${s.wateringAlerts} ${plural(s.wateringAlerts, 'aviso', 'avisos')} de riego.`,
    );
  }

  if (s.wateringsAuto !== undefined || s.wateringsManual !== undefined) {
    const auto = s.wateringsAuto ?? 0;
    const manual = s.wateringsManual ?? 0;
    const total = auto + manual;
    if (total === 0) {
      lines.push('No hubo riegos.');
    } else {
      const parts: string[] = [];
      if (auto > 0) parts.push(`${auto} ${plural(auto, 'automático', 'automáticos')}`);
      if (manual > 0) parts.push(`${manual} ${plural(manual, 'manual', 'manuales')}`);
      lines.push(`Hubo ${total} ${plural(total, 'riego', 'riegos')}: ${parts.join(' y ')}.`);
    }
  }

  if (s.offlineMin !== undefined && s.offlineMin > 0) {
    lines.push(`La placa estuvo sin conexión ${minutesLabel(s.offlineMin)}.`);
  }

  if (s.sensorIssues !== undefined && s.sensorIssues > 0) {
    lines.push(`Hubo ${s.sensorIssues} ${plural(s.sensorIssues, 'problema', 'problemas')} del sensor.`);
  }

  return lines.length > 0 ? lines : ['Sin novedades durante la noche.'];
}
