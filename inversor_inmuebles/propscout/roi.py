"""Cálculo del retorno sobre inversión (ROI) neto de IRPF para una propiedad.

ROI neto anual = (alquiler anual − IRPF − otros costos) / precio de compra,
todo expresado en la moneda de reporte.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any, Optional

from .config import Config
from .irpf import irpf_arrendamiento_anual
from .models import Listing


@dataclass
class Oportunidad:
    """Resultado del análisis de inversión para una publicación de venta."""

    listing: Listing
    moneda: str

    precio: float
    alquiler_mensual: float
    alquiler_es_estimado: bool
    fuente_alquiler: str          # "publicado" | "estimado" | "manual"

    bruto_anual: float
    irpf_anual: float
    costos_extra_anual: float
    neto_anual: float

    roi_bruto: float              # alquiler anual bruto / precio
    roi_neto: float               # neto de IRPF y costos / precio
    cap_rate_neto: float          # alias de roi_neto, terminología inmobiliaria

    cumple_objetivo: bool

    def fila_reporte(self) -> dict[str, Any]:
        """Aplana la oportunidad a un dict para CSV/Excel."""
        l = self.listing
        return {
            "fuente": l.source,
            "titulo": l.title,
            "tipo": l.property_type or "",
            "ciudad": l.city or "",
            "barrio": l.neighborhood or "",
            "area_m2": l.area_m2 or "",
            "dormitorios": l.bedrooms if l.bedrooms is not None else "",
            "moneda": self.moneda,
            "precio": round(self.precio, 2),
            "alquiler_mensual": round(self.alquiler_mensual, 2),
            "alquiler_origen": self.fuente_alquiler,
            "bruto_anual": round(self.bruto_anual, 2),
            "irpf_anual": round(self.irpf_anual, 2),
            "costos_extra_anual": round(self.costos_extra_anual, 2),
            "neto_anual": round(self.neto_anual, 2),
            "roi_bruto_%": round(self.roi_bruto * 100, 2),
            "roi_neto_%": round(self.roi_neto * 100, 2),
            "cumple_objetivo": "SI" if self.cumple_objetivo else "no",
            "url": l.url,
        }


def evaluar(
    listing: Listing,
    alquiler_mensual: float,
    alquiler_moneda: str,
    config: Config,
    *,
    es_estimado: bool,
    fuente_alquiler: str = "publicado",
) -> Optional[Oportunidad]:
    """Calcula la oportunidad de inversión para una publicación de venta.

    Devuelve None si falta el precio (no se puede calcular ROI).
    """
    if not listing.price or listing.price <= 0:
        return None

    moneda = config.moneda_reporte
    precio = config.to_report_currency(listing.price, listing.currency)
    alquiler_mes = config.to_report_currency(alquiler_mensual, alquiler_moneda)
    bruto_anual = alquiler_mes * 12.0

    # IRPF (se calcula en UYU internamente y se convierte a moneda de reporte).
    irpf_res = irpf_arrendamiento_anual(alquiler_mensual, alquiler_moneda, config)
    irpf_anual = config.to_report_currency(irpf_res.impuesto_uyu, "UYU")

    # Otros costos anuales (vacancia, mantenimiento, gastos comunes, contribución).
    costos_extra = 0.0
    if config.costos.incluir_costos_extra:
        c = config.costos
        costos_extra += bruto_anual * c.vacancia_pct
        costos_extra += bruto_anual * c.mantenimiento_pct
        costos_extra += c.gastos_comunes_anual
        costos_extra += c.contribucion_inmobiliaria_anual

    neto_anual = bruto_anual - irpf_anual - costos_extra

    roi_bruto = bruto_anual / precio
    roi_neto = neto_anual / precio

    return Oportunidad(
        listing=listing,
        moneda=moneda,
        precio=precio,
        alquiler_mensual=alquiler_mes,
        alquiler_es_estimado=es_estimado,
        fuente_alquiler=fuente_alquiler,
        bruto_anual=bruto_anual,
        irpf_anual=irpf_anual,
        costos_extra_anual=costos_extra,
        neto_anual=neto_anual,
        roi_bruto=roi_bruto,
        roi_neto=roi_neto,
        cap_rate_neto=roi_neto,
        cumple_objetivo=roi_neto >= config.roi_objetivo,
    )
