import { describe, expect, it } from 'vitest';
import {
  activePlantsOf,
  groupBySector,
  lastReadingText,
  neighborPlant,
  plantsInChip,
  sectorChips,
  sectorSummary,
  summaryText,
  thresholdSource,
} from './plants';
import type { PlantStatus, PlantView, Sector } from './types';

const sectors: Sector[] = [
  { id: 's1', name: 'Interior', thresholdPct: 35, targetPct: 55 },
  { id: 's2', name: 'Terraza', thresholdPct: 30, targetPct: 60 },
  { id: 's3', name: 'Vacío', thresholdPct: 30, targetPct: 60 },
];

const plant = (id: string, sectorId: string, status: PlantStatus, extra: Partial<PlantView> = {}): PlantView => ({
  id,
  name: id,
  sectorId,
  sensor: status === 'no-sensor' ? null : { deviceId: 'default', channel: 'main' },
  thresholdPct: null,
  targetPct: null,
  rawDry: 3100,
  rawWet: 1350,
  auto: true,
  sectorName: sectors.find((s) => s.id === sectorId)?.name ?? '?',
  effectiveThresholdPct: 35,
  effectiveTargetPct: 55,
  moisture: status === 'no-sensor' || status === 'no-data' ? null : status === 'needs-water' ? 20 : 50,
  lastRaw: null,
  lastReadingAt: status === 'no-sensor' ? null : 1_000_000,
  status,
  ...extra,
});

const plants = [
  plant('a', 's1', 'needs-water'),
  plant('b', 's1', 'ok'),
  plant('c', 's1', 'needs-water'),
  plant('d', 's2', 'no-sensor'),
  plant('e', 's2', 'ok', { archivedAt: 5 }),
];

describe('groupBySector', () => {
  it('agrupa las plantas activas por sector y conserva el orden; las archivadas no salen', () => {
    const g = groupBySector(sectors, plants);
    expect(g.map((x) => [x.sector.id, x.plants.map((p) => p.id)])).toEqual([
      ['s1', ['a', 'b', 'c']],
      ['s2', ['d']],
      ['s3', []],
    ]);
    expect(activePlantsOf(plants).map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('una planta de un sector desconocido no se muestra', () => {
    expect(groupBySector(sectors, [plant('x', 'nope', 'ok')]).flatMap((g) => g.plants)).toEqual([]);
  });
});

describe('summaryText', () => {
  it('"2 de 3 necesitan agua" (cuenta las plantas con sensor)', () => {
    const [i] = groupBySector(sectors, plants);
    expect(summaryText(sectorSummary(i.plants))).toBe('2 de 3 necesitan agua');
  });
  it('singular', () => {
    expect(summaryText(sectorSummary([plant('a', 's1', 'needs-water'), plant('b', 's1', 'ok')]))).toBe('1 de 2 necesita agua');
  });
  it('todo en rango, sin plantas, sin sensores y sin datos', () => {
    expect(summaryText(sectorSummary([plant('a', 's1', 'ok'), plant('b', 's1', 'ok')]))).toBe('Todas en rango');
    expect(summaryText(sectorSummary([]))).toBe('Sin plantas');
    expect(summaryText(sectorSummary([plant('a', 's1', 'no-sensor')]))).toBe('Ninguna planta tiene sensor');
    expect(summaryText(sectorSummary([plant('a', 's1', 'no-data'), plant('b', 's1', 'no-sensor')]))).toBe('1 sin datos');
  });
  it('mezcla: en rango pero con alguna sin datos, o necesitan agua y otra sin datos', () => {
    expect(summaryText(sectorSummary([plant('a', 's1', 'ok'), plant('b', 's1', 'no-data')]))).toBe('Todas en rango · 1 sin datos');
    expect(summaryText(sectorSummary([plant('a', 's1', 'needs-water'), plant('b', 's1', 'no-data'), plant('c', 's1', 'ok')]))).toBe(
      '1 de 3 necesita agua · 1 sin datos',
    );
  });
});

describe('chips y swipe', () => {
  const groups = groupBySector(sectors, plants);
  it('un chip "Todos" y uno por sector, con el conteo y las que necesitan agua', () => {
    expect(sectorChips(groups)).toEqual([
      { id: 'all', label: 'Todos', count: 4, needWater: 2 },
      { id: 's1', label: 'Interior', count: 3, needWater: 2 },
      { id: 's2', label: 'Terraza', count: 1, needWater: 0 },
      { id: 's3', label: 'Vacío', count: 0, needWater: 0 },
    ]);
  });
  it('las plantas del chip elegido', () => {
    expect(plantsInChip(groups, 'all').map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(plantsInChip(groups, 's2').map((p) => p.id)).toEqual(['d']);
    expect(plantsInChip(groups, 'nope')).toEqual([]);
  });
  it('el swipe va a la planta de al lado y no da la vuelta', () => {
    const order = plantsInChip(groups, 'all');
    expect(neighborPlant(order, 'b', 1)?.id).toBe('c');
    expect(neighborPlant(order, 'b', -1)?.id).toBe('a');
    expect(neighborPlant(order, 'a', -1)).toBeUndefined();
    expect(neighborPlant(order, 'd', 1)).toBeUndefined();
    expect(neighborPlant(order, 'zzz', 1)).toBeUndefined();
  });
});

describe('lastReadingText y umbral', () => {
  it('hace cuánto fue la última lectura; sin sensor no dice nada', () => {
    expect(lastReadingText(plant('a', 's1', 'ok'), 1_000_000 + 4 * 60_000)).toBe('Última lectura hace 4 min');
    expect(lastReadingText(plant('a', 's1', 'no-data', { lastReadingAt: null }), 1)).toBe('Sin lecturas todavía');
    expect(lastReadingText(plant('d', 's2', 'no-sensor'), 1)).toBeUndefined();
  });
  it('el umbral propio o "usa el del sector"', () => {
    expect(thresholdSource({ thresholdPct: null, targetPct: null })).toEqual({ own: false, label: 'usa el del sector' });
    expect(thresholdSource({ thresholdPct: 40, targetPct: null })).toEqual({ own: true });
    expect(thresholdSource({})).toEqual({ own: false, label: 'usa el del sector' });
  });
});
