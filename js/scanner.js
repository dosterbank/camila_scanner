// ---------- ESCÁNER ----------
function modo(d) {
  if (d > 0 && !esAdmin) return;
  if (pedido.length && delta && d !== delta) {
    alert('Primero pulsa «Nuevo pedido» para cerrar el pedido actual.');
    return;
  }
  if (!delta || !pedido.length) delta = d;
  $('zonaEscaneo').classList.remove('oculto');
  document.body.className = d > 0 ? 'entrada' : 'salida';
  $('modoTxt').textContent = d > 0 ? 'Entradas' : 'Descargos';
  $('codigo').disabled = false; $('codigo').focus();
}
$('codigo').addEventListener('keydown', e => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const codigo = $('codigo').value.trim(); $('codigo').value = '';
  if (!codigo || !delta || bloqueo) return;
  const p = indice.get(codigo);
  // Código que ya existe pero sin nombre: no se registra nada hasta ponerle nombre
  if (p && sinNombre(p.nombre)) { pedirNombre(codigo, true); return; }
  encolar(codigo);
});
// Si el foco se pierde (clic en un botón, etc.), el escáner vuelve a escribir en el campo de código
document.addEventListener('keydown', e => {
  if (e.key.length !== 1 || e.key === ' ' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  if ($('inicio').classList.contains('oculto') || $('codigo').disabled || bloqueo || !$('modalComp').classList.contains('oculto')) return;
  $('codigo').focus();
});

function encolar(codigo) {
  const item = { codigo, nombre: 'Registrando…', cantidad: delta, estado: 'pendiente' };
  pedido.push(item); pintarPedido();
  // cola: un escaneo a la vez, en orden (el servidor además lo hace atómico)
  cola = cola.then(async () => {
    if (bloqueo) {                       // hay un producto sin nombre pendiente: no se registra
      pedido = pedido.filter(i => i !== item); descartados++; pintarPedido(); return;
    }
    const { data, error } = await db.rpc('registrar_movimiento', { p_codigo: codigo, p_cantidad: item.cantidad });
    if (error) { item.estado = 'error'; item.nombre = error.message; }
    else {
      item.nombre = data.nombre;
      $('exist').textContent = data.nombre + ': ' + data.total;
      if (data.sinNombre || sinNombre(data.nombre)) {
        item.nombre = 'Sin nombre';
        pedirNombre(data.codigo || codigo, false);   // ya quedó registrado; solo falta el nombre
      } else if (!indice.has(codigo)) await cargarCatalogo();   // producto nuevo: traer su precio
      item.estado = 'ok';
    }
    pintarPedido();
  });
}
function pedirNombre(codigo, registrarDespues) {
  bloqueo = { codigo, reg: registrarDespues };
  $('mCod').textContent = codigo; $('mNombre').value = ''; $('mErr').textContent = '';
  $('modalNombre').classList.remove('oculto'); beep();
  setTimeout(() => $('mNombre').focus(), 50);
}
async function guardarNombre() {
  if (!bloqueo) return;
  const n = $('mNombre').value.trim().replace(/\s+/g, ' ');
  if (!nombreValido(n)) {
    $('mErr').textContent = 'Escribe el nombre real del producto (con letras), no un código.';
    $('mNombre').focus(); return;
  }
  const { codigo, reg } = bloqueo;
  $('mBtn').disabled = true;
  const { error } = await db.rpc('poner_nombre', { p_codigo: codigo, p_nombre: n });
  $('mBtn').disabled = false;
  if (error) { $('mErr').textContent = error.message; return; }
  pedido.forEach(i => { if (i.codigo === codigo) i.nombre = n; });
  const p = indice.get(codigo); if (p) p.nombre = n;
  bloqueo = null; $('modalNombre').classList.add('oculto');
  if (reg) encolar(codigo);              // ahora sí se registra el escaneo que estaba detenido
  cargarCatalogo(); pintarPedido();
  if (descartados) { avisar(`${descartados} escaneo(s) que estaban en espera no se registraron. Vuelve a escanearlos.`); descartados = 0; }
  $('codigo').focus();
}
$('mNombre').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); guardarNombre(); }
  if (e.key === 'Escape') e.preventDefault();      // no se puede saltar
});
function avisar(t) {
  $('aviso').textContent = t; $('aviso').classList.remove('oculto');
  clearTimeout(avisoT); avisoT = setTimeout(() => $('aviso').classList.add('oculto'), 9000);
}
function beep() { try { const c = new AudioContext(), o = c.createOscillator(); o.frequency.value = 880; o.connect(c.destination); o.start(); o.stop(c.currentTime + .25); } catch (e) {} }

// Agrupa los escaneos por producto y calcula precios y totales
function lineas() {
  const m = new Map();
  pedido.forEach(i => {
    if (i.estado === 'error') return;
    const l = m.get(i.codigo) || { codigo: i.codigo, nombre: i.nombre, cant: 0, pendiente: false };
    m.delete(i.codigo);                                  // el último escaneado queda al final
    const p = indice.get(i.codigo);
    l.nombre = p && !sinNombre(p.nombre) ? p.nombre : i.nombre;
    l.cant += Math.abs(i.cantidad);
    l.pendiente = l.pendiente || i.estado === 'pendiente';
    m.set(i.codigo, l);
  });
  return [...m.values()].map(l => {
    const precioTipo = precioElegido[l.codigo] || 'precio_en_vivo';
    const precio = precioDe(l.codigo);
    return { ...l, precioTipo, precio, sub: precio == null ? 0 : Math.round(precio * l.cant * 100) / 100 };
  });
}
$('lista').addEventListener('click', e => {
  const boton = e.target.closest('[data-codigo][data-precio]');
  const codigo = boton && boton.dataset.codigo;
  const tipo = boton && boton.dataset.precio;
  if (codigo === undefined || !['precio_normal', 'precio_en_vivo', 'precio_mayorista'].includes(tipo)) return;
  if (boton.disabled) return;
  precioElegido[codigo] = tipo;
  pintarPedido();
  if (compActual) prepararComprobante();
});
function pintarPedido() {
  const ls = lineas(), cls = delta < 0 ? 's' : 'e';
  $('lista').innerHTML = ls.slice().reverse().map(l =>
    `<tr class="${cls}"><td>${esc(l.nombre)}<br><small>${esc(l.codigo)}${l.pendiente ? ' · guardando…' : ''}</small></td>
     <td><b>${l.cant}</b></td><td><div class="precios period-control" role="group" aria-label="Precio de ${esc(l.nombre)}">${[
       ['precio_normal', 'Normal'], ['precio_en_vivo', 'TikTok'], ['precio_mayorista', 'Mayorista']
     ].map(([tipo, etiqueta]) => {
       const p = indice.get(l.codigo), valor = p && p[tipo], seleccionado = (precioElegido[l.codigo] || 'precio_en_vivo') === tipo;
       return `<button type="button" class="period-option precio-opcion${seleccionado ? ' activo' : ''}" data-codigo="${esc(l.codigo)}" data-precio="${tipo}" aria-pressed="${seleccionado}" ${valor == null || valor === '' ? 'disabled' : ''}><span>${etiqueta}</span><b>${valor == null || valor === '' ? '—' : fmt(valor)}</b></button>`;
     }).join('')}</div></td><td>${fmt(l.sub)}</td></tr>`).join('');
  $('errores').innerHTML = pedido.filter(i => i.estado === 'error').map(i =>
    `<li class="s"><span>${esc(i.codigo)}: ${esc(i.nombre)}</span></li>`).join('');
  $('total').textContent = ls.reduce((a, l) => a + l.cant, 0);
  $('totalDin').textContent = fmt(ls.reduce((a, l) => a + l.sub, 0));
  $('lblTotal').textContent = delta > 0 ? 'Total entrada (precio seleccionado)' : 'Total a pagar';
  const sp = ls.filter(l => l.precio == null).length;
  $('sinPrecio').textContent = sp ? `${sp} producto(s) sin precio seleccionado: no suman al total.` : '';
}
async function nuevoPedido() {
  if (!pedido.length && !hayCliente()) return;
  if (pedido.some(i => i.estado === 'pendiente')) return alert('Espera a que termine de guardarse el último escaneo.');
  if (!confirm('¿Cerrar este pedido y empezar uno nuevo? El inventario ya quedó registrado.')) return;
  if (pedido.length) {
    prepararComprobante();
    try { await guardarPedido(); }
    catch (e) { alert('No se pudo guardar el comprobante en Supabase: ' + e.message); return; }
  }
  pedido = []; precioElegido = {}; compActual = null; limpiarCliente(); pintarPedido();
  $('modalComp').classList.add('oculto'); $('estadoPedido').textContent = '';
  if (!$('codigo').disabled) $('codigo').focus();
}
