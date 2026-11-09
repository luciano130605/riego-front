import { describe, expect, it } from 'vitest';
import { FALLBACK_TEST_NAME, testDeviceName, testHint, testResultText } from './deviceTestCopy';

describe('deviceTestCopy', () => {
  it('usa el nombre de Smart Life; si no trae, "Enchufe TV Lucho"', () => {
    expect(testDeviceName('Tapa Enchufe Lucho Escritorio')).toBe('Tapa Enchufe Lucho Escritorio');
    expect(testDeviceName(undefined, 'Enchufe Arriba Terraza')).toBe('Enchufe Arriba Terraza');
    expect(testDeviceName('  ', undefined)).toBe(FALLBACK_TEST_NAME);
    expect(FALLBACK_TEST_NAME).toBe('Enchufe TV Lucho');
  });

  it('antes de probar dice qué hace, con el nombre', () => {
    expect(testHint('Tapa Enchufe Lucho Escritorio')).toBe(
      'Si la toma 1 de “Tapa Enchufe Lucho Escritorio” está apagada la prende, y si está prendida la apaga.',
    );
    expect(testHint()).toContain('Enchufe TV Lucho');
  });

  it('si estaba apagada: se prendió (y queda prendida)', () => {
    expect(testResultText('x', { action: 'toggle', code: 'switch_1', before: false, deviceName: 'Lámpara' })).toBe(
      'Se prendió la toma 1 de “Lámpara”.',
    );
  });

  it('si estaba prendida: se apagó (y queda apagada)', () => {
    expect(testResultText('x', { action: 'toggle', code: 'switch_1', before: true })).toBe(
      'Se apagó la toma 1 de “Enchufe TV Lucho”.',
    );
  });

  it('otra función o toma', () => {
    expect(testResultText('x', { action: 'toggle', code: 'switch_2', before: false })).toContain('toma 2');
    expect(testResultText('x', { action: 'toggle', code: 'basic_indicator', before: false })).toContain('función basic_indicator');
  });

  it('sirena: sonó', () => {
    expect(testResultText('x', { action: 'ring', deviceName: 'Sirena' })).toBe('Sonó “Sirena”.');
  });

  it('sin detalle o solo conexión: el mensaje del servidor tal cual', () => {
    expect(testResultText('Prueba enviada.', undefined)).toBe('Prueba enviada.');
    expect(testResultText('Conexión verificada.', { action: 'status-only' })).toBe('Conexión verificada.');
  });
});
