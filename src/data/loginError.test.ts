import { describe, expect, it } from 'vitest';
import { loginErrorText, retryMinutes } from './loginError';

describe('loginErrorText', () => {
  it('401: PIN incorrecto', () => expect(loginErrorText(401, null)).toBe('PIN incorrecto.'));
  it('429: minutos redondeados hacia arriba, según Retry-After', () => {
    expect(loginErrorText(429, '60')).toBe('Demasiados intentos, probá en 1 minuto.');
    expect(loginErrorText(429, '61')).toBe('Demasiados intentos, probá en 2 minutos.');
    expect(loginErrorText(429, '600')).toBe('Demasiados intentos, probá en 10 minutos.');
  });
  it('429 sin Retry-After usable: 1 minuto', () => {
    expect(retryMinutes(null)).toBe(1);
    expect(retryMinutes('abc')).toBe(1);
    expect(retryMinutes('0')).toBe(1);
  });
  it('Retry-After como fecha HTTP', () => {
    const now = Date.parse('2026-11-08T10:00:00Z');
    expect(retryMinutes('Sun, 08 Nov 2026 10:05:00 GMT', now)).toBe(5);
  });
  it('otro error: usa el mensaje del servidor o el estado', () => {
    expect(loginErrorText(500, null, 'Falló.')).toBe('Falló.');
    expect(loginErrorText(503, null)).toBe('El servidor respondió 503.');
  });
});
