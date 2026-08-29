# F1.0 — Precondiciones del refactor · Índice de entregables

| Campo | Valor |
|---|---|
| Fase | Fase 1.0 (precondiciones para F1, según decisión de Dirección 2026-08-24/25) |
| Estado | **F0 100%; F1.1–F1.5 cerradas** · F1.6 con arquitectura aprobada · **A0–A5 ✅ cerrados y aprobados por Dirección 2026-08-29** (`6c1cb2c` A4 + `ae66121` A5; A5: 17/17, 56/56, 366/366 · 3542, ALLOW · 0 findings tras fix WARNING `Object.assign`) · **A6 🟡 pendiente de veredicto formal sobre `b286d70` (20/20, 9/9, 368/368 · 3571, ALLOW · 0 findings tras fix de 2 CRITICAL) · B1–B5 🔒 · F1.7 🔒** · DEP-SA-004 cerrado |
| Punto de parada | **A6 🟡 pendiente de veredicto formal sobre `b286d70`** sobre base `792793a` (helper `TandaBGate.js` 27 líneas, 15 archivos +532 líneas; gates Tanda B + matriz A/B) — **B1–B5 🔒 · F1.7 🔒**; no iniciar B hasta aprobación de A6. DEP-SA-004 permanece cerrado. |
| Rama de trabajo | `feature/factor-dias-no-laborables` · commit funcional `b286d70` sobre base `792793a` · commit de referencia `ae66121` (A5) / `6c1cb2c` (A4) · A6 pendiente formal |

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
| **F1.6 Nómina multiproyecto** | [`F1.6-nomina-multiproyecto.md`](F1.6-nomina-multiproyecto.md) | **A0–A5 ✅ cerrados y aprobados 2026-08-29** (`6c1cb2c` A4 + `ae66121` A5; 17/17, 56/56, 366/366 · 3542, ALLOW tras fix WARNING `Object.assign`); **A6 🟡 pendiente de veredicto formal sobre `b286d70` (20/20, 9/9, 368/368 · 3571, ALLOW tras fix de 2 CRITICAL) · B1–B5 🔒** | F1.7 🔒 requiere F1.6-A y F1.6-B aprobadas; **A6 pendiente formal — no iniciar B** |
| **F1.6-A0 Bitácora IDB por proyecto** | [`F1.6-A0-bitacora.md`](F1.6-A0-bitacora.md) | ✅ **Cerrado y aprobado por Dirección 2026-08-26** — bitácora evaluable 3 ciclos RED→GREEN (§2.1), contrato `explicit > default autoritativo > legacy-unresolved:*` (§2.2), verificación §3 (RecordKey 13/13, 12/12, 76 acotados, 354/354 · 3409, ALLOW); frontera rollback `c7a9e0c` | Lectura obligatoria — A0 cerrado |
| **F1.6-A0.5 Bitácora identidad canónica** | [`F1.6-A0.5-bitacora.md`](F1.6-A0.5-bitacora.md) | ✅ **Cerrado y aprobado por Dirección 2026-08-27** — `51a7611` + `50343ee` (20/20, 360/360 · 3485, ALLOW 0 findings; DEP-SA-004 cerrado) | Registro histórico; estado vivo en este índice y en el documento F1.6 |
| **F1.6-A1 Bitácora PayrollProjectContext** | [`F1.6-A1-bitacora.md`](F1.6-A1-bitacora.md) | ✅ **Cerrado y aprobado por Dirección 2026-08-28** — `185e1cd` (10/10, 55/55 · 361/361 · 3495, ALLOW 0 findings) | Registro histórico; A3 ya conecta parte de sus consumidores |
| **F1.6-A2 Bitácora projectPayrollConfigs** | [`F1.6-A2-bitacora.md`](F1.6-A2-bitacora.md) | ✅ **Cerrado y aprobado por Dirección 2026-08-28** — `d5858dc` (7/7, 62/62 · 362/362 · 3502, ALLOW 0 findings) | Registro histórico; A3 ya consume configuración donde está conectado |
| **F1.6-A3 Bitácora cálculo scoped** | [`F1.6-A3-bitacora.md`](F1.6-A3-bitacora.md) | ✅ **Cerrado y aprobado formalmente por Dirección 2026-08-28** — `1bd02b3` (6 archivos, +630/-9; 10/10 nuevos; 27/27 A1+A2+A3, 363/363 · 3512, ALLOW · 0 findings) | Registro histórico; A4 ✅ / A5 ✅ cerrados 2026-08-28/29 |
| **F1.6-A4 Bitácora UI/configuración/preview scoped** | [`F1.6-A4-bitacora.md`](F1.6-A4-bitacora.md) | ✅ **Cerrado y aprobado formalmente por Dirección 2026-08-28** — `6c1cb2c` (12 archivos, +1144/-26; 12/12 nuevos; 49/49, 365/365 · 3525, ALLOW · 0 findings) | Registro histórico; **A5 ✅ cerrado 2026-08-29** |
| **F1.6-A5 H-05 exportConfig (transitorio)** | [`F1.6-A5-bitacora.md`](F1.6-A5-bitacora.md) | ✅ **Cerrado y aprobado formalmente por Dirección 2026-08-29** — `ae66121` (8 archivos, +243/-4; helper 24 líneas; 17/17, 56/56, 366/366 · 3542, ALLOW · 0 findings tras fix de WARNING `Object.assign` vía `Object.assign` shallow copy) — helper `ExportConfigSanitizer` elimina solo `exportConfig`, preserva `payrollDefaults`/`projectPayrollConfigs`; sanea mirror/replace/snapshot + `getSnapshot`/`getFullState` + `PersistenceService` `_mirrorSnapshot` + `DataOps` frozen/`cleanCloud` + `app.js` `applyRemoteData`/`applyBackupData`/`prepareRestoredState`; verifica no resurrección tras sync/restore/snapshot con A→B→A y OFF paridad preservadas | **A5 ✅ cerrado — A6 🟡 pendiente formal (`b286d70`)**; B1–B5 🔒, F1.7 🔒 |
| **F1.6-A6 Gates Tanda B + matriz A/B (cierre de Tanda A)** | [`F1.6-A6-bitacora.md`](F1.6-A6-bitacora.md) | 🟡 **Pendiente de veredicto formal sobre `b286d70` (15 archivos, +532 líneas; helper `TandaBGate.js` 27 líneas, `ProjectScopedGateError`/`assertTandaBBlockedWhenScoped`; gates en 10 archivos antes de mutación; 20/20 TandaBGates + 9/9 matriz A/B; 46/46 y 85/85; 368/368 · 3571, ALLOW · 0 findings tras fix de 2 CRITICAL `addDesktopAdjustment`/`removeScheduledAdjustment`/`setScheduledAdjustmentPaused`; OFF paridad exacta; `buildAttendanceIndex` RAW)** | **A6 pendiente formal — no iniciar B1–B5 ni F1.7** |
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
- **A5 evidencia** → 17/17 (6 helper + 11 wiring), 56/56 agrupada, 366/366 · 3542, ALLOW · 0 findings tras corrección de WARNING (live-reference mutation → `Object.assign`); **A6 🟡 pendiente formal**
- **A6 gates Tanda B + matriz A/B (🟡 pendiente formal 2026-08-29 `b286d70`)** → [`F1.6-A6-bitacora.md`](F1.6-A6-bitacora.md) — `b286d70` sobre `792793a` (15 archivos +532 líneas; `TandaBGate.js` 27 líneas; gates en 10 archivos antes de mutación; 2 CRITICAL UI bypasses corregidos pre-commit; 20/20 TandaBGates + 9/9 matriz A/B; 46/46 y 85/85; 368/368 · 3571, ALLOW · 0 findings tras fix; OFF paridad exacta; `buildAttendanceIndex` RAW) — **pendiente de veredicto formal, no autoriza B1–B5**

## Contrato A4 — ✅ Cerrado y aprobado formalmente por Dirección 2026-08-28 · A5 ✅ cerrado 2026-08-29 · A6 🟡 pendiente formal `b286d70`

> A4 fue ejecutado exactamente en el orden congelado siguiente y quedó **cerrado y aprobado formalmente por Dirección 2026-08-28** sobre `6c1cb2c` (12/12, 49/49, 365/365 · 3525, ALLOW · 0 findings). A4 ✅ y A5 ✅ forman la base para **A6 🟡 pendiente de veredicto formal sobre `b286d70` (cierre de Tanda A)**.

1. Con flag ON, UI de configuración y preview usan el `projectId` capturado y `projectPayrollConfigs` vía `ProjectPayrollUIRuntime`.
2. Los callers productivos de período del preview usan `config.payPeriod` scoped.
3. A→B invalida selección temporal, preview, período y caché de sesión; B→A reconstruye A.
4. Una preview async iniciada en A permanece en A mientras una preview nueva usa B.
5. Con flag OFF, la UI legacy permanece byte-idéntica.
6. No se habilitan cierres, préstamos, ajustes persistidos, historial ni exportación final.
7. No se trabaja H-05 completo ni se amplía la persistencia de `exportConfig`.
8. Tests + fresh review completados sobre `6c1cb2c` (49/49, 365/365 · 3525, ALLOW · 0 findings); **A4 ✅ cerrado y aprobado — A5 ✅ cerrado 2026-08-29 — A6 🟢 autorizado**.

Evidencia A4: `6c1cb2c` (12 archivos, +1144/-26; 12/12 nuevos, 49/49, 365/365 · 3525, ALLOW · 0 findings) — **✅ cerrado y aprobado 2026-08-28**. A5: `ae66121` (17/17, 56/56, 366/366 · 3542, ALLOW · 0 findings tras fix `Object.assign`) — **✅ cerrado y aprobado 2026-08-29**. A6: `b286d70` (15 archivos, +532 líneas; 20/20 + 9/9, 46/46, 85/85, 368/368 · 3571, ALLOW · 0 findings tras fix de 2 CRITICAL) — **🟡 pendiente de veredicto formal sobre `b286d70`**. El cierre formal de A3 (`1bd02b3`) se basa en bitácora local, evidencia reportada y revisión. DEP-SA-004 cerrado.

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

1. Leer roadmap §12–§16, este índice, [`F1.6-nomina-multiproyecto.md`](F1.6-nomina-multiproyecto.md) y las bitácoras evaluables A0–A6, especialmente [`F1.6-A6-bitacora.md`](F1.6-A6-bitacora.md) como **🟡 pendiente formal sobre `b286d70`** y [`F1.6-A5-bitacora.md`](F1.6-A5-bitacora.md) como cierre formal A5 ✅.
2. Estado exacto: **A0–A5 ✅ cerrados y aprobados por Dirección 2026-08-29 (A4 `6c1cb2c` + A5 `ae66121`; A5: 17/17, 56/56, 366/366 · 3542, ALLOW · 0 findings tras fix WARNING `Object.assign`) · A6 🟡 pendiente de veredicto formal sobre `b286d70` (20/20, 9/9, 368/368 · 3571, ALLOW tras fix de 2 CRITICAL) · B1–B5 🔒 · F1.7 🔒**. DEP-SA-004 cerrado.
3. Próxima acción: **A6 🟡 pendiente de veredicto formal sobre `b286d70`** — gates Tanda B ya implementados (helper `TandaBGate.js` 27 líneas, 10 archivos gateados antes de mutación, 2 CRITICAL UI bypasses corregidos) + matriz consolidada A/B de toda Tanda A. **Solicitar veredicto formal de Dirección y detenerse antes de B1.** No implementar `PayrollClosure` schema3, persistencia económica por proyecto, migración de cierres, economic cloud, préstamos project-aware, PDF/SplitX. No tocar `PayrollClosure`/closures/loans/economic adjustments/PDF/SplitX/economic cloud/petty cash fuera de A6/B. **B1–B5 🔒 y F1.7 🔒**. Ver [`F1.6-A6-bitacora.md`](F1.6-A6-bitacora.md) §5/§8 y `F1.6-nomina-multiproyecto.md` §5 + Roadmap §7/§15.
