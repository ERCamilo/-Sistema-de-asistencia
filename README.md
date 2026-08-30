# Registro vivo de Dirección

> **Política de rama:** `project-docs` es el registro interno de Dirección y nunca se integra a `main`. Las bitácoras deben apuntar a SHAs funcionales verificables en remoto; código y documentación deben estar publicados antes de una revisión. Veredictos, roadmap, ADR, dependencias y estados viven solamente en esta rama. Una bitácora no sustituye la inspección del código funcional.

## Estado actual

| Unidad | Estado |
|---|---|
| A0-A6 | ✅ Cerradas y aprobadas por Dirección; Tanda A completa |
| B1 | 🟢 Autorizada exclusivamente: `PayrollClosure` schema 3, `projectId` inmutable e identidades/fingerprints/IDs de cierres project-aware |
| B2-B5 | 🔒 Bloqueadas |
| F1.7 | 🔒 Bloqueada |

| Referencia funcional | Valor |
|---|---|
| Rama | `feature/factor-dias-no-laborables` |
| SHA funcional remoto actual | `f735dd6f3a4bda67688a76bb6cb11ee47e32833f` (`f735dd6`) sobre A6 principal `b286d70acb2f12b391fa2b46f5514aec9145c046`; rango `792793a..f735dd6` |
| Alcance acreditado | A0–A6 ✅; Tanda A ✅ completa; B1 🟢 autorizada exclusivamente |
| A6 funcional | `b286d70` implementó gates + matriz; Dirección encontró lecturas directas ungated y MC1 `f735dd6` gateó `getById`/`getSyncStates` antes de DB. A6 quedó formalmente aprobada. |
| Evidencia final | `TandaBGates` **24/24** + matriz **9/9** · full **368/368 suites · 3575/3575 tests** · MC1 ALLOW 0 findings |
| Commit documental A6/MC1 publicado | `c5b2f686b3ca8c149752a9bfe6927d54a28a6380` (`c5b2f686`) en `project-docs` |

## Lectura viva

1. [Roadmap de Dirección](roadmap/ROADMAP.md)
2. [Índice de Fase 1](fase-1/README.md)
3. [Contrato vivo F1.6](fase-1/F1.6-nomina-multiproyecto.md)
4. [Bitácora A6 — MC1 resuelto y cierre formal](fase-1/F1.6-A6-bitacora.md) (`b286d70` + `f735dd6` ✅)
5. [Bitácora A5](fase-1/F1.6-A5-bitacora.md) (`ae66121` ✅)
6. [Bitácora A4](fase-1/F1.6-A4-bitacora.md) (`6c1cb2c` ✅) · Bitácoras históricas: [A0](fase-1/F1.6-A0-bitacora.md), [A0.5](fase-1/F1.6-A0.5-bitacora.md), [A1](fase-1/F1.6-A1-bitacora.md), [A2](fase-1/F1.6-A2-bitacora.md) y [A3](fase-1/F1.6-A3-bitacora.md)
7. [Hallazgos de Fase 0](fase-0/F0-HALLAZGOS.md)

## Próximo punto de parada

**A0–A6 ✅ y Tanda A ✅ completa. B1 🟢 está autorizada exclusivamente** para `PayrollClosure` schema 3, `projectId` inmutable e identidades/fingerprints/IDs de cierres project-aware. **B2–B5 y F1.7 continúan 🔒; no ampliar B1 a stores, consultas, cachés, historial, migración, cloud, préstamos, ajustes ni exportaciones.**

## Estructura

| Ruta | Contenido |
|---|---|
| [`roadmap/`](roadmap/ROADMAP.md) | Roadmap, dependencias, ADR y estados de Dirección |
| [`fase-0/`](fase-0/README.md) | Auditoría y preparación de SA |
| [`fase-1/`](fase-1/README.md) | Ejecución, contratos y bitácoras de Fase 1 |
