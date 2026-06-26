"""Tests del cálculo de ROI neto."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from propscout.config import Config
from propscout.models import Listing, Operation
from propscout.roi import evaluar


def _config():
    cfg = Config()
    cfg.tipo_cambio_uyu_por_usd = 40.0
    cfg.moneda_reporte = "USD"
    cfg.roi_objetivo = 0.08
    cfg.irpf.mode = "simplificado"
    cfg.irpf.tasa_efectiva = 0.105
    cfg.irpf.aplicar_exoneracion = False
    cfg.costos.incluir_costos_extra = False
    return cfg


def _listing(price_usd):
    return Listing(
        source="test", source_id="1", url="http://x", title="Apto alquilado",
        operation=Operation.VENTA, price=price_usd, currency="USD",
        property_type="apartamento", area_m2=50, city="Montevideo",
    )


def test_roi_neto_basico():
    cfg = _config()
    l = _listing(100_000)
    # 850 USD/mes -> 10.200/año bruto; IRPF 10,5% = 1.071; neto 9.129.
    op = evaluar(l, 850, "USD", cfg, es_estimado=False)
    assert op is not None
    assert abs(op.bruto_anual - 10_200) < 1e-6
    assert abs(op.irpf_anual - 1_071) < 1e-6
    assert abs(op.neto_anual - 9_129) < 1e-6
    assert abs(op.roi_neto - 0.09129) < 1e-6
    assert op.cumple_objetivo  # 9,13% > 8%


def test_no_cumple_objetivo():
    cfg = _config()
    l = _listing(200_000)
    op = evaluar(l, 850, "USD", cfg, es_estimado=False)
    assert op is not None
    assert op.roi_neto < cfg.roi_objetivo
    assert not op.cumple_objetivo


def test_sin_precio_devuelve_none():
    cfg = _config()
    l = _listing(0)
    assert evaluar(l, 850, "USD", cfg, es_estimado=False) is None


def test_costos_extra_reducen_roi():
    cfg = _config()
    cfg.costos.incluir_costos_extra = True
    cfg.costos.vacancia_pct = 0.05
    cfg.costos.mantenimiento_pct = 0.05
    l = _listing(100_000)
    op = evaluar(l, 850, "USD", cfg, es_estimado=False)
    # 10% del bruto en costos extra (vacancia+mantenimiento).
    assert abs(op.costos_extra_anual - 1_020) < 1e-6
    assert op.neto_anual < 9_129


def test_conversion_moneda_precio_uyu():
    cfg = _config()
    l = Listing(
        source="t", source_id="2", url="u", title="t", operation=Operation.VENTA,
        price=4_000_000, currency="UYU", area_m2=50,
    )
    # Precio 4.000.000 UYU / 40 = 100.000 USD.
    op = evaluar(l, 850, "USD", cfg, es_estimado=False)
    assert abs(op.precio - 100_000) < 1e-6
