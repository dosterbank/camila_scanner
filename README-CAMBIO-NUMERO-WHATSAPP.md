# Cambiar el número de WhatsApp

Esta guía indica qué revisar al reemplazar el número conectado a YCloud. **El número de teléfono y la URL del webhook son datos distintos**: cambiar el número no cambia automáticamente las URLs de n8n. Si se conserva el workflow y su nodo Webhook, normalmente se conserva la URL; solo se actualiza la conexión/remitente del número en YCloud y en los nodos que envían mensajes. Si se crea un webhook nuevo en n8n, hay que copiar su URL de producción a la configuración de YCloud.

## 1. Identifica qué cambió

Antes de editar, confirma con quien administra YCloud:

- Si el nuevo número se conectará a la misma cuenta/proyecto de YCloud o a otra.
- Si se conservará el workflow y el nodo Webhook actual de n8n.
- Si YCloud muestra una URL de callback nueva o si se usará la existente.
- Qué integración se usará para responder: WhatsApp Business App o un Agent de YCloud.

No inventes ni reutilices una URL de prueba. En n8n, las URLs de prueba y de producción son distintas; para el servicio activo se debe usar la **Production URL** de un workflow guardado y activo.

## 2. Webhook entrante de YCloud → n8n

Este webhook entrega a n8n los eventos de WhatsApp, como mensajes entrantes y, según la integración, respuestas salientes del personal.

1. En n8n, abre el workflow que recibe los eventos de YCloud y localiza su nodo **Webhook** de entrada. Si mantienes ese nodo, conserva su **Production URL**.
2. Si creaste un workflow o nodo Webhook nuevo, copia su **Production URL** de n8n. No uses la Test URL.
3. En el panel de YCloud, abre la configuración de **Webhooks** del proyecto o conexión asociado al nuevo número. Pega la URL de producción de n8n en el campo de URL/endpoint del webhook y guarda.
4. Habilita los eventos que correspondan a la integración:
   - WhatsApp Business App: `whatsapp.smb.message.created` y/o `whatsapp.smb.message.echoes`.
   - Agent de YCloud: `whatsapp.echo_message.created` para detectar mensajes salientes del personal.
   - Conserva también los eventos de mensajes entrantes que ya procese el workflow.
5. Si YCloud ofrece una firma (`YCloud-Signature`), valida la firma en el receptor/proxy antes de producción. No asumas que una URL difícil de adivinar autentica el webhook.

**Dónde pegar la URL nueva:** en YCloud, en la URL/endpoint del webhook de eventos. El valor que se copia viene de la **Production URL** del nodo Webhook de entrada en n8n. No va en `js/whatsapp.js` ni en el campo de URL del nodo `Notificar plataforma (pausa)`.

## 3. Remitente de mensajes salientes

El webhook anterior recibe eventos; no define por sí mismo desde qué número se envían respuestas.

- En YCloud, conecta/verifica el nuevo número en la integración correspondiente y confirma que esa integración tiene permisos para enviar mensajes.
- En n8n, revisa los nodos que envían mensajes por la API de YCloud. Actualiza la configuración del número, canal, remitente o identificador de teléfono para que use el nuevo número.
- Actualiza las credenciales de API mediante **Credentials** o variables protegidas de n8n. No guardes claves en el workflow exportado, README, URL del webhook ni JavaScript del navegador.
- Comprueba también cualquier nodo de derivación a una plataforma externa. El nodo `Notificar plataforma (pausa)` envía un POST a un endpoint externo; esa dirección no es el webhook de recepción de YCloud. Cámbiala solo si el endpoint receptor de derivaciones cambió, usando su URL HTTPS completa y el contrato que ese receptor documente.

## 4. Webhooks de la bandeja de atención

Estas rutas son endpoints de control/consulta de la aplicación y **no se cambian solo por reemplazar el número**. La web construye estas direcciones a partir de `N8N_LOCAL_API_BASE_URL` en `js/whatsapp.js`:

| Función de la bandeja | Método y ruta que espera la web | Dónde se configura en n8n |
|---|---|---|
| Consultar, pausar o reactivar el bot | `POST /webhook/crm-bot-control` | Webhook POST de control `crm-bot-control` |
| Listar chats pendientes | `GET /webhook/crm-inbox/conversations?status=abiertas` | Endpoint GET de conversaciones |
| Marcar un chat atendido | `POST /webhook/crm-inbox/resolve` | Endpoint POST de resolución |

Si esos endpoints de n8n también se migran o cambian de hostname, configura `N8N_LOCAL_API_BASE_URL` con el nuevo **origen HTTPS local** de n8n. Las rutas se agregan automáticamente; no pegues rutas completas ni secretos en esa constante. Si solo cambias el número y mantienes el host y los endpoints, no la modifiques.

**En resumen:** si cambias el número y actualizas el webhook de eventos de YCloud en n8n, pero mantienes el mismo host y las mismas rutas de la bandeja, no necesitas cambiar este repositorio. Deja `N8N_LOCAL_API_BASE_URL = 'https://n8n-camila.fullpiston.com'` como está. Esa constante es para las llamadas de la bandeja al n8n local; no es la URL de callback que YCloud usa para enviar eventos.

Cada endpoint local debe conservar la validación del token de sesión del empleado. La recepción de eventos de YCloud y la autenticación de la bandeja son flujos distintos; no expongas el webhook antiguo `Reactivar / ver pausados` sin autorización.

## 5. Activación y prueba

Antes de desconectar el número anterior:

1. Guarda y activa el workflow de n8n; confirma que el nodo Webhook entrante muestra una Production URL y recibe una prueba desde YCloud.
2. Envía un mensaje de prueba al nuevo número. Verifica que el evento llegue a n8n y que una derivación aparezca una sola vez en la cola.
3. Responde desde el canal de personal conectado. Verifica que el evento de salida se correlacione con el teléfono correcto y que el chat se marque según la lógica configurada.
4. Prueba los controles de pausa y **Reactivar todos** desde una sesión de empleado.
5. Revisa los logs de n8n y YCloud. No pegues tokens, claves de API o datos privados en incidencias ni documentación.
6. Desconecta el número anterior solo después de comprobar entrada, salida, derivación y controles con el nuevo número.

El repositorio no incluye el workflow exportado de n8n ni las credenciales de YCloud, por lo que las URLs de producción y los identificadores del nuevo número deben obtenerse de las consolas correspondientes; no deben copiarse de ejemplos.
