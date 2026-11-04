# Inventario Camila

Aplicación web estática de inventario y ventas. Usa Supabase para autenticación y almacenamiento, y puede publicarse en GitHub Pages.

## Requisitos

- Un proyecto Supabase.
- Una cuenta de GitHub con GitHub Pages habilitado para el repositorio.
- Python 3 (solo para servir la aplicación localmente).

## Configuración de Supabase

1. En Supabase, abre **Project Settings > API** y localiza la URL del proyecto y la clave **publishable** (o la clave `anon` heredada).
2. Revisa `SUPABASE_URL` y `SUPABASE_KEY` al inicio de `js/app-core.js` y configúralas para tu proyecto.
3. En **SQL Editor**, ejecuta el contenido completo de `supabase-pedidos.sql`. Vuelve a ejecutar el archivo después de actualizarlo para aplicar cambios al esquema y las funciones de pedidos, clientes, estadísticas y caja. La versión actual guarda ventas y entradas, permite actualizar un comprobante existente y buscar clientes por nombre. Hazlo en el proyecto correcto y conserva una copia de seguridad antes de aplicar cambios a una base de datos que ya tenga información.
4. En **Authentication**, crea las cuentas de los usuarios y configura las URL de redirección para el dominio local y el de GitHub Pages.
5. Comprueba que las políticas RLS y los roles de usuario estén configurados antes de operar con datos reales.

La clave que se usa en el navegador debe ser pública (`publishable`/`anon`). **Nunca** incluyas una clave `service_role` o un secreto privado en estos archivos. La clave pública no sustituye las políticas RLS.

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

Las estadísticas ofrecen tres periodos: hoy, los últimos siete días (incluido hoy) y cada día del mes actual. El control secundario cambia entre barras de ventas y el gráfico circular de unidades vendidas por producto. El gráfico circular muestra primero el producto más vendido. El menú **Cierre de caja** suma pedidos, unidades y totales desde el cierre anterior (aunque el periodo cruce medianoche); al registrar un cierre, el siguiente periodo comienza en ese momento. El menú **Crear combos** permite a los administradores guardar combos compartidos con un precio fijo y ver las existencias de sus productos. En el escáner, cualquier usuario puede seleccionar un combo para una entrada o un descargo; se registra una sola línea en el comprobante y se actualiza el inventario de cada componente. Las líneas de pedido se pueden quitar con ×; la aplicación revierte sus movimientos de inventario. El menú **Revisar comprobantes** permite consultar ventas y entradas de una fecha y desplegar el detalle de cada comprobante. Para imprimir etiquetas se puede elegir entre 52 × 23 mm y 32 × 25 mm; para comprobantes, rollos de 58 mm o 78 mm. El tamaño seleccionado se recuerda en el navegador y se envían las dimensiones exactas con márgenes de página en cero. Guardar o imprimir un comprobante persiste sus datos y los del cliente en Supabase; guardar permite volver a descargar el PDF con el nombre del cliente y la fecha/hora del pedido.

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
- `js/app-init.js`: inicialización de autenticación al cargar la aplicación.
- `supabase-pedidos.sql`: tablas, políticas y funciones de Supabase para pedidos, estadísticas y caja.

Los archivos JavaScript se cargan como scripts clásicos y en orden desde `index.html`; conservan funciones globales usadas por los manejadores HTML. Al añadir o mover una función, verifica sus dependencias y mantén ese orden.
