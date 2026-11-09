import { useCallback, useState } from 'react';
import type { ActionResult } from '@/data/api';
import { useToast } from '@/ui/toastContext';

type Options = {
  /** Mensaje si salió bien. */
  ok?: string;
  /** El error lo muestra quien llama (en un diálogo): no sale el aviso de abajo. */
  inlineError?: boolean;
};

/**
 * Corre un cambio de sectores o plantas. No se da por hecho hasta que la API responde: mientras tanto `busy` está
 * prendido (para deshabilitar los controles) y, si falla, sale el error del servidor.
 */
export function useGardenAction() {
  const toast = useToast();
  const [pending, setPending] = useState(0);

  const run = useCallback(
    async (action: Promise<ActionResult>, opts: Options = {}): Promise<ActionResult> => {
      setPending((n) => n + 1);
      let res: ActionResult;
      try {
        res = await action;
      } catch {
        res = { ok: false, error: 'No se pudo conectar con el servidor.' };
      }
      setPending((n) => n - 1);
      if (res.ok) {
        if (opts.ok) toast.show('success', opts.ok);
      } else if (!opts.inlineError) {
        toast.show('error', `No se guardó el cambio. ${res.error}`);
      }
      return res;
    },
    [toast],
  );

  return { run, busy: pending > 0 };
}
