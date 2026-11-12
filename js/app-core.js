// ====== CONFIGURA ESTO (Supabase > Project Settings > API) ======
const SUPABASE_URL = 'https://zfeazyxionredunjqxdx.supabase.co';
const SUPABASE_KEY = 'sb_publishable_W1HNg5ZTFEEi3SegFC5r0A_RzFSOZiO';   // clave pública (publishable); la seguridad la da RLS
// ================================================================
// Enlace del correo (invitación / recuperar contraseña): Supabase lo manda con datos en el # de la dirección
const hashParams = new URLSearchParams(location.hash.slice(1));
const queryParams = new URLSearchParams(location.search);
let modoClave = ['invite', 'recovery', 'signup'].includes(hashParams.get('type') || queryParams.get('type'));
const errorEnlace = hashParams.get('error') || queryParams.get('error')
  ? 'El enlace del correo expiró o ya fue usado. Pulsa «¿Olvidaste tu contraseña?» para recibir uno nuevo.'
  : '';
if (errorEnlace) history.replaceState(null, '', location.pathname);
const db = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { storage: window.sessionStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
});
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt = n => '$' + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const sinNombre = n => { const t = (n || '').trim(); return !t || /^sin nombre$/i.test(t); };
const nombreValido = n => n.length >= 2 && /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(n) && !sinNombre(n);

let delta = 0, pedido = [], catalogo = [], indice = new Map(), cant = {}, precioElegido = {}, cola = Promise.resolve();
let esAdmin = false, esPersonal = false, rolCargado = false, prods = [], uidActual = null, usuarioEmail = '';
let bloqueo = null, descartados = 0, compActual = null, avisoT = null, timerGuardado = null;
let colaGuardado = Promise.resolve();
const CLAVES_VIGILANCIA_SESION = {
  usuario: 'camilaSesionUsuario',
  fecha: 'camilaSesionFecha',
  actividad: 'camilaSesionActividad'
};
const DURACION_INACTIVIDAD_SESION = 3 * 60 * 60 * 1000;
const ZONA_HORARIA_SESION = 'America/Guayaquil';
let timerVigilanciaSesion = null, cerrandoSesionPorTiempo = false, razonCierreAutomatico = '';

// ---------- SESIÓN ----------
async function iniciar() {
  const { data: { session } } = await db.auth.getSession();
  mostrar(session);
}
function fechaSesionEcuador(fecha = new Date()) {
  const partes = new Intl.DateTimeFormat('en', {
    timeZone: ZONA_HORARIA_SESION, year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(fecha);
  const parte = tipo => partes.find(p => p.type === tipo).value;
  return `${parte('year')}-${parte('month')}-${parte('day')}`;
}
function cerrarSesionPorTiempo(motivo) {
  if (cerrandoSesionPorTiempo) return;
  cerrandoSesionPorTiempo = true;
  razonCierreAutomatico = motivo;
  $('app').classList.add('oculto');
  $('login').classList.remove('oculto');
  document.body.classList.add('loginPage');
  db.auth.signOut({ scope: 'local' }).then(({ error }) => {
    if (error) throw error;
  }).catch(error => {
    console.error('No se pudo cerrar automáticamente la sesión:', error);
    $('errLogin').textContent = 'No se pudo cerrar automáticamente la sesión. Se volverá a intentar.';
    cerrandoSesionPorTiempo = false;
    razonCierreAutomatico = '';
  });
}
function vigilarSesion(session) {
  const ahora = Date.now();
  const fechaHoy = fechaSesionEcuador(new Date(ahora));
  const usuarioGuardado = sessionStorage.getItem(CLAVES_VIGILANCIA_SESION.usuario);
  const fechaGuardada = sessionStorage.getItem(CLAVES_VIGILANCIA_SESION.fecha);
  const actividadGuardada = Number(sessionStorage.getItem(CLAVES_VIGILANCIA_SESION.actividad));
  if (usuarioGuardado === session.user.id && fechaGuardada && Number.isFinite(actividadGuardada)) {
    if (fechaGuardada !== fechaHoy) {
      cerrarSesionPorTiempo('La sesión se cerró automáticamente a la medianoche de Ecuador. Inicia sesión de nuevo.');
      return false;
    }
    if (ahora - actividadGuardada >= DURACION_INACTIVIDAD_SESION) {
      cerrarSesionPorTiempo('La sesión se cerró automáticamente después de 3 horas sin actividad. Inicia sesión de nuevo.');
      return false;
    }
  } else {
    sessionStorage.setItem(CLAVES_VIGILANCIA_SESION.usuario, session.user.id);
    sessionStorage.setItem(CLAVES_VIGILANCIA_SESION.fecha, fechaHoy);
    sessionStorage.setItem(CLAVES_VIGILANCIA_SESION.actividad, String(ahora));
  }
  clearInterval(timerVigilanciaSesion);
  timerVigilanciaSesion = setInterval(() => vigilarSesion(session), 30000);
  return true;
}
function registrarActividadSesion() {
  if (!uidActual || cerrandoSesionPorTiempo) return;
  const sessionUser = sessionStorage.getItem(CLAVES_VIGILANCIA_SESION.usuario);
  if (sessionUser !== uidActual) return;
  const ahora = Date.now();
  const fechaGuardada = sessionStorage.getItem(CLAVES_VIGILANCIA_SESION.fecha);
  const ultimaActividad = Number(sessionStorage.getItem(CLAVES_VIGILANCIA_SESION.actividad));
  if (fechaGuardada !== fechaSesionEcuador(new Date(ahora))) {
    cerrarSesionPorTiempo('La sesión se cerró automáticamente a la medianoche de Ecuador. Inicia sesión de nuevo.');
    return;
  }
  if (!Number.isFinite(ultimaActividad) || ahora - ultimaActividad >= DURACION_INACTIVIDAD_SESION) {
    cerrarSesionPorTiempo('La sesión se cerró automáticamente después de 3 horas sin actividad. Inicia sesión de nuevo.');
    return;
  }
  sessionStorage.setItem(CLAVES_VIGILANCIA_SESION.actividad, String(ahora));
}
function limpiarVigilanciaSesion() {
  clearInterval(timerVigilanciaSesion);
  timerVigilanciaSesion = null;
  for (const clave of Object.values(CLAVES_VIGILANCIA_SESION)) sessionStorage.removeItem(clave);
  cerrandoSesionPorTiempo = false;
}
['pointerdown', 'keydown', 'touchstart', 'wheel'].forEach(evento =>
  document.addEventListener(evento, registrarActividadSesion, { passive: true })
);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && uidActual && timerVigilanciaSesion) {
    const ahora = Date.now();
    const ultimaActividad = Number(sessionStorage.getItem(CLAVES_VIGILANCIA_SESION.actividad));
    if (fechaSesionEcuador(new Date(ahora)) !== sessionStorage.getItem(CLAVES_VIGILANCIA_SESION.fecha)) {
      cerrarSesionPorTiempo('La sesión se cerró automáticamente a la medianoche de Ecuador. Inicia sesión de nuevo.');
    } else if (Number.isFinite(ultimaActividad) && ahora - ultimaActividad >= DURACION_INACTIVIDAD_SESION) {
      cerrarSesionPorTiempo('La sesión se cerró automáticamente después de 3 horas sin actividad. Inicia sesión de nuevo.');
    }
  }
});
function limpiarBusquedas() {
  $('admBuscar').value = '';
  $('buscar').value = '';
}
function reiniciarUI() {
  delta = 0; pedido = []; catalogo = []; indice = new Map(); cant = {}; precioElegido = {}; prods = [];
  bloqueo = null; descartados = 0; compActual = null; esAdmin = false; esPersonal = false; cola = Promise.resolve();
  limpiarBusquedas();
  clearTimeout(timerGuardado); timerGuardado = null;
  $('estadoPedido').textContent = ''; $('estadoPedido').className = '';
  document.body.className = '';
  $('modoTxt').textContent = 'Elige un modo';
  $('codigo').disabled = true; $('codigo').value = '';
  limpiarCliente(); $('exist').textContent = '—'; $('aviso').classList.add('oculto'); $('zonaEscaneo').classList.add('oculto');
  $('modalNombre').classList.add('oculto'); $('modalComp').classList.add('oculto');
  $('btnEntrada').classList.add('oculto'); $('btnCodigos').classList.add('oculto'); $('btnCombos').classList.add('oculto'); $('btnNuevoCod').classList.add('oculto'); $('admMov').classList.add('oculto');
  $('btnVentas').classList.add('oculto'); $('btnCaja').classList.add('oculto'); $('btnWhatsApp').classList.add('oculto');
  $('menu').classList.add('oculto'); $('menuBackdrop').classList.add('oculto');
  $('btnMenu').setAttribute('aria-expanded', 'false'); $('btnVolver').classList.add('oculto'); rolCargado = false;
  limpiarWhatsApp();
  pintarPedido();
}
function mostrar(session) {
  const pideClave = !!session && modoClave;     // llegó por enlace del correo: primero debe crear su contraseña
  if (session && !pideClave && !vigilarSesion(session)) return;
  document.body.classList.toggle('loginPage', !session && !pideClave);
  $('login').classList.toggle('oculto', !!session);
  $('clave').classList.toggle('oculto', !pideClave);
  $('app').classList.toggle('oculto', !session || pideClave);
  if (!session) {
    limpiarVigilanciaSesion();
    if (uidActual) reiniciarUI();
    document.body.className = 'loginPage';
    if (razonCierreAutomatico) $('errLogin').textContent = razonCierreAutomatico;
    razonCierreAutomatico = '';
    uidActual = null; cargarCorreos(); return;
  }
  if (pideClave) {
    limpiarVigilanciaSesion();
    setTimeout(() => $('clave1').focus(), 50);
    return;
  }
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
async function salir() {
  $('errLogin').textContent = '';
  const { error } = await db.auth.signOut({ scope: 'local' });
  if (error) {
    console.error('No se pudo cerrar la sesión:', error);
    alert('No se pudo cerrar la sesión: ' + error.message);
    return;
  }
  iniciar();
}
async function olvide() {
  const c = $('email').value.trim();
  $('okLogin').textContent = '';
  if (!c) { $('errLogin').textContent = 'Escribe tu correo arriba y vuelve a pulsar «¿Olvidaste tu contraseña?».'; return; }
  const redirect = new URL(location.href);
  redirect.search = '';
  redirect.hash = '';
  const { error } = await db.auth.resetPasswordForEmail(c, { redirectTo: redirect.href });
  if (error) { $('errLogin').textContent = /seconds|rate/i.test(error.message) ? 'Espera un minuto antes de pedir otro enlace.' : error.message; return; }
  $('errLogin').textContent = '';
  $('okLogin').textContent = 'Si el correo está registrado, te enviamos un enlace para crear una contraseña nueva. Revisa también la carpeta de spam.';
}
function actualizarFuerzaClave() {
  const clave = $('clave1').value;
  const requisitos = [
    clave.length >= 8,
    /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]/.test(clave),
    /\d/.test(clave),
    clave.length >= 12 || (/[a-záéíóúüñ]/.test(clave) && /[A-ZÁÉÍÓÚÜÑ]/.test(clave)) || /[^A-Za-zÁÉÍÓÚÜÑáéíóúüñ\d]/.test(clave)
  ];
  const fuerza = requisitos.filter(Boolean).length;
  const barra = $('fuerzaClaveBarra');
  const etiqueta = $('fuerzaClaveTexto');
  const segura = fuerza === requisitos.length;
  const medidor = barra.parentElement;
  barra.style.width = `${Math.max(10, fuerza * 25)}%`;
  barra.classList.toggle('segura', segura);
  etiqueta.classList.toggle('segura', segura);
  medidor.setAttribute('aria-valuenow', String(fuerza));
  medidor.setAttribute('aria-valuetext', segura ? 'segura' : 'insegura');
  etiqueta.textContent = segura ? 'Fuerza: segura' : 'Fuerza: insegura';
  return fuerza === requisitos.length;
}
function alternarVisibilidadClave(boton) {
  const campo = $(boton.dataset.target);
  const mostrar = campo.type === 'password';
  campo.type = mostrar ? 'text' : 'password';
  boton.textContent = mostrar ? 'Ocultar' : 'Mostrar';
  boton.setAttribute('aria-label', `${mostrar ? 'Ocultar' : 'Mostrar'} contraseña`);
  boton.setAttribute('aria-pressed', String(mostrar));
}
async function guardarClave() {
  const a = $('clave1').value, b = $('clave2').value, err = t => { $('errClave').textContent = t; };
  if (!actualizarFuerzaClave()) return err('La contraseña debe tener al menos 8 caracteres e incluir letras y números. Añade mayúsculas, símbolos o más caracteres para que sea segura.');
  if (a !== b) return err('Las contraseñas no coinciden.');
  const boton = $('guardarClaveBtn');
  boton.disabled = true;
  let error;
  try {
    ({ error } = await db.auth.updateUser({ password: a }));
  } finally {
    boton.disabled = false;
  }
  if (error) return err(error.message);
  modoClave = false; err(''); $('clave1').value = $('clave2').value = '';
  history.replaceState(null, '', location.pathname + location.search);
  iniciar();
}
$('clave1').addEventListener('input', () => { actualizarFuerzaClave(); $('errClave').textContent = ''; });
$('clave2').addEventListener('input', () => { $('errClave').textContent = ''; });
document.querySelectorAll('.password-toggle').forEach(boton => boton.addEventListener('click', () => alternarVisibilidadClave(boton)));
['clave1', 'clave2'].forEach(id => $(id).addEventListener('keydown', e => { if (e.key === 'Enter') guardarClave(); }));
actualizarFuerzaClave();

function alternarMenu(forzar) {
  const abrir = typeof forzar === 'boolean' ? forzar : $('menu').classList.contains('oculto');
  $('menu').classList.toggle('oculto', !abrir);
  $('menuBackdrop').classList.toggle('oculto', !abrir);
  $('btnMenu').setAttribute('aria-expanded', String(abrir));
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') alternarMenu(false); });
function vista(v) {
  if (v === 'cod' && !esAdmin) v = 'inicio';   // crear códigos: solo admin
  if (v === 'combos' && !esAdmin) v = 'inicio';
  if (v === 'ventas' && !esAdmin) v = 'inicio';
  if (v === 'whatsapp' && !esPersonal) v = 'inicio';
  limpiarBusquedas();
  ['inicio', 'etq', 'adm', 'cod', 'combos', 'ventas', 'caja', 'comprobantes', 'whatsapp'].forEach(x => $(x).classList.toggle('oculto', x !== v));
  alternarMenu(false);
  if (v === 'inicio' && delta) document.body.className = delta > 0 ? 'entrada' : 'salida';
  else document.body.className = '';
  $('btnVolver').classList.toggle('oculto', v === 'inicio');
  if (!rolCargado && uidActual) cargarRol(uidActual);   // reintenta si el rol no se pudo leer
  if (v === 'inicio' || v === 'etq') cargarCatalogo();
  if (v === 'adm') { cargarAdmin(); if (esAdmin) reporte(); }
  if (v === 'cod') abrirCodigos();
  if (v === 'combos') abrirCombos();
  if (v === 'ventas') cargarEstadisticasVentas();
  if (v === 'caja') cargarCaja();
  if (v === 'comprobantes') cargarComprobantes();
  if (v === 'whatsapp') cargarConversacionesWhatsApp();
  if (v === 'inicio') cargarCombosPedido();
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
  esPersonal = !!data && !!String(data.rol || '').trim();
  // junto al correo se ve el rol detectado, para comprobar que quedó bien
  $('quien').textContent = usuarioEmail + ' · ' + (error ? 'no se pudo leer el rol' : !data ? 'sin perfil' : esAdmin ? 'admin' : String(data.rol));
  // Inventario lo ve todo el mundo (solo lectura); crear códigos y editar es solo admin
  $('btnEntrada').classList.toggle('oculto', !esAdmin);
  $('btnCodigos').classList.toggle('oculto', !esAdmin);
  $('btnCombos').classList.toggle('oculto', !esAdmin);
  $('btnNuevoCod').classList.toggle('oculto', !esAdmin);
  $('btnVentas').classList.toggle('oculto', !esAdmin);
  $('btnCaja').classList.toggle('oculto', !uidActual);
  $('btnWhatsApp').classList.toggle('oculto', !esPersonal);
  $('admMov').classList.toggle('oculto', !esAdmin);
  if (!$('adm').classList.contains('oculto')) vista('adm');   // si ya estaba en Inventario, redibujar según el rol
  if (!$('ventas').classList.contains('oculto') && !esAdmin) vista('inicio');
  if (!$('whatsapp').classList.contains('oculto') && !esPersonal) vista('inicio');
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
    try { data = await traerTodos('id,codigo,nombre,cantidad,precio_normal,precio_en_vivo,precio_mayorista'); }
    catch (e) {
      try { data = await traerTodos('id,codigo,nombre,cantidad'); }
      catch (err) { data = await traerTodos('id,codigo,nombre'); }
    }   // si el rol no puede leer precios o existencias
    data.sort((a, b) => (a.nombre || '').localeCompare(b.nombre || '', 'es'));
    catalogo = data; indice = new Map(data.map(p => [p.codigo, p]));
    pintarCat(); pintarPedido();
  } catch (e) { console.error(e); }
}
function precioDe(codigo) {
  const p = indice.get(codigo), tipo = precioElegido[codigo] || 'precio_en_vivo', v = p && p[tipo];
  return v == null || v === '' ? null : Number(v);
}
