// ---------- ETIQUETAS 32x25 mm ----------
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
  let html = '', total = 0; const malos = [];
  sel.forEach(p => {
    let svg; try { svg = svgCodigo(p.codigo); } catch (e) { malos.push(p.codigo); return; }
    for (let i = 0; i < cant[p.codigo]; i++, total++)
      html += `<div class="et"><div class="tit">Distribuidora Camila</div><div class="bc">${svg}</div><div class="num">${esc(p.codigo)}</div><div class="nom">${esc(p.nombre)}</div></div>`;
  });
  if (malos.length) alert('Códigos inválidos para el formato elegido (omitidos):\n' + malos.join('\n'));
  if (!total) return;
  const dx = parseFloat($('dx').value) || 0, dy = parseFloat($('dy').value) || 0, an = parseFloat($('ancho').value) || 29;
  const css = `@page{size:32mm 25mm;margin:0}html,body{margin:0}
.et{position:relative;width:32mm;height:25mm;overflow:hidden;transform:translate(${dx}mm,${dy}mm);font-family:Arial,sans-serif;break-after:page}
.et:last-child{break-after:auto}.tit{position:absolute;top:1mm;left:0;right:0;font-size:7pt;font-weight:bold;line-height:1;text-align:center}
.bc{position:absolute;top:7.15mm;left:0;right:0;height:10.7mm}.bc svg{display:block;margin:0 auto;width:${an}mm;height:10.7mm}
.num{position:absolute;top:17.9mm;left:0;right:0;font-size:6.9pt;line-height:1;text-align:center}
.nom{position:absolute;top:20.35mm;left:1.2mm;right:1.2mm;font-size:6.9pt;line-height:.95;text-align:center;max-height:4.65mm;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}`;
  const w = window.open('', '_blank'); if (!w) return alert('Permite las ventanas emergentes.');
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Etiquetas</title><style>${css}</style></head><body>${html}</body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 400);
  cant = {}; pintarCat();
}
