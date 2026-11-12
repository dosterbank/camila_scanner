// Set this to the HTTPS hostname that resolves to the n8n PC on the office LAN.
const N8N_LOCAL_API_BASE_URL = 'https://n8n-camila.fullpiston.com';
const N8N_INBOX_PATH = '/webhook/crm-inbox';
const N8N_CONTROL_PATH = '/webhook/crm-bot-control';
const INTERVALO_REFRESCO_WHATSAPP_MS = 10000;

let conversacionesWhatsApp = [];
let pausaGlobalWhatsApp = false;
let solicitudConversacionesWhatsApp = 0;
let refrescandoWhatsApp = false;
let operacionControlGlobalWhatsApp = false;

function limpiarWhatsApp() {
  conversacionesWhatsApp = [];
  pausaGlobalWhatsApp = false;
  solicitudConversacionesWhatsApp++;
  $('listaConversacionesWhatsApp').replaceChildren();
  $('btnPausaGlobalWhatsApp').disabled = true;
  $('btnPausaGlobalWhatsApp').textContent = 'Cargando estado del bot…';
  $('btnReactivarTodosWhatsApp').disabled = true;
  mostrarEstadoWhatsApp('');
}

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

function pintarControlGlobalWhatsApp() {
  const boton = $('btnPausaGlobalWhatsApp');
  boton.disabled = !esPersonal || operacionControlGlobalWhatsApp;
  boton.textContent = pausaGlobalWhatsApp ? 'Activar bot para todos' : 'Desactivar bot para todos';
  boton.classList.toggle('r', !pausaGlobalWhatsApp);
  boton.classList.toggle('v', pausaGlobalWhatsApp);
  $('btnReactivarTodosWhatsApp').disabled = !esPersonal || operacionControlGlobalWhatsApp;
}

function fechaLlegadaConversacionWhatsApp(conversacion) {
  return conversacion.recibido_en || conversacion.primera_atencion_en
    || conversacion.creado_en || conversacion.actualizado_en || '';
}

function ordenarConversacionesWhatsApp(conversaciones) {
  return conversaciones.slice().sort((a, b) => {
    const fechaA = Date.parse(fechaLlegadaConversacionWhatsApp(a));
    const fechaB = Date.parse(fechaLlegadaConversacionWhatsApp(b));
    const tiempoA = Number.isFinite(fechaA) ? fechaA : Number.MAX_SAFE_INTEGER;
    const tiempoB = Number.isFinite(fechaB) ? fechaB : Number.MAX_SAFE_INTEGER;
    return tiempoA - tiempoB || String(a.id).localeCompare(String(b.id));
  });
}

function pintarConversacionesWhatsApp() {
  const lista = $('listaConversacionesWhatsApp');
  const ordenadas = ordenarConversacionesWhatsApp(conversacionesWhatsApp);
  if (!ordenadas.length) {
    lista.innerHTML = '<li class="whatsapp-empty">No hay chats que requieran atención.</li>';
    return;
  }

  lista.innerHTML = ordenadas.map((conversacion, indice) => {
    const llegada = fechaLlegadaConversacionWhatsApp(conversacion);
    const fecha = llegada ? new Date(llegada) : null;
    const hora = fecha && !Number.isNaN(fecha.getTime())
      ? new Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' }).format(fecha)
      : 'Hora de llegada no disponible';
    const nombre = conversacion.nombre || 'Cliente WhatsApp';
    return `<li class="whatsapp-queue-item">
      <span class="whatsapp-queue-position">${indice + 1}</span>
      <div class="whatsapp-queue-details">
        <strong>${esc(nombre)}</strong>
        <span>${esc(conversacion.telefono || '')}</span>
        <small>${esc(conversacion.motivo || 'Solicita atención humana')} · Llegó ${esc(hora)}</small>
      </div>
      <button type="button" class="v" data-atender-conversacion="${esc(conversacion.id)}">Atendido</button>
    </li>`;
  }).join('');
}

async function cargarEstadoBotWhatsApp() {
  const result = await solicitarApiWhatsApp(N8N_CONTROL_PATH, {
    method: 'POST',
    body: JSON.stringify({ scope: 'global', action: 'status' })
  });
  if (result.ok !== true || typeof result.bot_global_pausado !== 'boolean'
    || !Array.isArray(result.pausados_ahora)) {
    throw new Error('La respuesta del control del bot no tiene el formato esperado.');
  }
  pausaGlobalWhatsApp = result.bot_global_pausado;
  pintarControlGlobalWhatsApp();
}

async function cargarConversacionesWhatsApp(silencioso = false) {
  if (!uidActual || !esPersonal) return false;
  if (refrescandoWhatsApp) return false;
  if (silencioso && (document.hidden || !$('listaConversacionesWhatsApp').offsetParent)) return false;

  refrescandoWhatsApp = true;
  const solicitud = ++solicitudConversacionesWhatsApp;
  try {
    if (!silencioso) mostrarEstadoWhatsApp('Actualizando chats pendientes…');
    const [, result] = await Promise.all([
      cargarEstadoBotWhatsApp(),
      solicitarApiWhatsApp(`${N8N_INBOX_PATH}/conversations?status=abiertas`)
    ]);
    if (solicitud !== solicitudConversacionesWhatsApp) return false;
    if (!Array.isArray(result.conversations) || typeof result.bot_global_pausado !== 'boolean') {
      throw new Error('La lista de atención no tiene el formato esperado.');
    }

    pausaGlobalWhatsApp = result.bot_global_pausado;
    conversacionesWhatsApp = result.conversations.filter(c => c.estado !== 'resuelto');
    pintarControlGlobalWhatsApp();
    pintarConversacionesWhatsApp();
    if (!silencioso) {
      mostrarEstadoWhatsApp(`${conversacionesWhatsApp.length} chat(s) requieren atención.`);
    }
    return true;
  } catch (error) {
    if (solicitud !== solicitudConversacionesWhatsApp) return false;
    if (!silencioso) mostrarEstadoWhatsApp('No se pudo actualizar la lista: ' + error.message, true);
    else console.warn('No se pudo actualizar la lista de atención de WhatsApp:', error);
    return false;
  } finally {
    refrescandoWhatsApp = false;
  }
}

async function alternarPausaGlobalWhatsApp() {
  if (!esPersonal || !uidActual || operacionControlGlobalWhatsApp) return;
  const accion = pausaGlobalWhatsApp ? 'resume' : 'pause';
  const pregunta = pausaGlobalWhatsApp
    ? '¿Activar el bot para todos? Los chats pendientes seguirán pausados hasta marcarlos como atendidos.'
    : '¿Desactivar el bot para todos los clientes?';
  if (!confirm(pregunta)) return;

  operacionControlGlobalWhatsApp = true;
  pintarControlGlobalWhatsApp();
  mostrarEstadoWhatsApp('Actualizando el estado del bot…');
  try {
    const result = await solicitarApiWhatsApp(N8N_CONTROL_PATH, {
      method: 'POST',
      body: JSON.stringify({ scope: 'global', action: accion })
    });
    if (result.ok !== true) throw new Error('n8n no confirmó el cambio.');
    await cargarConversacionesWhatsApp();
  } catch (error) {
    mostrarEstadoWhatsApp('No se pudo cambiar el estado global: ' + error.message, true);
  } finally {
    operacionControlGlobalWhatsApp = false;
    pintarControlGlobalWhatsApp();
  }
}

async function reactivarTodosWhatsApp() {
  if (!esPersonal || !uidActual || operacionControlGlobalWhatsApp) return;
  if (!confirm('¿Reactivar el bot para todos, incluso para los clientes con chats pendientes? Los chats seguirán en la cola de atención.')) return;

  operacionControlGlobalWhatsApp = true;
  pintarControlGlobalWhatsApp();
  mostrarEstadoWhatsApp('Reactivando los clientes pausados…');
  try {
    const estado = await solicitarApiWhatsApp(N8N_CONTROL_PATH, {
      method: 'POST',
      body: JSON.stringify({ scope: 'global', action: 'status' })
    });
    if (estado.ok !== true || !Array.isArray(estado.pausados_ahora)) {
      throw new Error('El estado de pausas devuelto por n8n no tiene el formato esperado.');
    }

    const telefonos = new Set();
    for (const cliente of estado.pausados_ahora) {
      const numero = cliente && (cliente.numero || cliente.phone);
      const normalizado = String(numero || '').replace(/\D/g, '');
      if (normalizado.length < 7 || normalizado.length > 15) {
        throw new Error('La lista de pausas contiene un teléfono no válido; no se modificó el estado.');
      }
      telefonos.add(normalizado);
    }

    const fallidos = [];
    for (const telefono of telefonos) {
      try {
        const result = await solicitarApiWhatsApp(N8N_CONTROL_PATH, {
          method: 'POST',
          body: JSON.stringify({ scope: 'customer', action: 'resume', phone: telefono })
        });
        if (result.ok !== true) throw new Error('n8n no confirmó la reactivación.');
      } catch (error) {
        fallidos.push(error.message || 'Error desconocido');
      }
    }

    const global = await solicitarApiWhatsApp(N8N_CONTROL_PATH, {
      method: 'POST',
      body: JSON.stringify({ scope: 'global', action: 'resume' })
    });
    if (global.ok !== true) throw new Error('n8n no confirmó la reactivación global.');
    const actualizada = await cargarConversacionesWhatsApp();

    if (fallidos.length) {
      mostrarEstadoWhatsApp(`El bot global quedó activo, pero no se pudieron reactivar ${fallidos.length} de ${telefonos.size} clientes. Error: ${fallidos[0]}`, true);
    } else if (!actualizada) {
      mostrarEstadoWhatsApp(`Bot reactivado para todos (${telefonos.size} cliente(s)), pero no se pudo actualizar la cola.`, true);
    } else {
      mostrarEstadoWhatsApp(`Bot reactivado para todos (${telefonos.size} cliente(s)); los chats pendientes siguen en la cola.`);
    }
  } catch (error) {
    mostrarEstadoWhatsApp('No se pudo completar la reactivación global: ' + error.message, true);
  } finally {
    operacionControlGlobalWhatsApp = false;
    pintarControlGlobalWhatsApp();
  }
}

async function atenderConversacionWhatsApp(id, boton) {
  const conversacion = conversacionesWhatsApp.find(c => String(c.id) === id);
  if (!conversacion || !esPersonal || !uidActual) return;
  if (!confirm(`¿Marcar como atendido el chat de ${conversacion.nombre || conversacion.telefono || 'este cliente'} y dejarlo listo para la reactivación automática de medianoche?`)) return;

  boton.disabled = true;
  mostrarEstadoWhatsApp('Marcando el chat como atendido…');
  try {
    const result = await solicitarApiWhatsApp(`${N8N_INBOX_PATH}/resolve`, {
      method: 'POST',
      body: JSON.stringify({ conversation_id: conversacion.id, action: 'resolve' })
    });
    if (result.ok !== true) throw new Error('n8n no confirmó que el chat quedó atendido.');
    mostrarEstadoWhatsApp('Chat atendido y bot reactivado para ese cliente.');
    await cargarConversacionesWhatsApp();
  } catch (error) {
    boton.disabled = false;
    mostrarEstadoWhatsApp('No se pudo atender el chat: ' + error.message, true);
  }
}

$('listaConversacionesWhatsApp').addEventListener('click', event => {
  const boton = event.target.closest('[data-atender-conversacion]');
  if (boton) atenderConversacionWhatsApp(boton.dataset.atenderConversacion, boton);
});

function refrescarWhatsAppSilencioso() {
  if (refrescandoWhatsApp || document.hidden || !uidActual || !esPersonal) return;
  const lista = $('listaConversacionesWhatsApp');
  if (!lista || !lista.offsetParent) return;
  cargarConversacionesWhatsApp(true);
}

setInterval(refrescarWhatsAppSilencioso, INTERVALO_REFRESCO_WHATSAPP_MS);
