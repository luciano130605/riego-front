import { DEFAULT_SETTINGS, isValidHm } from './settings';
import { QUIET } from './copy';
import type { QuietHours, Settings } from './types';

/** Lo que vale si el servidor no manda `quietHours`: apagado, de 23:00 a 07:00. */
export const DEFAULT_QUIET: QuietHours = DEFAULT_SETTINGS.quietHours as QuietHours;

export function quietHoursOf(s: Pick<Settings, 'quietHours'>): QuietHours {
  return s.quietHours ?? DEFAULT_QUIET;
}

/** Zona horaria de este navegador (IANA), si el motor de Intl la sabe. */
export function localTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Valida la ventana antes de mandarla: dos horas 'HH:mm' y que no sean la misma (una ventana de largo cero no
 * silenciaría nada, y de 24 h tampoco tendría sentido). El servidor lo vuelve a validar y responde 400.
 */
export function validateQuietHours(q: Pick<QuietHours, 'from' | 'to'>): { ok: true } | { ok: false; error: string } {
  if (!isValidHm(q.from) || !isValidHm(q.to)) return { ok: false, error: QUIET.invalidTime };
  if (q.from === q.to) return { ok: false, error: QUIET.sameTime };
  return { ok: true };
}

/**
 * La ventana completa que se manda al servidor: lo vigente más el cambio. La zona es la que ya tenía; si nunca se
 * configuró, la de este navegador.
 */
export function quietHoursToSave(
  s: Pick<Settings, 'quietHours'>,
  patch: Partial<Pick<QuietHours, 'enabled' | 'from' | 'to'>>,
  browserTz: string | undefined = localTimeZone(),
): QuietHours {
  const base = quietHoursOf(s);
  return { ...base, tz: s.quietHours?.tz ?? browserTz ?? base.tz, ...patch };
}

/** "De 23:00 a 07:00". */
export function windowLabel(q: Pick<QuietHours, 'from' | 'to'>): string {
  return QUIET.window(q.from, q.to);
}
