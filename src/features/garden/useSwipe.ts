import { useRef, type TouchEvent } from 'react';
import { swipeDirection } from '@/core/swipe';

/** Dónde no se interpreta un deslizamiento como "cambiar de planta": carruseles, campos y diálogos tienen el suyo. */
const IGNORE = '[data-no-swipe], input, select, textarea, dialog, [role="slider"], [role="tablist"]';

/** Handlers para deslizar entre plantas con el dedo. */
export function useSwipe(onNext: () => void, onPrev: () => void) {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (e: TouchEvent) => {
      const t = e.touches[0];
      start.current = (e.target as Element).closest(IGNORE) ? null : { x: t.clientX, y: t.clientY };
    },
    onTouchEnd: (e: TouchEvent) => {
      const s = start.current;
      start.current = null;
      if (!s) return;
      const t = e.changedTouches[0];
      const dir = swipeDirection(t.clientX - s.x, t.clientY - s.y);
      if (dir === 'next') onNext();
      else if (dir === 'prev') onPrev();
    },
  };
}
