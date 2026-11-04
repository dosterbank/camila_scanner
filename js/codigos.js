// ---------- CREAR CÓDIGOS (solo admin) ----------
// "0012" y "12" se consideran el mismo código para no crear confusiones
const norm = c => /^\d+$/.test(c) ? c.replace(/^0+(?=\d)/, '') : c;
let codigosUsados = new Set(), creados = [];

async function refrescarCodigos() {
  const data = await traerTodos('codigo');
  codigosUsados = new Set(data.map(p => norm(String(p.codigo))));
}
async function abrirCodigos() {
  $('cMsg').className = ''; $('cMsg').textContent = 'Cargando códigos existentes…';
  try { await refrescarCodigos(); } catch (e) { $('cMsg').className = 's'; $('cMsg').textContent = 'No se pudieron leer los códigos: ' + e.message; return; }
  $('cMsg').textContent = ''; sugerir(); $('cNombre').focus();
}
// Sugiere códigos de 1 a 5 dígitos que no existen: el siguiente al mayor, el primer hueco libre y algunos al azar
function sugerir() {
  const libres = [];
  const add = n => { const s = String(n); if (n >= 1 && n <= 99999 && !codigosUsados.has(s) && !libres.includes(s)) libres.push(s); };
  let max = 0; codigosUsados.forEach(c => { if (/^\d{1,5}$/.test(c)) max = Math.max(max, +c); });
  add(max + 1);
  for (let n = 1; libres.length < 2 && n <= 99999; n++) add(n);
  for (let i = 0; libres.length < 6 && i < 2000; i++) add(1 + Math.floor(Math.random() * 99999));
  $('sugeridos').innerHTML = libres.map(c => `<button class="chip" data-c="${c}">${c}</button>`).join('');
  $('cCodigo').value = libres[0] || ''; validarCodigo();
}
$('sugeridos').addEventListener('click', e => {
  const c = e.target.dataset && e.target.dataset.c;
  if (c) { $('cCodigo').value = c; validarCodigo(); }
});
function validarCodigo() {
  const c = $('cCodigo').value, m = $('cMsg');
  if (!c) { m.className = ''; m.textContent = ''; }
  else if (!/^\d{1,5}$/.test(c)) { m.className = 's'; m.textContent = '✗ Solo números, de 1 a 5 dígitos.'; }
  else if (codigosUsados.has(norm(c))) { m.className = 's'; m.textContent = '✗ Ese código ya existe.'; }
  else { m.className = 'e'; m.textContent = '✓ Código disponible.'; }
}
async function crearCodigo() {
  const nombre = $('cNombre').value.trim().replace(/\s+/g, ' ');
  const codigo = $('cCodigo').value.trim();
  const precios = { precio_normal: $('cPrecio').value, precio_en_vivo: $('cTikTok').value, precio_mayorista: $('cMayor').value };
  const msg = t => { $('cMsg').className = 's'; $('cMsg').textContent = t; };
  if (!nombreValido(nombre)) { msg('Escribe el nombre del producto nuevo (con letras).'); $('cNombre').focus(); return; }
  if (!/^\d{1,5}$/.test(codigo)) return msg('El código debe tener solo números, de 1 a 5 dígitos.');
  if (Object.values(precios).some(v => v !== '' && !(parseFloat(v) >= 0))) return msg('Algún precio no es válido.');
  $('cBtn').disabled = true;
  try {
    await refrescarCodigos();            // por si otro usuario creó códigos mientras tanto
    if (codigosUsados.has(norm(codigo))) { sugerir(); return msg('Ese código ya existe; te sugerí otros.'); }
    const fila = { codigo, nombre };
    Object.entries(precios).forEach(([k, v]) => { if (v !== '') fila[k] = parseFloat(v); });
    const { error } = await db.from('productos').insert(fila);
    if (error) {
      if (error.code === '23505') { await refrescarCodigos(); sugerir(); return msg('Ese código ya existe; te sugerí otros.'); }
      return msg(error.message);
    }
    codigosUsados.add(norm(codigo));
    creados.unshift({ codigo, nombre });
    $('creados').innerHTML = creados.map(c => `<li><span>${esc(c.nombre)}</span><b>${esc(c.codigo)}</b></li>`).join('');
    $('cNombre').value = ''; $('cPrecio').value = ''; $('cTikTok').value = ''; $('cMayor').value = '';
    sugerir();
    $('cMsg').className = 'e'; $('cMsg').textContent = `✓ Creado: ${codigo} · ${nombre}`;
    $('cNombre').focus();
    cargarCatalogo();
  } finally { $('cBtn').disabled = false; }
}
$('cNombre').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('cCodigo').focus(); } });
$('cCodigo').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); crearCodigo(); } });
