# Registro de hallazgos — Fase 0 (auditoría SA)

| Campo | Valor |
|---|---|
| Fecha | 2026-08-24 |
| Fuentes | Pasos F0.1–F0.5 (auditoría de código real; documentación vieja ignorada como fuente) |
| Naturaleza | Registro VIVO — se actualiza cuando un hallazgo se resuelve o se re-clasifica |

**Convención de severidad:** 🔴 Alto (puede morder en Fase 1) · 🟡 Medio (hardening antes del piloto) · 🔵 Informativo (comportamiento/código a conocer)

| ID | Sev. | Hallazgo | Evidencia | Impacto potencial | Acción recomendada | Objetivo |
|---|---|---|---|---|---|---|
| H-01 | 🔴 | **Posible bug latente**: el marcador de borrado `deletedAt` de EMPLEADOS se pierde si el registro se re-infla por el constructor `Employee` (que no lo declara). El import JSON lo preserva; la carga desde IDB podría descartarlo. Los tombstones de ASISTENCIA sí están protegidos por su constructor | `js/tests/ExportApplyFullImportRoundTrip.test.js`; constructor `Employee.js`; `PersistenceService` inflación | Un empleado borrado podría "resucitar" silenciosamente tras cierta ruta de carga | Verificar la ruta IDB→constructor con datos reales; si confirma, añadir `deletedAt` al constructor + test de protección | Evaluar AL INICIO de Fase 1, antes de tocar empleados |
| H-02 | 🟡 | Claves localStorage FUERA del manifiesto de "Borrar datos locales": `attendance-error-log`, `attendance-entities-sync-ok`, `entityUpload.*.v1`, `pettyCashPersistenceMetrics:v1`, `app:debugMode` | `LocalWipeService.js:35-150` vs inventario F0.1 §2.2 | En dispositivo compartido, watermarks sobrevivientes pueden hacer que la cuenta nueva NO suba entidades (fuga cruzada silenciosa) | Decidir una por una: ¿intencional (diagnóstico/cuota) o fugas? Extender manifiesto o documentar excepción | Hardening pre-F10.1 (aislamiento) |
| H-03 | 🟡 | La capa IndexedDB NO es testeable en runtime: `moduleNameMapper` intercepta el módulo real; los tests son regex sobre el texto fuente | `jest.config.js`, auditoría F0.5 §E | El refactor puede pasar todos los contratos-regex y romper runtime igualmente | Agregar `fake-indexeddb` como dev-dependency y migrar los tests críticos de IDB | ANTES de iniciar Fase 1 |
| H-04 | 🟡 | **Privacidad**: backups REALES de producción commiteados en `backups_de_prueba/` (3 JSON de Contrutek) — posible PII en el repo | `backups_de_prueba/*.json` | Exposición de datos personales si el repo se comparte | Sanitizar o remover del repo (+ .gitignore); OPORTUNIDAD: version sanitizada serviría como fixture dorado de tests | Antes de abrir el repo a más ojos |
| H-05 | 🟡 | `exportConfig` (ajustes/deducciones de nómina EN CURSO) viaja dentro del doc espejo cloud — estado de sesión sincronizado como si fuera oficial | `FirebaseService.js:121-129` (no se limpia en saveFullState) | Ruido en la nube; riesgo de restaurar ajustes a medio hacer en otro dispositivo | Limpiar del espejo cuando F1 defina qué es "estado oficial" | Fase 1 |
| H-06 | 🔵 | `users/{uid}` ES el tenant actual; no hay nivel intermedio. Colisión de nombre: colección cloud `users/{uid}/projects` ya pertenece a CAJA CHICA | F0.2 §3; `PettyCashRepository.js:229-237` | Cualquier refactor debe usar campo (opción A) y ruta propia para el registro oficial | Resuelto en diseño: campo `projectId` + colección `projectsV1` (F0.3 §3-4) | Documentado (F0.3) |
| H-07 | 🔵 | El proxy del estado APLANA instancias de clase a objetos planos tras guardar/cargar: las entidades quedan sin métodos/prototipo | `AppState.js:51-72,246-248`; `PersistenceRoundTripIntegrity.test.js` | Código que asuma métodos de clase tras cargar romperá | Conocimiento load-bearing: el refactor debe trabajar con POJOs post-carga | Documentado (F0.5) |
| H-08 | 🔵 | La migración legacy consume su input: primer arranque borra el blob `asistencia-data`; segundo arranque reporta "sin datos" en vez de re-migrar | `LegacyLocalStorageToIdbMigration.test.js` | Idempotencia por escritura; diagnosticadores deben saberlo | Ninguna (comportamiento fijado por test) | Documentado |
| H-09 | 🔵 | `saveApplicationData` hace no-op silencioso sin banderas `isDataLoaded && useIndexedDB` | `PersistenceServiceTests.js` | Tests/diagnóstico deben sembrar ambas banderas | Ninguna | Documentado |
| H-10 | 🔵 | Código muerto/vestigial detectado: `getSupabaseSyncStatus()` llama a módulo INEXISTENTE (`app.js:5560`); store IDB `sync_queue` creado-nunca-usado; store `miniAttendanceInbox` sin llamadores runtime; imports `runTransaction/startAfter` sin uso; header de `sw.js` describe otra estrategia que la real | F0.1 §E y §2.1; `MiniAttendanceInboxStore.js:108` | Ruido/confusión para futuros agentes; superficie de mantenimiento | Limpieza opcional agrupada en un commit propio NUNCA mezclado con fases funcionales | Backlog post-F2 |
| H-11 | 🔵 | Bucket de Firebase Storage históricamente NO aprovisionado (404 según comentario del código): snapshots grandes dependen de compresión inline | `FirebaseService.js:577-581, :597-599` | Si snapshot comprimido excede límites, backup grande falla silencioso | Verificar en Firebase Console si hoy existe; decidir provisionar o documentar límite | Pre-F4 (plataforma) |
| H-12 | 🔵 | Dual lockfiles: `package-lock.json` Y `pnpm-lock.yaml` conviven; CI usa `npm ci` | Raíz del repo | Drift de dependencias entre entornos | Eliminar el lockfile no canónico y fijar el flujo en docs | Housekeeping |
| H-13 | 🔵 | Contexto de fase solo local: `ROADMAP_BASE_SA_MINI_INTEGRACION.md`, `openspec/` y `docs/fase-0/` están SIN COMMITEAR | `git status` | Un incidente local pierde el mapa completo del proyecto | Commitear al aprobarse (pendiente decisión de Dirección) | Inmediato (con aprobación) |

## Hallazgos resueltos

| ID | Resolución |
|---|---|
| H-01 | ✅ CONFIRMADO y CORREGIDO en F1.0.2 (2026-08-25): el tombstone `deletedAt` se perdía en la re-inflación `new Employee(e)` (PersistenceService.js:1097). Fix mínimo condicional con `hasOwnProperty` en constructor+`toJSON` de Employee.js (payloads byte-idénticos para empleados nunca borrados). Protegido por `js/tests/EmployeeTombstoneSurvival.test.js` contra IDB real |

## Nota metodológica

Todos los hallazgos provienen de lectura directa del código/tests (F0.1–F0.5). Los comportamientos sorpresivos fueron FIJADOS POR TESTS de caracterización, no corregidos: Fase 0 no cambia comportamiento productivo. Las correcciones candidatas (H-01, H-02, H-05) se ejecutarán en sus fases objetivo con sus propios commits y pruebas.
