import { describe, expect, it, vi } from 'vitest';
import { PUSH_KINDS, type PushKind, type PushTestResult } from '@/data/api';
import { testAllKinds } from './pushTestAll';

const noWait = async () => {};

describe('testAllKinds', () => {
  it('manda una prueba de cada tipo de aviso, en orden', async () => {
    const send = vi.fn(async (): Promise<PushTestResult> => ({ ok: true }));
    const res = await testAllKinds(send, { sleep: noWait });
    expect(send.mock.calls.map((c) => (c as unknown[])[0])).toEqual([...PUSH_KINDS]);
    expect(res).toEqual({ sent: [...PUSH_KINDS] });
  });

  it('hace una pausa entre una y otra, pero no después de la última', async () => {
    const sleep = vi.fn(noWait);
    await testAllKinds(async () => ({ ok: true }), { sleep, gapMs: 1200 });
    expect(sleep).toHaveBeenCalledTimes(PUSH_KINDS.length - 1);
    expect(sleep).toHaveBeenCalledWith(1200);
  });

  it('avisa el avance antes de cada envío', async () => {
    const seen: Array<[number, number, PushKind]> = [];
    await testAllKinds(async () => ({ ok: true }), { sleep: noWait, onProgress: (n, total, kind) => seen.push([n, total, kind]) });
    expect(seen.map((s) => s[0])).toEqual(PUSH_KINDS.map((_, i) => i + 1));
    expect(seen.every((s) => s[1] === PUSH_KINDS.length)).toBe(true);
    expect(seen[0][2]).toBe(PUSH_KINDS[0]);
  });

  it('si una falla se frena ahí y dice cuál fue y por qué', async () => {
    const send = vi.fn(async (kind: PushKind): Promise<PushTestResult> =>
      kind === 'riego-iniciado' ? { ok: false, error: 'La suscripción venció.', status: 410 } : { ok: true },
    );
    const res = await testAllKinds(send, { sleep: noWait });
    expect(send).toHaveBeenCalledTimes(4); // no insiste con las que siguen
    expect(res.sent).toEqual(['humedad-baja', 'necesita-riego', 'humedad-recuperada']);
    expect(res.failed).toEqual({ kind: 'riego-iniciado', result: { ok: false, error: 'La suscripción venció.', status: 410 } });
  });

  it('si falla la primera no manda ninguna', async () => {
    const res = await testAllKinds(async () => ({ ok: false, error: 'No se pudo conectar con el servidor.' }), { sleep: noWait });
    expect(res.sent).toEqual([]);
    expect(res.failed?.kind).toBe(PUSH_KINDS[0]);
  });

  it('puede probar solo algunos tipos', async () => {
    const send = vi.fn(async (): Promise<PushTestResult> => ({ ok: true }));
    const res = await testAllKinds(send, { kinds: ['placa-offline'], sleep: noWait });
    expect(send).toHaveBeenCalledOnce();
    expect(res.sent).toEqual(['placa-offline']);
  });
});
