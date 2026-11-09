/** Reglas de sectores y plantas. Son las mismas que aplica el backend (400 si no se cumplen); acá sirven para avisar antes. */

export const LIMITS = {
  threshold: { min: 10, max: 70 },
  target: { min: 20, max: 95 },
  /** El objetivo tiene que superar al umbral por lo menos en esto. */
  gap: 5,
  nameMax: 40,
} as const;

const CHANNEL_RE = /^[a-zA-Z0-9_-]{1,16}$/;

export function validateName(name: string): string | undefined {
  const n = name.trim();
  if (n.length === 0) return 'Escribí un nombre.';
  if (n.length > LIMITS.nameMax) return `El nombre puede tener hasta ${LIMITS.nameMax} caracteres.`;
  return undefined;
}

/** Umbral y objetivo (efectivos): dentro de rango y con el objetivo al menos 5 puntos arriba. Se rechaza, no se corrige. */
export function validateLimits(thresholdPct: number, targetPct: number): string | undefined {
  const t = LIMITS.threshold;
  const g = LIMITS.target;
  if (!Number.isFinite(thresholdPct) || thresholdPct < t.min || thresholdPct > t.max) {
    return `El umbral tiene que estar entre ${t.min} y ${t.max} %.`;
  }
  if (!Number.isFinite(targetPct) || targetPct < g.min || targetPct > g.max) {
    return `El objetivo tiene que estar entre ${g.min} y ${g.max} %.`;
  }
  if (targetPct < thresholdPct + LIMITS.gap) return `El objetivo tiene que ser al menos ${LIMITS.gap} puntos mayor que el umbral.`;
  return undefined;
}

export function validateChannel(channel: string): string | undefined {
  return CHANNEL_RE.test(channel) ? undefined : 'El canal tiene que tener de 1 a 16 caracteres: letras, números, guion y guion bajo.';
}

/** Umbral y objetivo que valen para una planta: los propios, o los del sector si hereda (null o sin dato). */
export function effectiveLimits(
  plant: { thresholdPct?: number | null; targetPct?: number | null },
  sector: { thresholdPct: number; targetPct: number },
): { thresholdPct: number; targetPct: number } {
  return { thresholdPct: plant.thresholdPct ?? sector.thresholdPct, targetPct: plant.targetPct ?? sector.targetPct };
}
