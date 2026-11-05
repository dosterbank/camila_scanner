// ---------- COMPROBANTE ----------
const CSS_RECIBO = `.recibo{max-width:320px;margin:0 auto;padding:12px;border:1px dashed #888;background:#fff;color:#000;font:12px/1.35 "Courier New",monospace}
.recibo .cen{text-align:center}.recibo .neg{font-size:1.25em;font-weight:bold}
.recibo hr{border:0;border-top:1px dashed #000;margin:6px 0}
.recibo table{width:100%;border-collapse:collapse}
.recibo th,.recibo td{padding:2px 1px;border:0;vertical-align:top;font-size:inherit;text-align:left}
.recibo th{border-bottom:1px dashed #000}.recibo .d{text-align:right;white-space:nowrap}
.recibo .tot{display:flex;justify-content:space-between;font-weight:bold;font-size:1.25em}`;
document.head.appendChild(Object.assign(document.createElement('style'), { textContent: CSS_RECIBO }));

const ANCHOS_PAPEL_RECIBO = [58, 78];
const CLAVE_ANCHO_PAPEL_RECIBO = 'anchoPapelRecibo';
function anchoPapelRecibo() {
  const ancho = Number($('anchoPapelRecibo').value);
  return ANCHOS_PAPEL_RECIBO.includes(ancho) ? ancho : 78;
}
function cargarAnchoPapelRecibo() {
  try {
    const ancho = Number(localStorage.getItem(CLAVE_ANCHO_PAPEL_RECIBO));
    if (ANCHOS_PAPEL_RECIBO.includes(ancho)) $('anchoPapelRecibo').value = String(ancho);
  } catch (e) {
    $('estadoPedido').className = 's';
    $('estadoPedido').textContent = 'No se pudo leer el tamaño de papel guardado; se usará 78 mm.';
    console.error('Error al leer el tamaño de papel:', e);
  }
}
function guardarAnchoPapelRecibo() {
  try {
    localStorage.setItem(CLAVE_ANCHO_PAPEL_RECIBO, String(anchoPapelRecibo()));
    $('estadoPedido').className = '';
    $('estadoPedido').textContent = '';
  } catch (e) {
    $('estadoPedido').className = 's';
    $('estadoPedido').textContent = 'No se pudo guardar el tamaño de papel en este navegador.';
    console.error('Error al guardar el tamaño de papel:', e);
  }
}
cargarAnchoPapelRecibo();

let clientesEncontrados = [];
const p2 = n => String(n).padStart(2, '0');
const fechaTxt = d => `${p2(d.getDate())}/${p2(d.getMonth() + 1)}/${d.getFullYear()} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`;
const fechaNum = d => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}${String(d.getMilliseconds()).padStart(3, '0')}`;

function htmlRecibo(c) {
  const filas = c.lineas.map(l =>
    `<tr><td>${l.cant}</td><td>${esc(l.nombre)}</td><td class="d">${l.precio == null ? '-' : fmt(l.precio)}</td><td class="d">${fmt(l.sub)}</td></tr>`).join('');
  return `<div class="cen"><div class="neg">Distribuidora Camila</div><b>${c.titulo}</b></div><hr>
<div>N.º: ${esc(c.numero)}</div><div>Fecha: ${fechaTxt(c.fecha)}</div><div>Cliente: ${esc(c.cliente)}</div>${c.doc ? `<div>CI/RUC: ${esc(c.doc)}</div>` : ''}${c.tel ? `<div>Tel.: ${esc(c.tel)}</div>` : ''}${c.correo ? `<div>Correo: ${esc(c.correo)}</div>` : ''}<div>Atendió: ${esc(c.usuario)}</div><hr>
<table><thead><tr><th>Cant.</th><th>Descripción</th><th class="d">P.U.</th><th class="d">Subt.</th></tr></thead><tbody>${filas}</tbody></table><hr>
<div class="tot"><span>TOTAL</span><span>${fmt(c.total)}</span></div>
<div>Unidades: ${c.unidades}</div>
${c.sinPrecio ? `<div>* ${c.sinPrecio} producto(s) sin precio no suman al total.</div>` : ''}
${c.venta ? '<hr><div class="cen">¡Gracias por su compra!</div>' : ''}`;
}
function verComprobante() {
  if (!delta) return alert('Primero elige un modo y escanea productos.');
  if (pedido.some(i => ['pendiente', 'quitando', 'error_parcial'].includes(i.estado))) return alert('Espera a que termine o se resuelva la operación de inventario.');
  const ls = lineas();
  if (!ls.length) return alert('No hay productos en el pedido.');
  prepararComprobante();
  $('modalComp').classList.remove('oculto');
  guardarPedido().catch(mostrarErrorGuardado);
}
const DATOS_CLIENTE = ['cliNom', 'cliDoc', 'cliTel', 'cliMail'];
function limpiarCliente() {
  $('cfinal').checked = false; DATOS_CLIENTE.forEach(i => $(i).value = '');
  $('cliNom').disabled = false; $('buscarCliente').value = ''; $('clienteEstado').textContent = '';
  $('clienteResultados').replaceChildren(); clientesEncontrados = [];
}
function hayCliente() { return $('cfinal').checked || DATOS_CLIENTE.some(i => $(i).value.trim()); }
function prepararComprobante() {
  const ahora = new Date(), ls = lineas();
  if (!compActual) compActual = {
    numero: 'C-' + fechaNum(ahora), fecha: ahora, venta: delta < 0,
    titulo: delta < 0 ? 'COMPROBANTE DE VENTA' : 'COMPROBANTE DE ENTRADA',
    usuario: usuarioEmail, cliente: 'Consumidor final', doc: '', tel: '', correo: ''
  };
  compActual.lineas = ls;
  compActual.unidades = ls.reduce((a, l) => a + l.unidades, 0);
  compActual.total = Math.round(ls.reduce((a, l) => a + l.sub, 0) * 100) / 100;
  compActual.sinPrecio = ls.filter(l => l.precio == null).length;
  actualizarComp();
}
function actualizarComp() {
  if (!compActual) return;
  const final = $('cfinal').checked;
  $('cliNom').disabled = final;
  compActual.cliente = final ? 'Consumidor final' : ($('cliNom').value.trim() || 'Consumidor final');
  compActual.doc = $('cliDoc').value.trim();
  compActual.tel = $('cliTel').value.trim();
  compActual.correo = $('cliMail').value.trim();
  $('compVista').innerHTML = htmlRecibo(compActual);
  programarGuardadoPedido();
}
async function buscarClienteAnterior() {
  const entrada = $('buscarCliente').value.trim();
  const esDocumento = /^[\d.\-\s]+$/.test(entrada);
  const documento = entrada ? (entrada.includes('@') || !esDocumento ? '' : entrada) : $('cliDoc').value.trim();
  const correo = entrada ? (entrada.includes('@') ? entrada : '') : $('cliMail').value.trim();
  const nombre = entrada && !entrada.includes('@') && !esDocumento ? entrada : (!entrada ? $('cliNom').value.trim() : '');
  if (!documento && !correo && nombre.length < 2) {
    $('clienteEstado').className = 's';
    $('clienteEstado').textContent = 'Escribe un nombre (al menos 2 caracteres), una cédula/RUC o un correo para buscar.';
    $('clienteResultados').replaceChildren();
    return;
  }
  $('clienteEstado').className = '';
  $('clienteEstado').textContent = 'Buscando cliente…';
  $('clienteResultados').replaceChildren();
  const { data, error } = await db.rpc('buscar_cliente', {
    p_documento: documento || null, p_correo: correo || null, p_nombre: nombre || null
  });
  if (error) {
    $('clienteEstado').className = 's';
    $('clienteEstado').textContent = 'No se pudo buscar el cliente: ' + error.message;
    return;
  }
  if (data && data[0] && data[0].rate_limited) {
    $('clienteEstado').className = 's';
    $('clienteEstado').textContent = 'Demasiadas búsquedas en poco tiempo. Espera un minuto e intenta de nuevo.';
    return;
  }
  if (!data || !data.length) {
    $('clienteEstado').className = '';
    $('clienteEstado').textContent = 'No encontramos un cliente con esos datos.';
    return;
  }
  clientesEncontrados = data;
  $('clienteEstado').className = '';
  $('clienteEstado').textContent = data.length === 1 ? 'Selecciona el cliente encontrado.' : `Encontramos ${data.length} coincidencias. Selecciona el cliente correcto.`;
  $('clienteResultados').innerHTML = data.map((c, i) =>
    `<button type="button" class="cliente-resultado" onclick="seleccionarClienteAnterior(${i})"><span><b>${esc(c.nombre || 'Cliente')}</b><br><small>${esc(c.documento || c.correo || c.telefono || '')}</small></span><span>Seleccionar</span></button>`
  ).join('');
}
function seleccionarClienteAnterior(indice) {
  const c = clientesEncontrados[indice];
  if (!c) return;
  $('cfinal').checked = false;
  $('cliNom').value = c.nombre || '';
  $('cliDoc').value = c.documento || '';
  $('cliTel').value = c.telefono || '';
  $('cliMail').value = c.correo || '';
  $('clienteResultados').replaceChildren();
  $('clienteEstado').className = 'e';
  $('clienteEstado').textContent = 'Cliente recuperado.';
  actualizarComp();
}
function mostrarErrorGuardado(e) {
  $('estadoPedido').className = 's';
  $('estadoPedido').textContent = 'No se pudo guardar el comprobante: ' + e.message;
  console.error('No se pudo guardar el comprobante:', e);
}
function programarGuardadoPedido() {
  clearTimeout(timerGuardado);
  $('estadoPedido').className = '';
  $('estadoPedido').textContent = 'Guardando comprobante…';
  timerGuardado = setTimeout(() => guardarPedido().catch(mostrarErrorGuardado), 600);
}
async function guardarPedido() {
  clearTimeout(timerGuardado);
  if (!compActual) return;
  if (pedido.some(i => ['pendiente', 'quitando', 'error_parcial'].includes(i.estado))) {
    throw new Error('Espera a que terminen las operaciones de inventario antes de guardar el comprobante.');
  }
  const c = compActual;
  const datos = {
    p_numero: c.numero,
    p_fecha: c.fecha.toISOString(),
    p_total: c.total,
    p_unidades: c.unidades,
    p_usuario: c.usuario,
    p_cliente_nombre: c.cliente === 'Consumidor final' ? null : c.cliente,
    p_documento: c.doc || null,
    p_telefono: c.tel || null,
    p_correo: c.correo || null,
    p_tipo: c.venta ? 'venta' : 'entrada',
    p_descargos: pedido.flatMap(i => i.movimientos || [])
  };
  datos.p_lineas = c.lineas.map(l => ({
    codigo: l.codigo, nombre: l.nombre, cantidad: l.cant,
    precio_unitario: l.precio, subtotal: l.sub, tipo_precio: l.precioTipo,
    ...(l.combo ? {
      tipo_linea: 'combo',
      combo_id: l.comboId,
      unidades: l.unidades,
      componentes: l.componentes.map(p => ({ codigo: p.codigo, nombre: p.nombre, cantidad: p.cantidad }))
    } : {})
  }));
  const ejecutar = async () => {
    const { data, error } = await db.rpc('guardar_pedido', datos);
    if (error) throw error;
    if (!data) throw new Error('Se alcanzó el límite de guardados por minuto. Espera antes de volver a intentarlo.');
  };
  const previo = colaGuardado.catch(() => {});
  const actual = previo.then(ejecutar);
  colaGuardado = actual;
  try {
    await actual;
    $('estadoPedido').className = 'e';
    $('estadoPedido').textContent = 'Comprobante guardado en Supabase.';
  } catch (e) {
    mostrarErrorGuardado(e);
    throw e;
  }
}
function compValido() {
  if (compActual.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(compActual.correo)) {
    alert('El correo del cliente no es válido.'); $('cliMail').focus(); return false;
  }
  return true;
}
function cerrarComp() { $('modalComp').classList.add('oculto'); if (!$('codigo').disabled) $('codigo').focus(); }

async function imprimirComprobante() {
  if (!compActual || !compValido()) return;
  const w = window.open('', '_blank'); if (!w) return alert('Permite las ventanas emergentes.');
  try {
    await guardarPedido();
    const ancho = anchoPapelRecibo();
    const css = CSS_RECIBO + `@page{size:${ancho}mm auto;margin:0}html,body{width:${ancho}mm;margin:0;padding:0}.recibo{box-sizing:border-box;max-width:none;width:${ancho}mm;margin:0;padding:3mm;border:.2mm dashed #888;font-size:9pt}`;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(compActual.numero)}</title><style>${css}</style></head><body><div class="recibo">${htmlRecibo(compActual)}</div></body></html>`);
    w.document.close(); w.focus(); setTimeout(() => w.print(), 400);
  } catch (e) {
    w.close();
    $('estadoPedido').className = 's';
    $('estadoPedido').textContent = 'No se pudo preparar la impresión: ' + e.message;
    console.error('Error al preparar la impresión del comprobante:', e);
  }
}
// Dibuja el comprobante al ancho de papel seleccionado; devuelve la altura usada.
function dibujarPDF(doc, c, W) {
  const M = W === 58 ? 3 : 6;
  const X_DESC = W === 58 ? 12 : 15;
  const X_PU = W === 58 ? 38 : 54;
  const X_SUB = W - M;
  const ANCHO_DESC = W === 58 ? 22 : 32;
  let y = 8;
  const centro = (t, s) => { doc.setFontSize(s); doc.text(t, W / 2, y, { align: 'center' }); };
  const par = t => doc.splitTextToSize(t, W - 2 * M).forEach(l => { doc.text(l, M, y); y += 3.6; });
  const raya = () => { doc.setLineWidth(.2); doc.line(M, y, W - M, y); y += 3.8; };
  doc.setFont('helvetica', 'bold'); centro('Distribuidora Camila', 12); y += 5;
  centro(c.titulo, 9); y += 4.5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  raya();
  par('No.: ' + c.numero); par('Fecha: ' + fechaTxt(c.fecha)); par('Cliente: ' + c.cliente); if (c.doc) par('CI/RUC: ' + c.doc); if (c.tel) par('Tel.: ' + c.tel); if (c.correo) par('Correo: ' + c.correo); par('Atendió: ' + c.usuario);
  raya();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
  doc.text('Cant.', M, y); doc.text('Descripción', X_DESC, y); doc.text('P.U.', X_PU, y, { align: 'right' }); doc.text('Subt.', X_SUB, y, { align: 'right' });
  y += 1.8; raya();
  doc.setFont('helvetica', 'normal');
  c.lineas.forEach(l => {
    const partes = doc.splitTextToSize(l.nombre, ANCHO_DESC);
    doc.text(String(l.cant), M, y);
    partes.forEach((t, k) => doc.text(t, X_DESC, y + k * 3.3));
    doc.text(l.precio == null ? '-' : fmt(l.precio), X_PU, y, { align: 'right' });
    doc.text(fmt(l.sub), X_SUB, y, { align: 'right' });
    y += partes.length * 3.3 + 1.2;
  });
  raya(); y += .8;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
  doc.text('TOTAL', M, y); doc.text(fmt(c.total), X_SUB, y, { align: 'right' }); y += 5;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
  doc.text('Unidades: ' + c.unidades, M, y); y += 4;
  if (c.sinPrecio) par(`* ${c.sinPrecio} producto(s) sin precio no suman al total.`);
  if (c.venta) { y += 3; doc.setFont('helvetica', 'bold'); centro('Gracias por su compra', 9); y += 4; }
  return y;
}
async function guardarComprobante() {
  if (!compActual || !compValido()) return;
  if (!window.jspdf) return alert('No se pudo cargar la librería de PDF. Revisa tu conexión a internet.');
  try { await guardarPedido(); }
  catch { return; }
  try {
    const { jsPDF } = window.jspdf;
    const ancho = anchoPapelRecibo();
    const nuevo = h => new jsPDF({ unit: 'mm', format: [ancho, h], orientation: 'portrait' });
    const alto = dibujarPDF(nuevo(3000), compActual, ancho);
    const doc = nuevo(Math.max(alto + 6, 60));
    dibujarPDF(doc, compActual, ancho);
    const nombre = compActual.cliente || 'Consumidor final';
    const archivo = nombre.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').trim().replace(/\s+/g, '-');
    doc.save('comprobante-' + (archivo || 'Consumidor-final') + '-' + fechaNum(compActual.fecha) + '.pdf');
    $('estadoPedido').textContent = 'Comprobante guardado en Supabase y PDF descargado.';
  } catch (e) {
    $('estadoPedido').className = 's';
    $('estadoPedido').textContent = 'Comprobante guardado, pero no se pudo generar el PDF: ' + e.message;
    console.error('No se pudo generar el PDF del comprobante:', e);
  }
}
