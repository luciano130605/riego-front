import { PUSH_KINDS, type PushKind, type PushTestResult } from '@/data/api';

type Failure = Extract<PushTestResult, { ok: false }>;

export type TestAllResult = {
  /** Las pruebas que se mandaron, en orden. */
  sent: PushKind[];
  /** La que falló (si alguna): ahí se frena, porque las siguientes fallarían igual. */
  failed?: { kind: PushKind; result: Failure };
};

type Options = {
  kinds?: readonly PushKind[];
  /** Pausa entre una prueba y la siguiente, para que no lleguen todas pegadas. */
  gapMs?: number;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (n: number, total: number, kind: PushKind) => void;
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Manda una prueba de cada tipo de aviso, una tras otra y con una pausa, para ver cómo llega cada uno.
 * Si una falla (la suscripción venció, hay un límite de intentos, no hay conexión...) se frena ahí y lo dice.
 */
export async function testAllKinds(send: (kind: PushKind) => Promise<PushTestResult>, opts: Options = {}): Promise<TestAllResult> {
  const kinds = opts.kinds ?? PUSH_KINDS;
  const gap = opts.gapMs ?? 1500;
  const sleep = opts.sleep ?? wait;
  const sent: PushKind[] = [];
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    opts.onProgress?.(i + 1, kinds.length, kind);
    const result = await send(kind);
    if (!result.ok) return { sent, failed: { kind, result } };
    sent.push(kind);
    if (i < kinds.length - 1) await sleep(gap);
  }
  return { sent };
}
