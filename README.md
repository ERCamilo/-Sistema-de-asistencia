# Registro vivo de Dirección

> **Política de rama:** `project-docs` es el registro interno de Dirección y nunca se integra a `main`. Las bitácoras deben apuntar a SHAs funcionales verificables en remoto; código y documentación deben estar publicados antes de una revisión. Veredictos, roadmap, ADR, dependencias y estados viven solamente en esta rama. Una bitácora no sustituye la inspección del código funcional.

## Estado actual

| Unidad | Estado |
|---|---|
| A0-A6 | ✅ Cerradas y aprobadas por Dirección; Tanda A completa |
| B1 | ✅ Cerrada y aprobada formalmente por Dirección en `193273e` |
| B2 | ✅ Cerrada y aprobada formalmente por Dirección — B2.0 `580227a`, B2.1 `114f041`+MC1 `c9da41e`, B2.2 `4734403`+MC1 `d563055`, B2.3 `5c3e419`+MC1 `64421a4`, B2.4/cierre `fd8dc7e` |
| B3 | 🟢 Autorizada exclusivamente para repositorio/sync cloud de cierres por proyecto |
| B4-B5 | 🔒 Bloqueadas |
| F1.7 | 🔒 Bloqueada |

| Referencia funcional | Valor |
|---|---|
| Rama | `feature/factor-dias-no-laborables` |
| SHA funcional remoto actual | `d5a6f8e6aa53a9ce318781bcc82eabb2763b12f0` (`d5a6f8e`) — árbol final tras B2.4 `fd8dc7e` sobre `193273e`/`f735dd6`; prerequisito hook infra `0fc54df`; B2.0 `580227a`, B2.1 `114f041`+`c9da41e`, B2.2 `4734403`+`d563055`, B2.3 `5c3e419`+`64421a4`, B2.4 `fd8dc7e` |
| Alcance acreditado | A0–A6 ✅; Tanda A ✅ completa; B1 ✅; **B2 ✅ cerrada y aprobada formalmente (B2.0–B2.4 ✅)**; B3 🟢 autorizada exclusivamente para cloud/sync por proyecto; B4–B5 y F1.7 🔒 |
| B1 funcional | Schema 3 ON con `projectId` obligatorio y semánticamente inmutable; fingerprint/ID project-aware; correcciones deterministas y void owner-preserving. OFF conserva schema 2 exacto sin `projectId` ni dual-write. |
| B2 funcional | Persistencia local project-scoped de cierres: store/consultas/cachés/historial/paginación/búsqueda por período/`getById`/sync state y migración `projectId`-aware; stamper schema 2→3 reanudable/idempotente por lotes pequeños; promoción legacy schema 2 por metadata al default sin reescritura económica; resolución B2.4 OFF→new legacy→ON reentry. |
| B3 autorizado | Repositorio/sync cloud project-scoped de cierres con promoción lazy legacy preservando `id`/`fingerprint`/`supersedesId`, contrato native vs promoted-legacy, sin rediseño de identidad económica |
| Evidencia final | B2 suite **374/3620** en árbol final `d5a6f8e` con **un flake no bloqueante** (`ProjectStoreRealIdb` — `Expected: 1 Received: undefined` en `toBe` 1ms, producción no modificada por B2.4, retry verde); B1 **41/41** · agrupada A6/B1 **129/129** · B2 serie 374/3620 |
| Commit documental A6/MC1 publicado | `c5b2f686b3ca8c149752a9bfe6927d54a28a6380` (`c5b2f686`) en `project-docs` |

## Lectura viva

1. [Roadmap de Dirección](roadmap/ROADMAP.md)
2. [Índice de Fase 1](fase-1/README.md)
3. [Contrato vivo F1.6](fase-1/F1.6-nomina-multiproyecto.md)
4. [Bitácora B2 — cierre formal local project-scoped](fase-1/F1.6-B2-bitacora.md) (`fd8dc7e`/`d5a6f8e` ✅) · [Bitácora B1 — cierre formal](fase-1/F1.6-B1-bitacora.md) (`193273e` ✅) · [Incidente resuelto `EXC-REVIEW-B1-001`](revisiones/B1-review-infrastructure-block.md)
5. [Bitácora A6 — MC1 resuelto y cierre formal](fase-1/F1.6-A6-bitacora.md) (`b286d70` + `f735dd6` ✅)
6. [Bitácora A5](fase-1/F1.6-A5-bitacora.md) (`ae66121` ✅)
7. [Bitácora A4](fase-1/F1.6-A4-bitacora.md) (`6c1cb2c` ✅) · Bitácoras históricas: [A0](fase-1/F1.6-A0-bitacora.md), [A0.5](fase-1/F1.6-A0.5-bitacora.md), [A1](fase-1/F1.6-A1-bitacora.md), [A2](fase-1/F1.6-A2-bitacora.md) y [A3](fase-1/F1.6-A3-bitacora.md)
8. [Hallazgos de Fase 0](fase-0/F0-HALLAZGOS.md)

## Próximo punto de parada

**A0–A6 ✅, Tanda A ✅ completa, B1 ✅ y B2 ✅ cerrada y aprobada formalmente en `fd8dc7e`/`d5a6f8e` (B2.0 `580227a`, B2.1 `114f041`+`c9da41e`, B2.2 `4734403`+`d563055`, B2.3 `5c3e419`+`64421a4`, B2.4 `fd8dc7e`; hook infra `0fc54df`; suite 374/3620 con flake caveat no bloqueante `ProjectStoreRealIdb` 1ms retry verde). B3 🟢 es la única unidad autorizada — exclusivamente repositorio/sync cloud de cierres por proyecto con promoción lazy preservando `id`/`fingerprint`/`supersedesId`, contrato native vs promoted-legacy y sin rediseño de identidad económica; B4–B5 y F1.7 continúan 🔒.** B2 garantiza almacenamiento local de cierres realmente scoped por proyecto: store, consultas, cachés, historial, paginación, búsqueda por período, `getById`, estado de sync y migración aislados obligatoriamente por `projectId`; stamper schema 2→3 reanudable, idempotente y por lotes pequeños; promoción legacy schema 2 por metadata al proyecto predeterminado bajo contrato de migración, sin reescrituras económicas históricas indiscriminadas; resolución B2.4 OFF→new legacy→ON reentry. Quedan fuera préstamos/ajustes/cuotas/`markAsPaid` B4, PDF/JSON/SplitX/recuperación final B5 y F1.7.

## Estructura

| Ruta | Contenido |
|---|---|
| [`roadmap/`](roadmap/ROADMAP.md) | Roadmap, dependencias, ADR y estados de Dirección |
| [`fase-0/`](fase-0/README.md) | Auditoría y preparación de SA |
| [`fase-1/`](fase-1/README.md) | Ejecución, contratos y bitácoras de Fase 1 |
