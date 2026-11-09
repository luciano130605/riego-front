import { beforeEach, describe, expect, it } from 'vitest';
import { requestSettings, takeAnchor, takePending } from './settingsRequest';

beforeEach(() => {
  takePending();
  takeAnchor();
});

describe('pedidos de abrir Configuración', () => {
  it('el pedido queda guardado hasta que alguien lo toma, y se toma una sola vez', () => {
    requestSettings({ tab: 'device', anchor: 'ewelink' });
    expect(takePending()).toEqual({ tab: 'device', anchor: 'ewelink' });
    expect(takePending()).toBeUndefined();
  });
  it('la sección a la que bajar se toma una sola vez', () => {
    requestSettings({ tab: 'device', anchor: 'ewelink' });
    expect(takeAnchor()).toBe('ewelink');
    expect(takeAnchor()).toBeUndefined();
  });
  it('un pedido sin sección no deja ninguna pendiente', () => {
    requestSettings({ tab: 'notifications' });
    expect(takeAnchor()).toBeUndefined();
  });
  it('avisa a los que escuchan', () => {
    // (el hook usa este mismo mecanismo: se prueba la parte sin React)
    requestSettings({ tab: 'device' });
    expect(takePending()?.tab).toBe('device');
  });
});
