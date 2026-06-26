"""Estimación de alquiler para propiedades en venta sin renta publicada.

Construye un modelo simple de alquiler por m² a partir de las publicaciones de
alquiler relevadas, segmentado por (ciudad, barrio, tipo de propiedad), con
fallbacks progresivos a niveles más generales cuando no hay muestra suficiente.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import Optional

from .config import Config
from .models import Listing, Operation


def _norm(value: Optional[str]) -> str:
    return (value or "").strip().lower()


@dataclass
class RentEstimator:
    """Modelo de alquiler por m² con segmentación y fallbacks."""

    config: Config
    min_muestra: int = 3
    _por_barrio_tipo: dict[tuple[str, str], list[float]] = field(default_factory=dict)
    _por_ciudad_tipo: dict[tuple[str, str], list[float]] = field(default_factory=dict)
    _por_tipo: dict[str, list[float]] = field(default_factory=dict)
    _global: list[float] = field(default_factory=list)

    def entrenar(self, alquileres: list[Listing]) -> "RentEstimator":
        """Carga las muestras de alquiler/m² (en moneda de reporte)."""
        for l in alquileres:
            if l.operation != Operation.ALQUILER:
                continue
            if not l.price or not l.area_m2 or l.area_m2 <= 0:
                continue
            renta_m2 = self.config.to_report_currency(l.price, l.currency) / l.area_m2
            if renta_m2 <= 0 or renta_m2 > 1000:  # descarta outliers groseros
                continue
            ciudad, barrio, tipo = _norm(l.city), _norm(l.neighborhood), _norm(l.property_type)
            self._por_barrio_tipo.setdefault((barrio, tipo), []).append(renta_m2)
            self._por_ciudad_tipo.setdefault((ciudad, tipo), []).append(renta_m2)
            self._por_tipo.setdefault(tipo, []).append(renta_m2)
            self._global.append(renta_m2)
        return self

    @property
    def tiene_datos(self) -> bool:
        return bool(self._global)

    def _mediana(self, muestras: Optional[list[float]]) -> Optional[float]:
        if muestras and len(muestras) >= self.min_muestra:
            return statistics.median(muestras)
        return None

    def renta_m2(self, listing: Listing) -> tuple[Optional[float], str]:
        """Devuelve (renta por m² en moneda de reporte, nivel usado)."""
        barrio, ciudad, tipo = _norm(listing.neighborhood), _norm(listing.city), _norm(listing.property_type)
        candidatos = [
            (self._por_barrio_tipo.get((barrio, tipo)), "barrio+tipo"),
            (self._por_ciudad_tipo.get((ciudad, tipo)), "ciudad+tipo"),
            (self._por_tipo.get(tipo), "tipo"),
            (self._global, "global"),
        ]
        for muestras, nivel in candidatos:
            med = self._mediana(muestras)
            if med is not None:
                return med, nivel
        return None, "sin_datos"

    def estimar_alquiler_mensual(self, listing: Listing) -> tuple[Optional[float], str, str]:
        """Estima el alquiler mensual de una propiedad en venta.

        Returns:
            (monto en moneda de reporte, moneda, nivel de estimación) o
            (None, moneda, "sin_datos") si no se puede estimar.
        """
        if not listing.area_m2 or listing.area_m2 <= 0:
            return None, self.config.moneda_reporte, "sin_area"
        renta_m2, nivel = self.renta_m2(listing)
        if renta_m2 is None:
            return None, self.config.moneda_reporte, "sin_datos"
        return renta_m2 * listing.area_m2, self.config.moneda_reporte, nivel
