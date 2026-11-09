import { describe, expect, it } from 'vitest';
import { addDismissed, readDismissed } from './dismissed';

function store(initial?: string) {
  const data = new Map<string, string>(initial ? [['riego-aut:avisos-descartados', initial]] : []);
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    data,
  };
}

describe('avisos descartados', () => {
  it('arranca vacío', () => expect(readDismissed(store())).toEqual([]));

  it('recuerda lo que se descartó', () => {
    const s = store();
    const next = addDismissed('night-summary-1', [], s);
    expect(next).toEqual(['night-summary-1']);
    expect(readDismissed(s)).toEqual(['night-summary-1']);
  });

  it('no repite una clave', () => {
    const s = store();
    const a = addDismissed('x-1', [], s);
    expect(addDismissed('x-1', a, s)).toBe(a);
  });

  it('un valor guardado roto se ignora', () => {
    expect(readDismissed(store('{no es json'))).toEqual([]);
    expect(readDismissed(store('{"a":1}'))).toEqual([]);
    expect(readDismissed(store('["a", 3, "b"]'))).toEqual(['a', 'b']);
  });

  it('sin almacenamiento igual se oculta en esta sesión', () => {
    expect(addDismissed('x-1', [], null)).toEqual(['x-1']);
    const broken = { getItem: () => { throw new Error('bloqueado'); }, setItem: () => { throw new Error('bloqueado'); } };
    expect(readDismissed(broken)).toEqual([]);
    expect(addDismissed('x-1', [], broken)).toEqual(['x-1']);
  });

  it('guarda solo los últimos 100', () => {
    let list: string[] = [];
    const s = store();
    for (let i = 0; i < 120; i++) list = addDismissed(`k-${i}`, list, s);
    expect(list).toHaveLength(100);
    expect(list[0]).toBe('k-20');
    expect(list.at(-1)).toBe('k-119');
  });
});
