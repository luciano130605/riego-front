import { afterEach, describe, expect, it, vi } from 'vitest';
import { automationView } from '@/core/automation';
import { derive } from './derive';
import { MockRiego } from './mockRiego';

const fresh = () => new MockRiego({ loadMs: 0 });
const LOADING = { waterNow: false, nextWatering: false, ruleStatus: false, autoSettings: false, alertThresholds: false, wateringData: false };
// Manual: solo queda el umbral y el objetivo, que también son los de los avisos.
const MANUAL = { ...LOADING, alertThresholds: true };
const VISIBLE = { waterNow: true, nextWatering: true, ruleStatus: true, autoSettings: true, alertThresholds: true, wateringData: true };

afterEach(() => vi.useRealTimers());

describe('modo automático / manual con el simulador', () => {
  it('automático prendido: se ve todo, igual que siempre', () => {
    const s = fresh().getSnapshot();
    expect(s.settings.auto).toBe(true);
    const v = automationView(s);
    expect(v.show).toEqual(VISIBLE);
    expect(v.thresholdLabel(s.settings.thresholdPct)).toBe(`Riega bajo ${s.settings.thresholdPct} %`);
  });

  it('automático apagado: se oculta todo lo de las reglas automáticas y el marcador pasa a ser un aviso', async () => {
    const api = fresh();
    expect(await api.updateSettings({ auto: false })).toEqual({ ok: true });
    const s = api.getSnapshot();
    const v = automationView(s);
    expect(v.autoEnabled).toBe(false);
    expect(v.show).toEqual(MANUAL);
    expect(v.thresholdLabel(35)).toBe('Aviso bajo 35 %');
  });

  it('los valores de las reglas siguen guardados y reaparecen al volver a prender', async () => {
    const api = fresh();
    const custom = { mode: 'fixed' as const, thresholdPct: 42, targetPct: 70, waterSeconds: 12, maxCycleSeconds: 90, minIntervalHours: 9, maxPerDay: 3 };
    await api.updateSettings(custom);
    await api.updateSettings({ auto: false });
    expect(api.getSnapshot().settings).toMatchObject({ ...custom, auto: false });
    await api.updateSettings({ auto: true });
    const s = api.getSnapshot();
    expect(s.settings).toMatchObject({ ...custom, auto: true });
    expect(automationView(s).show).toEqual(VISIBLE);
  });

  it('en manual siguen la humedad, el valor crudo, la última lectura, los riegos y el historial', async () => {
    const api = fresh();
    const before = api.getSnapshot();
    await api.updateSettings({ auto: false });
    const after = api.getSnapshot();
    const d = derive(after);
    expect(d.reading).toBeDefined();
    expect(d.reading!.raw).toBe(before.readings.at(-1)!.raw);
    expect(d.status).toBe(derive(before).status);
    expect(d.lastWater?.t).toBe(derive(before).lastWater?.t);
    // Los riegos pasados del automático se conservan como historial.
    expect(after.events).toHaveLength(before.events.length);
    expect(after.events.some((e) => e.source === 'auto')).toBe(true);
    expect(after.readings).toHaveLength(before.readings.length);
  });

  it('en manual el riego a mano sigue andando', async () => {
    const api = fresh();
    await api.updateSettings({ auto: false });
    const n = api.getSnapshot().events.length;
    expect(await api.waterNow()).toEqual({ ok: true });
    expect(api.getSnapshot().events).toHaveLength(n + 1);
  });

  it('mientras llegan los datos no se muestra nada que dependa del modo, ni automático ni manual', () => {
    vi.useFakeTimers();
    const api = new MockRiego({ loadMs: 600 });
    const loading = automationView(api.getSnapshot());
    expect(loading.loading).toBe(true);
    expect(loading.show).toEqual(LOADING);
    vi.advanceTimersByTime(700);
    const ready = automationView(api.getSnapshot());
    expect(ready.loading).toBe(false);
    expect(ready.show).toEqual(VISIBLE);
  });

  it('el cambio no se da por hecho si la API falla: el estado sigue como estaba', async () => {
    const api = fresh();
    api.setFault('api-error');
    const res = await api.updateSettings({ auto: false });
    expect(res.ok).toBe(false);
    expect(api.getSnapshot().settings.auto).toBe(true);
    expect(automationView(api.getSnapshot()).show).toEqual(VISIBLE);
  });
});

describe('pestaña "Datos de riego"', () => {
  it('existe con el automático prendido y no existe en manual', async () => {
    const api = fresh();
    expect(automationView(api.getSnapshot()).show.wateringData).toBe(true);
    await api.updateSettings({ auto: false });
    expect(automationView(api.getSnapshot()).show.wateringData).toBe(false);
    await api.updateSettings({ auto: true });
    expect(automationView(api.getSnapshot()).show.wateringData).toBe(true);
  });
});
