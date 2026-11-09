import { describe, expect, it } from 'vitest';
import { DEFAULT_QUIET, quietHoursOf, quietHoursToSave, validateQuietHours, windowLabel } from './quietHours';
import { sanitizeSettings, DEFAULT_SETTINGS } from './settings';

describe('quietHoursOf', () => {
  it('si el servidor no lo manda: apagado, de 23:00 a 07:00', () => {
    expect(quietHoursOf({})).toMatchObject({ enabled: false, from: '23:00', to: '07:00' });
    expect(DEFAULT_QUIET.enabled).toBe(false);
  });
  it('si lo manda, usa lo del servidor', () => {
    const q = { enabled: true, from: '22:30', to: '06:45', tz: 'America/Argentina/Buenos_Aires' };
    expect(quietHoursOf({ quietHours: q })).toEqual(q);
  });
});

describe('validateQuietHours', () => {
  it('desde igual a hasta no se permite', () => {
    expect(validateQuietHours({ from: '23:00', to: '23:00' })).toEqual({
      ok: false,
      error: '“Desde” y “hasta” no pueden ser la misma hora.',
    });
    expect(validateQuietHours({ from: '00:00', to: '00:00' }).ok).toBe(false);
  });
  it('acepta ventanas que cruzan la medianoche y las que no', () => {
    expect(validateQuietHours({ from: '23:00', to: '07:00' }).ok).toBe(true);
    expect(validateQuietHours({ from: '13:00', to: '15:30' }).ok).toBe(true);
    expect(validateQuietHours({ from: '00:00', to: '23:59' }).ok).toBe(true);
  });
  it('rechaza horas mal escritas', () => {
    for (const bad of ['', '24:00', '7:00', '07:60', 'ab:cd', '07-00']) {
      expect(validateQuietHours({ from: bad, to: '07:00' }).ok).toBe(false);
      expect(validateQuietHours({ from: '23:00', to: bad }).ok).toBe(false);
    }
  });
});

describe('quietHoursToSave', () => {
  it('mezcla el cambio sobre lo vigente y conserva la zona del servidor', () => {
    const s = { quietHours: { enabled: false, from: '23:00', to: '07:00', tz: 'America/Montevideo' } };
    expect(quietHoursToSave(s, { enabled: true }, 'Europe/Madrid')).toEqual({
      enabled: true,
      from: '23:00',
      to: '07:00',
      tz: 'America/Montevideo',
    });
    expect(quietHoursToSave(s, { from: '22:00' }, 'Europe/Madrid')).toMatchObject({ from: '22:00', to: '07:00' });
  });
  it('si nunca se configuró usa la zona de este navegador', () => {
    expect(quietHoursToSave({}, { enabled: true }, 'America/Argentina/Cordoba')).toEqual({
      enabled: true,
      from: '23:00',
      to: '07:00',
      tz: 'America/Argentina/Cordoba',
    });
  });
  it('sin zona del navegador, la de por defecto', () => {
    expect(quietHoursToSave({}, {}, undefined).tz).toBe(DEFAULT_QUIET.tz);
  });
});

describe('windowLabel', () => {
  it('"De 23:00 a 07:00"', () => expect(windowLabel({ from: '23:00', to: '07:00' })).toBe('De 23:00 a 07:00'));
});

describe('sanitizeSettings con quietHours', () => {
  it('guarda un cambio válido y no toca lo demás', () => {
    const next = sanitizeSettings(DEFAULT_SETTINGS, { quietHours: { enabled: true, from: '22:00', to: '06:00', tz: 'America/Argentina/Buenos_Aires' } });
    expect(next.quietHours).toMatchObject({ enabled: true, from: '22:00', to: '06:00' });
    expect(next.thresholdPct).toBe(DEFAULT_SETTINGS.thresholdPct);
  });
});
