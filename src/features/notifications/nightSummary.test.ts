import { describe, expect, it } from 'vitest';
import { minutesLabel, nightSummaryLines } from './nightSummary';

describe('nightSummaryLines', () => {
  it('un resumen completo se lee en pocas líneas', () => {
    expect(
      nightSummaryLines({
        moistureStart: 48,
        moistureEnd: 41,
        moistureMin: 40,
        wateringAlerts: 2,
        wateringsAuto: 1,
        wateringsManual: 1,
        offlineMin: 75,
        sensorIssues: 1,
      }),
    ).toEqual([
      'La humedad pasó de 48 % a 41 % (mínima 40 %).',
      'Hubo 2 avisos de riego.',
      'Hubo 2 riegos: 1 automático y 1 manual.',
      'La placa estuvo sin conexión 1 h 15 min.',
      'Hubo 1 problema del sensor.',
    ]);
  });

  it('una noche tranquila: lo que vale cero no ocupa lugar', () => {
    expect(
      nightSummaryLines({ moistureStart: 52, moistureEnd: 50, moistureMin: 50, wateringAlerts: 0, wateringsAuto: 0, wateringsManual: 0, offlineMin: 0, sensorIssues: 0 }),
    ).toEqual(['La humedad pasó de 52 % a 50 % (mínima 50 %).', 'No hubo avisos de riego.', 'No hubo riegos.']);
  });

  it('singular y plural', () => {
    expect(nightSummaryLines({ wateringAlerts: 1 })).toEqual(['Hubo 1 aviso de riego.']);
    expect(nightSummaryLines({ wateringsAuto: 3, wateringsManual: 0 })).toEqual(['Hubo 3 riegos: 3 automáticos.']);
    expect(nightSummaryLines({ wateringsAuto: 0, wateringsManual: 1 })).toEqual(['Hubo 1 riego: 1 manual.']);
  });

  it('lo que el servidor no manda no se muestra', () => {
    expect(nightSummaryLines({ moistureMin: 33 })).toEqual(['La humedad mínima fue 33 %.']);
    expect(nightSummaryLines({ moistureEnd: 60 })).toEqual(['La humedad terminó en 60 %.']);
  });

  it('sin ningún dato: una línea neutra', () => {
    expect(nightSummaryLines({})).toEqual(['Sin novedades durante la noche.']);
  });
});

describe('minutesLabel', () => {
  it('minutos y horas', () => {
    expect(minutesLabel(40)).toBe('40 min');
    expect(minutesLabel(60)).toBe('1 h');
    expect(minutesLabel(125)).toBe('2 h 5 min');
  });
});
