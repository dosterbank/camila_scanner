// ---------- COMBOS ----------
let combosDisponibles = [];
let borradorCombo = [];
let comboEditandoId = null;
let solicitudCombos = 0;

function agruparCombos(filas) {
  const mapa = new Map();
  (filas || []).forEach(fila => {
    let combo = mapa.get(fila.combo_id);
    if (!combo) {
      combo = { id: fila.combo_id, nombre: fila.nombre, precio: Number(fila.precio), componentes: [] };
      mapa.set(combo.id, combo);
    }
    if (fila.codigo) combo.componentes.push({
      codigo: fila.codigo,
      nombre: fila.producto,
      cantidad: Number(fila.cantidad),
      stock: Number(fila.stock)
    });
  });
  return [...mapa.values()];
}

async function cargarCombosPedido() {
  if (!uidActual || !$('seleccionarCombo')) return;
  const solicitud = ++solicitudCombos;
  $('seleccionarCombo').innerHTML = '<option value="">Cargando combos…</option>';
  try {
    const { data, error } = await db.rpc('listar_combos');
    if (error) throw error;
    if (solicitud !== solicitudCombos) return;
    combosDisponibles = agruparCombos(data);
    $('seleccionarCombo').innerHTML = '<option value="">Selecciona un combo</option>' +
      combosDisponibles.map(c => `<option value="${esc(c.id)}">${esc(c.nombre)} · ${fmt(c.precio)}</option>`).join('');
    mostrarStockComboPedido();
  } catch (e) {
    if (solicitud !== solicitudCombos) return;
    combosDisponibles = [];
    $('seleccionarCombo').innerHTML = '<option value="">No se pudieron cargar los combos</option>';
    $('stockComboPedido').textContent = 'No se pudieron cargar los combos: ' + e.message;
    console.error('Error al cargar combos para el pedido:', e);
  }
}

function mostrarStockComboPedido() {
  const id = $('seleccionarCombo').value;
  const combo = combosDisponibles.find(c => c.id === id);
  if (!combo) {
    $('stockComboPedido').textContent = '';
    return;
  }
  const faltantes = [];
  $('stockComboPedido').innerHTML = `<p><b>${esc(combo.nombre)} · ${fmt(combo.precio)}</b></p><ul>${combo.componentes.map(p => {
    const stock = stockDisponibleCombo(p);
    const disponible = delta > 0 || stock >= p.cantidad;
    if (!disponible) faltantes.push(p.nombre);
    return `<li class="${disponible ? '' : 's'}"><span>${esc(p.nombre)} × ${p.cantidad}</span><b>Stock: ${stock}</b></li>`;
  }).join('')}</ul>${faltantes.length ? '<small class="s">Stock insuficiente para el descargo.</small>' : ''}`;
}

function stockDisponibleCombo(producto) {
  const actual = indice.get(producto.codigo);
  let stock = actual && Number.isFinite(Number(actual.cantidad)) ? Number(actual.cantidad) : producto.stock;
  if (delta < 0 && Number.isFinite(stock)) {
    pedido.forEach(item => {
      if (item.estado !== 'pendiente' && item.estado !== 'quitando') return;
      if (item.tipo === 'combo') {
        if ((item.movimientosRegistrados || []).includes(producto.codigo)) return;
        const componente = item.componentes.find(p => p.codigo === producto.codigo);
        if (componente && item.cantidad < 0) stock -= componente.cantidad * Math.abs(item.cantidad);
      } else if (item.codigo === producto.codigo && item.cantidad < 0) {
        stock -= Math.abs(item.cantidad);
      }
    });
  }
  return stock;
}

async function agregarComboPedido() {
  if (!delta) return alert('Primero elige Entradas o Descargos.');
  const combo = combosDisponibles.find(c => c.id === $('seleccionarCombo').value);
  if (!combo) return alert('Selecciona un combo disponible.');
  const sinStock = delta < 0 && combo.componentes.some(p => stockDisponibleCombo(p) < p.cantidad);
  if (sinStock) return alert('No hay existencias suficientes para descargar todos los productos de este combo.');
  const item = {
    id: `combo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    tipo: 'combo',
    comboId: combo.id,
    nombre: combo.nombre,
    cantidad: delta,
    precio: combo.precio,
    componentes: combo.componentes.map(p => ({ codigo: p.codigo, nombre: p.nombre, cantidad: p.cantidad })),
    movimientosRegistrados: [],
    estado: 'pendiente'
  };
  pedido.push(item);
  pintarPedido();
  mostrarStockComboPedido();
  cola = cola.then(async () => {
    const aplicados = [];
    try {
      for (const p of item.componentes) {
        const { data, error } = await db.rpc('registrar_movimiento', {
          p_codigo: p.codigo, p_cantidad: p.cantidad * delta
        });
        if (error) throw new Error(`${p.nombre}: ${error.message}`);
        item.movimientosRegistrados.push(p.codigo);
        aplicados.push({ codigo: p.codigo, cantidad: p.cantidad * delta });
        const producto = indice.get(p.codigo);
        if (producto && data && data.total != null) producto.cantidad = Number(data.total);
        $('exist').textContent = `${data.nombre}: ${data.total}`;
      }
      item.estado = 'ok';
      if (compActual) prepararComprobante();
    } catch (e) {
      const fallosReversion = [];
      for (const mov of aplicados.reverse()) {
        const { error } = await db.rpc('registrar_movimiento', {
          p_codigo: mov.codigo, p_cantidad: -mov.cantidad
        });
        if (error) fallosReversion.push(`${mov.codigo}: ${error.message}`);
      }
      if (fallosReversion.length) {
        item.estado = 'error_parcial';
        item.nombre = `Falló el combo (${e.message}); no se pudo revertir ${fallosReversion.join('; ')}`;
        avisar('Atención: revisa el inventario; no se pudieron revertir todos los movimientos del combo.');
      } else {
        pedido = pedido.filter(i => i !== item);
        avisar('No se agregó el combo: ' + e.message);
      }
      await cargarCatalogo();
      console.error('Error al registrar combo:', e);
    } finally {
      pintarPedido();
      mostrarStockComboPedido();
      if (!$('combos').classList.contains('oculto')) pintarCombosAdmin();
    }
  });
}

async function cambiarMovimientos(movimientos) {
  const aplicados = [];
  for (const mov of movimientos) {
    const { data, error } = await db.rpc('registrar_movimiento', {
      p_codigo: mov.codigo, p_cantidad: mov.cantidad
    });
    if (error) {
      const fallosReversion = [];
      for (const revertido of aplicados.reverse()) {
        const resultado = await db.rpc('registrar_movimiento', {
          p_codigo: revertido.codigo, p_cantidad: -revertido.cantidad
        });
        if (resultado.error) fallosReversion.push(`${revertido.codigo}: ${resultado.error.message}`);
      }
      throw new Error(`${error.message}${fallosReversion.length ? `; no se pudo revertir: ${fallosReversion.join('; ')}` : ''}`);
    }
    aplicados.push(mov);
    const producto = indice.get(mov.codigo);
    if (producto && data && data.total != null) producto.cantidad = Number(data.total);
    if (data) $('exist').textContent = `${data.nombre}: ${data.total}`;
  }
}

async function quitarLineaPedido(clave) {
  const items = pedido.filter(i => (i.tipo === 'combo' ? `combo:${i.comboId}` : `producto:${i.codigo}`) === clave);
  if (!items.length || items.some(i => i.estado === 'quitando')) return;
  if (items.some(i => i.estado === 'error_parcial')) {
    avisar('No se puede quitar esta línea automáticamente: requiere revisar el inventario.');
    return;
  }
  items.forEach(i => { if (i.estado !== 'error') i.estado = 'quitando'; });
  pintarPedido();
  cola = cola.then(async () => {
    try {
      const activos = items.filter(i => i.estado !== 'error' && i.estado !== 'error_parcial');
      const movimientos = new Map();
      activos.forEach(i => {
        if (i.tipo === 'combo') {
          i.componentes.forEach(p => movimientos.set(p.codigo,
            (movimientos.get(p.codigo) || 0) - i.cantidad * p.cantidad));
        } else {
          movimientos.set(i.codigo, (movimientos.get(i.codigo) || 0) - i.cantidad);
        }
      });
      await cambiarMovimientos([...movimientos].map(([codigo, cantidad]) => ({ codigo, cantidad })));
      pedido = pedido.filter(i => !items.includes(i));
      delete precioElegido[items[0].codigo];
      if (compActual && lineas().length) prepararComprobante();
      else if (compActual) {
        compActual = null;
        $('modalComp').classList.add('oculto');
        limpiarCliente();
      }
    } catch (e) {
      const estado = e.message.includes('no se pudo revertir') ? 'error_parcial' : 'ok';
      items.forEach(i => { if (i.estado === 'quitando') i.estado = estado; });
      await cargarCatalogo();
      avisar('No se pudo quitar el producto ni ajustar el inventario: ' + e.message);
      console.error('Error al quitar una línea del pedido:', e);
    } finally {
      pintarPedido();
      mostrarStockComboPedido();
      if (!$('combos').classList.contains('oculto')) pintarCombosAdmin();
    }
  });
}

$('lista').addEventListener('click', e => {
  const quitar = e.target.closest('[data-quitar-linea]');
  if (quitar) {
    quitarLineaPedido(quitar.dataset.quitarLinea);
    return;
  }
  const error = e.target.closest('[data-quitar-error]');
  if (error) {
    pedido = pedido.filter(i => i.id !== error.dataset.quitarError);
    pintarPedido();
    return;
  }
});

async function abrirCombos() {
  if (!esAdmin) return;
  estadoCombos('Cargando inventario y combos…');
  try {
    await Promise.all([cargarCatalogo(), recargarCombosAdmin()]);
  } catch (e) {
    estadoCombos('No se pudieron cargar los datos de combos: ' + e.message, 's');
    return;
  }
  pintarProductosCombo();
  pintarBorradorCombo();
}

function estadoCombos(mensaje, clase = '') {
  $('combosEstado').className = clase;
  $('combosEstado').textContent = mensaje;
}

function pintarProductosCombo() {
  const q = $('buscarProductoCombo').value.trim().toLocaleLowerCase();
  const productos = catalogo.filter(p =>
    !q || `${p.nombre} ${p.codigo}`.toLocaleLowerCase().includes(q)
  ).slice(0, 100);
  $('productosCombo').innerHTML = productos.map(p => {
    const agregado = borradorCombo.some(c => c.codigo === p.codigo);
    return `<button type="button" class="combo-producto" data-agregar-producto-combo="${esc(p.codigo)}" ${agregado ? 'disabled' : ''}>
      <span>${esc(p.nombre)} <small>(${esc(p.codigo)})</small></span><b>Stock: ${Number(p.cantidad) || 0}</b>
    </button>`;
  }).join('') || '<p>No hay productos que coincidan.</p>';
}

function pintarBorradorCombo() {
  $('componentesCombo').innerHTML = borradorCombo.map(p => {
    const producto = indice.get(p.codigo);
    const stock = producto ? Number(producto.cantidad) || 0 : 0;
    return `<tr><td>${esc(producto ? producto.nombre : p.nombre)}<br><small>${esc(p.codigo)}</small></td>
      <td>${stock}</td><td><input type="number" min="1" max="999999" step="1" value="${p.cantidad}" data-cantidad-combo="${esc(p.codigo)}" aria-label="Cantidad en combo de ${esc(p.nombre)}"></td>
      <td><button type="button" class="r" data-quitar-producto-combo="${esc(p.codigo)}" aria-label="Quitar ${esc(p.nombre)} del combo">×</button></td></tr>`;
  }).join('') || '<tr><td colspan="4">Busca y agrega productos al combo.</td></tr>';
}

function comenzarEdicionCombo(id) {
  const combo = combosDisponibles.find(c => c.id === id);
  if (!combo) return;
  comboEditandoId = combo.id;
  borradorCombo = combo.componentes.map(p => ({ codigo: p.codigo, nombre: p.nombre, cantidad: p.cantidad }));
  $('nombreCombo').value = combo.nombre;
  $('precioCombo').value = combo.precio.toFixed(2);
  $('guardarComboBtn').textContent = 'Guardar cambios';
  $('cancelarEdicionCombo').classList.remove('oculto');
  pintarProductosCombo();
  pintarBorradorCombo();
  $('nombreCombo').focus();
}

function cancelarEdicionCombo() {
  comboEditandoId = null;
  borradorCombo = [];
  $('nombreCombo').value = '';
  $('precioCombo').value = '';
  $('guardarComboBtn').textContent = 'Crear combo';
  $('cancelarEdicionCombo').classList.add('oculto');
  pintarProductosCombo();
  pintarBorradorCombo();
}

async function guardarCombo() {
  if (!esAdmin) return;
  const nombre = $('nombreCombo').value.trim().replace(/\s+/g, ' ');
  const precioTexto = $('precioCombo').value.trim();
  const precio = Number(precioTexto);
  if (nombre.length < 2 || nombre.length > 100) return estadoCombos('Escribe un nombre de 2 a 100 caracteres.', 's');
  if (!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(precioTexto) || !Number.isFinite(precio) || precio < 0) {
    return estadoCombos('Escribe un precio válido con hasta dos decimales.', 's');
  }
  if (!borradorCombo.length) return estadoCombos('Agrega por lo menos un producto al combo.', 's');
  if (borradorCombo.some(p => !Number.isInteger(p.cantidad) || p.cantidad < 1 || p.cantidad > 999999)) {
    return estadoCombos('Las cantidades deben ser números enteros mayores que cero.', 's');
  }
  if (borradorCombo.reduce((total, p) => total + p.cantidad, 0) > 999999) {
    return estadoCombos('La suma de unidades del combo no puede superar 999999.', 's');
  }
  const boton = $('guardarComboBtn');
  boton.disabled = true;
  estadoCombos('Guardando combo…');
  try {
    const { error } = await db.rpc('guardar_combo', {
      p_id: comboEditandoId,
      p_nombre: nombre,
      p_precio: precio,
      p_componentes: borradorCombo.map(({ codigo, cantidad }) => ({ codigo, cantidad }))
    });
    if (error) throw error;
    cancelarEdicionCombo();
    await cargarCombosPedido();
    await recargarCombosAdmin();
    estadoCombos('Combo guardado correctamente.', 'e');
  } catch (e) {
    estadoCombos('No se pudo guardar el combo: ' + e.message, 's');
    console.error('Error al guardar combo:', e);
  } finally {
    boton.disabled = false;
  }
}

async function eliminarCombo(id) {
  if (!esAdmin || !confirm('¿Quitar este combo de la lista de disponibles?')) return;
  try {
    const { error } = await db.rpc('eliminar_combo', { p_id: id });
    if (error) throw error;
    await cargarCombosPedido();
    await recargarCombosAdmin();
    estadoCombos('Combo eliminado de la lista de disponibles.', 'e');
  } catch (e) {
    estadoCombos('No se pudo eliminar el combo: ' + e.message, 's');
    console.error('Error al eliminar combo:', e);
  }
}

async function recargarCombosAdmin() {
  if (!esAdmin) return;
  const { data, error } = await db.rpc('listar_combos');
  if (error) {
    $('listaCombosAdmin').textContent = 'No se pudieron cargar los combos: ' + error.message;
    throw error;
  }
  combosDisponibles = agruparCombos(data);
  pintarCombosAdmin();
}

function pintarCombosAdmin() {
  if (!$('listaCombosAdmin')) return;
  $('listaCombosAdmin').innerHTML = combosDisponibles.map(c => `<article class="combo-admin">
    <div class="row"><h4>${esc(c.nombre)}</h4><b>Precio fijo: ${fmt(c.precio)}</b>
      <button type="button" data-editar-combo="${esc(c.id)}">Editar</button>
      <button type="button" class="r" data-eliminar-combo="${esc(c.id)}">Quitar</button></div>
    <ul>${c.componentes.map(p => {
      const producto = indice.get(p.codigo);
      const stock = producto && producto.cantidad != null ? Number(producto.cantidad) : p.stock;
      return `<li><span>${esc(p.nombre)} × ${p.cantidad}</span><b>Stock: ${stock}</b></li>`;
    }).join('')}</ul>
  </article>`).join('') || '<p>Aún no hay combos.</p>';
}

function imprimirCombos() {
  if (!esAdmin) return;
  if (!combosDisponibles.length) return alert('No hay combos disponibles para imprimir.');
  const fecha = new Date().toLocaleString('es');
  const filas = combosDisponibles.map(combo => {
    const componentes = combo.componentes.map(p => {
      const producto = indice.get(p.codigo);
      const stock = producto && producto.cantidad != null ? Number(producto.cantidad) : p.stock;
      return `<tr><td>${esc(p.nombre)}</td><td>${esc(p.codigo)}</td><td class="num">${p.cantidad}</td><td class="num">${stock}</td></tr>`;
    }).join('');
    return `<section class="combo"><h2>${esc(combo.nombre)} <span>${fmt(combo.precio)}</span></h2>
      <table><thead><tr><th>Producto</th><th>Código</th><th class="num">Cant. combo</th><th class="num">Existencia</th></tr></thead>
      <tbody>${componentes}</tbody></table></section>`;
  }).join('');
  const w = window.open('', '_blank');
  if (!w) return alert('Permite las ventanas emergentes para imprimir los combos.');
  const css = `@page{size:A4;margin:12mm}body{font:10pt Arial,sans-serif;color:#000;margin:0}
h1{font-size:18pt;margin:0 0 2mm}.meta{font-size:9pt;color:#444;margin-bottom:8mm}
.combo{break-inside:avoid;margin:0 0 8mm}.combo h2{display:flex;justify-content:space-between;gap:8mm;font-size:13pt;margin:0;padding:0 0 2mm;border-bottom:1px solid #444}
table{width:100%;border-collapse:collapse;margin-top:2mm}th,td{padding:1.5mm 2mm;border-bottom:1px solid #ccc;text-align:left}
th{background:#eee}.num{text-align:right}`;
  w.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Combos disponibles</title><style>${css}</style></head>
    <body><h1>Combos · Distribuidora Camila</h1><div class="meta">Impreso: ${esc(fecha)} · ${combosDisponibles.length} combo(s)</div>${filas}</body></html>`);
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 400);
}

$('productosCombo').addEventListener('click', e => {
  const boton = e.target.closest('[data-agregar-producto-combo]');
  if (!boton || boton.disabled) return;
  const producto = indice.get(boton.dataset.agregarProductoCombo);
  if (!producto || borradorCombo.some(p => p.codigo === producto.codigo)) return;
  borradorCombo.push({ codigo: producto.codigo, nombre: producto.nombre, cantidad: 1 });
  pintarProductosCombo();
  pintarBorradorCombo();
});

$('componentesCombo').addEventListener('input', e => {
  const codigo = e.target.dataset.cantidadCombo;
  if (codigo === undefined) return;
  const p = borradorCombo.find(item => item.codigo === codigo);
  if (p) p.cantidad = Number(e.target.value);
});

$('componentesCombo').addEventListener('click', e => {
  const boton = e.target.closest('[data-quitar-producto-combo]');
  if (!boton) return;
  borradorCombo = borradorCombo.filter(p => p.codigo !== boton.dataset.quitarProductoCombo);
  pintarProductosCombo();
  pintarBorradorCombo();
});

$('listaCombosAdmin').addEventListener('click', e => {
  const editar = e.target.closest('[data-editar-combo]');
  if (editar) return comenzarEdicionCombo(editar.dataset.editarCombo);
  const eliminar = e.target.closest('[data-eliminar-combo]');
  if (eliminar) eliminarCombo(eliminar.dataset.eliminarCombo);
});
