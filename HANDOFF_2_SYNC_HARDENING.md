# Handoff 2.0 — Endurecimiento del sistema de sincronización

> Documento para retomar el trabajo en una nueva sesión de Claude Code.
> **Última actualización**: tras commit `a7fe0ff` — Suite **768/768** ✅ · branch `main` con **55 commits sin push**.
> **Continuación de** `HANDOFF_PLAN_SAVE_SYNC.md` (Handoff 1.0). Ese sigue vigente para el contexto base.

---

## 1. Cómo arrancar la próxima sesión

Pega esto como primer mensaje a la nueva sesión:

```
Lee HANDOFF_2_SYNC_HARDENING.md y HANDOFF_PLAN_SAVE_SYNC.md.
Continúa desde donde quedó la sesión anterior.
```

Si quieres también: `git log --oneline -20` para que vea el historial reciente.

---

## 2. Estado actual de la suite

- **Total**: 768 tests, 64 suites, todos verdes
- **Comando**: `npx jest --no-coverage` (desde la raíz del proyecto)
- **Jest, no Vitest** (importante — el harness antiguo `testRunner.runAll()` corre encima de Jest vía `jest.setup.js`)
- **Tiempo**: ~50–65 s en frío

Si la nueva sesión ve fallos en `WeatherUITests`, son **pre-existentes** y no relacionados (problema de encoding `â€"` en los strings de test, no afecta la app real).

---

## 3. Reglas del usuario — confirmadas y vigentes

### Idioma (memoria persistente)
- **Defecto**: responder en **inglés** aunque escriba en español (está practicando inglés).
- Si el usuario dice explícitamente "responde en español" para esa pregunta, respétalo **solo en esa respuesta** y vuelve al inglés.
- Excepción: el contenido de las tablas puede ir en español.

### TDD obligatorio para guardado/sync
- Escribir tests **antes** de implementar cambios al sistema de save/sync.
- Cada commit incluye tests + implementación juntos.
- Suite verde antes de commitear.

### Git
- ✅ Commits libres en `main`.
- ❌ **NO `git push`** hasta autorización explícita.
- Mensajes en inglés, con `Co-Authored-By: Claude … <noreply@anthropic.com>`.
- **PowerShell rompe heredocs** — usar `git commit -F .git/COMMIT_MSG_TEMP` para commits con cuerpo largo.

### Estilo
- Conciso. El usuario premia eficiencia.
- "procede" / "ok" / "si" / "continua" = adelante con lo último propuesto sin re-preguntar.

---

## 4. Lo que se hizo en esta sesión (Handoff 1 → 2)

Cronológico, todos en `main`:

| Commit | Qué |
|---|---|
| `936be4f` | fix: `loading.close()` → `loading.dismiss()` en `uploadToCloud` / `downloadFromCloud` / `deleteCloudDataNow` |
| `ed568f0` | feat: colores distintos para `pending` (slate `#cbd5e1`) / `warning` (amber `#f59e0b`) / `paused` (orange `#f97316`) — antes los 3 eran ámbar |
| `baa82b3` | feat: tras saneamiento de datos al cargar, preguntar al usuario si subir las correcciones a la nube (`_pendingSanitizationCloudSync`) |
| `352949d` | feat: **outgoing-conflict guard** — antes de pushear, comparar `state._lastKnownCloudUpdatedAt` vs `state.settings.localUpdatedAt`. Si nube es más reciente, abrir modal "¿reemplazar?" |
| `199cc81` | fix: dos regresiones graves del commit anterior — (1) outgoing-conflict disparaba **falso positivo** durante `_isApplyingRemoteData`, bloqueaba todo push; (2) Escape/× del IncomingChangeModal pausaba silenciosamente. Ahora ambos llaman a `onDismiss` (no destructivo) |
| `da6e552` | feat: badge naranja "pausado" ahora es **clicable** → modal de Reanudar → `resumeCloudUpload()`. Además aviso al boot si arranca pausado. |
| `7f47652` | fix: `resumeCloudUpload` usaba `delete state.settings.cloudUploadPaused` → `JSON.stringify` lo borraba del payload → Firestore `merge:true` mantenía el `true` viejo en cloud → echo de `subscribeToChanges` re-aplicaba `true` → loop infinito de re-pausado. Cambiado a `= false` (valor explícito que sí viaja). |
| `a7fe0ff` | feat: **`FirebaseService.replaceCloudFull(state)`** — overwrite real. Borra docs huérfanos de `users/{uid}/employees/{id}`, escribe el main doc SIN `merge:true`. Conectado al "Sí, reemplazar nube" del outgoing-conflict modal. |

Tests añadidos en esta sesión:
- `SyncRegressionTests.js/.test.js` — 10 tests (falsos positivos + Escape/× no-destructivo)
- `ResumeFromBadgeTests.js/.test.js` — 10 tests (cursor:pointer + click delegation + Modal.confirm + boot-notice)
- `ReplaceCloudTests.js/.test.js` — 4 tests (replaceCloudFull existe, sin merge:true, borra huérfanos, app.js lo usa)
- `SanitizationCloudPromptTests.js/.test.js` — 9 tests
- Actualizados: `SyncPauseTests.js`, `IncomingChangeModalTests.js`, `SyncStatusBadgeTests.js`

---

## 5. Arquitectura actual del flujo de sync

```
┌──────────────────────────────────────────────────────────────┐
│ Local change → saveApplicationData(opts)                      │
│       ↓ (debounce 300ms, bypassable con immediate:true)       │
│ _executeSave(opts)                                            │
│       ↓                                                       │
│ 1. state.settings.localUpdatedAt = Date.now()                 │
│    (a menos que _isApplyingRemoteData = true)                 │
│ 2. _canSyncFirebase = currentUser                             │
│                   && !_isApplyingRemoteData                   │
│                   && !cloudUploadPaused                       │
│                   && !options.localOnly                       │
│ 3. _hasOutgoingConflict =                                     │
│      _canSyncFirebase                                         │
│      && !options.force                                        │
│      && _lastKnownCloudUpdatedAt > localUpdatedAt + 10s       │
│    → emite 'sync:outgoing-conflict' → app.js abre Modal       │
│ 4. Si _canSyncFirebase && !_hasOutgoingConflict:              │
│      - saveDailyAttendance (granular si hay dateKey)          │
│      - syncFirebaseMirrorDebounced(state) → saveFullState     │
│      - _drainPendingCloudDeletes (cola de borrados)           │
│ 5. Save IndexedDB (siempre, salvo _isApplyingRemoteData)      │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ Firebase change → subscribeToChanges(remoteData)              │
│       ↓                                                       │
│ 1. state._lastKnownCloudUpdatedAt = remoteData.settings       │
│                                       .localUpdatedAt         │
│ 2. detectIncomingChanges(state, remoteData)                   │
│    Si hay 'significant' → IncomingChangeModal:                │
│      - onApply → applyRemoteData()                            │
│      - onRejectAndPause → pauseCloudUpload()                  │
│      - onRejectAndReupload → save({ force: true })            │
│      - onDismiss / Escape / × → solo cierra (sin destruir)    │
│ 3. Si triviales → applyRemoteData silencioso                  │
│       ↓                                                       │
│ applyRemoteData (con _isApplyingRemoteData=true):             │
│   - Object.assign(state, remoteData)                          │
│   - saveToIndexedDB (sin tocar Firebase, gated por flag)      │
│   - validateDataIntegrity post-merge                          │
└──────────────────────────────────────────────────────────────┘
```

### Estado relevante en `state`
- `state.settings.cloudUploadPaused`: persistido. `true`/`false` explícito (NO `delete` — ver bug 7f47652).
- `state.settings.localUpdatedAt`: timestamp de la última escritura local. Persistido.
- `state.settings.lastCloudSavedAt`: timestamp de la última escritura a Firebase. Persistido.
- `state._lastKnownCloudUpdatedAt`: timestamp visto en el último `subscribeToChanges`. **Runtime-only** (no persiste).
- `state._outgoingConflictReviewPending`: flag para no abrir dos modales de conflicto saliente a la vez. Runtime-only.
- `state._pendingSanitizationCloudSync`: contador de fixes al cargar. Se consulta una sola vez tras el primer sync.
- `globalThis._isApplyingRemoteData`: true durante `applyRemoteData()`, evita re-push del eco.
- `globalThis._pendingIncomingReview`: true mientras hay un IncomingChangeModal abierto.

---

## 6. Badge de sync — estados visuales

| Estado | Color | Icono | Cuándo |
|---|---|---|---|
| `synced` | verde `#10b981` | check-circle | Sincronizado recientemente (< 30 s) |
| `pending` | slate `#cbd5e1` | clock | Aún no se ha sincronizado en esta sesión |
| `warning` | amber `#f59e0b` | clock | > 30 s sin sync exitoso |
| `paused` | orange `#f97316` | pause-circle | `cloudUploadPaused = true`. **Clicable** → modal de Reanudar |
| `offline` | rojo `#ef4444` | wifi-off | `navigator.onLine === false` |
| `noauth` | gris `#94a3b8` | user | Sin sesión |
| `error` | rojo `#ef4444` | x-circle | (no usado activamente) |

Cursor pointer **solo en `paused`** (es el único accionable). Resto: cursor default.

---

## 7. Cosas que SIGUEN pendientes

### 7.1 Push a remoto
**55 commits sin push en main**. Requiere autorización explícita del usuario antes de `git push`. No pushear por iniciativa propia.

### 7.2 Tarea #5 del TaskTracker
Sigue marcada `[pending]` en el tracker, aunque la implementación ya quedó (`baa82b3`). Actualizar marca si el tracker está disponible.

### 7.3 Reanudación visible cuando el usuario está activo
Si el usuario abre la app en modo pausado y NO mira el badge, sigue pausado en silencio. La notificación de boot existe (`da6e552`) pero solo aparece 1 vez. Considerar:
- Banner persistente arriba mientras `cloudUploadPaused = true`
- Re-mostrar la notificación cada N minutos
- O auto-resume al detectar cambios locales (riesgoso)

### 7.4 `_lastKnownCloudUpdatedAt` no se actualiza tras nuestro propio push
Cuando hacemos `saveFullState`, no actualizamos `state._lastKnownCloudUpdatedAt` con el nuevo `localUpdatedAt`. Esto significa que **el siguiente eco de `subscribeToChanges` sí lo actualiza** (vía la línea en app.js:6265). Funciona, pero hay una ventana de varios segundos donde, si el usuario hace otro cambio antes del eco, `_lastKnownCloudUpdatedAt` está atrasado.

**No crítico** porque el `_localTime` también avanza con cada save. Pero vale repasar si surgen más falsos positivos del outgoing-conflict.

### 7.5 `mergeRemote: false` en `replaceCloudFull` — verificar
El `EmployeeRepository.saveMany(emps, { mergeRemote: false })` que añadí asume que existe esa opción. Conviene verificar el código de `EmployeeRepository.saveMany` y confirmar que `mergeRemote: false` realmente hace setDoc sin merge. Si no, hay que arreglarlo ahí también.

### 7.6 Saneamiento prompt sin sesión
`_checkSanitizationCloudSyncPrompt` se llama tras `isInitialLoad = false` en la rama autenticada. En la rama "sin usuario" se limpia el flag silenciosamente. Asumiendo que el usuario se loguea después → el flag ya fue borrado y nunca se le pregunta. Bug menor: el saneamiento sin sesión nunca llega a preguntarse después.

### 7.7 Mejoras de UX que el usuario sugirió o están a medias
- Confirmación antes de un push masivo a la nube (más allá del outgoing-conflict actual). El usuario lo sugirió pero quedó cubierto con el guard existente.
- Botón "Reanudar" en algún lugar más visible (Settings panel) además del badge.

---

## 8. Cosas que NO se deben tocar sin pensar

- `saveFullState` sigue usando `merge: true`. **Es correcto para el sync incremental** — múltiples dispositivos pueden estar escribiendo campos distintos, y un overwrite total causaría pérdidas. Solo `replaceCloudFull` (que es opt-in del usuario) hace overwrite real.
- `state.settings.localUpdatedAt` NO se debe actualizar durante `_isApplyingRemoteData = true`. Esa intención está documentada en el código y es la que distingue "yo edité" de "vino del eco".
- `cloudUploadPaused` debe usar `= false`, **nunca `delete`** (commit `7f47652` lo explica).
- Las pausas y reanudaciones del cloud son **acciones explícitas del usuario**. No hacer pause/resume programático sin un click directo.

---

## 9. Comandos útiles (PowerShell)

```powershell
# Suite completa
npx jest --no-coverage

# Suite con filtro
npx jest js/tests/SyncRegressionTests.test.js --no-coverage

# Ver commits recientes
git log --oneline -20

# Ver diff de un commit
git show <hash>

# Commit con mensaje multilinea (PowerShell-safe)
# 1) escribir el mensaje a .git/COMMIT_MSG_TEMP con Write tool
# 2) git add <archivos>
# 3) git commit -F .git/COMMIT_MSG_TEMP
```

---

## 10. Archivos clave para esta sesión

| Path | Rol |
|---|---|
| `js/modules/services/PersistenceService.js` | `_executeSave`, `loadApplicationData`, `validateDataIntegrity`, `_drainPendingCloudDeletes`, conflict guard |
| `js/modules/services/SyncPauseService.js` | `isSyncPaused` / `pauseCloudUpload` / `resumeCloudUpload` |
| `js/modules/services/SyncStatus.js` | Pub/sub para timestamps de sync |
| `js/modules/services/FirebaseService.js` | `saveFullState` (merge:true) y `replaceCloudFull` (overwrite) |
| `js/modules/services/EmployeeRepository.js` | `loadAll`, `saveMany`, `deleteOne` (per-doc subcolección) |
| `js/modules/ui/SyncStatusBadge.js` | Render + click delegation del badge |
| `js/modules/ui/IncomingChangeModal.js` | Modal de cambios entrantes (3 acciones + onDismiss) |
| `js/app.js` (líneas ~6055–6110) | `_initOutgoingConflictGuard` |
| `js/app.js` (líneas ~6190–6210) | Boot prompt de pausa + sanitization |
| `js/app.js` (líneas ~6260–6285) | `subscribeToChanges` + `applyRemoteData` |
| `js/app.js` (línea ~3266) | `attachLiveBadge({ onPausedClick })` |

---

## 11. Mini-checklist para retomar

1. `git log --oneline -5` — confirmar que el último commit visible es `a7fe0ff` (o más reciente si hubo trabajo después).
2. `npx jest --no-coverage` — confirmar 768/768 verde.
3. Leer este doc + `HANDOFF_PLAN_SAVE_SYNC.md`.
4. Confirmar con el usuario qué quiere atacar a continuación (de la sección 7).
5. TDD → tests rojos → implementación → verde → commit (sin push).
