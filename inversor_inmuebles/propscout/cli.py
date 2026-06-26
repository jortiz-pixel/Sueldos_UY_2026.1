"""Interfaz de línea de comandos del buscador de oportunidades."""

from __future__ import annotations

import argparse
import logging
import sys
from typing import Optional

from .config import Config
from .engine import buscar_oportunidades, ResultadoBusqueda
from .report import exportar_csv, exportar_excel


def _configurar_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(levelname)s %(name)s: %(message)s",
    )


def _build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="propscout",
        description=(
            "Busca oportunidades de inversión inmobiliaria en Uruguay "
            "(MercadoLibre + InfoCasas), calcula el ROI neto de IRPF y exporta "
            "un reporte ordenado por rentabilidad."
        ),
    )
    p.add_argument("-c", "--config", help="Ruta a config YAML/JSON.")
    p.add_argument("--ciudad", help="Ciudad/departamento a buscar.")
    p.add_argument("--fuentes", help="Fuentes separadas por coma: mercadolibre,infocasas")
    p.add_argument("--precio-min", type=float, help="Precio mínimo de compra.")
    p.add_argument("--precio-max", type=float, help="Precio máximo de compra.")
    p.add_argument("--roi-objetivo", type=float, help="ROI objetivo (ej. 0.08 = 8%%).")
    p.add_argument("--limite", type=int, help="Máx. publicaciones por fuente y operación.")
    p.add_argument("--solo-alquiladas", action="store_true",
                   help="Solo publicaciones que parecen ya alquiladas (con inquilino).")
    p.add_argument("--solo-cumplen", action="store_true",
                   help="Exportar solo las que alcanzan el ROI objetivo.")
    p.add_argument("--demo", action="store_true",
                   help="Usar datos de muestra (sin acceso a internet) para probar el flujo.")
    p.add_argument("--tipo-cambio", type=float, help="UYU por USD.")
    p.add_argument("-o", "--output", default="oportunidades.xlsx",
                   help="Archivo de salida (.xlsx o .csv).")
    p.add_argument("--formato", choices=["xlsx", "csv", "ambos"], default="xlsx",
                   help="Formato de salida.")
    p.add_argument("--top", type=int, default=20,
                   help="Cuántas oportunidades mostrar en consola.")
    p.add_argument("-v", "--verbose", action="store_true")
    return p


def _aplicar_overrides(cfg: Config, args: argparse.Namespace) -> Config:
    if args.ciudad:
        cfg.ciudad = args.ciudad
    if args.fuentes:
        cfg.fuentes = [s.strip() for s in args.fuentes.split(",") if s.strip()]
    if args.precio_min is not None:
        cfg.precio_min = args.precio_min
    if args.precio_max is not None:
        cfg.precio_max = args.precio_max
    if args.roi_objetivo is not None:
        cfg.roi_objetivo = args.roi_objetivo
    if args.limite is not None:
        cfg.limite_por_fuente = args.limite
    if args.solo_alquiladas:
        cfg.solo_alquiladas = True
    if args.tipo_cambio is not None:
        cfg.tipo_cambio_uyu_por_usd = args.tipo_cambio
    return cfg


def _imprimir_resumen(res: ResultadoBusqueda, cfg: Config, top: int) -> None:
    print()
    print("=" * 78)
    print(f"  Ventas relevadas:        {res.ventas_relevadas}")
    print(f"  Alquileres relevados:    {res.alquileres_relevados}")
    print(f"  Con alquiler publicado:  {res.con_alquiler_publicado}")
    print(f"  Con alquiler estimado:   {res.con_alquiler_estimado}")
    cumplen = [o for o in res.oportunidades if o.cumple_objetivo]
    print(f"  Cumplen ROI ≥ {cfg.roi_objetivo*100:.1f}%:     {len(cumplen)}")
    print("=" * 78)
    if not res.oportunidades:
        print("\nNo se encontraron oportunidades. Revisá fuentes/credenciales/filtros.")
        return
    print(f"\nTop {min(top, len(res.oportunidades))} por ROI neto (de IRPF):\n")
    print(f"{'ROI neto':>9}  {'Precio':>12}  {'Alq.mes':>9}  Origen        Título")
    print("-" * 78)
    for o in res.oportunidades[:top]:
        marca = "★" if o.cumple_objetivo else " "
        print(
            f"{marca}{o.roi_neto*100:7.2f}%  "
            f"{o.moneda} {o.precio:>9,.0f}  "
            f"{o.alquiler_mensual:>7,.0f}  "
            f"{o.fuente_alquiler[:12]:<12}  "
            f"{o.listing.title[:34]}"
        )


def main(argv: Optional[list[str]] = None) -> int:
    args = _build_parser().parse_args(argv)
    _configurar_logging(args.verbose)

    cfg = Config.load(args.config)
    cfg = _aplicar_overrides(cfg, args)

    res = buscar_oportunidades(cfg, demo=args.demo)

    oportunidades = res.oportunidades
    if args.solo_cumplen:
        oportunidades = [o for o in oportunidades if o.cumple_objetivo]

    if oportunidades:
        out = args.output
        if args.formato in ("xlsx", "ambos"):
            xlsx = out if out.endswith(".xlsx") else out.rsplit(".", 1)[0] + ".xlsx"
            exportar_excel(oportunidades, xlsx, cfg.roi_objetivo)
        if args.formato in ("csv", "ambos"):
            csv_path = out if out.endswith(".csv") else out.rsplit(".", 1)[0] + ".csv"
            exportar_csv(oportunidades, csv_path)

    _imprimir_resumen(res, cfg, args.top)
    return 0


if __name__ == "__main__":
    sys.exit(main())
