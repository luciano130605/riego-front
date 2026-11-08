# Fase 1: sensor de humedad y avisos

Objetivo: el sensor funciona de punta a punta y el sistema avisa al celular cuándo regar. Todavía **no**
hay regador automático (Fase 2): `RELAY_DRIVER=notify` no mueve ninguna bomba; vos regás a mano y
anotás el riego con "Regar ahora".

## Qué hace

| Función | Detalle |
| --- | --- |
| Lecturas | `POST /api/readings` guarda el `raw`, calcula el % con la calibración vigente y decide con `decideWatering` (sin cambios). Contrato en `docs/API-ESP32.md`. |
| Aviso "necesita riego" | Cuando la regla dice que hay que regar. No repite antes de `minIntervalHours` (6 h por defecto, y recuerda pasado ese tiempo si sigue seca). Se cierra al subir la humedad por encima del umbral o al anotar un riego. Con el automático apagado no avisa. |
| Aviso "la placa dejó de reportar" | Un temporizador interno revisa cada 5 min. Si pasaron más de 3 intervalos (45 min) desde la última lectura, avisa **una vez** por episodio y avisa de nuevo cuando vuelve. Si el servidor estuvo caído, cuenta desde que arrancó. |
| Aviso "sensor sospechoso" | `raw` < 100 o > 4000. Una vez por episodio. Mientras dura, no se avisa de riego. |
| Modo calibración | `POST /api/calibration/start` (PIN) → la placa manda cada 5 s durante 15 min como máximo. Sin historial, sin decisión, sin avisos. `POST /api/calibration/stop` lo corta. |
| Aviso de prueba | `POST /api/notify/test` (PIN). |
| Campana | Todos los avisos y fallos quedan en `incidents` (30 días) y salen en `GET /api/snapshot` → `incidents`. |

Los avisos llegan como notificaciones push propias (Web Push + VAPID, ver el README). Sin claves VAPID igual
quedan en `incidents`, con `push: "off"`.

## Variables nuevas

| Variable | Descripción |
| --- | --- |
| `RELAY_DRIVER` | `notify` es el valor por defecto. |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Claves de las notificaciones push (`npx web-push generate-vapid-keys`). Van las tres juntas. |
| `PUSH_API_TOKEN` | Habilita `POST /api/push/send` para que otros programas manden avisos. |
| `DB_NAME` | Nombre de la base (si la URI no la trae). |

La lista completa está en `backend/.env.example`.

## Activar las notificaciones en un dispositivo (sin instalar nada)

No hace falta ninguna app: las notificaciones son Web Push del propio navegador. Configuración →
Notificaciones → **Activar** (pide el PIN y el permiso del navegador). Ahí mismo elegís qué avisos querés
y probás que llegue.

Los navegadores solo permiten Web Push en **https** o en **`localhost`**. En `http://<IP-de-tu-PC>:5173`
(red local) **no funciona**: la pantalla lo avisa. Para usarlo desde el celular necesitás https (el despliegue
en Railway, o un túnel https como `tailscale serve`). En iPhone hay que agregar la app a la pantalla de inicio.

## Desde el celular con túneles de VS Code (https: acá sí andan las notificaciones)

`localhost` es solo tu PC. `http://192.168.x.x` llega desde la misma wifi, pero es `http` y el navegador no
deja usar notificaciones push ahí. Los **dev tunnels** de VS Code dan una URL **https** pública por puerto, y
eso sí lo permite:

- Pantalla: `https://<id>-5173.<región>.devtunnels.ms` · Backend: `https://<id>-3000.<región>.devtunnels.ms`
- En VS Code → pestaña *Puertos*: los dos puertos (3000 y 5173) con visibilidad **Pública**. Si son privados, el
  túnel pide iniciar sesión y la pantalla no puede hablar con el backend.
- La primera vez que abrís la URL de la pantalla, el túnel muestra una página de advertencia de Microsoft:
  tocá **Continue** (sale una sola vez por túnel).
- No hay que tocar `VITE_API_URL`: abierta desde un túnel, la pantalla reemplaza sola `http://localhost:3000`
  por el túnel del puerto 3000 (y manda el encabezado que evita la advertencia en los pedidos al backend).
- `CORS_ORIGIN` del backend tiene que incluir la URL de la pantalla del túnel (sin barra final). **Si el túnel
  cambia de id, hay que actualizarla** y reiniciar el backend. Vite ya acepta cualquier `*.devtunnels.ms`.
- Con la pantalla abierta desde el túnel: Configuración → Notificaciones → Activar (pide el PIN y el permiso).
- El recargado en caliente de Vite (HMR) no funciona a través del túnel: para ver cambios, recargá la página.

## Abrir la pantalla y el backend desde el celular (misma red wifi)

- Pantalla: `http://<IP-de-tu-PC>:5173` (Vite escucha en toda la red). Backend: `http://<IP-de-tu-PC>:3000`.
  La IP sale de `ipconfig` (IPv4 del wifi).
- `VITE_API_URL=http://localhost:3000,...`: abierta desde otro equipo, la pantalla cambia sola `localhost`
  por el host con el que la abriste, así que no hace falta tocar nada.
- `CORS_ORIGIN` del backend tiene que incluir `http://<IP-de-tu-PC>:5173`. **Reiniciá el backend** después
  de cambiarlo: el `.env` se lee solo al arrancar.
- Si no abre desde el celular: el firewall de Windows tiene que permitir Node.js en la red del wifi (si el
  wifi figura como red *Pública*, Windows suele bloquearlo).

## Despliegue en Railway

Una sola réplica (`numReplicas: 1` en `railway.json`), healthcheck en `/health`. En el servicio del
backend cargá: `MONGODB_URI`, `DB_NAME`, `DEVICE_TOKEN`, `ADMIN_PIN`, `SESSION_SECRET`, `PUBLIC_URL`,
`CORS_ORIGIN`, `RELAY_DRIVER=notify`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. `PORT` la pone Railway.

**MongoDB: URL privada vs pública.**

- En Railway (el backend y la base en el mismo proyecto) usá la **URL privada**
  (`mongodb://…@mongodb.railway.internal:27017`): no pasa por internet.
- Desde tu máquina usá la **URL pública** (`…@…proxy.rlwy.net:PUERTO`).
- En las dos, poné la base en **`DB_NAME`** y no en la URI. Con `/riego` en la URI el driver usa esa
  base para autenticar y el login falla; sin ella autentica contra `admin`, que es donde Railway crea
  el usuario.
- Con Atlas (`mongodb+srv://…`) también sirve `DB_NAME`; si la URI ya trae la base, se usa esa.

El código toma el nombre de la base de `DB_NAME`, si no de la URI y, si tampoco, usa `riego`. Eso está
probado con tests; la conexión real a Railway la tenés que verificar vos con el paso 1 de abajo.

## Checklist para verificar a mano

Preparación en PowerShell (reemplazá los valores):

```powershell
$base = "https://tu-backend.up.railway.app"     # o http://localhost:3000
$h    = @{ Authorization = "Bearer TU_DEVICE_TOKEN" }
```

### 1. `/health`

```powershell
Invoke-RestMethod "$base/health"
```

Esperado: `ok : True`. Si falla en Railway, mirá los *Deploy Logs*: una variable que falta aparece
como `Configuración inválida` con la lista.

### 2. Mandar una lectura (como la ESP32)

```powershell
Invoke-RestMethod -Method Post -Uri "$base/api/readings" -Headers $h `
  -ContentType "application/json" `
  -Body '{"raw":2000,"rssi":-60,"fw":"prueba","uptimeSec":10}'
```

Esperado: `ok : True`, `nextInSec : 900`, `calibrating : False`, `serverTime` con un número grande.
Con un token malo debe dar `401`; con `{"raw":9999}`, `400`.

### 3. Que aparezca en el snapshot

```powershell
$s = Invoke-RestMethod "$base/api/snapshot"
$s.readings[-1]      # la lectura que mandaste, con su humedad en %
$s.device            # online True, lastRaw 2000, fw "prueba", rssi -60
```

### 4. Bajar la humedad y recibir el aviso en el celular

Antes: activá las notificaciones en el dispositivo (Configuración → Notificaciones → Activar, en `localhost` o
https). Con la calibración por
defecto `raw 2800` ≈ 17 % de humedad (el umbral es 35 %, ≈ `raw 2487`):

```powershell
Invoke-RestMethod -Method Post -Uri "$base/api/readings" -Headers $h `
  -ContentType "application/json" -Body '{"raw":2800}'
```

Esperado en 1 a 2 segundos: notificación **"Hay que regar la planta"**, y en el snapshot,
`incidents[0].kind = "necesita-riego"`. Mandá otra lectura seca enseguida: **no** debe repetirse el
aviso (hasta 6 h después).

Para cerrar la alerta: subí la humedad (`{"raw":1800}`) o anotá un riego (paso 7).

### 5. Dejar de mandar lecturas y recibir "dejó de reportar"

Dejá de mandar lecturas **más de 45 minutos** (3 intervalos de 15 min) más 5 min del temporizador:
unos 50 minutos. Esperado: notificación **"La placa dejó de reportar"** una sola vez. Al mandar una
lectura, llega **"La placa volvió"**.

### 6. Modo calibración

```powershell
$login = Invoke-RestMethod -Method Post -Uri "$base/api/login" -ContentType "application/json" -Body '{"pin":"TU_PIN"}'
$a = @{ Authorization = "Bearer $($login.token)" }

Invoke-RestMethod -Method Post -Uri "$base/api/calibration/start" -Headers $a     # ok, until
Invoke-RestMethod -Method Post -Uri "$base/api/readings" -Headers $h -ContentType "application/json" -Body '{"raw":2100}'
# nextInSec = 5, calibrating = True
(Invoke-RestMethod "$base/api/snapshot").device.calibration                       # active, recent = [2100]
Invoke-RestMethod -Method Post -Uri "$base/api/calibration/stop" -Headers $a
Invoke-RestMethod -Method Post -Uri "$base/api/readings" -Headers $h -ContentType "application/json" -Body '{"raw":2100}'
# nextInSec = 900, calibrating = False
```

Esperado: las lecturas de calibración **no** aparecen en `readings` ni generan avisos. Si no la
cortás, se apaga sola a los 10 minutos.

### 7. Anotar un riego

```powershell
Invoke-RestMethod -Method Post -Uri "$base/api/water" -Headers $a
```

Esperado: `ok : True`, un evento `manual` en el snapshot, y la alerta de "necesita riego" cerrada.
No se mueve ninguna bomba.

### 8. `notify/test`

```powershell
Invoke-RestMethod -Method Post -Uri "$base/api/notify/test" -Headers $a
```

Esperado: `ok : True` y la notificación **"Prueba de riego-aut"** en todos los dispositivos suscriptos. Desde la
pantalla: Configuración → Notificaciones → **Probar** la manda solo a ese dispositivo. Si responde `502`, el
mensaje dice por qué (sin claves VAPID, sin dispositivos suscriptos, o el servicio de push no la entregó).
Conviene hacer este paso **antes** del 4 si no estás seguro de que las notificaciones llegan.

## Pendiente / conviene saber

- **Contrato:** `device.lastRaw`, `fw`, `uptimeSec`, `calibration` e `incidents` se agregan al snapshot
  como campos opcionales. Están tipados en `backend/src/snapshotExt.ts`; el cambio equivalente en
  `src/core/types.ts` está propuesto y **sin aplicar** hasta que lo apruebes. La pantalla ignora lo que
  todavía no conoce.
- **Campana y calibración en la pantalla:** el backend ya entrega los datos; mostrarlos en la pantalla
  (campana con `incidents`, botón de calibración) es un cambio de frontend aparte.
- **Entrega real:** el backend firma y cifra cada push con `web-push` y lo verifiqué hasta ahí (la petición sale
  bien formada y sin exponer la clave privada). Que el navegador la muestre solo se comprueba en un dispositivo
  suscripto, en `localhost` o https.
