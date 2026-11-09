import { describe, expect, it } from 'vitest';
import { ewelinkReturnText, ewelinkView, isSafeRedirect, needsLinking, parseEwelinkReturn, parseEwelinkStatus, withoutEwelinkParams } from './ewelink';
import type { EwelinkStatus } from './types';

const st = (over: Partial<EwelinkStatus> = {}): EwelinkStatus => ({
  configurado: true,
  estado: 'vinculada',
  region: 'us',
  venceEl: Date.UTC(2026, 11, 1, 15, 0, 0),
  dispositivo: { encontrado: true, enLinea: true },
  ...over,
});

describe('parseEwelinkReturn', () => {
  it('?ewelink=ok', () => expect(parseEwelinkReturn('?ewelink=ok')).toEqual({ kind: 'ok' }));
  it('?ewelink=error&motivo=...', () => {
    expect(parseEwelinkReturn('?ewelink=error&motivo=state')).toEqual({ kind: 'error', code: 'state' });
    expect(parseEwelinkReturn('?ewelink=error')).toEqual({ kind: 'error', code: '' });
  });
  it('cualquier otra cosa no es una vuelta de eWeLink', () => {
    for (const s of ['', '?', '?ewelink=quizas', '?x=1', '?otro=ok']) expect(parseEwelinkReturn(s)).toBeUndefined();
  });
  it('un motivo larguísimo se recorta', () => {
    expect((parseEwelinkReturn(`?ewelink=error&motivo=${'x'.repeat(500)}`) as { code: string }).code).toHaveLength(40);
  });
});

describe('ewelinkReturnText', () => {
  it('la confirmación', () => expect(ewelinkReturnText({ kind: 'ok' })).toBe('eWeLink quedó vinculada.'));
  it('los códigos del backend pasan a frases en español', () => {
    expect(ewelinkReturnText({ kind: 'error', code: 'state' })).toMatch(/venció o ya se usó/);
    expect(ewelinkReturnText({ kind: 'error', code: 'faltan-datos' })).toMatch(/no mandó todos los datos/);
    expect(ewelinkReturnText({ kind: 'error', code: 'region' })).toMatch(/región/);
    expect(ewelinkReturnText({ kind: 'error', code: '10004' })).toMatch(/no coincide con la de tu cuenta/);
    expect(ewelinkReturnText({ kind: 'error', code: 'tokens' })).toMatch(/credenciales/);
    expect(ewelinkReturnText({ kind: 'error', code: 'interno' })).toMatch(/error en el servidor/);
  });
  it('un número de eWeLink o un código desconocido no queda mudo', () => {
    expect(ewelinkReturnText({ kind: 'error', code: '4002' })).toBe('eWeLink respondió con el error 4002. Probá de nuevo.');
    expect(ewelinkReturnText({ kind: 'error', code: 'rarísimo' })).toBe('No se pudo vincular eWeLink (rarísimo).');
    expect(ewelinkReturnText({ kind: 'error', code: '' })).toBe('No se pudo vincular eWeLink.');
  });
});

describe('withoutEwelinkParams', () => {
  it('saca los parámetros de la vuelta y conserva lo demás', () => {
    expect(withoutEwelinkParams('https://riego.test/?ewelink=ok')).toBe('/');
    expect(withoutEwelinkParams('https://riego.test/?ewelink=error&motivo=state#/planta/x')).toBe('/#/planta/x');
    expect(withoutEwelinkParams('https://riego.test/app?a=1&ewelink=ok&b=2')).toBe('/app?a=1&b=2');
  });
});

describe('ewelinkView', () => {
  it('vinculada: con la fecha de vencimiento y el equipo en línea', () => {
    const v = ewelinkView(st());
    expect(v).toMatchObject({ title: 'Vinculada', tone: 'ok', canLink: false, canUnlink: true, device: { label: 'En línea', tone: 'ok' } });
    expect(v.detail).toMatch(/^El acceso vence el .* y se renueva solo\.$/);
  });
  it('vinculada pero el equipo sin conexión o sin encontrar', () => {
    expect(ewelinkView(st({ dispositivo: { encontrado: true, enLinea: false } })).device).toEqual({ label: 'Sin conexión', tone: 'bad' });
    expect(ewelinkView(st({ dispositivo: { encontrado: false, enLinea: false } })).device?.label).toBe('No se encontró el equipo en tu cuenta');
  });
  it('sin vincular: se puede vincular, no desvincular', () => {
    expect(ewelinkView(st({ estado: 'sin-vincular', venceEl: null }))).toMatchObject({ title: 'Sin vincular', tone: 'neutral', canLink: true, canUnlink: false });
    expect(ewelinkView(st({ estado: 'sin-vincular' })).device).toBeUndefined();
  });
  it('vencida: hay que vincular de nuevo (y se puede desvincular)', () => {
    expect(ewelinkView(st({ estado: 'vencida' }))).toMatchObject({ title: 'Vencida', tone: 'warn', canLink: true, canUnlink: true });
  });
  it('error: muestra el texto del servidor', () => {
    expect(ewelinkView(st({ estado: 'error', error: 'No se pudo renovar el acceso.' }))).toMatchObject({
      title: 'Error',
      tone: 'bad',
      detail: 'No se pudo renovar el acceso.',
    });
    expect(ewelinkView(st({ estado: 'error' })).detail).toBe('No se pudo consultar eWeLink.');
  });
  it('sin configurar en el servidor: ni vincular ni desvincular', () => {
    expect(ewelinkView(st({ configurado: false, estado: 'sin-vincular' }))).toMatchObject({ title: 'Sin configurar', canLink: false, canUnlink: false });
  });
});

describe('needsLinking', () => {
  it('solo sin vincular o vencida, y si está configurado', () => {
    expect(needsLinking(st({ estado: 'sin-vincular' }))).toBe(true);
    expect(needsLinking(st({ estado: 'vencida' }))).toBe(true);
    expect(needsLinking(st({ estado: 'vinculada' }))).toBe(false);
    expect(needsLinking(st({ estado: 'error' }))).toBe(false);
    expect(needsLinking(st({ configurado: false, estado: 'sin-vincular' }))).toBe(false);
    expect(needsLinking(undefined)).toBe(false);
  });
});

describe('parseEwelinkStatus', () => {
  const ok = { ok: true, configurado: true, estado: 'vinculada', region: 'us', venceEl: 1_800_000_000_000, dispositivo: { encontrado: true, enLinea: false } };
  it('acepta lo que manda el servidor', () => {
    expect(parseEwelinkStatus(ok)).toEqual({ configurado: true, estado: 'vinculada', region: 'us', venceEl: 1_800_000_000_000, dispositivo: { encontrado: true, enLinea: false } });
  });
  it('region y venceEl pueden ser null; el error solo si viene', () => {
    expect(parseEwelinkStatus({ ...ok, estado: 'sin-vincular', region: null, venceEl: null })).toMatchObject({ region: null, venceEl: null });
    expect(parseEwelinkStatus({ ...ok, estado: 'error', error: 'Falló.' })?.error).toBe('Falló.');
    expect(parseEwelinkStatus(ok)).not.toHaveProperty('error');
  });
  it('algo inesperado no se convierte en un estado', () => {
    for (const bad of [null, 'x', {}, { ...ok, estado: 'quizas' }, { ...ok, configurado: 'si' }, { ...ok, dispositivo: undefined }, { ...ok, dispositivo: { encontrado: true } }]) {
      expect(parseEwelinkStatus(bad)).toBeUndefined();
    }
  });
});

describe('isSafeRedirect', () => {
  it('solo direcciones http(s) absolutas', () => {
    expect(isSafeRedirect('https://c2ccdn.coolkit.cc/oauth2/authorize?x=1')).toBe(true);
    expect(isSafeRedirect('http://localhost:3000/a')).toBe(true);
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', '/relativa', 'ftp://x', '', undefined, 42, null]) expect(isSafeRedirect(bad)).toBe(false);
  });
});
