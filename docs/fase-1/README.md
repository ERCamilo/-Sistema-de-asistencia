# F1.0 — Precondiciones del refactor · Índice de entregables

| Campo | Valor |
|---|---|
| Fase | Fase 1.0 (precondiciones para F1, según decisión de Dirección 2026-08-24/25) |
| Estado | **F0 100%; F1.1–F1.5 cerradas** · arquitectura F1.6 aprobada con modificación · A0 técnicamente validado en `c7a9e0c`, pendiente de revisión formal de Dirección · A0.5 no iniciado · A1–A6 y F1.7 bloqueadas |
| Punto de parada | F1.5: **354/354 suites · 3401 tests · 0 fallos**. Post-A0: **354/354 suites · 3409 tests · 0 fallos**; la evidencia técnica de A0 espera revisión formal |
| Rama de trabajo | `fase-0-auditoria` (apilada sobre main; incluye también trabajo paralelo del dueño del repo) |

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
| **F1.6 Nómina multiproyecto** | [`F1.6-nomina-multiproyecto.md`](F1.6-nomina-multiproyecto.md) | Arquitectura aprobada con modificación; A0 técnicamente validado (`c7a9e0c`, 354/354 suites · 3409 tests), pendiente revisión formal; A0.5 es la próxima puerta y A1–A6 están bloqueadas | F1.7 bloqueada hasta revisión/cierre F1.6 |
| **F1.6-A0 Bitácora IDB por proyecto** | [`F1.6-A0-bitacora.md`](F1.6-A0-bitacora.md) | ✅ Bitácora evaluable — 3 ciclos RED→GREEN, contrato final `legacy-unresolved:*` y frontera de rollback; validación `c7a9e0c` / 354/354 · 3409 | Lectura obligatoria antes de A0.5 |
| **F1.7 Caja chica multiproyecto** | Roadmap §7 | **BLOQUEADA** | Requiere F1.6 revisada y aprobada |

Orden de trabajo completa: [`F1.0-precondiciones.md`](F1.0-precondiciones.md)

## Registros cruzados

- Hallazgo **H-01 RESUELTO** → [`../fase-0/F0-HALLAZGOS.md`](../fase-0/F0-HALLAZGOS.md) (tabla de resueltos)
- **DEP-SA-001** registrada en roadmap §12
- ADRs **008–011** implementados/documentados para etapas previas; decisiones F1.6 **012–016** registradas en roadmap §13
- Dependencias F1.6 **DEP-SA-002/004** registradas en roadmap §12; DEP-SA-003 conserva la política de pagos pendiente de B4
- **A0 bitácora evaluable** → [`F1.6-A0-bitacora.md`](F1.6-A0-bitacora.md) — deduplicación IDB por proyecto, 3 ciclos RED→GREEN y contrato `legacy-unresolved:*`

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

1. Leer roadmap §12–§16, este índice, [`F1.6-nomina-multiproyecto.md`](F1.6-nomina-multiproyecto.md) y la bitácora evaluable [`F1.6-A0-bitacora.md`](F1.6-A0-bitacora.md).
2. Estado: F0 al 100%; F1.1–F1.5 cerradas; **F1.6 con arquitectura aprobada y A0 técnicamente validado**, pendiente de revisión formal; no hay comportamiento funcional de nómina aceptado.
3. Próxima acción: Dirección debe revisar la evidencia A0; después, iniciar únicamente A0.5. No iniciar A1–A6 ni F1.7 antes de validar A0.5.
