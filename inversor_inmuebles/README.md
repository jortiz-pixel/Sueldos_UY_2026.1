# propscout — Buscador de oportunidades de inversión inmobiliaria (Uruguay)

Busca propiedades **en venta** en **MercadoLibre** e **InfoCasas**, prioriza
las que **ya están alquiladas** (con inquilino / renta vigente), estima o lee el
alquiler, **descuenta el IRPF a los arrendamientos** según la normativa
uruguaya y calcula el **retorno sobre inversión (ROI) neto anual**, ordenando
las oportunidades por rentabilidad y exportando un reporte en Excel/CSV.

> Objetivo típico: encontrar inmuebles con **ROI neto de IRPF mayor al 8% anual**.

---

## ¿Qué calcula?

Para cada propiedad en venta:

```
ROI neto anual = (alquiler anual − IRPF − otros costos) / precio de compra
```

- **Alquiler anual**: tomado de la publicación si la declara (p. ej. "renta
  U$S 950"), o **estimado** a partir de la mediana de alquiler por m² de
  publicaciones de alquiler comparables (barrio + tipo, con fallbacks).
- **IRPF a los arrendamientos** (DGI, Cat. I — rendimientos de capital
  inmobiliario):
  - Modo **simplificado** (por defecto): **10,5%** sobre el alquiler bruto, que
    es la retención/anticipo mensual habitual (ya contempla una deducción ficta).
  - Modo **detallado**: **12%** sobre el rendimiento neto = bruto − deducciones
    admitidas (comisión administradora + IVA, Contribución Inmobiliaria,
    Impuesto de Primaria).
  - **Exoneración** si el total de arrendamientos anuales es menor a **40 BPC**.
- **Otros costos** (configurables): vacancia, mantenimiento, gastos comunes,
  Contribución Inmobiliaria.

> ⚠️ Las cifras son una **estimación para screening de inversiones**, no
> asesoramiento fiscal. Verificá tu situación particular con un contador.

---

## Instalación

```bash
cd inversor_inmuebles
pip install -r requirements.txt
```

Requiere Python 3.10+.

---

## Uso rápido

Probar el flujo completo con **datos de muestra** (sin internet):

```bash
python -m propscout --demo
```

Buscar de verdad y exportar a Excel:

```bash
cp config.example.yaml config.yaml      # ajustá tipo de cambio, filtros, etc.
python -m propscout -c config.yaml --output oportunidades.xlsx --formato ambos
```

Ejemplos de filtros por línea de comandos (sobreescriben la config):

```bash
# Apartamentos en Pocitos hasta USD 150k, mostrando solo los que rinden ≥ 8%
python -m propscout -c config.yaml \
    --ciudad Montevideo --precio-max 150000 \
    --roi-objetivo 0.08 --solo-cumplen

# Solo publicaciones que parecen ya alquiladas, solo MercadoLibre
python -m propscout --fuentes mercadolibre --solo-alquiladas
```

### Opciones principales

| Opción | Descripción |
|--------|-------------|
| `--demo` | Usa datos de muestra (sin red) para ver cómo funciona. |
| `-c, --config` | Ruta a config YAML/JSON. |
| `--ciudad` | Ciudad/departamento. |
| `--fuentes` | `mercadolibre,infocasas`. |
| `--precio-min` / `--precio-max` | Rango de precio de compra. |
| `--roi-objetivo` | ROI objetivo (ej. `0.08`). |
| `--solo-alquiladas` | Solo inmuebles que parecen tener inquilino. |
| `--solo-cumplen` | Exporta solo los que alcanzan el ROI objetivo. |
| `--tipo-cambio` | UYU por USD. |
| `-o, --output` / `--formato` | Archivo y formato (`xlsx`, `csv`, `ambos`). |

---

## Fuentes de datos

### MercadoLibre (API oficial)

Usa la API pública de búsqueda (`api.mercadolibre.com/sites/MLU/search`).
**MercadoLibre suele exigir un token OAuth (Bearer)** para esta API. Si la
recibís sin token y responde 401/403, la fuente se omite con una advertencia
(el resto del proceso continúa).

Para habilitarla, generá un token siguiendo
[la documentación de MercadoLibre Developers](https://developers.mercadolibre.com.uy/)
y exportalo:

```bash
export ML_ACCESS_TOKEN="APP_USR-xxxxxxxx"
```

### InfoCasas (scraping)

InfoCasas no tiene API pública, así que se relevan las páginas de listado. El
parser intenta, en orden: el JSON embebido de Next.js (`__NEXT_DATA__`), bloques
JSON-LD y, como último recurso, selectores CSS. El scraping es **frágil**: si el
sitio cambia su markup, puede requerir ajustar los selectores en
`propscout/sources/infocasas.py`. Se hace en modo best-effort, con pausas entre
páginas y logging claro.

---

## Estructura

```
inversor_inmuebles/
├── propscout/
│   ├── cli.py            # interfaz de línea de comandos
│   ├── config.py         # parámetros fiscales/financieros/búsqueda
│   ├── models.py         # modelo Listing + extracción de renta
│   ├── irpf.py           # IRPF a los arrendamientos (Uruguay)
│   ├── roi.py            # cálculo de ROI neto
│   ├── rent_estimator.py # estimación de alquiler por m²
│   ├── engine.py         # orquestación
│   ├── report.py         # exportación Excel/CSV
│   ├── demo.py           # datos de muestra
│   └── sources/
│       ├── mercadolibre.py
│       └── infocasas.py
├── tests/                # pruebas (pytest), corren offline
├── config.example.yaml
└── requirements.txt
```

---

## Tests

```bash
python -m pytest tests/ -q
```

Cubren el cálculo de IRPF (incluida la exoneración), el ROI, el estimador de
alquiler, la extracción de renta de texto libre y el parsing de InfoCasas.

---

## Limitaciones y próximos pasos

- La API de MercadoLibre requiere token; sin él, esa fuente queda deshabilitada.
- El scraping de InfoCasas depende del markup del sitio.
- La estimación de alquiler es estadística (mediana por m²): cuanto mejor sea la
  segmentación por barrio/tipo, más precisa.
- Posibles mejoras: cacheo de resultados, más portales (Gallito, Properati),
  dashboard web, y modelado de costos de compra (gastos de escritura, ITP).
