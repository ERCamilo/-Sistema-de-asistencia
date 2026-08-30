# Registro vivo de Dirección

> **Política de rama:** `project-docs` es el registro interno de Dirección y nunca se integra a `main`. Las bitácoras deben apuntar a SHAs funcionales verificables en remoto; código y documentación deben estar publicados antes de una revisión. Veredictos, roadmap, ADR, dependencias y estados viven solamente en esta rama. Una bitácora no sustituye la inspección del código funcional.

## Estado actual

| Unidad | Estado |
|---|---|
| A0-A6 | ✅ Cerradas y aprobadas por Dirección; Tanda A completa |
| B1 | 🟡 Publicada en `193273e` bajo `EXC-REVIEW-B1-001`; aprobación formal de Dirección pendiente |
| B2-B5 | 🔒 Bloqueadas |
| F1.7 | 🔒 Bloqueada |

| Referencia funcional | Valor |
|---|---|
| Rama | `feature/factor-dias-no-laborables` |
| SHA funcional remoto actual | `193273e804b1f21aca46939bfc2ad631282e4c15` (`193273e`) sobre base A6/MC1 `f735dd6f3a4bda67688a76bb6cb11ee47e32833f`; remoto verificado exactamente |
| Alcance acreditado | A0–A6 ✅; Tanda A ✅ completa; B1 🟡 publicada bajo `EXC-REVIEW-B1-001`, pendiente de aprobación formal |
| B1 funcional | Schema 3 ON con `projectId` obligatorio y semánticamente inmutable; fingerprint/ID project-aware; correcciones deterministas y void owner-preserving. OFF conserva schema 2 exacto sin `projectId` ni dual-write. |
| Evidencia final | B1 **41/41** · agrupada A6/B1 **129/129** · full **3586/3586** · `R3-001` corregido; estado técnico final aprobado |
| Commit documental A6/MC1 publicado | `c5b2f686b3ca8c149752a9bfe6927d54a28a6380` (`c5b2f686`) en `project-docs` |

## Lectura viva

1. [Roadmap de Dirección](roadmap/ROADMAP.md)
2. [Índice de Fase 1](fase-1/README.md)
3. [Contrato vivo F1.6](fase-1/F1.6-nomina-multiproyecto.md)
4. [Bitácora B1 — publicación bajo excepción](fase-1/F1.6-B1-bitacora.md) (`193273e` 🟡) · [Incidente `EXC-REVIEW-B1-001`](revisiones/B1-review-infrastructure-block.md)
5. [Bitácora A6 — MC1 resuelto y cierre formal](fase-1/F1.6-A6-bitacora.md) (`b286d70` + `f735dd6` ✅)
6. [Bitácora A5](fase-1/F1.6-A5-bitacora.md) (`ae66121` ✅)
7. [Bitácora A4](fase-1/F1.6-A4-bitacora.md) (`6c1cb2c` ✅) · Bitácoras históricas: [A0](fase-1/F1.6-A0-bitacora.md), [A0.5](fase-1/F1.6-A0.5-bitacora.md), [A1](fase-1/F1.6-A1-bitacora.md), [A2](fase-1/F1.6-A2-bitacora.md) y [A3](fase-1/F1.6-A3-bitacora.md)
8. [Hallazgos de Fase 0](fase-0/F0-HALLAZGOS.md)

## Próximo punto de parada

**A0–A6 ✅ y Tanda A ✅ completa. B1 🟡 está publicada en `193273e` bajo `EXC-REVIEW-B1-001` y espera aprobación formal de Dirección. B2–B5 y F1.7 continúan 🔒.** No iniciar stores, migración, consultas, índices, cachés, historial, cloud, préstamos, ajustes, exportación ni recuperación. Punto de parada: revisión remota de Dirección; **no autorizar B2**.

## Estructura

| Ruta | Contenido |
|---|---|
| [`roadmap/`](roadmap/ROADMAP.md) | Roadmap, dependencias, ADR y estados de Dirección |
| [`fase-0/`](fase-0/README.md) | Auditoría y preparación de SA |
| [`fase-1/`](fase-1/README.md) | Ejecución, contratos y bitácoras de Fase 1 |
