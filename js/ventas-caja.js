// ---------- VENTAS Y CIERRE DE CAJA ----------
const fechaLocalISO = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const zonaHorariaLocal = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
function fechaDesdeISO(valor) {
  const [y, m, d] = valor.split('-').map(Number);
  return new Date(y, m - 1, d);
}
function estadoDe(id, mensaje, clase = '') {
  $(id).className = clase;
  $(id).textContent = mensaje;
}
function seleccionarPeriodoVentas(periodo) {
  if (!['dia', 'semana', 'mes'].includes(periodo)) return;
  document.querySelectorAll('.period-option').forEach(button => {
    const activo = button.dataset.periodo === periodo;
    button.classList.toggle('activo', activo);
    button.setAttribute('aria-pressed', String(activo));
  });
  $('periodoVentas').value = periodo;
  cargarEstadisticasVentas();
}
async function cargarEstadisticasVentas() {
  if (!esAdmin) return;
  const periodo = $('periodoVentas').value || 'dia';
  const fecha = fechaLocalISO();
  estadoDe('ventasEstado', 'Cargando ventas…');
  try {
    const { data, error } = await db.rpc('estadisticas_ventas', {
      p_periodo: periodo, p_fecha: fecha, p_zona: zonaHorariaLocal()
    });
    if (error) throw error;
    const filas = data || [];
    const total = filas.reduce((s, f) => s + Number(f.total || 0), 0);
    const pedidosTotales = filas.reduce((s, f) => s + Number(f.pedidos || 0), 0);
    $('ventasResumen').textContent = `${fmt(total)} · ${pedidosTotales} pedido(s)`;
    const maximo = Math.max(0, ...filas.map(f => Number(f.total || 0)));
    $('graficaVentas').innerHTML = filas.map(f => {
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
    estadoDe('ventasEstado', filas.length ? '' : 'No hay ventas en el periodo.');
  } catch (e) {
    estadoDe('ventasEstado', 'No se pudieron cargar las estadísticas: ' + e.message, 's');
    console.error('Error al cargar estadísticas de ventas:', e);
  }
}
async function cargarCaja() {
  if (!uidActual) return;
  const fecha = $('fechaCaja').value || fechaLocalISO();
  $('cajaPedidos').innerHTML = '';
  $('cierresCaja').innerHTML = '';
  estadoDe('cajaEstado', 'Cargando ventas del día…');
  try {
    const [ventas, cierres, resumen] = await Promise.all([
      db.rpc('ventas_caja_dia', { p_fecha: fecha, p_zona: zonaHorariaLocal() }),
      db.rpc('historial_cierres_caja', { p_fecha: fecha }),
      db.rpc('resumen_caja_dia', { p_fecha: fecha, p_zona: zonaHorariaLocal() })
    ]);
    if (ventas.error) throw ventas.error;
    if (cierres.error) throw cierres.error;
    if (resumen.error) throw resumen.error;
    const filas = ventas.data || [];
    const total = Number(resumen.data && resumen.data.total || 0);
    const unidades = Number(resumen.data && resumen.data.unidades || 0);
    const numeroPedidos = Number(resumen.data && resumen.data.pedidos || 0);
    $('cajaResumen').textContent = `${numeroPedidos} pedido(s) · ${unidades} unidad(es) · ${fmt(total)}` +
      (filas.length < numeroPedidos ? ` · mostrando ${filas.length} pedidos recientes` : '');
    $('cajaPedidos').innerHTML = filas.map(p => `<tr>
      <td>${esc(new Date(p.fecha).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }))}</td>
      <td>${esc(p.usuario || '')}</td><td>${esc(p.cliente_nombre || 'Consumidor final')}</td>
      <td>${Number(p.unidades || 0)}</td><td>${fmt(p.total)}</td>
      <td><button type="button" data-detalle-pedido="${esc(p.numero)}">Ver detalle</button></td>
    </tr>`).join('');
    const historial = cierres.data || [];
    $('cierresCaja').innerHTML = historial.map(c => `<tr>
      <td>${esc(new Date(c.cerrado_en).toLocaleString())}</td><td>${esc(c.cerrado_por || '')}</td>
      <td>${Number(c.pedidos || 0)}</td><td>${Number(c.unidades || 0)}</td>
      <td>${fmt(c.total)}</td><td>${esc(c.novedades || 'Sin novedades')}</td>
    </tr>`).join('') || '<tr><td colspan="6">Todavía no hay cierres registrados para esta fecha.</td></tr>';
    estadoDe('cajaEstado', filas.length ? '' : 'No hay ventas registradas para esta fecha.');
  } catch (e) {
    estadoDe('cajaEstado', 'No se pudo cargar el cierre de caja: ' + e.message, 's');
    console.error('Error al cargar cierre de caja:', e);
  }
}
$('cajaPedidos').addEventListener('click', e => {
  const button = e.target.closest('[data-detalle-pedido]');
  if (button) verDetallePedido(button.dataset.detallePedido);
});
async function verDetallePedido(numero) {
  $('detalleTitulo').textContent = 'Pedido ' + numero;
  $('detalleLineas').innerHTML = '';
  $('detalleTotal').textContent = '';
  estadoDe('detalleEstado', 'Cargando detalle…');
  $('modalDetalleCaja').classList.remove('oculto');
  const { data, error } = await db.rpc('detalle_pedido', { p_numero: numero });
  if (error) {
    estadoDe('detalleEstado', 'No se pudo cargar el detalle: ' + error.message, 's');
    return;
  }
  if (!data || !data.length) {
    estadoDe('detalleEstado', 'No encontramos ese pedido.');
    return;
  }
  const p = data[0];
  $('detalleLineas').innerHTML = (p.lineas || []).map(l => `<tr>
    <td>${esc(l.codigo)}</td><td>${esc(l.nombre)}</td><td>${Number(l.cantidad || 0)}</td>
    <td>${l.precio_unitario == null ? '—' : fmt(l.precio_unitario)}</td><td>${fmt(l.subtotal)}</td>
  </tr>`).join('');
  $('detalleTotal').textContent = `Total: ${fmt(p.total)} · Cliente: ${p.cliente_nombre || 'Consumidor final'}`;
  estadoDe('detalleEstado', '');
}
function cerrarDetalleCaja() { $('modalDetalleCaja').classList.add('oculto'); }
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
