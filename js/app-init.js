db.auth.onAuthStateChange((ev, s) => { if (ev === 'PASSWORD_RECOVERY') modoClave = true; setTimeout(() => mostrar(s), 0); });
if (errorEnlace) $('errLogin').textContent = errorEnlace;
const hoy = fechaLocalISO();
$('fechaVentas').value = hoy; $('fechaCaja').value = hoy;
iniciar();
