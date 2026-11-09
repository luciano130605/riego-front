import { describe, expect, it } from 'vitest';
import { quietHoursOf } from '@/core/quietHours';
import { buildBell } from '@/features/notifications/bell';
import { MockRiego } from './mockRiego';

const fresh = () => new MockRiego({ loadMs: 0 });

describe('No molestar con el simulador', () => {
  it('arranca prendido, de 23:00 a 07:00', () => {
    expect(quietHoursOf(fresh().getSnapshot().settings)).toMatchObject({ enabled: true, from: '23:00', to: '07:00' });
  });

  it('guarda el cambio recién cuando la API confirma', async () => {
    const api = fresh();
    const q = quietHoursOf(api.getSnapshot().settings);
    expect(await api.updateSettings({ quietHours: { ...q, enabled: false } })).toEqual({ ok: true });
    expect(quietHoursOf(api.getSnapshot().settings).enabled).toBe(false);
    expect(await api.updateSettings({ quietHours: { ...quietHoursOf(api.getSnapshot().settings), from: '22:30', to: '06:15' } })).toEqual({ ok: true });
    expect(quietHoursOf(api.getSnapshot().settings)).toMatchObject({ from: '22:30', to: '06:15' });
  });

  it('desde igual a hasta se rechaza con el motivo y no cambia nada', async () => {
    const api = fresh();
    const before = quietHoursOf(api.getSnapshot().settings);
    const res = await api.updateSettings({ quietHours: { ...before, from: '08:00', to: '08:00' } });
    expect(res).toEqual({ ok: false, error: '“Desde” y “hasta” no pueden ser la misma hora.' });
    expect(quietHoursOf(api.getSnapshot().settings)).toEqual(before);
  });

  it('con la API caída no se da por guardado', async () => {
    const api = fresh();
    const before = quietHoursOf(api.getSnapshot().settings);
    api.setFault('api-error');
    const res = await api.updateSettings({ quietHours: { ...before, enabled: false } });
    expect(res.ok).toBe(false);
    api.setFault('none');
    expect(quietHoursOf(api.getSnapshot().settings)).toEqual(before);
  });

  it('los datos de prueba traen un resumen de la noche y avisos silenciados', () => {
    const snap = fresh().getSnapshot();
    const night = snap.incidents!.find((i) => i.kind === 'night-summary');
    expect(night?.summary).toMatchObject({ offlineMin: 12 });
    expect(snap.incidents!.some((i) => i.silenced === true)).toBe(true);
    const bell = buildBell(snap, new Set());
    expect(bell.summary).toBeDefined();
    expect(bell.entries.some((e) => e.silenced)).toBe(true);
  });

  it('descartar el resumen lo saca de la campana', () => {
    const snap = fresh().getSnapshot();
    const key = buildBell(snap, new Set()).summary!.key;
    expect(buildBell(snap, new Set([key])).summary).toBeUndefined();
  });
});

describe('campana con sectores y plantas (simulador)', () => {
  it('cada aviso trae su planta y su sector, y salen avisos de más de una planta', () => {
    const snap = fresh().getSnapshot();
    const bell = buildBell(snap, new Set());
    const withWhere = bell.entries.filter((e) => e.where);
    expect(withWhere.length).toBeGreaterThan(1);
    expect(bell.entries.map((e) => e.where)).toContain('Tomates · Terraza');
    expect(bell.entries.map((e) => e.where)).toContain('Monstera · Interior');
  });
});
