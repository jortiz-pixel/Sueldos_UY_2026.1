/**
 * Cotizaciones del BCU (Etapa 2 §6). Toma automática desde el web service SOAP
 * oficial del BCU (awsbcucotizaciones), validado contra el servicio real.
 * Si no hay dato para la fecha, devuelve null (NO se inventan cotizaciones).
 */
import { logger } from '../utils/logger';

export const BCU_URL = 'https://cotizaciones.bcu.gub.uy/wscotizaciones/servlet/awsbcucotizaciones';

// Códigos de moneda del BCU (Grupo 2). Solo los confirmados; ampliar con cuidado.
export const BCU_MONEDA: Record<string, number> = {
  USD: 2225, // Dólar USA billete
  EUR: 1111, // Euro
};

export interface CotizacionBcu {
  fecha: string;      // YYYY-MM-DD
  moneda: string;     // ISO corto solicitado (USD, EUR)
  codigoIso: string;  // el que devuelve el BCU (ej. DLS.)
  nombre: string;
  compra: number;     // TCC
  venta: number;      // TCV
}

function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1].trim() : null;
}

/** Se lanza cuando el BCU no se pudo CONSULTAR (red/timeout/5xx): es un error
 *  TRANSITORIO, distinto de "el BCU respondió que no hay dato para esa fecha".
 *  El llamador debe reintentar la MISMA fecha, no saltar al día anterior. */
export class BcuNoDisponibleError extends Error {
  constructor(msg: string) { super(msg); this.name = 'BcuNoDisponibleError'; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Trae la cotización del BCU para una moneda y fecha.
 *  • Devuelve el dato si el BCU lo tiene.
 *  • Devuelve null si el BCU respondió pero NO hay dato para esa fecha (feriado,
 *    fin de semana, fecha futura o moneda sin código) → el llamador prueba el día
 *    hábil anterior.
 *  • Lanza BcuNoDisponibleError si no se pudo consultar (red/timeout/5xx) tras los
 *    reintentos → el llamador reintenta la misma fecha o la deja PROVISIONAL (nunca
 *    salta de día por un problema de red, que daría una cotización equivocada).
 */
export async function cotizacionBcu(moneda: string, fecha: string): Promise<CotizacionBcu | null> {
  const codigo = BCU_MONEDA[moneda.toUpperCase()];
  if (!codigo) return null; // moneda sin código BCU confirmado → carga manual
  const body = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cot="Cotiza">`
    + `<soapenv:Body><cot:wsbcucotizaciones.Execute><cot:Entrada>`
    + `<cot:Moneda><cot:item>${codigo}</cot:item></cot:Moneda>`
    + `<cot:FechaDesde>${fecha}</cot:FechaDesde><cot:FechaHasta>${fecha}</cot:FechaHasta>`
    + `<cot:Grupo>2</cot:Grupo>`
    + `</cot:Entrada></cot:wsbcucotizaciones.Execute></soapenv:Body></soapenv:Envelope>`;
  // Reintentos ante fallos TRANSITORIOS (red/timeout/5xx), con backoff. Un "sin dato"
  // (status != 1) NO se reintenta: es una respuesta válida del BCU.
  let ultimoError = '';
  for (let intento = 1; intento <= 3; intento++) {
    try {
      const resp = await fetch(BCU_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'Cotizaaction/AWSBCUCOTIZACIONES.Execute' },
        body,
        signal: AbortSignal.timeout(20000),
      });
      if (resp.status >= 500 || resp.status === 429) { ultimoError = `HTTP ${resp.status}`; await sleep(intento * 800); continue; }
      const xml = await resp.text();
      const status = tag(xml, 'status');
      if (status !== '1') return null; // sin dato para esa fecha (feriado/fin de semana/futuro)
      const dato = xml.match(/<datoscotizaciones\.dato>[\s\S]*?<\/datoscotizaciones\.dato>/i)?.[0] ?? xml;
      const tcc = tag(dato, 'TCC');
      const tcv = tag(dato, 'TCV');
      if (!tcc && !tcv) return null;
      return {
        fecha: tag(dato, 'Fecha') ?? fecha,
        moneda: moneda.toUpperCase(),
        codigoIso: tag(dato, 'CodigoISO') ?? '',
        nombre: tag(dato, 'Nombre') ?? '',
        compra: tcc ? Number(tcc) : Number(tcv),
        venta: tcv ? Number(tcv) : Number(tcc),
      };
    } catch (e) {
      ultimoError = (e as Error).message;
      if (intento < 3) await sleep(intento * 800);
    }
  }
  logger.warn('No se pudo consultar el BCU (transitorio)', { moneda, fecha, error: ultimoError });
  throw new BcuNoDisponibleError(`BCU no disponible para ${moneda} ${fecha}: ${ultimoError}`);
}
