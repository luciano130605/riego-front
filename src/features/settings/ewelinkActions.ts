import type { RiegoApi } from '@/data/api';

export type StepResult = { ok: true } | { ok: false; error: string };

/**
 * "Vincular eWeLink": pide la dirección de eWeLink (con la sesión del PIN) y manda el navegador ahí. No se da por
 * vinculada: eso lo dice el servidor cuando eWeLink vuelve a la pantalla.
 */
export async function startLinking(api: Pick<RiegoApi, 'ewelinkLogin'>, redirect: (url: string) => void): Promise<StepResult> {
  let res: Awaited<ReturnType<RiegoApi['ewelinkLogin']>>;
  try {
    res = await api.ewelinkLogin();
  } catch {
    return { ok: false, error: 'No se pudo conectar con el servidor.' };
  }
  if (!res.ok) return res;
  redirect(res.url);
  return { ok: true };
}

/** "Desvincular": borra el vínculo en el servidor. */
export async function unlink(api: Pick<RiegoApi, 'ewelinkUnlink'>): Promise<StepResult> {
  try {
    return await api.ewelinkUnlink();
  } catch {
    return { ok: false, error: 'No se pudo conectar con el servidor.' };
  }
}
