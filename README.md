# Inventario Camila

Aplicación web estática de inventario y ventas. Usa Supabase para autenticación y almacenamiento, y puede publicarse en GitHub Pages.

## Requisitos

- Un proyecto Supabase.
- Una cuenta de GitHub con GitHub Pages habilitado para el repositorio.
- Python 3 (solo para servir la aplicación localmente).

## Configuración de Supabase

1. En Supabase, abre **Project Settings > API** y localiza la URL del proyecto y la clave **publishable** (o la clave `anon` heredada).
2. Revisa `SUPABASE_URL` y `SUPABASE_KEY` al inicio de `js/app-core.js` y configúralas para tu proyecto.
3. En **SQL Editor**, ejecuta `supabase-pedidos.sql` solo para configurar o actualizar las funciones de pedidos, clientes, estadísticas y caja. Este archivo contiene cambios de esas áreas; no lo ejecutes para configurar WhatsApp.
4. En **Authentication > URL Configuration**, configura **Site URL** con la dirección pública de la aplicación y agrega a **Redirect URLs** la URL exacta donde se sirve `index.html` (incluida la ruta del repositorio en GitHub Pages, si corresponde), además de las URL locales que uses. La opción de recuperación solicita volver a esa misma página; si la URL no está permitida, Supabase puede usar Site URL y llevar a una página que no existe.
5. En la plantilla **Reset Password** de **Authentication > Email Templates**, conserva el enlace de Supabase `{{ .ConfirmationURL }}`; no lo reemplaces por una ruta fija o inexistente.
6. Comprueba que las políticas RLS y los roles de usuario estén configurados antes de operar con datos reales.

El enlace de recuperación enviado por correo vuelve a la aplicación con una sesión temporal de Supabase. Desde allí se puede definir y confirmar la nueva contraseña; al guardarla, Supabase actualiza las credenciales de la cuenta.

La clave que se usa en el navegador debe ser pública (`publishable`/`anon`). **Nunca** incluyas una clave `service_role` o un secreto privado en estos archivos. La clave pública no sustituye las políticas RLS.

Para que las estadísticas incluyan descargos individuales, ejecuta `supabase-estadisticas.sql` por separado en SQL Editor. Registra el precio seleccionado en cada nuevo descargo sin comprobante y lo suma como venta; los descargos vinculados a un comprobante se excluyen para evitar duplicados. Los descargos anteriores a este cambio no se valoran retroactivamente porque no guardaban el precio seleccionado. Las estadísticas siguen siendo independientes del cierre de caja. La función de productos más vendidos también devuelve todos los productos individualmente, ordenados de mayor a menor; vuelve a ejecutar este archivo (o `supabase-pedidos.sql`) para aplicar esa actualización en Supabase.

Para comprobar si existen ventas guardadas hoy (cambia la zona horaria por la de la caja):

```sql
select tipo, count(*) as comprobantes, coalesce(sum(total), 0) as total
from public.pedidos
where (fecha at time zone 'America/Guayaquil')::date =
  (now() at time zone 'America/Guayaquil')::date
group by tipo;
```

La consulta solo muestra comprobantes de venta; los descargos individuales se contabilizan aparte en las estadísticas desde que se despliegue la actualización. El cierre de caja no determina cuáles aparecen.

### Bandeja de WhatsApp para el personal

La guía independiente con los pasos para configurar n8n, cambiar la URL POST de derivación y conectar los controles está en [README-WHATSAPP.md](./README-WHATSAPP.md).

La pestaña WhatsApp ahora es una cola de atención: muestra los chats pendientes en orden de llegada, sin mensajes ni archivos multimedia. El botón permite activar o desactivar el bot global; cada respuesta humana detectada cierra ese chat, pero mantiene su pausa hasta medianoche. En el reinicio diario solo se reactivan los chats con respuesta registrada; los demás siguen pausados. Consulta la configuración de YCloud y n8n en [README-WHATSAPP.md](./README-WHATSAPP.md). Supabase se conserva para el inicio de sesión de los empleados; para autorizar los webhooks locales, ejecuta únicamente `supabase-whatsapp.sql`, que no modifica inventario, productos, pedidos ni tablas existentes.

#### Acceso local seguro

1. Asigna una IP fija a la PC de n8n y un nombre interno, por ejemp
lo `n8n.crm.fullpiston.com`.
2. En el DNS del router o servidor DNS del local, resuelve ese nombre a la IP LAN de n8n. Configura un certificado HTTPS válido en el proxy local (por ejemplo Caddy con certificado ACME DNS-01). No uses HTTP: la plataforma se abre por HTTPS.
3. Configura el proxy local para permitir CORS únicamente desde `https://crm.fullpiston.com` y el encabezado `Authorization`. Si el navegador solicita permiso para acceder a la red local, permite el acceso para esa plataforma.
4. En `js/whatsapp.js`, asigna `N8N_LOCAL_API_BASE_URL` a ese origen HTTPS local. Este valor es una dirección, no una clave secreta.
5. El navegador envía el token de sesión Supabase en `Authorization: Bearer ...`. El webhook de control de n8n debe validarlo llamando `public.usuario_es_personal()` con el mismo token (cabecera `apikey` con la clave pública de Supabase); rechaza la petición si la RPC no devuelve `true`. No uses una clave `service_role` ni un secreto compartido en el JavaScript del navegador.

La resolución local del hostname permite que la interfaz siga abriéndose en `crm.fullpiston.com`, pero el navegador carga adjuntos desde la LAN, no desde Cloudflare. Si falla DNS local o n8n está apagado, la bandeja y los adjuntos no estarán disponibles. Configura copias de seguridad de la base local y del directorio de multimedia.

#### Control de pausa individual y global en n8n

Configura un webhook **POST** `crm-bot-control`, conectado al nodo de código que modifica el mismo `$getWorkflowStaticData('global')` usado por `Normalizar mensaje`. El cuerpo aceptado por la pestaña es:

```json
{"scope":"global","action":"pause"}
{"scope":"global","action":"resume"}
{"scope":"customer","action":"pause","phone":"+593999999999"}
{"scope":"customer","action":"resume","phone":"+593999999999"}
{"scope":"global","action":"status"}
```

El nodo de control debe comprobar primero la sesión del empleado; validar `scope`, `action` y el teléfono; guardar el interruptor global como `data.botGlobalPausado`; y guardar/quitar los clientes en `data.pausados` usando la misma clave numérica normalizada que `Normalizar mensaje`. Devuelve JSON con `ok`, `bot_global_pausado` y `pausados_ahora`. En `Normalizar mensaje` y `Clasificar lote`, comprueba el interruptor global además de la pausa por cliente antes de permitir que responda el bot. Al reactivar globalmente, conserva las pausas individuales que sigan vigentes.

Para validar la sesión sin publicar secretos en el navegador, conecta el webhook a un nodo **HTTP Request** que haga `POST` a `https://<proyecto>.supabase.co/rest/v1/rpc/usuario_es_personal`. Envía `apikey` con la clave pública de Supabase, `Authorization` con `={{ $('Webhook reactivar').first().json.headers.authorization }}` y `Content-Type: application/json`, con cuerpo `{}`. Después verifica que la respuesta sea `true` antes de ejecutar el nodo que cambia el estado; si no, detén el flujo sin modificar nada. Configura la URL y clave pública como variables/credenciales de n8n. El workflow de ejemplo todavía no trae conectado este webhook: hay que añadirlo y activar el flujo antes de usar los controles.

El código del nodo de control puede seguir esta lógica:

```javascript
const input = $('Webhook reactivar').first().json;
const body = input.body || {};
const data = $getWorkflowStaticData('global');
if (!data.pausados) data.pausados = {};

const scope = String(body.scope || '');
const action = String(body.action || '');
const phone = String(body.phone || '').replace(/\D/g, '');

if (action === 'status') {
  return [{ json: {
    ok: true,
    bot_global_pausado: Boolean(data.botGlobalPausado),
    pausados_ahora: Object.values(data.pausados)
  } }];
}

if (!['pause', 'resume'].includes(action) || !['global', 'customer'].includes(scope)) {
  throw new Error('Acción de control no válida.');
}
if (scope === 'customer' && (phone.length < 7 || phone.length > 15)) {
  throw new Error('El teléfono no es válido.');
}

if (scope === 'global') {
  data.botGlobalPausado = action === 'pause';
} else if (action === 'pause') {
  data.pausados[phone] = {
    numero: '+' + phone,
    nombre: String(body.name || ''),
    motivo: 'pausa_manual',
    desde: new Date().toISOString()
  };
} else {
  delete data.pausados[phone];
}

return [{ json: {
  ok: true,
  bot_global_pausado: Boolean(data.botGlobalPausado),
  pausados_ahora: Object.values(data.pausados)
} }];
```

En `Normalizar mensaje`, calcula `pausado` como `Boolean(data.botGlobalPausado || (data.pausados && data.pausados[cliente]))`; la rama pausada debe guardar el mensaje en la bandeja local y no llamar al agente. Revisa de nuevo el estado global e individual en `Clasificar lote` por si el bot se pausó mientras el lote esperaba su ventana de agrupación.

En el workflow compartido, `Webhook reactivar` está sin parámetros ni conexión. Configúralo como POST en `/webhook/crm-bot-control`, conecta primero la validación de sesión y luego el nodo de código de control mostrado arriba; configura la respuesta HTTP para devolver el JSON del último nodo. La cola llama a estos endpoints relativos al origen local:

- `POST /webhook/crm-bot-control` para consultar o cambiar pausas. Para la consulta envía `{"scope":"global","action":"status"}`; también devuelve la lista de clientes pausados.
- `GET /webhook/crm-inbox/conversations?status=abiertas` para listar los chats pendientes en orden por `recibido_en` y devolver `bot_global_pausado`.
- `POST /webhook/crm-inbox/resolve` con `{"conversation_id":"<id>","action":"resolve"}` para marcar un chat atendido y reactivar solamente a ese cliente.

La interfaz no solicita mensajes ni muestra multimedia. Los chats deben persistirse localmente con su hora inicial de llegada a la cola; conserva `data.pausados` para los clientes que todavía no se han atendido. Un Schedule Trigger de n8n debe reactivar solo el interruptor global diariamente a medianoche de `America/Guayaquil`, sin limpiar las pausas individuales. Consulta [README-WHATSAPP.md](./README-WHATSAPP.md) para el endpoint autenticado de resolución y los pasos del programador.

La configuración HTTPS/CORS de LAN y los endpoints de lista, resolución y control deben estar activos en n8n para completar este flujo.

El export n8n compartido contiene una clave de API incrustada: revócala o rótala y reemplázala por una credencial de n8n antes de volver a activar ese flujo. Las llamadas de WhatsApp quedan fuera de esta etapa.

## Ejecutar localmente

Desde la carpeta del proyecto, inicia un servidor HTTP:

```powershell
python -m http.server 8000
```

Abre <http://localhost:8000>. No abras `index.html` directamente como archivo: la aplicación carga scripts, estilos y recursos externos y debe servirse por HTTP.

## Publicar en GitHub Pages

1. Confirma que `index.html`, `css/`, `js/` y `supabase-pedidos.sql` estén en la rama que publicarás.
2. En GitHub, abre **Settings > Pages** y elige la rama y la carpeta raíz del proyecto (o la fuente de despliegue configurada por el repositorio).
3. Espera a que termine el despliegue y abre la URL indicada por GitHub Pages.
4. Añade esa URL, incluyendo la ruta del repositorio si corresponde, a las URL permitidas de Supabase Authentication.
5. Prueba el inicio de sesión, escaneo, inventario, ventas y cierre de caja con las cuentas y permisos apropiados.

Las estadísticas ofrecen tres periodos: hoy, los últimos siete días (incluido hoy) y cada día del mes actual. El control secundario cambia entre barras de ventas y el gráfico circular de unidades vendidas por producto. El gráfico circular muestra primero el producto más vendido. El menú **Cierre de caja** suma pedidos, unidades y totales desde el cierre anterior (aunque el periodo cruce medianoche), y muestra aparte los movimientos de descargo de productos desde ese mismo cierre; estos movimientos no se agregan al total de ventas. Los descargos solo se vinculan a un comprobante al guardarlo o imprimirlo, priorizando el usuario autenticado y el momento de cada escaneo; si la coincidencia no es única, quedan como movimientos individuales. Al registrar un cierre, el siguiente periodo comienza en ese momento. En **Inventario**, los administradores pueden eliminar productos con ×; no se puede eliminar un producto incluido en un combo activo ni uno presente en el pedido abierto. El menú **Crear combos** permite a los administradores guardar combos compartidos con un precio fijo, ver las existencias de sus productos e imprimir el listado de combos. En el escáner, cualquier usuario puede seleccionar un combo para una entrada o un descargo; se registra una sola línea en el comprobante y se actualiza el inventario de cada componente. Las líneas de pedido se pueden quitar con ×; la aplicación revierte sus movimientos de inventario. El menú **Revisar comprobantes** permite consultar ventas y entradas de una fecha y desplegar el detalle de cada comprobante. Para imprimir etiquetas se puede elegir entre 52 × 23 mm y 32 × 25 mm; para comprobantes, rollos de 58 mm o 78 mm. El tamaño seleccionado se recuerda en el navegador y se envían las dimensiones exactas con márgenes de página en cero. Guardar o imprimir un comprobante persiste sus datos y los del cliente en Supabase; guardar permite volver a descargar el PDF con el nombre del cliente y la fecha/hora del pedido.

Las referencias a CSS y JavaScript son relativas para que también funcionen cuando el sitio se publica bajo una ruta de repositorio.

## Estructura

- `index.html`: estructura de la página y vistas/pestañas.
- `css/styles.css`: estilos de la aplicación.
- `js/app-core.js`: configuración, sesión, navegación y estado compartido.
- `js/scanner.js`: escaneo y búsqueda de productos.
- `js/combos.js`: administración, selección y registro de combos.
- `js/comprobante.js`: comprobantes y pedidos.
- `js/etiquetas.js`: impresión de etiquetas.
- `js/inventario.js`: administración e inventario.
- `js/ventas-caja.js`: estadísticas de ventas y cierre de caja.
- `js/codigos.js`: creación de códigos.
- `js/whatsapp.js`: bandeja de conversaciones derivadas y respuestas del personal.
- `README-WHATSAPP.md`: guía independiente de la integración WhatsApp y sus nodos n8n.
- `js/app-init.js`: inicialización de autenticación al cargar la aplicación.
- `supabase-pedidos.sql`: tablas, políticas y funciones de Supabase para pedidos, estadísticas y caja.
- `supabase-estadisticas.sql`: registro del precio de descargos individuales y actualización aislada de estadísticas; no modifica existencias ni comprobantes.
- `supabase-whatsapp.sql`: función de validación de personal para la integración local de WhatsApp; no modifica inventario ni pedidos.

Los archivos JavaScript se cargan como scripts clásicos y en orden desde `index.html`; conservan funciones globales usadas por los manejadores HTML. Al añadir o mover una función, verifica sus dependencias y mantén ese orden.
