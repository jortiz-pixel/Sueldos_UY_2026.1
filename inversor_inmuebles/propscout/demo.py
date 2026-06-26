"""Datos de muestra para probar el flujo completo sin acceso a internet.

Permite ejecutar `python -m propscout --demo` y ver cómo se calculan el IRPF,
el ROI neto y el reporte, usando publicaciones ficticias representativas.
"""

from __future__ import annotations

from .models import Listing, Operation


def ventas_demo() -> list[Listing]:
    return [
        Listing(
            source="demo", source_id="v1", url="https://example.com/v1",
            title="Apto 2 dorm Pocitos — YA ALQUILADO, renta U$S 950",
            operation=Operation.VENTA, price=125_000, currency="USD",
            property_type="apartamento", area_m2=62, bedrooms=2,
            city="Montevideo", neighborhood="Pocitos",
            description="Excelente apartamento con inquilino, renta U$S 950 mensuales.",
            stated_rent=950, stated_rent_currency="USD",
        ),
        Listing(
            source="demo", source_id="v2", url="https://example.com/v2",
            title="Monoambiente Cordón a estrenar",
            operation=Operation.VENTA, price=95_000, currency="USD",
            property_type="apartamento", area_m2=35, bedrooms=0,
            city="Montevideo", neighborhood="Cordón",
            description="Ideal inversión, a estrenar.",
        ),
        Listing(
            source="demo", source_id="v3", url="https://example.com/v3",
            title="Casa 3 dorm Malvín",
            operation=Operation.VENTA, price=240_000, currency="USD",
            property_type="casa", area_m2=140, bedrooms=3,
            city="Montevideo", neighborhood="Malvín",
            description="Amplia casa con fondo.",
        ),
        Listing(
            source="demo", source_id="v4", url="https://example.com/v4",
            title="Apto 1 dorm Centro con contrato vigente",
            operation=Operation.VENTA, price=72_000, currency="USD",
            property_type="apartamento", area_m2=45, bedrooms=1,
            city="Montevideo", neighborhood="Centro",
            description="Rentado, contrato vigente. Buena oportunidad para inversor.",
        ),
    ]


def alquileres_demo() -> list[Listing]:
    muestras = [
        ("Pocitos", "apartamento", 62, 920),
        ("Pocitos", "apartamento", 55, 850),
        ("Pocitos", "apartamento", 70, 1050),
        ("Cordón", "apartamento", 35, 520),
        ("Cordón", "apartamento", 40, 600),
        ("Cordón", "apartamento", 38, 560),
        ("Malvín", "casa", 140, 1400),
        ("Malvín", "casa", 120, 1250),
        ("Malvín", "casa", 160, 1600),
        ("Centro", "apartamento", 45, 600),
        ("Centro", "apartamento", 42, 560),
        ("Centro", "apartamento", 48, 640),
    ]
    out = []
    for i, (barrio, tipo, area, renta) in enumerate(muestras):
        out.append(Listing(
            source="demo", source_id=f"a{i}", url=f"https://example.com/a{i}",
            title=f"Alquiler {tipo} {barrio}", operation=Operation.ALQUILER,
            price=renta, currency="USD", property_type=tipo, area_m2=area,
            city="Montevideo", neighborhood=barrio,
        ))
    return out
