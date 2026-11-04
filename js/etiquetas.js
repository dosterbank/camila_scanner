// ---------- ETIQUETAS TÉRMICAS ----------
const PAPELES_ETIQUETA = {
  '52x23': { ancho: 52, alto: 23, codigo: 49, altoCodigo: 9.8, inicioCodigo: 5.7, inicioNumero: 15.8, inicioNombre: 18.2 },
  '32x25': { ancho: 32, alto: 25, codigo: 29, altoCodigo: 10.7, inicioCodigo: 7.15, inicioNumero: 17.9, inicioNombre: 20.35 }
};
const CLAVE_PAPEL_ETIQUETA = 'papelEtiqueta';
function papelEtiqueta() {
  return PAPELES_ETIQUETA[$('papelEtiqueta').value] || PAPELES_ETIQUETA['32x25'];
}
function cargarPapelEtiqueta() {
  try {
    const guardado = localStorage.getItem(CLAVE_PAPEL_ETIQUETA);
    if (PAPELES_ETIQUETA[guardado]) $('papelEtiqueta').value = guardado;
  } catch (e) {
    console.error('Error al leer el tamaño de etiqueta guardado:', e);
  }
  $('ancho').value = String(papelEtiqueta().codigo);
}
function cambiarPapelEtiqueta() {
  $('ancho').value = String(papelEtiqueta().codigo);
  try {
    localStorage.setItem(CLAVE_PAPEL_ETIQUETA, $('papelEtiqueta').value);
  } catch (e) {
    alert('No se pudo guardar el tamaño de etiqueta en este navegador.');
    console.error('Error al guardar el tamaño de etiqueta:', e);
  }
}
function visibles() { const q = $('buscar').value.toLowerCase().trim(); return catalogo.filter(p => !q || (p.nombre || '').toLowerCase().includes(q) || p.codigo.includes(q)); }
function pintarCat() {
  $('cuerpo').innerHTML = visibles().slice(0, 300).map(p =>
    `<tr><td>${esc(p.codigo)}</td><td>${esc(p.nombre)}</td><td><input type="number" min="0" data-c="${esc(p.codigo)}" value="${cant[p.codigo] || 0}"></td></tr>`).join('');
}
$('cuerpo').addEventListener('input', e => { const c = e.target.dataset && e.target.dataset.c; if (c !== undefined) cant[c] = parseInt(e.target.value) || 0; });
function llenar(n) { visibles().slice(0, 300).forEach(p => cant[p.codigo] = n); pintarCat(); }
function svgCodigo(c) {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  JsBarcode(s, c, { format: $('formato').value, width: 2, height: 50, margin: 0, displayValue: false });
  s.setAttribute('viewBox', `0 0 ${parseFloat(s.getAttribute('width'))} ${parseFloat(s.getAttribute('height'))}`);
  s.setAttribute('preserveAspectRatio', 'none'); s.removeAttribute('width'); s.removeAttribute('height');
  return s.outerHTML;
}
function imprimir() {
  const sel = catalogo.filter(p => (cant[p.codigo] || 0) > 0);
  if (!sel.length) return alert('Pon una cantidad mayor a 0.');
  const papel = papelEtiqueta();
  let html = '', total = 0; const malos = [];
  sel.forEach(p => {
    let svg; try { svg = svgCodigo(p.codigo); } catch (e) { malos.push(p.codigo); return; }
    for (let i = 0; i < cant[p.codigo]; i++, total++)
      html += `<div class="et"><div class="tit">Distribuidora Camila</div><div class="bc">${svg}</div><div class="num">${esc(p.codigo)}</div><div class="nom">${esc(p.nombre)}</div></div>`;
  });
  if (malos.length) alert('Códigos inválidos para el formato elegido (omitidos):\n' + malos.join('\n'));
  if (!total) return;
  const dx = parseFloat($('dx').value) || 0, dy = parseFloat($('dy').value) || 0;
  const anchoCodigo = Number($('ancho').value);
  if (!Number.isFinite(anchoCodigo) || anchoCodigo <= 0) return alert('El ancho del código de barras debe ser mayor que 0 mm.');
  const an = Math.min(anchoCodigo, papel.ancho - 2);
  const css = `@page{size:${papel.ancho}mm ${papel.alto}mm;margin:0}html,body{width:${papel.ancho}mm;height:${papel.alto}mm;margin:0;padding:0}
.et{position:relative;width:${papel.ancho}mm;height:${papel.alto}mm;overflow:hidden;transform:translate(${dx}mm,${dy}mm);font-family:Arial,sans-serif;break-after:page}
.et:last-child{break-after:auto}.tit{position:absolute;top:1mm;left:0;right:0;font-size:7pt;font-weight:bold;line-height:1;text-align:center}
.bc{position:absolute;top:${papel.inicioCodigo}mm;left:0;right:0;height:${papel.altoCodigo}mm}.bc svg{display:block;margin:0 auto;width:${an}mm;height:${papel.altoCodigo}mm}
.num{position:absolute;top:${papel.inicioNumero}mm;left:0;right:0;font-size:6.9pt;line-height:1;text-align:center}
.nom{position:absolute;top:${papel.inicioNombre}mm;left:1.2mm;right:1.2mm;font-size:6.9pt;line-height:.95;text-align:center;max-height:${papel.alto - papel.inicioNombre - 0.3}mm;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}`;
  const w = window.open('', '_blank'); if (!w) return alert('Permite las ventanas emergentes.');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etiquetas</title><style>${css}</style></head><body>${html}</body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 400);
  cant = {}; pintarCat();
}
cargarPapelEtiqueta();
