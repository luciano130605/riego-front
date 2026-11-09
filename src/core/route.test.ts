import { describe, expect, it } from 'vitest';
import { HOME_HREF, parseRoute, plantHref } from './route';

describe('rutas', () => {
  it('sin hash o con cualquier cosa desconocida es la vista general', () => {
    for (const h of ['', '#', '#/', '#/otra', '#/planta', '#/planta/', '#/planta//x']) expect(parseRoute(h)).toEqual({ name: 'home' });
    expect(HOME_HREF).toBe('#/');
  });
  it('#/planta/<id> es el detalle de esa planta', () => {
    expect(parseRoute('#/planta/plant-main')).toEqual({ name: 'plant', id: 'plant-main' });
    expect(parseRoute('#/planta/plant-main/')).toEqual({ name: 'plant', id: 'plant-main' });
  });
  it('ida y vuelta, también con caracteres raros en el id', () => {
    for (const id of ['plant-main', 'a b', 'ñandú', 'x/y', '12ab34cd56ef']) expect(parseRoute(plantHref(id))).toEqual({ name: 'plant', id });
  });
  it('un id con un escape roto no explota', () => {
    expect(parseRoute('#/planta/%E0%A4%A')).toEqual({ name: 'home' });
  });
});
