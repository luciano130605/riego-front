import { describe, expect, it } from 'vitest';
import { automationView } from './automation';
import { DEFAULT_SETTINGS } from './settings';
import type { Snapshot } from './types';

const snap = (load: Snapshot['load'], auto: boolean): Pick<Snapshot, 'load' | 'settings'> => ({
  load,
  settings: { ...DEFAULT_SETTINGS, auto },
});

describe('automationView', () => {
  it('con el automático prendido se ve todo lo de las reglas automáticas, como siempre', () => {
    const v = automationView(snap('ready', true));
    expect(v.autoEnabled).toBe(true);
    expect(v.show).toEqual({ waterNow: true, nextWatering: true, ruleStatus: true, autoSettings: true, alertThresholds: true, wateringData: true });
    expect(v.thresholdLabel(35)).toBe('Riega bajo 35 %');
    expect(v.subtitle).toBe('Monitoreo y riego automático');
  });

  it('con el automático apagado desaparece todo lo de las reglas automáticas', () => {
    const v = automationView(snap('ready', false));
    expect(v.autoEnabled).toBe(false);
    expect(v.show).toEqual({ waterNow: false, nextWatering: false, ruleStatus: false, autoSettings: false, alertThresholds: true, wateringData: false });
  });

  it('en manual el umbral y el objetivo siguen visibles: también son los de los avisos al celular', () => {
    expect(automationView(snap('ready', false)).show.alertThresholds).toBe(true);
    expect(automationView(snap('ready', true)).show.alertThresholds).toBe(true);
  });

  it('en manual el marcador de umbral queda, pero como aviso y no como riego', () => {
    const v = automationView(snap('ready', false));
    expect(v.thresholdLabel(35)).toBe('Aviso bajo 35 %');
    expect(v.subtitle).toBe('Monitoreo y riego manual');
  });

  it('mientras carga no muestra nada que dependa del modo, sea cual sea el valor provisorio', () => {
    for (const auto of [true, false]) {
      const v = automationView(snap('loading', auto));
      expect(v.loading).toBe(true);
      expect(v.autoEnabled).toBe(false);
      expect(Object.values(v.show).every((x) => x === false)).toBe(true);
      expect(v.subtitle).toBe('Monitoreo y riego');
    }
  });
});
