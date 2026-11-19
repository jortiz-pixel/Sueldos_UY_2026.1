import { cotizacionBcu, BcuNoDisponibleError } from '../src/services/cotizaciones.service';

const okXml = '<status>1</status><datoscotizaciones.dato><Fecha>2026-02-09</Fecha><Moneda>2225</Moneda><Nombre>Dolar</Nombre><CodigoISO>USD</CodigoISO><TCC>39.30</TCC><TCV>39.70</TCV></datoscotizaciones.dato>';
const sinDatoXml = '<status>0</status>';

afterEach(() => { jest.restoreAllMocks(); });

describe('cotizacionBcu — automatización robusta', () => {
  it('devuelve la cotización cuando el BCU tiene dato (status=1)', async () => {
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({ status: 200, text: async () => okXml } as any);
    const r = await cotizacionBcu('USD', '2026-02-09');
    expect(r).not.toBeNull();
    expect(r!.compra).toBeCloseTo(39.3, 2);
    expect(r!.venta).toBeCloseTo(39.7, 2);
  });

  it('devuelve null (sin reintentar) si el BCU responde que no hay dato (feriado/fin de semana)', async () => {
    const spy = jest.spyOn(global, 'fetch' as any).mockResolvedValue({ status: 200, text: async () => sinDatoXml } as any);
    const r = await cotizacionBcu('USD', '2026-02-08');
    expect(r).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1); // no se reintenta un "sin dato"
  });

  it('lanza BcuNoDisponibleError ante un fallo transitorio, tras reintentar', async () => {
    const spy = jest.spyOn(global, 'fetch' as any).mockRejectedValue(new Error('network reset'));
    await expect(cotizacionBcu('USD', '2026-02-09')).rejects.toBeInstanceOf(BcuNoDisponibleError);
    expect(spy).toHaveBeenCalledTimes(3); // 3 intentos
  }, 15000);

  it('reintenta ante un 5xx y tiene éxito en el 2º intento', async () => {
    const spy = jest.spyOn(global, 'fetch' as any)
      .mockResolvedValueOnce({ status: 503, text: async () => '' } as any)
      .mockResolvedValueOnce({ status: 200, text: async () => okXml } as any);
    const r = await cotizacionBcu('USD', '2026-02-09');
    expect(r).not.toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
  }, 15000);

  it('devuelve null para una moneda sin código BCU (sin consultar)', async () => {
    const spy = jest.spyOn(global, 'fetch' as any);
    const r = await cotizacionBcu('ARS', '2026-02-09');
    expect(r).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});
