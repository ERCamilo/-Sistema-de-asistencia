# Revisión independiente PR #171 — correcciones (2026-09-27)

Alcance: diff `194c028..b8b032e` (dacf022 + b8b032e) y el código final de
reconciliación de puestos/líderes y de respaldo/restauración de cierres de nómina.
Worktree aislado; sin commits, push, deploy, Firebase ni datos de producción.

## Hallazgos

| ID | Severidad | Estado | Descripción |
|----|-----------|--------|-------------|
| C1 | Media | Corregido | Al incluir un empleado con «Incluir empleado» desde el paso Puestos/Resumen, el asistente no volvía a pedir la decisión sobre el líder de esa persona. El servicio durable (real, reproducido en fake-indexeddb) confirmaba `OK` y **desvinculaba el líder en silencio** (`leaderId: null`, `detachedLeaders` no vacío), un cambio que la ruta normal exige decidir en el paso Líderes. |
| C2 | Baja | Corregido | `linkedConflictChoice` comparaba `projectId` sin normalizar. Un puesto o líder con `projectId` de una obra válida con espacios (`" PRJ-x "`), que el análisis y el planificador durable tratan como obra ajena válida, mostraba el botón «Incluir puesto». El cambio lo bloqueaba en la transacción (no se enviaba ni se escribía), pero la interfaz ofrecía mover una definición ajena. Tampoco se exigía que la definición perteneciera al conjunto que se envía al aplicar (`catalogIssues`). |
| C3 | Media | Corregido | Restaurar un respaldo con un cierre schema 2 en un dispositivo que ya tiene ese mismo cierre promovido (`identityKind: promoted-legacy`, mismo id) abortaba **toda** la restauración con `PayrollClosureConflictError` (fail-closed, sin pérdida). Se reprodujo con `_replaceOwnedStateAtomically`. |
| R1 | — | Sin cambios | Mensajes: los textos en español identifican el puesto, líder o empleado relacionado; el footer ya no muestra «Resolve linked…». La obra ajena válida no recibe botón. El botón desactualizado se revalida contra el preflight actual (prueba existente). |
| R2 | — | Sin cambios | `payrollClosureRestoreOptions` acepta 1/2/3; v1/v2 se guardan tal cual (auditoría de anulación, `migrationSource`, `paymentRefs`); v3 se valida en su obra; la fusión es monotónica (no reabre anulados). Correcto para las rutas FILE y FULL. |

### Correcciones

- **C1** `ProjectReconciliationUI.js`: se añade `hasUnresolvedRequiredLeaders()`. Tras una
  inclusión que deja un líder requerido sin resolver, el asistente vuelve al paso
  Líderes y explica qué persona se incluyó. El bloqueo de `wizardHint` se aplica
  desde el paso 2 en adelante, no solo en el 2, y `applyLocalResolution` rechaza
  aplicar con líderes requeridos pendientes (defensa en profundidad).
- **C2** `linkedConflictChoice`: identificadores y `projectId` normalizados como en el
  análisis y el planificador durable. Solo se ofrecen empleados cuya propia obra está
  pendiente (`employeeIssue`) y definiciones que la aplicación final realmente envía.
- **C3** `PayrollClosureBackup.resolveRestoredPayrollClosure`, usada solo por la
  fusión de restauración de `IndexedDBService`: si el cierre local es un
  promoted-legacy con el mismo id y el respaldo trae la forma schema 2, se
  compara el respaldo en forma promovida (`promoteLegacyPayrollClosure` con la obra
  local) y se aplica la misma fusión monotónica. Se conservan la obra, el
  `ownershipToken`, las filas y los totales. Solo puede avanzar la anulación. Si el
  contenido difiere, sigue fallando antes de reemplazar datos. La restauración nunca
  promueve: un respaldo promovido sobre un cierre local schema 2 sigue bloqueado.
  El contrato compartido `resolvePayrollClosureMutation`, que también usa
  Firestore, no se modifica.
- `scripts/check-payroll-closure-backup.cjs`: también bloquea hosts n8n durante la
  comprobación en Chromium.

## Pruebas ejecutadas (por este revisor)

- Nuevo `js/tests/ProjectReconciliationLinkedInclusionR07.test.js` (4 pruebas). Recorre el
  asistente real y repite los parámetros capturados con `applyOwnershipRepair`
  **real** sobre fake-indexeddb.
  - Líder compartido y segundo puesto sin empleados: con la inclusión explícita
    el guardado da `OK`. Se conservan préstamos, pagos, horas y sueldo especial.
    Quedan idénticos el empleado, el puesto y la asistencia de otra obra, y la
    asistencia de un empleado inexistente.
  - Puesto de obra válida (`PRJ-other` y `" PRJ-other "`): sin botón; no se puede avanzar.
  - Empleado incluido con líder pendiente: vuelve al paso Líderes. Tras resolverlo,
    el guardado da `OK` y `detachedLeaders: []`.
  - Sin la corrección de UI, 2 de las 4 fallan (C1, C2 con espacios).
- `PayrollClosureBackupFlows.test.js`: 6 pruebas nuevas por la ruta pública FULL:
  4 combinaciones de estado promovido local × schema 2 del respaldo, contenido
  alterado y la regla de que la restauración nunca promueve. Sin la corrección,
  las 4 combinaciones fallan.
- Suites focalizadas: `ProjectReconciliation*` (24 suites) y `PayrollClosureBackup*` en PASS.
- Suite completa Jest: 488 suites / 4739 tests PASS.
- Chromium local (`/snap/bin/chromium`), `scripts/check-payroll-closure-backup.cjs`:
  FILE en escritorio a 1280 y FULL en móvil a 390, ambos PASS con 3 cierres
  (v3, v2 y v1 anulado). Firebase, googleapis y n8n bloqueados.
- Respaldo privado (solo en local, con la salida filtrada y sin datos personales en
  este informe), servido desde este worktree:
  - `reproduce-private-restore.cjs` (importación por UI con `loadBackupFromFile`,
    botón visible y recarga): PASS; 3 cierres exactos, 54 empleados y 3110
    asistencias.
  - `reproduce-private-backup.cjs` (siembra IndexedDB directamente, **no** es
    importación por UI): ruta manual con inclusión explícita PASS, 54/3110, datos
    financieros sin cambios y recarga PASS.

## Límites y pendientes

- **H1 (no corregido, requiere diseño):** los cierres schema 2 sin `projectId` siguen
  tratándose como huérfanos aunque pertenezcan a la obra por defecto. La recuperación
  financiera explícita crea una copia v3 (`recovery.sourceId`), mientras que la promoción en
  nube conserva el id legacy. Si ocurren ambas, la misma nómina puede quedar dos veces
  en la obra. `PayrollClosureStamper` sigue sin llamador. Necesita decidir un único
  camino (promoción o copia) y pruebas contra Firestore, a las que no hay acceso.
  No se reprodujo en nube.
- **Inverso de C3:** un respaldo con un cierre promovido sobre un dispositivo que conserva
  la forma schema 2 sigue bloqueando la restauración (fail-closed, sin pérdida), porque
  aceptarlo equivaldría a promover durante la restauración.
- La restauración de cierres no encola la nube (es solo local), igual que antes. Una
  anulación que llegue por respaldo a un cierre promovido queda solo en local hasta
  la próxima sincronización.
- **H2 / M caja chica** (reemplazo total de nube, FILE/FULL sin outbox de caja), cierre
  recuperado que ocupa el período actual con «Deshacer», puesto de origen inexistente y
  líder requerido aunque el puesto se sustituya: no evaluados en profundidad ni
  corregidos. Quedan fuera de las rutas cambiadas o requieren pruebas de nube.
- Índice Firestore de `payrollClosures`: falta en producción según la consola, aunque está
  definido en `firestore.indexes.json`. Es un pendiente externo; no hay autorización
  para desplegarlo.
- No se actualizó `BuildInfo.js`/`sw.js` (CACHE_VERSION); hacerlo en el commit si el
  flujo de publicación lo requiere.
- Dictamen limitado a estas rutas; no es un ALLOW general del sistema.

## Resultado suite completa

`node node_modules/jest/bin/jest.js --runInBand`: 488 suites / 4739 tests PASS, exit 0
(con todas las correcciones aplicadas).

---

# Ronda 2 — validación con los dos respaldos adjuntos (2026-09-27)

Petición: importar los dos respaldos, completar la asignación a una obra con el asistente y
corregir los fallos reales. Las correcciones C1/C2/C3 de la ronda anterior se conservan sin
cambios. Sin commits, push, deploy ni nube. Los respaldos, los estados intermedios y los
scripts de la prueba quedaron solo en `/tmp` (privado). Este informe contiene solo conteos y
categorías.

## Respaldos (identificados por checksum)

| Clave | SHA-256 | Contenido |
|---|---|---|
| **T** | `9e14662d…864127f` | 54 empleados, 26 puestos, 6 líderes, 3110 asistencias (163 sin empleado), 3 cierres (v1 anulado, v2 anulado, v2 cerrado), 2 obras, 2 cajas chicas |
| **C** | `ad3c0347…dc9a25` | 57 empleados (incluye números 34 y 405), 13 puestos, 4 líderes, 3229 asistencias, **sin campo `payrollClosures`**, 1 obra, 1 caja chica |

Cada salida se comparó con **su** respaldo de origen. Tras las pruebas, los originales conservan
el mismo checksum.

## Entorno

- Chromium local `/snap/bin/chromium` (headless, perfiles aislados por escenario), servidor
  estático del worktree y sin cuenta (`window.currentUser` vacío, así que solo se ofrece
  «Restaurar Datos Locales»).
- Se bloquearon googleapis, firebaseio, cloudfunctions, firebaseapp y n8n. Se permitió el CDN
  estático del SDK (gstatic) porque sin él la app no arranca; no autentica ni escribe.
- Dispositivo «nuevo»: la app crea su propia obra predeterminada al arrancar. Dispositivo
  «misma obra»: el catálogo local ya contiene las obras del respaldo.
- Ruta **FILE**: `loadBackupFromFile(File)` → modal → clic en el botón visible
  `#btn-restore-local` → recarga automática.
- Ruta **FULL**: `openImportFullModal` → texto en `#import-full-textarea` (evento `input`) →
  «Revisar importación» → «Importar ahora» → si queda en espera, clic en la tarjeta de la obra y
  en «Aplicar» → recarga.
- Asistente: se abre desde el botón del banner «Revisar N problemas». Recorrido con clics reales:
  - **Manual:** obra → Datos (se marcan las cajas) → Líderes («Asignar a esta obra», que conserva
    la identidad del líder) → Puestos («Asignar a esta obra» y los opcionales) → Resumen →
    «Aplicar todo».
  - **Asignar todo:** activa por sí mismo la recuperación financiera.
- Antes de comparar hay una recarga final. No se sembró ningún store para simular la importación.

## Errores encontrados y corregidos (solo aparecían con los respaldos reales)

| ID | Severidad | Ruta | Descripción | Corrección |
|----|-----------|------|-------------|------------|
| **B1** | Alta (pérdida de datos) | FILE y FULL | Con **C**, tras restaurar y recargar se perdían **18 asistencias**: un día completo, 144 h y 1 fecha (3229→3211). Las causas: (1) la poda de caché de 12 meses se ejecuta al arrancar sobre `state.attendance`; (2) el modelo `Attendance` descarta `lastAccessed` y `recoveryProtected`; (3) la protección de recuperación que escribe la restauración (`attendanceRecoveryProtection`, f7af693) nunca se consultaba. El respaldo puede ser la única copia de ese historial. | `AttendanceRetentionPolicy` acepta `protectedRecordKeys` y la marca `recoveryProtected`. `AttendanceCachePruner` recibe `getProtectedRecordKeys`. `PersistenceService` lo conecta a `indexedDBService.getAttendanceRecoveryProtectedKeys()` (lista durable). La caché ordinaria antigua se sigue podando. |
| **B2** | Media (vínculo perdido) | FILE, dispositivo nuevo | Con **C**, un puesto del origen pertenece a la obra del respaldo (inexistente en el dispositivo) y su líder no tiene obra. Al arrancar, `validateDataIntegrity` lo trataba como «líder de otra obra», anulaba `leaderId` y dejaba `crossProjectLeaderId`. El asistente movía después puesto y líder a la misma obra, pero el vínculo no volvía (8→7 vínculos puesto-líder). | Solo es «de otra obra» si **ambas** obras efectivas existen en el catálogo local. Una obra inexistente es propiedad pendiente: la decide el asistente. Si el catálogo no se puede leer, no se desvincula nada. El caso H8 real (dos obras válidas) no cambia. |
| **B3** | Media (auditoría perdida) | FULL y asignación | Esos mismos 18 registros llevan `miniImportAudit` (procedencia Mini). El modelo `Attendance` lo descartaba en el primer guardado completo tras recargar. Es un fallo general, no exclusivo de los respaldos. | `Attendance` conserva `miniImportAudit` solo cuando existe, con el mismo patrón que `projectId`. Las reglas de Firestore no limitan los campos de asistencia, y Mini ya sube ese campo en los registros nuevos. |

Fallos del arnés (no de la app), corregidos en el script privado: nodos desconectados tras cada
re-render; clic sobre el radio nativo oculto de la elección de obra en FULL. En ese segundo caso,
«Aplicar» seguía deshabilitado y **no hubo ninguna mutación**. El usuario pulsa la tarjeta
visible, que es lo que ahora hace el arnés.

## Matriz (estado tras asignar y recargar; código final)

Formato: empleados · puestos · líderes · asistencias, conservados/origen. Las horas, las
presencias y las fechas coinciden exactamente con el origen en todas las filas.

| Respaldo | Ruta | Dispositivo | Asistente | Conteos | Horas / presentes / fechas | Cierres | Finanzas (préstamos/pagos/ajustes) | Vínculos puesto-líder | Pendiente tras recargar | Veredicto |
|---|---|---|---|---|---|---|---|---|---|---|
| T | FILE | nuevo | manual | 54·26·6·3110 | 24051 / 2725 / 191 | 3 exactos (2 anulados) | 107/105/25, 54/54 idénticos | 2/2 | diagnósticos: 3 cierres, 29 pagos, 4 planes, 163 asistencias sin empleado (financiero apagado) | PASS |
| T | FILE | misma obra | manual | 54·26·6·3110 | igual | 3 exactos | 54/54 idénticos | 2/2 | ídem | PASS |
| T | FULL (390 px) | nuevo | elección explícita de obra | 54·26·6·3110 | igual | 3 exactos | 54/54 idénticos | 2/2 | diagnósticos financieros + 162 sin empleado | PASS |
| T | FILE | nuevo | Asignar todo | 54·26·6·3110 | igual | 3 originales exactos + 3 copias v3 | importes idénticos; referencias reapuntadas (ver abajo) | 2/2 | 4 planes (bloqueo seguro) + 163 sin empleado | PARTIAL (H1) |
| C | FILE | nuevo | manual | 57·13·4·3229 | 26460 / 3107 / 164 | sin campo → 0 | 145/148/14, 57/57 idénticos | 8/8 | 17 pagos + 2 planes (financiero apagado) | PASS (tras B1-B3) |
| C | FILE | misma obra | manual | 57·13·4·3229 | igual | 0 | 57/57 idénticos | 8/8 | ídem | PASS |
| C | FULL (390 px) | nuevo | vinculación automática (1 obra) | 57·13·4·3229 | igual | 0 | 57/57 idénticos | 8/8 | 17 pagos + 2 planes | PASS |
| C | FILE | nuevo | Asignar todo | 57·13·4·3229 | igual | 0 | importes idénticos | 8/8 | **0** | PASS (con H1 pendiente de diseño) |

Antes de B1/B2, C·FILE daba 3211/3229 asistencias, 26316 h, 163 fechas y 7/8 vínculos.

Identidades: id, key, número, nombre, fecha de ingreso, estado, historial y lista de puestos
coinciden en 54/54 (T) y 57/57 (C). Los números 34 y 405 existen solo en C y se conservan en
el mismo empleado. T no los contiene.

## Diferencias frente al origen y su justificación

- `projectId` en empleados, puestos, líderes y asistencias: es la asignación elegida. En «misma
  obra», los registros que ya tenían una obra válida no cambian: en T, 469 asistencias quedan en
  su obra; en C, 2 empleados y 1 puesto.
- `updatedAt`: al importar se rellenan las marcas ausentes (T 362 asistencias, C 393) y la
  asignación marca lo que modifica.
- `selectedPosition`/`positionHours` (T 2257, C 40): son días presentes sin puesto explícito
  que se asignan al primer puesto de cada empleado. Esto lo anuncia el resumen del asistente. Se
  verificó la regla en cada registro: horas y extras iguales, suma por puesto = máx(suma previa,
  horas), entradas previas conservadas. **0 violaciones**. No se tocó ningún día con puesto
  explícito.
- `recoveryProtected` (18 en C) y `lastAccessed`: son metadatos locales de la protección de
  restauración, no datos del usuario.
- `deviceId: null` (18 en C): el modelo lo normaliza cuando el origen no trae el campo.
- Asistencias sin empleado (T 163): `employeeId` nunca cambia (0 reasignadas).
  - En FILE/manual quedan sin obra y el asistente pide identificar al empleado.
  - En FULL, la elección explícita de obra vincula **todos** los registros legacy sin dueño,
    incluidos estos. Solo cambia su `projectId`; es el diseño A2a con elección del usuario.
- Caja chica: el paso «Datos» asigna localmente 2 cajas en T y 1 en C. No hay reemplazo de nube.

## Recuperación financiera (H1) — evaluada con ambos respaldos

- Opción apagada (ruta manual): las finanzas quedan idénticas y la recuperación aparece como
  pendiente explícita. **No se afirma éxito financiero por esta vía.**
- «Asignar todo» (recuperación encendida):
  - **T:** los 3 cierres originales quedan exactos, con los anulados todavía anulados. Se crean 3
    copias v3 en la obra (`recovery.sourceId` apunta al original; filas y totales iguales;
    mismo estado, sin reactivar anulados).
  - **T:** se reapuntan a la copia 1 pago, 4 historiales de deducción y 1
    `payrollBatchSnapshot`. Los importes suman igual y los conteos no cambian.
  - **C:** 145 préstamos y 148 pagos reciben la obra. Las 17 referencias a un cierre que **no
    viene en el respaldo** se conservan tal cual (no se inventa el cierre). Pendiente final: 0.
- Bloqueo seguro explícito, no callejón sin salida: en T quedan 4 planes con el aviso «Un
  cierre del historial no está disponible localmente…». Esos planes citan un cierre que tampoco
  existe en el respaldo de origen.
- **H1 sigue abierto:** un cierre schema 2 sin obra, recuperado como copia v3, podría duplicarse
  en la obra si otro dispositivo lo promueve en la nube con su id legacy. Resolverlo exige
  decidir un único camino (copia o promoción) y pruebas contra Firestore, que no se ejecutaron.
  No hay ALLOW financiero general.

## Cierres, idempotencia y conflicto (secuencias en un mismo perfil, FILE y FULL)

T → C → C (reintento) → T → Asignar todo → recarga → T otra vez → Asignar todo → recarga:

- Al importar **C (sin `payrollClosures`) sobre un dispositivo con los cierres de T**, los 3 se
  conservan exactos y los 2 anulados siguen anulados. La ausencia del campo no se trata como
  borrado.
- En ninguna fase se duplican empleados (ids distintos = conteo del origen activo), pagos (105
  en T / 148 en C) ni cierres.
- Tras la primera recuperación hay 6 cierres (una copia por original). Al reimportar T y
  recuperar otra vez siguen siendo **6**, con una copia por original y sin reactivar anulados.
- **Conflicto real:** se usó una variante sintética en memoria (nunca escrita a disco) con el
  mismo id de cierre y otro contenido, y la lista de empleados recortada.
  - FILE: se rechaza, con aviso de error visible y 54 empleados en memoria y almacenamiento.
    Todos los stores quedan idénticos salvo `app.localUpdatedAt` (marca de tiempo de un guardado
    local en segundo plano).
  - FULL: se rechaza tras la elección de obra y ningún store cambia.
  - Tras recargar, el estado es idéntico en ambas rutas. No hay estado mixto.

## Veredicto por caso de la petición

| # | Caso | Veredicto |
|---|------|-----------|
| 1 | Importación real por UI de ambos archivos (FILE y FULL con elección/reconciliación) | **PASS** (con B1/B3 corregidos) |
| 2 | Asignación completa con el asistente (manual y «Asignar todo»), conservando líderes, puestos y días | **PASS** (con B2 corregido); bloqueos restantes explícitos y seguros |
| 3 | Comparación tras importar, asignar y recargar | **PASS**; diferencias justificadas arriba |
| 4 | Respaldo sin cierres sobre cierres existentes; restauración exacta; rollback ante conflicto | **PASS** |
| 5 | Idempotencia y reintento | **PASS** |
| 6 | Recuperación financiera | **PARTIAL**: local coherente y sin pérdida; H1 (nube) sin decisión de diseño |
| 7 | Regresiones y suite completa | **PASS** |

## Pruebas ejecutadas en esta ronda

- Nuevo `js/tests/AttendanceRestoreRetention.test.js` (4 pruebas, datos sintéticos):
  - política y pruner;
  - ciclo real con `IndexedDBService` sobre fake-indexeddb: restauración atómica con protección
    → recarga con el modelo `Attendance` → `pruneAttendanceCache` real de `PersistenceService`
    → guardado ordinario → segundo arranque;
  - conservación de `miniImportAudit`.
  - Sin las correcciones fallan las 4 (B1 y B3).
- `ProjectStartupCrossProjectIntegrityR07.test.js`: el fixture H8 declara ahora sus dos obras en
  el catálogo, y se añaden 2 pruebas (obra inexistente = pendiente; catálogo ilegible = sin
  desvincular). Sin la corrección fallan las 2 nuevas.
- `__mocks__/IndexedDBService.js`: se añade `getAttendanceRecoveryProtectedKeys`.
- Suite completa Jest (`--runInBand`): **489 suites / 4745 tests PASS**, exit 0.
- `scripts/check-payroll-closure-backup.cjs` (Chromium): FILE 1280 y FULL 390 PASS.
- Chromium con los respaldos reales: 8 escenarios de la matriz y 2 secuencias (FILE y FULL, con
  conflicto), todos con 0 errores de página.

## Pendientes

- **H1** (arriba). Tampoco se evaluaron el reemplazo de nube de caja chica (prohibido) ni la
  sincronización posterior.
- Asistencias sin empleado de T (163): quedan pendientes a propósito hasta identificar al
  empleado. En FULL reciben la obra elegida y en FILE no. Si se quiere que ambas rutas se
  comporten igual, es una decisión de producto.
- `deviceId: null` añadido por el modelo en registros sin ese campo: es inocuo, pero no es
  byte-idéntico al origen.
- La protección de restauración es permanente hasta la siguiente restauración completa: el
  historial restaurado anterior a 12 meses no se poda de la caché local. Es intencional, porque
  el respaldo puede ser la única copia.
- `BuildInfo.js`/`sw.js` (CACHE_VERSION) sin actualizar.

---

# Ronda 3 — Firebase, Supabase/imágenes y recuperación de cierres (2026-09-28)

Se conservan sin cambios las correcciones C1–C3 y B1–B3. Sin commits, push, deploy, nube real,
Supabase real, n8n real ni datos productivos. No hay emulador de Firebase ni de Supabase en este
equipo (no hay Java, firebase-tools, CLI de Supabase ni Deno), así que las pruebas de nube usan un
**Firestore en memoria** que ejecuta los repositorios reales (`PettyCashRepository`,
`PayrollClosureRepository`): transacción `get/set(merge)`, `onSnapshot` con eco inmediato,
`where` (también sobre campos anidados) y concurrencia optimista con reintento. Imágenes: el
`AppImageClient` real contra un backend falso que sigue el contrato de
`supabase/functions/app-images/README.md`. `AGENTS.md` no existe en el repositorio; se siguió
`design.md`.

## Hallazgos y correcciones

| ID | Sev. | Flujo | Hallazgo (confirmado en código y con prueba) | Corrección |
|----|------|-------|------------------------------------------------|------------|
| **F1** | Alta (pérdida en nube) | FILE → «Borrar y Reemplazar Nube» | `onReplaceCloudRestore` llamaba a `deleteCloudData()` **sin acotar**: borraba `projects`, `cashPeriods` y `pettyCash` de la nube y nunca los volvía a subir (el snapshot de seguridad excluye Caja Chica). Los demás dispositivos vaciaban su Caja Chica con el siguiente snapshot. Además subía el `state` vivo después del borrado (el defecto JD-F1 que `DataOps` ya corregía) y no creaba snapshot de seguridad ni purgaba pendientes. | Usa `replaceCloudWithLocal()` (foto congelada, snapshot de la nube, purga, borrado limitado a `MAIN_DATA_COLLECTIONS`). Caja Chica se encola con `enqueueRestored(…, {mode:'replace'})`: se estampa `updatedAt` para que el respaldo gane en todos los dispositivos. Nunca se borran documentos de caja de la nube que el respaldo no trae. |
| **F2** | Media-alta (pérdida local tras sync) | FILE local y FULL | La caja restaurada se escribía sin cola. El primer snapshot de Firestore (`applyRemote`) reemplazaba la colección y **borraba lo restaurado que la nube no tenía**. Reproducido con la prueba «sin la cola…». | `PettyCashStore.enqueueRestored(…, {mode:'merge'})` tras el commit local (FILE sin conexión y FULL). En fusión, si la nube tiene una versión igual o más nueva: `applyRemote` cede y `flush` descarta la entrada ante el conflicto de versión (sin `dead`). Los ids con un cambio local pendiente se omiten. El espejo de Supabase recibe el movimiento restaurado **solo después** de que Firestore lo aceptó (el espejo no compara versiones). «Desconectar y restaurar» no encola nada (texto de la opción: «solo este teléfono»). |
| **F3** | Media | Historial y escucha de cierres sin índice | La escucha en vivo y el historial remoto fallan con `FAILED_PRECONDITION` si el índice compuesto no está desplegado. El historial mostraba el error en inglés con la URL de la consola y la lista vacía. La escucha lo registraba como `console.error` en cada arranque. | El índice **ya está en el repo** (`firestore.indexes.json`, 1.er índice, igual a la consulta): no hacía falta añadirlo. El repositorio tipa el error (`PAYROLL_CLOSURE_INDEX_MISSING`, en español). El historial muestra los cierres locales con un aviso. La escucha da un solo aviso por sesión. Otros errores se propagan igual que antes. Crear un cierre sigue fallando cerrado si no se puede verificar el período. |
| **F4** | Media | Fotos de perfil (creación y edición) | Con el flujo n8n inactivo (`POST …/webhook/app-images` → 404 «webhook not registered»), el cliente devolvía `APP_IMAGE_REQUEST_FAILED` / `retryable:false`, indistinguible de «imagen no encontrada». Cada render del avatar volvía a lanzar la subida (POST repetidos). La foto local y la ausencia de señal en Firestore eran correctas. | `AppImageClient`: sin el campo `error` del backend, la respuesta viene del proxy → `IMAGE_ENDPOINT_NOT_FOUND` (404) / `IMAGE_SERVICE_UNAVAILABLE`, reintentable. Un fallo de red da `IMAGE_SERVICE_UNREACHABLE`. `EmployeePhotoService`: espera exponencial en memoria (15 s → 15 min) para las lecturas; un reemplazo explícito del usuario reintenta de inmediato. `getUploadRetryState()` sirve para diagnóstico. |
| **H1** | Alta (duplicado de nómina) | Recuperación financiera vs promoción legacy | Se confirmaron dos rutas de duplicado. (a) Con una copia recuperada en **otra** obra, la obra por defecto igual promovía el original, así que la nómina quedaba en dos obras. (b) La copia se subía aunque otro dispositivo ya hubiera promovido el original. Localmente se podían importar ambos caminos. | **G1**: no se promueve si existe una copia en cualquier obra. **G2**: `saveRecoveredClosure` lee el original **dentro de la transacción**; si ya está promovido, falla con `PAYROLL_CLOSURE_RECOVERY_CONFLICT`, que la cola principal manda a `dead` sin reintentos. Una promoción concurrente fuerza el reintento de la transacción. **G3**: `importRemote` rechaza como conflicto un promovido si hay copia local, y una copia si hay promovido local. No se fabrican cierres, no se mueven datos de una obra existente y los anulados siguen anulados. |

## Contrato Firestore de cierres (consulta ↔ índice)

La prueba `PayrollClosureFirestoreIndex.test.js` captura las consultas reales del repositorio y las
compara con `firestore.indexes.json`.

- Página nativa por obra (escucha en vivo e historial): `projectId ==`, `closedAt desc`, `__name__ desc` → índice 1.
- Con filtro de estado: índice 2.
- Legacy: `schemaVersion ==` → índices 3 y 4.
- Sin obra (Projects OFF): índice 5 o índice de campo único.
- Las consultas por período son solo de igualdad y no requieren índice compuesto.

**No se puede asumir que el índice esté desplegado en producción.** Desplegarlo
(`firebase deploy --only firestore:indexes`) es un paso externo pendiente, no autorizado aquí.

## Supabase / imágenes: arquitectura verificada (solo código; sin acceso real)

- **Fotos de empleados y comprobantes** pasan por **n8n como proxy**
  (`APP_IMAGES_URL`, `RECEIPT_UPLOAD_URL` en `Config.js`) hacia las Edge Functions `app-images` y
  `petty-cash-receipt`. El **espejo de movimientos** llama directo a la Edge Function
  `petty-cash-movement`. El navegador nunca habla con Storage ni con PostgREST y no recibe claves
  de Supabase. No se añadieron llamadas directas.
- **Propiedad:** la identidad es el UID de **Firebase**, verificado en cada función con
  `accounts:lookup`, así que `auth.uid()` de Supabase no aplica. Tablas con RLS activado **sin
  políticas** y `revoke all` para `anon` y `authenticated`: solo `service_role`, y solo dentro de las
  funciones (variable de entorno). No hay `service_role` ni `sb_secret` en el frontend. La clave web
  de Firebase del cliente no es un secreto.
- **Rutas:** `app-images` las deriva el servidor
  (`uid/categoría/tipo/id/asset/variante/versions/<uuid>`), con CHECK en SQL. El puntero se
  intercambia por RPC serializado (advisory lock) y el borrado se hace por CAS. Se hace
  `upload(upsert:false)` sobre una versión nueva, así que no se necesita `SELECT+UPDATE` de upsert.
  Los comprobantes usan la ruta estable `uid/txId` con `upsert:true` desde `service_role`: son
  idempotentes y no quedan versiones huérfanas por reintento.
- **MIME y tamaño:** buckets privados con `allowed_mime_types` y `file_size_limit` (5 MiB perfil;
  10 MiB obra, empresa y comprobante), validación de firma binaria en las funciones, y CHECK en
  tablas.
- **Doc oficial consultada hoy (curl):**
  - access-control: INSERT para subir; SELECT+UPDATE para upsert; la service key omite RLS.
  - buckets/fundamentals: en un bucket privado, todo pasa por RLS o por una URL firmada.
  - schema/design: las tablas de `storage` son de solo lectura desde SQL.
  - El changelog consultado incluía una entrada fechada después de esta revisión;
    no se tomó esa entrada futura como requisito vigente.
  - Las migraciones insertan o actualizan `storage.buckets` (configuración del bucket, no metadatos
    de objetos). Es una práctica común, pero conviene migrarla a la configuración declarativa o a la
    API.

## Matriz ALLOW / BLOCK (local/emulado; **no** es validación de producción)

| Flujo | Veredicto | Evidencia |
|---|---|---|
| FILE sin conexión → login → subida → otro dispositivo → reinicio (Caja Chica) | **ALLOW** | `PettyCashRestoreCloudCycle` (2 dispositivos + un 3.º «reiniciado») |
| FILE / FULL con sesión: lo restaurado que falta sube; la nube conserva lo más nuevo; sin entradas `dead` | **ALLOW** | ídem (casos m1/m2/m3) |
| Eco de red antes del flush, cambio local pendiente, borrado posterior en otro dispositivo, reintento FULL idempotente | **ALLOW** | ídem |
| «Borrar y Reemplazar Nube»: dataset principal por `DataOps`; Caja Chica subida y ganadora; sin borrar caja de la nube | **ALLOW** (cableado + contrato) | `RestoreCloudReplaceWiring`, suites `DataOps*` existentes, caso «Reemplazar nube» |
| «Desconectar y restaurar» + nuevo login a la misma cuenta | **BLOCK (residual M2)** | ver remanentes |
| Respaldo viejo sin `payrollClosures` (Contrutek) sobre cierres existentes | **ALLOW** | secuencias Chromium (abajo) |
| Historial de cierres sin índice desplegado | **ALLOW degradado** (local + aviso) | `PayrollClosureFirestoreIndex` |
| Crear o deshacer cierre sin poder consultar la nube | **BLOCK intencional** (fail-closed, ya existente) | `PayrollUI` exige `pullPeriod` |
| Foto: creación o reemplazo con proxy 404 → espera → subida → otro dispositivo → borrado | **ALLOW** | `EmployeePhotoProxyOutageCycle` |
| Comprobantes: subida en cola, reintentos, idempotencia por `txId`, verificación por lookup | **ALLOW** (código y pruebas existentes) | `PettyCashReceipt*` |
| Comprobantes: borrado remoto al borrar el movimiento | **BLOCK (residual M3)** | no hay acción `delete` en el contrato |
| Recuperación (copia) vs promoción (H1): rutas de duplicado conocidas | **BLOCK fail-closed** | `PayrollClosureRecoveryPromotionRace` |
| Recuperación H1 con la ventana consulta→transacción de la promoción | **Residual M1** | ver remanentes |
| Relaciones a cierres ausentes | **BLOCK explícito** (no se fabrican) | 4 planes de T (Chromium, abajo) |

## Remanentes H/M (pasos reproducibles)

- **M1 — ventana residual de H1.** La promoción comprueba si hay copias con una consulta **fuera**
  de su transacción (Firestore no admite consultas dentro de transacciones del cliente).
  Reproducción: el dispositivo B abre el historial de la obra por defecto; su consulta
  `recovery.sourceId == L` vuelve vacía. Antes de que su transacción promueva L, el dispositivo A
  confirma la copia C. Resultado: L promovido y C en la nube. G3 lo convierte en conflicto visible en
  cada dispositivo, pero no evita el estado en la nube.
  - **Cierre definitivo:** una regla que permita marcar el legacy con la reclamación de copia (hoy
    prohibido por `isAllowedClosureUpdate`) o una función servidor. Requiere desplegar reglas.
- **M2 — «Desconectar y restaurar».** A propósito no encola nada. Si después se vuelve a iniciar
  sesión en la **misma** cuenta, el snapshot de Caja Chica borra de este dispositivo lo restaurado que
  la nube no tiene (el archivo sigue siendo la copia). Reproducción:
  1. Con sesión, «Desconectar y restaurar» un respaldo con un movimiento que no está en la nube.
  2. Iniciar sesión otra vez.
  3. El movimiento desaparece.

  Hace falta una decisión de producto: pedir confirmación en el login o encolar en fusión.
- **M3 — comprobantes huérfanos en Supabase.** Borrar un movimiento borra el blob local y marca
  `deleted_at` en el espejo, pero `petty-cash-receipt` no tiene acción `delete`: el objeto
  `uid/txId` y su fila se conservan. Reproducción: borrar un movimiento con comprobante subido y
  hacer `lookup` del `txId`, que sigue respondiendo `ok`. Puede ser retención deseada. Si no, hace
  falta ampliar la función y el flujo n8n (despliegue externo).
- **M4 — índice sin desplegar.** Hasta desplegar `firestore.indexes.json`, no hay escucha en vivo
  de cierres ni historial remoto (queda el local con aviso), y crear un cierre falla cerrado si la
  verificación del período también fallara.
- **L — señal de foto sobre un empleado borrado físicamente.** `savePhotoSignal` hace
  `setDoc(merge)` y puede crear un documento con solo `photo`. La fusión entrante lo ignora (no tiene
  `id`). No hay pérdida, pero queda basura en Firestore.
- **L — la UI no indica que una foto está pendiente de subir.** Solo lo registra la consola y
  `getUploadRetryState()`.
- **FULL principal** (sin cambios): la nube puede reintroducir empleados que el archivo no trae,
  porque la subida es fusión. Es el diseño vigente.

## Verificación de Codex tras la ronda 3 (2026-09-28)

La prueba estructural `PayrollHistoryUI.test.js` esperaba filtros inline en `pullPage({…})`;
la refactorización los pasa mediante `pageOptions`. Se actualizó la aserción para comprobar
la definición de filtros y su paso real a `pullPage(pageOptions)`.

Suite completa ejecutada en este worktree:
`node node_modules/jest/bin/jest.js --runInBand --silent` → **494/494 suites,
4774/4774 pruebas PASS**, exit 0. Esta suite utiliza dobles locales; no certifica
Firebase, n8n o Supabase en producción. Los bloqueos M1–M4 y las limitaciones de la
matriz anterior permanecen.

---

# Ronda 4 — M1 (cerrojo atómico), M2 (restauración desconectada), M3 y secundarios (2026-09-28)

Se conservan sin cambios C1–C3, B1–B3, F1–F4, G1–G3 y la corrección de Codex en
`PayrollHistoryUI.test.js`. Sin commits, push, deploy, merge, nube real, Supabase real ni
n8n real. `firestore.rules` se modificó **solo como archivo del repo**. No hay emulador de
Firestore (no hay Java ni firebase-tools) ni Deno o CLI de Supabase: la nube se simula.

## M1 — carrera promoción ↔ copia de recuperación: cerrojo por `sourceId`

**Diseño.** Documento inmutable `users/{uid}/payrollClosureClaims/{sourceId}`
(`{sourceId, kind: 'promotion'|'recovery-copy', targetId, projectId, claimedAt}`). Cada camino lo
lee **dentro de su transacción** y, si no existe, lo crea en el **mismo commit** que su escritura.
Con concurrencia optimista (el SDK web valida en el commit incluso los documentos leídos como
inexistentes), dos transacciones que lo crean a la vez no pueden confirmar ambas: la segunda se
reintenta, ve el cerrojo y aborta. La consulta `recovery.sourceId ==` previa sigue existiendo, pero
solo para copias anteriores al cerrojo.

| Camino | Antes | Ahora (`PayrollClosureRepository.js`) |
|---|---|---|
| Promoción en la nube (`promoteLegacyCloudClosure`) | Consulta fuera de la transacción | Lee el cerrojo en la transacción. `recovery-copy` → no promueve (devuelve la copia si es de la misma obra; si no, `null`). Otro cerrojo → `PAYROLL_CLOSURE_RECOVERY_CONFLICT`. Sin cerrojo → promueve **y** crea `promotion`. |
| Subida de un promovido local (`saveOneScoped` con `promoted-legacy` sobre un schema 2) | No miraba copias | Igual que la promoción: exige o crea el cerrojo `promotion` |
| Copia de recuperación (creación) | Solo leía el original | Lee el cerrojo. `promotion`, otra copia u otra obra → conflicto. Sin cerrojo → crea `recovery-copy`. Ahora aplica a **toda** creación con `recovery.sourceId`, no solo a `saveRecoveredClosure`. |
| Lecturas, anulación y reintento idempotente de lo ya creado | — | No leen el cerrojo (siguen funcionando antes del despliegue) |

**Reglas (`firestore.rules`, sin desplegar).**
- `payrollClosureClaims`: `create` solo si el destino existe tras el commit (`getAfter`), la obra
  coincide y, según el tipo:
  - `promotion`: el cierre es promoted-legacy con `targetId == sourceId`;
  - `recovery-copy`: `recovery.sourceId` coincide y el origen no está promovido.
  `update: false`. `delete` solo si el destino ya no existe.
- `payrollClosures`: `isLegacyPromotion` exige un cerrojo `promotion` de la misma obra. Crear un
  nativo con `recovery` exige un cerrojo `recovery-copy` apuntando a sí mismo. Anular y el
  `updatedAt` estable no cambian.
- Con las reglas desplegadas, un **cliente antiguo** no puede promover ni crear copias sin cerrojo:
  falla cerrado (`permission-denied`) y no duplica.

**Antes del despliegue (BLOCK explícito, fail-closed).** Firestore niega leer
`payrollClosureClaims`.
- El cliente lo tipa como `PAYROLL_CLOSURE_CLAIM_UNAVAILABLE` (mensaje en español,
  `expectedRemoteUnavailable`).
- El historial muestra los cierres locales con el aviso, igual que con el índice ausente.
- La consulta por período falla cerrada, así que no se crea otro cierre encima.
- La copia en cola pasa a `dead` (código permanente). Tras desplegar, «Reintentar»
  (`retryFailedCloudSync`) la revive.
- No se escribe nada.

**Pruebas M1.**
- `js/tests/PayrollClosureClaimRaceM1.test.js`, 25 pruebas. Usa el Firestore en memoria con
  concurrencia optimista (lecturas de inexistentes incluidas) y un **modelo en JS** de las reglas.
  Cubre:
  - la reproducción exacta del informe: consulta vacía y la copia se confirma antes de la
    transacción (copia en otra obra y en la misma);
  - 16 entrelazados con barrera (ambas transacciones leen y esperan en el commit): promoción
    nube/subida × copia en otra/misma obra × gana promoción/copia × anulado sí/no. **Siempre una
    sola asignación**, con reintento del perdedor; filas, totales, estado y auditoría de anulación
    iguales;
  - dos copias a obras distintas a la vez;
  - reintentos idempotentes (cerrojo intacto, sin documentos nuevos);
  - cerrojo ajeno o desconocido → ambos fallan;
  - reglas sin desplegar → los tres caminos `CLAIM_UNAVAILABLE`, sin escrituras, `dead`, y el
    período falla cerrado;
  - lo ya promovido se lee y se anula sin cerrojo;
  - modelo de reglas: un cliente antiguo sin cerrojo es rechazado y el cerrojo no se reescribe;
  - contrato estático del texto de `firestore.rules`.
- Mutación: al quitar la lectura del cerrojo en la promoción, fallan 8 de 25 (incluida la
  reproducción del informe).
- Ajustes: `PayrollClosureSync.test.js` y `PayrollClosureU3DMatrix.test.js` usaban un
  `transaction.get` que devolvía el mismo documento para cualquier referencia. Ahora la segunda
  lectura es el cerrojo inexistente y se comprueba que se escribe. `PayrollClosureRecoveryPromotionRace`
  cuenta 3 documentos (original, copia y cerrojo).

**Veredicto M1:** el código cliente cierra la carrera (**ALLOW condicionado**), pero el sistema
queda en **BLOCK** hasta (1) ejecutar las pruebas de reglas en el emulador y (2) desplegar
`firestore.rules`. Hasta entonces la promoción y la copia están en pausa, sin duplicados.
Mientras haya clientes antiguos y reglas sin desplegar, la carrera antigua sigue siendo posible
entre clientes antiguos.

## M2 — «Desconectar y restaurar» → iniciar sesión en la misma cuenta

**Hallazgo ampliado.** Además de Caja Chica, el arranque del espejo **reemplaza**
`state.employees` con la nube si `localUpdatedAt` de la nube es mayor. Tras restaurar sin sesión,
ese valor depende de guardados incidentales, así que empleados, préstamos y líderes restaurados
también podían desaparecer del dispositivo. Lo mismo ocurría con «Restaurar local» y con FULL
**sin sesión** (FULL encolaba Caja Chica en fusión para cualquier cuenta que iniciara sesión).

**Diseño (`DetachedRestoreGuard.js`, `DetachedRestoreChoiceModal.js`).**
- Tras restaurar sin sesión (Desconectar y restaurar, Restaurar local sin cuenta o FULL sin
  cuenta) se guarda la marca local `asistencia_detached_restore_v1`. No se sincroniza y
  «Borrar datos locales» la elimina.
- **Mientras exista la marca no sube nada:** `_canSyncFirebase`, `hasSession` de la cola
  principal, `PettyCashStore.flush` y `flushMirror`. Esto cubre también el evento `online`.
- En el login, **después** del guardián de dueño y **antes** de reclamar el dueño, iniciar
  Proyectos, drenar colas, Caja Chica, el espejo o las listas en vivo, se abre el diálogo
  (design.md: tarjetas, pista en el footer, sin emoji ni `confirm`):
  - **Subir lo restaurado a esta cuenta** (muestra el email). Mismo contrato que la restauración
    de snapshot: `prepareRestoredState` re-estampa, se reinician los watermarks de subida y la
    asistencia sube por `dateKeys`; Caja Chica va en `enqueueRestored(…, 'replace')`. Lo
    restaurado gana en los mismos ids y lo que solo existe en la nube se conserva.
  - **Usar los datos de la nube**: `replaceLocalWithCloud()` (primero lee todo; si falla, no toca
    nada y recarga). Se descarta lo restaurado; el archivo no cambia.
  - **Cerrar sesión** (también con Escape o al cerrar): todo queda local y la marca se conserva.
- La marca se retira antes de ejecutar la opción y se **repone** si esta falla (se vuelve a
  preguntar y se cierra sesión).
- **Otra cuenta:** manda el guardián de dueño existente (borrar local o cerrar sesión); no se
  sube nada. En un dispositivo sin dueño, la subida exige la elección explícita con el email
  visible.

**Pruebas M2.**
- `PettyCashDetachedRestoreM2.test.js` (9 pruebas, 2 dispositivos, PettyCashStore y repositorio
  reales): control que reproduce la pérdida sin la puerta; nada sube antes de decidir (ni con
  `online` ni con pendientes previos); subir → la nube tiene lo restaurado y lo propio, B lo
  recibe y el reinicio es normal; nube → no sube nada; cerrar sesión o cerrar el diálogo → local
  intacto, marca conservada y el siguiente login sube; fallo al subir → marca repuesta y logout;
  sesión cambiada mientras el diálogo está abierto → no hace nada; marca ilegible = marca.
  - Mutación: sin el guardia de `flush`, falla «nada sube antes de decidir».
- `DetachedRestoreGuardM2.test.js` (7 pruebas): bloqueo en PersistenceService y PettyCashStore;
  FULL sin sesión marca y no encola; con sesión, encola en fusión como antes; manifiesto de
  borrado; diálogo (3 tarjetas, `Continuar` deshabilitado con motivo, escapado del email, Escape
  = null, sin emoji).
- `RestoreCloudReplaceWiring.test.js`: contrato de app.js (orden guardián de dueño → puerta →
  reclamo de dueño → drenado, Caja Chica y espejo; secuencia de `uploadDetachedRestoreToAccount`).
- Chromium (`scripts/check-payroll-closure-backup.cjs`, ampliado): FILE a 1280 y FULL a 390 sin
  cuenta dejan la marca y 0 entradas en `pettyCashOutbox`. PASS en ambos, 0 errores de página.
- Diálogo en Chromium a 390 y 1280 (script en `/tmp`): 3 tarjetas, sin desbordamiento, foco en
  la primera opción y elección devuelta. PASS.

**Veredicto M2:** **ALLOW** (local y simulado). Caja Chica está probada de extremo a extremo con
dos dispositivos. La ruta de empleados, préstamos y asistencia reutiliza el contrato probado de la
restauración de snapshot y se verifica por cableado; no hay prueba contra Firestore real.

## M3 — borrado remoto del comprobante: **BLOCK con propuesta**

**Verificado en el código.**
- La app llama al webhook n8n `RECEIPT_UPLOAD_URL` con `{idToken, txId, action}`.
- `petty-cash-receipt` verifica el `idToken` de Firebase con `accounts:lookup` y solo acepta
  `upload` (`upsert`, ruta estable `uid/txId`) y `lookup` (URL firmada de 600 s).
- La tabla `petty_cash_receipts` tiene RLS sin políticas y solo `service_role`.
- El espejo `petty_cash_movements` hace **borrado lógico** (`deleted_at`) sin comparar versiones.

**Motivo del bloqueo:**
1. No hay en el repositorio una decisión de retención. El comprobante es evidencia financiera y
   hasta el espejo conserva el movimiento borrado.
2. El flujo n8n no está en el repositorio: no se puede verificar que reenvíe `action` y los nuevos
   campos sin registrar el cuerpo.
3. Sin versión en la petición, un borrado encolado sin conexión podría borrar la foto **nueva** de
   un movimiento recreado con el mismo `txId`.

**No se tocó ningún comprobante, función, migración ni política.**

**Propuesta concreta (para aprobar antes de implementar):**
- **Migración:** `deleted_at timestamptz` y `status in ('confirmed','uploaded','deleted')`. No se
  borra el objeto.
- **Acción `delete`** con `{idToken, txId, ifUploadedAt}`:
  - si la fila coincide con `uploaded_at = ifUploadedAt`, marca `status='deleted'` y `deleted_at`
    (borrado lógico, idempotente);
  - si la fila no existe → `200 {deleted:false, absent:true}`;
  - si `uploaded_at` no coincide → `409 RECEIPT_VERSION_MISMATCH`, que el cliente trata como éxito
    sin cambios.
- **Upload:** el `upsert` limpia `deleted_at` (recrear resucita con la foto nueva).
- **Lookup:** devuelve `404 RECEIPT_DELETED` si `deleted_at` tiene valor.
- **Purga física:** tarea programada con `service_role` después de N días (N por decidir).
- **Cliente:**
  - guardar el `receipt.uploaded_at` del servidor en el job (hoy se guarda `Date.now()` local);
  - añadir un store IndexedDB `pettyCashReceiptDeletes` con clave `txId`, drenado con backoff al
    haber sesión o volver `online`;
  - guardar un comprobante nuevo con el mismo `txId` cancela el borrado pendiente.
- **Pruebas:** borrar, reintentar (idempotente), recrear antes del drenado (no borra la foto
  nueva), 409 y lookup de un borrado.
- **Despliegue:** migración, `supabase functions deploy petty-cash-receipt` y un cambio en n8n
  que reenvíe `action` e `ifUploadedAt` sin registrar el cuerpo.

## Prioridad 4 — secundarios

| Asunto | Resultado |
|---|---|
| Índice `payrollClosures` sin desplegar (M4) | Sin cambios de código: ya degrada al historial local con aviso (F3). Despliegue pendiente. |
| Señal de foto sobre un empleado borrado (L) | **Corregido.** `EmployeeRepository.savePhotoSignal` escribe en una transacción solo si el documento existe. Una señal `deleted` sin empleado se omite (`{skipped:true}`). Una `ready` sin empleado (aún no subido) falla con `EMPLOYEE_PHOTO_SIGNAL_NO_EMPLOYEE` reintentable y entra en el backoff del servicio. No se crean documentos con solo `photo`. |
| Indicador de subida pendiente (L) | **Corregido.** `EmployeePhotoService.getPendingUploadStatus` y una línea `role=status` en la hoja de foto: «Esta foto está guardada en este teléfono y aún no se subió a la nube. Se reintentará sola.» No hay insignia en el avatar. |
| FULL con sesión puede reintroducir empleados de la nube | Sin cambios: es el diseño vigente (subida en fusión). Para reemplazar se usa «Borrar y Reemplazar Nube». Sin sesión, ahora se pregunta en el login (M2). |

Pruebas: `EmployeePhotoMetadataTests` (transacción: existe, no existe con `deleted` y no existe
con `ready`) y `EmployeePhotoProxyOutageCycle` (pendiente por falta de empleado, sin documento
fabricado, y se publica cuando el empleado existe; línea de la hoja visible u oculta).

## Validación con los dos respaldos privados (solo local)

Script privado en `/tmp/sa-claude-two-backups-20260927/r4/` (no está en el repo). Usa los módulos
reales del worktree y registra solo conteos. Checksums verificados: T `9e14662d…`, C `ad3c0347…`.

- **M1 con los 3 cierres de T** (dos schema 2 sin obra y uno v1): plan de recuperación real
  (`planFinancialRecovery`) contra la promoción.
  - Gana la promoción: 2 promociones, 1 copia (el v1 no es promovible) y 2 conflictos del
    perdedor.
  - Gana la copia o la consulta está desfasada: 3 copias y 0 promociones.
  - En los 3 casos, **1 asignación por cierre**, con filas, totales, estado y anulación
    idénticos.
- **M2 con la Caja Chica real** (T: 40 movimientos; C: 84), con otro dispositivo y un movimiento
  solo en la nube:
  - **Subir:** 40/40 y 84/84 en la nube; B ve 41 y 85; importes idénticos; la cola termina vacía
    con 0 `dead`.
  - **Nube:** 0 subidos.
  - **Cerrar sesión:** 0 subidos, 40 y 84 locales intactos, y la marca se conserva.
  - Antes de decidir, la nube seguía con 1 documento.

## Qué es simulado y qué requiere despliegue

- **Simulado:** Firestore en memoria (transacciones optimistas, `where` y `onSnapshot`); modelo en
  JS de las reglas M1; backend de imágenes falso; `useCloud` sustituido en las pruebas de la
  puerta; Chromium sin Firebase (todo lo de Google y n8n bloqueado).
- **Requiere despliegue / validación externa:**
  1. Emulador: pruebas de reglas de `payrollClosureClaims` e `isLegacyPromotion` (no hay Java ni
     firebase-tools aquí).
  2. `firebase deploy --only firestore:rules` y `firebase deploy --only firestore:indexes`.
  3. M3 según la propuesta (migración, función y n8n).

## Pasos de operación

1. Revisar el diff de `firestore.rules`. Ejecutar la suite de reglas en el emulador con los casos
   de `PayrollClosureClaimRaceM1` (promoción con y sin cerrojo, copia con y sin cerrojo, cerrojo
   inmutable y borrado condicionado).
2. Desplegar y validar primero las reglas; después el índice y el cliente. Hasta que las
   reglas estén activas, clientes antiguos todavía pueden crear una copia y promover el mismo
   cierre sin cerrojo. El cliente nuevo falla cerrado antes del despliegue.
3. Tras el despliegue, los dispositivos con copias en `dead` por `PAYROLL_CLOSURE_CLAIM_UNAVAILABLE`
   pulsan «Reintentar».
4. Comprobar en la consola que aparecen documentos en `users/{uid}/payrollClosureClaims` al abrir
   el historial de la obra por defecto con cierres antiguos.
5. Actualizar `BuildInfo.js`/`sw.js` (CACHE_VERSION) en el commit, si el flujo de publicación lo
   exige (no se hizo).

## Resultados

- Focales (17 patrones → 24 suites): **24/24 suites, 257/257 pruebas PASS**, exit 0.
- Suite completa `node node_modules/jest/bin/jest.js --runInBand --silent`:
  **497/497 suites, 4821/4821 pruebas PASS**, exit 0. La primera ejecución de esta ronda dio
  495/497: dos pruebas estructurales de distancia de texto (`AppWiringMigrationTests`,
  `SyncRegressionTests`). Se corrigió reestructurando el código (puerta en
  `passDetachedRestoreGate`, comentario fuera de la condición), sin relajar las pruebas.
- Chromium `scripts/check-payroll-closure-backup.cjs`: FILE 1280 y FULL 390 PASS (con la marca
  M2), exit 0.
- Script privado con los respaldos: 9/9 PASS, exit 0.

## Limitaciones

- La atomicidad de M1 en producción depende de las reglas desplegadas; las reglas no se
  compilaron ni se ejecutaron en un emulador.
- «Subir lo restaurado» no sube los cierres de nómina restaurados: siguen solo en local, como en
  las rondas anteriores. La nube no los borra.
- Con «Subir», lo restaurado gana sobre ediciones posteriores de los mismos registros hechas en
  otros dispositivos. Lo dice la tarjeta.
- «Restaurar local» **sin sesión** ya no sube Caja Chica automáticamente en el siguiente login
  (antes era ALLOW en la ronda 3): ahora pide elegir.
- El indicador de foto pendiente está solo en la hoja de foto; no hay insignia en el avatar.
- Dictamen limitado a estas rutas; no es un ALLOW general del sistema.

## Revisión adicional de Codex — interrupción durante M2 (2026-09-28)

Se encontró una ventana entre quitar la marca de restauración desconectada y terminar
la subida autorizada. Un cierre de pestaña en ese intervalo evitaba que el siguiente
login volviera a solicitar la elección. Ahora la marca persiste hasta que el guardado
y el encolado de Caja Chica terminan; únicamente esa operación tiene una excepción
de sincronización temporal en esta pestaña. El flush de Caja Chica se espera antes de
confirmar la elección. Si la operación falla o se interrumpe, la marca sigue presente.

Una prueba nueva pausa la subida a mitad de camino y comprueba que la marca durable
sigue activa; las pruebas de dos dispositivos y el diálogo también pasan. Se ajustaron
las comprobaciones estructurales al nuevo parámetro `awaitFlush`. Suite completa:
**497/497 suites, 4822/4822 pruebas PASS**, exit 0. `git diff --check` PASS.
La validación de reglas con el emulador y su despliegue siguen pendientes: M1 permanece
BLOCK. No se hicieron cambios de nube ni despliegues.

## Verificación adicional con emulador real de Firestore (2026-09-28)

Codex ejecutó el emulador Firestore v1.22.0 en `127.0.0.1` con las reglas del
worktree y un JRE temporal, sin usar credenciales, cuenta ni nube productiva.
El arnés temporal en `/tmp/sa-firestore-emulator-jre/rules-smoke.cjs` usó
`@firebase/rules-unit-testing` y el SDK Firestore contra el emulador (proyecto
`demo-sa-claims`). Salida: 7 verificaciones PASS, exit 0:

- Promoción legacy sin cerrojo: DENEGADA; promoción y cerrojo en la misma
  transacción: ACEPTADOS.
- Cambio o borrado de un cerrojo cuyo destino existe: DENEGADOS. Otra cuenta
  no puede leerlo.
- Copia de recuperación sin cerrojo: DENEGADA; copia y cerrojo en la misma
  transacción: ACEPTADOS. La promoción posterior sin cerrojo ganador: DENEGADA.
- Dos transacciones compiten por el mismo `sourceId` (copia frente a promoción):
  **una confirma y otra recibe denegación**; no se duplicó el cierre.

Las reglas compilaron y se aplicaron en el emulador. Las operaciones denegadas
mostraron a veces el límite de evaluación de 1000 expresiones junto con
`PERMISSION_DENIED`; es un error de denegación y no se observó en escrituras
aceptadas. Esta prueba es un smoke test con documentos sintéticos; la prueba
`PayrollClosureClaimRaceM1` cubre los 16 entrelazados en el modelo en memoria.
**M1 permanece BLOCK para producción hasta desplegar primero estas reglas** y
verificar la versión activa. Después puede publicarse el cliente y el índice.

---

# Ronda 5 — emulador real, bloqueos M1–M3, navegación Atrás y revisión (2026-09-28)

Se conservan C1–C3, B1–B3, F1–F4, G1–G3 y las correcciones M1/M2 de la ronda 4. Sin
commits, push, merge ni despliegues; sin escrituras en Firebase, Supabase ni n8n
reales. Los respaldos privados solo se usaron en `/tmp` y este informe contiene solo
conteos. Checksums verificados antes y después: T `9e14662d…`, C `ad3c0347…`.

## Niveles de evidencia

| Nivel | Qué es | Se usó para |
|---|---|---|
| **E1 — emulador real** | Emulador Firestore v1.22.0 en `127.0.0.1`, `firestore.rules` del repo, SDK web real y `PayrollClosureRepository` real (dos clientes) | reglas M1, carreras, clientes antiguos (código de `main`), orden de despliegue |
| **E2 — PostgreSQL real (WASM)** | PGlite: motor PostgreSQL, sin Supabase (sin PostgREST, supabase-js, Storage ni privilegios por defecto de Supabase) | migraciones de comprobantes |
| **E3 — Chromium real** | Chromium headless (snap), app servida del worktree, Google/Firebase/n8n/Supabase bloqueados | navegación Atrás, dos pestañas, fotos, respaldos privados, cierres |
| **E4 — Jest** | jsdom + fake-indexeddb + dobles; backend de comprobantes en memoria con la **misma** lógica que la función | colas, UI, contratos |
| **E5 — sondas de solo lectura** | `GET` a webhooks n8n y `OPTIONS` a funciones Edge, sin cuerpo ni credenciales | estado de n8n/fotos |

Nada de esto certifica producción.

## M1 — reglas de cierres: defectos encontrados en el emulador (E1)

1. **Defecto grave (también en las reglas de `main`)**: anular un cierre o actualizar su
   `updatedAt` estable se denegaba con «maximum of 1000 expressions». `isClosure()` volvía a
   comprobar la forma completa en cada variante y en cada lado del `update`. Con las reglas de
   `main` falla incluso anular un cierre **nativo**; si esas reglas están desplegadas, las
   anulaciones de nómina no llegan a la nube (quedan en `dead`). Corrección: la forma se
   comprueba una vez por documento (`isShapedClosure`) y las variantes solo miran los campos
   que las distinguen. Semántica sin cambios (mismas pruebas de denegación).
2. **El perdedor de la carrera recibía `permission-denied`** (el emulador evalúa las reglas
   antes que la precondición de lectura), no el conflicto tipado; la copia acababa en `dead`
   con un error genérico. Corrección: `runClaimTransaction` repite una vez tras
   `permission-denied`; la segunda pasada ve el cerrojo ganador.
3. **Copias previas al cerrojo duplicaban la nómina**: subir un promovido local o crear una
   copia hacia otra obra no miraba copias sin cerrojo. Corrección: consulta
   `recovery.sourceId` antes de ambas rutas (el conjunto de copias sin cerrojo no crece tras
   desplegar las reglas, así que la consulta fuera de la transacción basta).

`js/tests/emulator/PayrollClosureClaimRules.emulator.test.js` (**38/38**, exit 0): 16
entrelazados reales (promoción nube/subida × copia misma/otra obra × orden × anulado), dos
copias concurrentes, copias previas al cerrojo, anulados, otra obra, cerrojo inmutable y
borrado condicionado, otra cuenta, cierre de 54 filas, cliente antiguo con reglas nuevas,
cliente nuevo con reglas de `main` (falla cerrado, cero escrituras) y línea base (reglas y
cliente de `main` **duplican** la nómina). Con las reglas anteriores fallan 4.
Se ejecuta con `jest.emulator.config.cjs` (excluido de `npm test`).

## Orden de despliegue (nada desplegado)

1. **Reglas Firestore** (`firebase deploy --only firestore:rules`) y verificar la versión activa.
   Arreglan además las anulaciones (defecto 1).
2. **Índices** (`firebase deploy --only firestore:indexes`); comprobar con
   `firebase firestore:indexes --project <id> > deployed.json` y
   `node scripts/check-firestore-indexes.cjs --deployed deployed.json` (0 = todos READY;
   2 = falta o construye). Mientras falte, el historial degrada a local con aviso.
3. **Cliente** (este PR). Con reglas nuevas y cliente viejo: no promueve ni copia
   (`permission-denied`, sin duplicados) y su historial en la obra por defecto falla mientras
   quede algún legacy sin promover; se normaliza en cuanto un cliente nuevo lo promueve
   (probado en E1). Tras publicar: «Reintentar» revive las copias en `dead` por
   `CLAIM_UNAVAILABLE`.
4. **Comprobantes (M3)**, en este orden: migración
   `202609280001_petty_cash_receipt_soft_delete.sql` → `supabase functions deploy
   petty-cash-receipt` → comprobar que el flujo n8n `caja-chica-subir` reenvía `action`,
   `ifUploadedAt` y `uploadToken` sin registrar el cuerpo. La función nueva **falla** sin la
   migración (escribe `upload_token`/`deleted_at`). El cliente nuevo tolera la función vieja:
   `INVALID_ACTION` deja la petición en espera sin gastar intentos.

## M2 — restauración con dos pestañas

Hallazgo (E3, reproducido): una pestaña abierta **antes** de restaurar conserva el dataset
anterior en memoria (la época del dataset es por pestaña). Sin guarda, un guardado de esa
pestaña mezcló datos viejos sobre lo restaurado en IndexedDB. Corrección
(`CrossTabDatasetGuard.js`): todo reemplazo completo (`advanceDatasetEpoch`) se anuncia por
`localStorage`; las otras pestañas bloquean guardados implícitos (incluido `pagehide`) y
recargan. Si otra pestaña resuelve la decisión de «restauración desconectada» con el diálogo
abierto aquí, esta recarga. `scripts/check-cross-tab-restore.cjs` 2/2 (falla al quitar la
guarda); `CrossTabDatasetGuardM2.test.js` 4/4. La marca durable ante cierre a mitad de
subida sigue probada (ronda 4).

## M3 — comprobantes: borrado lógico, versionado y cola

Sin decisión de retención, no se purga nada:
- **Función** (`receipt-actions.js` + `index.ts`): `delete` y `restore` lógicos con CAS sobre
  `uploaded_at` (409 si hay versión más nueva); `lookup` de un borrado → 404
  `RECEIPT_DELETED`; con `uploadToken` cada versión tiene ruta propia `uid/txId/token`, así
  reemplazar la foto **ya no sobrescribe** la anterior (se archiva en
  `petty_cash_receipt_versions`); sin token (clientes viejos) se mantiene la ruta estable.
- **Cliente**: cola durable en `pettyCashMirrorOutbox` (`kind: 'receipt-delete'`, sin subir la
  versión de IndexedDB; el espejo la ignora), por cuenta exacta, con espera exponencial,
  `dead` a los 20 intentos, puerta M2. Nunca borra el comprobante de un movimiento que existe
  localmente (restaurado/recreado). Un comprobante nuevo cancela la petición. Se corrigió la
  **resurrección** de un movimiento borrado mientras su comprobante se subía (ahora se pide el
  borrado lógico de esa versión).
- Pruebas: `PettyCashReceiptRemoteDeleteM3` 10/10, `PettyCashReceiptUiDeleteM3` 2/2 (falla
  sin la corrección de resurrección), `PettyCashMirrorOutbox` +1.
- **Migración** en PGlite (`scripts/check-supabase-receipt-migration.mjs`, 7/7): aplica en
  orden, re-ejecutable, filas previas válidas, CAS una sola vez, restricciones y reactivación.
  **No se ejecutó en Supabase/PostgreSQL gestionado; el adaptador supabase-js y la función
  Deno no se ejecutaron** (no hay Deno ni CLI).

## Fotos del personal y n8n (E5, E3, E4)

- Sondas `GET` (sin cuerpo): los webhooks `app-images`, `caja-chica-subir` y `caja-chica-ocr`
  están **registrados para POST** hoy (el 404 de la ronda 3 era un flujo inactivo entonces).
  `OPTIONS` a la función `app-images` desde un origen no permitido → 403: no hay atajo local
  sin cambiar `APP_IMAGES_ALLOWED_ORIGINS`. No se envió ningún POST.
- `scripts/check-employee-photo-flow.cjs` (6/6, sin sesión, 0 llamadas a n8n/Supabase):
  elegir foto desde la ficha, verla tras recargar, visor y hoja cerrados con Atrás, eliminar.
  La subida con sesión, el reintento ante el 404 y la señal en Firestore siguen cubiertos por
  Jest (12 suites / 144 pruebas de fotos). Hallazgo menor, sin corregir: eliminar foto usa
  `confirm()` nativo (design.md lo prohíbe).

## Navegación Atrás/Adelante (PWA)

`AppHistory.js` se conecta a la navegación central (`changeTab`/`changeSettingsTab`, evento
`render:complete`) y detecta capas en el DOM (`[aria-modal]`, `[role=dialog]`,
`.modal-overlay`, `.floating-card`, `[data-history-layer="on"]`). Atrás cierra primero la capa
superior con su control de cierre seguro (nunca «Cerrar sesión»/«Cerrar periodo») o Escape;
luego vuelve a la vista anterior; Adelante reabre vistas, no diálogos. En standalone, la vista
inicial avisa «Pulsa Atrás otra vez para salir» y el segundo Atrás sale; la guardia se rearma
solo tras un toque. Sin cambiar la URL; `pushState` solo con activación de usuario.
El onboarding retrocede de paso. Un diálogo que no se deja cerrar no atrapa (revisión de
Codex: `handlingLayerPop` y capas no cerrables). Semántica de cierre revisada: × de cambios
entrantes = descartar sin pausar; confirmaciones = cancelar; restauración desconectada =
cerrar sesión (su salida conservadora documentada).

Defecto previo corregido al probar: `batchSetState` programaba `window.render`, que programa
el render real con `_rendering` activo; ese render quedaba en cola (el perfil abierto con un
toque no se pintaba). `RenderOptimizer` drena la cola; 0 renders en reposo (sin bucles).

Pruebas: `scripts/check-mobile-back-navigation.cjs` 12/12 (Chromium 390 standalone: pestañas
sin duplicados, perfil, ficha + hoja anidadas, ×, Adelante, subvistas, Ajustes con cambios sin
guardar, recarga, doble Atrás, guardia; onboarding; escritorio 1280 sin guardia);
`AppHistoryBackNavigation.test.js` 12/12. No participan: selectores de fecha, menú contextual
de semana y menú de exportación (popovers que se cierran al tocar fuera). `display-mode` se
simula (CDP no lo emula). **Prueba manual pendiente en Android real**: instalar la PWA, abrir
Personal → perfil → gesto Atrás (cierra perfil) → Atrás (Asistencia) → Atrás (aviso) → Atrás
(sale); repetir con un toque entre avisos (no sale).

## Respaldos privados (E3)

Matriz de 8 escenarios (T/C × FILE/FULL × dispositivo nuevo/misma obra × manual/«Asignar
todo»): exit 0 y 0 errores de página en todos. Estado final tras recargar **idéntico** a la
ronda 2, salvo C·FILE·misma obra, donde `miniImportAudit` ahora se conserva (coherente con
B3). Cambian solo métricas intermedias: metadatos locales `lastAccessed` y el diagnóstico
«asistencia sin empleado» tras importar (162→163, igual al origen).

## Cambios de esta sesión de revisión

- `BootLoader.test.js` vuelve a prohibir el literal `2500`; `app.js` usa `EXIT_HINT_MS`.
- Migración re-ejecutable y con orden de despliegue en cabecera; validación PGlite.
- Cola M3: dueño exacto (sesión o dueño local; nunca otra cuenta) y nunca borrar el
  comprobante de un movimiento vivo.
- Nuevas pruebas/arneses: UI M3, dos pestañas, fotos en Chromium, migración PGlite.

## Resultados

| Verificación | Resultado |
|---|---|
| Jest completo `--runInBand` | **502/502 suites, 4859/4859**, exit 0 |
| Emulador Firestore (SDK real) | **38/38**, exit 0 |
| Chromium navegación / dos pestañas / fotos / cierres | 12/12, 2/2, 6/6, PASS (FILE 1280 y FULL 390) |
| Índices (repo) / migración PGlite | exit 0 / 7/7 |
| Respaldos privados | 8/8 exit 0 |
| `git diff --check` | PASS |

## Riesgos y límites

- Producción no verificada: reglas, índices, función, migración y n8n sin desplegar.
- Subidas concurrentes del mismo `txId` con tokens distintos: el objeto perdedor queda en
  Storage sin fila de versión (no hay pérdida; queda sin referenciar).
- Borrados de comprobantes hechos por clientes viejos no llegan a Supabase (retención).
- «Borrar nube» no borra cierres ni cerrojos (sin cambios; son evidencia financiera).
- H1 (duplicado nube por clientes viejos) solo queda cerrado tras desplegar las reglas.
- La guarda de pestañas depende del evento `storage` (mismo origen y perfil).

## Integración al PR por Codex — 2026-09-28

Confirmación independiente previa al commit: 502 suites y 4859 pruebas, exit 0. El control de escrituras de estado detectó tres asignaciones nuevas en applyHistoryView; se agruparon con stateManager.batchSetState conforme a la regla del repositorio.
