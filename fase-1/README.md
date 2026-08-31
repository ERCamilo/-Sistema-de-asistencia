# F1.0 — Precondiciones del refactor · Índice de entregables

| Campo | Valor |
|---|---|
| Fase | Fase 1.0 (precondiciones para F1, según decisión de Dirección 2026-08-24/25) |
| Estado | **F0 100%; F1.1–F1.5 cerradas; A0–A6 ✅ aprobados y Tanda A ✅ completa** · **B1 ✅ cerrada y aprobada · B2 ✅ cerrada y aprobada formalmente (B2.0 `580227a`, B2.1 `114f041`+`c9da41e`, B2.2 `4734403`+`d563055`, B2.3 `5c3e419`+`64421a4`, B2.4 `fd8dc7e`/`d5a6f8e`) · B3 🟢 autorizada exclusivamente para cloud/sync por proyecto · B4–B5 🔒 · F1.7 🔒** |
| Punto de parada | **A0–A6 ✅ · Tanda A ✅ · B1 ✅ · B2 ✅ cerrada y aprobada · B3 🟢 exclusiva para cloud/sync cierres** — ejecutar únicamente B3 dentro de su alcance cloud/sync por proyecto con promoción lazy; **B4–B5 y F1.7 permanecen bloqueadas.** |
| Rama de trabajo | `feature/factor-dias-no-laborables` · SHA funcional remoto `d5a6f8e6aa53a9ce318781bcc82eabb2763b12f0` (`d5a6f8e`) tras B2.4 `fd8dc7e` (hook infra `0fc54df`; B2.0–B2.4) sobre base `193273e`/`f735dd6`; publicación verificada exactamente |

## Pasos

| Paso | Entregable | Estado | ¿Bloquea? |
|---|---|---|---|
| F1.0.1 IDB real en tests | [`F1.0.1-idb-real.md`](F1.0.1-idb-real.md) | ✅ Completado | Sí (todo F1) |
| F1.0.2 Verificar/corregir H-01 | [`F1.0.2-h01-tombstone.md`](F1.0.2-h01-tombstone.md) | ✅ CONFIRMADO y CORREGIDO | Sí (F1.4 empleados) |
| F1.0.3 Asistencia multiproyecto | [§P3 en orden F1.0](F1.0-precondiciones.md#p3--asistencia-multiproyecto-f103) | Propuesta lista | Sí (F1.5) |
| F1.0.4 Espejo `data/current` | [§P4](F1.0-precondiciones.md#p4--espejo-datacurrent-f104) | Propuesta lista | Sí (sync) |
| F1.0.5 Fechas reales Project | [§P5](F1.0-precondiciones.md#p5--fechas-reales-del-proyecto-f105) | Propuesta lista | Antes de congelar Project v1 |
| F1.0.6 Clonación de empleado | [§P6](F1.0-precondiciones.md#p6--significado-exacto-de-copiar-empleado-f106) | Propuesta lista | Antes de F2.7 |
| F1.0.7 Mapping caja↔proyecto | [§P7](F1.0-precondiciones.md#p7--mapping-project-oficial--pettycashproject-f107-dep-sa-001) | Propuesta lista (DEP-SA-001) | Implementación antes de F2.8 |
| **F1.1 ProjectRepository** | [`F1.1-project-repository.md`](F1.1-project-repository.md) | ✅ Ejecutado + revisado | — |
| **F1.2 Proyecto predeterminado** | [`F1.2-default-project.md`](F1.2-default-project.md) | ✅ Ejecutado + revisado (wiring deferido) | Wiring+flag antes de criterio completo |
| **F1.3 ProjectContext** | [`F1.3-project-context.md`](F1.3-project-context.md) | ✅ Ejecutado + revisado | — |
| **Cierre pre-F1.4** | [`F1-preF14-cierre.md`](F1-preF14-cierre.md) | ✅ Ejecutado (S3–S5 + wiring + invariantes AppState + upgrade real) | Puerta para F1.4 |
| **F1.4 Empleados/puestos/líderes** | [`F1.4-empleados-puestos-lideres.md`](F1.4-empleados-puestos-lideres.md) | ✅ Ejecutado (2 tandas + migración M2 + batería A/B) | ✅ CERRADA |
| **F1.5 Asistencia multiproyecto** | [`F1.5-asistencia-multiproyecto.md`](F1.5-asistencia-multiproyecto.md) | ✅ Cerrada y aprobada por Dirección (incluye micro-cierre) · 354/354 suites, 3401 tests | ✅ CERRADA |
| **F1.6 Nómina multiproyecto** | [`F1.6-nomina-multiproyecto.md`](F1.6-nomina-multiproyecto.md) | **A0–A6 ✅; Tanda A ✅ completa; B1 ✅; B2 ✅ cerrada y aprobada formalmente (B2.0 `580227a`, B2.1 `114f041`+`c9da41e`, B2.2 `4734403`+`d563055`, B2.3 `5c3e419`+`64421a4`, B2.4 `fd8dc7e`/`d5a6f8e`, suite 374/3620 con flake caveat `ProjectStoreRealIdb` 1ms retry verde); B3 🟢 cloud/sync cierres; B4–B5 🔒** | F1.7 🔒; ejecutar solo B3 |
| **F1.6-A0 Bitácora IDB por proyecto** | [`F1.6-A0-bitacora.md`](F1.6-A0-bitacora.md) | ✅ **Cerrado y aprobado por Dirección 2026-08-26** — bitácora evaluable 3 ciclos RED→GREEN (§2.1), contrato `explicit > default autoritativo > legacy-unresolved:*` (§2.2), verificación §3 (RecordKey 13/13, 12/12, 76 acotados, 354/354 · 3409, ALLOW); frontera rollback `c7a9e0c` | Lectura obligatoria — A0 cerrado |
| **F1.6-A0.5 Bitácora identidad canónica** | [`F1.6-A0.5-bitacora.md`](F1.6-A0.5-bitacora.md) | ✅ **Cerrado y aprobado por Dirección 2026-08-27** — `51a7611` + `50343ee` (20/20, 360/360 · 3485, ALLOW 0 findings; DEP-SA-004 cerrado) | Registro histórico; estado vivo en este índice y en el documento F1.6 |
| **F1.6-A1 Bitácora PayrollProjectContext** | [`F1.6-A1-bitacora.md`](F1.6-A1-bitacora.md) | ✅ **Cerrado y aprobado por Dirección 2026-08-28** — `185e1cd` (10/10, 55/55 · 361/361 · 3495, ALLOW 0 findings) | Registro histórico; A3 ya conecta parte de sus consumidores |
| **F1.6-A2 Bitácora projectPayrollConfigs** | [`F1.6-A2-bitacora.md`](F1.6-A2-bitacora.md) | ✅ **Cerrado y aprobado por Dirección 2026-08-28** — `d5858dc` (7/7, 62/62 · 362/362 · 3502, ALLOW 0 findings) | Registro histórico; A3 ya consume configuración donde está conectado |
| **F1.6-A3 Bitácora cálculo scoped** | [`F1.6-A3-bitacora.md`](F1.6-A3-bitacora.md) | ✅ **Cerrado y aprobado formalmente por Dirección 2026-08-28** — `1bd02b3` (6 archivos, +630/-9; 10/10 nuevos; 27/27 A1+A2+A3, 363/363 · 3512, ALLOW · 0 findings) | Registro histórico; A4 ✅ / A5 ✅ cerrados 2026-08-28/29 |
| **F1.6-A4 Bitácora UI/configuración/preview scoped** | [`F1.6-A4-bitacora.md`](F1.6-A4-bitacora.md) | ✅ **Cerrado y aprobado formalmente por Dirección 2026-08-28** — `6c1cb2c` (12 archivos, +1144/-26; 12/12 nuevos; 49/49, 365/365 · 3525, ALLOW · 0 findings) | Registro histórico; **A5 ✅ cerrado 2026-08-29** |
| **F1.6-A5 H-05 exportConfig (transitorio)** | [`F1.6-A5-bitacora.md`](F1.6-A5-bitacora.md) | ✅ **Cerrado y aprobado formalmente por Dirección 2026-08-29** — `ae66121` (8 archivos, +243/-4; helper 24 líneas; 17/17, 56/56, 366/366 · 3542, ALLOW · 0 findings tras fix de WARNING `Object.assign` vía `Object.assign` shallow copy) — helper `ExportConfigSanitizer` elimina solo `exportConfig`, preserva `payrollDefaults`/`projectPayrollConfigs`; sanea mirror/replace/snapshot + `getSnapshot`/`getFullState` + `PersistenceService` `_mirrorSnapshot` + `DataOps` frozen/`cleanCloud` + `app.js` `applyRemoteData`/`applyBackupData`/`prepareRestoredState`; verifica no resurrección tras sync/restore/snapshot con A→B→A y OFF paridad preservadas | Registro histórico; A6 y B1 ✅; B2 ✅; B3 🟢; B4–B5/F1.7 🔒 |
| **F1.6-A6 Gates Tanda B + matriz A/B (cierre de Tanda A)** | [`F1.6-A6-bitacora.md`](F1.6-A6-bitacora.md) | ✅ **Cerrado y aprobado formalmente.** `b286d70` principal + MC1 `f735dd6`: Dirección encontró `getById`/`getSyncStates` ungated; MC1 añadió 2 gates, 4 tests y auditoría de los 8 métodos públicos. **24/24 + 9/9; 62/62; 368/368 · 3575; ALLOW 0 findings.** | Registro histórico; B1 ✅ y B2 ✅ |
| **F1.6-B1 PayrollClosure schema 3 project-aware** | [`F1.6-B1-bitacora.md`](F1.6-B1-bitacora.md) | ✅ **Cerrada y aprobada formalmente en `193273e`.** 41/41, 129/129, 3586/3586; `R3-001` corregido; remoto verificado; excepción limitada a la publicación B1. | B2 ✅; B3 🟢; B4–B5/F1.7 🔒 |
| **F1.6-B2 Persistencia local project-scoped** | [`F1.6-B2-bitacora.md`](F1.6-B2-bitacora.md) | ✅ **Cerrada y aprobada formalmente — B2.0 `580227a`, B2.1 `114f041`+MC1 `c9da41e`, B2.2 `4734403`+MC1 `d563055`, B2.3 `5c3e419`+MC1 `64421a4`, B2.4/cierre `fd8dc7e`/`d5a6f8e`, hook infra `0fc54df`; suite 374/3620 con flake caveat `ProjectStoreRealIdb` 1ms retry verde; B2.4 OFF→new legacy→ON reentry resuelto.** Store, consultas, cachés, historial, paginación, período, `getById`, sync state y migración aislados por `projectId`; stamper schema 2→3 reanudable/idempotente en lotes pequeños; promoción legacy metadata-only al default. | B3 🟢 exclusiva cloud/sync cierres; B4–B5/F1.7 🔒 |
| **F1.7 Caja chica multiproyecto** | Roadmap §7 | **BLOQUEADA** | Requiere F1.6 revisada y aprobada |

Orden de trabajo completa: [`F1.0-precondiciones.md`](F1.0-precondiciones.md)

## Registros cruzados

- Hallazgo **H-01 RESUELTO** → [`../fase-0/F0-HALLAZGOS.md`](../fase-0/F0-HALLAZGOS.md) (tabla de resueltos)
- **DEP-SA-001** registrada en roadmap §12
- ADRs **008–011** implementados/documentados para etapas previas; decisiones F1.6 **012–016** registradas en roadmap §13
- Dependencias F1.6 **DEP-SA-002/004** registradas en roadmap §12; DEP-SA-003 conserva la política de pagos pendiente de B4
- **A0 bitácora evaluable** → [`F1.6-A0-bitacora.md`](F1.6-A0-bitacora.md) — deduplicación IDB por proyecto, 3 ciclos RED→GREEN y contrato `legacy-unresolved:*`
- **A0.5 bitácora evaluable** → [`F1.6-A0.5-bitacora.md`](F1.6-A0.5-bitacora.md) — identidad canónica cross-device, registro/promoción/adopción SA-only, 20 tests (15+3-device + 2 micro-cierre MC1/MC2) y 2 WARNINGS ✅ resueltos en `50343ee` (ALLOW 0 findings)
- **A1 bitácora evaluable** → [`F1.6-A1-bitacora.md`](F1.6-A1-bitacora.md) — frontera única `PayrollProjectContext`, captura antes de `await`, OFF paridad exacta, freeze, `#12` por `employeeId`, attendance snapshot, 10/10 + 55/55 · 361/361 · 3495, ALLOW 0 findings, sin wiring, `buildAttendanceIndex` intacto
- **A2 bitácora evaluable** → [`F1.6-A2-bitacora.md`](F1.6-A2-bitacora.md) — store versionado `projectPayrollConfigs` por `projectId`, 10 campos, semilla atómica idempotente, flag OFF sin dual-write, A/B isolation, reload, canónico vs active, local-only sin cloud/wiring, 7/7 + 62/62 agrupada · 362/362 · 3502, ALLOW 0 findings, **✅ Cerrado y aprobado por Dirección 2026-08-28**
- **A3 bitácora evaluable** → [`F1.6-A3-bitacora.md`](F1.6-A3-bitacora.md) — cálculo scoped en `PayrollService`, helpers contextuales en `PayrollPeriod`, snapshot con congelamiento de primer nivel, fail-closed, OFF síncrono, 10 tests nuevos; **✅ cerrado y aprobado formalmente: 27/27 · 363/363 · 3512 · ALLOW 0 findings**
- **A4 bitácora evaluable** → [`F1.6-A4-bitacora.md`](F1.6-A4-bitacora.md) — UI de configuración y preview scoped con `ProjectPayrollUIRuntime` + `ProjectPayrollConfigStore`, `config.payPeriod` productivo, invalidación sincrónica A→B y rebuild B→A, stale preview guard, OFF byte-idéntico, 12 tests nuevos; **✅ Cerrado y aprobado formalmente por Dirección 2026-08-28: 49/49 · 365/365 · 3525 · ALLOW 0 findings**
- **A5 H-05 (✅ cerrado y aprobado formalmente 2026-08-29)** → [`F1.6-A5-bitacora.md`](F1.6-A5-bitacora.md) — `ae66121` (8 archivos, +243/-4; helper 24 líneas; 17/17, 56/56, 366/366 · 3542, ALLOW · 0 findings tras fix `Object.assign` vía `Object.assign` shallow copy) — `exportConfig` transitorio saneado simétricamente en ALL frontiers (mirror/data/current, cloud replace, snapshots, DataOps local→cloud, restores/legacy ingresses); verifica no resurrección tras sync/restore/snapshot load; no borra `payrollDefaults`/`projectPayrollConfigs`; preserva A→B→A y OFF paridad; no toca PayrollClosure/closures/loans/economic adjustments/PDF/SplitX/economic cloud/petty cash
- **A5 evidencia** → 17/17 (6 helper + 11 wiring), 56/56 agrupada, 366/366 · 3542, ALLOW · 0 findings tras corrección de WARNING (live-reference mutation → `Object.assign`); **A6 ✅ aprobada**
- **A6 + MC1 (✅ cierre formal)** → [`F1.6-A6-bitacora.md`](F1.6-A6-bitacora.md) — rango `792793a..f735dd6`; `b286d70` principal y `f735dd6` cierra las lecturas directas `getById`/`getSyncStates`. Evidencia final 24/24 + 9/9, 62/62, 368/368 · 3575, MC1 ALLOW 0 findings; **habilitó entonces B1**.
- **B1 (✅ cerrada y aprobada formalmente)** → [`F1.6-B1-bitacora.md`](F1.6-B1-bitacora.md) — `193273e` sobre `f735dd6`, schema 3 ON project-aware y schema 2 OFF exacto; 41/41, 129/129, 3586/3586; `EXC-REVIEW-B1-001` fue aceptada solo para su publicación y **no se traslada a B2**. El veredicto formal posterior habilita B2 por separado.
- **B2 (✅ cerrada y aprobada formalmente)** → [`F1.6-B2-bitacora.md`](F1.6-B2-bitacora.md) — `580227a` (B2.0), `114f041`+`c9da41e` (B2.1+MC1), `4734403`+`d563055` (B2.2+MC1), `5c3e419`+`64421a4` (B2.3+MC1), `fd8dc7e`/`d5a6f8e` (B2.4/cierre) con hook infra `0fc54df`; 374/3620 con flake caveat `ProjectStoreRealIdb` 1ms retry verde no modificado por B2.4; resolución OFF→new legacy→ON reentry. B3 🟢 exclusiva cloud/sync cierres.

## Contrato A4 — ✅ Cerrado y aprobado formalmente por Dirección 2026-08-28 · A5 ✅ cerrado 2026-08-29 · A6 ✅ cerrado `b286d70` + `f735dd6`

> A4 fue ejecutado exactamente en el orden congelado siguiente y quedó **cerrado y aprobado formalmente por Dirección 2026-08-28** sobre `6c1cb2c`. A4 ✅ y A5 ✅ forman la base de **A6 ✅ `b286d70` + MC1 `f735dd6`, cerrada y aprobada formalmente**.

1. Con flag ON, UI de configuración y preview usan el `projectId` capturado y `projectPayrollConfigs` vía `ProjectPayrollUIRuntime`.
2. Los callers productivos de período del preview usan `config.payPeriod` scoped.
3. A→B invalida selección temporal, preview, período y caché de sesión; B→A reconstruye A.
4. Una preview async iniciada en A permanece en A mientras una preview nueva usa B.
5. Con flag OFF, la UI legacy permanece byte-idéntica.
6. No se habilitan cierres, préstamos, ajustes persistidos, historial ni exportación final.
7. No se trabaja H-05 completo ni se amplía la persistencia de `exportConfig`.
8. Tests + fresh review completados sobre `6c1cb2c` (49/49, 365/365 · 3525, ALLOW · 0 findings); registro histórico: A4 habilitó A5 y A5 habilitó ejecutar A6. A6 quedó aprobada tras MC1.

Evidencia A4: `6c1cb2c` ✅. A5: `ae66121` ✅. A6: `b286d70` + MC1 `f735dd6` (24/24 + 9/9, 62/62, 368/368 · 3575, MC1 ALLOW 0 findings) — **✅ cerrada y aprobada formalmente**. DEP-SA-004 cerrado.

## Commits de esta etapa

| SHA | Contenido |
|---|---|
| `a9be8ac` | Infraestructura de tests IDB real + 2 suites runtime |
| `6979829` | Fix H-01 (Employee.js) + test de protección |
| `e69febe` | Orden F1.0 + roadmap v0.2 (ADRs/DEP/estados) |
| `1e4c706` | Registro de resolución H-01 en hallazgos |

### Commits del bloque F1.1–F1.3

| SHA | Contenido |
|---|---|
| `fffdf9c` | Modelo Project + store local + IDB v17 (F1.1) |
| `aae38be` | Default project bootstrap + ProjectContext (F1.2/F1.3) |
| `d99df63` | Cierre documental F1.0 según veredictos de Dirección |

## 🔍 Segunda vuelta independiente (2026-08-25)

Revisión fresh-context (lente confiabilidad) sobre `fffdf9c`+`aae38be`, más ejecución independiente de la suite por el orquestador.

| Verificación | Resultado |
|---|---|
| Modelo vs spec F0.3 §1-§2 (+P5 fechas) | ✅ PASS — transiciones 1:1, 8 casos inválidos fijados |
| Serialización byte-estable (hasOwnProperty) | ✅ PASS |
| Bump v16→v17 puramente aditivo (sin ruta de pérdida) | ✅ PASS |
| Cero acoplamiento a dominios operativos; flag OFF intacto | ✅ PASS (bloque imports de app.js inspeccionado completo) |
| Sitio TODO boot-wiring (~app.js:7047) | ✅ VERIFICADO exacto |
| Calidad de tests (reinicio/recuperación/idempotencia) | ✅ reales, no tautológicos |
| Ejecución independiente | ✅ **345/345 suites · 3307 tests · 0 fallos** (107s) |

**Hallazgos — ninguno alcanza hoy (flag OFF + wiring deferido):**

| ID | Sev. | Hallazgo | Disposición recomendada |
|---|---|---|---|
| W1 | 🟡→✅ | Pointer-HIT de `ensureDefaultProject()` no valida status → un default cerrado/archivado entregaría id no-activo desde el contexto | **RESUELTO**: dangling = inexistente O status≠active; contrato único con recovery (usa `PROJECT_STATUS.ACTIVE`) |
| W2 | 🟡→✅ | Carrera cross-tab crearía "Mi obra" duplicada si dos pestañas ven puntero ausente (CrossTabLock existe, no se usa aquí) | **RESUELTO**: lease `default-project-init` envolviendo el cuerpo completo + promesa en vuelo compartida intra-pestaña (el lease IDB re-admite al mismo dueño al instante — hallazgo clave) |
| S3 | 🔵→✅ | Constructor aceptaba closed/archived sin exigir closedAt/archivedAt | **RESUELTO** en cierre pre-F1.4: `assertStatusTimestamps()` con errores descriptivos |
| S4 | 🔵→✅ | JSDoc "nunca rechaza" vs comportamiento real de getActiveProjectId | **RESUELTO**: contrato verdadero documentado |
| S5 | 🔵→✅ | metadata retenida por referencia (mutación del caller filtra a payloads) | **RESUELTO**: `cloneMetadata()` en frontera de entrada |

**Backlog de tests sugeridos:** concurrencia de ensure(); pointer→default cerrado/archivado; apertura v16 real→upgrade v17 con registros preexistentes; toggle flag ON→OFF→ON en sesión; desempate listAll con createdAt igual.

**Veredicto del revisor:** base SEGURA para F1.4+. Cierre completado: W1/W2 corregidos, S3–S5 resueltos, wiring conectado tras flag, e invariantes de `AppState.js` validados 4/4 con tests concretos (ver [`F1-preF14-cierre.md`](F1-preF14-cierre.md)).

## Contrato histórico de F1.5 (cerrado y aprobado)

**Criterio fundamental (ADR-008):**
> Guardar, editar, borrar, sincronizar o podar asistencia del Proyecto A NUNCA puede alterar la asistencia del Proyecto B aunque ambos compartan la misma fecha y el mismo documento Firestore diario.

Cadena a revisar completa: creación → IDB → carga por rango → UI → merge → tombstones → limpieza/retención → outbox → documento diario Firestore → descarga/reconciliación.

| Caso | Resultado exigido |
|---|---|
| A y B tienen asistencia el mismo día | Ambos sobreviven en el mismo documento cloud |
| Se modifica A | B permanece byte-equivalente |
| Se borra un registro de A | Ninguno de B desaparece |
| Registro legacy sin `projectId` | Pertenece al Proyecto Predeterminado |
| Cambio A→B→A | Cada vista recupera solo su asistencia |
| Sync entrante de B mientras A está activo | Se guarda como B, no se reetiqueta A |
| Retención/podador | Nunca elimina datos vivos de otro proyecto |
| Tombstone | Conserva `employeeId`, fecha y proyecto correctos |
| Flag OFF | Comportamiento anterior intacto |

Restricciones: F1.5 NO arregla nómina (dependencia documentada para F1.6); flag sigue experimental/apagado por defecto. Pruebas concurrentes adicionales aprobadas en P3: eliminar/modificar empleado de A en una fecha no altera B; ciclo A→B→A con recarga.

## Contexto para cualquier agente futuro

El trabajo paralelo del dueño vive en **worktrees separados** (ver `git worktree list`: onboarding-v2, employee-photos-preview, attendance-retention, etc.) y llega a esta rama vía sus propios commits de features. Los cambios históricamente sospechosos en `AppState.js` resultaron ser commits de features del dueño; los 4 invariantes de serialización/persistencia fueron validados CON TESTS contra el código actual ([`F1-preF14-cierre.md`](F1-preF14-cierre.md) §1). Ante trabajo paralelo futuro: NO tocarlo, reportarlo y validar invariantes si afecta capas de datos.

## Cómo retomar

1. Leer roadmap §12–§16, este índice, [`F1.6-nomina-multiproyecto.md`](F1.6-nomina-multiproyecto.md), [`F1.6-B2-bitacora.md`](F1.6-B2-bitacora.md) y el registro de [`EXC-REVIEW-B1-001`](../revisiones/B1-review-infrastructure-block.md).
2. Estado exacto: **A0–A6 ✅; Tanda A ✅ completa; B1 ✅; B2 ✅ cerrada y aprobada formalmente en `fd8dc7e`/`d5a6f8e` (B2.0 `580227a`, B2.1 `114f041`+`c9da41e`, B2.2 `4734403`+`d563055`, B2.3 `5c3e419`+`64421a4`, B2.4 `fd8dc7e`; suite 374/3620 con flake `ProjectStoreRealIdb` 1ms retry verde); B3 🟢 exclusiva para cloud/sync cierres; B4–B5 🔒; F1.7 🔒.**
3. Próxima acción: implementar solo B3 bajo protocolo Gentle AI ordinario dentro de repositorio/sync cloud de cierres con promoción lazy preservando `id`/`fingerprint`/`supersedesId` (native vs promoted-legacy) y sin rediseño de identidad económica. Si reaparece un defecto de infraestructura, detenerse y reportarlo; no reutilizar `EXC-REVIEW-B1-001`.
