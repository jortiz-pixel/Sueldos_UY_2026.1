"""Motor de orquestación: releva fuentes, estima alquileres y calcula ROI."""

from __future__ import annotations

import logging
from dataclasses import dataclass

from .config import Config
from .models import Listing, Operation
from .rent_estimator import RentEstimator
from .roi import Oportunidad, evaluar
from .sources import get_source

log = logging.getLogger("propscout.engine")


@dataclass
class ResultadoBusqueda:
    oportunidades: list[Oportunidad]
    ventas_relevadas: int
    alquileres_relevados: int
    con_alquiler_publicado: int
    con_alquiler_estimado: int


def buscar_oportunidades(config: Config, demo: bool = False) -> ResultadoBusqueda:
    """Ejecuta el flujo completo y devuelve oportunidades ordenadas por ROI neto.

    Si `demo=True`, usa datos de muestra en vez de relevar las fuentes reales.
    """
    ventas: list[Listing] = []
    alquileres: list[Listing] = []

    if demo:
        from .demo import ventas_demo, alquileres_demo
        ventas = ventas_demo()
        alquileres = alquileres_demo()
    else:
        for nombre in config.fuentes:
            try:
                source = get_source(nombre, config)
            except ValueError as exc:
                log.warning("%s", exc)
                continue
            log.info("Relevando ventas en %s…", nombre)
            ventas += source.buscar(Operation.VENTA, config.limite_por_fuente)
            log.info("Relevando alquileres en %s (para estimar rentas)…", nombre)
            alquileres += source.buscar(Operation.ALQUILER, config.limite_por_fuente)

    # Filtro opcional: solo publicaciones que parecen ya alquiladas.
    if config.solo_alquiladas:
        ventas = [v for v in ventas if v.looks_rented]

    estimator = RentEstimator(config).entrenar(alquileres)

    oportunidades: list[Oportunidad] = []
    n_publicado = n_estimado = 0

    for venta in ventas:
        # 1) Alquiler publicado en la propia venta ("renta U$S 850").
        if venta.stated_rent:
            op = evaluar(
                venta, venta.stated_rent, venta.stated_rent_currency or config.moneda_reporte,
                config, es_estimado=False, fuente_alquiler="publicado",
            )
            if op:
                oportunidades.append(op)
                n_publicado += 1
            continue

        # 2) Estimación a partir del modelo de alquiler/m².
        monto, moneda, nivel = estimator.estimar_alquiler_mensual(venta)
        if monto is None:
            continue
        op = evaluar(
            venta, monto, moneda, config,
            es_estimado=True, fuente_alquiler=f"estimado:{nivel}",
        )
        if op:
            oportunidades.append(op)
            n_estimado += 1

    oportunidades.sort(key=lambda o: o.roi_neto, reverse=True)

    return ResultadoBusqueda(
        oportunidades=oportunidades,
        ventas_relevadas=len(ventas),
        alquileres_relevados=len(alquileres),
        con_alquiler_publicado=n_publicado,
        con_alquiler_estimado=n_estimado,
    )
