import { SOAK_MIN } from '@/core/cycles';
import { AVISO } from '@/core/copy';
import { formatSeconds } from '@/core/format';
import type { Settings } from '@/core/types';
import { useRelayMode, useSnapshot } from '@/data/hooks';
import { Segmented } from '@/ui/Segmented';
import { Stepper } from '@/ui/Stepper';
import { Switch } from '@/ui/Switch';
import { SettingRow, SettingsSection } from './SettingRow';

type Props = { save: (patch: Partial<Settings>, okMessage?: string) => Promise<boolean> };

export function AutomationTab({ save }: Props) {
  const { settings: s } = useSnapshot();
  const until = s.mode === 'until-target';
  const aviso = useRelayMode() === 'aviso';

  if (aviso) {
    // Sin regador conectado no hay nada que regar solo: solo se configuran los avisos.
    return (
      <div>
        <SettingsSection title="Avisos">
          <SettingRow label={AVISO.switchLabel} hint={AVISO.line}>
            <Switch
              checked={s.auto}
              label={AVISO.switchAria}
              onChange={(auto) => void save({ auto }, auto ? AVISO.on : AVISO.off)}
            />
          </SettingRow>
        </SettingsSection>

        <SettingsSection title="Cuándo avisar">
          <SettingRow label="Avisar cuando baje de" hint="La humedad que dispara el aviso.">
            <Stepper
              label="humedad que dispara el aviso"
              display={`${s.thresholdPct} %`}
              value={s.thresholdPct}
              min={10}
              max={70}
              onChange={(thresholdPct) => void save({ thresholdPct })}
            />
          </SettingRow>
          <SettingRow label="Humedad objetivo" hint="Hasta cuánto conviene regar a mano. Se muestra en el aviso.">
            <Stepper
              label="humedad objetivo"
              display={`${s.targetPct} %`}
              value={s.targetPct}
              min={s.thresholdPct + 5}
              max={95}
              onChange={(targetPct) => void save({ targetPct })}
            />
          </SettingRow>
        </SettingsSection>

        <p className="mt-5 text-sm text-ink-3">
          El riego automático (modo, tandas, tope de seguridad y límites) se configura cuando haya un regador
          conectado.
        </p>
      </div>
    );
  }

  return (
    <div>
      <SettingsSection title="Riego automático">
        <SettingRow
          label="Regar solo"
          hint="Riega cuando la tierra lo necesita. Apagado, solo riega con “Regar ahora”."
        >
          <Switch
            checked={s.auto}
            label="Riego automático"
            onChange={(auto) =>
              void save({ auto }, auto ? 'Riego automático activado.' : 'Riego automático apagado.')
            }
          />
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Cuánto regar">
        <div className="pb-4">
          <Segmented
            label="Forma de regar"
            value={s.mode}
            onChange={(mode) => void save({ mode })}
            options={[
              { value: 'until-target', label: 'Hasta llegar al objetivo' },
              { value: 'fixed', label: 'Tiempo fijo' },
            ]}
          />
          <p className="mt-3 text-sm text-ink-2">
            {until
              ? `Riega en tandas de ${formatSeconds(s.waterSeconds)} y espera ${SOAK_MIN} min entre una y otra para que el agua se reparta y el sensor la mida. Sigue hasta llegar a ${s.targetPct} %, sin pasar de ${formatSeconds(s.maxCycleSeconds)} de bomba en total.`
              : `Cada riego dura ${formatSeconds(s.waterSeconds)}, sin importar cuánto suba la humedad.`}
          </p>
        </div>

        <SettingRow label="Empezar a regar cuando baje de" hint="La humedad que dispara el riego.">
          <Stepper
            label="humedad que dispara el riego"
            display={`${s.thresholdPct} %`}
            value={s.thresholdPct}
            min={10}
            max={70}
            onChange={(thresholdPct) => void save({ thresholdPct })}
          />
        </SettingRow>

        {until ? (
          <>
            <SettingRow
              label="Regar hasta llegar a"
              hint="Cuando la lectura alcanza este valor, el riego termina."
            >
              <Stepper
                label="humedad objetivo"
                display={`${s.targetPct} %`}
                value={s.targetPct}
                min={s.thresholdPct + 5}
                max={95}
                onChange={(targetPct) => void save({ targetPct })}
              />
            </SettingRow>
            <SettingRow
              label="Duración de cada tanda"
              hint={`Con “Hasta llegar al objetivo” el riego sigue hasta llegar a ${s.targetPct} %, así que la duración no se fija acá. “Regar ahora” sigue regando ${formatSeconds(s.waterSeconds)}.`}
            >
              <Stepper
                label="duración de cada tanda"
                disabled
                display="Hasta el objetivo"
                value={s.waterSeconds}
                min={1}
                max={60}
                onChange={(waterSeconds) => void save({ waterSeconds })}
              />
            </SettingRow>
            <SettingRow
              label="Tope de seguridad por riego"
              hint="Si no llega al objetivo, corta acá. Evita que riegue sin parar si el sensor falla."
            >
              <Stepper
                label="tope de bomba por riego"
                display={formatSeconds(s.maxCycleSeconds)}
                value={s.maxCycleSeconds}
                min={s.waterSeconds}
                max={300}
                // De a 5 s hasta el minuto y de a 15 s desde ahí (en minutos y cuartos).
                stepFor={(v, dir) => (dir > 0 ? (v < 60 ? 5 : 15) : v <= 60 ? 5 : 15)}
                onChange={(maxCycleSeconds) => void save({ maxCycleSeconds })}
              />
            </SettingRow>
          </>
        ) : (
          <SettingRow label="Duración del riego" hint="También es lo que dura “Regar ahora”.">
            <Stepper
              label="duración del riego"
              display={formatSeconds(s.waterSeconds)}
              value={s.waterSeconds}
              min={1}
              max={60}
              onChange={(waterSeconds) => void save({ waterSeconds })}
            />
          </SettingRow>
        )}
      </SettingsSection>

      <SettingsSection title="Límites">
        <SettingRow
          label="Máximo de riegos por día"
          hint={
            s.maxPerDay === null
              ? `Sin tope: riega los que hagan falta. Se sigue respetando una espera de ${s.minIntervalHours} h entre riegos.`
              : 'Cuenta riegos completos, no tandas. Los riegos a mano también suman.'
          }
        >
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Segmented
              label="Máximo de riegos por día"
              value={s.maxPerDay === null ? 'all' : 'limit'}
              onChange={(v) => void save({ maxPerDay: v === 'all' ? null : 2 })}
              options={[
                { value: 'all', label: 'Los necesarios' },
                { value: 'limit', label: 'Limitar' },
              ]}
            />
            {s.maxPerDay !== null && (
              <Stepper
                label="máximo de riegos por día"
                display={`${s.maxPerDay} por día`}
                value={s.maxPerDay}
                min={1}
                max={6}
                onChange={(maxPerDay) => void save({ maxPerDay })}
              />
            )}
          </div>
        </SettingRow>
        {s.maxPerDay !== null && (
          <SettingRow
            label="Espera mínima entre riegos"
            hint="Se cuenta desde el último riego, aunque la tierra siga seca."
          >
            <Stepper
              label="espera mínima entre riegos"
              display={`${s.minIntervalHours} h`}
              value={s.minIntervalHours}
              min={2}
              max={48}
              onChange={(minIntervalHours) => void save({ minIntervalHours })}
            />
          </SettingRow>
        )}
      </SettingsSection>
    </div>
  );
}
