import { useState } from 'react';
import type { Fault, LabApi, WifiSim } from '@/data/api';
import { useDerived, useSnapshot } from '@/data/hooks';
import { Button } from '@/ui/Button';
import { Segmented } from '@/ui/Segmented';
import { Stepper } from '@/ui/Stepper';
import { useToast } from '@/ui/toastContext';
import { SettingRow, SettingsSection } from './SettingRow';

const WIFI_STATES: { value: WifiSim; label: string }[] = [
  { value: 'connected', label: 'Conectada' },
  { value: 'offline', label: 'Sin conexión' },
  { value: 'reset', label: 'Reseteada, espera red' },
];

/** Escenarios de la placa y del sensor. */
const FAULTS: { value: Fault; label: string }[] = [
  { value: 'none', label: 'Normal' },
  { value: 'bad-sensor', label: 'Saturado en 4095' },
  { value: 'sensor-noise', label: 'Falla por ruido' },
  { value: 'sensor-low', label: 'Lectura muy baja' },
  { value: 'offline', label: 'Offline hace 10 min' },
  { value: 'recent-reset', label: 'Reinicio reciente' },
  { value: 'api-error', label: 'Servidor caído' },
];

/** Controles de los datos de prueba. Solo se muestran mientras no haya backend. */
export function SimulationTab({ lab }: { lab: LabApi }) {
  const snapshot = useSnapshot();
  const { reading } = useDerived();
  const toast = useToast();
  const [target, setTarget] = useState(() => Math.round(reading?.moisture ?? 40));

  return (
    <div>
      <p className="mb-5 text-sm text-ink-2">
        Los datos son simulados porque todavía no hay backend. Estos controles mueven el reloj y provocan fallas para
        ver cómo reacciona el tablero. Las reglas de riego son las mismas que va a usar el servidor.
      </p>

      <SettingsSection title="Adelantar el tiempo">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => lab.advanceToNextReading()}>Próxima lectura</Button>
          <Button onClick={() => lab.advance(1)}>+1 hora</Button>
          <Button onClick={() => lab.advance(6)}>+6 horas</Button>
          <Button onClick={() => lab.advance(24)}>+1 día</Button>
        </div>
      </SettingsSection>

      <SettingsSection title="Humedad de la tierra">
        <SettingRow label="Humedad real" hint="Fija la humedad y toma una lectura en el momento.">
          <div className="flex items-center gap-2">
            <Stepper
              label="humedad real de la tierra"
              display={`${target} %`}
              value={target}
              min={0}
              max={100}
              step={5}
              onChange={setTarget}
            />
            <Button onClick={() => lab.forceMoisture(target)}>Aplicar</Button>
          </div>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Wi-Fi de la placa">
        <Segmented
          label="Estado del wifi"
          value={lab.wifi}
          options={WIFI_STATES}
          onChange={(w) => lab.setWifi(w)}
        />
        <p className="mt-3 text-sm text-ink-2">
          {lab.wifi === 'connected' && 'La placa está conectada y reporta con normalidad.'}
          {lab.wifi === 'offline' &&
            'La placa dejó de reportar (por ejemplo, cambiaste de router). Aparece el cartel con los pasos para cargar el wifi.'}
          {lab.wifi === 'reset' &&
            'La placa olvidó su red con el botón IO0 y espera una nueva. Aparece el cartel con los pasos para cargar el wifi.'}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button onClick={() => lab.reconnectWifi()} disabled={lab.wifi === 'connected'}>
            Conectar con otra red
          </Button>
        </div>
        <p className="mt-2 text-xs text-ink-3">
          Simula que le cargaste un wifi nuevo: la placa vuelve a reportar, el cartel se va y la campana avisa
          “Wi-Fi actualizado”.
        </p>
      </SettingsSection>

      <SettingsSection title="Escenario de la placa y del sensor">
        {/* Son muchas opciones: en pantallas angostas se desliza de costado en vez de romper el ancho. */}
        <div className="thin-scroll -mx-1 max-w-full overflow-x-auto px-1 pb-1">
          <Segmented label="Escenario simulado" value={lab.fault} options={FAULTS} onChange={(f) => lab.setFault(f)} />
        </div>
        <p className="mt-3 text-sm text-ink-2">
          {lab.fault === 'none' && 'Todo funciona con normalidad: la placa reporta y el sensor funciona.'}
          {lab.fault === 'bad-sensor' &&
            'La lectura llega al máximo (4095): no es una falla del sensor, casi siempre las púas no tocan la tierra o falla el cable AO.'}
          {lab.fault === 'sensor-noise' && 'El sensor informa una falla: la señal tiene ruido y los valores saltan sin sentido.'}
          {lab.fault === 'sensor-low' && 'El sensor informa una falla: la lectura es muy baja (sensor desconectado o en corto).'}
          {lab.fault === 'offline' &&
            'La placa no reporta: el servidor la da por desconectada desde hace 10 minutos. Se ve "Sin conexión desde hace 10 min" y "Sin datos recientes".'}
          {lab.fault === 'recent-reset' &&
            'La placa se reinició hace 2 minutos (baja tensión) y tuvo envíos fallidos: se ven los reinicios y los envíos fallidos en los errores de comunicación.'}
          {lab.fault === 'api-error' && 'La pantalla no puede hablar con el servidor: no deja regar ni cambiar ajustes.'}
        </p>
      </SettingsSection>

      <SettingsSection title="Datos de prueba">
        <SettingRow label="Empezar de nuevo" hint="Vuelve a generar el historial y a los ajustes de fábrica.">
          <Button
            variant="danger"
            onClick={() => {
              lab.reset();
              toast.show('info', 'Se restablecieron los datos de prueba.');
            }}
          >
            Restablecer
          </Button>
        </SettingRow>
        {snapshot.isDemo && <p className="mt-3 text-xs text-ink-3">Los ajustes se guardan en este navegador.</p>}
      </SettingsSection>
    </div>
  );
}
