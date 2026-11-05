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
  mostrarStockComboPedido();
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
  const item = { id: `producto-${Date.now()}-${Math.random().toString(36).slice(2)}`, codigo, nombre: 'Registrando…', cantidad: delta, movimientos: [], estado: 'pendiente' };
  pedido.push(item); pintarPedido();
  // cola: un escaneo a la vez, en orden (el servidor además lo hace atómico)
  cola = cola.then(async () => {
    if (bloqueo) {                       // hay un producto sin nombre pendiente: no se registra
      pedido = pedido.filter(i => i !== item); descartados++; pintarPedido(); return;
    }
    const movimientoFecha = new Date().toISOString();
    const { data, error } = await db.rpc('registrar_movimiento', { p_codigo: codigo, p_cantidad: item.cantidad });
    if (error) { item.estado = 'error'; item.nombre = error.message; }
    else {
      item.nombre = data.nombre;
      if (item.cantidad < 0) {
        item.movimientos.push({ fecha: movimientoFecha, nombre: data.nombre, cantidad: Math.abs(item.cantidad) });
      }
      $('exist').textContent = data.nombre + ': ' + data.total;
      const producto = indice.get(codigo);
      if (producto && data.total != null) producto.cantidad = Number(data.total);
      if (data.sinNombre || sinNombre(data.nombre)) {
        item.nombre = 'Sin nombre';
        pedirNombre(data.codigo || codigo, false);   // ya quedó registrado; solo falta el nombre
      } else if (!indice.has(codigo)) await cargarCatalogo();   // producto nuevo: traer su precio
      item.estado = 'ok';
    }
    pintarPedido();
    mostrarStockComboPedido();
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
    if (i.estado === 'error' || i.estado === 'error_parcial') return;
    const clave = i.tipo === 'combo' ? `combo:${i.comboId}` : `producto:${i.codigo}`;
    const l = m.get(clave) || (i.tipo === 'combo'
      ? {
          codigo: `COMBO-${i.comboId}`, comboId: i.comboId, combo: true, nombre: i.nombre,
          cant: 0, unidades: 0, precio: i.precio, componentes: i.componentes, pendiente: false
        }
      : { codigo: i.codigo, nombre: i.nombre, cant: 0, unidades: 0, pendiente: false });
    m.delete(clave);
    const p = i.tipo === 'combo' ? null : indice.get(i.codigo);
    l.nombre = i.tipo === 'combo' ? i.nombre : p && !sinNombre(p.nombre) ? p.nombre : i.nombre;
    l.cant += Math.abs(i.cantidad);
    l.unidades += i.tipo === 'combo'
      ? Math.abs(i.cantidad) * i.componentes.reduce((suma, componente) => suma + componente.cantidad, 0)
      : Math.abs(i.cantidad);
    l.pendiente = l.pendiente || i.estado === 'pendiente';
    l.pendiente = l.pendiente || i.estado === 'quitando';
    m.set(clave, l);
  });
  return [...m.values()].map(l => {
    if (l.combo) return {
      ...l, precioTipo: 'combo_fijo', sub: Math.round(l.precio * l.cant * 100) / 100
    };
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
    `<tr class="${cls}"><td>${esc(l.nombre)}<br><small>${esc(l.combo ? 'Combo' : l.codigo)}${l.pendiente ? ' · procesando…' : ''}</small></td>
     <td><b>${l.cant}${l.combo ? ' combo(s)' : ''}</b></td><td>${l.combo ? `<b>Precio fijo · ${fmt(l.precio)}</b>` : `<div class="precios period-control" role="group" aria-label="Precio de ${esc(l.nombre)}">${[
       ['precio_normal', 'Normal'], ['precio_en_vivo', 'TikTok'], ['precio_mayorista', 'Mayorista']
     ].map(([tipo, etiqueta]) => {
       const p = indice.get(l.codigo), valor = p && p[tipo], seleccionado = (precioElegido[l.codigo] || 'precio_en_vivo') === tipo;
       return `<button type="button" class="period-option precio-opcion${seleccionado ? ' activo' : ''}" data-codigo="${esc(l.codigo)}" data-precio="${tipo}" aria-pressed="${seleccionado}" ${valor == null || valor === '' ? 'disabled' : ''}><span>${etiqueta}</span><b>${valor == null || valor === '' ? '—' : fmt(valor)}</b></button>`;
     }).join('')}</div>`}</td><td>${fmt(l.sub)}</td>
     <td><button type="button" class="r quitar-linea" data-quitar-linea="${esc(l.combo ? `combo:${l.comboId}` : `producto:${l.codigo}`)}" aria-label="Quitar ${esc(l.nombre)} del pedido" ${l.pendiente ? 'disabled' : ''}>×</button></td></tr>`).join('');
  $('errores').innerHTML = pedido.filter(i => i.estado === 'error' || i.estado === 'error_parcial').map(i =>
    `<li class="s"><span>${esc(i.tipo === 'combo' ? i.nombre : i.codigo)}: ${esc(i.nombre)}</span>${i.estado === 'error' ? `<button type="button" data-quitar-error="${esc(i.id || '')}" aria-label="Quitar línea con error">×</button>` : '<b>Requiere ajuste de inventario</b>'}</li>`).join('');
  $('total').textContent = ls.reduce((a, l) => a + l.unidades, 0);
  $('totalDin').textContent = fmt(ls.reduce((a, l) => a + l.sub, 0));
  $('lblTotal').textContent = delta > 0 ? 'Total entrada (precio seleccionado)' : 'Total a pagar';
  const sp = ls.filter(l => !l.combo && l.precio == null).length;
  $('sinPrecio').textContent = sp ? `${sp} producto(s) sin precio seleccionado: no suman al total.` : '';
}
async function nuevoPedido() {
  if (!pedido.length && !hayCliente()) return;
  if (pedido.some(i => ['pendiente', 'quitando', 'error_parcial'].includes(i.estado))) return alert('Resuelve primero la operación de inventario pendiente o incompleta.');
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
