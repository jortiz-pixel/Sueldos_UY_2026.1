/**
 * CLI del respaldo legible por empresa. Lo ejecuta deploy/backup.sh dentro del
 * contenedor del backend:  node dist/scripts/backup.js <carpeta-destino>
 */
import { exportarRespaldoCompleto } from '../services/backup.service';
import { prisma } from '../utils/prisma';

async function main() {
  const outDir = process.argv[2] || '/tmp/asystax-export';
  // eslint-disable-next-line no-console
  console.log(`[respaldo] Generando export legible en ${outDir} ...`);
  const res = await exportarRespaldoCompleto(outDir);
  // eslint-disable-next-line no-console
  console.log(`[respaldo] Empresas: ${res.empresas} · Contratos: ${res.contratosPdf} · Recibos: ${res.recibosPdf} · Nóminas: ${res.nominasBps} · Adjuntos: ${res.adjuntos}`);
  if (res.errores.length) {
    // eslint-disable-next-line no-console
    console.warn(`[respaldo] Avisos (${res.errores.length}):\n- ${res.errores.slice(0, 20).join('\n- ')}`);
  }
}

main()
  .then(async () => { await prisma.$disconnect(); process.exit(0); })
  .catch(async (e) => {
    // eslint-disable-next-line no-console
    console.error('[respaldo] Error fatal:', e);
    await prisma.$disconnect();
    process.exit(1);
  });
