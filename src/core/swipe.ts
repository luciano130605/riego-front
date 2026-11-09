/** Un gesto horizontal cuenta si es largo y bastante más horizontal que vertical (si no, la persona está scrolleando). */
export const SWIPE_MIN_PX = 70;
export const SWIPE_MAX_SLOPE = 0.5;

/** 'next' = deslizó a la izquierda (viene la planta siguiente); 'prev' = a la derecha. */
export function swipeDirection(dx: number, dy: number): 'next' | 'prev' | undefined {
  if (Math.abs(dx) < SWIPE_MIN_PX) return undefined;
  if (Math.abs(dy) > Math.abs(dx) * SWIPE_MAX_SLOPE) return undefined;
  return dx < 0 ? 'next' : 'prev';
}
