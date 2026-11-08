import { describe, expect, it } from 'vitest';
import { cycleGapMs, groupCycles, openCycle, soakRemainingMs } from './cycles';
import type { WaterEvent } from './types';

const MIN = 60_000;
const NOW = 1_800_000_000_000;

const ev = (minAgo: number, source: WaterEvent['source'] = 'auto', seconds = 5): WaterEvent => ({
  t: NOW - minAgo * MIN,
  seconds,
  source,
});

describe('groupCycles', () => {
  it('junta las tandas automáticas que vienen una tras otra', () => {
    const cycles = groupCycles([ev(300), ev(255), ev(210)], 15);
    expect(cycles).toHaveLength(1);
    expect(cycles[0]).toMatchObject({ pulses: 3, seconds: 15, source: 'auto' });
    expect(cycles[0].start).toBe(NOW - 300 * MIN);
    expect(cycles[0].last).toBe(NOW - 210 * MIN);
  });

  it('separa los riegos cuando pasó mucho tiempo entre tandas', () => {
    const gapMin = cycleGapMs(15) / MIN;
    const cycles = groupCycles([ev(1000), ev(1000 - gapMin - 1)], 15);
    expect(cycles).toHaveLength(2);
  });

  it('el riego a mano siempre es un riego aparte', () => {
    const cycles = groupCycles([ev(100), ev(90, 'manual'), ev(50)], 15);
    expect(cycles.map((c) => c.source)).toEqual(['auto', 'manual', 'auto']);
  });

  it('con riegos de tiempo fijo (separados por horas) cada evento es un riego', () => {
    expect(groupCycles([ev(6 * 60), ev(3 * 60)], 15)).toHaveLength(2);
  });

  it('no depende del orden en que vienen los eventos', () => {
    const cycles = groupCycles([ev(50), ev(95), ev(140)], 15);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].pulses).toBe(3);
  });
});

describe('openCycle', () => {
  it('hay un riego en curso mientras no pasó la ventana desde la última tanda', () => {
    const cycles = groupCycles([ev(50)], 15);
    expect(openCycle(cycles, NOW, 'until-target', 15)).toBeDefined();
    const late = groupCycles([ev(120)], 15);
    expect(openCycle(late, NOW, 'until-target', 15)).toBeUndefined();
  });

  it('solo existe en modo hasta el objetivo y para riegos automáticos', () => {
    const cycles = groupCycles([ev(20)], 15);
    expect(openCycle(cycles, NOW, 'fixed', 15)).toBeUndefined();
    const manual = groupCycles([ev(20, 'manual')], 15);
    expect(openCycle(manual, NOW, 'until-target', 15)).toBeUndefined();
  });
});

describe('soakRemainingMs', () => {
  it('cuenta la pausa con un par de minutos de tolerancia y nunca da negativo', () => {
    expect(soakRemainingMs(NOW - 15 * MIN, NOW)).toBe(28 * MIN);
    expect(soakRemainingMs(NOW - 45 * MIN, NOW)).toBe(0);
    expect(soakRemainingMs(NOW - 400 * MIN, NOW)).toBe(0);
  });
});
