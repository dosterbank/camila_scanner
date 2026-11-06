# Guía de integración de WhatsApp

Esta guía cubre la cola de atención WhatsApp y el control del bot. La bandeja ya no presenta mensajes ni archivos multimedia ni envía respuestas: solo lista chats que requieren atención. Supabase se usa para autenticar al personal.

## Estado comprobado de los adjuntos

La interfaz no consume el endpoint de mensajes y no representa adjuntos. La exportación de n8n inspeccionada guardaba `media_url`, MIME y nombre de archivo en `buffer_mensajes` por un día; el nodo `Descargar adjunto` obtenía un binario para procesarlo con Gemini, pero no había un nodo que lo escribiera a una carpeta persistente.

El uso de archivos multimedia en la bandeja queda fuera del flujo solicitado. La exportación inspeccionada descargaba adjuntos temporalmente para Gemini; no se debe asumir que exista una copia persistente local ni eliminar datos de YCloud esperando que la haya.

## Antes de cambiar el flujo

El export `n8nv1.json` contiene una clave de API incrustada en un nodo HTTP Request. **Rótala o revócala antes de volver a activar el flujo** y guarda la clave nueva como credencial/variable de n8n. No la copies a este README, a Git ni a JavaScript del navegador.

La bandeja web ya espera estas rutas en el origen HTTPS local de n8n:

| Método | Ruta | Uso |
|---|---|---|
| POST | `/webhook/crm-bot-control` | Consultar/pausar/reactivar bot global o por cliente |
| GET | `/webhook/crm-inbox/conversations?status=...` | Listar conversaciones y estado global |
| POST | `/webhook/crm-inbox/resolve` | Marcar atendido/resuelto y reactivar solo ese cliente |

La interfaz está en `js/whatsapp.js`. Configura allí `N8N_LOCAL_API_BASE_URL` con **solo el origen HTTPS local**, por ejemplo `https://n8n.crm.fullpiston.com`. Las rutas de arriba se añaden automáticamente. No pongas una API key en esta variable. La lista se actualiza cada 10 segundos mientras la pestaña esté visible.

La respuesta de `/conversations?status=abiertas` debe incluir `bot_global_pausado` y una lista `conversations`. Cada conversación debe incluir `id`, `nombre`, `telefono`, `estado`, `motivo` y `recibido_en`. `recibido_en` debe ser la hora de llegada inicial a la cola humana y mantenerse inmutable mientras siga pendiente; la web ordena del más antiguo al más nuevo. No envíes contenido del mensaje ni enlaces de multimedia a la bandeja.

## Qué hacen los nodos actuales del export

### `Notificar plataforma (pausa)`

Es un nodo **HTTP Request** que actualmente hace `POST` a un endpoint externo antiguo (`/api/handoff`). Tiene un encabezado `x-api-key` incrustado y envía un JSON con estos campos:

```json
{
  "cliente": "+593...",
  "nombre": "Nombre del cliente",
  "motivo": "Derivado por el bot",
  "ultimo_mensaje": "Mensaje que originó la derivación"
}
```

El nodo recibe ejecuciones desde las ramas de derivación/aviso del agente. No es el webhook local de la bandeja, y **cambiar solo su URL no crea ni habilita** las rutas `/crm-inbox/*`.

Para cambiar su destino:

1. En n8n, abre el nodo **Notificar plataforma (pausa)**.
2. Deja **Method** en `POST`.
3. Reemplaza **URL** por la URL HTTPS completa del nuevo endpoint POST, incluyendo su ruta. No uses aquí solo el origen base de `N8N_LOCAL_API_BASE_URL`.
4. Conserva el cuerpo JSON anterior únicamente si el nuevo receptor acepta esos mismos nombres y formatos. Si la documentación del receptor define otro esquema, ajusta el cuerpo según ese contrato.
5. Si el destino requiere autenticación, elimina la clave antigua y configura el método nuevo mediante **Credentials** o variables protegidas de n8n. No guardes el secreto en el workflow exportado ni en la web.
6. Guarda y activa el workflow; ejecuta una prueba controlada con un contacto de prueba y revisa que el nodo reciba una respuesta HTTP exitosa y que el receptor muestre el teléfono, motivo y mensaje correctos.

No se proporcionó la URL nueva ni su contrato en esta tarea, así que no la he inventado ni he cambiado el workflow exportado. Para indicar el valor exacto de URL/cuerpo, hace falta la URL nueva y saber qué JSON espera su endpoint.

### `Webhook reactivar` y `Reactivar / ver pausados`

En el export, `Webhook reactivar` tiene sus parámetros vacíos y no tiene salidas conectadas. El nodo `Reactivar / ver pausados` también está desconectado; su código lee `query.numero` (GET), acepta un número o `todos`, y puede borrar todas las pausas individuales. No autentica la solicitud. **No lo publiques ni lo conectes directamente a Internet en su estado actual.**

La pestaña web no llama a ese GET. Envía un POST a `/webhook/crm-bot-control` con uno de estos cuerpos:

```json
{"scope":"global","action":"status"}
{"scope":"global","action":"pause"}
{"scope":"global","action":"resume"}
{"scope":"customer","action":"pause","phone":"+593999999999"}
{"scope":"customer","action":"resume","phone":"+593999999999"}
```

Para enlazar el control desde la plataforma:

1. Configura `Webhook reactivar` como método **POST** y ruta `crm-bot-control` (la URL de producción quedará como `https://<host-n8n>/webhook/crm-bot-control`).
2. Conecta primero un nodo de autorización. Debe validar el token recibido en `Authorization: Bearer ...` mediante la RPC `public.usuario_es_personal()` de Supabase. Si la respuesta no es `true`, detén la ejecución sin cambiar estado.
3. Después de la autorización, conecta un nodo de código que lea `body.scope`, `body.action` y, para `customer`, `body.phone`; actualiza `$getWorkflowStaticData('global')` (`botGlobalPausado` y `pausados`) con el mismo formato/normalización que usa el procesamiento de mensajes.
4. Devuelve JSON con `ok`, `bot_global_pausado` y `pausados_ahora`, que son los campos requeridos por la interfaz.
5. Configura la respuesta del webhook para devolver el resultado del último nodo y activa el workflow.
6. Prueba `status`, pausa/reactivación global y pausa/reactivación individual con una cuenta autenticada de empleado. Confirma también que, en `Normalizar mensaje` y `Clasificar lote`, ninguna respuesta automática se envía mientras corresponda una pausa.

Para la llamada de autorización a Supabase, el nodo HTTP Request debe hacer `POST` a:

```text
https://<proyecto>.supabase.co/rest/v1/rpc/usuario_es_personal
```

Envía `apikey` con la clave pública del proyecto, `Authorization` con el token Bearer original del navegador y `Content-Type: application/json`, con cuerpo `{}`. Guarda la URL/clave de Supabase en configuración protegida de n8n. **No uses la clave `service_role` en el navegador.** Ejecuta `supabase-whatsapp.sql` en Supabase si aún falta crear la RPC.

El código antiguo `Reactivar / ver pausados` no es compatible directamente: espera query GET, no implementa `status`/pausa global y carece de autenticación. Reemplázalo o adapta su lógica detrás del webhook POST ya autenticado; no habilites ambos caminos públicos sin autorización.

### Reinicio global diario y chats sin atender

El botón se titula **«Desactivar bot para todos»** cuando el bot está activo y **«Activar bot para todos»** cuando está pausado. El cambio global solo debe cambiar `data.botGlobalPausado`; no debe vaciar `data.pausados`.

En n8n, añade un nodo **Schedule Trigger** diario a las `00:00` y define explícitamente la zona horaria `America/Guayaquil` (o la zona del local). Conéctalo a un nodo Code que reactive únicamente el control global:

```javascript
const data = $getWorkflowStaticData('global');
data.botGlobalPausado = false;
return [{ json: { ok: true, bot_global_pausado: false } }];
```

No asignes `data.pausados = {}` en ese proceso. El código que decide responder debe mantener la condición `data.botGlobalPausado || data.pausados[cliente]`: así el bot global vuelve a activarse a medianoche, pero los clientes con solicitudes todavía pendientes siguen pausados individualmente.

### Marcar una solicitud como atendida

La acción **Atendido** envía `POST /webhook/crm-inbox/resolve` con:

```json
{"conversation_id":"<id>","action":"resolve"}
```

El endpoint debe validar el token del empleado igual que el control del bot, comprobar que la conversación existe y sigue abierta, marcarla como `resuelto` y quitar de `data.pausados` únicamente el teléfono normalizado de ese chat. Devuelve `{"ok":true}` solo si completó ambas operaciones. Los otros chats pendientes deben permanecer en la lista y pausados. Al entrar un nuevo mensaje que requiera atención, se debe conservar/crear su pausa individual y fijar `recibido_en` si empieza una nueva solicitud.

## Requisitos para completar la bandeja

El workflow y/o un servicio local deben implementar:

- Guardar estado y hora inicial de cada conversación pendiente en la base local.
- Crear el endpoint autenticado `/crm-inbox/resolve` para cerrar una solicitud y reactivar a ese único cliente.
- Evitar que reintentos de YCloud creen notificaciones duplicadas para el mismo evento.
- Configurar IP LAN estable, DNS local y certificado HTTPS válido. Restringe CORS a `https://crm.fullpiston.com` y permite el encabezado `Authorization`.
- Respaldar el almacenamiento local de conversaciones. Los datos de `$getWorkflowStaticData('global')` pueden no ser suficientes si necesitas consistencia ante reinicios o ejecuciones concurrentes.

La interfaz solo consulta la lista de conversaciones y el control del bot; no llama a mensajes ni envía respuestas. El endpoint de resolución y el Schedule Trigger deben estar implementados y activos en n8n para completar el comportamiento descrito.
