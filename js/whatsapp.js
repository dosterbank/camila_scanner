// Set this to the HTTPS hostname that resolves to the n8n PC on the office LAN.
const N8N_LOCAL_API_BASE_URL = 'https://crm.fullpiston.com';
const N8N_INBOX_PATH = '/webhook/crm-inbox';
const N8N_CONTROL_PATH = '/webhook/crm-bot-control';

let conversacionesWhatsApp = [];
let conversacionWhatsAppActiva = null;
let pausaGlobalWhatsApp = false;
let solicitudConversacionesWhatsApp = 0;
let solicitudMensajesWhatsApp = 0;

function limpiarWhatsApp() {
  conversacionesWhatsApp = [];
  conversacionWhatsAppActiva = null;
  pausaGlobalWhatsApp = false;
  solicitudConversacionesWhatsApp++;
  solicitudMensajesWhatsApp++;
  $('listaConversacionesWhatsApp').innerHTML = '';
  $('clientesPausadosWhatsApp').innerHTML = '';
  $('telefonoPausaWhatsApp').value = '';
  $('encabezadoConversacionWhatsApp').innerHTML = '<p>Selecciona una conversación para ver los mensajes.</p>';
  $('mensajesWhatsApp').innerHTML = '';
  $('textoRespuestaWhatsApp').value = '';
  $('textoRespuestaWhatsApp').disabled = true;
  $('btnEnviarRespuestaWhatsApp').disabled = true;
  $('btnPausaGlobalWhatsApp').disabled = true;
  $('btnPausaGlobalWhatsApp').textContent = 'Cargando estado del bot…';
  $('btnPausaConversacionWhatsApp').disabled = true;
  $('estadoBotConversacionWhatsApp').textContent = 'Selecciona una conversación.';
  mostrarEstadoWhatsApp('');
}

const fechaWhatsApp = valor => {
  const fecha = new Date(valor);
  return Number.isNaN(fecha.getTime())
    ? ''
    : new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' }).format(fecha);
};

function mostrarEstadoWhatsApp(texto, error = false) {
  $('whatsappEstado').textContent = texto;
  $('whatsappEstado').className = error ? 's' : '';
}

function urlApiN8nLocal(path) {
  if (!N8N_LOCAL_API_BASE_URL) {
    throw new Error('Configura N8N_LOCAL_API_BASE_URL en js/whatsapp.js con el HTTPS local de n8n.');
  }
  const base = new URL(N8N_LOCAL_API_BASE_URL);
  if (base.protocol !== 'https:' || base.username || base.password) {
    throw new Error('La conexión local con n8n debe usar HTTPS y no debe incluir credenciales en la URL.');
  }
  return new URL(path, base.origin).toString();
}

async function solicitarApiWhatsApp(path, opciones = {}) {
  const { data: { session }, error: errorSesion } = await db.auth.getSession();
  if (errorSesion) throw errorSesion;
  if (!session) throw new Error('Inicia sesión de nuevo para usar la bandeja.');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(urlApiN8nLocal(path), {
      ...opciones,
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer ' + session.access_token,
        ...(opciones.body ? { 'Content-Type': 'application/json' } : {}),
        ...opciones.headers
      },
      signal: controller.signal,
      mode: 'cors',
      credentials: 'omit'
    });
    let body;
    try {
      body = await response.json();
    } catch {
      throw new Error('El servicio local no devolvió una respuesta JSON válida.');
    }
    if (!response.ok) {
      throw new Error(body && body.error ? body.error : `El servicio local respondió HTTP ${response.status}.`);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('El servicio local devolvió una respuesta con formato no válido.');
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function estadoWhatsAppTexto(estado) {
  return ({
    pendiente: 'Pendiente',
    en_atencion: 'En atención',
    resuelto: 'Resuelta'
  })[estado] || estado || 'Pendiente';
}

function pintarControlGlobalWhatsApp() {
  const boton = $('btnPausaGlobalWhatsApp');
  boton.disabled = !esPersonal;
  boton.textContent = pausaGlobalWhatsApp ? 'Reactivar bot para todos' : 'Pausar bot para todos';
  boton.classList.toggle('r', !pausaGlobalWhatsApp);
  boton.classList.toggle('v', pausaGlobalWhatsApp);
}

function pintarClientesPausadosWhatsApp(clientes) {
  const destino = $('clientesPausadosWhatsApp');
  if (!clientes.length) {
    destino.innerHTML = '<span class="whatsapp-empty">No hay clientes pausados individualmente.</span>';
    return;
  }
  destino.innerHTML = clientes.map(c => {
    const telefono = String(c.numero || c.telefono || '');
    const nombre = c.nombre || telefono;
    return `<span class="whatsapp-paused-item">
      <span>${esc(nombre)}${nombre !== telefono ? ' · ' + esc(telefono) : ''}</span>
      <button type="button" class="v" onclick="reactivarClienteWhatsApp('${esc(telefono)}')">Reactivar</button>
    </span>`;
  }).join('');
}

async function cargarEstadoBotWhatsApp() {
  const result = await solicitarApiWhatsApp(N8N_CONTROL_PATH, {
    method: 'POST',
    body: JSON.stringify({ scope: 'global', action: 'status' })
  });
  if (result.ok !== true || typeof result.bot_global_pausado !== 'boolean' || !Array.isArray(result.pausados_ahora)) {
    throw new Error('La respuesta del control del bot no tiene el formato esperado.');
  }
  pausaGlobalWhatsApp = result.bot_global_pausado;
  pintarControlGlobalWhatsApp();
  pintarClientesPausadosWhatsApp(result.pausados_ahora);
}

function pintarConversacionesWhatsApp() {
  const lista = $('listaConversacionesWhatsApp');
  if (!conversacionesWhatsApp.length) {
    lista.innerHTML = '<p class="whatsapp-empty">No hay conversaciones para este filtro.</p>';
    return;
  }
  lista.innerHTML = conversacionesWhatsApp.map(c => `
    <button type="button" class="whatsapp-conversation${c.id === conversacionWhatsAppActiva ? ' activa' : ''}"
      onclick="seleccionarConversacionWhatsApp('${esc(c.id)}')">
      <strong>${esc(c.nombre || 'Cliente WhatsApp')}</strong>
      <small>${esc(c.telefono || '')} · ${esc(estadoWhatsAppTexto(c.estado))}${c.bot_pausado ? ' · Bot pausado' : ''}</small>
      <span class="whatsapp-preview">${esc(c.ultimo_mensaje || c.motivo || 'Sin mensajes')}</span>
      <small>${esc(fechaWhatsApp(c.actualizado_en))}</small>
    </button>`).join('');
}

function pintarEncabezadoWhatsApp(conversacion) {
  $('encabezadoConversacionWhatsApp').innerHTML = `
    <div><h3>${esc(conversacion.nombre || 'Cliente WhatsApp')}</h3>
      <small>${esc(conversacion.telefono || '')}${conversacion.motivo ? ' · ' + esc(conversacion.motivo) : ''}</small></div>
    <span>${esc(estadoWhatsAppTexto(conversacion.estado))}</span>`;
  const estaPausado = Boolean(conversacion.bot_pausado || pausaGlobalWhatsApp);
  $('estadoBotConversacionWhatsApp').textContent = pausaGlobalWhatsApp
    ? 'El bot está pausado globalmente.'
    : estaPausado ? 'El bot está pausado para este cliente.' : 'El bot está activo para este cliente.';
  $('btnPausaConversacionWhatsApp').textContent = conversacion.bot_pausado
    ? 'Reactivar bot para este cliente'
    : 'Pausar bot para este cliente';
  $('btnPausaConversacionWhatsApp').disabled = !esPersonal || pausaGlobalWhatsApp;
  $('btnPausaConversacionWhatsApp').title = pausaGlobalWhatsApp
    ? 'Primero reactiva el bot global para controlar este cliente.'
    : '';
}

function urlMediaWhatsApp(valor) {
  if (typeof valor !== 'string' || !valor) return '';
  try {
    const url = new URL(valor, N8N_LOCAL_API_BASE_URL);
    return url.protocol === 'https:' && url.origin === new URL(N8N_LOCAL_API_BASE_URL).origin
      ? url.toString()
      : '';
  } catch {
    return '';
  }
}

function contenidoMediaWhatsApp(mensaje) {
  const url = urlMediaWhatsApp(mensaje.media_url);
  const tipo = String(mensaje.tipo || '').toLowerCase();
  if (!url) return '';
  if (tipo === 'image') return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer"><img class="whatsapp-image" src="${esc(url)}" alt="Imagen enviada por el cliente" loading="lazy"></a>`;
  if (tipo === 'audio') return `<audio controls preload="none" src="${esc(url)}">Tu navegador no puede reproducir este audio.</audio>`;
  if (tipo === 'video') return `<video controls preload="none" src="${esc(url)}">Tu navegador no puede reproducir este video.</video>`;
  return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Abrir adjunto</a>`;
}

function pintarMensajesWhatsApp(mensajes) {
  const destino = $('mensajesWhatsApp');
  if (!mensajes.length) {
    destino.innerHTML = '<p class="whatsapp-empty">Todavía no hay mensajes guardados.</p>';
    return;
  }
  destino.innerHTML = mensajes.map(m => {
    const remitente = ['cliente', 'agente', 'bot', 'sistema'].includes(m.remitente) ? m.remitente : 'sistema';
    const contenido = esc(m.contenido || '');
    const media = contenidoMediaWhatsApp(m);
    return `<article class="whatsapp-message ${remitente}">
      ${contenido ? `<span>${contenido}</span>` : ''}${media}
      <time>${esc(remitente === 'agente' && m.autor_email ? m.autor_email + ' · ' : '')}${esc(fechaWhatsApp(m.creado_en))}</time>
    </article>`;
  }).join('');
  destino.scrollTop = destino.scrollHeight;
}

async function seleccionarConversacionWhatsApp(id) {
  conversacionWhatsAppActiva = id;
  pintarConversacionesWhatsApp();
  const conversacion = conversacionesWhatsApp.find(c => c.id === id);
  if (!conversacion) return;
  pintarEncabezadoWhatsApp(conversacion);
  $('textoRespuestaWhatsApp').disabled = false;
  $('btnEnviarRespuestaWhatsApp').disabled = false;
  const solicitud = ++solicitudMensajesWhatsApp;
  $('mensajesWhatsApp').innerHTML = '<p class="whatsapp-empty">Cargando mensajes…</p>';
  try {
    const result = await solicitarApiWhatsApp(`${N8N_INBOX_PATH}/messages?conversation_id=${encodeURIComponent(id)}`);
    if (solicitud !== solicitudMensajesWhatsApp) return;
    if (!Array.isArray(result.messages)) throw new Error('La respuesta de mensajes no tiene el formato esperado.');
    pintarMensajesWhatsApp(result.messages);
    mostrarEstadoWhatsApp('');
  } catch (error) {
    if (solicitud !== solicitudMensajesWhatsApp) return;
    $('mensajesWhatsApp').innerHTML = '';
    mostrarEstadoWhatsApp('No se pudieron cargar los mensajes: ' + error.message, true);
  }
}

async function cargarConversacionesWhatsApp() {
  if (!uidActual || !esPersonal) return false;
  const solicitud = ++solicitudConversacionesWhatsApp;
  try {
    await cargarEstadoBotWhatsApp();
  } catch (error) {
    $('btnPausaGlobalWhatsApp').disabled = true;
    mostrarEstadoWhatsApp('No se pudo leer el estado del bot local: ' + error.message, true);
    return false;
  }
  mostrarEstadoWhatsApp('Cargando conversaciones…');
  const filtro = $('filtroEstadoWhatsApp').value;
  try {
    const result = await solicitarApiWhatsApp(`${N8N_INBOX_PATH}/conversations?status=${encodeURIComponent(filtro)}`);
    if (solicitud !== solicitudConversacionesWhatsApp) return;
    if (!Array.isArray(result.conversations) || typeof result.bot_global_pausado !== 'boolean') {
      throw new Error('La respuesta de conversaciones no tiene el formato esperado.');
    }
    conversacionesWhatsApp = result.conversations;
    pausaGlobalWhatsApp = Boolean(result.bot_global_pausado);
    pintarControlGlobalWhatsApp();
    pintarConversacionesWhatsApp();
    mostrarEstadoWhatsApp(conversacionesWhatsApp.length + ' conversación(es).');
    const activa = conversacionesWhatsApp.find(c => c.id === conversacionWhatsAppActiva) || conversacionesWhatsApp[0];
    if (activa) await seleccionarConversacionWhatsApp(activa.id);
    else {
      conversacionWhatsAppActiva = null;
      $('encabezadoConversacionWhatsApp').innerHTML = '<p>Selecciona una conversación para ver los mensajes.</p>';
      $('mensajesWhatsApp').innerHTML = '';
      $('textoRespuestaWhatsApp').disabled = true;
      $('btnEnviarRespuestaWhatsApp').disabled = true;
      $('btnPausaConversacionWhatsApp').disabled = true;
      $('estadoBotConversacionWhatsApp').textContent = 'Selecciona una conversación.';
    }
    return true;
  } catch (error) {
    if (solicitud !== solicitudConversacionesWhatsApp) return;
    conversacionesWhatsApp = [];
    pintarConversacionesWhatsApp();
    $('btnPausaConversacionWhatsApp').disabled = true;
    mostrarEstadoWhatsApp('No se pudo conectar con n8n en la red local: ' + error.message, true);
    return false;
  }
}

async function cambiarControlBotWhatsApp(payload, boton) {
  if (!esPersonal || !uidActual) return;
  if (boton) boton.disabled = true;
  mostrarEstadoWhatsApp('Actualizando control del bot…');
  try {
    const result = await solicitarApiWhatsApp(N8N_CONTROL_PATH, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (result.ok !== true) throw new Error('n8n no confirmó el cambio de estado.');
    await cargarEstadoBotWhatsApp();
    mostrarEstadoWhatsApp('Control del bot actualizado.');
    await cargarConversacionesWhatsApp();
  } catch (error) {
    mostrarEstadoWhatsApp('No se pudo cambiar el estado del bot: ' + error.message, true);
  } finally {
    if (boton) boton.disabled = false;
  }
}

function alternarPausaGlobalWhatsApp() {
  if (!pausaGlobalWhatsApp && !confirm('¿Pausar el bot para todos los clientes?')) return;
  cambiarControlBotWhatsApp({
    scope: 'global',
    action: pausaGlobalWhatsApp ? 'resume' : 'pause'
  }, $('btnPausaGlobalWhatsApp'));
}

function alternarPausaConversacionWhatsApp() {
  const conversacion = conversacionesWhatsApp.find(c => c.id === conversacionWhatsAppActiva);
  if (!conversacion || !conversacion.telefono) return;
  if (!conversacion.bot_pausado && !confirm(`¿Pausar el bot para ${conversacion.nombre || conversacion.telefono}?`)) return;
  cambiarControlBotWhatsApp({
    scope: 'customer',
    action: conversacion.bot_pausado ? 'resume' : 'pause',
    phone: conversacion.telefono
  }, $('btnPausaConversacionWhatsApp'));
}

function pausarClienteWhatsApp() {
  const telefono = $('telefonoPausaWhatsApp').value.trim();
  const digitos = telefono.replace(/\D/g, '');
  if (digitos.length < 7 || digitos.length > 15) {
    mostrarEstadoWhatsApp('Escribe un teléfono válido con código de país.', true);
    return;
  }
  if (!confirm(`¿Pausar el bot para ${telefono}?`)) return;
  cambiarControlBotWhatsApp({
    scope: 'customer',
    action: 'pause',
    phone: telefono
  });
}

function reactivarClienteWhatsApp(telefono) {
  if (!confirm(`¿Reactivar el bot para ${telefono}?`)) return;
  cambiarControlBotWhatsApp({
    scope: 'customer',
    action: 'resume',
    phone: telefono
  });
}

async function responderWhatsApp(event) {
  event.preventDefault();
  const conversacion = conversacionesWhatsApp.find(c => c.id === conversacionWhatsAppActiva);
  const texto = $('textoRespuestaWhatsApp').value.trim();
  if (!conversacion || !texto || !esPersonal) return;
  const boton = $('btnEnviarRespuestaWhatsApp');
  boton.disabled = true;
  mostrarEstadoWhatsApp('Enviando respuesta por n8n y YCloud…');
  try {
    const result = await solicitarApiWhatsApp(N8N_INBOX_PATH + '/reply', {
      method: 'POST',
      body: JSON.stringify({ conversation_id: conversacion.id, text: texto })
    });
    if (result.ok !== true) throw new Error('n8n no confirmó el envío.');
    $('textoRespuestaWhatsApp').value = '';
    mostrarEstadoWhatsApp('Respuesta enviada.');
    await cargarConversacionesWhatsApp();
  } catch (error) {
    mostrarEstadoWhatsApp('No se pudo enviar la respuesta: ' + error.message, true);
  } finally {
    boton.disabled = !conversacionWhatsAppActiva;
  }
}
