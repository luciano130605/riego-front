import { afterEach, describe, expect, it, vi } from 'vitest';
import { groupBySector, sectorSummary, summaryText } from '@/core/plants';
import { MockRiego } from './mockRiego';

const fresh = () => new MockRiego({ loadMs: 0 });
const plants = (api: MockRiego) => api.getSnapshot().plants!;
const byName = (api: MockRiego, name: string) => plants(api).find((p) => p.name === name)!;

afterEach(() => vi.useRealTimers());

describe('simulador: sectores y plantas de ejemplo', () => {
  it('trae 2 sectores y 4 plantas, una sin sensor, y 2 placas', () => {
    const s = fresh().getSnapshot();
    expect(s.sectors!.map((x) => x.name)).toEqual(['Interior', 'Terraza']);
    expect(s.plants!.map((p) => p.name)).toEqual(['Monstera', 'Helecho', 'Potus', 'Tomates']);
    expect(s.plants!.filter((p) => p.sensor === null).map((p) => p.name)).toEqual(['Potus']);
    expect(s.devices!.map((d) => d.id)).toEqual(['default', 'dev-terraza']);
  });

  it('la planta sin sensor no tiene humedad ni lectura', () => {
    const potus = byName(fresh(), 'Potus');
    expect(potus).toMatchObject({ status: 'no-sensor', moisture: null, lastReadingAt: null, lastRaw: null });
  });

  it('cada planta con sensor tiene su humedad y su estado según su umbral efectivo', () => {
    const api = fresh();
    for (const p of plants(api).filter((x) => x.sensor)) {
      expect(p.moisture).not.toBeNull();
      expect(p.lastReadingAt).not.toBeNull();
      expect(p.status).toBe(p.moisture! < p.effectiveThresholdPct ? 'needs-water' : 'ok');
    }
    // Tomates tiene umbral propio (40) y Terraza usa 30.
    expect(byName(api, 'Tomates')).toMatchObject({ thresholdPct: 40, effectiveThresholdPct: 40 });
    expect(byName(api, 'Monstera').thresholdPct).toBeNull();
  });

  it('se agrupa por sector y el resumen sale de los estados', () => {
    const api = fresh();
    const g = groupBySector(api.getSnapshot().sectors!, plants(api));
    expect(g.map((x) => x.plants.map((p) => p.name))).toEqual([['Monstera', 'Helecho', 'Potus'], ['Tomates']]);
    const interior = sectorSummary(g[0].plants);
    expect(interior).toMatchObject({ total: 3, withSensor: 2, noSensor: 1 });
    expect(summaryText(interior)).toMatch(/necesit|Todas en rango/);
  });

  it('con la placa sin conexión las plantas con sensor quedan "sin datos"', () => {
    const api = fresh();
    api.setFault('offline');
    const st = plants(api).map((p) => [p.name, p.status]);
    expect(st).toEqual([['Monstera', 'no-data'], ['Helecho', 'no-data'], ['Potus', 'no-sensor'], ['Tomates', 'no-data']]);
  });
});

describe('simulador: el ámbito (la planta que se mira)', () => {
  it('sin planta a la vista el snapshot es el general; con una, trae su umbral, calibración y riegos', () => {
    const api = fresh();
    expect(api.getPlantScope()).toBeUndefined();
    api.setPlantScope('plant-tomates');
    const s = api.getSnapshot();
    expect(api.getPlantScope()).toBe('plant-tomates');
    expect(s.settings).toMatchObject({ thresholdPct: 40, targetPct: 60 });
    expect(s.events).toEqual([]);
    // Sus lecturas son de esa planta (derivadas de la principal con su diferencia).
    const base = fresh().getSnapshot().readings.at(-1)!.moisture;
    expect(s.readings.at(-1)!.moisture).toBe(Math.max(0, Math.min(100, Math.round(base + 6))));
  });

  it('volver a la vista general devuelve los datos de la primera planta', () => {
    const api = fresh();
    const general = api.getSnapshot().readings.at(-1)!.moisture;
    api.setPlantScope('plant-helecho');
    expect(api.getSnapshot().readings.at(-1)!.moisture).not.toBe(general);
    api.setPlantScope(undefined);
    expect(api.getSnapshot().readings.at(-1)!.moisture).toBe(general);
  });

  it('una planta sin sensor no tiene lecturas', () => {
    const api = fresh();
    api.setPlantScope('plant-potus');
    expect(api.getSnapshot().readings).toEqual([]);
  });

  it('una planta que no existe o está archivada cae a la vista general', async () => {
    const api = fresh();
    api.setPlantScope('nope');
    expect(api.getSnapshot().readings.length).toBeGreaterThan(0);
    await api.archivePlant('plant-tomates');
    api.setPlantScope('plant-tomates');
    expect(api.getSnapshot().settings.thresholdPct).toBe(api.getSnapshot().sectors![0].thresholdPct);
  });

  it('regar con una planta a la vista riega esa: queda su evento y la de al lado no se toca', async () => {
    const api = fresh();
    const before = api.getSnapshot().events.length;
    api.setPlantScope('plant-helecho');
    const dry = byName(api, 'Helecho').moisture!;
    expect(await api.waterNow()).toEqual({ ok: true });
    expect(api.getSnapshot().events).toHaveLength(1);
    expect(api.getSnapshot().events[0]).toMatchObject({ plantId: 'plant-helecho', source: 'manual' });
    expect(byName(api, 'Helecho').moisture!).toBeGreaterThan(dry);
    api.setPlantScope(undefined);
    expect(api.getSnapshot().events).toHaveLength(before); // los de la principal no cambiaron
  });

  it('se puede anotar el riego de una planta sin sensor', async () => {
    const api = fresh();
    expect(await api.waterPlant('plant-potus')).toEqual({ ok: true });
    api.setPlantScope('plant-potus');
    expect(api.getSnapshot().events).toHaveLength(1);
  });

  it('no deja regar dos veces seguidas la misma planta', async () => {
    const api = fresh();
    expect(await api.waterPlant('plant-helecho')).toEqual({ ok: true });
    expect(await api.waterPlant('plant-helecho')).toEqual({ ok: false, error: 'La bomba ya está regando.' });
  });

  it('calibrar solo se puede con una planta con sensor', async () => {
    const api = fresh();
    api.setPlantScope('plant-potus');
    expect(await api.startCalibration()).toEqual({ ok: false, error: 'La planta no tiene sensor.' });
    api.setPlantScope('plant-main');
    expect(await api.startCalibration()).toEqual({ ok: true });
  });
});

describe('simulador: sectores', () => {
  it('crea, edita (parcial) y borra un sector vacío', async () => {
    const api = fresh();
    expect(await api.createSector({ name: 'Balcón', thresholdPct: 30, targetPct: 55 })).toEqual({ ok: true });
    const id = api.getSnapshot().sectors!.find((s) => s.name === 'Balcón')!.id;
    expect(await api.updateSector(id, { thresholdPct: 25 })).toEqual({ ok: true });
    expect(api.getSnapshot().sectors!.find((s) => s.id === id)).toMatchObject({ thresholdPct: 25, targetPct: 55 });
    expect(await api.deleteSector(id)).toEqual({ ok: true });
    expect(api.getSnapshot().sectors).toHaveLength(2);
  });

  it('rechaza (no corrige) un umbral o un objetivo fuera de rango', async () => {
    const api = fresh();
    expect((await api.createSector({ name: 'X', thresholdPct: 5, targetPct: 55 })).ok).toBe(false);
    expect(await api.createSector({ name: 'X', thresholdPct: 40, targetPct: 42 })).toEqual({
      ok: false,
      error: 'El objetivo tiene que ser al menos 5 puntos mayor que el umbral.',
    });
    expect(api.getSnapshot().sectors).toHaveLength(2);
  });

  it('un nombre repetido (sin distinguir mayúsculas) da conflicto', async () => {
    const api = fresh();
    expect(await api.createSector({ name: 'interior', thresholdPct: 30, targetPct: 55 })).toEqual({
      ok: false,
      error: 'Ya hay un sector con ese nombre.',
    });
  });

  it('un sector con plantas no se borra; cambiar su umbral cambia el efectivo de las que heredan', async () => {
    const api = fresh();
    expect(await api.deleteSector('sector-interior')).toEqual({ ok: false, error: 'El sector tiene plantas: archivalas o movelas primero.' });
    expect(await api.updateSector('sector-interior', { thresholdPct: 50, targetPct: 80 })).toEqual({ ok: true });
    expect(byName(api, 'Helecho').effectiveThresholdPct).toBe(50);
    expect(byName(api, 'Tomates').effectiveThresholdPct).toBe(40); // tiene el suyo
  });
});

describe('simulador: plantas', () => {
  it('crea una planta en un sector, con y sin sensor', async () => {
    const api = fresh();
    expect(await api.createPlant({ name: 'Albahaca', sectorId: 'sector-terraza' })).toEqual({ ok: true });
    const p = byName(api, 'Albahaca');
    expect(p).toMatchObject({ sensor: null, status: 'no-sensor', sectorName: 'Terraza', thresholdPct: null, auto: true });
    expect(await api.setPlantSensor(p.id, { deviceId: 'dev-terraza', channel: 'ch2' })).toEqual({ ok: true });
    expect(byName(api, 'Albahaca').sensor).toEqual({ deviceId: 'dev-terraza', channel: 'ch2' });
    expect(byName(api, 'Albahaca').status).not.toBe('no-sensor');
  });

  it('el canal de otra planta activa da conflicto; una placa o canal inválido, error', async () => {
    const api = fresh();
    const potus = byName(api, 'Potus');
    expect(await api.setPlantSensor(potus.id, { deviceId: 'default', channel: 'main' })).toEqual({ ok: false, error: 'Ese canal ya lo usa otra planta.' });
    expect(await api.setPlantSensor(potus.id, { deviceId: 'nope', channel: 'a' })).toEqual({ ok: false, error: 'No existe esa placa.' });
    expect((await api.setPlantSensor(potus.id, { deviceId: 'default', channel: 'con espacio' })).ok).toBe(false);
    expect(byName(api, 'Potus').sensor).toBeNull();
  });

  it('quitar el sensor la deja sin sensor', async () => {
    const api = fresh();
    expect(await api.setPlantSensor('plant-helecho', null)).toEqual({ ok: true });
    expect(byName(api, 'Helecho')).toMatchObject({ sensor: null, status: 'no-sensor', moisture: null });
  });

  it('mover de sector: cambia el sector y el umbral efectivo', async () => {
    const api = fresh();
    expect(await api.updatePlant('plant-helecho', { sectorId: 'sector-terraza' })).toEqual({ ok: true });
    expect(byName(api, 'Helecho')).toMatchObject({ sectorId: 'sector-terraza', sectorName: 'Terraza', effectiveThresholdPct: 30 });
    expect((await api.updatePlant('plant-helecho', { sectorId: 'nope' })).ok).toBe(false);
  });

  it('umbral propio opcional: null vuelve a heredar', async () => {
    const api = fresh();
    expect(await api.updatePlant('plant-helecho', { thresholdPct: 45 })).toEqual({ ok: true });
    expect(byName(api, 'Helecho')).toMatchObject({ thresholdPct: 45, effectiveThresholdPct: 45 });
    expect(await api.updatePlant('plant-helecho', { thresholdPct: null })).toEqual({ ok: true });
    expect(byName(api, 'Helecho')).toMatchObject({ thresholdPct: null, effectiveThresholdPct: 35 });
    // Un umbral propio que deja al objetivo del sector a menos de 5 puntos se rechaza.
    expect((await api.updatePlant('plant-helecho', { thresholdPct: 52 })).ok).toBe(false);
  });

  it('el automático de cada planta es propio', async () => {
    const api = fresh();
    expect(await api.updatePlant('plant-helecho', { auto: false })).toEqual({ ok: true });
    expect(byName(api, 'Helecho').auto).toBe(false);
    expect(byName(api, 'Monstera').auto).toBe(true);
  });

  it('archivar: sale de la vista, conserva datos y libera el canal; restaurar vuelve sin sensor', async () => {
    const api = fresh();
    expect(await api.archivePlant('plant-helecho')).toEqual({ ok: true });
    expect(plants(api).map((p) => p.name)).not.toContain('Helecho');
    // El canal ch2 quedó libre.
    expect(await api.setPlantSensor('plant-potus', { deviceId: 'default', channel: 'ch2' })).toEqual({ ok: true });
    expect((await api.updatePlant('plant-helecho', { name: 'X' })).ok).toBe(false); // archivada: no se edita
    expect(await api.restorePlant('plant-helecho')).toEqual({ ok: true });
    expect(byName(api, 'Helecho')).toMatchObject({ sensor: null, status: 'no-sensor' });
  });

  it('un nombre vacío o larguísimo se rechaza', async () => {
    const api = fresh();
    expect((await api.createPlant({ name: '  ', sectorId: 'sector-interior' })).ok).toBe(false);
    expect((await api.createPlant({ name: 'x'.repeat(41), sectorId: 'sector-interior' })).ok).toBe(false);
    expect(plants(api)).toHaveLength(4);
  });

  it('con la API caída no se da nada por hecho', async () => {
    const api = fresh();
    api.setFault('api-error');
    expect((await api.createSector({ name: 'Z', thresholdPct: 30, targetPct: 55 })).ok).toBe(false);
    expect((await api.updatePlant('plant-helecho', { auto: false })).ok).toBe(false);
    api.setFault('none');
    expect(api.getSnapshot().sectors).toHaveLength(2);
    expect(byName(api, 'Helecho').auto).toBe(true);
  });

  it('cambiar el umbral del sector de la principal llega al simulador', async () => {
    const api = fresh();
    await api.updateSector('sector-interior', { thresholdPct: 45, targetPct: 70 });
    expect(api.getSnapshot().settings).toMatchObject({ thresholdPct: 45, targetPct: 70 });
  });
});
