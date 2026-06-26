"""Configuración del buscador: parámetros fiscales, financieros y de búsqueda.

Se carga desde un archivo YAML o JSON y/o desde variables de entorno, con
valores por defecto razonables para Uruguay 2026. Todos los parámetros son
ajustables sin tocar el código.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass, field, fields
from typing import Any, Optional

try:  # YAML es opcional; si no está, se usa JSON.
    import yaml  # type: ignore
except Exception:  # pragma: no cover
    yaml = None


@dataclass
class IrpfConfig:
    """Parámetros del IRPF a los arrendamientos (Cat. I, rendimientos de capital).

    - mode "simplificado": aplica una tasa efectiva sobre el alquiler bruto
      (10,5% es el anticipo/retención mensual habitual, que ya contempla una
      deducción ficta).
    - mode "detallado": aplica la tasa nominal del 12% sobre el rendimiento
      neto = bruto − deducciones admitidas (comisión administradora + IVA,
      Contribución Inmobiliaria, Impuesto de Primaria).
    """

    mode: str = "simplificado"          # "simplificado" | "detallado"
    tasa_efectiva: float = 0.105        # usada en modo simplificado
    tasa_nominal: float = 0.12          # usada en modo detallado
    # Deducciones (modo detallado), expresadas como fracción del alquiler bruto
    # anual salvo las que son montos fijos anuales.
    comision_admin_pct: float = 0.066   # ~5,5% + IVA (22%) ≈ 6,71%; aprox.
    comision_admin_iva: float = 0.22
    contribucion_inmobiliaria_anual: float = 0.0   # monto fijo anual (UYU)
    primaria_anual: float = 0.0                    # monto fijo anual (UYU)
    # Exoneración: si el total de arrendamientos anuales < umbral_bpc * valor_bpc.
    aplicar_exoneracion: bool = True
    umbral_exoneracion_bpc: float = 40.0


@dataclass
class CostosConfig:
    """Otros costos anuales del inmueble que reducen el retorno real.

    Se expresan como fracción del alquiler bruto anual (vacancia, comisión si
    no se modeló en IRPF) o como montos fijos anuales en la moneda de reporte.
    """

    vacancia_pct: float = 0.05          # % del año sin alquilar (rotación)
    mantenimiento_pct: float = 0.05     # % del alquiler para reparaciones
    gastos_comunes_anual: float = 0.0   # si los paga el propietario
    contribucion_inmobiliaria_anual: float = 0.0  # en moneda de reporte
    incluir_costos_extra: bool = True


@dataclass
class Config:
    """Configuración completa del buscador."""

    # --- Conversión de moneda y unidades fiscales ---
    tipo_cambio_uyu_por_usd: float = 40.0   # ajustar al valor vigente
    valor_bpc: float = 6_576.0              # BPC 2026 (UYU); 40 BPC ≈ 263.040
    moneda_reporte: str = "USD"             # "USD" | "UYU"

    # --- Objetivo de inversión ---
    roi_objetivo: float = 0.08              # 8% anual neto de IRPF

    # --- Filtros de búsqueda ---
    ciudad: str = "Montevideo"
    operacion: str = "venta"
    precio_min: Optional[float] = None
    precio_max: Optional[float] = None
    tipos_propiedad: list[str] = field(default_factory=list)  # vacío = todos
    barrios: list[str] = field(default_factory=list)
    solo_alquiladas: bool = False           # exigir indicio de "ya alquilada"
    limite_por_fuente: int = 200

    # --- Sub-configuraciones ---
    irpf: IrpfConfig = field(default_factory=IrpfConfig)
    costos: CostosConfig = field(default_factory=CostosConfig)

    # --- Credenciales / fuentes ---
    ml_access_token: Optional[str] = None   # token OAuth de MercadoLibre
    ml_site: str = "MLU"                     # Uruguay
    ml_category: str = "MLU1459"             # Inmuebles
    fuentes: list[str] = field(default_factory=lambda: ["mercadolibre", "infocasas"])

    # ------------------------------------------------------------------ carga
    @classmethod
    def load(cls, path: Optional[str] = None) -> "Config":
        """Carga la config desde un archivo (YAML/JSON) y aplica overrides de env."""
        data: dict[str, Any] = {}
        if path and os.path.exists(path):
            with open(path, "r", encoding="utf-8") as fh:
                if path.endswith((".yaml", ".yml")):
                    if yaml is None:
                        raise RuntimeError(
                            "Config en YAML pero PyYAML no está instalado. "
                            "Instalá pyyaml o usá un archivo .json."
                        )
                    data = yaml.safe_load(fh) or {}
                else:
                    data = json.load(fh)
        cfg = cls.from_dict(data)
        cfg._apply_env()
        return cfg

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Config":
        data = dict(data or {})
        irpf = IrpfConfig(**(data.pop("irpf", {}) or {}))
        costos = CostosConfig(**(data.pop("costos", {}) or {}))
        valid = {f.name for f in fields(cls)}
        clean = {k: v for k, v in data.items() if k in valid}
        return cls(irpf=irpf, costos=costos, **clean)

    def _apply_env(self) -> None:
        """Permite sobreescribir credenciales/parámetros sensibles vía entorno."""
        token = os.getenv("ML_ACCESS_TOKEN")
        if token:
            self.ml_access_token = token
        tc = os.getenv("TIPO_CAMBIO_UYU_POR_USD")
        if tc:
            try:
                self.tipo_cambio_uyu_por_usd = float(tc)
            except ValueError:
                pass

    # --------------------------------------------------------------- utilidades
    def to_report_currency(self, amount: float, currency: str) -> float:
        """Convierte un monto a la moneda de reporte."""
        if currency == self.moneda_reporte:
            return amount
        if currency == "USD" and self.moneda_reporte == "UYU":
            return amount * self.tipo_cambio_uyu_por_usd
        if currency == "UYU" and self.moneda_reporte == "USD":
            return amount / self.tipo_cambio_uyu_por_usd
        return amount

    def to_uyu(self, amount: float, currency: str) -> float:
        if currency == "UYU":
            return amount
        return amount * self.tipo_cambio_uyu_por_usd
