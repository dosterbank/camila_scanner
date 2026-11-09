// ---------- ADMIN ----------
async function cargarAdmin() {
  try {
    // Los no admin piden solo las columnas que necesitan
    prods = await traerTodos(esAdmin ? '*' : 'id,codigo,nombre,cantidad,precio_normal,precio_en_vivo,precio_mayorista');
  } catch (e) { return alert(e.message); }
  prods.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
  pintarAdm();
}
const prVer = v => v == null || v === '' ? '—' : fmt(v);
function admFiltrados() {
  const q = $('admBuscar').value.toLowerCase().trim();
  return prods.filter(p => !q || (p.nombre || '').toLowerCase().includes(q) || p.codigo.includes(q));
}
function imprimirInventario() {
  const lista = admFiltrados();
  if (!lista.length) return alert('No hay productos para imprimir (¿ya cargó el inventario?).');
  const q = $('admBuscar').value.trim();
  const unid = lista.reduce((a, p) => a + (Number(p.cantidad) || 0), 0);
  const filas = lista.map(p => `<tr><td>${esc(p.codigo)}</td><td>${esc(p.nombre)}</td><td class="d">${p.cantidad}</td><td class="d">${prVer(p.precio_normal)}</td><td class="d">${prVer(p.precio_en_vivo)}</td><td class="d">${prVer(p.precio_mayorista)}</td></tr>`).join('');
  const css = `@page{size:A4 portrait;margin:8mm}body{font:8pt/1.1 Arial,sans-serif;color:#000;margin:0}
h1{font-size:13pt;margin:0}.meta{font-size:8pt;color:#333;margin:1mm 0 2mm}
table{width:100%;table-layout:fixed;border-collapse:collapse}th,td{border-bottom:1px solid #bbb;padding:.7mm 1mm;text-align:left;font-size:8pt;overflow-wrap:anywhere}
th:nth-child(1){width:17%}th:nth-child(2){width:39%}th:nth-child(3){width:8%}th:nth-child(4){width:12%}th:nth-child(5){width:11%}th:nth-child(6){width:13%}
th{border-bottom:1.5px solid #000}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}.d{text-align:right}
tfoot td{border-top:1.5px solid #000;border-bottom:0;font-weight:bold}`;
  const w = window.open('', '_blank'); if (!w) return alert('Permite las ventanas emergentes.');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Inventario</title><style>${css}</style></head><body>
<h1>Inventario · Distribuidora Camila</h1>
<div class="meta">Fecha: ${fechaTxt(new Date())} · Usuario: ${esc(usuarioEmail)}${q ? ' · Filtro: «' + esc(q) + '»' : ''}</div>
<table><thead><tr><th>Código</th><th>Nombre</th><th class="d">Stock</th><th class="d">Normal</th><th class="d">TikTok</th><th class="d">Mayorista</th></tr></thead><tbody>${filas}</tbody>
<tfoot><tr><td colspan="2">${lista.length} producto(s)</td><td class="d">${unid}</td><td colspan="3"></td></tr></tfoot></table></body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 400);
}
function pintarAdm() {
  const lista = admFiltrados();
  $('admTabla').classList.toggle('admin', esAdmin);
  $('admCount').textContent = `Mostrando ${lista.length} producto(s)`;
  const et = p => `<td><button data-et="${esc(p.codigo)}" title="Imprimir etiqueta">🏷</button></td>`;
  if (!esAdmin) {   // solo lectura
    $('admHead').innerHTML = '<tr><th>Código</th><th>Nombre</th><th>Stock</th><th>Normal</th><th>TikTok</th><th>Mayorista</th><th>Etiq.</th></tr>';
    $('admCuerpo').innerHTML = lista.map(p =>
      `<tr><td>${esc(p.codigo)}</td><td>${esc(p.nombre)}</td><td><b style="${p.cantidad < 0 ? 'color:#9b2226' : ''}">${p.cantidad}</b></td>
       <td>${prVer(p.precio_normal)}</td><td>${prVer(p.precio_en_vivo)}</td><td>${prVer(p.precio_mayorista)}</td>${et(p)}</tr>`).join('');
    return;
  }
  $('admHead').innerHTML = '<tr><th>Código</th><th>Nombre</th><th>Stock</th><th>Normal</th><th>TikTok</th><th>Mayorista</th><th>Etiq.</th><th>Quitar</th></tr>';
  const num = (id, c, v) => `<td><input class="adm-precio" type="number" step="0.01" value="${v ?? ''}" onchange="guardarCampo(${id},'${c}',this.value)"></td>`;
  $('admCuerpo').innerHTML = lista.map(p =>
    `<tr><td>${esc(p.codigo)}</td><td><input class="adm-nombre" value="${esc(p.nombre)}" title="${esc(p.nombre)}" onchange="guardarCampo(${p.id},'nombre',this.value)"></td>
     <td><input type="number" value="${p.cantidad}" onchange="ajustarStock(${p.id},this.value)" style="${p.cantidad < 0 ? 'color:#9b2226' : ''}"></td>
     ${num(p.id, 'precio_normal', p.precio_normal)}${num(p.id, 'precio_en_vivo', p.precio_en_vivo)}${num(p.id, 'precio_mayorista', p.precio_mayorista)}${et(p)}
     <td><button type="button" class="inventario-eliminar" data-eliminar-producto="${esc(p.id)}" aria-label="Eliminar ${esc(p.nombre)} (${esc(p.codigo)})" title="Eliminar producto">×</button></td></tr>`).join('');
}
// Desde el inventario: manda el producto a Etiquetas con cantidad 1
$('admCuerpo').addEventListener('click', e => {
  const boton = e.target.closest('button');
  if (!boton) return;
  const id = boton.dataset.eliminarProducto;
  if (id !== undefined) return eliminarProducto(id, boton);
  const c = boton.dataset.et;
  if (c === undefined) return;
  cant[c] = 1; vista('etq'); $('buscar').value = c; pintarCat();
});
async function eliminarProducto(id, boton) {
  if (!esAdmin) return;
  const p = prods.find(x => String(x.id) === String(id));
  if (!p) return;
  const enPedido = pedido.some(i => i.tipo === 'combo'
    ? Array.isArray(i.componentes) && i.componentes.some(componente => componente.codigo === p.codigo)
    : i.codigo === p.codigo);
  if (enPedido) return alert(`No se puede eliminar "${p.nombre}" porque está en el pedido abierto. Cierra o quita esa línea primero.`);
  if (!confirm(`¿Eliminar "${p.nombre}" (${p.codigo}) del inventario? Esta acción no se puede deshacer. Los comprobantes e historial existentes se conservarán.`)) return;
  boton.disabled = true;
  try {
    const { error } = await db.rpc('eliminar_producto', { p_id: String(p.id) });
    if (error) throw error;
    prods = prods.filter(x => String(x.id) !== String(p.id));
    catalogo = catalogo.filter(x => String(x.id) !== String(p.id));
    indice.delete(p.codigo);
    delete cant[p.codigo];
    delete precioElegido[p.codigo];
    pintarAdm();
    pintarCat();
    pintarPedido();
  } catch (e) {
    alert('No se pudo eliminar el producto: ' + e.message);
    boton.disabled = false;
  }
}
async function guardarCampo(id, campo, v) {
  if (!esAdmin) return;
  const p = prods.find(x => x.id === id);
  const val = campo === 'nombre' ? v.trim() : (v === '' ? null : parseFloat(v));
  if (campo === 'nombre' && !val) { alert('El nombre no puede quedar vacío.'); return pintarAdm(); }
  const { error } = await db.from('productos').update({ [campo]: val }).eq('id', id);
  if (error) { alert(error.message); return pintarAdm(); }
  p[campo] = val;
  const c = indice.get(p.codigo); if (c) c[campo] = val;   // mantiene el catálogo del escáner al día
}
// El stock se ajusta como un movimiento, así queda registro en el historial
async function ajustarStock(id, v) {
  if (!esAdmin) return;
  const p = prods.find(x => x.id === id), d = (parseInt(v) || 0) - p.cantidad;
  if (!d) return;
  if (!confirm(`Ajustar "${p.nombre}": ${p.cantidad} → ${p.cantidad + d}?`)) return pintarAdm();
  const { data, error } = await db.rpc('registrar_movimiento', { p_codigo: p.codigo, p_cantidad: d });
  if (error) alert(error.message); else p.cantidad = data.total;
  pintarAdm();
}
async function reporte() {
  let q = db.from('movimientos').select('created_at,nombre,cantidad,tipo,usuario').order('created_at', { ascending: false }).limit(1000);
  if ($('desde').value) q = q.gte('created_at', new Date($('desde').value + 'T00:00:00').toISOString());
  if ($('hasta').value) q = q.lte('created_at', new Date($('hasta').value + 'T23:59:59').toISOString());
  if ($('fTipo').value) q = q.eq('tipo', $('fTipo').value);
  if ($('fUsuario').value.trim()) q = q.ilike('usuario', '%' + $('fUsuario').value.trim() + '%');
  const { data, error } = await q;
  if (error) return alert(error.message);
  const ent = data.filter(m => m.cantidad > 0).reduce((a, m) => a + m.cantidad, 0);
  const sal = data.filter(m => m.cantidad < 0).reduce((a, m) => a - m.cantidad, 0);
  $('repResumen').textContent = `Entradas: ${ent} · Descargos: ${sal}` + (data.length === 1000 ? ' (mostrando los 1000 más recientes)' : '');
  $('repCuerpo').innerHTML = data.map(m => `<tr class="${m.cantidad < 0 ? 's' : 'e'}"><td>${new Date(m.created_at).toLocaleString()}</td><td>${esc(m.nombre || '')}</td><td>${esc(m.usuario || '')}</td><td><b>${m.cantidad > 0 ? '+' : ''}${m.cantidad}</b></td></tr>`).join('');
}
