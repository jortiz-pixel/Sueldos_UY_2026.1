"""Tests del cálculo de IRPF a los arrendamientos."""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from propscout.config import Config
from propscout.irpf import irpf_arrendamiento_anual


def _config(**kw):
    cfg = Config()
    cfg.tipo_cambio_uyu_por_usd = 40.0
    cfg.valor_bpc = 6_576.0
    for k, v in kw.items():
        setattr(cfg, k, v)
    return cfg


def test_simplificado_tasa_efectiva():
    cfg = _config()
    cfg.irpf.mode = "simplificado"
    cfg.irpf.tasa_efectiva = 0.105
    cfg.irpf.aplicar_exoneracion = False
    # Alquiler 30.000 UYU/mes -> bruto anual 360.000; IRPF 10,5% = 37.800.
    r = irpf_arrendamiento_anual(30_000, "UYU", cfg)
    assert abs(r.bruto_anual_uyu - 360_000) < 1e-6
    assert abs(r.impuesto_uyu - 37_800) < 1e-6
    assert not r.exonerado


def test_exoneracion_bajo_umbral():
    cfg = _config()
    cfg.irpf.aplicar_exoneracion = True
    cfg.irpf.umbral_exoneracion_bpc = 40.0
    # 40 BPC = 263.040 UYU/año -> umbral mensual ~21.920. 15.000/mes está exento.
    r = irpf_arrendamiento_anual(15_000, "UYU", cfg)
    assert r.exonerado
    assert r.impuesto_uyu == 0.0


def test_no_exonera_sobre_umbral():
    cfg = _config()
    cfg.irpf.aplicar_exoneracion = True
    r = irpf_arrendamiento_anual(30_000, "UYU", cfg)
    assert not r.exonerado
    assert r.impuesto_uyu > 0


def test_detallado_con_deducciones():
    cfg = _config()
    cfg.irpf.mode = "detallado"
    cfg.irpf.tasa_nominal = 0.12
    cfg.irpf.comision_admin_pct = 0.05
    cfg.irpf.comision_admin_iva = 0.22
    cfg.irpf.aplicar_exoneracion = False
    bruto = 360_000.0
    deduccion = bruto * 0.05 * 1.22  # 21.960
    esperado = (bruto - deduccion) * 0.12
    r = irpf_arrendamiento_anual(30_000, "UYU", cfg)
    assert abs(r.impuesto_uyu - esperado) < 1e-6
    assert r.tasa_efectiva < 0.12  # efectiva menor a la nominal por las deducciones


def test_usd_convierte_a_uyu():
    cfg = _config()
    cfg.irpf.mode = "simplificado"
    cfg.irpf.aplicar_exoneracion = False
    # 850 USD/mes * 40 = 34.000 UYU/mes -> bruto anual 408.000.
    r = irpf_arrendamiento_anual(850, "USD", cfg)
    assert abs(r.bruto_anual_uyu - 408_000) < 1e-6
