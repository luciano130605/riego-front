import { describe, expect, it, vi } from 'vitest';
import { decideWatering } from '@/core/decide';
import { groupCycles } from '@/core/cycles';
import { forecastWatering, latestReading } from '@/core/forecast';
import { deviceView } from '@/core/deviceView';
import { derive } from './derive';
import { MockRiego, sanitizeSettings, DEFAULT_SETTINGS } from './mockRiego';

const H = 3_600_000;

function fresh() {
  return new MockRiego({ loadMs: 0 });
}

describe('MockRiego: estado inicial', () => {
  it('arranca con un mes de lecturas cada 15 minutos', () => {
    const s = fresh().getSnapshot();
    expect(s.isDemo).toBe(true);
    expect(s.load).toBe('ready');
    expect(s.error).toBeUndefined();
    expect(s.readings.length).toBeGreaterThan(2850);
    expect(s.readings.length).toBeLessThan(2910);
    const gaps = s.readings.slice(1).map((r, i) => r.t - s.readings[i].t);
    expect(new Set(gaps)).toEqual(new Set([15 * 60_000]));
    expect(s.device.online).toBe(true);
  });

  it('muestra un estado de partida razonable: ni seca ni encharcada, con riego reciente', () => {
    const api = fresh();
    const s = api.getSnapshot();
    const last = latestReading(s.readings, s.now)!;
    expect(last.moisture).toBeGreaterThan(40);
    expect(last.moisture).toBeLessThan(65);

    const lastWater = s.events[s.events.length - 1];
    const hoursAgo = (s.now - lastWater.t) / H;
    expect(hoursAgo).toBeGreaterThan(30);
    expect(hoursAgo).toBeLessThan(52);
    expect(s.events.length).toBeGreaterThanOrEqual(2);
  });

  it('estima el próximo riego en un par de días', () => {
    const s = fresh().getSnapshot();
    const f = forecastWatering(s.readings, s.events, s.settings.thresholdPct, s.now);
    expect(f.kind).toBe('in');
    if (f.kind === 'in') {
      expect(f.hours).toBeGreaterThan(24);
      expect(f.hours).toBeLessThan(72);
    }
  });
});

describe('MockRiego: simulación', () => {
  it('adelantar el reloj seca la tierra y dispara el riego automático', () => {
    const api = fresh();
    const since = api.now();
    api.advance(24 * 3);
    const s = api.getSnapshot();
    const added = s.events.filter((e) => e.t > since);
    expect(added.length).toBeGreaterThan(0);
    expect(added.every((e) => e.source === 'auto')).toBe(true);
  });

  it('con el automático apagado no riega solo, aunque se seque', () => {
    const api = fresh();
    api.updateSettings({ auto: false });
    const since = api.now();
    api.advance(24 * 6);
    const s = api.getSnapshot();
    expect(s.events.filter((e) => e.t > since)).toHaveLength(0);
    const last = latestReading(s.readings, s.now)!;
    expect(last.moisture).toBeLessThan(s.settings.thresholdPct);
  });

  it('forzar poca humedad toma una lectura y riega en el momento', () => {
    const api = fresh();
    api.advance(12); // deja pasar el intervalo mínimo desde el último riego
    const since = api.now();
    api.forceMoisture(15);
    const s = api.getSnapshot();
    expect(latestReading(s.readings, s.now)!.moisture).toBeLessThan(20);
    expect(s.events.filter((e) => e.t >= since)).toHaveLength(1);
  });

  it('regar a mano suma un evento manual y rechaza el doble toque', () => {
    const api = fresh();
    const before = api.getSnapshot().events.length;
    api.waterNow();
    api.waterNow();
    const s = api.getSnapshot();
    expect(s.events).toHaveLength(before + 1);
    expect(s.events[s.events.length - 1].source).toBe('manual');
  });

  it('el agua llega al sensor de a poco, no de golpe', () => {
    const api = fresh();
    api.forceMoisture(20);
    api.updateSettings({ auto: false });
    api.waterNow();
    const snap = () => api.getSnapshot();
    const read = () => latestReading(snap().readings, snap().now)!.moisture;
    const m0 = read();
    api.advanceToNextReading();
    const m1 = read();
    api.advanceToNextReading();
    const m2 = read();
    api.advanceToNextReading();
    const m3 = read();
    expect(m1).toBeGreaterThan(m0 + 5);
    expect(m2).toBeGreaterThan(m1);
    expect(m3 - m2).toBeLessThan(m1 - m0);
  });

  it('un sensor desconectado deja de regar y se marca como valor imposible', () => {
    const api = fresh();
    api.advance(6);
    api.setFault('bad-sensor');
    api.advanceToNextReading();
    const s = api.getSnapshot();
    const last = latestReading(s.readings, s.now)!;
    const d = decideWatering({
      reading: last,
      settings: s.settings,
      events: s.events,
      now: s.now,
      readEveryMin: 15,
    });
    expect(d.reason).toBe('bad-sensor');
  });

  it('sin conexión no llegan lecturas y el dispositivo figura caído', () => {
    const api = fresh();
    api.setFault('offline');
    const n = api.getSnapshot().readings.length;
    api.advance(2);
    const s = api.getSnapshot();
    expect(s.readings.length).toBe(n);
    expect(s.device.online).toBe(false);
  });

  it('recalibrar cambia los porcentajes de todo el historial', () => {
    const api = fresh();
    const s0 = api.getSnapshot();
    const m0 = latestReading(s0.readings, s0.now)!.moisture;
    api.updateSettings({ rawDry: 3300 });
    const s1 = api.getSnapshot();
    const m1 = latestReading(s1.readings, s1.now)!.moisture;
    expect(m1).not.toBeCloseTo(m0, 0);
  });

  it('restablecer vuelve al estado de partida', () => {
    const api = fresh();
    api.advance(48);
    api.updateSettings({ thresholdPct: 50 });
    api.reset();
    const s = api.getSnapshot();
    expect(s.settings).toEqual(DEFAULT_SETTINGS);
    expect(s.readings.length).toBeLessThan(2910);
  });
});

describe('MockRiego: riego hasta el objetivo', () => {
  it('riega en tandas con pausa y se detiene al llegar a la humedad objetivo', () => {
    const api = fresh();
    api.advance(12); // deja pasar el intervalo mínimo desde el último riego
    const since = api.now();
    api.forceMoisture(25);
    api.advance(8);
    const s = api.getSnapshot();
    const added = s.events.filter((e) => e.t >= since);
    expect(added.length).toBeGreaterThanOrEqual(2);
    expect(added.every((e) => e.source === 'auto')).toBe(true);
    expect(added.reduce((sum, e) => sum + e.seconds, 0)).toBeLessThanOrEqual(s.settings.maxCycleSeconds);

    // Las tandas son un solo riego y entre una y otra hay una pausa.
    const cycles = groupCycles(added, s.device.readEveryMin);
    expect(cycles).toHaveLength(1);
    const gaps = added.slice(1).map((e, i) => e.t - added[i].t);
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(40 * 60_000);

    const last = latestReading(s.readings, s.now)!;
    expect(last.moisture).toBeGreaterThanOrEqual(s.settings.targetPct - 3);
  });

  it('con tope de seguridad bajo corta el riego aunque no llegue al objetivo', () => {
    const api = fresh();
    api.updateSettings({ maxCycleSeconds: 5, waterSeconds: 5, targetPct: 90 });
    api.advance(12);
    const since = api.now();
    api.forceMoisture(20);
    api.advance(6);
    const added = api.getSnapshot().events.filter((e) => e.t >= since);
    expect(added).toHaveLength(1);
  });
});

describe('MockRiego: carga y errores de comunicación', () => {
  it('arranca cargando y pasa a listo', () => {
    vi.useFakeTimers();
    try {
      const api = new MockRiego({ loadMs: 600 });
      expect(api.getSnapshot().load).toBe('loading');
      vi.advanceTimersByTime(650);
      expect(api.getSnapshot().load).toBe('ready');
    } finally {
      vi.useRealTimers();
    }
  });

  it('si falla la comunicación muestra lo último conocido con el error y rechaza acciones', async () => {
    const api = fresh();
    const before = api.getSnapshot();
    api.setFault('api-error');
    api.advance(2);
    const s = api.getSnapshot();
    expect(s.error).toBeTruthy();
    expect(s.readings).toEqual(before.readings);
    expect(s.now).toBeGreaterThan(before.now);
    expect(s.device.online).toBe(false);

    const water = await api.waterNow();
    const save = await api.updateSettings({ thresholdPct: 20 });
    expect(water.ok).toBe(false);
    expect(save.ok).toBe(false);
    expect(api.getSnapshot().settings.thresholdPct).toBe(before.settings.thresholdPct);

    api.setFault('none');
    const back = api.getSnapshot();
    expect(back.error).toBeUndefined();
    expect(back.readings.length).toBeGreaterThan(before.readings.length);
    expect((await api.waterNow()).ok).toBe(true);
  });

  it('rechaza el doble toque de riego a mano con un mensaje', async () => {
    const api = fresh();
    expect((await api.waterNow()).ok).toBe(true);
    const second = await api.waterNow();
    expect(second.ok).toBe(false);
  });
});

describe('sanitizeSettings', () => {
  it('limita los valores a rangos razonables', () => {
    const s = sanitizeSettings(DEFAULT_SETTINGS, {
      thresholdPct: 999,
      waterSeconds: 0,
      minIntervalHours: 0,
      maxPerDay: 99,
    });
    expect(s.thresholdPct).toBe(70);
    expect(s.waterSeconds).toBe(1);
    expect(s.minIntervalHours).toBe(2);
    expect(s.maxPerDay).toBe(6);
  });

  it('el objetivo queda siempre al menos 5 puntos arriba del umbral', () => {
    const a = sanitizeSettings(DEFAULT_SETTINGS, { targetPct: 30 });
    expect(a.targetPct).toBe(DEFAULT_SETTINGS.thresholdPct + 5);
    const b = sanitizeSettings(DEFAULT_SETTINGS, { thresholdPct: 60 });
    expect(b.targetPct).toBe(65);
    expect(sanitizeSettings(DEFAULT_SETTINGS, { targetPct: 200 }).targetPct).toBe(95);
  });

  it('el tope por riego nunca es menor que una tanda', () => {
    const s = sanitizeSettings(DEFAULT_SETTINGS, { waterSeconds: 20, maxCycleSeconds: 5 });
    expect(s.maxCycleSeconds).toBe(20);
  });

  it('el máximo por día puede ser "los necesarios" (null) y vuelve a tener tope', () => {
    expect(DEFAULT_SETTINGS.maxPerDay).toBeNull();
    const limited = sanitizeSettings(DEFAULT_SETTINGS, { maxPerDay: 2 });
    expect(limited.maxPerDay).toBe(2);
    expect(sanitizeSettings(limited, { maxPerDay: null }).maxPerDay).toBeNull();
    // Si no viene en el parche, no se toca.
    expect(sanitizeSettings(limited, { thresholdPct: 30 }).maxPerDay).toBe(2);
  });

  it('solo acepta los modos conocidos', () => {
    expect(sanitizeSettings(DEFAULT_SETTINGS, { mode: 'fixed' }).mode).toBe('fixed');
    expect(sanitizeSettings(DEFAULT_SETTINGS, { mode: 'otro' as never }).mode).toBe('until-target');
  });

  it('rechaza una calibración con puntos casi iguales', () => {
    const s = sanitizeSettings(DEFAULT_SETTINGS, { rawDry: 2000, rawWet: 2050 });
    expect(s.rawDry).toBe(DEFAULT_SETTINGS.rawDry);
    expect(s.rawWet).toBe(DEFAULT_SETTINGS.rawWet);
  });

  it('ignora lo que no es número', () => {
    const s = sanitizeSettings(DEFAULT_SETTINGS, { thresholdPct: NaN });
    expect(s.thresholdPct).toBe(DEFAULT_SETTINGS.thresholdPct);
  });
});

describe('MockRiego: decisiones guardadas', () => {
  it('cada lectura lleva la decisión que se tomó, y riega exactamente cuando decide regar', () => {
    const s = fresh().getSnapshot();
    expect(s.readings.every((r) => r.decision !== undefined)).toBe(true);
    const watered = s.readings.filter((r) => r.decision?.water);
    expect(watered.length).toBeGreaterThan(0);
    // Cada decisión de regar tiene su evento automático en el mismo instante.
    for (const r of watered) expect(s.events.some((e) => e.t === r.t && e.source === 'auto')).toBe(true);
  });
});

describe('MockRiego: prueba del regador', () => {
  it('prende el regador sin crear un evento de riego ni tocar el historial', async () => {
    const api = fresh();
    const before = api.getSnapshot();
    expect(await api.testRelay(2)).toEqual({ ok: true });
    const after = api.getSnapshot();
    expect(after.events).toHaveLength(before.events.length);
    expect(after.readings).toHaveLength(before.readings.length);
    expect(await api.relayStatus()).toMatchObject({ ok: true, online: true, on: true, simulated: false });
  });

  it('no deja probar dos veces seguidas ni segundos inválidos o por encima del tope', async () => {
    const api = fresh();
    expect(await api.testRelay(2)).toEqual({ ok: true });
    expect(await api.testRelay(2)).toMatchObject({ ok: false });
    const other = fresh();
    expect(await other.testRelay(0)).toMatchObject({ ok: false });
    expect(await other.testRelay(2.5)).toMatchObject({ ok: false });
    expect(await other.testRelay(61)).toMatchObject({ ok: false });
  });

  it('el regador vuelve a apagado cuando pasan los segundos', async () => {
    vi.useFakeTimers();
    try {
      const api = fresh();
      await api.testRelay(2);
      expect(await api.relayStatus()).toMatchObject({ on: true });
      vi.advanceTimersByTime(2500);
      expect(await api.relayStatus()).toMatchObject({ ok: true, on: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('si la pantalla no puede hablar con el servidor, la prueba y el estado fallan con un motivo', async () => {
    const api = fresh();
    api.setFault('api-error');
    expect(await api.testRelay(2)).toMatchObject({ ok: false });
    expect(await api.relayStatus()).toMatchObject({ ok: false });
  });
});

describe('MockRiego: calibración', () => {
  it('startCalibration activa la calibración con lecturas que se mueven, sin tocar el historial', async () => {
    vi.useFakeTimers();
    try {
      const api = fresh();
      const unsub = api.subscribe(() => {});
      const before = api.getSnapshot();
      expect(before.device.calibration).toBeUndefined();
      expect(await api.startCalibration()).toEqual({ ok: true });
      vi.advanceTimersByTime(62_000); // 13 lecturas, una cada 5 s
      const s = api.getSnapshot();
      expect(s.device.calibration?.active).toBe(true);
      expect(s.device.calibration!.until - s.now).toBeGreaterThan(13 * 60_000); // dura 15 min
      const recent = s.device.calibration!.recent;
      expect(recent.length).toBe(13);
      // Al principio el valor se mueve (viaja de la tierra al aire).
      expect(new Set(recent.slice(0, 3)).size).toBeGreaterThan(1);
      // El historial no se toca.
      expect(s.readings).toHaveLength(before.readings.length);
      expect(s.events).toHaveLength(before.events.length);
      unsub();
    } finally {
      vi.useRealTimers();
    }
  });

  it('el sensor simulado pasa por el aire (estable y alto) y por el agua (estable y bajo)', async () => {
    vi.useFakeTimers();
    try {
      const api = fresh();
      const unsub = api.subscribe(() => {});
      await api.startCalibration();
      vi.advanceTimersByTime(60_000); // lectura 12 de 28: las últimas 10 son del tramo en el aire
      const air = api.getSnapshot().device.calibration!.recent.slice(-10);
      vi.advanceTimersByTime(65_000); // lectura 25: las últimas 10 son del tramo en el agua
      const water = api.getSnapshot().device.calibration!.recent.slice(-10);
      const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
      expect(Math.max(...air) - Math.min(...air)).toBeLessThan(80);
      expect(Math.max(...water) - Math.min(...water)).toBeLessThan(80);
      expect(avg(air) - avg(water)).toBeGreaterThan(1500);
      unsub();
    } finally {
      vi.useRealTimers();
    }
  });

  it('con la placa sin conexión no llegan lecturas y la pantalla lo nota a los 15 s', async () => {
    vi.useFakeTimers();
    try {
      const api = fresh();
      const unsub = api.subscribe(() => {});
      await api.startCalibration();
      vi.advanceTimersByTime(21_000);
      expect(api.getSnapshot().device.calibration!.recent.length).toBe(5);
      expect(derive(api.getSnapshot()).reporting).toBe(true);
      api.setWifi('offline'); // la placa se cae: el reloj avanza y no llega ninguna lectura más
      expect(api.getSnapshot().device.calibration!.recent.length).toBe(5);
      expect(derive(api.getSnapshot()).reporting).toBe(false);
      unsub();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['bad-sensor', 'high', (raw: number) => raw === 4095],
    ['sensor-low', 'low', (raw: number) => raw < 100],
  ] as const)('con la falla %s las lecturas de la calibración son de esa falla y se informa "%s"', async (fault, reason, isFault) => {
    vi.useFakeTimers();
    try {
      const api = fresh();
      const unsub = api.subscribe(() => {});
      api.setFault(fault);
      await api.startCalibration();
      vi.advanceTimersByTime(31_000);
      const cal = api.getSnapshot().device.calibration!;
      expect(cal.recent.length).toBeGreaterThanOrEqual(6);
      expect(cal.recent.every(isFault)).toBe(true);
      expect(api.getSnapshot().device.sensor).toEqual({ ok: false, reason });
      unsub();
    } finally {
      vi.useRealTimers();
    }
  });

  it('stopCalibration la corta y la placa vuelve a su ritmo', async () => {
    const api = fresh();
    await api.startCalibration();
    expect(api.getSnapshot().device.calibration?.active).toBe(true);
    expect(await api.stopCalibration()).toEqual({ ok: true });
    expect(api.getSnapshot().device.calibration).toBeUndefined();
  });

  it('informa firmware y tiempo encendida', () => {
    const d = fresh().getSnapshot().device;
    expect(d.fw).toBeTruthy();
    expect(d.uptimeSec).toBeGreaterThan(86_400);
    expect(d.lastRaw).toBe(fresh().getSnapshot().readings.at(-1)!.raw);
  });

  it('con el servidor caído falla con un motivo', async () => {
    const api = fresh();
    api.setFault('api-error');
    expect(await api.startCalibration()).toMatchObject({ ok: false });
    expect(await api.stopCalibration()).toMatchObject({ ok: false });
  });
});


describe('MockRiego: estado del sensor', () => {
  it('con el sensor sano informa que funciona', () => {
    expect(fresh().getSnapshot().device.sensor).toEqual({ ok: true });
  });

  it.each([
    ['bad-sensor', 'high'],
    ['sensor-low', 'low'],
    ['sensor-noise', 'noise'],
  ] as const)('el escenario %s informa la falla "%s" y no riega con ese dato', (fault, reason) => {
    const api = fresh();
    const eventsBefore = api.getSnapshot().events.length;
    api.setFault(fault);
    api.advance(6);
    const s = api.getSnapshot();
    expect(s.device.sensor).toEqual({ ok: false, reason });
    expect(s.events).toHaveLength(eventsBefore); // no riega con lecturas de un sensor que falla
    expect(s.readings.at(-1)?.decision).toEqual({ water: false, reason: 'bad-sensor' });
  });

  it('las lecturas con ruido saltan entre valores muy distintos', () => {
    const api = fresh();
    api.setFault('sensor-noise');
    api.advance(6);
    const raws = api.getSnapshot().readings.slice(-12).map((r) => r.raw);
    expect(Math.max(...raws) - Math.min(...raws)).toBeGreaterThan(800);
  });

  it('al quitar la falla y llegar la próxima lectura vuelve a estar bien', () => {
    const api = fresh();
    api.setFault('sensor-low');
    api.advanceToNextReading();
    expect(api.getSnapshot().device.sensor).toMatchObject({ ok: false });
    api.setFault('none');
    api.advanceToNextReading();
    expect(api.getSnapshot().device.sensor).toEqual({ ok: true });
  });
});

describe('MockRiego: wifi de la placa', () => {
  it('conectada: informa la red y el último cambio, y no hay reseteo', () => {
    const d = fresh().getSnapshot().device;
    expect(d.ssid).toBe('MiCasa-2.4G');
    expect(d.lastWifiChange).toBeLessThan(Date.now());
    expect(d.wifiResetAt).toBeUndefined();
  });

  it('sin conexión: deja de reportar y se nota enseguida (el reloj avanza)', () => {
    const api = fresh();
    const before = api.getSnapshot();
    api.setWifi('offline');
    const s = api.getSnapshot();
    expect(s.readings).toHaveLength(before.readings.length);
    expect(derive(s).wifi).toBe('offline');
    expect(s.device.ssid).toBe('MiCasa-2.4G');
  });

  it('reseteada: sin red, con wifiResetAt, y el cambio queda anotado', () => {
    const api = fresh();
    api.setWifi('reset');
    const s = api.getSnapshot();
    expect(derive(s).wifi).toBe('reset');
    expect(s.device.ssid).toBeUndefined();
    expect(s.device.wifiResetAt).toBeDefined();
    expect(s.device.lastWifiChange).toBe(s.device.wifiResetAt);
  });

  it('al conectarse con otra red vuelve a reportar, queda la red nueva y se va el reseteo', () => {
    const api = fresh();
    api.setWifi('reset');
    const n = api.getSnapshot().readings.length;
    api.reconnectWifi('Lo-de-Ana');
    const s = api.getSnapshot();
    expect(s.readings.length).toBe(n + 1);
    expect(s.device.ssid).toBe('Lo-de-Ana');
    expect(s.device.wifiResetAt).toBeUndefined();
    expect(derive(s).wifi).toBe('connected');
  });

  it('volver a "conectada" sin cambiar de red reanuda las lecturas pero no anota un cambio', () => {
    const api = fresh();
    const change = api.getSnapshot().device.lastWifiChange;
    api.setWifi('offline');
    api.setWifi('connected');
    const s = api.getSnapshot();
    expect(derive(s).wifi).toBe('connected');
    expect(s.device.lastWifiChange).toBe(change);
  });
});

describe('MockRiego: escenarios de la placa (hace de backend)', () => {
  it('normal: en línea, con el límite que informa y sin errores de comunicación', () => {
    const d = fresh().getSnapshot().device;
    expect(d.online).toBe(true);
    expect(d.offlineAfterSec).toBe(18 * 60);
    expect(d.sensor).toEqual({ ok: true });
    expect(d.failedPosts).toBeUndefined();
    expect(d.resetReason).toBeUndefined();
  });

  it('saturado en 4095: la placa manda la lectura al máximo y el servidor lo informa como "high"', () => {
    const api = fresh();
    api.setFault('bad-sensor');
    api.advanceToNextReading();
    const s = api.getSnapshot();
    expect(s.readings.at(-1)!.raw).toBe(4095);
    expect(s.device.sensor).toEqual({ ok: false, reason: 'high' });
    expect(s.device.online).toBe(true);
  });

  it('falla de sensor por ruido: informa "noise" y las lecturas saltan', () => {
    const api = fresh();
    api.setFault('sensor-noise');
    api.advance(6);
    expect(api.getSnapshot().device.sensor).toEqual({ ok: false, reason: 'noise' });
  });

  it('offline hace 10 minutos: se ve enseguida y el servidor la da por desconectada desde hace 10 min', () => {
    const api = fresh();
    api.setFault('offline');
    const s = api.getSnapshot();
    expect(s.device.online).toBe(false);
    const view = deviceView(s, s.now);
    expect(view.offlineForMs).toBe(10 * 60_000);
  });

  it('reinicio reciente: motivo del reinicio, envíos fallidos y poco tiempo encendida; al salir del escenario se limpia', () => {
    const api = fresh();
    api.setFault('recent-reset');
    let d = api.getSnapshot().device;
    expect(d.online).toBe(true);
    expect(d.resetReason).toBe('brownout');
    expect(d.failedPosts).toBe(3);
    expect(d.uptimeSec).toBeLessThan(5 * 60);
    api.setFault('none');
    d = api.getSnapshot().device;
    expect(d.resetReason).toBeUndefined();
    expect(d.failedPosts).toBeUndefined();
    expect(d.uptimeSec).toBeGreaterThan(86_400);
  });
});
