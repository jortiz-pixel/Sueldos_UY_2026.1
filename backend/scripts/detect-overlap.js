/* Detecta superposiciones de texto en un PDF con pdfjs: toma cada ítem de texto, su
 * caja (x,y,ancho,alto) y reporta pares que se solapan de forma significativa en la
 * misma página. Dev-only. */
const fs = require('fs');
const pdfjsLib = require('pdfjs-dist/legacy/build/pdf.js');

const file = process.argv[2] || '/tmp/informe/informe_sample.pdf';

function boxesOverlap(a, b) {
  // Solape de áreas en puntos PDF. Ignora solapes mínimos (<1.5pt en cada eje).
  const ix = Math.min(a.x1, b.x1) < Math.max(a.x0, b.x0) ? 0 : (Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0));
  const iy = Math.min(a.y1, b.y1) < Math.max(a.y0, b.y0) ? 0 : (Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));
  return ix > 1.5 && iy > 1.5;
}

(async () => {
  const data = new Uint8Array(fs.readFileSync(file));
  const doc = await pdfjsLib.getDocument({ data, useSystemFonts: false }).promise;
  let total = 0;
  const report = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .filter((it) => (it.str || '').trim().length)
      .map((it) => {
        const [a, b, c, d, e, f] = it.transform; // d = font scale (alto), e = x, f = y (baseline)
        const h = Math.max(it.height || Math.abs(d), 4);
        const w = it.width || 0;
        return { str: it.str, x0: e, x1: e + w, y0: f - 1, y1: f + h, line: Math.round(f) };
      });
    // Comparar ítems en líneas de base cercanas o superpuestas verticalmente.
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const A = items[i], B = items[j];
        if (Math.abs(A.line - B.line) > 14) continue; // solo cercanos verticalmente
        if (boxesOverlap(A, B)) {
          total++;
          report.push(`p${p} y~${A.line}/${B.line}: [${A.str.slice(0, 32)}] ⨯ [${B.str.slice(0, 32)}]`);
        }
      }
    }
  }
  console.log(`Páginas: ${doc.numPages} · superposiciones: ${total}`);
  for (const r of report.slice(0, 60)) console.log('  ' + r);
  if (total > 60) console.log(`  … y ${total - 60} más`);
  process.exit(total ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
