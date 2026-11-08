import { describe, expect, it } from 'vitest';
import {
  captureValue,
  lastSamples,
  median,
  previewPercent,
  stability,
  STABLE_RANGE,
  validateCalibration,
} from './calibration';

const mk = (raws: number[]): number[] => raws;

describe('median', () => {
  it('toma el del medio, y el promedio de los dos del medio si es par', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
  });
  it('no se deja engañar por un valor suelto y no modifica la lista', () => {
    const xs = [3100, 3098, 3102, 900, 3101];
    expect(median(xs)).toBe(3100);
    expect(xs).toEqual([3100, 3098, 3102, 900, 3101]);
  });
  it('lista vacía = null', () => expect(median([])).toBeNull());
});

describe('lastSamples', () => {
  it('se queda con las últimas (la más nueva al final) y descarta datos corruptos', () => {
    expect(lastSamples([1, 2, 3, 4], 2)).toEqual([3, 4]);
    expect(lastSamples([1, Number.NaN, 3], 5)).toEqual([1, 3]);
    expect(lastSamples([], 3)).toEqual([]);
  });
});

describe('stability', () => {
  it('con menos de 10 lecturas todavía no se puede saber', () => {
    expect(stability(mk([3000, 3001, 3000]))).toMatchObject({ stable: false, range: null, have: 3, need: 10 });
    expect(stability([])).toMatchObject({ stable: false, have: 0 });
  });
  it('estable si entre la mayor y la menor de las últimas 10 hay menos de 80 cuentas', () => {
    const calm = mk([3000, 3010, 3020, 3005, 3015, 3000, 3030, 3025, 3010, 3008]);
    expect(stability(calm)).toMatchObject({ stable: true, range: 30 });
  });
  it('el límite es estricto: 80 justo ya no es estable, 79 sí', () => {
    const at = (spread: number) => mk([3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000, 3000 + spread]);
    expect(stability(at(STABLE_RANGE)).stable).toBe(false);
    expect(stability(at(STABLE_RANGE - 1)).stable).toBe(true);
  });
  it('solo mira las últimas 10: un movimiento viejo no cuenta', () => {
    const moving = [1000, 2500, 1800, 2900];
    const calm = [3050, 3052, 3049, 3051, 3050, 3048, 3053, 3050, 3051, 3049];
    expect(stability(mk([...moving, ...calm])).stable).toBe(true);
  });
  it('un salto dentro de la ventana lo vuelve inestable', () => {
    expect(stability(mk([3000, 3001, 3000, 2999, 3000, 2500, 3000, 3001, 3000, 3000])).stable).toBe(false);
  });
});

describe('captureValue', () => {
  it('es la mediana de las últimas 10 lecturas, redondeada', () => {
    const s = mk([3098, 3100, 3101, 3099, 3100, 3102, 3100, 3099, 3101, 3100, 3100]);
    expect(captureValue(s)).toBe(3100);
    expect(captureValue(mk([3000, 3001, 3002, 3003, 3004, 3005, 3006, 3007, 3008, 3009]))).toBe(3005); // 3004,5
  });
  it('no toma nada si no está estable o faltan lecturas', () => {
    expect(captureValue(mk([3000, 2000, 3000, 2000, 3000, 2000, 3000, 2000, 3000, 2000]))).toBeNull();
    expect(captureValue(mk([3000, 3000]))).toBeNull();
  });
});

describe('validateCalibration', () => {
  it('acepta seco mayor que mojado con al menos 300 cuentas de diferencia', () => {
    expect(validateCalibration(3100, 1350)).toEqual({ ok: true });
    expect(validateCalibration(1650, 1350)).toEqual({ ok: true }); // justo 300
  });
  it('rechaza si el sensor casi no cambia', () => {
    const r = validateCalibration(1649, 1350);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.error).toContain('casi no cambia');
  });
  it('rechaza seco menor o igual que mojado (pasos al revés)', () => {
    expect(validateCalibration(1350, 3100).ok).toBe(false);
    const eq = validateCalibration(2000, 2000);
    expect(eq.ok === false && eq.error).toContain('mayor que el mojado');
  });
  it('rechaza valores imposibles (cable suelto o corto)', () => {
    expect(validateCalibration(4095, 1350).ok).toBe(true); // el aire satura: como seco es válido
    expect(validateCalibration(4000, 4095).ok).toBe(false);
    expect(validateCalibration(3100, 0).ok).toBe(false);
  });
});

describe('previewPercent', () => {
  it('convierte el valor crudo con la calibración nueva', () => {
    expect(previewPercent(3100, 3100, 1350)).toBe(0);
    expect(previewPercent(1350, 3100, 1350)).toBe(100);
    expect(previewPercent(2225, 3100, 1350)).toBeCloseTo(50);
    expect(previewPercent(4000, 3100, 1350)).toBe(0); // se recorta
  });
});
