// ---------- VENTAS Y CIERRE DE CAJA ----------
const fechaLocalISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const zonaHorariaLocal = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
function fechaDesdeISO(valor) {
  const [y, m, d] = valor.split('-').map(Number);
  return new Date(y, m - 1, d);
}
let tipoGraficaVentas = 'barras';
let filasVentas = [];
let productosVentas = [];
let solicitudEstadisticasVentas = 0;
let solicitudDetallePedido = 0;
let botonDetalleAbierto = null;
function estadoDe(id, mensaje, clase = '') {
  $(id).className = clase;
  $(id).textContent = mensaje;
}
function seleccionarTipoGraficaVentas(tipo) {
  if (!['barras', 'pastel'].includes(tipo)) return;
  tipoGraficaVentas = tipo;
  document.querySelectorAll('[data-grafica]').forEach(button => {
    const activo = button.dataset.grafica === tipo;
    button.classList.toggle('activo', activo);
    button.setAttribute('aria-pressed', String(activo));
  });
  pintarGraficaVentas();
}
function seleccionarPeriodoVentas(periodo) {
  if (!['dia', 'semana', 'mes'].includes(periodo)) return;
  document.querySelectorAll('[data-periodo]').forEach(button => {
    const activo = button.dataset.periodo === periodo;
    button.classList.toggle('activo', activo);
    button.setAttribute('aria-pressed', String(activo));
  });
  $('periodoVentas').value = periodo;
  return cargarEstadisticasVentas();
}
async function cargarEstadisticasVentas() {
  if (!esAdmin) return;
  const solicitud = ++solicitudEstadisticasVentas;
  const periodo = $('periodoVentas').value || 'dia';
  const fecha = fechaLocalISO();
  filasVentas = [];
  productosVentas = [];
  $('graficaVentas').className = 'chart-area-content chart';
  $('graficaVentas').replaceChildren();
  estadoDe('ventasEstado', 'Cargando ventas…');
  try {
    const argumentos = { p_periodo: periodo, p_fecha: fecha, p_zona: zonaHorariaLocal() };
    const [ventas, productos] = await Promise.all([
      db.rpc('estadisticas_ventas', argumentos),
      db.rpc('productos_mas_vendidos', argumentos)
    ]);
    if (solicitud !== solicitudEstadisticasVentas) return;
    if (ventas.error) throw ventas.error;
    if (productos.error) throw productos.error;
    filasVentas = ventas.data || [];
    productosVentas = productos.data || [];
    const total = filasVentas.reduce((s, f) => s + Number(f.total || 0), 0);
    const pedidosTotales = filasVentas.reduce((s, f) => s + Number(f.pedidos || 0), 0);
    $('ventasResumen').textContent = `${fmt(total)} · ${pedidosTotales} pedido(s)`;
    pintarGraficaVentas();
    estadoDe('ventasEstado', filasVentas.some(f => Number(f.pedidos) > 0) ? '' : 'No hay ventas en el periodo.');
  } catch (e) {
    if (solicitud !== solicitudEstadisticasVentas) return;
    $('graficaVentas').replaceChildren();
    estadoDe('ventasEstado', 'No se pudieron cargar las estadísticas: ' + e.message, 's');
    console.error('Error al cargar estadísticas de ventas:', e);
  }
}
function pintarGraficaVentas() {
  const grafica = $('graficaVentas');
  grafica.className = 'chart-area-content';
  if (tipoGraficaVentas === 'pastel') {
    pintarPastelVentas(grafica);
    return;
  }
  grafica.classList.add('chart');
  grafica.setAttribute('aria-label', 'Ventas agrupadas por periodo');
  const periodo = $('periodoVentas').value || 'dia';
  const maximo = Math.max(0, ...filasVentas.map(f => Number(f.total || 0)));
  grafica.innerHTML = filasVentas.map(f => {
    const fechaBarra = fechaDesdeISO(f.periodo);
    const etiqueta = periodo === 'dia'
      ? 'Hoy'
      : periodo === 'mes'
        ? String(fechaBarra.getDate())
        : fechaBarra.toLocaleDateString('es', { day: '2-digit', month: '2-digit' });
    const valor = Number(f.total || 0), alto = maximo ? Math.max(2, valor / maximo * 100) : 2;
    return `<div class="bar-col" title="${esc(etiqueta)}: ${fmt(valor)} · ${Number(f.pedidos || 0)} pedido(s)">
      <span class="bar-value">${esc(fmt(valor))}</span><div class="bar" style="height:${alto}%"></div>
      <span class="bar-label">${esc(etiqueta)}</span>
    </div>`;
  }).join('');
}
function pintarPastelVentas(grafica) {
  grafica.classList.add('pie-view');
  grafica.setAttribute('aria-label', 'Productos vendidos por unidades');
  const colores = ['#8f178e', '#e25174', '#f39c36', '#2f8a5c', '#3483c5', '#6844a5', '#d2b52b', '#267d80', '#a94b32'];
  const productos = productosVentas
    .filter(p => Number(p.unidades) > 0)
    .slice()
    .sort((a, b) => Number(b.unidades) - Number(a.unidades)
      || String(a.producto || '').localeCompare(String(b.producto || ''), 'es')
      || String(a.codigo || '').localeCompare(String(b.codigo || ''), 'es'));
  const total = productos.reduce((suma, p) => suma + Number(p.unidades), 0);
  if (!total) {
    grafica.innerHTML = '<p class="pie-empty">No hay productos vendidos en este periodo.</p>';
    return;
  }
  let acumulado = 0;
  const gradiente = productos.map((p, i) => {
    const inicio = acumulado / total * 100;
    acumulado += Number(p.unidades);
    return `${colores[i % colores.length]} ${inicio}% ${acumulado / total * 100}%`;
  }).join(', ');
  const masVendido = productos[0];
  grafica.innerHTML = `<div class="pie-layout">
    <div class="pie-chart-wrap">
      <div class="pie-chart" role="img" aria-label="Gráfico circular: ${total} unidades vendidas" style="background:conic-gradient(${gradiente})"></div>
    </div>
    <div class="pie-summary"><strong>Más vendido</strong><span>${esc(masVendido.producto)}</span><b>${Number(masVendido.unidades)} unidad(es)</b></div>
    <ul class="pie-legend">${productos.map((p, i) =>
      `<li><span class="pie-swatch" style="--pie-color:${colores[i % colores.length]}"></span><span class="pie-name" title="${esc(p.producto)}">${esc(p.producto)}</span><b>${Number(p.unidades)}</b></li>`
    ).join('')}</ul>
  </div>`;
}
async function cargarCaja() {
  if (!uidActual) return;
  cerrarDetallePedido();
  const fecha = $('fechaCaja').value || fechaLocalISO();
  $('cajaPedidos').innerHTML = '';
  $('descargosCaja').innerHTML = '';
  $('cierresCaja').innerHTML = '';
  estadoDe('cajaEstado', 'Cargando ventas y descargos del día…');
  try {
    const [ventas, cierres, resumen, descargos] = await Promise.all([
      db.rpc('ventas_caja_dia', { p_fecha: fecha, p_zona: zonaHorariaLocal() }),
      db.rpc('historial_cierres_caja', { p_fecha: fecha }),
      db.rpc('resumen_caja_dia', { p_fecha: fecha, p_zona: zonaHorariaLocal() }),
      db.rpc('descargos_caja_dia', { p_fecha: fecha, p_zona: zonaHorariaLocal() })
    ]);
    if (ventas.error) throw ventas.error;
    if (cierres.error) throw cierres.error;
    if (resumen.error) throw resumen.error;
    if (descargos.error) throw descargos.error;
    const filas = ventas.data || [];
    const filasDescargos = descargos.data || [];
    const datosResumen = (resumen.data || [])[0] || {};
    const total = Number(datosResumen.total || 0);
    const unidades = Number(datosResumen.unidades || 0);
    const numeroPedidos = Number(datosResumen.pedidos || 0);
    $('cajaResumen').textContent = `${numeroPedidos} pedido(s) · ${unidades} unidad(es) · ${fmt(total)}` +
      (filas.length < numeroPedidos ? ` · mostrando ${filas.length} pedidos recientes` : '');
    $('cajaPedidos').innerHTML = filas.map(p => `<tr>
      <td>${esc(new Date(p.fecha).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }))}</td>
      <td>${esc(p.usuario || '')}</td><td>${esc(p.cliente_nombre || 'Consumidor final')}</td>
      <td>${Number(p.unidades || 0)}</td><td>${fmt(p.total)}</td>
      <td><button type="button" aria-expanded="false" data-detalle-pedido="${esc(p.numero)}">Ver detalle</button></td>
    </tr>`).join('');
    $('descargosCaja').innerHTML = filasDescargos.map(m => `<tr>
      <td>${esc(new Date(m.created_at).toLocaleString('es'))}</td>
      <td>${esc(m.usuario || '')}</td><td>${esc(m.nombre || '')}</td>
      <td>${Math.abs(Number(m.cantidad || 0))}</td>
      <td>${m.numero_comprobante
        ? `<button type="button" aria-expanded="false" data-detalle-pedido="${esc(m.numero_comprobante)}">Ver comprobante</button>`
        : '—'}</td>
    </tr>`).join('') || '<tr><td colspan="5">No hay descargos desde el último cierre.</td></tr>';
    const historial = cierres.data || [];
    $('cierresCaja').innerHTML = historial.map(c => `<tr>
      <td>${esc(new Date(c.cerrado_en).toLocaleString())}</td><td>${esc(c.cerrado_por || '')}</td>
      <td>${Number(c.pedidos || 0)}</td><td>${Number(c.unidades || 0)}</td>
      <td>${fmt(c.total)}</td><td>${esc(c.novedades || 'Sin novedades')}</td>
    </tr>`).join('') || '<tr><td colspan="6">Todavía no hay cierres registrados para esta fecha.</td></tr>';
    estadoDe('cajaEstado', filas.length || filasDescargos.length ? '' : 'No hay ventas ni descargos registrados para esta fecha.');
  } catch (e) {
    estadoDe('cajaEstado', 'No se pudo cargar el cierre de caja: ' + e.message, 's');
    console.error('Error al cargar cierre de caja:', e);
  }
}
document.addEventListener('click', e => {
  const button = e.target.closest('[data-detalle-pedido]');
  if (button) verDetallePedido(button);
});
function cerrarDetallePedido() {
  solicitudDetallePedido++;
  if (!botonDetalleAbierto) return;
  const filaDetalle = botonDetalleAbierto.closest('tr').nextElementSibling;
  if (filaDetalle && filaDetalle.hasAttribute('data-detalle-fila')) filaDetalle.remove();
  botonDetalleAbierto.setAttribute('aria-expanded', 'false');
  botonDetalleAbierto.textContent = 'Ver detalle';
  botonDetalleAbierto = null;
}
async function verDetallePedido(boton) {
  if (boton === botonDetalleAbierto) {
    cerrarDetallePedido();
    return;
  }
  cerrarDetallePedido();
  const numero = boton.dataset.detallePedido;
  const solicitud = ++solicitudDetallePedido;
  botonDetalleAbierto = boton;
  boton.setAttribute('aria-expanded', 'true');
  boton.textContent = 'Ocultar detalle';
  const filaDetalle = document.createElement('tr');
  filaDetalle.dataset.detalleFila = '';
  const columnas = boton.closest('table').querySelectorAll('thead th').length;
  filaDetalle.innerHTML = `<td colspan="${columnas}"><div class="pedido-detalle"><p role="status">Cargando detalle…</p></div></td>`;
  boton.closest('tr').after(filaDetalle);
  let resultado;
  try {
    resultado = await db.rpc('detalle_pedido', { p_numero: numero });
  } catch (error) {
    if (solicitud !== solicitudDetallePedido || !filaDetalle.isConnected) return;
    filaDetalle.querySelector('[role="status"]').className = 's';
    filaDetalle.querySelector('[role="status"]').textContent = 'No se pudo cargar el detalle: ' + error.message;
    console.error('Error al cargar detalle del pedido:', error);
    return;
  }
  const { data, error } = resultado;
  if (solicitud !== solicitudDetallePedido || !filaDetalle.isConnected) return;
  if (error) {
    filaDetalle.querySelector('[role="status"]').className = 's';
    filaDetalle.querySelector('[role="status"]').textContent = 'No se pudo cargar el detalle: ' + error.message;
    return;
  }
  if (!data || !data.length) {
    filaDetalle.querySelector('[role="status"]').textContent = 'No encontramos ese pedido.';
    return;
  }
  const p = data[0];
  const lineas = (p.lineas || []).map(l => `<tr>
    <td>${esc(l.codigo)}</td><td>${esc(l.nombre)}</td><td>${Number(l.cantidad || 0)}</td>
    <td>${l.precio_unitario == null ? '—' : fmt(l.precio_unitario)}</td><td>${fmt(l.subtotal)}</td>
  </tr>`).join('');
  filaDetalle.querySelector('td').innerHTML = `<div class="pedido-detalle">
    <strong>Detalle de ${esc(numero)} · ${esc(p.cliente_nombre || 'Consumidor final')}</strong>
    <div class="lista"><table class="detalle-lineas"><thead><tr><th>Código</th><th>Producto</th><th>Cantidad</th><th>Precio</th><th>Subtotal</th></tr></thead><tbody>${lineas}</tbody></table></div>
    <p class="caja-total">Total: ${fmt(p.total)}</p>
  </div>`;
}
async function cargarComprobantes() {
  if (!uidActual) return;
  cerrarDetallePedido();
  const fecha = $('fechaComprobantes').value || fechaLocalISO();
  $('comprobantesPedidos').replaceChildren();
  estadoDe('comprobantesEstado', 'Cargando comprobantes…');
  try {
    const { data, error } = await db.rpc('comprobantes_dia', {
      p_fecha: fecha, p_zona: zonaHorariaLocal()
    });
    if (error) throw error;
    const filas = data || [];
    $('comprobantesPedidos').innerHTML = filas.map(p => `<tr>
      <td>${esc(new Date(p.fecha).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }))}</td>
      <td>${esc(p.numero)}</td><td>${p.tipo === 'entrada' ? 'Entrada' : 'Venta'}</td>
      <td>${esc(p.usuario || '')}</td>
      <td>${esc(p.cliente_nombre || 'Consumidor final')}</td>
      <td>${Number(p.unidades || 0)}</td><td>${fmt(p.total)}</td>
      <td><button type="button" aria-expanded="false" data-detalle-pedido="${esc(p.numero)}">Ver detalle</button></td>
    </tr>`).join('');
    estadoDe('comprobantesEstado', filas.length
      ? `${filas.length} comprobante(s)${filas.length === 5000 ? ' · mostrando los 5000 más recientes' : ''}.`
      : 'No hay comprobantes para esta fecha.');
  } catch (e) {
    estadoDe('comprobantesEstado', 'No se pudieron cargar los comprobantes: ' + e.message, 's');
    console.error('Error al cargar comprobantes:', e);
  }
}
async function cerrarCajaSinNovedades() {
  if (!uidActual) return;
  if (!confirm('¿Registrar el cierre global de caja para esta fecha como «Sin novedades»?')) return;
  const boton = $('btnCerrarCaja');
  boton.disabled = true;
  estadoDe('cajaEstado', 'Guardando cierre…');
  try {
    const { data, error } = await db.rpc('cerrar_caja_sin_novedades', {
      p_fecha: $('fechaCaja').value || fechaLocalISO(),
      p_zona: zonaHorariaLocal()
    });
    if (error) throw error;
    if (!data || !data.length) throw new Error('No se recibió confirmación del cierre.');
    estadoDe('cajaEstado', `Cierre guardado por ${data[0].cerrado_por} a las ${new Date(data[0].cerrado_en).toLocaleString()}.`, 'e');
    await cargarCaja();
    estadoDe('cajaEstado', 'Cierre guardado correctamente.', 'e');
  } catch (e) {
    estadoDe('cajaEstado', 'No se pudo guardar el cierre: ' + e.message, 's');
    console.error('Error al registrar cierre de caja:', e);
  } finally {
    boton.disabled = false;
  }
}
