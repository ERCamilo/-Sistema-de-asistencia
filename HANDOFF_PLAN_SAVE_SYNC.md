# Handoff — Plan de mejoras al sistema de guardado y sincronización

> Documento para retomar el trabajo en una nueva sesión de Claude Code cuando la actual se sature.
> **Última actualización**: tras commit `0569fc4` — Suite 625/625 ✅ · 41 commits en `main` sin push.

---

## 1. Contexto del proyecto

App PWA de control de asistencia que vive en `aplicacionFull/`. Tres usuarios reales activos. Sincroniza con Firebase. El usuario reportó pérdidas de datos entre dispositivos (préstamos, segundos empleos) y de ahí salió todo este plan.

**Stack relevante:**
- JS modular sin framework. `js/app.js` es el entrypoint (~6000 líneas).
- `js/modules/` agrupado en `services/`, `ui/`, `features/`, `components/`, `core/`, `utils/`.
- Persistencia: IndexedDB (local) + Firebase Firestore (cloud) + localStorage (fallback legacy).
- Tests con Jest + jsdom. Adaptador `testRunner.addSuite()` traduce a `describe/it`.
- PowerShell como shell (entorno Windows). El bash del harness es minimalista — usar PowerShell para todo lo no-trivial.

---

## 2. Reglas que el usuario fijó (NO romper)

### Idioma
- **Memoria base**: responder en INGLÉS aunque el usuario escriba en español (está entrenando inglés).
- **Override actual**: el usuario ha pedido explícitamente que las respuestas de este plan vayan en **español**. Mantener español hasta que diga lo contrario.

### TDD obligatorio
- **Regla persistente en memoria** (`testing_workflow.md`): siempre escribir tests para el sistema de guardado **ANTES** de implementar la funcionalidad.
- Cada commit debería incluir tests + implementación juntos.
- Suite verde antes de commitear.

### Git
- ✅ Hacer commits a `main` libremente.
- ❌ **NO hacer `git push`** hasta autorización explícita del usuario.
- Mensajes de commit en inglés, descriptivos, con bloque Co-Authored-By.
- Pasar el mensaje por archivo temporal (`.git/COMMIT_MSG_TEMP`) usando `git commit -F`, porque PowerShell rompe heredocs con caracteres especiales.

### Estilo de respuesta
- Conciso, sin floritura. El usuario premia eficiencia.
- Cuando el usuario dice "procede" / "ok" / "si", proceder con la propuesta más reciente sin volver a preguntar.
- Auto mode activo: no parar para pedir confirmación salvo bloqueos reales.

---

## 3. Bug raíz original y cómo se cerró

### Síntomas reportados por el usuario
- Préstamos guardados en un dispositivo no aparecen en otro.
- Al guardar en el segundo dispositivo, sobreescribe y se pierden los préstamos del primero.
- Mismo problema con segundos empleos (positions añadidas a un empleado).
- Dos ventanas mostrando contadores distintos (19 activos vs 20; 8 préstamos vs 13).

### Causa raíz
1. Firebase mirror sync escribía TODO el `state.employees[]` como un solo arreglo en `users/{uid}/data/current` con `setDoc()` sin `merge:true`. Last-write-wins sobre arreglos en Firestore borra los items que el dispositivo escritor no conoce.
2. `schemaVersion` (bandera de "ya migré") vivía solo en memoria; si Firebase tardaba, la app caía al camino legacy y contaminaba la nube.
3. `mergeEmployees` no estaba consciente de la nube — el wizard de duplicados resolvía local pero dejaba docs huérfanos en la subcolección.
4. Tres formatos distintos de id de empleado (UUID, `EMP\d+`, `emp-\d+`) crearon **11 duplicados reales** en `users/Mm5b8gR9ydTPr9kMpgD5tleVCk62/employees/` (34 docs para 23 personas).

### Solución implementada
Migración a modelo **per-document**: cada empleado vive en `users/{uid}/employees/{id}` en lugar de un arreglo en el documento parent. Combinado con:
- `merge:true` en todas las escrituras.
- `flushPendingSave` en `pagehide`/`visibilitychange` para no perder cambios al cerrar pestaña.
- Live sync con `onSnapshot` sobre la subcolección.
- Merge por id en arreglos del empleado (loans, advances, payments) para que dos dispositivos editando offline al mismo empleado no se borren mutuamente.
- Pre-apply hook que pregunta al usuario antes de aplicar cambios remotos significativos (borrados, divergencias de campos críticos).

---

## 4. Tareas completadas (28 commits + 5 cleanup/style)

| # | Tarea | Commit | Tests añadidos |
|---|-------|--------|---|
| 1 | Fase 1.3 — `pagehide`/`visibilitychange` flush | `0e581ad` | 3 |
| 2 | Fase 1.2 — `{merge:true}` en `saveFullState` | `07ca736` | (luego) |
| 3 | Snapshot A — `reason`/`reasonLabel` en metadata | `90502f7` | 13 |
| 10 | Tests retroactivos para 1.2/1.3/Snapshot A | `d83d3d8` | 23 |
| 4 | Snapshot H — toast cuando se crea snapshot automático | `ea463c7` | 12 |
| 6 | Snapshot B — modal de diff antes de restaurar | `048bf20` | 20 |
| 5 | Fase 4.1 paso 1 — `SchemaMigration` (helper puro) | `0d59e1f` | 22 |
| 11 | Fase 4.1 paso 2 — `EmployeeRepository` | `df596e8` | 18 |
| 12 | Fase 4.1 paso 3a — `SchemaMigrationRunner` orquestador | `e84a895` | 11 |
| 12b | Fase 4.1 paso 3b — `FirebaseService.migrateIfNeeded` + `loadEmployeesIfMigrated` | `093328f` | 10 |
| 13 | Fase 4.1 paso 4 — `EmployeeLoader` + cableo en app.js | `fe439b3` | 16 |
| 7 | Fase 2.1 — live sync onSnapshot (`EmployeesLiveSync`) | `3732988` | 13 |
| 8 | Fase 2.2 — merge por ID (`EmployeeMerge`) + `mergeRemote` | `da58dc7` | 25 |
| 14 | Unificación préstamos — perfil read-only + ledger único | `8ce9b28` | 14 |
| 14b | Fix: picker → form directo (sin paso por perfil) | `b928aeb` | 10 |
| 9 | Fase 3.2 — badge "Última sincronización" en header | `8970abc` | 37 |
| 15 | Timestamps — `emp.updatedAt` en mutaciones de préstamos | `f4f401b` | 8 |
| 16 | Timestamps — UI "Último cambio" en ledger + perfil | `67309fc` | 13 |
| 17 | `analyzeConflicts({cloudEmployees})` — cloud-aware | `46c78b6` | 9 |
| 18 | `_pendingCloudDeletes` + drain en `_executeSave` | `f454ef1` | 8 |
| 19 | `ConflictPlanner` (opción B: nombres idénticos) | `c68e3c2` | 30 |
| 20 | `MaintenanceUI` cloud-aware + preview modal | `155fcf6` | 10 |
| 21 | `validateManualGroup` (helper puro) | `0eabd75` | 11 |
| 22+23 | Paso manual con 3 roles + sub-modal reasignar | `8f74362` | 6 |
| 24 | `applyManualGroup` con cascada de reasignaciones | `79dc9b0` | 9 |
| 25 | Botón "Revisar TODO manualmente" en preview | `4d71986` | 3 |
| — | Badge en modo icono-solo (UX consolidado) | `2277573` | 7 |
| 26 | Track 2 — `IncomingChangeDetector` (helper puro) | `3e7d503` | 17 |
| 27 | Track 2 — `IncomingChangeModal` (UI) | `de3b6be` | 8 |
| 28 | Track 2 — hook en `subscribeToChanges` + badge clickable | `43e3fd7` | 8 |
| — | UI cleanup manual del usuario (CSS, MaintenanceUI redesign) | `0569fc4` | — |

**Total**: 282 tests → 625 tests (**+343 tests nuevos**).

---

## 5. Arquitectura por capas (estado actual)

```
┌─────────────────────────────────────────────────────────────────┐
│                              UI                                 │
│  Header (con badge clickable) · MaintenanceUI · ProfileModal    │
│  LoansLedger · SnapshotDiffModal · IncomingChangeModal · ...    │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                         Orquestación                            │
│  PersistenceService — saveApplicationData/loadApplicationData,  │
│    debounce 300ms, flushPendingSave, _pendingCloudDeletes drain.│
│  EmployeeLoader — combine migrate + load.                       │
│  EmployeesLiveSync — singleton del onSnapshot listener.         │
│  SyncStatus — pub/sub del lastSyncedAt.                         │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                          Servicios                              │
│  FirebaseService — saveFullState (con merge:true),              │
│    migrateIfNeeded, loadEmployeesIfMigrated, createSnapshot,    │
│    subscribeToChanges, syncHistory.                             │
│  EmployeeRepository — loadAll, saveOne/saveMany (mergeRemote),  │
│    deleteOne, subscribe.                                        │
│  IndexedDBService — saveState, loadFullState, batchUpdate.      │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                       Lógica pura (helpers)                     │
│  SchemaMigration — needsMigration, prepareEmployeeMigrationWrites│
│  SchemaMigrationRunner — orquestador con DI                     │
│  EmployeeMerge — fusión por id de arreglos                      │
│  ConflictPlanner — buildConflictPlan, executeMergePlan          │
│  ManualGroupValidator — validateManualGroup                     │
│  IncomingChangeDetector — detectIncomingChanges                 │
│  SnapshotDiff, SnapshotReasons, SnapshotNotifier                │
│  RelativeTime — formatRelativeTime / formatTimeSince            │
└─────────────────────────────────────────────────────────────────┘
```

### Flujos clave

**Guardado normal** (`saveApplicationData`):
1. Debounce 300ms (o `immediate:true`).
2. `_executeSave`:
   - Si `schemaVersion >= 2`: `EmployeeRepository.saveMany(employees, {mergeRemote:true})` — read-merge-write per empleado.
   - Else: `FirebaseService.saveFullState(state)` — mirror legacy.
   - Drena `_pendingCloudDeletes` (borrar docs huérfanos).
3. Persiste a IndexedDB.

**Carga al abrir** (`subscribeToChanges` callback):
1. Watermark `localUpdatedAt`: si la nube es más vieja, ignora.
2. **Pre-apply hook** (Track 2): `detectIncomingChanges`. Si hay `significant` → `IncomingChangeModal` con apply/reject.
3. `loadAndMigrateEmployees`: migra v1→v2 si aplica, carga empleados de la fuente correcta.
4. Aplica state, propaga `schemaVersion` a `state.settings`.
5. `EmployeesLiveSync.start` si schemaVersion>=2.
6. Sanitiza y guarda correcciones.

**Wizard de duplicados** (`MaintenanceUI.start`):
1. Si schemaVersion>=2: `EmployeeRepository.loadAll()` para ver cloud.
2. `analyzeConflicts({cloudEmployees})` agrupa por número.
3. `buildConflictPlan` clasifica auto-merge (nombres idénticos) vs manual.
4. Preview modal con 3 opciones (auto, todo manual, cancelar).
5. Auto: `executeMergePlan` (snapshot pre-cloud-dedup + merge + cloud deletes).
6. Manual: wizard con 3 roles (master/absorb/separate) + cascada de reasignaciones.

---

## 6. Estado de los datos del usuario (importante)

El usuario tenía **34 docs en `users/Mm5b8gR9ydTPr9kMpgD5tleVCk62/employees/`** para 23 empleados reales (11 duplicados). Detalle de los duplicados (commit `46c78b6` y conversación previa):

| Persona | IDs duplicados |
|---|---|
| Erlin Camilo | `13c3f7db-...` (0 préstamos) + `EMP1769317074330` (3 préstamos) |
| Varnet Gran Pierre | `1e3028c2-...` + `EMP1769317092992` |
| Jean Michel carate | `5ab45e9c-...` + `EMP1772737834439` |
| Noel eliyomme | `656719ff-...` + `EMP1772737902866` |
| **Saint fort Pierre** | `7cba5850-...` (1 préstamo) + `EMP1772642134930` (**6 préstamos**) |
| Pauliny Buchamps | `EMP1769317108304` + `cef7b544-...` |
| Hector / Héctor excavadora | `EMP1772035801640` + `b8012841-...` |
| Jean elie austinvil | `EMP1772642218428` + `b6a20965-...` |
| Jean haiti | `EMP1772642308817` + `b25cc0b6-...` |
| Oxenat Yves / Yves Oxenat | `EMP1773500889676` + `e948c39d-...` |
| Manuel Cadet | `EMP1773500924811` + `dd0b7fb8-...` |

**Caso especial mencionado por el usuario**: ficha 501 con tres miembros (Hector + Jean haiti + Héctor) — Jean haiti no pertenece ahí, debería ir a ficha 500 donde hay otro Jean haiti. El wizard manual con 3 roles ya soporta este caso (`separate` + sub-modal de reasignación + cascada).

El usuario **NO ha ejecutado el wizard todavía** sobre estos datos. La limpieza está pendiente de su próxima sesión.

---

## 7. Convenciones de código y patrones que descubrimos

### `FirebaseService.js` vs `FirebaseServiceReal.js`
**Trampa conocida**: existen DOS archivos. `FirebaseServiceReal.js` es código muerto (507 líneas, nadie lo importa). El `FirebaseService.js` es el activo. Cualquier cambio a `saveFullState` o similar debe ir en `FirebaseService.js`. Confirmé esto durante el plan; ver commits `d6c17a5` (error) y `07ca736` (fix). Cleanup pendiente.

### Mocking de Firebase en tests
- `jest.config.js` tiene `moduleNameMapper` que reescribe `FirebaseService.js` a un mock plano (`__mocks__/FirebaseService.js`).
- Esto hace **imposible** testear `FirebaseService.js` real desde un test (cualquier import lo reemplaza).
- **Workaround usado**: tests de **contrato** que leen el source con `fs.readFileSync` y verifican regex (sustancialmente menos potentes que behavior tests, pero suficiente para evitar regresiones).
- `jest.requireActual('../modules/services/FirebaseService.js')` NO sirve — crea un árbol de módulos paralelo donde los mocks no se comparten con el test.
- `firebase-data.js` SÍ está mockeado y sus spies pueden inspeccionarse (`setDoc.mock.calls`).

### TestRunner adapter pattern
- `js/tests/*Tests.js` usa `testRunner.addSuite(name, { 'caso': () => {...} })`.
- `js/tests/*Tests.test.js` es un wrapper: `import './*Tests.js';`.
- `jest.setup.js` traduce `addSuite` a `describe/it` de Jest.
- Las funciones pueden ser `async` y devolver Promise.

### Mensajes de commit con caracteres especiales
- PowerShell rompe heredocs con `$`, comillas, etc.
- **Patrón estable**:
  ```powershell
  # 1. Escribir mensaje a archivo
  # (uso Write tool con .git/COMMIT_MSG_TEMP)
  git add ...; git commit -F .git/COMMIT_MSG_TEMP; Remove-Item .git/COMMIT_MSG_TEMP
  ```

### Tools que NO funcionan o son problemáticos en este entorno
- `Bash` herramienta — comandos como `ls`, `tail`, `cat`, `head` no existen (entorno PowerShell). Usar `PowerShell` para todo o las herramientas dedicadas (Read, Glob, Grep).
- Newlines en `Bash command` con `cat <<'EOF'` falla.
- El árbol del proyecto está bajo OneDrive con espacios → siempre citar paths.

---

## 8. Tracks pendientes del plan

### Track 3 — DataDiagnostics framework genérico (no empezado)

**Objetivo**: detector generalizado de inconsistencias que reemplace `analyzeConflicts` por algo extensible. Detectaría:

1. **Duplicados** (ya cubierto por `analyzeConflicts`).
2. **Inconsistencias local ↔ nube**: empleados solo en un lado, divergencias de scalars, schemaVersion mismatch.
3. **Referencias rotas** (parcial en `validateDataIntegrity`): positionIds inválidos, leaderIds huérfanos, attendance sin empleado.
4. **Datos faltantes**: empleado sin number/name, activo sin salario, préstamo sin startDate o con principal<=0.
5. **Anomalías** (opcional, complejo): empleado activo sin asistencia en 3 meses, préstamo activo sin pagos en 6 meses.

**Diseño propuesto**:
```js
// DataDiagnostics.js
detectIssues(state, cloudData?) → Issue[]
// Issue = { kind, severity, entityType, entityId, message, fix? }
```
Severidades: `info` (auto-fix seguro), `warn` (recomendable), `critical` (bloquea operaciones).

### Track 4 — Pantalla "Estado del sistema" (no empezado)

Nueva pestaña en Settings con tarjetas:
- ✅/⚠️ Sincronización (vinculada a `SyncStatus`)
- ⚠️ Inconsistencias detectadas (vinculada a Track 3)
- 💾 Uso de almacenamiento (IndexedDB + Firestore)
- 🛡️ Último snapshot
- Botones de acción rápida

### Track 5 — UX de Datos y respaldos (no empezado)

Reescritura del tab "Datos" en Settings para ser más visual:
- Bloques grandes en lugar de texto.
- Info-icons explicando cada acción.
- "Importar / Exportar / Snapshot ahora / Historial / Limpiar caché" como cards claras.

### Nice-to-have del backlog inicial (todos sin empezar)

- **Snapshot C**: agrupación temporal en la lista (Hoy / Esta semana / Más viejo).
- **Snapshot D**: mostrar tamaño visible en cada snapshot.
- **Snapshot E**: bloquear borrado de snapshots `pre-restore` sin doble confirmación.
- **Snapshot F**: input opcional de nota libre al crear snapshot manual (campo `userNote` ya existe en metadata).
- **Snapshot G**: política de retención automática (mantener últimos 7 días + 1/sem por 4 sem + 1/mes por 6 meses).
- **Snapshot I**: restauración selectiva (checkboxes para elegir qué categorías restaurar).
- **Cleanup**: borrar `FirebaseServiceReal.js` (código muerto que ya engañó una vez al asistente).
- **Cleanup**: remover handlers globales `addAdvance/removeAdvance/saveAdvance` (deprecated, sin callers en UI tras la unificación de préstamos).

---

## 9. Comandos útiles para retomar

```powershell
# Estado de git
git log --oneline -10
git status --short

# Tests
npx jest 2>&1 | Select-String "Test Suites:|Tests:" | Select-Object -Last 2
npx jest js/tests/<archivo>.test.js 2>&1 | Select-Object -Last 12

# Solo un test específico
npx jest -t "nombre del test"

# Verificar sintaxis sin correr
node --check js/app.js
```

### Para que el usuario pueda diagnosticar desde la consola del navegador

(Comando que ya usé exitosamente, lo dejo guardado por si vuelve a ser útil:)

```js
const uid = window.currentUser?.uid;
console.log('UID activo:', uid);
const fb = await import('./js/modules/data/firebase.js');
const parentSnap = await fb.getDoc(fb.doc(fb.db, 'users', uid, 'data', 'current'));
const parent = parentSnap.exists() ? parentSnap.data() : null;
console.log('schemaVersion en nube:', parent?.schemaVersion);
console.log('employees legacy array:', parent?.employees?.length);
const empsSnap = await fb.getDocs(fb.collection(fb.db, 'users', uid, 'employees'));
console.log('Docs en subcolección:', empsSnap.size);
empsSnap.forEach(d => console.log('  -', d.id, '→', d.data().name, '| loans:', (d.data().loans || []).length));
```

---

## 10. Próximos pasos sugeridos (orden recomendado)

1. **Probar end-to-end con datos reales** (el usuario aún no lo ha hecho):
   - Abrir la app, verificar que el badge del header muestra estado correcto.
   - Settings → Mantenimiento → ver los 11 duplicados clasificados.
   - Limpiar (auto o todo manual).
   - Verificar en Firebase Console que la subcolección quedó en 23 docs.
2. **Autorizar `git push`** si todo se ve bien.
3. **Decidir Track 3, 4 o 5** según prioridad del usuario. Mi recomendación previa fue **Track 3 → 4 → 5** porque la lógica antes que la visibilidad.

### Si la nueva sesión recibe un nuevo bug report en lugar

- Primer paso: **leer este documento + memoria** (`MEMORY.md` + `testing_workflow.md`).
- Confirmar con el usuario qué track quiere antes de zambullirse.
- Mantener la regla TDD sin excepciones — el usuario lo ha pedido explícitamente y se ha demostrado útil (bugs reales atrapados en commits `0e581ad`, `f4f401b`, etc.).

---

## 11. Estado de archivos modificados que pueden afectar context

Estos son archivos GRANDES que cualquier sesión nueva tendrá que abrir:

- `js/app.js` (~6000 líneas) — entrypoint, callback de subscribe en línea ~5895.
- `js/modules/ui/MaintenanceUI.js` (~700 líneas tras reorg) — wizard cloud-aware.
- `js/modules/services/PersistenceService.js` (~800 líneas) — saveApplicationData, mergeEmployees, analyzeConflicts, _executeSave.
- `js/modules/services/FirebaseService.js` (~700 líneas) — el activo (NO el `Real`).

Recomiendo leer estos parcialmente con `Read` + `offset/limit` en lugar de completos.

---

**Fin del documento**. Cualquier duda, leer commits descendentes desde `0569fc4` hacia atrás — los mensajes son detallados y explican intención + reglas.
