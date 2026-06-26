"""Fuentes de datos de publicaciones inmobiliarias."""

from .base import Source
from .mercadolibre import MercadoLibreSource
from .infocasas import InfoCasasSource

__all__ = ["Source", "MercadoLibreSource", "InfoCasasSource", "get_source"]


def get_source(name: str, config):
    """Devuelve una instancia de fuente por nombre."""
    name = name.lower()
    if name in ("mercadolibre", "ml", "meli"):
        return MercadoLibreSource(config)
    if name in ("infocasas", "ic"):
        return InfoCasasSource(config)
    raise ValueError(f"Fuente desconocida: {name!r}")
