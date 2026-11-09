import { describe, expect, it } from 'vitest';
import { readChip, resolveChip, writeChip } from './chipStore';

const store = (initial?: string) => {
  const data = new Map<string, string>(initial ? [['riego-aut:sector', initial]] : []);
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v), data };
};

describe('chip elegido', () => {
  it('arranca en "todos" y recuerda lo que se eligió', () => {
    const s = store();
    expect(readChip(s)).toBe('all');
    writeChip('sector-terraza', s);
    expect(readChip(s)).toBe('sector-terraza');
  });
  it('sin almacenamiento o con uno roto no falla', () => {
    expect(readChip(null)).toBe('all');
    expect(() => writeChip('x', null)).not.toThrow();
    const broken = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); } };
    expect(readChip(broken)).toBe('all');
    expect(() => writeChip('x', broken)).not.toThrow();
  });
  it('si el sector elegido ya no existe vuelve a "todos"', () => {
    expect(resolveChip('s1', ['s1', 's2'])).toBe('s1');
    expect(resolveChip('s9', ['s1', 's2'])).toBe('all');
    expect(resolveChip('all', [])).toBe('all');
  });
});
