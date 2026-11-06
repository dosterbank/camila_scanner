# Guía de integración de WhatsApp

Esta guía cubre la bandeja local de WhatsApp, las respuestas humanas, la derivación a la plataforma y los controles para pausar o reactivar el bot. Supabase se usa para autenticar al personal.

## Estado comprobado de los adjuntos

La inspección de la bandeja en producción encontró un mensaje de tipo `image` cuyo `media_url` apunta a `api.ycloud.com`, y la interfaz no pudo mostrarlo porque solo acepta multimedia servida desde el origen HTTPS local de n8n. La exportación de n8n disponible guarda `media_url`, MIME y nombre de archivo en `buffer_mensajes` por un día; el nodo `Descargar adjunto` obtiene un binario para el procesamiento con Gemini, pero en esa exportación no hay un nodo que escriba el binario a una carpeta persistente.

Por lo tanto, **no está confirmado que los archivos multimedia se estén almacenando localmente**; la evidencia actual indica que se guarda una referencia temporal de YCloud y que la descarga del flujo es transitoria. La exportación inspeccionada puede no reflejar cambios más recientes del workflow, pero la respuesta actual de la API de mensajes todavía devuelve una URL de YCloud. No borres ni limpies datos de YCloud esperando que haya una copia local.

Para confirmar almacenamiento local, cada evento con adjunto debe pasar por una descarga binaria y luego por una escritura persistente en una ruta dedicada de la PC n8n (por ejemplo un volumen montado para Docker). Guarda en la base local la ruta relativa o el identificador del archivo, MIME y tamaño; el endpoint de mensajes debe devolver una URL HTTPS local de n8n, nunca el enlace temporal de YCloud. Comprueba en la PC que el archivo existe después de terminar la ejecución y que se puede volver a servir tras reiniciar n8n.

## Antes de cambiar el flujo

El export `n8nv1.json` contiene una clave de API incrustada en un nodo HTTP Request. **Rótala o revócala antes de volver a activar el flujo** y guarda la clave nueva como credencial/variable de n8n. No la copies a este README, a Git ni a JavaScript del navegador.

La bandeja web ya espera estas rutas en el origen HTTPS local de n8n:

| Método | Ruta | Uso |
|---|---|---|
| POST | `/webhook/crm-bot-control` | Consultar/pausar/reactivar bot global o por cliente |
| GET | `/webhook/crm-inbox/conversations?status=...` | Listar conversaciones y estado global |
| GET | `/webhook/crm-inbox/messages?conversation_id=...` | Cargar mensajes y multimedia |
| POST | `/webhook/crm-inbox/reply` | Enviar una respuesta humana por YCloud |

La interfaz está en `js/whatsapp.js`. Configura allí `N8N_LOCAL_API_BASE_URL` con **solo el origen HTTPS local**, por ejemplo `https://n8n.crm.fullpiston.com`. Las rutas de arriba se añaden automáticamente. No pongas una API key en esta variable.

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

## Requisitos para completar la bandeja

Además del webhook de control, el workflow y/o un servicio local deben implementar las rutas de inbox de la tabla inicial:

- Guardar mensajes entrantes y metadatos de conversación localmente, deduplicando por ID del mensaje.
- Descargar fotos, audios y videos a un directorio dedicado de la PC n8n y servirlos mediante HTTPS local.
- Enviar respuestas humanas por YCloud desde `/crm-inbox/reply`; confirmar éxito solo si YCloud acepta el envío.
- Validar las notificaciones entrantes de YCloud y limitar tipos/tamaños de archivos.
- Configurar IP LAN estable, DNS local y certificado HTTPS válido. Restringe CORS a `https://crm.fullpiston.com` y permite el encabezado `Authorization`.
- Respaldar la base local y el directorio de multimedia. Los datos de `$getWorkflowStaticData('global')` pueden no ser suficientes si necesitas consistencia ante reinicios o ejecuciones concurrentes.

La pestaña web y sus llamadas están preparadas, pero las rutas de inbox y el control no están desplegados solo por ejecutar el workflow exportado.
