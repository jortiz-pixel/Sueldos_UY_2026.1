"""Fuente MercadoLibre Uruguay vía la API pública de búsqueda.

Endpoint: https://api.mercadolibre.com/sites/{site}/search

Nota: MercadoLibre suele requerir un token OAuth (Bearer) para la API de
búsqueda. Si no se provee `ML_ACCESS_TOKEN`, se intenta igualmente y, si la API
responde 401/403, se registra una advertencia y se devuelve una lista vacía
para no abortar el resto del proceso (p. ej. InfoCasas).
"""

from __future__ import annotations

import logging
import time
from typing import Any, Optional

import requests

from ..config import Config
from ..models import Listing, Operation, extract_stated_rent
from .base import Source

log = logging.getLogger("propscout.sources.mercadolibre")

API_BASE = "https://api.mercadolibre.com"
PAGE_SIZE = 50  # máximo permitido por la API


def _get_attr(attrs: list[dict[str, Any]], attr_id: str) -> Optional[str]:
    for a in attrs or []:
        if a.get("id") == attr_id:
            return a.get("value_name") or (a.get("values") or [{}])[0].get("name")
    return None


def _to_float(value: Any) -> Optional[float]:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _to_int(value: Any) -> Optional[int]:
    f = _to_float(value)
    return int(f) if f is not None else None


class MercadoLibreSource(Source):
    name = "mercadolibre"

    def __init__(self, config: Config):
        super().__init__(config)
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": "propscout/0.1 (inversion-inmuebles)"})
        if config.ml_access_token:
            self.session.headers["Authorization"] = f"Bearer {config.ml_access_token}"

    # ------------------------------------------------------------------ public
    def buscar(self, operation: Operation, limite: int) -> list[Listing]:
        listings: list[Listing] = []
        offset = 0
        op_query = "venta" if operation == Operation.VENTA else "alquiler"
        q = f"{op_query} {self.config.ciudad}".strip()

        while len(listings) < limite:
            page = self._buscar_pagina(q, offset)
            if page is None:
                break  # error de API ya registrado
            results = page.get("results", [])
            if not results:
                break
            for item in results:
                l = self._a_listing(item, operation)
                if l is not None:
                    listings.append(l)
            offset += PAGE_SIZE
            total = page.get("paging", {}).get("total", 0)
            if offset >= total:
                break
            time.sleep(0.3)  # cortesía con la API

        return self.filtrar(listings[:limite])

    # ----------------------------------------------------------------- internos
    def _buscar_pagina(self, q: str, offset: int) -> Optional[dict[str, Any]]:
        url = f"{API_BASE}/sites/{self.config.ml_site}/search"
        params = {
            "category": self.config.ml_category,
            "q": q,
            "offset": offset,
            "limit": PAGE_SIZE,
        }
        try:
            resp = self.session.get(url, params=params, timeout=20)
        except requests.RequestException as exc:
            log.warning("MercadoLibre: error de red (%s)", exc)
            return None
        if resp.status_code in (401, 403):
            log.warning(
                "MercadoLibre: la API requiere autenticación (HTTP %s). "
                "Configurá ML_ACCESS_TOKEN para habilitar esta fuente.",
                resp.status_code,
            )
            return None
        if resp.status_code != 200:
            log.warning("MercadoLibre: respuesta inesperada HTTP %s", resp.status_code)
            return None
        try:
            return resp.json()
        except ValueError:
            log.warning("MercadoLibre: respuesta no es JSON válido")
            return None

    def _a_listing(self, item: dict[str, Any], operation: Operation) -> Optional[Listing]:
        attrs = item.get("attributes", [])
        op_raw = (_get_attr(attrs, "OPERATION") or "").lower()
        if op_raw:
            if operation == Operation.VENTA and "venta" not in op_raw:
                return None
            if operation == Operation.ALQUILER and "alquiler" not in op_raw and "arrend" not in op_raw:
                return None

        location = item.get("location") or {}
        city = (location.get("city") or {}).get("name") or (item.get("address") or {}).get("city_name")
        neighborhood = (location.get("neighborhood") or {}).get("name")
        title = item.get("title", "")
        description = item.get("subtitle") or ""  # la API de search no trae descripción completa

        stated_rent, stated_cur = extract_stated_rent(f"{title} {description}")

        return Listing(
            source=self.name,
            source_id=str(item.get("id", "")),
            url=item.get("permalink", ""),
            title=title,
            operation=operation,
            price=_to_float(item.get("price")),
            currency=item.get("currency_id", "USD"),
            property_type=_get_attr(attrs, "PROPERTY_TYPE"),
            area_m2=_to_float(_get_attr(attrs, "TOTAL_AREA") or _get_attr(attrs, "COVERED_AREA")),
            bedrooms=_to_int(_get_attr(attrs, "BEDROOMS") or _get_attr(attrs, "ROOMS")),
            bathrooms=_to_int(_get_attr(attrs, "FULL_BATHROOMS") or _get_attr(attrs, "BATHROOMS")),
            city=city,
            neighborhood=neighborhood,
            description=description,
            stated_rent=stated_rent,
            stated_rent_currency=stated_cur,
            raw=item,
        )
