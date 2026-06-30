# AsysTax. Sueldos — Guía de marca para desarrollo

> Sub-marca de **AsysTax** para el software de liquidación de sueldos (Uruguay).
> Versión 1.0 · Estética: SaaS moderno, azul fintech, foco en precisión y confianza.

Este documento está pensado para que un asistente de código (Claude Code) aplique
la identidad visual de forma consistente. Los valores definitivos están en
`tokens.css` (variables CSS) y `tokens.json` (estructurado).

---

## 1. Logotipo

- **Wordmark:** `AsysTax` en **Space Grotesk 700**. `Asys` en navy `#0B1B3A`, `Tax` en azul primario `#1E5BFF`.
- **El punto:** un círculo azul `#1E5BFF` cierra siempre la marca (`AsysTax.`). Es el sello de la familia — representa precisión / dato exacto. No se elimina.
- **Descriptor del producto:** `SUELDOS` en **Plus Jakarta Sans 500**, mayúsculas, `letter-spacing: 0.3em`, color `#6B7A95`. Nunca más grande que el wordmark.
- **Isotipo / ícono de app:** cuadrado redondeado navy con `A.` blanco (el punto en `#5B8DEF`).

**No hacer:** cambiar la tipografía, recolorear, inclinar/deformar, ni quitar el punto.
Área de respeto = altura de la "A". Tamaño mínimo: lockup 120px / isotipo 24px.

---

## 2. Color

Ver `tokens.css`. Resumen:

| Token | Hex | Uso |
|---|---|---|
| navy | `#0B1B3A` | Texto principal, sidebar, fondos oscuros |
| primary | `#1E5BFF` | Acción principal, enlaces, el punto |
| primary-soft | `#5B8DEF` | Acento sobre oscuro |
| primary-50 | `#EAF0FF` | Fondos suaves, hover, botón secundario |
| bg | `#E9EDF4` | Fondo general de la app |
| surface | `#FFFFFF` | Tarjetas y paneles |
| text-muted | `#4A5872` | Texto secundario |
| text-subtle | `#8493AD` | Labels y captions |
| success | `#22C3A6` | Aprobado / liquidado |
| warning | `#F5A524` | Pendiente |
| error | `#E5484D` | Error / rechazado |

**Proporción de uso:** ~60% neutros, ~22% blanco, ~12% azul primario (solo acción), ~6% navy.
El azul primario se reserva para la acción principal; no pintar superficies grandes con él.

---

## 3. Tipografía

- **Space Grotesk** → marca, títulos y **todas las cifras/montos** (con `font-variant-numeric: tabular-nums` para que las columnas alineen).
- **Plus Jakarta Sans** → interfaz, cuerpo de texto, tablas, formularios.

Escala: Display 34/700 · Título 22/700 · Cuerpo 15/400 · Cifra 20/500 · Label 12/600 (uppercase, tracking 0.1em).

Importar de Google Fonts:
```html
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
```

---

## 4. Componentes (reglas base)

- **Radios:** 8px (chips/inputs), 12px (tarjetas/botones), 18px (paneles grandes).
- **Botón primario:** fondo `primary`, texto blanco, radio 10–12px, padding `12px 22px`, peso 600.
- **Botón secundario:** fondo `primary-50`, texto `primary`.
- **Botón terciario:** fondo blanco, borde `#D7DEEA`, texto `text-muted`.
- **Tarjetas:** `surface` sobre `bg`, sin borde o borde `--color-border`, sombra suave opcional.
- **Sidebar:** fondo `navy`, item activo con fondo `primary`, items inactivos en `#8FA8D6`.
- **Badges de estado:** texto + fondo del par semántico (success/warning/error), forma pill.
- **Tablas/montos:** alinear a la derecha, Space Grotesk con `tabular-nums`.

**Principios:** superficies blancas sobre fondo gris-azulado, esquinas redondeadas,
azul reservado a la acción, jerarquía clara, densidad cómoda.

---

## 5. Cómo aplicarlo

1. Copiá `tokens.css` al proyecto e importalo globalmente (o pasá `tokens.json` a tu sistema de design tokens / Tailwind `theme.extend.colors`).
2. Cargá las dos fuentes de Google Fonts.
3. Usá las variables (`var(--color-primary)`, etc.) — **no introduzcas colores fuera de estos tokens.**
4. Reservá `--color-primary` para la acción principal y los enlaces.
