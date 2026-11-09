import { describe, expect, it } from 'vitest';
import { swipeDirection } from './swipe';

describe('swipeDirection', () => {
  it('izquierda = siguiente, derecha = anterior', () => {
    expect(swipeDirection(-120, 5)).toBe('next');
    expect(swipeDirection(120, -5)).toBe('prev');
  });
  it('un gesto corto no cuenta', () => {
    expect(swipeDirection(-40, 0)).toBeUndefined();
    expect(swipeDirection(69, 0)).toBeUndefined();
  });
  it('si es más vertical que horizontal es un scroll, no un swipe', () => {
    expect(swipeDirection(-100, 90)).toBeUndefined();
    expect(swipeDirection(-100, 49)).toBe('next');
  });
});
