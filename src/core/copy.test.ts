import { describe, expect, it } from 'vitest';
import { automationState, modeDescription, nextWateringCopy } from './copy';
import type { Decision } from './decide';
import type { Forecast } from './forecast';
import type { Settings } from './types';

const NOW = new Date(2026, 10, 5, 12, 0).getTime();
const settings: Settings = {
  auto: true,
  mode: 'until-target',
  thresholdPct: 35,
  targetPct: 55,
  waterSeconds: 5,
  maxCycleSeconds: 30,
  minIntervalHours: 6,
  maxPerDay: null,
  rawDry: 3100,
  rawWet: 1350,
};
const stable: Forecast = { kind: 'stable' };

const copy = (decision: Decision, forecast: Forecast = stable, s: Settings = settings) =>
  nextWateringCopy({ decision, forecast, openCycle: undefined, settings: s, now: NOW });

describe('nextWateringCopy', () => {
  it('muestra la condición cuando todavía no hace falta regar', () => {
    const c = copy({ water: false, reason: 'not-needed' });
    expect(c.headline).toBe('Cuando la humedad baje de 35 %');
    expect(c.detail).toBe('Por ahora no se está secando.');
  });

  it('estima cuándo según el ritmo de secado', () => {
    const c = copy({ water: false, reason: 'not-needed' }, { kind: 'in', hours: 30, ratePerHour: 0.5 });
    expect(c.detail).toMatch(/^Según el ritmo actual, /);
  });

  it('en pleno riego explica la pausa y cuánto falta', () => {
    const c = copy({ water: false, reason: 'soaking', waitHours: 0.5 });
    expect(c.headline).toBe('Riego en curso');
    expect(c.detail).toContain('30 min');
  });

  it('dice hasta dónde sigue cuando va a regar', () => {
    expect(copy({ water: true, reason: 'water' }).detail).toBe('Sigue hasta llegar a 55 %.');
    expect(copy({ water: true, reason: 'water' }, stable, { ...settings, mode: 'fixed' }).detail).toBe('Riega 5 s.');
  });

  it('avisa cuando el tope de seguridad cortó el riego', () => {
    const c = copy({ water: false, reason: 'cycle-limit' });
    expect(c.headline).toBe('Riego cortado por seguridad');
    expect(c.detail).toContain('30 s');
  });

  it('con el automático apagado lo dice sin hablar de condiciones', () => {
    expect(copy({ water: false, reason: 'auto-off' }).headline).toBe('Automático apagado');
  });

  it('en pausa por datos dudosos explica el motivo', () => {
    expect(copy({ water: false, reason: 'stale' }).headline).toBe('En pausa');
    expect(copy({ water: false, reason: 'bad-sensor' }).detail).toContain('lectura confiable');
  });
});

describe('automationState y modeDescription', () => {
  it('resume el estado de la automatización', () => {
    expect(automationState({ water: false, reason: 'not-needed' }, true).label).toBe('En espera');
    expect(automationState({ water: false, reason: 'soaking' }, true)).toEqual({ label: 'Regando', active: true });
    expect(automationState({ water: false, reason: 'stale' }, true).label).toBe('En pausa');
    expect(automationState({ water: false, reason: 'not-needed' }, false).label).toBe('Apagada');
  });

  it('describe el modo según los ajustes', () => {
    expect(modeDescription(settings)).toBe('Riega hasta llegar a 55 %');
    expect(modeDescription({ ...settings, mode: 'fixed' })).toBe('Riega 5 s cuando la humedad baja');
    expect(modeDescription({ ...settings, auto: false })).toBe('El riego es manual');
  });
});
