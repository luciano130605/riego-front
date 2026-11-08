import { describe, expect, it } from 'vitest';
import { formatAgo, formatDuration, formatSeconds } from './format';

const MIN = 60_000;
const H = 3_600_000;

describe('formatDuration', () => {
  it('elige la unidad según el tamaño', () => {
    expect(formatDuration(0.75)).toBe('45 min');
    expect(formatDuration(2)).toBe('2 h');
    expect(formatDuration(2 + 10 / 60)).toBe('2 h 10 min');
    expect(formatDuration(27)).toBe('1 d 3 h');
    expect(formatDuration(48)).toBe('2 d');
  });
});

describe('formatAgo', () => {
  it('describe hace cuánto pasó algo', () => {
    expect(formatAgo(20_000)).toBe('recién');
    expect(formatAgo(6 * MIN)).toBe('hace 6 min');
    expect(formatAgo(40 * H)).toBe('hace 1 d 16 h');
  });
});

describe('rssiQuality y longDateTime', () => {
  it('clasifica la señal wifi', async () => {
    const { rssiQuality } = await import('./format');
    expect(rssiQuality(-51)).toBe('excelente');
    expect(rssiQuality(-62)).toBe('buena');
    expect(rssiQuality(-72)).toBe('regular');
    expect(rssiQuality(-85)).toBe('débil');
  });

  it('escribe fecha y hora en español', async () => {
    const { longDateTime } = await import('./format');
    expect(longDateTime(new Date(2026, 10, 5, 15, 41).getTime())).toBe('jue, 5 de noviembre, 15:41');
  });
});

describe('formatSeconds', () => {
  it('usa segundos hasta el minuto y minutos desde ahí', () => {
    expect(formatSeconds(0)).toBe('0 s');
    expect(formatSeconds(30)).toBe('30 s');
    expect(formatSeconds(59)).toBe('59 s');
    expect(formatSeconds(60)).toBe('1 min');
    expect(formatSeconds(90)).toBe('1 min 30 s');
    expect(formatSeconds(300)).toBe('5 min');
  });
});
