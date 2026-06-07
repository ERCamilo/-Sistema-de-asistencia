# Handoff 3.0 — Controles de sincronización por dispositivo

> Documento para retomar el trabajo en una nueva sesión de Claude Code.
> **Última actualización**: commit `7142dc7` — Suite **901/901** ✅ · rama `main` en sync con remoto.
> **Continuación de** `HANDOFF_2_SYNC_HARDENING.md`. Ese sigue vigente para el contexto base de sync.

---

## 1. Cómo arrancar la próxima sesión

Pega esto como primer mensaje:

```
Lee HANDOFF_3_SYNC_CONTROLS.md, HANDOFF_2_SYNC_HARDENING.md y HANDOFF_PLAN_SAVE_SYNC.md.
Continúa desde donde quedó la sesión anterior.
Trabaja directo en main (no en rama de feature).
```

---

## 2. Estado actual

- **Rama activa**: `main` (se trabaja directo aquí, sin ramas de feature)
- **Tests**: 901 tests, 76 suites, todos verdes
- **Comando**: `pnpm test` (el proyecto usa **pnpm**, nunca npm)
- **Último commit**: `7142dc7 feat(sync): add cloud-download pause switch`
- **Remoto**: `main` está en sync con `origin/main` (push hecho)

---

## 3. Reglas del usuario — vigentes

- **Idioma**: responder en **español** (el usuario escribe en español, responder en español).
- **Package manager**: siempre `pnpm`, nunca `npm`.
- **Rama**: trabajar directo en `main`.
- **"si" / "ok" / "continua"** = adelante sin re-preguntar.
- **Git push**: hacer push después de cada commit (el usuario trabaja en remoto/web).

---

## 4. Lo que se hizo en esta sesión (Handoff 2 → 3)

Todos los cambios están en `main`:

| Commit | Qué |
|---|---|
| `2eef71b` | feat: switch on/off de pausa de **subida** en el modal del Centro de Sincronización |
| `b5839cf` | feat: pausa de subida movida de `state.settings.cloudUploadPaused` (sincronizado con Firebase) a `localStorage` (solo este dispositivo). Nunca más una flag vieja en la nube puede auto-pausar un equipo. |
| `4b9f75e` | merge PR #5 a main |
| `7142dc7` | feat: switch on/off de pausa de **descarga** en el Centro de Sincronización — simétrico al de subida, también device-local vía `localStorage` |

---

## 5. Arquitectura actual de pausas de sync

Ambas pausas son **por dispositivo** — viven en `localStorage`, nunca en Firebase ni en `state.settings`.

### localStorage keys
| Key | Qué controla |
|---|---|
| `asistencia_cloud_upload_paused` | Bloquea el push de datos locales a Firestore |
| `asistencia_cloud_download_paused` | Bloquea la aplicación de datos entrantes de Firestore al estado local |

### SyncPauseService.js — API completa
```js
// Subida
isSyncPaused()           // lee localStorage upload key
pauseCloudUpload(reason) // escribe flag + log
resumeCloudUpload()      // borra flag + fuerza save({ force, immediate })

// Descarga
isDownloadPaused()           // lee localStorage download key
pauseCloudDownload(reason)   // escribe flag + log
resumeCloudDownload()        // borra flag; el caller debe llamar syncFirebaseNow()
```

### Puntos de gate en app.js para la pausa de SUBIDA
- `PersistenceService._executeSave` → `_isPausedEffective = SYNC_PAUSE_ENABLED && isSyncPaused()` bloquea el bloque de Firebase.

### Puntos de gate en app.js para la pausa de DESCARGA
Los listeners de Firestore siguen **activos** (no se desuscriben), pero sus callbacks retornan temprano:
1. `FirebaseService.subscribeToChanges` callback — `if (isDownloadPaused()) return`
2. `EmployeesLiveSync.onApply` — `if (isDownloadPaused()) return`
3. `PositionsLiveSync.onApply` — `if (isDownloadPaused()) return`
4. `LeadersLiveSync.onApply` — `if (isDownloadPaused()) return`
5. `subscribeToAttendanceZonal.onInitialLoad` — `if (isDownloadPaused()) return`
6. `subscribeToAttendanceZonal.onModified` — `if (isDownloadPaused()) return`

Al reanudar descarga (`syncCenterToggleDownloadPause`), se llama `window.syncFirebaseNow?.()` para ponerse al día.

### Centro de Sincronización — UI
El modal `SyncCenterModal()` muestra dos switches apilados dentro de `.sync-pause-switches`:
1. **☁️ Subida a la nube activa / ⏸️ Subida pausada** → `syncCenterTogglePause`
2. **📥 Descarga activa / ⏸️ Descarga pausada** → `syncCenterToggleDownloadPause`

Verde = activo · Ámbar = pausado. Ambos se guardan en `localStorage` (persisten entre recargas, no afectan otros dispositivos).

---

## 6. Flujo de sync actualizado

```
┌──────────────────────────────────────────────────────────────┐
│ SUBIDA (local → nube)                                         │
│ saveApplicationData() → _executeSave()                        │
│   _isPausedEffective = SYNC_PAUSE_ENABLED && isSyncPaused()   │
│   Si pausado: solo IndexedDB, skip Firebase                   │
│   Si activo:  IndexedDB + Firebase (saveFullState/attendance) │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ DESCARGA (nube → local)                                       │
│ subscribeToChanges / LiveSync / AttendanceZonal               │
│   Si isDownloadPaused(): return early (sin tocar state)       │
│   Si activo: applyRemoteData() como siempre                   │
│   Al reanudar: syncFirebaseNow() para ponerse al día          │
└──────────────────────────────────────────────────────────────┘
```

---

## 7. Archivos clave

| Path | Rol |
|---|---|
| `js/modules/services/SyncPauseService.js` | Toda la lógica de pausa upload + download |
| `js/modules/services/PersistenceService.js` | Gate de subida vía `_isPausedEffective` |
| `js/app.js` línea ~27 | Import de las 6 funciones de SyncPauseService |
| `js/app.js` `SyncCenterModal()` | Los dos switches + wrapper `.sync-pause-switches` |
| `js/app.js` `syncCenterTogglePause` | Handler del switch de subida |
| `js/app.js` `syncCenterToggleDownloadPause` | Handler del switch de descarga |
| `js/app.js` `subscribeToChanges` | Gate de descarga (mirror sync) |
| `js/app.js` `EmployeesLiveSync.onApply` | Gate de descarga (empleados) |
| `js/app.js` `subscribeToAttendanceZonal` | Gate de descarga (asistencia) |
| `css/header.css` `.sync-pause-switches` | Wrapper flex de los dos switches |
| `js/tests/SyncPauseTests.js` | Tests de contrato de SyncPauseService (localStorage) |
| `js/tests/SyncRegressionTests.js` | Tests de regresiones de sync |

---

## 8. Tests relacionados con sync

| Archivo | Suites | Qué verifica |
|---|---|---|
| `SyncPauseTests.js` | 4 suites | `isSyncPaused`, `pauseCloudUpload`, `resumeCloudUpload`, kill-switch, NO escribe a `state.settings` |
| `SyncRegressionTests.js` | 3 suites | Outgoing-conflict no dispara falso positivo, Escape/× no pausa silencioso, `onDismiss` en app.js |
| `OutgoingConflictTests.js` | — | Guard del conflicto saliente |
| `IncomingChangeModalTests.js` | — | Modal de cambios entrantes |

---

## 9. Pendientes conocidos

### 9.1 Pausa de descarga — sin tests formales
Los gates de `isDownloadPaused()` en app.js **no tienen suite de tests todavía**. Sería bueno agregar `SyncDownloadPauseTests.js` con source-checks análogos a `SyncPauseTests.js`.

### 9.2 Badge — solo refleja pausa de subida
El `SyncStatusBadge` muestra "⏸️ Sync pausado" solo cuando la **subida** está pausada. Si la descarga está pausada pero la subida activa, el badge no lo indica. Considerar un estado visual diferenciado para descarga pausada.

### 9.3 `_lastKnownCloudUpdatedAt` no se actualiza tras push propio
Ver sección 7.4 del Handoff 2. Sigue siendo un edge case menor, no crítico.

### 9.4 `resumeCloudDownload` no tiene re-sync automático en el servicio
El servicio solo borra el flag. El re-sync está en el handler de app.js (`syncFirebaseNow`). Si alguien llama a `resumeCloudDownload()` directamente desde otro lugar, no habrá re-sync automático. Considerar si conviene hacerlo dentro del servicio (con dynamic import similar a `resumeCloudUpload`).

---

## 10. Comandos útiles

```bash
# Suite completa
pnpm test

# Suite con filtro
pnpm test -- js/tests/SyncPauseTests.test.js

# Ver commits recientes
git log --oneline -10

# Ver diff del último commit
git show HEAD
```

---

## 11. Mini-checklist para retomar

1. `git log --oneline -5` — confirmar que el último commit es `7142dc7` (o más reciente).
2. `pnpm test` — confirmar 901/901 verde.
3. Leer este doc + `HANDOFF_2_SYNC_HARDENING.md`.
4. Confirmar con el usuario qué quiere atacar.
5. Trabajar directo en `main`, hacer push después de cada commit.
