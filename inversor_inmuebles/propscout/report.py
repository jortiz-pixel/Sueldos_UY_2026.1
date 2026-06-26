"""Exportación de oportunidades a CSV y Excel, ordenadas por ROI neto."""

from __future__ import annotations

import csv
import logging
from typing import Sequence

from .roi import Oportunidad

log = logging.getLogger("propscout.report")

COLUMNAS = [
    "fuente", "titulo", "tipo", "ciudad", "barrio", "area_m2", "dormitorios",
    "moneda", "precio", "alquiler_mensual", "alquiler_origen", "bruto_anual",
    "irpf_anual", "costos_extra_anual", "neto_anual", "roi_bruto_%",
    "roi_neto_%", "cumple_objetivo", "url",
]


def exportar_csv(oportunidades: Sequence[Oportunidad], path: str) -> None:
    with open(path, "w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.DictWriter(fh, fieldnames=COLUMNAS)
        writer.writeheader()
        for o in oportunidades:
            writer.writerow(o.fila_reporte())
    log.info("CSV escrito en %s (%d filas)", path, len(oportunidades))


def exportar_excel(oportunidades: Sequence[Oportunidad], path: str, roi_objetivo: float) -> None:
    try:
        from openpyxl import Workbook
        from openpyxl.styles import Font, PatternFill, Alignment
        from openpyxl.utils import get_column_letter
    except Exception:
        log.warning("openpyxl no disponible; exportando solo CSV.")
        exportar_csv(oportunidades, path.replace(".xlsx", ".csv"))
        return

    wb = Workbook()
    ws = wb.active
    ws.title = "Oportunidades"

    header_font = Font(bold=True, color="FFFFFF")
    header_fill = PatternFill("solid", fgColor="1F4E78")
    ok_fill = PatternFill("solid", fgColor="C6EFCE")

    ws.append(COLUMNAS)
    for col, _ in enumerate(COLUMNAS, start=1):
        c = ws.cell(row=1, column=col)
        c.font = header_font
        c.fill = header_fill
        c.alignment = Alignment(horizontal="center")

    for o in oportunidades:
        fila = o.fila_reporte()
        ws.append([fila[c] for c in COLUMNAS])
        if o.cumple_objetivo:
            r = ws.max_row
            for col in range(1, len(COLUMNAS) + 1):
                ws.cell(row=r, column=col).fill = ok_fill

    # Anchos de columna aproximados.
    anchos = {"titulo": 45, "url": 50, "barrio": 18, "ciudad": 15, "tipo": 14}
    for idx, col in enumerate(COLUMNAS, start=1):
        ws.column_dimensions[get_column_letter(idx)].width = anchos.get(col, 14)

    ws.freeze_panes = "A2"
    ws.auto_filter.ref = f"A1:{get_column_letter(len(COLUMNAS))}{ws.max_row}"

    # Hoja resumen.
    resumen = wb.create_sheet("Resumen")
    cumplen = [o for o in oportunidades if o.cumple_objetivo]
    resumen.append(["Métrica", "Valor"])
    resumen.append(["Oportunidades analizadas", len(oportunidades)])
    resumen.append([f"Cumplen ROI objetivo (≥ {roi_objetivo*100:.1f}%)", len(cumplen)])
    if oportunidades:
        mejor = max(oportunidades, key=lambda o: o.roi_neto)
        resumen.append(["Mejor ROI neto (%)", round(mejor.roi_neto * 100, 2)])
        resumen.append(["Mejor publicación", mejor.listing.title])
    for col in range(1, 3):
        resumen.cell(row=1, column=col).font = header_font
        resumen.cell(row=1, column=col).fill = header_fill
    resumen.column_dimensions["A"].width = 40
    resumen.column_dimensions["B"].width = 50

    wb.save(path)
    log.info("Excel escrito en %s (%d filas)", path, len(oportunidades))
