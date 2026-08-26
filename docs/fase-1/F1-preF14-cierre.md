# Cierre pre-F1.4 — Slice técnico autorizado por Dirección

| Campo | Valor |
|---|---|
| Orden | Dirección (2026-08-25): aprobar F1.1–F1.3, NO iniciar F1.4, ejecutar cierre técnico |
| Fecha | 2026-08-25 |
| Estado | ✅ COMPLETADO — detenido esperando autorización F1.4 |
| Suite final | **348/348 suites · 3329 tests · 0 fallos** |

## 1. Validación de invariantes de `AppState.js` (ex-requisito bloqueante)

Contexto: el diff paralelo ya no existe en el árbol — el dueño lo resolvió vía sus propios commits de features (`feat(attendance): redesign employee cards`, etc., visibles en la historia del archivo). La validación se hizo igualmente contra el comportamiento ACTUAL, con tests concretos (no revisión visual):

| Invariante pedido por Dirección | Veredicto | Evidencia |
|---|---|---|
| Guardar/cargar sigue aplanando entidades como se caracterizó | ✅ SE MANTIENE | Instancia real de Employee almacenada como POJO (`instanceof === false`, métodos ausentes, campos propios intactos) — `AppStateProxyInvariants.test.js` |
| No se modificó cómo se serializan empleados | ✅ Campos propios preservados íntegros | mismo suite |
| `deletedAt` sobrevive tras fix H-01 | ✅ Round-trip confirmado por raw target Y lectura proxy | mismo suite |
| Sin escrituras que ignoren `projectId` futuro | ✅ Campos tipo-projectId sobreviven sin pérdida | mismo suite |
| El proxy NO elimina campos desconocidos/nuevos | ✅ Claves nuevas top-level y anidadas sobreviven (sin whitelist en set-trap) | mismo suite |
| Project/Employee pasan por el estado sin pérdida de campos | ✅ POJO estilo Project con extras futuros sobrevive completo | mismo suite |

**Veredicto: SIN bloqueante para F1.4.** Suite puramente característica — `AppState.js` no fue tocado.

## 2. Endurecimiento S3/S4/S5

| ID | Cambio | Tests |
|---|---|---|
| S3 | `assertStatusTimestamps()` en constructor (único punto detrás de create/fromJSON): `closed` exige `closedAt` finito; `archived` exige además `archivedAt`. Errores descriptivos nombrando el campo faltante. Proyectos legítimos (vía transiciones) pasan intactos — probado con round-trip | +tests en ProjectTests (21/21) |
| S4 | JSDoc de `getActiveProjectId()` ahora declara contrato REAL: async, PUEDE rechazar si storage falla, cadena fallback, null con flag OFF | sin cambio conductual |
| S5 | `cloneMetadata()` clona profundo en la frontera de entrada de ambas fábricas; mutación posterior del caller jamás filtra a payloads | test de aislamiento |

## 3. Boot-wiring completado (estrictamente tras flag)

- Nuevo `ProjectsBoot.initProjectsInfrastructure()`: DI `{defaults, context}`, garantía de no-lanzar hacia afuera (flag OFF corta antes de tocar storage; cualquier fallo degrada a `{null,null}` con console.warn — feature opt-in no puede romper un boot legacy).
- Conexión en `app.js`: UN import + UNA invocación `await initProjectsInfrastructure();` justo tras `hydrateApplicationAndInitializeWeather` (~7048), dentro del try existente. Estrategia AWAITED elegida sobre fire-and-forget: orden determinista (el default existe antes de que código post-hydrate pregunte) y cero riesgo porque ProjectsBoot nunca lanza.

## 4. Pruebas de secuencia pedidas por Dirección

`ProjectsBootFlagSequence.test.js` (IDB real, harness fresco por fase sobre misma DB+LS):

| Escenario | Resultado |
|---|---|
| flag OFF → arranque | ✅ nada se crea, contexto null |
| flag ON → arranque | ✅ único default + contexto apuntándole |
| recarga simulada (ON) | ✅ mismos ids recuperados, sin duplicar |
| ON→OFF→ON | ✅ fase OFF: null/sin borrar nada; ON final: MISMO id persiste |

## 5. Upgrade real v16→v17

`IndexedDBUpgradeV16ToV17.test.js`: apertura manual v16 con stores sembrados → cierre → apertura vía servicio REAL (pide v17) → store `projects` creado y TODOS los registros legacy intactos y legibles. ✅

## Checklist de la orden

- [x] 1. AppState validado con tests concretos (4/4 invariantes)
- [x] 2. S3/S4/S5 resueltos mínimos + tests
- [x] 3. Boot-wiring estrictamente tras flag
- [x] 4. Tests OFF / ON / reload / ON→OFF→ON
- [x] 5. Test de upgrade real v16→v17 preservando registros
- [x] 6. Empleados/puestos/líderes/asistencia/nómina/caja SIN TOCAR
- [x] 7. README actualizado + este informe con SHAs/suite/riesgos
- [x] 8. DETENERSE — F1.4 requiere autorización explícita

## Riesgos abiertos

Ninguno nuevo. Vigilancias heredadas: flaky ocasional en DataOps/PersistenceService (preexistente, pasó siempre al reintentar); trabajo del dueño sigue activo en worktrees separados.
