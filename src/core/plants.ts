import { PLANTS } from './copy';
import { formatAgo } from './format';
import type { PlantView, Sector } from './types';

export type SectorGroup = { sector: Sector; plants: PlantView[] };

/** Las plantas que se muestran: las archivadas se conservan en el servidor pero no se ven. */
export const activePlantsOf = (plants: readonly PlantView[]): PlantView[] => plants.filter((p) => p.archivedAt === undefined);

/**
 * Sectores con sus plantas, en el orden en que vienen. Un sector sin plantas igual aparece (para poder sumarle una).
 * Una planta cuyo sector no se conoce se ignora: no hay dónde mostrarla.
 */
export function groupBySector(sectors: readonly Sector[], plants: readonly PlantView[]): SectorGroup[] {
  const active = activePlantsOf(plants);
  return sectors.map((sector) => ({ sector, plants: active.filter((p) => p.sectorId === sector.id) }));
}

export type SectorSummary = {
  total: number;
  /** Plantas con sensor: las únicas que pueden necesitar agua. */
  withSensor: number;
  needWater: number;
  noData: number;
  noSensor: number;
};

export function sectorSummary(plants: readonly PlantView[]): SectorSummary {
  const count = (status: PlantView['status']) => plants.filter((p) => p.status === status).length;
  const noSensor = count('no-sensor');
  return {
    total: plants.length,
    withSensor: plants.length - noSensor,
    needWater: count('needs-water'),
    noData: count('no-data'),
    noSensor,
  };
}

/** "2 de 3 necesitan agua", "Todas en rango", "Sin plantas"... */
export function summaryText(s: SectorSummary): string {
  if (s.total === 0) return PLANTS.noPlants;
  if (s.withSensor === 0) return PLANTS.noSensors;
  const main = s.needWater > 0 ? PLANTS.needWater(s.needWater, s.withSensor) : s.noData === s.withSensor ? PLANTS.noData(s.noData) : PLANTS.allInRange;
  return s.needWater > 0 && s.noData > 0 ? `${main} · ${PLANTS.noData(s.noData)}` : s.needWater === 0 && s.noData > 0 && s.noData < s.withSensor ? `${main} · ${PLANTS.noData(s.noData)}` : main;
}

export type SectorChip = { id: string; label: string; count: number; needWater: number };

/** Los chips para cambiar de sector: "Todos" y uno por sector, con cuántas plantas hay y cuántas necesitan agua. */
export function sectorChips(groups: readonly SectorGroup[]): SectorChip[] {
  const all = groups.flatMap((g) => g.plants);
  return [
    { id: 'all', label: PLANTS.all, count: all.length, needWater: all.filter((p) => p.status === 'needs-water').length },
    ...groups.map((g) => ({
      id: g.sector.id,
      label: g.sector.name,
      count: g.plants.length,
      needWater: g.plants.filter((p) => p.status === 'needs-water').length,
    })),
  ];
}

/** Las plantas del chip elegido ('all' = todas), en el orden de los sectores. */
export function plantsInChip(groups: readonly SectorGroup[], chipId: string): PlantView[] {
  return groups.filter((g) => chipId === 'all' || g.sector.id === chipId).flatMap((g) => g.plants);
}

/** La planta de al lado para el swipe: `dir` 1 = siguiente, -1 = anterior. No da la vuelta (en el borde, undefined). */
export function neighborPlant(order: readonly PlantView[], currentId: string, dir: 1 | -1): PlantView | undefined {
  const i = order.findIndex((p) => p.id === currentId);
  return i < 0 ? undefined : order[i + dir];
}

/** "Última lectura hace 4 min"; sin lectura, "Sin lecturas todavía"; sin sensor, nada. */
export function lastReadingText(p: Pick<PlantView, 'status' | 'lastReadingAt'>, now: number): string | undefined {
  if (p.status === 'no-sensor') return undefined;
  return p.lastReadingAt === null ? PLANTS.noReadingYet : PLANTS.lastReading(formatAgo(Math.max(0, now - p.lastReadingAt)));
}

/** Umbral que vale para la planta y de dónde sale ("usa el del sector" si no tiene uno propio). */
export function thresholdSource(p: Pick<PlantView, 'thresholdPct' | 'targetPct'>): { own: boolean; label?: string } {
  const own = p.thresholdPct !== null && p.thresholdPct !== undefined;
  return own ? { own } : { own, label: PLANTS.usesSector };
}
