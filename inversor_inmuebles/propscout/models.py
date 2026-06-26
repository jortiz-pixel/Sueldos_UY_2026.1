"""Modelos de datos compartidos entre fuentes, análisis y reporte."""

from __future__ import annotations

import re
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any, Optional


class Operation(str, Enum):
    """Tipo de operación de la publicación."""

    VENTA = "venta"
    ALQUILER = "alquiler"
    DESCONOCIDA = "desconocida"


# Palabras que sugieren que un inmueble en venta ya está alquilado / con inquilino.
_RENTED_HINTS = (
    "ya alquilad",
    "ya esta alquilad",
    "ya está alquilad",
    "con inquilino",
    "con contrato",
    "renta asegurada",
    "rentado",
    "alquilado con",
    "ocupado con contrato",
    "inversor",
    "inversión asegurada",
    "renta mensual",
    "produce renta",
    "actualmente alquilad",
)


def _strip_accents(text: str) -> str:
    table = str.maketrans("áéíóúüñ", "aeiouun")
    return text.translate(table)


@dataclass
class Listing:
    """Una publicación normalizada, independiente de la fuente de origen."""

    source: str                       # "mercadolibre" | "infocasas"
    source_id: str                    # id de la publicación en su origen
    url: str
    title: str
    operation: Operation
    price: Optional[float] = None     # precio publicado
    currency: str = "USD"             # "USD" | "UYU"
    property_type: Optional[str] = None   # apartamento, casa, local, etc.
    area_m2: Optional[float] = None
    bedrooms: Optional[int] = None
    bathrooms: Optional[int] = None
    city: Optional[str] = None
    neighborhood: Optional[str] = None
    description: str = ""

    # Alquiler vigente declarado en la publicación (si lo hay).
    stated_rent: Optional[float] = None
    stated_rent_currency: Optional[str] = None

    raw: dict[str, Any] = field(default_factory=dict)

    # ----------------------------------------------------------------- helpers
    @property
    def haystack(self) -> str:
        """Texto en minúsculas y sin acentos para detección de keywords."""
        return _strip_accents(f"{self.title} {self.description}".lower())

    @property
    def looks_rented(self) -> bool:
        """Heurística: la publicación sugiere que ya está alquilada."""
        if self.stated_rent:
            return True
        h = self.haystack
        return any(hint in h for hint in _RENTED_HINTS)

    @property
    def price_per_m2(self) -> Optional[float]:
        if self.price and self.area_m2:
            return self.price / self.area_m2
        return None

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["operation"] = self.operation.value
        d.pop("raw", None)
        return d


# Regex para extraer un alquiler mencionado en texto libre, p. ej.
# "renta U$S 850", "alquilado en $ 35.000", "produce USD 1.200 mensuales".
_RENT_RE = re.compile(
    r"(?:renta|alquil\w*|produce|genera)\D{0,25}?"
    r"(u\$s|us\$|usd|u\$d|\$u|\$)\s*([\d][\d\.\, ]{1,12})",
    re.IGNORECASE,
)


def extract_stated_rent(text: str) -> tuple[Optional[float], Optional[str]]:
    """Intenta extraer un monto de alquiler y su moneda de un texto libre.

    Devuelve (monto, moneda) o (None, None) si no encuentra nada confiable.
    """
    if not text:
        return None, None
    m = _RENT_RE.search(text)
    if not m:
        return None, None

    symbol = m.group(1).lower()
    amount_raw = m.group(2).strip()

    # Normaliza separadores de miles/decimales al estilo es-UY (1.234,56).
    cleaned = amount_raw.replace(" ", "")
    if "," in cleaned and "." in cleaned:
        cleaned = cleaned.replace(".", "").replace(",", ".")
    elif "," in cleaned:
        cleaned = cleaned.replace(",", ".")
    else:
        cleaned = cleaned.replace(".", "")
    try:
        amount = float(cleaned)
    except ValueError:
        return None, None

    # Descarta montos absurdos para un alquiler mensual.
    if amount <= 0 or amount > 1_000_000:
        return None, None

    if symbol in ("u$s", "us$", "usd", "u$d"):
        currency = "USD"
    else:
        currency = "UYU"
    return amount, currency
