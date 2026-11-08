import { describe, expect, it } from 'vitest';
import { needsWifiGuide, wifiState } from './wifi';

const ok = { reporting: true, loading: false, serverError: false };

describe('wifiState', () => {
  it('conectada si la placa reporta a tiempo', () => {
    expect(wifiState({ lastSeen: 1000 }, ok)).toBe('connected');
  });

  it('sin conexión si dejó de reportar', () => {
    expect(wifiState({ lastSeen: 1000 }, { ...ok, reporting: false })).toBe('offline');
  });

  it('reseteada mientras haya wifiResetAt y no haya mandado nada desde entonces', () => {
    expect(wifiState({ lastSeen: 1000, wifiResetAt: 2000 }, { ...ok, reporting: false })).toBe('reset');
    expect(wifiState({ lastSeen: 2000, wifiResetAt: 2000 }, ok)).toBe('reset');
  });

  it('si mandó una lectura después del reseteo ya se reconectó, aunque el servidor no haya borrado wifiResetAt', () => {
    expect(wifiState({ lastSeen: 3000, wifiResetAt: 2000 }, ok)).toBe('connected');
  });

  it('no se sabe mientras carga o si no hay conexión con el servidor (no se muestra ninguna guía)', () => {
    expect(wifiState({ lastSeen: 0 }, { ...ok, loading: true })).toBe('unknown');
    expect(wifiState({ lastSeen: 1000, wifiResetAt: 2000 }, { ...ok, serverError: true })).toBe('unknown');
  });

  it('la guía se muestra sin conexión y reseteada, no conectada ni sin saber', () => {
    expect(needsWifiGuide('offline')).toBe(true);
    expect(needsWifiGuide('reset')).toBe(true);
    expect(needsWifiGuide('connected')).toBe(false);
    expect(needsWifiGuide('unknown')).toBe(false);
  });
});
