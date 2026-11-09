import { effectiveLimits, validateChannel, validateLimits, validateName } from '@/core/garden';
import type { DeviceInfo, PlantSensor, PlantView, Sector, WaterEvent } from '@/core/types';
import type { ActionResult, PlantInput, PlantPatch, SectorInput } from './api';

/** La planta que sigue la humedad simulada de verdad; las demás se derivan de ella. */
export const MAIN_PLANT_ID = 'plant-main';
const MIN = 60_000;

const ok = (): ActionResult => ({ ok: true });
const fail = (error: string): ActionResult => ({ ok: false, error });
const newId = (): string => Math.random().toString(16).slice(2, 14).padEnd(12, '0');

/** Una planta del simulador: lo que guarda el servidor más lo que hace falta para derivar su humedad. */
export type GardenPlant = {
  id: string;
  name: string;
  sectorId: string;
  sensor: PlantSensor | null;
  thresholdPct: number | null;
  targetPct: number | null;
  rawDry: number;
  rawWet: number;
  auto: boolean;
  archivedAt?: number;
  /** Cuánto más (o menos) húmeda que la principal está. */
  delta: number;
  /** Lo que subió por riegos a mano desde que arrancó. */
  bump: number;
  /** Riegos propios (los de la principal viven en el simulador). */
  events: WaterEvent[];
};

export type Base = {
  /** Humedad que ve la planta principal; null si no hay lectura. */
  moisture: number | null;
  raw: number | null;
  /** Hora de la última lectura de la placa por defecto. */
  at: number | null;
  /** Si la placa está reportando. */
  online: boolean;
  rssi?: number;
};

type Seed = { rawDry: number; rawWet: number; thresholdPct: number; targetPct: number };

const clamp = (n: number): number => Math.max(0, Math.min(100, Math.round(n)));

/**
 * Los sectores y plantas del simulador, con las mismas reglas que el backend (nombres, rangos, canales repetidos,
 * sectores con plantas) para que la pantalla se pruebe igual contra el simulador que contra el servidor real.
 * Arranca con 2 sectores y 4 plantas, una de ellas sin sensor.
 */
export class MockGarden {
  sectors: Sector[] = [];
  plants: GardenPlant[] = [];
  /** Placas de ejemplo. */
  readonly deviceNames: Record<string, string> = { default: 'Placa del living', 'dev-terraza': 'Placa de la terraza' };

  constructor(seed: Seed) {
    this.reset(seed);
  }

  reset(seed: Seed): void {
    this.sectors = [
      { id: 'sector-interior', name: 'Interior', thresholdPct: seed.thresholdPct, targetPct: seed.targetPct },
      { id: 'sector-terraza', name: 'Terraza', thresholdPct: 30, targetPct: 60 },
    ];
    const base = { rawDry: seed.rawDry, rawWet: seed.rawWet, bump: 0, events: [] as WaterEvent[], thresholdPct: null, targetPct: null };
    this.plants = [
      { ...base, id: MAIN_PLANT_ID, name: 'Monstera', sectorId: 'sector-interior', sensor: { deviceId: 'default', channel: 'main' }, auto: true, delta: 0, events: [] },
      { ...base, id: 'plant-helecho', name: 'Helecho', sectorId: 'sector-interior', sensor: { deviceId: 'default', channel: 'ch2' }, auto: true, delta: -18, events: [] },
      { ...base, id: 'plant-potus', name: 'Potus', sectorId: 'sector-interior', sensor: null, auto: false, delta: 0, events: [] },
      { ...base, id: 'plant-tomates', name: 'Tomates', sectorId: 'sector-terraza', sensor: { deviceId: 'dev-terraza', channel: 'main' }, thresholdPct: 40, auto: true, delta: 6, events: [] },
    ];
  }

  find(id: string): GardenPlant | undefined {
    return this.plants.find((p) => p.id === id);
  }

  sectorOf(p: GardenPlant): Sector {
    return this.sectors.find((s) => s.id === p.sectorId) ?? this.sectors[0];
  }

  effective(p: GardenPlant): { thresholdPct: number; targetPct: number } {
    return effectiveLimits(p, this.sectorOf(p));
  }

  /** Cantidad de plantas (activas y archivadas) de un sector. */
  private plantsIn(sectorId: string): number {
    return this.plants.filter((p) => p.sectorId === sectorId).length;
  }

  // --- Sectores ---------------------------------------------------------------------------------------------------

  private sectorError(name: string, thresholdPct: number, targetPct: number, exceptId?: string): string | undefined {
    const bad = validateName(name) ?? validateLimits(thresholdPct, targetPct);
    if (bad) return bad;
    const dup = this.sectors.some((s) => s.id !== exceptId && s.name.toLowerCase() === name.trim().toLowerCase());
    return dup ? 'Ya hay un sector con ese nombre.' : undefined;
  }

  createSector(input: SectorInput): ActionResult {
    const bad = this.sectorError(input.name, input.thresholdPct, input.targetPct);
    if (bad) return fail(bad);
    this.sectors.push({ id: newId(), name: input.name.trim(), thresholdPct: input.thresholdPct, targetPct: input.targetPct });
    return ok();
  }

  updateSector(id: string, patch: Partial<SectorInput>): ActionResult {
    const s = this.sectors.find((x) => x.id === id);
    if (!s) return fail('No existe ese sector.');
    const next = { name: patch.name ?? s.name, thresholdPct: patch.thresholdPct ?? s.thresholdPct, targetPct: patch.targetPct ?? s.targetPct };
    const bad = this.sectorError(next.name, next.thresholdPct, next.targetPct, id);
    if (bad) return fail(bad);
    Object.assign(s, { ...next, name: next.name.trim() });
    return ok();
  }

  deleteSector(id: string): ActionResult {
    if (!this.sectors.some((s) => s.id === id)) return fail('No existe ese sector.');
    if (this.plantsIn(id) > 0) return fail('El sector tiene plantas: archivalas o movelas primero.');
    this.sectors = this.sectors.filter((s) => s.id !== id);
    return ok();
  }

  // --- Plantas ----------------------------------------------------------------------------------------------------

  private sensorError(sensor: PlantSensor, exceptId?: string): { error: string } | undefined {
    if (!(sensor.deviceId in this.deviceNames)) return { error: 'No existe esa placa.' };
    const bad = validateChannel(sensor.channel);
    if (bad) return { error: bad };
    const used = this.plants.some(
      (p) => p.id !== exceptId && p.archivedAt === undefined && p.sensor?.deviceId === sensor.deviceId && p.sensor.channel === sensor.channel,
    );
    return used ? { error: 'Ese canal ya lo usa otra planta.' } : undefined;
  }

  createPlant(input: PlantInput, seed: Pick<Seed, 'rawDry' | 'rawWet'>): ActionResult {
    const badName = validateName(input.name);
    if (badName) return fail(badName);
    const sector = this.sectors.find((s) => s.id === input.sectorId);
    if (!sector) return fail('No existe ese sector.');
    const eff = effectiveLimits({ thresholdPct: input.thresholdPct, targetPct: input.targetPct }, sector);
    const badLimits = validateLimits(eff.thresholdPct, eff.targetPct);
    if (badLimits) return fail(badLimits);
    if (input.sensor) {
      const e = this.sensorError(input.sensor);
      if (e) return fail(e.error);
    }
    this.plants.push({
      id: newId(),
      name: input.name.trim(),
      sectorId: sector.id,
      sensor: input.sensor ?? null,
      thresholdPct: input.thresholdPct ?? null,
      targetPct: input.targetPct ?? null,
      rawDry: seed.rawDry,
      rawWet: seed.rawWet,
      auto: input.auto ?? true,
      delta: (this.plants.length * 7) % 21 - 8,
      bump: 0,
      events: [],
    });
    return ok();
  }

  /** La planta si existe y no está archivada; si no, el error que daría el servidor. */
  private editable(id: string): GardenPlant | { error: string } {
    const p = this.find(id);
    if (!p) return { error: 'No existe esa planta.' };
    if (p.archivedAt !== undefined) return { error: 'La planta está archivada: restauráila antes.' };
    return p;
  }

  updatePlant(id: string, patch: PlantPatch): ActionResult {
    const p = this.editable(id);
    if ('error' in p) return fail(p.error);
    if (patch.name !== undefined) {
      const bad = validateName(patch.name);
      if (bad) return fail(bad);
    }
    const sectorId = patch.sectorId ?? p.sectorId;
    const sector = this.sectors.find((s) => s.id === sectorId);
    if (!sector) return fail('No existe ese sector.');
    const thresholdPct = patch.thresholdPct !== undefined ? patch.thresholdPct : p.thresholdPct;
    const targetPct = patch.targetPct !== undefined ? patch.targetPct : p.targetPct;
    const eff = effectiveLimits({ thresholdPct, targetPct }, sector);
    const bad = validateLimits(eff.thresholdPct, eff.targetPct);
    if (bad) return fail(bad);
    p.name = patch.name !== undefined ? patch.name.trim() : p.name;
    p.sectorId = sectorId;
    p.thresholdPct = thresholdPct ?? null;
    p.targetPct = targetPct ?? null;
    if (patch.auto !== undefined) p.auto = patch.auto;
    return ok();
  }

  setSensor(id: string, sensor: PlantSensor | null): ActionResult {
    const p = this.editable(id);
    if ('error' in p) return fail(p.error);
    if (sensor) {
      const e = this.sensorError(sensor, id);
      if (e) return fail(e.error);
    }
    p.sensor = sensor; // quitarlo deja la calibración guardada
    return ok();
  }

  /** Archivar conserva todo y libera el canal. */
  archive(id: string, now: number): ActionResult {
    const p = this.find(id);
    if (!p) return fail('No existe esa planta.');
    p.archivedAt = now;
    p.sensor = null;
    return ok();
  }

  restore(id: string): ActionResult {
    const p = this.find(id);
    if (!p) return fail('No existe esa planta.');
    p.archivedAt = undefined;
    return ok();
  }

  /** Riega (o anota) una planta que no es la principal: queda un evento suyo y sube un poco su humedad. */
  water(id: string, now: number, seconds: number): ActionResult {
    const p = this.editable(id);
    if ('error' in p) return fail(p.error);
    const last = p.events[p.events.length - 1];
    if (last && now - last.t < last.seconds * 1000) return fail('La bomba ya está regando.');
    p.events.push({ t: now, seconds, source: 'manual', plantId: p.id });
    p.bump = Math.min(40, p.bump + 12);
    return ok();
  }

  // --- Lo que ve la pantalla --------------------------------------------------------------------------------------

  /** Humedad de una planta a partir de la de la principal. */
  moistureOf(p: GardenPlant, base: Base): number | null {
    if (!p.sensor || base.moisture === null) return null;
    return p.id === MAIN_PLANT_ID ? clamp(base.moisture) : clamp(base.moisture + p.delta + p.bump);
  }

  views(base: Base): PlantView[] {
    return this.plants
      .filter((p) => p.archivedAt === undefined)
      .map((p): PlantView => {
        const sector = this.sectorOf(p);
        const eff = this.effective(p);
        const reporting = base.online && base.at !== null;
        const moisture = reporting ? this.moistureOf(p, base) : null;
        const status: PlantView['status'] = !p.sensor ? 'no-sensor' : moisture === null ? 'no-data' : moisture < eff.thresholdPct ? 'needs-water' : 'ok';
        // La placa de la terraza reporta unos minutos antes.
        const lagMin = p.sensor?.deviceId === 'dev-terraza' ? 3 : 0;
        return {
          id: p.id,
          name: p.name,
          sectorId: p.sectorId,
          sensor: p.sensor,
          thresholdPct: p.thresholdPct,
          targetPct: p.targetPct,
          rawDry: p.rawDry,
          rawWet: p.rawWet,
          auto: p.auto,
          outputId: null,
          sectorName: sector.name,
          effectiveThresholdPct: eff.thresholdPct,
          effectiveTargetPct: eff.targetPct,
          moisture,
          lastRaw: moisture === null ? null : base.raw,
          lastReadingAt: moisture === null || base.at === null ? null : base.at - lagMin * MIN,
          status,
        };
      });
  }

  devices(base: Base): DeviceInfo[] {
    return Object.entries(this.deviceNames).map(([id, name]) => ({
      id,
      name,
      isDefault: id === 'default',
      online: base.online,
      lastSeen: base.at === null ? 0 : base.at - (id === 'default' ? 0 : 3 * MIN),
      rssi: id === 'default' ? base.rssi : -61,
      fw: '1.0.0 (demo)',
    }));
  }
}
