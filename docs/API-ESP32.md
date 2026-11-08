# API para el firmware (ESP32)

Todo lo que la placa necesita saber del backend. La placa **no decide nada**: mide, manda el valor
crudo y obedece cuánto esperar para la próxima lectura.

## Datos de conexión

Los tres van en la configuración del firmware (no los subas a un repo público):

| Dato | Dónde sale |
| --- | --- |
| Wifi (`WIFI_SSID`, `WIFI_PASSWORD`) | Tu router. **Solo redes de 2.4 GHz**: la ESP32 no ve las de 5 GHz. |
| URL del backend | `PUBLIC_URL` (por ejemplo `https://tu-backend.up.railway.app`). Usá `https`. |
| Token | `DEVICE_TOKEN` del backend. |

(`backend/.env` ya trae `WIFI_SSID` y `WIFI_PASSWORD` vacíos para que los completes y los copies al
firmware; el backend no los lee.)

## `POST /api/readings`

Headers:

```
Authorization: Bearer <DEVICE_TOKEN>
Content-Type: application/json
```

Cuerpo:

| Campo | Tipo | Obligatorio | Descripción |
| --- | --- | --- | --- |
| `raw` | entero 0..4095 | sí | Lectura cruda del ADC (12 bits). **Sin promediar ni convertir a %**: eso lo hace el servidor. |
| `rssi` | entero | no | Señal wifi en dBm (por ejemplo `-61`). |
| `fw` | texto, 1 a 32 caracteres | no | Versión del firmware (por ejemplo `"0.3.1"`). |
| `uptimeSec` | entero ≥ 0 | no | Segundos desde que arrancó la placa. |
| `sim` | booleano | no | `true` si los valores son **simulados** (firmware con `SIMULATE 1`). El servidor los guarda con la marca pero no los usa para nada: ni historial, ni decisiones, ni riego (ver `docs/CALIBRACION.md`). |

```bash
curl -X POST https://tu-backend.up.railway.app/api/readings \
  -H "Authorization: Bearer $DEVICE_TOKEN" -H "Content-Type: application/json" \
  -d '{"raw":2150,"rssi":-61,"fw":"0.3.1","uptimeSec":5400}'
```

### Respuesta `200`

```json
{ "ok": true, "serverTime": 1793978878864, "nextInSec": 900, "calibrating": false, "water": false }
```

| Campo | Significado |
| --- | --- |
| `serverTime` | Hora del servidor en ms desde 1970. La placa no necesita reloj propio. |
| `nextInSec` | **Cuántos segundos esperar hasta la próxima lectura. La placa debe obedecerlo.** Normalmente `900` (15 min, según `readEveryMin`); en modo calibración, `5`. |
| `calibrating` | `true` si el modo calibración está activo (ver abajo). |
| `water` | Reservado para el regador automático (Fase 2). Hoy siempre `false`: ignoralo. |

El valor de `nextInSec` puede cambiar de una respuesta a otra: no lo guardes, usá siempre el último.

### Errores

| Código | Cuándo | Qué hacer |
| --- | --- | --- |
| `400` | Cuerpo inválido (falta `raw`, no es entero, fuera de 0..4095, `fw` vacío, etc.). | Es un bug del firmware: no reintentes igual. |
| `401` | Token ausente o incorrecto. | Revisá `DEVICE_TOKEN`. Reintentar no sirve. |
| `503` | La base de datos no responde. La lectura **no** se guardó. | Reintentar (ver abajo). |
| sin respuesta / timeout | Sin wifi o servidor caído. | Reintentar (ver abajo). |

Todos los errores vienen como `{ "ok": false, "error": "…" }`.

### Política de reintento sugerida

1. Si falla (timeout, `503` o error de red): esperar **30 s** y reintentar, hasta **3 veces**.
2. Si sigue fallando: abandonar esa lectura y **seguir con el ciclo normal** (dormir 900 s y medir de nuevo).
   No acumules lecturas atrasadas ni mandes ráfagas al recuperar la conexión.
3. Con `400` o `401` no reintentes: no se van a arreglar solos.
4. Timeout de la petición recomendado: 10 s.

Si la placa deja de reportar más de 3 intervalos (45 min), el backend avisa al celular.

## Qué significa `raw`

El sensor es capacitivo: **más seco = valor más alto**. Con la calibración por defecto
(`rawDry = 3100`, `rawWet = 1350`, provisoria hasta medir tu sensor):

| `raw` aproximado | Interpretación |
| --- | --- |
| ~3100 o más | Tierra seca (0 %) |
| ~2500 | Umbral de riego (35 %) |
| ~1350 o menos | Tierra mojada (100 %) |
| **menos de 100** | **Sospechoso**: cable suelto, sensor desconectado o corto a masa. |
| **más de 4000** | **Sospechoso**: pin al aire o cable de señal cortado. |

Un valor cerca de 0 o de 4095 casi nunca es tierra: es el sensor. El backend lo marca como
"sensor sospechoso", avisa una vez por episodio y **no** lo usa para decidir si regar. Mandalo igual:
la placa no tiene que filtrar nada.

## Modo calibración

Sirve para armar y calibrar el sensor sin esperar 15 minutos por dato. Lo activa una persona con
`POST /api/calibration/start` (pide el PIN; la pantalla todavía no tiene botón); dura **15 minutos como máximo** y se
apaga solo.

Para la placa no cambia nada salvo `nextInSec`: mientras `calibrating` sea `true`, la respuesta trae
`nextInSec = 5`. Si la placa obedece, manda una lectura cada 5 segundos.

En ese modo las lecturas **no** se guardan en el historial, no se decide nada y no hay avisos: solo se
ven las últimas 30 (`device.calibration.recent` del snapshot). Al vencer, `calibrating` vuelve a
`false` y `nextInSec` a `900`. Si la placa estaba durmiendo 15 min cuando se activó, el cambio se nota
recién en su próxima lectura: reiniciala (botón EN) para que reporte enseguida.

## Avisar cambios de wifi (opcional)

Dos campos más en el mismo `POST /api/readings`. Una placa que no los manda funciona igual.

| Campo | Tipo | Descripción |
| --- | --- | --- |
| `ssid` | texto, 1 a 64 caracteres | Red a la que está conectada. Se puede mandar en cada lectura; el snapshot muestra la última. |
| `wifiEvent` | `"reset"`, `"connected"` o `"reset-recovered"` | Qué pasó con el wifi (ver abajo). Mandalo **una sola vez** por suceso, no en cada lectura. |

- **`"connected"`**: la placa se conectó a una red nueva (con el `ssid` nuevo). Limpia `wifiResetAt`.
- **`"reset"`**: se borró el wifi con el botón IO0. Si la placa todavía tiene red en ese momento puede avisarlo; fija `wifiResetAt`.
- **`"reset-recovered"`**: lo que normalmente corresponde después de un reset. Sin red no se puede avisar el reset
  cuando ocurre, así que en la **primera conexión posterior** mandá `wifiEvent: "reset-recovered"` con el `ssid` nuevo.
  El servidor lo trata como una conexión que además registra que hubo un reset, y limpia `wifiResetAt`.

Si la respuesta no llega (timeout), podés reenviar el mismo evento: el servidor no duplica el incidente si el mismo
evento con la misma red llega de nuevo en menos de 5 minutos. La respuesta (`ok`, `serverTime`, `nextInSec`,
`calibrating`, `water`) y la regla de riego son las de siempre: un evento de wifi nunca cambia el riego.

```json
{ "raw": 2150, "rssi": -61, "fw": "0.3.2", "uptimeSec": 12, "ssid": "WIFI_Casa", "wifiEvent": "reset-recovered" }
```

En el snapshot, `device` suma `ssid`, `wifiResetAt` (el último reset sin reconexión posterior) y `lastWifiChange`, y la
campana recibe un aviso `wifi-reset`, `wifi-connected` o `wifi-reset-recovered`. Ojo: `GET /api/snapshot` es público,
así que el nombre de la red también.

## Ciclo recomendado del firmware

```
al arrancar: conectar wifi → medir → POST → leer nextInSec
bucle:       dormir nextInSec → conectar wifi (si hace falta) → medir → POST → leer nextInSec
```

En el POST, mandá `fw` y `uptimeSec` siempre: ayudan a distinguir un reinicio de un corte de wifi.
