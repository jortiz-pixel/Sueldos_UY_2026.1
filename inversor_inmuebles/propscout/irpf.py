"""Cálculo del IRPF a los arrendamientos (Uruguay) sobre una base anual.

Referencia normativa (DGI, IRPF Categoría I — rendimientos de capital
inmobiliario):

- Tasa nominal del 12% sobre el rendimiento neto fiscal.
- En la práctica, el anticipo/retención mensual es del 10,5% sobre el alquiler
  bruto (contempla una deducción ficta), por eso el modo "simplificado" usa
  esa tasa efectiva.
- Deducciones admitidas (modo "detallado"): comisión de la administradora +
  IVA, Contribución Inmobiliaria e Impuesto de Primaria, entre otras.
- Exoneración cuando el total de arrendamientos anuales es menor a 40 BPC.

Todos los cálculos se hacen en pesos uruguayos (UYU), porque la exoneración y
las deducciones están definidas en moneda nacional / BPC. La función recibe el
alquiler en su moneda y lo convierte usando la config.
"""

from __future__ import annotations

from dataclasses import dataclass

from .config import Config


@dataclass
class IrpfResultado:
    """Detalle del IRPF anual calculado para un arrendamiento."""

    bruto_anual_uyu: float
    deducciones_uyu: float
    base_imponible_uyu: float
    impuesto_uyu: float
    exonerado: bool
    tasa_efectiva: float          # impuesto / bruto
    moneda: str = "UYU"

    @property
    def impuesto(self) -> float:
        return self.impuesto_uyu


def irpf_arrendamiento_anual(
    alquiler_mensual: float,
    moneda: str,
    config: Config,
) -> IrpfResultado:
    """Calcula el IRPF anual de un arrendamiento.

    Args:
        alquiler_mensual: monto del alquiler mensual (en `moneda`).
        moneda: "USD" o "UYU".
        config: configuración con parámetros fiscales y tipo de cambio.

    Returns:
        IrpfResultado con el detalle en UYU.
    """
    irpf = config.irpf
    bruto_anual_uyu = config.to_uyu(alquiler_mensual, moneda) * 12.0

    # Exoneración por monto: total anual de arrendamientos < 40 BPC.
    if irpf.aplicar_exoneracion:
        umbral = irpf.umbral_exoneracion_bpc * config.valor_bpc
        if bruto_anual_uyu < umbral:
            return IrpfResultado(
                bruto_anual_uyu=bruto_anual_uyu,
                deducciones_uyu=0.0,
                base_imponible_uyu=0.0,
                impuesto_uyu=0.0,
                exonerado=True,
                tasa_efectiva=0.0,
            )

    if irpf.mode == "detallado":
        comision = bruto_anual_uyu * irpf.comision_admin_pct * (1 + irpf.comision_admin_iva)
        deducciones = (
            comision
            + irpf.contribucion_inmobiliaria_anual
            + irpf.primaria_anual
        )
        deducciones = min(deducciones, bruto_anual_uyu)
        base = max(bruto_anual_uyu - deducciones, 0.0)
        impuesto = base * irpf.tasa_nominal
    else:  # simplificado
        deducciones = 0.0
        base = bruto_anual_uyu
        impuesto = bruto_anual_uyu * irpf.tasa_efectiva

    tasa_efectiva = impuesto / bruto_anual_uyu if bruto_anual_uyu else 0.0
    return IrpfResultado(
        bruto_anual_uyu=bruto_anual_uyu,
        deducciones_uyu=deducciones,
        base_imponible_uyu=base,
        impuesto_uyu=impuesto,
        exonerado=False,
        tasa_efectiva=tasa_efectiva,
    )
