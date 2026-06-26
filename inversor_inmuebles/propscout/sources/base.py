"""Interfaz común a todas las fuentes de publicaciones."""

from __future__ import annotations

import abc
import logging
from typing import Iterable

from ..config import Config
from ..models import Listing, Operation

log = logging.getLogger("propscout.sources")


class Source(abc.ABC):
    """Fuente de publicaciones inmobiliarias (MercadoLibre, InfoCasas, …)."""

    name: str = "base"

    def __init__(self, config: Config):
        self.config = config

    @abc.abstractmethod
    def buscar(self, operation: Operation, limite: int) -> list[Listing]:
        """Devuelve publicaciones normalizadas para la operación dada."""
        raise NotImplementedError

    # Utilidad común: respeta filtros básicos de la config sobre un listado.
    def filtrar(self, listings: Iterable[Listing]) -> list[Listing]:
        cfg = self.config
        out: list[Listing] = []
        for l in listings:
            if cfg.precio_min and l.price and l.price < cfg.precio_min:
                continue
            if cfg.precio_max and l.price and l.price > cfg.precio_max:
                continue
            if cfg.barrios and l.neighborhood:
                if not any(b.lower() in (l.neighborhood or "").lower() for b in cfg.barrios):
                    continue
            if cfg.tipos_propiedad and l.property_type:
                if not any(t.lower() in (l.property_type or "").lower() for t in cfg.tipos_propiedad):
                    continue
            out.append(l)
        return out
