import { describe, expect, it } from 'vitest';
import { urlBase64ToUint8Array } from './push';

describe('urlBase64ToUint8Array', () => {
  it('convierte base64url (con - y _, sin relleno) en bytes', () => {
    // 0xfb 0xff 0xfe en base64 es "+//+", y en base64url "-__-".
    expect(Array.from(urlBase64ToUint8Array('-__-'))).toEqual([0xfb, 0xff, 0xfe]);
  });

  it('agrega el relleno que falta', () => {
    expect(Array.from(urlBase64ToUint8Array('aGk'))).toEqual([104, 105]); // "hi"
    expect(Array.from(urlBase64ToUint8Array('aA'))).toEqual([104]); // "h"
  });

  it('una clave VAPID de 65 bytes da 65 bytes', () => {
    const key = 'B' + 'A'.repeat(86); // 87 caracteres base64url = 65 bytes
    expect(urlBase64ToUint8Array(key)).toHaveLength(65);
  });

  it('vacío da vacío', () => {
    expect(urlBase64ToUint8Array('')).toHaveLength(0);
  });
});
