import { describe, expect, it } from 'vitest';
import { MockRiego } from './mockRiego';
import { derive } from './derive';

const fresh = () => new MockRiego({ loadMs: 0 });

describe('derive', () => {
  it('con datos al día no marca la lectura como vieja', () => {
    const d = derive(fresh().getSnapshot());
    expect(d.stale).toBe(false);
    expect(d.status).toBe('ok');
    expect(d.lastCycle?.pulses).toBeGreaterThanOrEqual(1);
    expect(d.openCycle).toBeUndefined();
  });

  it('cuenta los riegos de esta semana y compara con la anterior cuando hay datos', () => {
    const d = derive(fresh().getSnapshot());
    expect(d.weekly.count).toBe(2);
    expect(d.weekly.previous).toBe(2);
  });

  it('no inventa la semana anterior si el historial no la cubre', () => {
    const s = fresh().getSnapshot();
    const cut = { ...s, readings: s.readings.filter((r) => r.t > s.now - 8 * 24 * 3_600_000) };
    expect(derive(cut).weekly.previous).toBeNull();
  });

  it('si dejan de llegar lecturas muestra la última conocida y avisa que es vieja', () => {
    const api = fresh();
    const before = derive(api.getSnapshot());
    api.setFault('offline');
    api.advance(3);
    const d = derive(api.getSnapshot());
    expect(d.stale).toBe(true);
    expect(d.reading?.t).toBeGreaterThanOrEqual(before.reading!.t);
    expect(d.status).not.toBe('error');
    expect(d.decision.reason).toBe('stale');
  });

  it('un valor imposible del sensor da estado de error', () => {
    const api = fresh();
    api.setFault('bad-sensor');
    api.advanceToNextReading();
    expect(derive(api.getSnapshot()).status).toBe('error');
  });

  it('el estado de error sale de lo que informa el servidor (device.sensor), no del valor crudo', () => {
    const s = fresh().getSnapshot();
    const last = s.readings[s.readings.length - 1];
    const withRaw = (raw: number) => ({ ...s, readings: [...s.readings.slice(0, -1), { ...last, raw }] });
    // Un valor raro sin que el servidor avise una falla: la pantalla no lo decide por su cuenta.
    expect(derive(withRaw(4095)).status).not.toBe('error');
    expect(derive(withRaw(60)).status).not.toBe('error');
    // Con el aviso del servidor sí.
    const fault = (reason: 'high' | 'low' | 'noise') => ({ ...withRaw(4095), device: { ...s.device, sensor: { ok: false as const, reason } } });
    expect(derive(fault('high')).status).toBe('error');
    expect(derive(fault('low')).status).toBe('error');
    expect(derive(fault('noise')).level).toBeUndefined();
  });

  it('si la placa avisa que su sensor falla, el estado es error y la decisión es bad-sensor (no riega)', () => {
    const api = fresh();
    api.forceMoisture(20); // sin la falla, esta tierra seca pediría riego
    const s = api.getSnapshot();
    expect(derive(s).decision.reason).not.toBe('bad-sensor');
    const withFault = { ...s, device: { ...s.device, sensor: { ok: false as const, reason: 'noise' as const, at: s.now } } };
    const d = derive(withFault);
    expect(d.status).toBe('error');
    expect(d.level).toBeUndefined();
    expect(d.decision).toEqual({ water: false, reason: 'bad-sensor' });
  });

  it('sin lecturas pero con la falla avisada también es error (el sensor está desconectado, no "sin datos")', () => {
    const s = fresh().getSnapshot();
    const d = derive({ ...s, readings: [], device: { ...s.device, sensor: { ok: false, reason: 'low' } } });
    expect(d.status).toBe('error');
    expect(d.decision.reason).toBe('bad-sensor');
  });

  it('con sensor ok no cambia nada', () => {
    const s = fresh().getSnapshot();
    const ok = derive({ ...s, device: { ...s.device, sensor: { ok: true } } });
    expect(ok.decision).toEqual(derive(s).decision);
    expect(ok.status).toBe(derive(s).status);
  });

  it('en pleno riego hay un riego abierto', () => {
    const api = fresh();
    api.advance(12);
    api.forceMoisture(20);
    const d = derive(api.getSnapshot());
    expect(d.openCycle).toBeDefined();
    expect(d.decision.reason).toBe('soaking');
  });
});

describe('derive: modo aviso', () => {
  /** Foto con la última lectura en `pct` %, sin riegos, y el modo del regador indicado. */
  function snap(relay: 'aviso' | 'real' | undefined, pct: number, over: { auto?: boolean } = {}) {
    const s = fresh().getSnapshot();
    const readings = s.readings.map((r, i, all) => (i === all.length - 1 ? { ...r, moisture: pct } : r));
    return {
      ...s,
      readings,
      events: [],
      settings: { ...s.settings, auto: over.auto ?? true },
      device: { ...s.device, ...(relay ? { relay } : {}) },
    };
  }

  it('sin el campo del servidor se asume que hay regador real', () => {
    const d = derive(snap(undefined, 20));
    expect(d.relayMode).toBe('real');
    expect(d.needsWater).toBe(false);
  });

  it('en modo aviso, con la tierra bajo el umbral hay alerta abierta', () => {
    const d = derive(snap('aviso', 20));
    expect(d.relayMode).toBe('aviso');
    expect(d.decision.reason).toBe('water');
    expect(d.needsWater).toBe(true);
  });

  it('con la humedad bien no hay alerta', () => {
    expect(derive(snap('aviso', 60)).needsWater).toBe(false);
  });

  it('con los avisos apagados no hay alerta', () => {
    expect(derive(snap('aviso', 20, { auto: false })).needsWater).toBe(false);
  });

  it('anotar un riego cierra la alerta', () => {
    const s = snap('aviso', 20);
    const noted = { ...s, events: [{ t: s.now - 60_000, seconds: 5, source: 'manual' as const }] };
    expect(derive(noted).needsWater).toBe(false);
  });

  it('con el sensor sin señal no hay alerta (no se sabe)', () => {
    const s = snap('aviso', 20);
    const silent = { ...s, now: s.now + 6 * 3_600_000 };
    expect(derive(silent).needsWater).toBe(false);
  });

  it('con un valor imposible del sensor no hay alerta', () => {
    const s = snap('aviso', 20);
    const readings = s.readings.map((r, i, all) => (i === all.length - 1 ? { ...r, raw: 4095 } : r));
    expect(derive({ ...s, readings }).needsWater).toBe(false);
  });

  it('en modo real nunca hay alerta de aviso', () => {
    expect(derive(snap('real', 20)).needsWater).toBe(false);
  });
});
