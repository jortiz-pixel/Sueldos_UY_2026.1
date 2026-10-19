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

/** Trae la cotización del BCU para una moneda y fecha (o null si no hay dato). */
export async function cotizacionBcu(moneda: string, fecha: string): Promise<CotizacionBcu | null> {
  const codigo = BCU_MONEDA[moneda.toUpperCase()];
  if (!codigo) return null; // moneda sin código BCU confirmado → carga manual
  const body = `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:cot="Cotiza">`
    + `<soapenv:Body><cot:wsbcucotizaciones.Execute><cot:Entrada>`
    + `<cot:Moneda><cot:item>${codigo}</cot:item></cot:Moneda>`
    + `<cot:FechaDesde>${fecha}</cot:FechaDesde><cot:FechaHasta>${fecha}</cot:FechaHasta>`
    + `<cot:Grupo>2</cot:Grupo>`
    + `</cot:Entrada></cot:wsbcucotizaciones.Execute></soapenv:Body></soapenv:Envelope>`;
  try {
    const resp = await fetch(BCU_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: 'Cotizaaction/AWSBCUCOTIZACIONES.Execute' },
      body,
      signal: AbortSignal.timeout(20000),
    });
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
    logger.warn('No se pudo consultar el BCU', { error: (e as Error).message });
    return null;
  }
}
