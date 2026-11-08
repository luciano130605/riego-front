import { WIFI } from '@/core/copy';
import { groupCycles } from '@/core/cycles';
import { formatDuration, HOUR_MS } from '@/core/format';
import { isSaneRaw } from '@/core/moisture';
import type { Snapshot } from '@/core/types';

export type LogKind = 'water-auto' | 'water-manual' | 'dry' | 'recovered' | 'fault' | 'back' | 'wifi';

export type LogEntry = { t: number; kind: LogKind; text: string };

/**
 * Arma el registro de actividad a partir de la foto del sistema: riegos,
 * cruces del umbral y problemas del sensor. Del más nuevo al más viejo.
 */
export function buildLog(s: Snapshot, limit = 60): LogEntry[] {
  const out: LogEntry[] = [];
  const { thresholdPct: th } = s.settings;
  const gapMs = s.device.readEveryMin * 60_000 * 3;

  // Las tandas de un mismo riego se muestran juntas, con la hora en que empezó.
  const cycles = groupCycles(
    s.events.filter((e) => e.t <= s.now),
    s.device.readEveryMin,
  );
  for (const c of cycles) {
    const stages = c.pulses > 1 ? ` en ${c.pulses} tandas` : '';
    out.push({
      t: c.start,
      kind: c.source === 'auto' ? 'water-auto' : 'water-manual',
      text:
        c.source === 'auto'
          ? `Riego automático, ${c.seconds} s${stages}`
          : `Riego a mano, ${c.seconds} s`,
    });
  }

  const readings = s.readings.filter((r) => r.t <= s.now);
  let prev: (typeof readings)[number] | undefined;
  for (const r of readings) {
    const ok = isSaneRaw(r.raw);
    if (prev) {
      const prevOk = isSaneRaw(prev.raw);
      if (r.t - prev.t > gapMs) {
        out.push({
          t: r.t,
          kind: 'back',
          text: `Volvieron las lecturas tras ${formatDuration((r.t - prev.t) / HOUR_MS)} sin datos`,
        });
      }
      if (!ok && prevOk) {
        out.push({ t: r.t, kind: 'fault', text: `El sensor dio un valor imposible (${r.raw})` });
      } else if (ok && !prevOk) {
        out.push({ t: r.t, kind: 'back', text: 'El sensor volvió a dar valores normales' });
      } else if (ok && prevOk) {
        if (prev.moisture >= th && r.moisture < th) {
          out.push({ t: r.t, kind: 'dry', text: `La humedad bajó de ${th} %` });
        } else if (prev.moisture < th && r.moisture >= th) {
          out.push({ t: r.t, kind: 'recovered', text: `La humedad volvió a superar ${th} %` });
        }
      }
    }
    prev = r;
  }

  // Si dejaron de llegar lecturas, se marca el momento en que se dio por caído.
  if (prev) {
    const lostAt = prev.t + gapMs;
    if (lostAt <= s.now) {
      out.push({ t: lostAt, kind: 'fault', text: 'El sensor dejó de enviar datos' });
    }
  }

  // La placa se conectó con otra red. El servidor también anota el borrado de la red (`wifiResetAt`): ese todavía
  // no es "actualizado", hasta que no vuelva a conectarse.
  const { lastWifiChange, wifiResetAt, ssid } = s.device;
  if (lastWifiChange !== undefined && lastWifiChange <= s.now && wifiResetAt === undefined) {
    out.push({ t: lastWifiChange, kind: 'wifi', text: WIFI.updated(ssid) });
  }

  return out.sort((a, b) => b.t - a.t).slice(0, limit);
}
