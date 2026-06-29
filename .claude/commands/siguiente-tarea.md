---
description: Toma la próxima tarea no bloqueada de docs/BACKLOG.md, la implementa entera con tests, commitea y pushea en una rama por tarea. El ciclo de construcción autónoma.
---

Sos el agente de construcción autónoma de Sueldos UY / AsysTax. Vas a completar
**una** tarea del backlog, de punta a punta. Alcance opcional del usuario:
$ARGUMENTS (si nombra una tarea/fase, hacé esa; si está vacío, tomá la primera
no bloqueada).

## 1. Elegir la tarea

1. Leé `docs/BACKLOG.md` y `CLAUDE.md` completos.
2. Tomá la **primera tarea `[ ]` no bloqueada** según el "Orden recomendado de
   ataque" (o la que pидió el usuario en $ARGUMENTS).
3. **Verificá en el código** si ya está hecha (puede haber avanzado más que el
   backlog). Si ya está, marcala `[x]` y pasá a la siguiente.
4. 🛑 **Si la tarea depende de una decisión estratégica (D1/D3/D10) o de algo
   ambiguo de negocio, NO la inventes.** Pará y preguntá al usuario con
   AskUserQuestion, dando contexto suficiente. No avances a ciegas.
5. Si la tarea es grande, partila: hacé el primer sub-paso entregable y dejá el
   resto como tareas nuevas en el backlog.

## 2. Implementar

- Seguí las **reglas de oro** de CLAUDE.md (centésimos/BigInt, redondeo DGI,
  parámetros versionados, multi-tenant, Zod→422, migraciones aditivas).
- Marcá la tarea `[~]` en el backlog al empezar.
- Escribí/actualizá tests en `backend/tests/` para toda lógica de negocio nueva.
- Si tocás `schema.prisma`: nueva migración + `prisma:generate`.

## 3. Definition of done (obligatoria antes de commitear)

- `cd backend && npm test` pasa.
- `cd backend && npm run build` compila.
- Si tocaste frontend: `cd frontend && npm run lint && npm run build`.
- Marcá la tarea `[x]` en `docs/BACKLOG.md` (mismo commit).

## 4. Entregar

1. Creá una rama por tarea desde la base actual:
   `git checkout -b claude/<fase>-<slug-corto>` (ej. `claude/f2-bus-eventos`).
   Si el usuario pidió trabajar sobre una rama específica, respetala.
2. Commit en español: `feat(F<n>): <descripción>` (o `fix:`/`refactor:` según
   corresponda), incluyendo el cambio del backlog.
3. `git push -u origin <rama>` (con reintentos ante fallos de red).
4. **No abras PR salvo que el usuario lo pida.** Si lo pide, abrí UN PR con la
   tarea y resumí qué se hizo y cómo se validó.

## 5. Cerrar el turno

- Reportá en 3-5 líneas: qué tarea hiciste, qué tests corriste, qué sigue.
- Si la definition of done falló y no pudiste resolverlo, **no commitees roto**:
  dejá el diagnóstico y pedí ayuda.
- Una tarea por turno. No encadenes varias sin que el usuario lo pida.
