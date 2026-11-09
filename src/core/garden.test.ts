import { describe, expect, it } from 'vitest';
import { effectiveLimits, validateChannel, validateLimits, validateName } from './garden';

describe('validateLimits', () => {
  it('acepta un rango válido', () => {
    expect(validateLimits(35, 55)).toBeUndefined();
    expect(validateLimits(10, 20)).toBeUndefined();
    expect(validateLimits(70, 95)).toBeUndefined();
  });
  it('el umbral va de 10 a 70 y el objetivo de 20 a 95', () => {
    expect(validateLimits(9, 55)).toBe('El umbral tiene que estar entre 10 y 70 %.');
    expect(validateLimits(71, 95)).toBe('El umbral tiene que estar entre 10 y 70 %.');
    expect(validateLimits(35, 19)).toBe('El objetivo tiene que estar entre 20 y 95 %.');
    expect(validateLimits(35, 96)).toBe('El objetivo tiene que estar entre 20 y 95 %.');
  });
  it('el objetivo debe superar al umbral por 5 o más (se rechaza, no se corrige)', () => {
    expect(validateLimits(40, 44)).toBe('El objetivo tiene que ser al menos 5 puntos mayor que el umbral.');
    expect(validateLimits(40, 45)).toBeUndefined();
  });
  it('un valor que no es número se rechaza', () => {
    expect(validateLimits(Number.NaN, 55)).toBeDefined();
  });
});

describe('validateName y validateChannel', () => {
  it('el nombre no puede estar vacío ni pasar de 40', () => {
    expect(validateName('  ')).toBe('Escribí un nombre.');
    expect(validateName('x'.repeat(41))).toBe('El nombre puede tener hasta 40 caracteres.');
    expect(validateName('Monstera')).toBeUndefined();
    expect(validateName('x'.repeat(40))).toBeUndefined();
  });
  it('el canal: 1 a 16 caracteres [a-zA-Z0-9_-]', () => {
    expect(validateChannel('main')).toBeUndefined();
    expect(validateChannel('ch-2_a')).toBeUndefined();
    for (const bad of ['', 'x'.repeat(17), 'con espacio', 'ñ', 'a/b']) expect(validateChannel(bad)).toBeDefined();
  });
});

describe('effectiveLimits', () => {
  const sector = { thresholdPct: 35, targetPct: 55 };
  it('hereda del sector lo que no tiene propio', () => {
    expect(effectiveLimits({ thresholdPct: null, targetPct: null }, sector)).toEqual({ thresholdPct: 35, targetPct: 55 });
    expect(effectiveLimits({}, sector)).toEqual({ thresholdPct: 35, targetPct: 55 });
  });
  it('usa el propio cuando lo tiene (cada uno por separado)', () => {
    expect(effectiveLimits({ thresholdPct: 40 }, sector)).toEqual({ thresholdPct: 40, targetPct: 55 });
    expect(effectiveLimits({ targetPct: 70 }, sector)).toEqual({ thresholdPct: 35, targetPct: 70 });
  });
});
