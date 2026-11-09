import { longDateTime } from './format';
import type { EwelinkStatus } from './types';

/** Lo que trae la dirección al volver de eWeLink: `?ewelink=ok` o `?ewelink=error&motivo=<código>`. */
export type EwelinkReturn = { kind: 'ok' } | { kind: 'error'; code: string };

export function parseEwelinkReturn(search: string): EwelinkReturn | undefined {
  const q = new URLSearchParams(search);
  const r = q.get('ewelink');
  if (r === 'ok') return { kind: 'ok' };
  if (r === 'error') return { kind: 'error', code: (q.get('motivo') ?? '').slice(0, 40) };
  return undefined;
}

/** El motivo del servidor es un código corto, no un texto: acá se pasa a una frase. */
export function ewelinkReturnText(r: EwelinkReturn): string {
  if (r.kind === 'ok') return 'eWeLink quedó vinculada.';
  switch (r.code) {
    case 'state':
      return 'El enlace venció o ya se usó. Probá vincular de nuevo.';
    case 'faltan-datos':
      return 'eWeLink no mandó todos los datos. Probá vincular de nuevo.';
    case 'region':
      return 'La región que devolvió eWeLink no es válida.';
    case '10004':
      return 'La región no coincide con la de tu cuenta de eWeLink.';
    case 'tokens':
      return 'eWeLink no devolvió las credenciales. Probá vincular de nuevo.';
    case 'interno':
      return 'Ocurrió un error en el servidor. Probá de nuevo en un rato.';
    case '':
      return 'No se pudo vincular eWeLink.';
    default:
      return /^\d+$/.test(r.code) ? `eWeLink respondió con el error ${r.code}. Probá de nuevo.` : `No se pudo vincular eWeLink (${r.code}).`;
  }
}

/** La dirección sin los parámetros de la vuelta (para no volver a mostrar el aviso al recargar). Conserva la ruta y el hash. */
export function withoutEwelinkParams(href: string): string {
  const u = new URL(href);
  u.searchParams.delete('ewelink');
  u.searchParams.delete('motivo');
  return `${u.pathname}${u.search}${u.hash}`;
}

export type EwelinkTone = 'ok' | 'warn' | 'bad' | 'neutral';

export type EwelinkView = {
  /** "Vinculada", "Sin vincular", "Vencida" o "Error". */
  title: string;
  tone: EwelinkTone;
  /** Una línea que explica (fecha de vencimiento, qué hacer, el error). */
  detail?: string;
  /** El equipo, si tiene sentido hablar de él. */
  device?: { label: string; tone: EwelinkTone };
  /** Qué botones corresponden. */
  canLink: boolean;
  canUnlink: boolean;
};

/** Qué se muestra de cada estado. Lo que el servidor no manda no se inventa. */
export function ewelinkView(s: EwelinkStatus): EwelinkView {
  if (!s.configurado) {
    return {
      title: 'Sin configurar',
      tone: 'neutral',
      detail: 'El servidor no tiene eWeLink configurado (faltan las credenciales, o el regador no es un Sonoff).',
      canLink: false,
      canUnlink: false,
    };
  }
  const device = !s.dispositivo.encontrado
    ? { label: 'No se encontró el equipo en tu cuenta', tone: 'warn' as const }
    : s.dispositivo.enLinea
      ? { label: 'En línea', tone: 'ok' as const }
      : { label: 'Sin conexión', tone: 'bad' as const };
  switch (s.estado) {
    case 'vinculada':
      return {
        title: 'Vinculada',
        tone: 'ok',
        detail: s.venceEl !== null ? `El acceso vence el ${longDateTime(s.venceEl)} y se renueva solo.` : undefined,
        device,
        canLink: false,
        canUnlink: true,
      };
    case 'vencida':
      return {
        title: 'Vencida',
        tone: 'warn',
        detail: 'El acceso venció. Hay que vincular eWeLink de nuevo para que el regador responda.',
        canLink: true,
        canUnlink: true,
      };
    case 'error':
      return {
        title: 'Error',
        tone: 'bad',
        detail: s.error ?? 'No se pudo consultar eWeLink.',
        canLink: true,
        canUnlink: true,
      };
    default:
      return {
        title: 'Sin vincular',
        tone: 'neutral',
        detail: 'Vinculá tu cuenta de eWeLink para que el regador (Sonoff) pueda regar. Mientras tanto el sistema solo avisa cuándo regar.',
        canLink: true,
        canUnlink: false,
      };
  }
}

/** ¿Hay que vincular? (para reemplazar el aviso "El regador no responde" por "Vincular eWeLink"). */
export const needsLinking = (s: Pick<EwelinkStatus, 'configurado' | 'estado'> | undefined): boolean =>
  !!s && s.configurado && (s.estado === 'sin-vincular' || s.estado === 'vencida');

const ESTADOS = new Set(['sin-vincular', 'vinculada', 'vencida', 'error']);

/** Valida lo que responde `GET /api/ewelink/status`: si algo no es lo esperado, no se inventa un estado. */
export function parseEwelinkStatus(body: unknown): EwelinkStatus | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const b = body as Record<string, unknown>;
  const d = b.dispositivo as Record<string, unknown> | undefined;
  if (typeof b.configurado !== 'boolean' || typeof b.estado !== 'string' || !ESTADOS.has(b.estado)) return undefined;
  if (typeof d !== 'object' || d === null || typeof d.encontrado !== 'boolean' || typeof d.enLinea !== 'boolean') return undefined;
  return {
    configurado: b.configurado,
    estado: b.estado as EwelinkStatus['estado'],
    region: typeof b.region === 'string' ? b.region : null,
    venceEl: typeof b.venceEl === 'number' && Number.isFinite(b.venceEl) ? b.venceEl : null,
    ...(typeof b.error === 'string' && b.error ? { error: b.error } : {}),
    dispositivo: { encontrado: d.encontrado, enLinea: d.enLinea },
  };
}

/** Solo se redirige a una dirección http(s) absoluta: nunca a `javascript:` ni a algo raro que mande el servidor. */
export function isSafeRedirect(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

