"""Fuente InfoCasas Uruguay vía scraping de HTML.

InfoCasas no expone una API pública, así que se relevan las páginas de listado.
La estrategia, de más confiable a menos:

1. Extraer el JSON embebido de Next.js (`__NEXT_DATA__`) y recorrerlo buscando
   objetos con forma de propiedad (precio, dirección, etc.).
2. Extraer bloques JSON-LD (`application/ld+json`).
3. Fallback: parsear las tarjetas del HTML con selectores CSS.

El scraping es inherentemente frágil: si InfoCasas cambia su markup, los
selectores del paso 3 pueden requerir ajuste. Los pasos 1 y 2 son más estables.
Todo se hace en modo best-effort y con logging claro.
"""

from __future__ import annotations

import json
import logging
import re
import time
from typing import Any, Iterable, Optional

import requests

try:
    from bs4 import BeautifulSoup  # type: ignore
except Exception:  # pragma: no cover
    BeautifulSoup = None

from ..config import Config
from ..models import Listing, Operation, extract_stated_rent
from .base import Source

log = logging.getLogger("propscout.sources.infocasas")

BASE = "https://www.infocasas.com.uy"

_PRICE_RE = re.compile(r"(u\$s|us\$|usd|u\$d|\$u|\$)\s*([\d][\d\.\, ]{2,12})", re.IGNORECASE)


def _slug(text: str) -> str:
    table = str.maketrans("áéíóúüñ", "aeiouun")
    return re.sub(r"[^a-z0-9]+", "-", text.translate(table).lower()).strip("-")


def _parse_money(text: str) -> tuple[Optional[float], str]:
    if not text:
        return None, "USD"
    m = _PRICE_RE.search(text)
    if not m:
        return None, "USD"
    symbol = m.group(1).lower()
    raw = m.group(2).replace(" ", "")
    if "," in raw and "." in raw:
        raw = raw.replace(".", "").replace(",", ".")
    elif "," in raw:
        raw = raw.replace(",", ".")
    else:
        raw = raw.replace(".", "")
    try:
        amount = float(raw)
    except ValueError:
        return None, "USD"
    currency = "USD" if symbol in ("u$s", "us$", "usd", "u$d") else "UYU"
    return amount, currency


def _walk(obj: Any) -> Iterable[dict]:
    """Recorre recursivamente un JSON devolviendo todos los dicts."""
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from _walk(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk(v)


class InfoCasasSource(Source):
    name = "infocasas"

    def __init__(self, config: Config):
        super().__init__(config)
        self.session = requests.Session()
        self.session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0 Safari/537.36"
            ),
            "Accept-Language": "es-UY,es;q=0.9",
        })

    # ------------------------------------------------------------------ public
    def buscar(self, operation: Operation, limite: int) -> list[Listing]:
        if BeautifulSoup is None:
            log.warning("InfoCasas: beautifulsoup4 no está instalado; fuente deshabilitada.")
            return []
        listings: list[Listing] = []
        page = 1
        max_pages = 20
        while len(listings) < limite and page <= max_pages:
            html = self._fetch(operation, page)
            if not html:
                break
            nuevos = self._parse(html, operation)
            if not nuevos:
                break
            listings.extend(nuevos)
            page += 1
            time.sleep(0.8)  # cortesía / evitar bloqueos
        return self.filtrar(listings[:limite])

    # ----------------------------------------------------------------- internos
    def _build_url(self, operation: Operation, page: int) -> str:
        op = "venta" if operation == Operation.VENTA else "alquiler"
        ciudad = _slug(self.config.ciudad or "montevideo")
        url = f"{BASE}/{op}/casas-y-apartamentos/{ciudad}"
        if page > 1:
            url += f"/pagina{page}"
        return url

    def _fetch(self, operation: Operation, page: int) -> Optional[str]:
        url = self._build_url(operation, page)
        try:
            resp = self.session.get(url, timeout=25)
        except requests.RequestException as exc:
            log.warning("InfoCasas: error de red en %s (%s)", url, exc)
            return None
        if resp.status_code == 404:
            return None
        if resp.status_code != 200:
            log.warning("InfoCasas: HTTP %s en %s", resp.status_code, url)
            return None
        return resp.text

    def _parse(self, html: str, operation: Operation) -> list[Listing]:
        listings = self._parse_next_data(html, operation)
        if listings:
            return listings
        listings = self._parse_jsonld(html, operation)
        if listings:
            return listings
        return self._parse_html_cards(html, operation)

    # --- estrategia 1: __NEXT_DATA__ ---------------------------------------
    def _parse_next_data(self, html: str, operation: Operation) -> list[Listing]:
        soup = BeautifulSoup(html, "html.parser")
        tag = soup.find("script", id="__NEXT_DATA__")
        if not tag or not tag.string:
            return []
        try:
            data = json.loads(tag.string)
        except ValueError:
            return []
        out: list[Listing] = []
        seen: set[str] = set()
        for node in _walk(data):
            l = self._node_a_listing(node, operation)
            if l and l.source_id not in seen:
                seen.add(l.source_id)
                out.append(l)
        if out:
            log.info("InfoCasas: %d propiedades vía __NEXT_DATA__", len(out))
        return out

    def _node_a_listing(self, node: dict, operation: Operation) -> Optional[Listing]:
        # Heurística: un nodo-propiedad suele tener id + precio + alguna de
        # estas claves de ubicación/área.
        if not isinstance(node, dict):
            return None
        has_price = any(k in node for k in ("price", "precio", "salePrice", "amount"))
        has_id = any(k in node for k in ("id", "propertyId", "publicationId", "slug"))
        if not (has_price and has_id):
            return None

        price = None
        currency = "USD"
        for k in ("price", "precio", "salePrice", "amount"):
            if k in node and node[k] is not None:
                if isinstance(node[k], dict):
                    price = node[k].get("amount") or node[k].get("value")
                    currency = node[k].get("currency") or node[k].get("currencySymbol") or currency
                else:
                    price = node[k]
                break
        try:
            price = float(price) if price is not None else None
        except (TypeError, ValueError):
            price = None
        if not price:
            return None

        cur = str(currency).upper()
        currency = "USD" if ("US" in cur or "U$S" in cur or "USD" in cur) else ("UYU" if "$" in cur or "UYU" in cur else "USD")

        title = str(node.get("title") or node.get("titulo") or node.get("name") or "").strip()
        slug = str(node.get("slug") or node.get("id") or node.get("propertyId") or "")
        url = node.get("url") or node.get("permalink") or (f"{BASE}/{slug}" if slug else "")
        area = node.get("area") or node.get("m2") or node.get("surface") or node.get("totalArea")
        try:
            area = float(area) if area is not None else None
        except (TypeError, ValueError):
            area = None
        rooms = node.get("bedrooms") or node.get("dormitorios") or node.get("rooms")
        try:
            rooms = int(rooms) if rooms is not None else None
        except (TypeError, ValueError):
            rooms = None

        city = node.get("city") or node.get("departamento") or self.config.ciudad
        neighborhood = node.get("neighborhood") or node.get("barrio") or node.get("zone")
        ptype = node.get("propertyType") or node.get("tipo") or node.get("type")

        text = f"{title} {node.get('description') or node.get('descripcion') or ''}"
        rent, rent_cur = extract_stated_rent(text)

        return Listing(
            source=self.name,
            source_id=str(slug or url),
            url=str(url),
            title=title or "(sin título)",
            operation=operation,
            price=price,
            currency=currency,
            property_type=str(ptype) if ptype else None,
            area_m2=area,
            bedrooms=rooms,
            city=str(city) if city else None,
            neighborhood=str(neighborhood) if neighborhood else None,
            description=str(node.get("description") or node.get("descripcion") or ""),
            stated_rent=rent,
            stated_rent_currency=rent_cur,
            raw=node,
        )

    # --- estrategia 2: JSON-LD ---------------------------------------------
    def _parse_jsonld(self, html: str, operation: Operation) -> list[Listing]:
        soup = BeautifulSoup(html, "html.parser")
        out: list[Listing] = []
        for tag in soup.find_all("script", type="application/ld+json"):
            if not tag.string:
                continue
            try:
                data = json.loads(tag.string)
            except ValueError:
                continue
            for node in _walk(data):
                if node.get("@type") in ("Product", "Offer", "RealEstateListing", "Residence"):
                    l = self._node_a_listing(node, operation)
                    if l:
                        out.append(l)
        if out:
            log.info("InfoCasas: %d propiedades vía JSON-LD", len(out))
        return out

    # --- estrategia 3: tarjetas HTML ---------------------------------------
    def _parse_html_cards(self, html: str, operation: Operation) -> list[Listing]:
        soup = BeautifulSoup(html, "html.parser")
        cards = soup.select("[class*='listing'], [class*='card'], article")
        out: list[Listing] = []
        seen: set[str] = set()
        for card in cards:
            link = card.find("a", href=True)
            if not link:
                continue
            href = link["href"]
            url = href if href.startswith("http") else f"{BASE}{href}"
            if url in seen:
                continue
            text = card.get_text(" ", strip=True)
            price, currency = _parse_money(text)
            if not price:
                continue
            seen.add(url)
            title = (link.get("title") or link.get_text(" ", strip=True) or "")[:200]
            area_m = re.search(r"(\d{2,4})\s*m", text)
            rent, rent_cur = extract_stated_rent(text)
            out.append(Listing(
                source=self.name,
                source_id=url,
                url=url,
                title=title or "(sin título)",
                operation=operation,
                price=price,
                currency=currency,
                area_m2=float(area_m.group(1)) if area_m else None,
                city=self.config.ciudad,
                description=text[:500],
                stated_rent=rent,
                stated_rent_currency=rent_cur,
            ))
        if out:
            log.info("InfoCasas: %d propiedades vía selectores HTML (frágil)", len(out))
        else:
            log.warning("InfoCasas: no se pudieron extraer propiedades del HTML.")
        return out
