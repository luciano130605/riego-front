import { describe, expect, it } from 'vitest';
import { ewelinkView, needsLinking } from '@/core/ewelink';
import { startLinking, unlink } from '@/features/settings/ewelinkActions';
import { MockRiego } from './mockRiego';

const fresh = () => new MockRiego({ loadMs: 0 });
const status = async (api: MockRiego) => {
  const r = await api.ewelinkStatus();
  if (!r.ok) throw new Error(r.error);
  return r.status;
};

describe('simulador: eWeLink', () => {
  it('arranca vinculada, con vencimiento y el equipo en línea', async () => {
    const api = fresh();
    const s = await status(api);
    expect(s).toMatchObject({ configurado: true, estado: 'vinculada', dispositivo: { encontrado: true, enLinea: true } });
    expect(s.venceEl).toBeGreaterThan(api.now());
    expect(ewelinkView(s).canUnlink).toBe(true);
    expect((await api.relayStatus()) as { online: boolean }).toMatchObject({ ok: true, online: true });
  });

  it('cada escenario da su estado', async () => {
    const api = fresh();
    api.setEwelink('sin-vincular');
    expect(await status(api)).toMatchObject({ estado: 'sin-vincular', venceEl: null });
    api.setEwelink('vencida');
    const vencida = await status(api);
    expect(vencida.estado).toBe('vencida');
    expect(vencida.venceEl!).toBeLessThan(api.now());
    api.setEwelink('error');
    expect(await status(api)).toMatchObject({ estado: 'error', error: expect.stringContaining('eWeLink') });
    api.setEwelink('equipo-sin-conexion');
    expect(await status(api)).toMatchObject({ estado: 'vinculada', dispositivo: { encontrado: true, enLinea: false } });
  });

  it('sin vincular, vencida o con el equipo sin conexión el regador no responde', async () => {
    const api = fresh();
    for (const sim of ['sin-vincular', 'vencida', 'error', 'equipo-sin-conexion'] as const) {
      api.setEwelink(sim);
      expect(await api.relayStatus()).toMatchObject({ ok: true, online: false });
    }
    api.setEwelink('vinculada');
    expect(await api.relayStatus()).toMatchObject({ ok: true, online: true });
  });

  it('solo hay que vincular si está sin vincular o vencida (reemplaza el aviso "El regador no responde")', async () => {
    const api = fresh();
    const cases = { 'sin-vincular': true, vencida: true, error: false, 'equipo-sin-conexion': false, vinculada: false } as const;
    for (const [sim, expected] of Object.entries(cases)) {
      api.setEwelink(sim as keyof typeof cases);
      expect(needsLinking(await status(api))).toBe(expected);
    }
  });

  it('vincular: pide la dirección, redirige a ella y queda vinculada', async () => {
    const api = fresh();
    api.setEwelink('sin-vincular');
    const redirected: string[] = [];
    const res = await startLinking(api, (u) => redirected.push(u));
    expect(res).toEqual({ ok: true });
    expect(redirected).toHaveLength(1);
    expect(redirected[0]).toMatch(/\?ewelink=ok$/);
    expect((await status(api)).estado).toBe('vinculada');
  });

  it('desvincular: borra el vínculo', async () => {
    const api = fresh();
    expect(await unlink(api)).toEqual({ ok: true });
    expect((await status(api)).estado).toBe('sin-vincular');
    expect(ewelinkView(await status(api)).canUnlink).toBe(false);
  });

  it('con el servidor caído no se da nada por hecho', async () => {
    const api = fresh();
    api.setFault('api-error');
    expect((await api.ewelinkStatus()).ok).toBe(false);
    const redirected: string[] = [];
    const link = await startLinking(api, (u) => redirected.push(u));
    expect(link.ok).toBe(false);
    expect(redirected).toEqual([]); // no se redirigió
    expect((await unlink(api)).ok).toBe(false);
    api.setFault('none');
    expect((await status(api)).estado).toBe('vinculada'); // sigue como estaba
  });
});
