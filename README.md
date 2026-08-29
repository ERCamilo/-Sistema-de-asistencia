# Registro vivo de Dirección

> **Política de rama:** `project-docs` es el registro interno de Dirección y nunca se integra a `main`. Las bitácoras deben apuntar a SHAs funcionales verificables en remoto; código y documentación deben estar publicados antes de una revisión. Veredictos, roadmap, ADR, dependencias y estados viven solamente en esta rama. Una bitácora no sustituye la inspección del código funcional.

## Estado actual

| Unidad | Estado |
|---|---|
| A0-A5 | ✅ Cerradas y aprobadas por Dirección |
| A6 | 🟡 Pendiente de veredicto formal de Dirección sobre `b286d70` (20/20, 9/9, 368/368 · 3571, ALLOW · 0 findings tras fix de 2 CRITICAL) |
| B1-B5 | 🔒 Bloqueadas |
| F1.7 | 🔒 Bloqueada |

| Referencia funcional | Valor |
|---|---|
| Rama | `feature/factor-dias-no-laborables` |
| SHA remoto | `b286d70acb2f12b391fa2b46f5514aec9145c046` (`b286d70`) sobre base `792793ac875cb56afed84a1f982d1b19d6fa4f15` (`792793a`) |
| Alcance acreditado | A5 cerrado y aprobado; A6 🟡 pendiente formal (no es ✅) |
| A6 funcional | **Incluido funcionalmente** como `b286d70` (15 archivos, +532 líneas, helper `TandaBGate.js` 27 líneas) — pendiente de veredicto formal en `project-docs` |

## Lectura viva

1. [Roadmap de Dirección](roadmap/ROADMAP.md)
2. [Índice de Fase 1](fase-1/README.md)
3. [Contrato vivo F1.6](fase-1/F1.6-nomina-multiproyecto.md)
4. [Bitácora A6 — pendiente formal](fase-1/F1.6-A6-bitacora.md) (`b286d70` 🟡)
5. [Bitácora A5](fase-1/F1.6-A5-bitacora.md) (`ae66121` ✅)
6. [Bitácora A4](fase-1/F1.6-A4-bitacora.md) (`6c1cb2c` ✅) · Bitácoras históricas: [A0](fase-1/F1.6-A0-bitacora.md), [A0.5](fase-1/F1.6-A0.5-bitacora.md), [A1](fase-1/F1.6-A1-bitacora.md), [A2](fase-1/F1.6-A2-bitacora.md) y [A3](fase-1/F1.6-A3-bitacora.md)
7. [Hallazgos de Fase 0](fase-0/F0-HALLAZGOS.md)

## Próximo punto de parada

**A6 🟡 pendiente de veredicto formal sobre `b286d70`** — commit funcional `b286d70` ya publicado en `feature/factor-dias-no-laborables` sobre base `792793a` y bitácora `F1.6-A6` documentada en esta rama. **Solicitar veredicto formal de Dirección sobre A6 y detenerse antes de B1.** No iniciar B1–B5 ni F1.7 hasta aprobación de A6. DEP-SA-004 cerrado.

## Estructura

| Ruta | Contenido |
|---|---|
| [`roadmap/`](roadmap/ROADMAP.md) | Roadmap, dependencias, ADR y estados de Dirección |
| [`fase-0/`](fase-0/README.md) | Auditoría y preparación de SA |
| [`fase-1/`](fase-1/README.md) | Ejecución, contratos y bitácoras de Fase 1 |
