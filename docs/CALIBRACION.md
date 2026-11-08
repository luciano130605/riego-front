# Del sensor simulado al real: limpiar y calibrar (LM393 resistivo, salida AO)

En este módulo **más seco da un valor MÁS ALTO**: el seco es el raw alto y el mojado es el raw bajo. El sistema ya
trabaja así (seco = 0 %, mojado = 100 %).

## 1. Que el firmware mande datos reales

En `firmware/config.h` poné `#define SIMULATE 0` y volvé a subirlo (`.\upload.ps1`). Con `SIMULATE 1` el firmware
inventa valores y avisa con `"sim": true`.

**Qué hace el servidor con `sim: true`** (red de seguridad, aunque se te olvide apagar el modo simulado):

- La lectura se guarda **con la marca `sim`**, para poder borrarla después.
- **No cuenta para nada**: no entra al historial ni a los gráficos ni a los promedios, no tiene decisión de riego,
  no dispara riego ni avisos, y tampoco entra a las lecturas de la calibración.
- La placa figura en línea (último contacto, señal, firmware) y `device.sim` es `true` en el snapshot. Con la primera
  lectura real esa marca desaparece sola.

## 2. Borrar las lecturas simuladas: `purge-sim`

```bash
npm run purge-sim                                   # solo cuenta, no borra nada
npm run purge-sim -- --confirm                      # borra las marcadas con sim:true
npm run purge-sim -- --before 2026-11-07            # además cuenta las SIN marca anteriores a esa fecha
npm run purge-sim -- --before 2026-11-07 --confirm  # y las borra también
```

(Desde la raíz del repo o desde `backend/`; usa `backend/.env`, o sea la misma base que el servidor.)

Ojo con las lecturas **de antes de este cambio**: el servidor todavía no guardaba la marca, así que no se pueden
reconocer como simuladas. Para limpiarlas usá `--before` con la fecha en que pasaste a datos reales: borra **todas**
las lecturas anteriores a esa fecha, simuladas o no. Siempre corré primero sin `--confirm` y mirá los números.

## 3. Calibrar (ya existe; no hace falta nada nuevo)

Se hace desde la pantalla: **Configuración → Dispositivo → Calibración del sensor → Empezar calibración**. El asistente:

1. Activa el modo calibración (`POST /api/calibration/start`). La placa pasa a mandar **cada 5 segundos**
   (`calibrating: true`, `nextInSec: 5`). Esas lecturas **no** van al historial.
2. Te pide el **seco** (sensor al aire o en tierra seca) y espera a que el valor se estabilice: toma las últimas 10
   lecturas reales y exige que entre la mayor y la menor haya menos de 80 cuentas. El valor del paso es la **mediana**.
3. Te pide el **mojado** (sensor en un vaso con agua) y hace lo mismo.
4. Guarda `rawDry` y `rawWet` en la configuración (`PUT /api/settings`).

**El servidor valida el par** (la misma regla que la pantalla, `validateCalibration`) y, si no cumple, responde 400 con
el motivo y **no guarda nada**:

- Los dos valores tienen que poder ser tierra (el sensor no puede estar suelto ni en corto).
- **El seco tiene que ser mayor que el mojado** (si salen al revés, repetí los pasos en orden).
- Tienen que diferir en **al menos 300**.

Si cambiás un solo punto a mano, se valida contra el otro que ya está guardado.

**El modo calibración se corta solo a los 15 minutos** (también con `POST /api/calibration/stop`). Pasado el tiempo,
la placa vuelve a su ritmo normal y sus lecturas vuelven a guardarse.

## 4. Cómo se calcula la humedad

En la base **solo se guarda el valor crudo** (`raw`). El porcentaje se calcula **al armar el snapshot**, con la
calibración vigente, y queda limitado a 0–100. Si recalibrás, los datos viejos se recalculan solos.

## Importante con este módulo

La salida AO de un LM393 resistivo suele quedar **cerca del máximo (≈ 4095) con la sonda al aire**. El sistema toma
cualquier valor **mayor a 4000** como "sensor sin conectar / en corto" (firmware, aviso del servidor y pantalla), y la
calibración rechaza valores imposibles. Si tu módulo da ≈ 4095 al aire:

- tomá el **seco con la sonda en tierra seca** (no al aire), o con un trapo seco, hasta que dé menos de 4000; o
- ajustá el potenciómetro del módulo para bajar esa salida; o
- avisá y se suben los umbrales (hay que cambiarlos en el firmware, el servidor y la pantalla a la vez).

Mirá primero el valor crudo que da tu sonda al aire (Configuración → Dispositivo, "Valor crudo del sensor") para
saber en cuál de los casos estás.
