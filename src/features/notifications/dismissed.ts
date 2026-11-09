/** Avisos que se descartaron en este navegador. Se recuerdan por clave (`tipo-hora`); los avisos nuevos vuelven a salir. */

const KEY = 'riego-aut:avisos-descartados';
/** Para que la lista no crezca sin límite: se guardan solo los últimos. */
const MAX = 100;

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readDismissed(store: Store | null = defaultStore()): string[] {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Suma una clave y devuelve la lista nueva. Sin almacenamiento, dura lo que dure la pestaña (la lista igual se devuelve). */
export function addDismissed(key: string, current: string[], store: Store | null = defaultStore()): string[] {
  if (current.includes(key)) return current;
  const next = [...current, key].slice(-MAX);
  try {
    store?.setItem(KEY, JSON.stringify(next));
  } catch {
    // Modo privado o sin espacio: no se recuerda, pero el aviso se oculta igual en esta sesión.
  }
  return next;
}
