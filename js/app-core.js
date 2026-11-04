// ====== CONFIGURA ESTO (Supabase > Project Settings > API) ======
const SUPABASE_URL = 'https://zfeazyxionredunjqxdx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_W1HNg5ZTFEEi3SegFC5r0A_RzFSOZiO';   // clave pública (publishable); la seguridad la da RLS
// ================================================================
// Enlace del correo (invitación / recuperar contraseña): Supabase lo manda con datos en el # de la dirección
const hashParams = new URLSearchParams(location.hash.slice(1));
let modoClave = ['invite', 'recovery', 'signup'].includes(hashParams.get('type'));
const errorEnlace = hashParams.get('error') ? 'El enlace del correo expiró o ya fue usado. Pulsa «¿Olvidaste tu contraseña?» para recibir uno nuevo.' : '';
if (errorEnlace) history.replaceState(null, '', location.pathname + location.search);
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => '$' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const sinNombre = n => { const t = (n || '').trim(); return !t || /^sin nombre$/i.test(t); };
const nombreValido = n => n.length >= 2 && /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(n) && !sinNombre(n);

let delta = 0, pedido = [], catalogo = [], indice = new Map(), cant = {}, precioElegido = {}, cola = Promise.resolve();
let esAdmin = false, rolCargado = false, prods = [], uidActual = null, usuarioEmail = '';
let bloqueo = null, descartados = 0, compActual = null, avisoT = null, timerGuardado = null;
let colaGuardado = Promise.resolve();

// ---------- SESIÓN ----------
async function iniciar() {
  const { data: { session } } = await db.auth.getSession();
  mostrar(session);
}
function reiniciarUI() {
  delta = 0; pedido = []; catalogo = []; indice = new Map(); cant = {}; precioElegido = {}; prods = [];
  bloqueo = null; descartados = 0; compActual = null; esAdmin = false; cola = Promise.resolve();
  clearTimeout(timerGuardado); timerGuardado = null;
  $('estadoPedido').textContent = ''; $('estadoPedido').className = '';
  document.body.className = '';
  $('modoTxt').textContent = 'Elige un modo';
  $('codigo').disabled = true; $('codigo').value = '';
  limpiarCliente(); $('exist').textContent = '—'; $('aviso').classList.add('oculto'); $('zonaEscaneo').classList.add('oculto');
  $('modalNombre').classList.add('oculto'); $('modalComp').classList.add('oculto');
  $('btnEntrada').classList.add('oculto'); $('btnCodigos').classList.add('oculto'); $('btnNuevoCod').classList.add('oculto'); $('admMov').classList.add('oculto');
  $('btnVentas').classList.add('oculto'); $('btnCaja').classList.add('oculto');
  $('menu').classList.add('oculto'); $('menuBackdrop').classList.add('oculto');
  $('btnMenu').setAttribute('aria-expanded', 'false'); $('btnVolver').classList.add('oculto'); rolCargado = false;
  pintarPedido();
}
function mostrar(session) {
  const pideClave = !!session && modoClave;     // llegó por enlace del correo: primero debe crear su contraseña
  document.body.classList.toggle('loginPage', !session && !pideClave);
  $('login').classList.toggle('oculto', !!session);
  $('clave').classList.toggle('oculto', !pideClave);
  $('app').classList.toggle('oculto', !session || pideClave);
  if (!session) {
    if (uidActual) reiniciarUI();
    document.body.className = 'loginPage';
    uidActual = null; cargarCorreos(); return;
  }
  if (pideClave) { setTimeout(() => $('clave1').focus(), 50); return; }
  $('quien').textContent = usuarioEmail = session.user.email;
  // Solo se reinicia la pantalla cuando entra OTRO usuario (no en cada refresco de token)
  if (session.user.id !== uidActual) {
    uidActual = session.user.id;
    reiniciarUI(); cargarRol(uidActual); vista('inicio');
  }
}
// Solo se recuerdan los correos en este dispositivo; las contraseñas nunca se guardan
function leerCorreos() { try { return JSON.parse(localStorage.getItem('correos') || '[]'); } catch (e) { return []; } }
function guardarCorreo(c) {
  try {
    const lista = [c, ...leerCorreos().filter(x => x !== c)].slice(0, 10); // el último usado va primero
    localStorage.setItem('correos', JSON.stringify(lista));
  } catch (e) {}
}
function cargarCorreos() {
  const lista = leerCorreos();
  if (lista.length && !$('email').value) $('email').value = lista[0];
}
// Lista desplegable propia (la del navegador solo mostraba el correo que ya estaba escrito)
function pintarCorreos() {
  const lista = leerCorreos();
  $('listaCorreos').innerHTML = lista.length
    ? lista.map(c => `<div class="opc" data-c="${esc(c)}"><span>${esc(c)}</span><button type="button" data-del="${esc(c)}" title="Quitar de la lista">✕</button></div>`).join('')
    : '<div class="opc" style="color:#777;cursor:default">Aún no hay correos guardados</div>';
}
function alternarCorreos() { pintarCorreos(); $('listaCorreos').classList.toggle('oculto'); }
$('listaCorreos').addEventListener('click', e => {
  const del = e.target.dataset && e.target.dataset.del;
  if (del !== undefined) {                       // quitar un correo de la lista
    e.stopPropagation();
    try { localStorage.setItem('correos', JSON.stringify(leerCorreos().filter(x => x !== del))); } catch (err) {}
    pintarCorreos(); return;
  }
  const o = e.target.closest('.opc');
  if (o && o.dataset.c) { $('email').value = o.dataset.c; $('listaCorreos').classList.add('oculto'); $('pass').focus(); }
});
document.addEventListener('click', e => { if (!e.target.closest('.combo')) $('listaCorreos').classList.add('oculto'); });
async function entrar() {
  const correo = $('email').value.trim();
  const { error } = await db.auth.signInWithPassword({ email: correo, password: $('pass').value });
  if (error) {
    $('okLogin').textContent = '';
    $('errLogin').textContent = /not confirmed/i.test(error.message)
      ? 'Tu correo aún no está confirmado. Pide al administrador que lo confirme.' : 'Correo o contraseña incorrectos.';
    return;
  }
  modoClave = false;
  guardarCorreo(correo); $('pass').value = ''; $('errLogin').textContent = ''; $('okLogin').textContent = ''; iniciar();
}
$('pass').addEventListener('keydown', e => { if (e.key === 'Enter') entrar(); });
cargarCorreos();
async function salir() { await db.auth.signOut(); iniciar(); }
async function olvide() {
  const c = $('email').value.trim();
  $('okLogin').textContent = '';
  if (!c) { $('errLogin').textContent = 'Escribe tu correo arriba y vuelve a pulsar «¿Olvidaste tu contraseña?».'; return; }
  const { error } = await db.auth.resetPasswordForEmail(c, { redirectTo: location.origin + location.pathname });
  if (error) { $('errLogin').textContent = /seconds|rate/i.test(error.message) ? 'Espera un minuto antes de pedir otro enlace.' : error.message; return; }
  $('errLogin').textContent = '';
  $('okLogin').textContent = 'Si el correo está registrado, te enviamos un enlace para crear una contraseña nueva. Revisa también la carpeta de spam.';
}
async function guardarClave() {
  const a = $('clave1').value, b = $('clave2').value, err = t => { $('errClave').textContent = t; };
  if (a.length < 8) return err('La contraseña debe tener al menos 8 caracteres.');
  if (a !== b) return err('Las contraseñas no coinciden.');
  const { error } = await db.auth.updateUser({ password: a });
  if (error) return err(error.message);
  modoClave = false; err(''); $('clave1').value = $('clave2').value = '';
  history.replaceState(null, '', location.pathname + location.search);
  iniciar();
}
$('clave2').addEventListener('keydown', e => { if (e.key === 'Enter') guardarClave(); });

function alternarMenu(forzar) {
  const abrir = typeof forzar === 'boolean' ? forzar : $('menu').classList.contains('oculto');
  $('menu').classList.toggle('oculto', !abrir);
  $('menuBackdrop').classList.toggle('oculto', !abrir);
  $('btnMenu').setAttribute('aria-expanded', String(abrir));
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') alternarMenu(false); });
function vista(v) {
  if (v === 'cod' && !esAdmin) v = 'inicio';   // crear códigos: solo admin
  if (v === 'ventas' && !esAdmin) v = 'inicio';
  ['inicio', 'etq', 'adm', 'cod', 'ventas', 'caja', 'comprobantes'].forEach(x => $(x).classList.toggle('oculto', x !== v));
  alternarMenu(false);
  if (v === 'inicio' && delta) document.body.className = delta > 0 ? 'entrada' : 'salida';
  else document.body.className = '';
  $('btnVolver').classList.toggle('oculto', v === 'inicio');
  if (!rolCargado && uidActual) cargarRol(uidActual);   // reintenta si el rol no se pudo leer
  if (v === 'inicio' || v === 'etq') cargarCatalogo();
  if (v === 'adm') { cargarAdmin(); if (esAdmin) reporte(); }
  if (v === 'cod') abrirCodigos();
  if (v === 'ventas') cargarEstadisticasVentas();
  if (v === 'caja') cargarCaja();
  if (v === 'comprobantes') cargarComprobantes();
  if (v === 'inicio' && !$('codigo').disabled) $('codigo').focus();
}
async function cargarRol(uid, intento = 0) {
  const { data, error } = await db.from('perfiles').select('rol').eq('id', uid).maybeSingle();
  if (uid !== uidActual) return;
  if (error) {
    console.error('No se pudo leer el rol:', error);
    if (intento < 2) return setTimeout(() => cargarRol(uid, intento + 1), 1200);
  }
  rolCargado = !error;
  esAdmin = !!data && String(data.rol || '').trim().toLowerCase() === 'admin';
  // junto al correo se ve el rol detectado, para comprobar que quedó bien
  $('quien').textContent = usuarioEmail + ' · ' + (error ? 'no se pudo leer el rol' : !data ? 'sin perfil' : esAdmin ? 'admin' : String(data.rol));
  // Inventario lo ve todo el mundo (solo lectura); crear códigos y editar es solo admin
  $('btnEntrada').classList.toggle('oculto', !esAdmin);
  $('btnCodigos').classList.toggle('oculto', !esAdmin);
  $('btnNuevoCod').classList.toggle('oculto', !esAdmin);
  $('btnVentas').classList.toggle('oculto', !esAdmin);
  $('btnCaja').classList.toggle('oculto', !uidActual);
  $('admMov').classList.toggle('oculto', !esAdmin);
  if (!$('adm').classList.contains('oculto')) vista('adm');   // si ya estaba en Inventario, redibujar según el rol
  if (!$('ventas').classList.contains('oculto') && !esAdmin) vista('inicio');
}

// ---------- DATOS ----------
// Supabase devuelve máx. 1000 filas por consulta: se pide por páginas
async function traerTodos(cols) {
  const out = [];
  for (let d = 0; ; d += 1000) {
    const { data, error } = await db.from('productos').select(cols).order('id').range(d, d + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}
async function cargarCatalogo() {
  try {
    let data;
    try { data = await traerTodos('id,codigo,nombre,precio_normal,precio_en_vivo,precio_mayorista'); }
    catch (e) { data = await traerTodos('id,codigo,nombre'); }   // si el rol no puede leer precios
    data.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    catalogo = data; indice = new Map(data.map(p => [p.codigo, p]));
    pintarCat(); pintarPedido();
  } catch (e) { console.error(e); }
}
function precioDe(codigo) {
  const p = indice.get(codigo), tipo = precioElegido[codigo] || 'precio_en_vivo', v = p && p[tipo];
  return v == null || v === '' ? null : Number(v);
}
