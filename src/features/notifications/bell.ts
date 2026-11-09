import { buildLog, type LogEntry, type LogKind } from '@/features/log/buildLog';
import type { Incident, Snapshot } from '@/core/types';
import { nightSummaryLines } from './nightSummary';

export const ALERT_KINDS: LogKind[] = ['dry', 'recovered', 'fault', 'back', 'wifi'];
export const WINDOW_MS = 48 * 3_600_000;
const MAX_ENTRIES = 8;
/** Un aviso silenciado se une con la entrada de la campana si salió a menos de esto (las lecturas llegan cada 15 min). */
const MATCH_MS = 30 * 60_000;

/** Qué tipos de aviso del servidor corresponden a cada entrada de la campana. */
const INCIDENT_KINDS: Partial<Record<LogKind, string[]>> = {
  dry: ['humedad-baja', 'necesita-riego'],
  recovered: ['humedad-recuperada'],
  fault: ['placa-offline', 'sensor-sospechoso'],
  back: ['placa-vuelve'],
};

export type BellEntry = LogEntry & {
  key: string;
  silenced: boolean;
  /** De qué planta es el aviso: "Monstera · Interior". Los de la placa o el regador no la tienen. */
  where?: string;
};
export type BellSummary = { key: string; t: number; lines: string[] };
export type BellView = { summary?: BellSummary; entries: BellEntry[] };

/** Qué entrada de la campana es cada tipo de aviso del servidor (los demás no van en la campana). */
const KIND_OF_INCIDENT: Record<string, LogKind> = {
  'humedad-baja': 'dry',
  'necesita-riego': 'dry',
  'humedad-recuperada': 'recovered',
  'placa-offline': 'fault',
  'sensor-sospechoso': 'fault',
  'placa-vuelve': 'back',
};

const whereOf = (n: Pick<Incident, 'plantName' | 'sectorName'>): string | undefined =>
  n.plantName ? (n.sectorName ? `${n.plantName} · ${n.sectorName}` : n.plantName) : undefined;

export const entryKey = (e: Pick<LogEntry, 'kind' | 'text' | 't'>): string => `${e.kind}-${e.t}`;

/** El aviso silenciado del servidor que corresponde a esta entrada, si hay uno (cada aviso se usa una sola vez). */
function silencedFor(e: LogEntry, pool: Incident[]): boolean {
  const kinds = INCIDENT_KINDS[e.kind];
  if (!kinds) return false;
  const i = pool.findIndex((n) => n.silenced === true && kinds.includes(n.kind) && Math.abs(n.t - e.t) <= MATCH_MS);
  if (i < 0) return false;
  pool.splice(i, 1);
  return true;
}

/**
 * Lo que muestra la campana: el resumen de la noche arriba de todo (si hay uno reciente y no se descartó) y los
 * avisos de los últimos dos días, con la marca de los que salieron silenciados. Lo descartado en este navegador no sale.
 */
export function buildBell(snapshot: Snapshot, dismissed: ReadonlySet<string>): BellView {
  const incidents = snapshot.incidents ?? [];
  const pool = incidents.filter((n) => n.silenced === true);

  // Con sectores y plantas, el registro armado en la pantalla solo vería UNA planta: los avisos son los que registra el
  // servidor, cada uno con su planta y su sector. Sin ellos (backend viejo) se arma como siempre.
  const entries: BellEntry[] =
    snapshot.plants !== undefined
      ? incidents
          .filter((n) => n.kind in KIND_OF_INCIDENT && n.t <= snapshot.now && snapshot.now - n.t <= WINDOW_MS)
          .map((n): BellEntry => {
            const e = { kind: KIND_OF_INCIDENT[n.kind], text: n.message, t: n.t };
            return { ...e, key: `${n.plantId ?? 'placa'}-${entryKey(e)}`, silenced: n.silenced === true, ...(whereOf(n) ? { where: whereOf(n) } : {}) };
          })
          .filter((e) => !dismissed.has(e.key))
          .sort((a, b) => b.t - a.t)
          .slice(0, MAX_ENTRIES)
      : buildLog(snapshot, 200)
          .filter((e) => ALERT_KINDS.includes(e.kind) && snapshot.now - e.t <= WINDOW_MS)
          .map((e): BellEntry => ({ ...e, key: entryKey(e), silenced: silencedFor(e, pool) }))
          .filter((e) => !dismissed.has(e.key))
          .slice(0, MAX_ENTRIES);

  const latest = incidents
    .filter((n) => n.kind === 'night-summary' && n.summary && n.t <= snapshot.now && snapshot.now - n.t <= WINDOW_MS)
    .sort((a, b) => b.t - a.t)[0];
  const key = latest ? `night-summary-${latest.t}` : undefined;
  const summary =
    latest && key && !dismissed.has(key) ? { key, t: latest.t, lines: nightSummaryLines(latest.summary!) } : undefined;

  return { ...(summary ? { summary } : {}), entries };
}
