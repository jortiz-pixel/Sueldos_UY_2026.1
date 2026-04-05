# Sueldos UY 2026 — Sistema de Liquidación de Sueldos

Sistema de liquidación de haberes conforme a la normativa laboral y tributaria
uruguaya. Producción-ready, multi-empresa, con aritmética de centésimos para
precisión financiera.

---

## Stack tecnológico

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js 20 + Express + TypeScript |
| ORM | Prisma 5 |
| Base de datos | PostgreSQL 16 |
| Frontend | React 18 + TypeScript + Vite + Tailwind CSS |
| Auth | JWT (access + refresh tokens) |
| PDF | PDFKit |
| Excel | SheetJS (xlsx) |
| Contenedores | Docker + docker-compose |

---

## Inicio rápido (desarrollo local)

### 1. Prerrequisitos

- Node.js 20+
- PostgreSQL 16+ (o Docker)
- npm 10+

### 2. Clonar y configurar

```bash
# Variables de entorno
cp .env.example .env
# Editar .env con sus valores reales
```

### 3. Backend

```bash
cd backend
npm install
npm run prisma:migrate      # Aplica migraciones a la BD
npm run prisma:seed          # Carga datos iniciales (empresa + empleados demo)
npm run dev                  # Inicia en modo desarrollo (puerto 3000)
```

### 4. Frontend

```bash
cd frontend
npm install
npm run dev                  # Inicia en http://localhost:5173
```

---

## Inicio con Docker

```bash
# Construir y levantar todos los servicios
docker-compose up --build

# Primera vez: aplicar migraciones y seed
docker-compose exec backend npm run prisma:migrate
docker-compose exec backend npm run prisma:seed
```

La aplicación queda disponible en `http://localhost` (frontend) y
`http://localhost:3000` (API).

---

## Credenciales de demo

| Usuario | Email | Contraseña | Rol |
|---------|-------|-----------|-----|
| Admin | `admin@sueldos.uy` | `Admin1234!` | ADMIN |
| Liquidador | `liquidador@empresa.uy` | `Operator1234!` | OPERATOR |
| Consulta | `consulta@empresa.uy` | `Viewer1234!` | VIEWER |

---

## Metodología de cálculo

### IRPF — Categoría II (Rentas del Trabajo)

**Método de proyección anual** (DGI Resolución 662/007 y modificativas):

```
1. Renta neta mensual = Salario nominal
                       - BPS jubilatorio (15%)
                       - FONASA (3% básico + 2% si familia)

2. Renta neta anual proyectada = Renta neta mensual × 12

3. Deducciones por cargas:
   - Hijos a cargo: hijosACargo × 13 BPC/año
   - Hijos con discapacidad: × 26 BPC/año (doble)
   - Cónyuge a cargo: 6 BPC/año

4. Base IRPF = max(0, Renta neta anual - Deducciones)

5. Impuesto anual = suma progresiva por tramos (escala vigente)

6. Retención mensual = Impuesto anual / 12  [redondeo ROUND_HALF_UP]
```

**Escala IRPF 2024** (en BPC anuales, BPC 2024 = $6,756):

| Tramo | Desde | Hasta | Tasa |
|-------|-------|-------|------|
| 1 | 0 BPC | 84 BPC | 0% |
| 2 | 84 BPC | 120 BPC | 10% |
| 3 | 120 BPC | 180 BPC | 15% |
| 4 | 180 BPC | 600 BPC | 20% |
| 5 | 600 BPC | 900 BPC | 22% |
| 6 | 900 BPC | 1.380 BPC | 25% |
| 7 | 1.380 BPC | sin límite | 30% |

### Aportes obreros (descuentos al empleado)

| Concepto | Tasa |
|----------|------|
| BPS Jubilatorio | 15% |
| FONASA básico | 3% |
| FONASA familia | +2% (si tiene familia a cargo) |
| FRL | 0.125% |

### Aportes patronales

| Concepto | Tasa |
|----------|------|
| BPS IVS | 7.5% |
| FONASA/DISSE | 5% (industria/comercio) |
| FRL | 0.025% |
| BSE | configurable por empresa |

### Aguinaldo (Ley 10.449)

```
Aguinaldo bruto = Suma de haberes del semestre / 12
Aplica BPS + IRPF sobre la base del aguinaldo
```

### Licencia y Salario Vacacional (Ley 12.590)

- 0–4 años: 20 días hábiles/año
- 5–9 años: 25 días hábiles/año
- 10+ años: 30 días hábiles/año

Salario vacacional = 100% del salario de licencia (adicional)

### Liquidación Final

- Indemnización: 1 mes por año (máx. 6 meses)
- Preaviso: según antigüedad (7 días a 3 meses)
- Proporcional aguinaldo + licencia pendiente

---

## Actualizar parámetros tributarios (BPC, tasas)

Todos los parámetros están en la tabla `payroll_parameters` con fechas de
vigencia. **Nunca se hardcodean en el código.**

```bash
# Vía API (requiere rol ADMIN):
POST /api/parameters
{
  "key": "BPC",
  "value": 7200,
  "description": "BPC 2025",
  "effectiveDate": "2025-01-01T00:00:00.000Z"
}

# Actualizar escala IRPF:
POST /api/parameters/tax-brackets
{
  "effectiveDate": "2025-01-01T00:00:00.000Z",
  "brackets": [
    { "fromBpc": 0,    "toBpc": 84,   "rate": 0 },
    { "fromBpc": 84,   "toBpc": 120,  "rate": 1000 },
    ...
  ]
}
```

---

## API REST — Endpoints principales

```
# Auth
POST   /api/auth/login
POST   /api/auth/refresh
POST   /api/auth/logout
GET    /api/auth/me

# Empresas
GET    /api/companies
POST   /api/companies
PUT    /api/companies/:id

# Empleados
GET    /api/employees?companyId=&search=&page=&limit=
POST   /api/employees
PUT    /api/employees/:id
GET    /api/employees/:id/liquidations
GET    /api/employees/:id/vacation

# Liquidaciones
POST   /api/liquidation/periods              ← crear período
POST   /api/liquidation/generate             ← liquidación mensual individual
POST   /api/liquidation/generate-batch       ← todos los empleados del período
POST   /api/liquidation/aguinaldo            ← calcular aguinaldo
POST   /api/liquidation/licencia             ← liquidar vacaciones
POST   /api/liquidation/final                ← despido/egreso
GET    /api/liquidation/:id/preview          ← desglose antes de confirmar
POST   /api/liquidation/:id/confirm          ← bloquear liquidación
GET    /api/liquidation/:id/recibo           ← PDF recibo de sueldo

# Parámetros
GET    /api/parameters                       ← parámetros vigentes
POST   /api/parameters                       ← nuevo parámetro (versionado)
POST   /api/parameters/tax-brackets          ← actualizar escala IRPF

# Reportes
GET    /api/reports/nomina-mensual           ← nómina completa del período
GET    /api/reports/bps-nomina               ← datos para declaración BPS (C1)
GET    /api/reports/irpf-summary             ← retenciones IRPF anuales por empleado
GET    /api/reports/nomina-excel             ← Excel nómina + BPS
```

---

## Tests

```bash
cd backend
npm test                    # Ejecuta todos los tests
npm run test:coverage       # Con reporte de cobertura
npm test -- tests/irpf      # Solo tests de IRPF
npm test -- tests/bps       # Solo tests de BPS/FONASA
```

Los tests son unitarios (sin BD) y cubren:
- Motor IRPF: todos los tramos, deducciones por cargas, redondeo DGI
- BPS/FONASA/FRL: tasas obreras y patronales, precisión de centésimos
- Horas extra: diurnas (2×) y nocturnas (2.5×)
- Aritmética de centésimos: toCtms, toPesos, applyRate, divRoundHalfUp

---

## Precisión financiera

- **Aritmética entera en centésimos**: 1 peso = 100 centésimos (BigInt)
- **Redondeo DGI**: ROUND_HALF_UP en todas las operaciones
- **Sin punto flotante** en lógica de negocio
- **Snapshot de parámetros**: cada liquidación guarda los parámetros usados
  para re-ejecutar cálculos históricos con las tasas correctas

---

## Variables de entorno requeridas

Ver `.env.example` para la lista completa. Variables críticas:

```env
DATABASE_URL=postgresql://user:pass@host:5432/dbname
JWT_SECRET=mínimo 64 caracteres aleatorios
JWT_REFRESH_SECRET=mínimo 64 caracteres aleatorios
```

---

## Estructura del proyecto

```
Sueldos_UY_2026.1/
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma      ← Esquema BD completo
│   │   └── seed.ts            ← Datos iniciales
│   ├── src/
│   │   ├── index.ts           ← Entry point Express
│   │   ├── middleware/
│   │   │   ├── auth.ts        ← JWT + roles
│   │   │   └── errorHandler.ts
│   │   ├── routes/            ← Controladores REST
│   │   ├── services/
│   │   │   ├── irpf.service.ts       ← Motor IRPF (core)
│   │   │   ├── bps.service.ts        ← BPS/FONASA/FRL
│   │   │   ├── liquidation.service.ts ← Nómina mensual
│   │   │   ├── aguinaldo.service.ts
│   │   │   ├── vacation.service.ts   ← Licencia + despido
│   │   │   ├── parameters.service.ts ← Parámetros versionados
│   │   │   ├── pdf.service.ts        ← Recibos PDF
│   │   │   └── excel.service.ts      ← Reportes Excel
│   │   └── utils/
│   │       ├── money.ts       ← Aritmética de centésimos
│   │       ├── date.ts        ← Antigüedad, días hábiles
│   │       └── logger.ts
│   └── tests/
│       ├── irpf.test.ts
│       └── bps.test.ts
├── frontend/
│   └── src/
│       ├── pages/             ← Dashboard, Empleados, Liquidaciones, Reportes, Parámetros
│       ├── components/
│       ├── services/api.ts    ← Cliente HTTP (Axios)
│       ├── hooks/useAuth.tsx
│       └── types/index.ts
├── docker-compose.yml
├── .env.example
└── README.md
```

---

## Multi-empresa (multi-tenant)

Cada empresa tiene sus propios empleados y liquidaciones. Los usuarios se
asocian a una empresa. Los ADMIN pueden acceder a todas las empresas.
Los parámetros BPS/IRPF son globales (companyId = null), pero pueden
sobreescribirse por empresa.

---

## Licencia

MIT — libre uso para empresas uruguayas.
