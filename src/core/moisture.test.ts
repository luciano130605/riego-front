import { describe, expect, it } from 'vitest';
import { isSaneRaw, isSensorConnected, levelOf, rawToPercent } from './moisture';

describe('rawToPercent', () => {
  it('interpola entre seco y mojado', () => {
    expect(rawToPercent(3100, 3100, 1350)).toBe(0);
    expect(rawToPercent(1350, 3100, 1350)).toBe(100);
    expect(rawToPercent(2225, 3100, 1350)).toBeCloseTo(50, 5);
  });

  it('funciona también si el sensor sube al mojarse', () => {
    expect(rawToPercent(2000, 1000, 3000)).toBeCloseTo(50, 5);
  });

  it('no se pasa de 0 ni de 100', () => {
    expect(rawToPercent(4000, 3100, 1350)).toBe(0);
    expect(rawToPercent(500, 3100, 1350)).toBe(100);
  });

  it('con dos puntos iguales no divide por cero', () => {
    expect(rawToPercent(2000, 2000, 2000)).toBe(0);
  });
});

describe('isSaneRaw', () => {
  it('descarta los extremos del conversor, que indican cable suelto o corto', () => {
    expect(isSaneRaw(0)).toBe(false);
    expect(isSaneRaw(4095)).toBe(false);
    expect(isSaneRaw(NaN)).toBe(false);
    expect(isSaneRaw(2200)).toBe(true);
  });
});

describe('isSensorConnected', () => {
  it('lo que no puede ser tierra se toma como sensor desconectado (mismo criterio que el aviso del servidor)', () => {
    for (const raw of [0, 1, 40, 99, 4001, 4055, 4095, NaN, Infinity]) expect(isSensorConnected(raw), String(raw)).toBe(false);
    for (const raw of [100, 1350, 2200, 3100, 4000]) expect(isSensorConnected(raw), String(raw)).toBe(true);
  });

  it('es más estricto que isSaneRaw, que sigue decidiendo si el riego automático confía en el dato', () => {
    expect(isSaneRaw(60)).toBe(true);
    expect(isSensorConnected(60)).toBe(false);
  });
});

describe('levelOf', () => {
  it('separa seca, bien y muy húmeda', () => {
    expect(levelOf(30, 35)).toBe('dry');
    expect(levelOf(35, 35)).toBe('ok');
    expect(levelOf(79.9, 35)).toBe('ok');
    expect(levelOf(80, 35)).toBe('wet');
  });
});
