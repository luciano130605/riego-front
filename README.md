# riego-aut

Tablero de control para el riego automático de una planta: mide la humedad de la tierra
(ESP32 + sensor), decide cuándo regar y abre el Sonoff el tiempo que haga falta.

Hay un tablero de escritorio (sin menú lateral) con humedad, riego, próximo riego automático,
gráficos de 24 horas y 7 días y tres tarjetas de resumen, y un backend (`backend/`, ver más abajo).
Sin `VITE_API_URL` la pantalla usa un simulador que corre en el navegador (etiqueta "Datos de
prueba"); con `VITE_API_URL=https://tu-backend...` habla con el backend por HTTP.
La idea es ir bajando de nivel: pantalla → backend → firmware del ESP32 → hardware.

## Modo aviso y calibración (fase 1: sensor real, sin regador automático)

La pantalla lee `snapshot.device.relay`: con `'aviso'` el sistema solo avisa y el riego es manual. El interruptor
pasa a "Avisos", aparece el chip "Solo avisos", "Regar ahora" pasa a "Anotar riego" (registra un riego a mano,
no prende nada), "Probar regador" queda deshabilitado y, si hay una alerta abierta, sale el banner "La planta
necesita agua: X % (objetivo Y %)". Con `'real'` (o sin el campo) todo funciona como antes. Los textos están en
`src/core/copy.ts` (`AVISO`, `SENSOR`). La pestaña Simulación se oculta si hay `VITE_API_URL`.

En Configuración → Dispositivo hay datos de la placa (valor crudo y hace cuánto, wifi, firmware, tiempo
encendida) y la sección **Calibración del sensor** (`CalibrationSection`): botón para empezar y terminar con el estado a la
vista, valor crudo en vivo con mini gráfico de los últimos 2 minutos y estabilidad (últimas 10 lecturas con menos de
80 cuentas de variación), paso "seco" en el aire y paso "mojado" en agua (mediana de las últimas 10), resultado con
vista previa y avisos si el rango es muy chico (< 300) o los valores están invertidos, y guardado con `updateSettings`.
Si el sensor falla o la placa está sin conexión, lo dice y no deja fijar valores. Al salir de la pestaña se corta. La lógica está en `src/core/calibration.ts` y `calibrationFlow.ts`.

**Lo que muestran el panel de la placa, la tarjeta de humedad y el chip es lo que informa el backend**, sin recalcular
estados (`src/core/deviceView.ts`): la conexión es `device.online` ("Sin conexión desde hace X" cuenta desde
`lastSeen + device.offlineAfterSec`), el sensor es `device.sensor` (ok, lectura al máximo = `reason: 'high'`, o falla por
ruido / lectura muy baja), los errores de comunicación son `device.failedPosts` y `device.resetReason`, y el valor crudo
y la hora salen de la misma última lectura. Los "hace X min" se refrescan solos cada 30 s (`useDeviceView`) y el snapshot
se pide cada 30 s. Simulación tiene los escenarios normal, saturado en 4095, falla por ruido, offline hace 10 min y
reinicio reciente.

Campos del contrato que usa la pantalla (todos opcionales, mismos nombres que `backend/src/snapshotExt.ts`):
`device.relay`, `device.lastRaw`, `device.fw`, `device.uptimeSec` y `device.calibration { active, until, recent[] }`.
`RiegoApi.startCalibration()` / `stopCalibration()` llaman a `POST /api/calibration/start` y `/stop` (las rutas
están en constantes de `httpRiego.ts`); mientras calibra, `HttpRiego` pide el snapshot cada 2 s.

## Pestaña "Datos de riego"

En Configuración → *Datos de riego* (reemplaza a la antigua pestaña Historial): estado del Sonoff con el botón
"Probar regador" (confirmación, cuenta regresiva y verificación de que volvió a apagado), resumen con selector
de 24 h / 7 días / 30 días, lista de riegos, decisiones de las últimas 48 h (por qué regó o no) y segundos de
bomba por día, más la tabla de lecturas de 24 h. Las cuentas están en `src/core/stats.ts` (puro, con tests).
Funciona igual con el simulador y con el backend. La prueba del regador queda deshabilitada si el servidor está
en modo aviso (`RELAY_DRIVER=fake`) o el Sonoff no responde.

## Cómo correrlo

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # lógica de decisión, ciclos, pronóstico, simulador, registro y gráfico
npm run build      # chequea tipos y arma dist/
npm run build:single   # un solo .html autocontenido en dist-single/
```

## Estructura

```
src/
  core/        Lógica pura, sin React. La va a reutilizar el backend tal cual.
    decide.ts     Regla de riego (¿riega ahora y, si no, por qué?)
    cycles.ts     Agrupa las tandas de bomba en riegos y detecta el riego en curso
    forecast.ts   Cuánto falta para el próximo riego
    moisture.ts   Valor crudo → %, nivel
    copy.ts       Textos de estado en español
  data/        Lo único que la pantalla sabe del mundo
    api.ts        Interfaz RiegoApi (+ controles del simulador)
    mockRiego.ts  Simulador de maceta, sensor y Sonoff
    derive.ts     Todo lo que se calcula a partir de una foto del sistema
    hooks.ts      useSnapshot, useDerived, useNow
  features/    Un directorio por parte del tablero
    dashboard/ moisture/ irrigation/ chart/ summary/ settings/ notifications/ log/
  ui/          Piezas básicas: Card, Button, Switch, Stepper, Segmented, Dialog, Toast, Skeleton
  styles/      Tema de Tailwind (colores del diseño, Inter)
```

## Cómo se conecta la pantalla al backend

La pantalla solo usa `RiegoApi` (`src/data/api.ts`). `src/data/httpRiego.ts` la implementa por HTTP:
consulta `/api/snapshot` cada 30 s y después de cada acción, corrige `now()` con la hora del servidor
y, si una acción recibe 401, abre un diálogo (`features/auth/PinDialog.tsx`) que pide el PIN, guarda el
token en `localStorage` y reintenta. En `App.tsx` se elige con la variable de Vite:

Hay una plantilla en `.env.example` (copiala a `.env` y completá `VITE_API_URL`):
`VITE_API_URL` puede ser una lista separada por coma (`http://localhost:3000,https://tu-backend.up.railway.app`):
usa la primera que responda y, si se cae, pasa a la otra (y viceversa).

```bash
VITE_API_URL=https://tu-backend.up.railway.app npm run dev     # contra el backend
npm run dev                                                    # simulador, como siempre
```

`sanitizeSettings`, `DEFAULT_SETTINGS` y `READ_EVERY_MIN` ahora viven en `src/core/settings.ts` (los
comparten la pantalla y el backend); `mockRiego.ts` los sigue reexportando. El contrato de datos está
en `src/core/types.ts` y no cambió.

`updateSettings` y `waterNow` devuelven `{ ok: true }` o `{ ok: false, error }`: la pantalla nunca
da una acción por hecha, muestra lo que pasó de verdad. El `Snapshot` trae `load` (cargando/listo) y
`error` (si no se pudo hablar con el servidor, con los últimos datos conocidos).

## Cómo riega el automático (src/core/decide.ts)

Hay dos modos (`Settings.mode`):

- **Hasta llegar al objetivo** (por defecto): cuando la humedad baja de `thresholdPct` (35 %) empieza
  un riego y sigue hasta que la lectura llega a `targetPct` (55 %). Riega en **tandas** de
  `waterSeconds` y espera 45 min entre una y otra (`SOAK_MIN`), porque el agua tarda en repartirse y
  el sensor lo refleja recién en las lecturas siguientes. Todas las tandas seguidas son **un riego**.
  Tope de seguridad por riego: `maxCycleSeconds` (30 s de bomba); si no llega al objetivo, corta.
- **Tiempo fijo**: cada riego dura `waterSeconds`, suba lo que suba la humedad.

Orden de los chequeos (la primera que se cumple decide):

1. Sin lectura, o la última tiene más de 3 intervalos: **no riega** (datos viejos).
2. Valor crudo pegado a los extremos del ADC (cable suelto o corto): **no riega**.
3. Hay un riego automático en curso: objetivo alcanzado → termina; automático apagado → frena; en
   pausa → espera; tope de seguridad alcanzado → corta; si no → **otra tanda**.
4. Humedad sobre el umbral: no hace falta.
5. Automático apagado: avisa pero no riega.
6. Pasó menos que `minIntervalHours` (6 h) desde el último riego (cuentan los manuales): espera.
7. `maxPerDay`: `null` = **los necesarios** (sin tope diario, es el valor por defecto); un número
   cuenta riegos completos en 24 h, no tandas.
8. Si no: **arranca un riego**.

Sin tope diario, el límite real lo ponen el tope por riego y la espera mínima.

## Pendientes conocidos

- La calibración (`rawDry` 3100, `rawWet` 1350) es provisoria. Hay que medir el sensor real.
- `SOAK_MIN` y la duración de las tandas hay que ajustarlos con la bomba y la maceta reales.
- La campana muestra avisos de los últimos dos días; el punto rojo indica un problema vigente,
  no "sin leer", porque todavía no hay dónde guardar qué se vio.
- Los estados llevan siempre ícono y texto además del color (verde = todo bien, rojo = atención).
- Los controles de simulación (adelantar el reloj, forzar humedad, provocar fallas) están en
  Configuración → Simulación y solo existen con datos de prueba.

## Backend (`backend/`)

> **Fase 1 (sensor + avisos):** `docs/FASE-1.md` (qué hace y checklist para verificar a mano) y
> `docs/API-ESP32.md` (contrato con el firmware). El modo por defecto es `RELAY_DRIVER=notify`: avisa
> cuándo regar y vos regás a mano.

Servidor Fastify + MongoDB que recibe las lecturas del ESP32, decide con **la misma** `decideWatering`
de `src/core` (se importa tal cual, sin copiar) y ordena el riego al Sonoff. El ESP32 solo manda el
valor crudo. Tiene su propio `package.json` y `node_modules`; el frontend no se toca.

```
backend/
  src/
    index.ts      Arranque: config, Mongo, relé, escucha en 0.0.0.0:$PORT
    app.ts        Fastify (helmet, CORS, rate limit, trustProxy) y rutas
    config.ts     Variables de entorno validadas con zod (falla al arrancar si falta alguna)
    db.ts         Conexión e índices (lecturas 90 días, incidentes 30 días)
    store.ts      Lecturas de/hacia Mongo
    watering.ts   Único camino para mover la bomba (candado, tope duro, evento antes de la orden)
    session.ts    Token de sesión firmado con HMAC
    relay/        Interfaz Relay + FakeRelay
    routes/       readings, snapshot, admin (login, settings, water)
  test/           vitest + mongodb-memory-server
```

```bash
cd backend && npm install
npm test                 # tests del backend (baja un mongod en memoria la primera vez)
npm run dev              # con backend/.env cargado
# desde la raíz:
npm run build:server     # tsc + tsup → backend/dist/index.js (un solo archivo, con src/core adentro)
npm run start:server
```

### Variables de entorno

Plantilla en `backend/.env.example` (el `.env` real está en `.gitignore`).

| Variable | Obligatoria | Descripción |
| --- | --- | --- |
| `MONGODB_URI` | sí | URI de MongoDB (Atlas o el plugin de Railway). |
| `DEVICE_TOKEN` | sí | Token del ESP32 (≥ 16 caracteres). |
| `ADMIN_PIN` | sí | PIN para entrar desde la pantalla (≥ 4). |
| `SESSION_SECRET` | sí | Firma de sesiones (≥ 32 caracteres aleatorios). |
| `PUBLIC_URL` | sí | URL pública del backend, sin barra final. |
| `CORS_ORIGIN` | sí | Origen(es) de la pantalla con CORS, separados por coma (ej. `http://localhost:5173,https://tu-pantalla.example.com`). |
| `PORT` | no | Lo define Railway (por defecto 3000). |
| `RELAY_DRIVER` | no | `notify` (por defecto: solo avisa cuándo regar, no mueve nada), `fake` (simula el riego), `ewelink` o `tuya` (enchufe de Smart Life). |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | no (van juntas) | Notificaciones push propias (Web Push). Sin ellas los avisos quedan solo en `incidents`. |
| `PUSH_API_TOKEN` | no | Habilita `POST /api/push/send`. |
| `DB_NAME` | no | Nombre de la base (si la URI no lo trae). |
| `RELAY_HARD_MAX_SECONDS` | no | Tope absoluto de segundos de bomba por orden (por defecto 60). |
| `EWELINK_APP_ID`, `EWELINK_APP_SECRET`, `EWELINK_DEVICE_ID` | solo con `ewelink` | Credenciales de eWeLink. |
| `TUYA_ACCESS_ID`, `TUYA_ACCESS_SECRET` | solo con `tuya` | Access ID y Access Secret del proyecto en Tuya Cloud. No se loguean. |
| `TUYA_BASE_URL` | solo con `tuya` | Endpoint del centro de datos del proyecto, sin barra final: `https://openapi.tuyaus.com` (Oeste de EE. UU.), `https://openapi.tuyaeu.com` (Europa central), etc. |
| `TUYA_DEVICE_ID` | solo con `tuya` | Id del enchufe (lo muestra `iot.tuya.com` > Cloud > Devices). |
| `TUYA_TEST_DEVICE_ID` | no | Dispositivo de **prueba** de Smart Life (hoy un timbre) para verificar la conexión sin tocar la bomba. Tiene que ser distinto de `TUYA_DEVICE_ID`. Sin esta variable, la prueba de conexión responde 404. |

#### Conectar el enchufe de Smart Life (`RELAY_DRIVER=tuya`)

1. En [iot.tuya.com](https://iot.tuya.com): *Cloud > Development > Create Cloud Project* (elegí el centro de datos de tu región) y suscribí las APIs **Authorization Token Management**, **Smart Home Basic Service** e **IoT Core**.
2. En el proyecto: *Devices > Link App Account > Add App Account* y escaneá el QR con la app Smart Life. El enchufe aparece en la lista; copiá su **Device ID**.
3. Cargá `TUYA_ACCESS_ID`, `TUYA_ACCESS_SECRET`, `TUYA_BASE_URL`, `TUYA_DEVICE_ID` y `RELAY_DRIVER=tuya` en `backend/.env` (en Render, como variables del servicio).
4. Verificá el enchufe real **antes de regar**: `npm --prefix backend run tuya:spec` muestra si está online, el código de su interruptor (`switch_1` o `switch`) y si tiene cuenta regresiva (`countdown_1`) y en qué unidad. El driver lee esa misma especificación al primer riego y no supone ningún código: si no encuentra un interruptor, no riega.

Seguridad del riego con Tuya: el evento se guarda antes de ordenar el riego y, si la orden de prender falla, se borra y queda un incidente; hay un tope duro de segundos por orden (`RELAY_HARD_MAX_SECONDS`); antes de prender se anota un apagado pendiente en la base; si el apagado falla se reintenta 3 veces con espera y, si sigue fallando, el pendiente se reintenta cada 10 s (y al arrancar). Si el enchufe tiene cuenta regresiva en segundos (o minutos), también se usa como apagado extra. `snapshot.relay` (`{ driver, connected }`, el mismo dato va en `relayStatus`) sale de consultar si el enchufe está online, con un cache de 60 s: nunca se consulta en cada request. Si falla la autenticación o la cuenta de prueba de Tuya venció, `connected` es `false` y queda un incidente `relay-auth` en la campana. *Esta integración se probó con HTTP simulado; todavía no con un enchufe real.*

#### Probar la conexión sin tocar la bomba

Con `TUYA_TEST_DEVICE_ID` definido, `POST /api/relay/test` **sin `seconds`** (requiere sesión) opera solo sobre el dispositivo de prueba: 1) consulta si está online (si no, `ok:false` con el motivo); 2) lee su especificación y deja en el log los códigos y tipos escribibles; 3) si tiene una función que lo haga sonar (`siren_switch`, `buzzer`, `beep`, `ring`, `doorbell_ring`) la usa y la restaura; 4) si no, invierte una luz indicadora o nocturna booleana, espera 2 s y la restaura (si falla, 3 reintentos y un incidente `relay-test`); 5) si no hay ninguna función segura, responde `ok:true`, `action:"status-only"` y la lista `writableCodes`. Nunca toca volumen, melodía ni configuración. Responde `{ ok, message, action: 'ring'|'toggle'|'status-only', latencyMs, writableCodes }` o `{ ok:false, error }`. Límite: 1 prueba cada 10 s (429 con `Retry-After`); se rechaza con 409 si hay un riego en curso y con 400 si el id de prueba es el del riego. Cada prueba queda en la colección `pruebasRelay`. Con `{ seconds }` la misma ruta sigue siendo la prueba de la bomba de siempre. `snapshot.relay.testAvailable` avisa si hay algo para probar, y sin dispositivo de riego configurado `relay.connected` se calcula con el de prueba.

Para generar secretos: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

### Migración a plantas y sectores

El backend ahora maneja varias plantas agrupadas por sector. **No destructiva e idempotente**: solo agrega el sector
"Interior" (con el umbral y el objetivo actuales), la planta "Mi planta" (ligada a la placa por defecto, canal `main`, con la
calibración actual) y les pone `plantId` a las lecturas y riegos que ya existen. No borra ni cambia ningún dato.

**Antes de correrla, hacé un respaldo en Atlas** (la migración solo agrega y asigna, pero conviene poder volver atrás):
1. *Opción rápida (Atlas):* en el cluster, **Backup > Take Snapshot On Demand** (en clusters M10 o superiores) y esperá a que figure "Completed".
   En un cluster gratuito (M0) no hay snapshots: usá la opción 2.
2. *Con `mongodump` (sirve en cualquier cluster):*
   `mongodump --uri "<MONGODB_URI>" --db <DB_NAME> --out respaldo-antes-de-plantas`
   (para volver atrás: `mongorestore --uri "<MONGODB_URI>" --drop --db <DB_NAME> respaldo-antes-de-plantas/<DB_NAME>`).
   Las colecciones que importan: `readings`, `events`, `incidents` y `config` (ajustes y estado de avisos).
3. Verificá que el respaldo no esté vacío (el tamaño de la carpeta o la cantidad de documentos de `readings`).

Después:
```
cd backend
npm run migrate-plants              # solo cuenta qué haría (no escribe nada)
npm run migrate-plants -- --confirm # la aplica
```
Con la base sin migrar, el servidor **no arranca** y lo dice (así no se despliega código nuevo sobre datos viejos sin respaldo).
Una base completamente vacía se migra sola. Después de migrar: `POST /api/readings` del firmware 0.2.0 sigue andando sin
cambios (va al canal `main`), y los endpoints viejos operan sobre la primera planta. Contrato: `backend/docs/API-PLANTAS.md`.

### API

| Ruta | Auth | Qué hace |
| --- | --- | --- |
| `GET /health` | — | `{ ok: true }` |
| `POST /api/readings` | `Bearer DEVICE_TOKEN` | Body `{ raw: 0..4095, rssi? }`. Guarda, decide y, si hace falta, riega. Responde `{ ok: true, water }`; `water` es `true` solo si la bomba efectivamente se ordenó. Si Mongo falla: 503 y no se riega. |
| `POST /api/calibration/start`, `/stop` | `Bearer <token>` | Modo calibración: la placa manda cada 5 s, 15 min como máximo, sin historial ni avisos (guía completa en `docs/CALIBRACION.md`). |
| `POST /api/notify/test` | `Bearer <token>` | Manda un aviso de prueba al celular. |
| `GET /api/snapshot` | — | `Snapshot` del contrato: lecturas de 30 días (cada una con la `decision` que se tomó), eventos de 30, ajustes y estado de la placa. |
| `POST /api/login` | — | `{ pin }` → `{ token }` (30 días). 5 intentos por minuto por IP. |
| `PUT /api/settings` | `Bearer <token>` | Cambia ajustes (parcial); se sanean con `sanitizeSettings`. |
| `POST /api/water` | `Bearer <token>` | Riego manual de `waterSeconds`. 409 si ya hay un riego en curso. |
| `GET /api/relay/status` | — | `{ ok, online, on, simulated, maxSeconds, device? }`. `simulated` es `true` con `RELAY_DRIVER=fake` (modo aviso: no hay regador conectado). `device` trae nombre, modelo, señal wifi y firmware del Sonoff si los informa. |
| `POST /api/relay/test` | `Bearer <token>` | Body `{ seconds }` (entero, hasta `RELAY_HARD_MAX_SECONDS`). Prende la bomba para probarla; **no crea un evento de riego**. 409 si ya está regando. |

### Seguridad de la bomba

1. Un solo riego a la vez (candado en memoria que dura mientras la bomba debería seguir prendida).
2. El evento se guarda **antes** de ordenar al Sonoff. Si el Sonoff falla (hay un reintento), se borra
   el evento y se anota un incidente: la próxima lectura vuelve a decidir y no se riega dos veces.
3. Los segundos nunca superan `RELAY_HARD_MAX_SECONDS`, diga lo que diga la configuración.
4. El apagado garantizado lo da el relé real (ver más abajo).

Los datos viven en MongoDB: `readings` (solo el `raw`; el % se calcula al armar el snapshot con la
calibración vigente), `events`, `incidents` y `config` (`settings`, `device`, `ewelink`). La hora
siempre es la del servidor.

## Notificaciones push propias (Web Push + VAPID)

Los avisos llegan al celular o al navegador como notificaciones push **de tu propio backend**: la librería
[`web-push`](https://github.com/web-push-libs/web-push) firma y cifra cada mensaje con tus claves VAPID. No
hay ntfy, Firebase ni OneSignal. (El navegador igual entrega el mensaje a través del servicio de push de su
fabricante —Google, Mozilla, Apple—; es parte del estándar y no se puede evitar, pero no ve el contenido: va
cifrado de punta a punta.)

**1. Generar las claves (una sola vez)**

```bash
cd backend
npx web-push generate-vapid-keys
```

Copiá la pública y la privada a `backend/.env` como `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY`, y poné tu mail
en `VAPID_SUBJECT=mailto:vos@ejemplo.com`. `PUSH_API_TOKEN` es cualquier secreto de 16+ caracteres
(`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`). `.env` está en `.gitignore`;
las claves nunca se loguean. Reiniciá el backend.

**2. Activar en un dispositivo.** Abrí la pantalla → Configuración → Notificaciones → **Activar**. Pide el PIN
y el permiso del navegador. Ojo: los navegadores solo permiten notificaciones push en **https** o en
**`localhost`**; en `http://192.168.x.x` no funcionan (la pantalla lo avisa). En iPhone hay que agregar la app
a la pantalla de inicio.

**3. Endpoints**

| Ruta | Auth | Qué hace |
| --- | --- | --- |
| `GET /api/push/public-key` | — | `{ publicKey }` para que el navegador se suscriba. |
| `POST /api/push/subscribe` | PIN | Guarda o actualiza (upsert por `endpoint`) un dispositivo. Máx. 10/min por IP. |
| `POST /api/push/unsubscribe` | PIN | Borra el dispositivo. |
| `PATCH /api/push/preferences` | PIN | `{ endpoint, prefs: { "placa-offline": false } }` activa o apaga tipos de aviso. |
| `POST /api/push/send` | `Bearer PUSH_API_TOKEN` | `{ type, title, body, url?, tag? }` a todos los dispositivos con ese tipo activo. |
| `POST /api/push/test` | PIN | Prueba al dispositivo que la pide. Máx. 10/min por IP. |

Tipos de aviso: `necesita-riego`, `placa-offline`, `placa-vuelve`, `sensor-sospechoso` (y `test`). Los avisos del
sistema usan el tipo como `tag`: uno nuevo **reemplaza** al anterior en el celular en vez de apilarse, y un
mismo aviso idéntico no se manda dos veces en 10 minutos. Las suscripciones vencidas (404/410) se borran solas;
ante 429 o 5xx se reintenta con espera creciente (hasta 3 veces) y un dispositivo que falla no corta a los demás.

**4. Mandar un aviso con curl**

```bash
curl -X POST http://localhost:3000/api/push/send \
  -H "Authorization: Bearer $PUSH_API_TOKEN" -H "Content-Type: application/json" \
  -d '{"type":"necesita-riego","title":"Hay que regar","body":"La tierra está seca.","url":"/","tag":"riego"}'
# → {"ok":true,"sent":1,"failed":0,"removed":0,"muted":0}
```

Desde código del backend: `push.notify(type, { title, body, url?, tag? })` (evita duplicados y nunca lanza).

## Despliegue en Railway

`railway.json` en la raíz ya trae el build (instala y compila solo `backend/`), el comando de inicio
y el healthcheck en `/health`. Una sola réplica.

1. Subí el repo a GitHub y creá un proyecto en Railway desde ese repo (el servicio apunta a la **raíz**).
2. Agregá una base MongoDB (plugin de Railway o Atlas) y copiá su URI.
3. En *Variables* cargá las de la tabla. `PUBLIC_URL` es el dominio que Railway genera
   (*Settings → Networking → Generate Domain*). Dejá `RELAY_DRIVER=fake` hasta tener el Sonoff.
4. Desplegá y mirá que el healthcheck pase.

### Probarlo con curl

```bash
URL=https://tu-backend.up.railway.app
TOKEN=el-DEVICE_TOKEN

curl $URL/health

# Lo que haría el ESP32 (2800 = tierra bien seca con la calibración por defecto → riega)
curl -X POST $URL/api/readings \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"raw":2800,"rssi":-60}'

curl $URL/api/snapshot

# Sesión y riego manual
SESSION=$(curl -s -X POST $URL/api/login -H "Content-Type: application/json" \
  -d '{"pin":"TU_PIN"}' | node -pe "JSON.parse(require('fs').readFileSync(0)).token")
curl -X POST $URL/api/water -H "Authorization: Bearer $SESSION"
```

Con `RELAY_DRIVER=fake` el riego queda registrado como evento pero no se prende nada.

## Sonoff por eWeLink (`RELAY_DRIVER=ewelink`)

**Modo ejemplo.** Si las credenciales son las de ejemplo de la plantilla (EWELINK_APP_ID=123, EWELINK_APP_SECRET=12345678, EWELINK_DEVICE_ID=ejemplo), el backend no habla con eWeLink (usa un relé de mentira), GET /api/relay/status devuelve xample: true y la pantalla muestra datos inventados (el simulador). Al reemplazarlas por las reales se conecta al Sonoff de verdad y la pantalla vuelve a mostrar los datos del backend.

**Sin credenciales** (variables vacías con `RELAY_DRIVER=ewelink`): el backend arranca igual, pero `GET /api/relay/status`
responde 503 con `Sonoff no conectado: faltan EWELINK_APP_ID, ...` y la pantalla muestra "Regador desconectado" con el
botón de prueba deshabilitado. Los datos del Sonoff (conexión, estado, modelo, wifi, firmware) salen de la nube de eWeLink
(`backend/src/relay/ewelinkRelay.ts`); la humedad y el historial vienen de las lecturas que manda el ESP32 a
`POST /api/readings` y se guardan en MongoDB.

Usa `ewelink-api-next` (API V2 oficial, OAuth2.0). Todo lo de abajo salió del código de la librería y de
la documentación oficial; lo que no figura ahí está marcado como **sin verificar**.

**1. Crear la app** en [dev.ewelink.cc](https://dev.ewelink.cc), tipo OAuth2.0, rol estándar. Copiá
`APP_ID` y `APP_SECRET` a las variables. Registrá como *Redirect URL* exactamente:

```
${PUBLIC_URL}/api/ewelink/callback      # por ejemplo https://tu-backend.up.railway.app/api/ewelink/callback
```

**2. Autorizar** (con las variables de producción cargadas, incluida la misma `MONGODB_URI`):

```bash
npm run ewelink:url        # imprime la URL de login; el state queda en Mongo 10 minutos
# abrí la URL, iniciá sesión en eWeLink y autorizá → el navegador vuelve al callback y dice "Sonoff conectado"
npm run ewelink:devices    # lista los dispositivos; copiá el id a EWELINK_DEVICE_ID
```

Los scripts leen `backend/.env`. Los tokens quedan en Mongo (`config` → `ewelink`) y nunca en logs ni en el snapshot.

**Tokens.** Según la doc oficial el access token dura 30 días y el refresh token 60. El backend renueva
el access token cuando le quedan menos de 3 días, o si el servidor responde 401/402, y cada 6 h para no
perder el refresh token si pasan semanas sin regar. Si el refresh falla se registra un incidente
(`ewelink-refresh`) y habrá que repetir la autorización. El error 407 significa "appid sin permiso": las
apps OAuth2.0 gratuitas solo pueden usar un subconjunto de interfaces.

**Apagado garantizado** (la bomba nunca depende de que el servidor siga vivo):

1. Se guarda `pendingOff { deviceId, offAt }` en Mongo **antes** de prender.
2. Se prende con `{ switch: 'on', pulse: 'on', pulseWidth }` (modo pulso/inching del Sonoff, en ms,
   múltiplo de 500 entre 500 y 3 600 000, según la doc de UIID 1/6). Si el equipo lo rechaza se prende
   con `{ switch: 'on' }`.
3. Un temporizador manda OFF y verifica el estado; además un barrido cada 10 s (y al arrancar el
   servidor) reintenta los apagados vencidos hasta confirmar. Si tarda más de 30 s sin confirmar, queda
   un incidente.

## Qué falta verificar con el equipo real

- **Modo pulso por la nube**: la doc oficial define `pulse`/`pulseWidth`, pero no confirma que se puedan
  fijar por la API V2 en la nube. No se pudo probar sin el equipo. Si no lo acepta, el código cae solo
  al apagado por temporizador + `pendingOff` (la seguridad no depende del pulso).
- **Refresh con app OAuth2.0**: la doc indica `POST /v2/user/refresh` con `{ rt }`; no dice si el refresh
  token rota ni si la app gratuita puede usarlo. El código guarda lo que devuelva.
- **Región en el callback**: se asume que eWeLink vuelve con `code`, `state` y `region` en la URL.
- **Tamaño del snapshot**: ahora trae 30 días de lecturas (~2.900 puntos, unos 300 KB) y la pantalla lo pide
  cada 30 s. Si pesa, el próximo paso es un `?days=` para pedir la ventana larga solo al abrir "Datos de riego".
- **Datos del Sonoff** (`device` en `/api/relay/status`): los nombres de campo (`name`, `productModel`,
  `params.rssi`, `params.fwVersion`) salen de la doc y **no están verificados** con el equipo real.
