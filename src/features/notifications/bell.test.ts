import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/core/settings';
import type { Incident, Reading, Snapshot } from '@/core/types';
import { buildBell } from './bell';

const MIN = 60_000;
const HOUR = 60 * MIN;
const NOW = Date.UTC(2026, 10, 9, 12, 0, 0);

/** Una lectura cada 15 min: la humedad baja de 35 % hace 5 h y vuelve a subir hace 3 h. */
function readings(): Reading[] {
  const out: Reading[] = [];
  for (let i = 24; i >= 0; i--) {
    const t = NOW - 6 * MIN - i * 15 * MIN;
    const hAgo = (NOW - t) / HOUR;
    out.push({ t, raw: 2300, moisture: hAgo > 5 ? 40 : hAgo > 3 ? 30 : 46 });
  }
  return out;
}

function snap(incidents?: Incident[]): Snapshot {
  return {
    load: 'ready',
    now: NOW,
    readings: readings(),
    events: [],
    settings: DEFAULT_SETTINGS,
    device: { online: true, lastSeen: NOW - 6 * MIN, readEveryMin: 15 },
    isDemo: false,
    ...(incidents ? { incidents } : {}),
  };
}

const summary = (t: number): Incident => ({
  t,
  kind: 'night-summary',
  message: 'Resumen de la noche',
  summary: { moistureStart: 48, moistureEnd: 41, moistureMin: 40, wateringAlerts: 1, wateringsAuto: 0, wateringsManual: 1, offlineMin: 12 },
});

describe('buildBell sin resumen', () => {
  it('sin incidentes: los avisos de siempre y ningún resumen', () => {
    const v = buildBell(snap(), new Set());
    expect(v.summary).toBeUndefined();
    expect(v.entries.map((e) => e.kind)).toEqual(['recovered', 'dry']);
    expect(v.entries.every((e) => e.silenced === false)).toBe(true);
  });

  it('un servidor viejo (sin `incidents`) anda igual', () => {
    expect(buildBell(snap(undefined), new Set()).entries).toHaveLength(2);
  });

  it('un resumen sin datos o muy viejo no se muestra', () => {
    const old = summary(NOW - 49 * HOUR);
    const empty: Incident = { t: NOW - HOUR, kind: 'night-summary', message: 'x' };
    expect(buildBell(snap([old, empty]), new Set()).summary).toBeUndefined();
  });
});

describe('buildBell con resumen', () => {
  it('el resumen sale aparte, con sus líneas, y es el más nuevo si hay varios', () => {
    const v = buildBell(snap([summary(NOW - 30 * HOUR), summary(NOW - 5 * HOUR)]), new Set());
    expect(v.summary).toMatchObject({ key: `night-summary-${NOW - 5 * HOUR}`, t: NOW - 5 * HOUR });
    expect(v.summary!.lines[0]).toBe('La humedad pasó de 48 % a 41 % (mínima 40 %).');
    expect(v.summary!.lines).toContain('La placa estuvo sin conexión 12 min.');
    // No se mezcla con los avisos de la lista.
    expect(v.entries.some((e) => e.kind === ('night-summary' as never))).toBe(false);
  });

  it('descartarlo lo saca; los demás avisos siguen', () => {
    const inc = summary(NOW - 5 * HOUR);
    const v = buildBell(snap([inc]), new Set([`night-summary-${inc.t}`]));
    expect(v.summary).toBeUndefined();
    expect(v.entries).toHaveLength(2);
  });
});

describe('buildBell con avisos silenciados', () => {
  // La hora exacta en que la pantalla marca que la humedad bajó.
  const dryAt = buildBell(snap(), new Set()).entries.find((e) => e.kind === 'dry')!.t;
  const silenced: Incident = { t: dryAt + 2 * MIN, kind: 'humedad-baja', message: 'La humedad bajó', silenced: true };

  it('el aviso que coincide por tipo y hora se ve normal y con la marca de silenciado', () => {
    const v = buildBell(snap([silenced]), new Set());
    const dry = v.entries.find((e) => e.kind === 'dry')!;
    const back = v.entries.find((e) => e.kind === 'recovered')!;
    expect(dry.silenced).toBe(true);
    expect(dry.text).toBe('La humedad bajó de 35 %'); // el texto no cambia
    expect(back.silenced).toBe(false);
  });

  it('un incidente que no está silenciado, o de otro tipo, o de otra hora, no marca nada', () => {
    const normal: Incident = { ...silenced, silenced: false };
    const other: Incident = { ...silenced, kind: 'placa-offline' };
    const far: Incident = { ...silenced, t: dryAt + 3 * HOUR };
    for (const inc of [normal, other, far]) {
      expect(buildBell(snap([inc]), new Set()).entries.find((e) => e.kind === 'dry')!.silenced).toBe(false);
    }
  });

  it('un aviso silenciado se une con una sola entrada', () => {
    const twice: Snapshot = snap([silenced, { ...silenced, t: dryAt + 5 * MIN }]);
    // Dos avisos silenciados para una sola entrada: solo uno se usa.
    expect(buildBell(twice, new Set()).entries.filter((e) => e.silenced)).toHaveLength(1);
  });

  it('descartar un aviso lo saca de la lista', () => {
    const v = buildBell(snap(), new Set());
    const first = v.entries[0];
    expect(buildBell(snap(), new Set([first.key])).entries.map((e) => e.key)).not.toContain(first.key);
  });
});

describe('buildBell con sectores y plantas', () => {
  const inc = (over: Partial<Incident>): Incident => ({ t: NOW - 2 * HOUR, kind: 'humedad-baja', message: 'La humedad bajó', ...over });
  const multi = (incidents: Incident[]): Snapshot => ({ ...snap(incidents), plants: [] });

  it('los avisos son los del servidor, con planta y sector, del más nuevo al más viejo', () => {
    const v = buildBell(
      multi([
        inc({ t: NOW - 5 * HOUR, plantId: 'a', plantName: 'Monstera', sectorName: 'Interior' }),
        inc({ t: NOW - 1 * HOUR, kind: 'necesita-riego', message: 'Hay que regar', plantId: 'b', plantName: 'Tomates', sectorName: 'Terraza' }),
      ]),
      new Set(),
    );
    expect(v.entries.map((e) => [e.where, e.text])).toEqual([
      ['Tomates · Terraza', 'Hay que regar'],
      ['Monstera · Interior', 'La humedad bajó'],
    ]);
  });

  it('los de la placa no traen planta; los silenciados se marcan; lo que no es de la campana no sale', () => {
    const v = buildBell(
      multi([
        inc({ kind: 'placa-offline', message: 'La placa dejó de reportar' }),
        inc({ t: NOW - 3 * HOUR, kind: 'humedad-recuperada', message: 'Volvió', plantId: 'a', plantName: 'Monstera', silenced: true }),
        inc({ kind: 'riego-iniciado', message: 'Empezó el riego' }),
      ]),
      new Set(),
    );
    expect(v.entries).toHaveLength(2);
    expect(v.entries[0].where).toBeUndefined();
    expect(v.entries[1]).toMatchObject({ where: 'Monstera', silenced: true });
  });

  it('un mismo aviso de dos plantas distintas no se mezcla al descartar', () => {
    const a = inc({ plantId: 'a', plantName: 'A' });
    const b = inc({ plantId: 'b', plantName: 'B' });
    const all = buildBell(multi([a, b]), new Set());
    expect(all.entries).toHaveLength(2);
    const [first] = all.entries;
    const rest = buildBell(multi([a, b]), new Set([first.key]));
    expect(rest.entries).toHaveLength(1);
    expect(rest.entries[0].key).not.toBe(first.key);
  });

  it('con un aviso viejo (más de 48 h) no sale', () => {
    expect(buildBell(multi([inc({ t: NOW - 49 * HOUR })]), new Set()).entries).toEqual([]);
  });
});
