"""Tests del estimador de alquiler, extracción de renta y parsing de InfoCasas."""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from propscout.config import Config
from propscout.models import Listing, Operation, extract_stated_rent
from propscout.rent_estimator import RentEstimator
from propscout.sources.infocasas import InfoCasasSource


def _config():
    cfg = Config()
    cfg.moneda_reporte = "USD"
    cfg.tipo_cambio_uyu_por_usd = 40.0
    return cfg


# --------------------------------------------------------------- extract_rent
def test_extract_rent_usd():
    monto, moneda = extract_stated_rent("Vendo apto, renta U$S 850 mensuales")
    assert monto == 850
    assert moneda == "USD"


def test_extract_rent_pesos_con_miles():
    monto, moneda = extract_stated_rent("Alquilado en $ 35.000 por mes")
    assert monto == 35000
    assert moneda == "UYU"


def test_extract_rent_sin_match():
    monto, moneda = extract_stated_rent("Apartamento a estrenar, excelente ubicación")
    assert monto is None and moneda is None


# ------------------------------------------------------------------ estimator
def test_estimador_por_barrio_tipo():
    cfg = _config()
    alquileres = [
        Listing("t", str(i), "u", "alq", Operation.ALQUILER, price=600 + i, currency="USD",
                property_type="apartamento", area_m2=50, city="Montevideo", neighborhood="Pocitos")
        for i in range(5)
    ]
    est = RentEstimator(cfg).entrenar(alquileres)
    assert est.tiene_datos
    venta = Listing("t", "v", "u", "venta", Operation.VENTA, price=100_000, currency="USD",
                    property_type="apartamento", area_m2=60, city="Montevideo", neighborhood="Pocitos")
    monto, moneda, nivel = est.estimar_alquiler_mensual(venta)
    assert monto is not None
    assert nivel == "barrio+tipo"
    # ~ (602/50) * 60 ≈ 722
    assert 700 < monto < 740


def test_estimador_fallback_global():
    cfg = _config()
    alquileres = [
        Listing("t", str(i), "u", "alq", Operation.ALQUILER, price=600, currency="USD",
                property_type="casa", area_m2=50, city="Salto", neighborhood="Centro")
        for i in range(4)
    ]
    est = RentEstimator(cfg).entrenar(alquileres)
    venta = Listing("t", "v", "u", "venta", Operation.VENTA, price=80_000, currency="USD",
                    property_type="apartamento", area_m2=40, city="Maldonado", neighborhood="X")
    monto, moneda, nivel = est.estimar_alquiler_mensual(venta)
    assert monto is not None
    assert nivel == "global"


def test_estimador_sin_area():
    cfg = _config()
    est = RentEstimator(cfg).entrenar([])
    venta = Listing("t", "v", "u", "venta", Operation.VENTA, price=80_000, currency="USD", area_m2=None)
    monto, _, nivel = est.estimar_alquiler_mensual(venta)
    assert monto is None
    assert nivel == "sin_area"


# ----------------------------------------------------------- infocasas parsing
def test_infocasas_next_data_parsing():
    cfg = _config()
    cfg.ciudad = "Montevideo"
    data = {
        "props": {"pageProps": {"results": [
            {
                "id": 12345, "slug": "apto-pocitos-12345", "title": "Apto 2 dorm Pocitos",
                "price": {"amount": 145000, "currency": "USD"},
                "area": 65, "bedrooms": 2, "city": "Montevideo",
                "neighborhood": "Pocitos", "propertyType": "Apartamento",
                "description": "Excelente apto, ya alquilado con contrato, renta U$S 900",
            },
            {
                "id": 999, "slug": "casa-malvin-999", "title": "Casa Malvín",
                "price": {"amount": 220000, "currency": "USD"},
                "area": 120, "bedrooms": 3, "city": "Montevideo", "neighborhood": "Malvín",
                "propertyType": "Casa",
            },
        ]}}
    }
    html = f'<html><body><script id="__NEXT_DATA__" type="application/json">{json.dumps(data)}</script></body></html>'
    src = InfoCasasSource(cfg)
    listings = src._parse(html, Operation.VENTA)
    assert len(listings) == 2
    apto = next(l for l in listings if "Pocitos" in l.title)
    assert apto.price == 145000
    assert apto.currency == "USD"
    assert apto.area_m2 == 65
    assert apto.stated_rent == 900  # extraído de la descripción
    assert apto.looks_rented
