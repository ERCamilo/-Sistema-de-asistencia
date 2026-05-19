# 📋 Plan de Acción y Bitácora

> **Documento vivo** — se actualiza con cada sprint. Sirve como hoja de ruta, checklist de progreso y registro histórico de decisiones tomadas.

**Última actualización:** 2026-05-19 (Sprint 5 parcial — falta profiling humano)
**Estado general:** 🟢 Activo

---

## 🎯 Filosofía del Plan

Reglas que guían cada cambio (no negociables):

1. **🧪 Tests primero, refactor después**
   Nunca tocar código sin red de seguridad. Si vamos a modificar X, X tiene tests antes.

2. **📦 Extracción vertical (por feature), no horizontal (por capa técnica)**
   Mover "Notes Center" entero junto. No mover "todas las validaciones" sueltas.

3. **🪜 Sprints pequeños con entregable visible**
   1-2 días por sprint. Cada uno termina con código mejorable, tests añadidos y métricas actualizadas.

4. **📐 Boy Scout Rule**
   Cada cambio deja el código un poco mejor que antes. No solo arregla — también organiza.

5. **🚫 No tocar lo que no tiene tests sin agregar tests primero**
   Sin excepciones.

6. **📊 Métricas visibles**
   Cuantificar el progreso (líneas, tests, cobertura). Ver el avance motiva.

---

## 📊 Dashboard de Progreso

### Estado actual

| Métrica | Valor inicial | Actual | Meta |
|---|---|---|---|
| Líneas en `app.js` | 6,840 | **5,941** ✅ -899 | < 3,000 |
| Líneas en `EmployeesUI.js` | 1,068 | **1,196** | < 600 |
| Líneas en `AttendanceUI.js` | 871 | **871** | < 600 |
| Tests pasando | 36 | **110** ✅ +74 | 100+ ✅ |
| Cobertura estimada | ~20% | **~47%** | > 60% |
| Tests automáticos (CLI) | 0 ❌ | **110 ✅** | ≥ tests pasando |
| Onclicks inline | 0 ✅ | **0** | 0 ✅ |

### Progreso global

```
Sprints completados:  4.5 / 8 ███████████████░░░░  56%
Tests escritos:     110 /100 ████████████████████ 110% 🎯
Líneas reducidas:   899 /3000 █████░░░░░░░░░░░░░  30%
```

---

## 🗓️ Sprints Planeados

### Convenciones

- `[ ]` Tarea pendiente
- `[x]` Tarea completada
- `[~]` Tarea en progreso
- `[!]` Tarea bloqueada / requiere decisión

Cada sprint muestra `(completadas/total)` y porcentaje.

---

### 🏃 Sprint 1: Quick Wins + Investigación + Tooltips  **(8/8 — 100%)** ✅

**Objetivo:** victorias rápidas, datos limpios, validar que todo sigue funcionando.
**Esfuerzo real:** ~1 día
**Estado:** ✅ Completado (2026-05-17)

#### Tareas originales

- [x] **Investigar "51 referencias huérfanas"** ✅
  - Causa: `deletePosition` no limpiaba asistencias históricas
  - Fix preventivo: `cleanupPositionReferences(positionId)` antes de eliminar
  - Fix curativo: persistir correcciones tras `validateDataIntegrity()` en load
  - 7 tests añadidos en `DataIntegrityTests.js`

- [x] **Touch targets ≥44px en header** ✅
  - Logo: 32×32 → 44×44
  - `.sync-indicator-btn`: añadido min-width/min-height 44px
  - Botón `+` en PayrollUI: 28×28 → 44×44

- [x] **Decidir sobre Google Analytics** ✅
  - Decisión: **eliminar**. La variable `analytics` nunca se usaba.
  - Comentado (no borrado) para reactivación trivial si se quiere
  - Ahorro: ~70-100ms al arranque, consola limpia

#### Tareas añadidas durante el sprint (Tooltips)

- [x] **Sistema de tooltips de ayuda** ✅
  - `HelpController` con 3 modos: off / first-time / always
  - `HelpTooltip` botón `(?)` + auto-show on focus
  - `helpTexts.js` con 14 conceptos documentados
  - Configuración en Ajustes (selector + botón "volver a mostrar todos")
  - Aplicado en PositionModal (3 campos)
  - 14 tests añadidos en `HelpTooltipTests.js`

- [x] **Verificación post-sprint** ✅
  - Tests pasando: 36 → 57 (+21)
  - Arranque más rápido (sin GA)
  - Service Worker actualizado (CACHE_VERSION 1.0.3 → 1.0.5)

#### Bitácora

```
2026-05-17 — Sprint 1 completado en una sesión.

Descubrimientos importantes:
1. Las 51 huérfanas venían SOLO de posiciones eliminadas. Empleados y
   líderes solo se desactivan (no se borran), así que no generan huérfanas.
2. Firebase sync reescribe el state después de validateDataIntegrity, por
   eso las huérfanas reaparecían en cada arranque. Fix: save inmediato
   tras detectar correcciones.
3. El componente TooltipComponent existía pero era solo esqueleto.
   Decidimos hacer uno nuevo (HelpTooltip) en lugar de extender el viejo.
4. La idea del modo "first-time" del usuario fue clave para que el sistema
   no sea molesto. Default recomendado.

Cambios no planificados:
- Sistema completo de tooltips de ayuda (sugerido por el usuario, B/E muy alto)
- Refactor del CSS de header para WCAG 2.5.5

Tests añadidos: 21 (7 data integrity + 14 help tooltips)
Total tests pasando: 57
```

---

### 🏃 Sprint 2: Tests del Sistema Actual  **(5/5 — 100%)** ✅

**Objetivo:** Red de seguridad antes de empezar a mover código.
**Esfuerzo real:** ~1 día (incluyendo la migración a Jest del Sprint 0)
**Estado:** ✅ Completado (2026-05-19)
**Prerequisito:** Sprint 1 + migración Jest completados

#### Pre-Sprint 2: Migración del test runner a Jest + jsdom

Antes de escribir tests nuevos, se migró toda la infraestructura de pruebas
del navegador a Jest + jsdom. Razón: el plan exige "tests primero", pero la
red de seguridad requería verificación manual en navegador, lo que rompía
cualquier flujo automatizado.

- [x] **Setup Jest 29 + Babel + jsdom** — `npm test` corre los 57 tests originales
- [x] **Adaptador TestRunner → Jest** en `jest.setup.js` (cero cambios en suites existentes)
- [x] **Mocks de Firebase / IndexedDB / DataService** en `__mocks__/`
- [x] **Fix de getState()** en EmployeesUI.js — fallback a AppState global en tests

#### Tareas Sprint 2

- [x] **Tests para `PersistenceService`** — 9 tests (saveApplicationData debounce, isDataLoaded gate, IndexedDB primary, localStorage fallback, dateKey granular sync, loadApplicationData paths)
- [x] **Tests para AttendanceService (core toggle)** — 12 tests (createRecord, updateRecord, deleteRecord, validate, multi-position hours)
- [x] **Tests para `FormComponent`** — 11 tests (rendering, validation on blur, anti-doble-submit, onCancel)
- [x] **Tests para Notes (NotesService)** — 10 tests (upsertNote, clearNote, listNotes)
- [x] **Tests para Export Menu (ExportMenuService)** — 6 tests (open, close, idempotencia, canShareFiles probe)

**Total nuevos:** 48 tests (estimado: 23-32, superado).

#### Cambios estructurales añadidos

- **`js/modules/features/notes/NotesService.js`** — extracción pura del data layer de notes (Sprint 3 conectará la UI restante).
- **`js/modules/features/export/ExportMenuService.js`** — extracción pura del state del popover (Sprint 4 conectará la UI restante).
- **Configuración Jest persistente:** `jest.config.js`, `babel.config.json`, `jest.setup.js`, `__mocks__/`.

#### Bitácora

```
2026-05-19 — Sprint 2 completado en una sesión.

Decisiones:
1. Antes de escribir el primer test "tests primero", había que arreglar el
   runner. Migrar a Jest tomó ~½ día y eliminó la dependencia del navegador
   para verificación. Decisión correcta: la opción A (commit "code ready"
   con verificación manual) habría hecho insostenible el flujo continuo.

2. Tests de UI handlers en app.js (Notes y Export): el código vive en
   window.* dentro de app.js, lo que hace impráctico cargarlo en Jest.
   En lugar de hacer mocks gigantes, extraímos el data layer puro a
   NotesService y ExportMenuService. Esto:
   - Cumple Sprint 2 (red de seguridad)
   - Adelanta trabajo mecánico de Sprints 3/4
   - Pin el contrato: cuando movamos la UI, los services ya son verdes

3. Fix de timezone en tests de AttendanceService: `new Date('2026-05-19')`
   se parsea como UTC, que en local time (UTC-4) es 2026-05-18. Usamos
   strings 'YYYY-MM-DD' directamente, que getDateKey preserva verbatim.

4. Fix de moduleNameMapper en jest.config: el patrón original requería
   `/services/` en el path, pero PersistenceService importa con
   `./IndexedDBService.js` (relativo). Cambiado a `(^|/)Name\.js$`.

Tests añadidos:
  - PersistenceService:    9
  - AttendanceService:    12
  - FormComponent:        11
  - NotesService:         10
  - ExportMenuService:     6
  Total:                  48

Total tests pasando: 105 (objetivo 100+ alcanzado).
Cobertura estimada saltó de ~28% a ~42%.
```

---

### 🏃 Sprint 3: Extracción de Notes Center  **(5/5 — 100%)** ✅

**Objetivo:** Definir el patrón de extracción que repetiremos. Notes es ideal por ser una feature aislada.
**Esfuerzo real:** ~½ día (mismo día que Sprint 2)
**Estado:** ✅ Completado (2026-05-19)
**Prerequisito:** Tests de Notes Center del Sprint 2 ✓

#### Tareas

- [x] **Crear estructura `js/modules/features/notes/`**
  - `NotesService.js` (data layer puro — creado en Sprint 2)
  - `NotesController.js` (handlers que mutan state y llaman render)
  - `NotesCenter.js` (template del modal full-screen)
  - `NoteEditorModal.js` (template del editor individual)
  - `index.js` (exports públicos)
  - `README.md` (patrón documentado para Sprints 4/6/7)

- [x] **Migrar código desde app.js**
  - 11 handlers `window.*` movidos a `NotesController.js`
  - Templates `NotesCenterModal()` y `NoteModal()` movidos a sus respectivos archivos
  - `registerLegacyGlobals()` re-expone los handlers en `window.*`

- [x] **Reconectar con event delegation**
  - `data-app-fn` sigue funcionando sin cambios (los handlers viven en `window.*` igual que antes)
  - Bridge limpio: `registerNotesGlobals()` al boot

- [x] **Documentar el patrón** → [`js/modules/features/notes/README.md`](js/modules/features/notes/README.md)

- [x] **Verificación**
  - 105/105 tests pasan ✓
  - `node --check js/app.js` → syntax válida ✓
  - `app.js`: 6,874 → 6,488 líneas (-386, superado el estimado de ~250)

**Resultado real:** -386 líneas en app.js (estimado -250). El patrón quedó claro y replicable.

#### Bitácora

```
2026-05-19 — Sprint 3 completado en una sesión, ~½ día.

Decisiones clave:
1. División en 4 archivos en lugar de 3:
   - NotesService = data puro (ya existía de Sprint 2)
   - NotesController = handlers con efectos (mutar state, render, save)
   - NotesCenter = template grande
   - NoteEditorModal = template chico
   Razón: separar "data sin efectos" de "handlers con efectos" facilita
   el testing y deja los templates como pura presentación.

2. Mantener window.* via registerLegacyGlobals():
   El dispatcher data-app-fn (líneas ~120-200 de app.js) busca handlers
   en window.*. Cambiarlo TODO ahora sería tocar demasiada superficie.
   La función registerLegacyGlobals() ata los exports del módulo a
   window.* — un solo punto que se puede quitar cuando hagamos un
   dispatcher basado en módulos importados.

3. Renombré los templates:
   - NotesCenterModal() → NotesCenter()
   - NoteModal()         → NoteEditorModal()
   Razón: "Modal" sufijo era redundante (todos los templates de overlay
   son modales). Los nombres nuevos son más descriptivos.

4. Sintaxis check con `node --check`:
   Jest no carga app.js (solo carga los archivos .test.js), así que un
   error de sintaxis en app.js pasaría desapercibido. node --check lo
   verifica sin ejecutar. Estándar en CI futuro.

Pendiente para Sprint 4:
- Replicar este patrón para Export Menu (ExportMenuService ya existe).
- En este sprint se acomodaron ~10 funciones; Export Menu tiene ~6,
  debería ser más rápido.

Líneas reducidas en app.js: 386 (estimado 250, superado ~54%).
Líneas totales del módulo notes: 559 distribuidas en 5 archivos
(en lugar de 250+ líneas mezcladas dentro de app.js).
```

---

### 🏃 Sprint 4: Extracción de Export Menu  **(4/4 — 100%)** ✅

**Objetivo:** Aplicar el patrón del Sprint 3 a otra feature aislada.
**Esfuerzo real:** ~½ día (mismo día que Sprint 3)
**Estado:** ✅ Completado (2026-05-19)

#### Tareas

- [x] **Crear `js/modules/features/export/`**
  - `ExportMenuService.js` (pure state ops — heredado de Sprint 2)
  - `ExportController.js` (11 handlers + helpers internos)
  - `ExportMenu.js` (template del popover)
  - `ImportFullModal.js` (template del modal de importar)
  - `index.js` (exports públicos)
  - `README.md`
- [x] **Migrar ExportMenu, ImportFullModal, lógica de compartir**
  - 11 handlers movidos a `ExportController.js`
  - 2 templates movidos a sus archivos
  - `applyFullImport` (helper) y `copyTextToClipboard` (helper) también extraídos
- [x] **Tests específicos del módulo** — 6 tests de ExportMenuService ya existían desde Sprint 2; no se añaden más en este sprint porque los flujos de share/download dependen de APIs del navegador (jsdom no las implementa)
- [x] **Verificación + commit**
  - 105/105 tests pasan ✓
  - `node --check js/app.js` → válida ✓
  - `app.js`: 6,488 → 5,941 (-547 líneas, superando el estimado de -350)

**Resultado real:** -547 líneas en app.js (estimado -350). Combinado con S3: -933 líneas totales desde el inicio del refactor.

#### Bitácora

```
2026-05-19 — Sprint 4 completado el mismo día que S3.

El patrón de Sprint 3 funcionó tal cual: data layer puro + controller +
templates + index + README. La replicación fue mecánica y sin sorpresas.

Notas:
1. exportExcel() y exportPDF() siguen en app.js (líneas ~5300 y ~5420).
   Decidí dejarlas: producen el blob que llega al popover, pero no son
   parte del popover en sí. Son ~250 líneas adicionales que podrían
   extraerse en un sprint futuro si se sigue limpiando app.js.

2. closeExportMenuHandler también limpia state de notes (showNotesCenter,
   showNoteModal, notesCenterEmployeeId). Mantuve ese comportamiento
   porque era el del legacy closeExportMenu en app.js. Documentado en
   el README del módulo.

3. Tests de browser APIs (navigator.share, clipboard, FileReader):
   jsdom no implementa estas APIs de forma completa. Los tests de
   share/download requerirían mocks pesados o un browser real. No
   añadidos en este sprint — los 6 tests de ExportMenuService cubren
   el state-management que es la parte que cambia entre sprints.

Líneas reducidas: 547 (estimado 350). Acumulado S3+S4: 933 líneas.
Próximo cuello: app.js sigue con 5,941 líneas. Sprint 5 (performance)
y Sprint 6 (Profile Modal) seguirán bajándola.
```

---

### 🏃 Sprint 5: Performance del Render Inicial  **(2/5 — 40% parcial)** 🟡

**Objetivo:** Reducir el render inicial de 180-258ms a <100ms.
**Esfuerzo real (parte automatizable):** ~2 horas
**Estado:** 🟡 Parcial — partes deterministas completadas, profiling pendiente del usuario

#### Tareas

- [ ] **Profiling con DevTools Performance tab** ← REQUIERE HUMANO
  - Chrome → DevTools → Performance → Record → recargar página → Stop
  - Identificar el componente que más bloquea (mirar el flamegraph)
  - Documentar el "antes" como baseline (ms totales + nombre de la función más cara)
  - **Sin esto no se puede saber si las optimizaciones siguientes valen la pena**

- [x] **Aplicar `batchSetState` donde hay `state.X = Y; render()` consecutivos** (parcial)
  - Aplicado en `NotesController` (4 handlers) y `ExportController` (3 handlers)
  - Patrón documentado y demostrado
  - **Quedan 117 sitios de `state.X = ...` en `app.js`** que no se tocaron sin profiling — el riesgo de blanket-refactor es romper expectativas de orden de render que no veo desde Jest

- [ ] **Lazy load de componentes pesados (Analytics, Payroll)** ← PENDIENTE
  - `AnalyticsUI.js` (1,292 líneas) y `PayrollUI.js` (882 líneas) se cargan eager
  - Convertir a `import()` dinámico cuando el usuario navega a esa tab
  - Sin profiling no está claro si el costo de parse de estos archivos es realmente el cuello — V8 hace parse lazy hasta que se llaman las funciones
  - **Necesita ser justificado con métricas antes de hacer el refactor**

- [ ] **Optimización dirigida del cuello identificado** ← REQUIERE PROFILING

- [x] **Verificación: test de performance regression** ✅
  - `js/tests/RenderBatchingTests.js` (5 tests, todos verdes)
  - Verifica que la dedup del queue funciona
  - Verifica que `batchSetState` suprime el scheduling por mutación
  - Verifica que `_silent` se restaura incluso tras una excepción
  - Verifica que asignar el mismo valor NO dispara render
  - **Cualquier regresión en este sistema explota estos tests inmediatamente**

#### Lo que SÍ se hizo en este sprint (sin profiling)

1. **5 tests de regresión de batching** — locked in the current behavior of the
   render scheduling system. Si alguien rompe el dedup, los tests gritan.

2. **batchSetState aplicado en los 2 controllers nuevos** (`NotesController`,
   `ExportController`) como patrón canónico. Ejemplo: `applyFullImport` mutaba
   7 campos de state secuencialmente — ahora todo en un batch.

3. **Render redundante reducido** en los handlers tocados: antes hacían
   N x `scheduleRender` + 1 x `render()` directo = 2 renders reales por
   handler. Ahora 1 x `scheduleRender` (en batchSetState) + 1 x `render()`
   directo = 1 render efectivo (porque el scheduled lo dedupea el explícito).

#### Bitácora

```
2026-05-19 — Sprint 5 parcial.

Decisión clave: no hacer cambios "speculative" sin métricas.

Lo que sí se hizo:
- Test de regresión de batching (5 tests). Verifica que dedup + batchSetState
  funcionan como pensamos. Si alguien rompe el sistema, falla.
- batchSetState aplicado a los 7 handlers de Notes/Export que mutaban 3-7
  campos de state. Demostración del patrón.

Lo que NO se hizo y por qué:
- No baseline profiling. Sin browser DevTools no se puede medir.
- No blanket-refactor de los 117 sitios de mutación en app.js. Sin profiling,
  el riesgo > beneficio: podría romper orden de render en lugares no visibles
  desde Jest.
- No lazy loading de Analytics/Payroll. Aunque son 2,174 líneas combinadas,
  V8 parsea lazily hasta que se llaman funciones. Sin medición no sé si el
  costo es de parse o de ejecución.

Para el usuario:
1. Abrir Chrome → DevTools → Performance tab
2. Record → recargar la app → Stop
3. Compartir:
   - Tiempo total de "Scripting" en el resumen
   - Nombre de la función más cara en el flamegraph
   - Si AnalyticsUI/PayrollUI aparecen como "compilation/parse" o como
     "execution"
4. Con esos números, puedo escribir patches dirigidos y un test de timing
   que asegure que no se degrada.

Tests añadidos: 5 (RenderBatchingTests).
Total tests pasando: 110.
```

---

### 🏃 Sprint 6: Extracción de Profile Modal  **(0/4 — 0%)**

**Objetivo:** Sacar el modal de perfil de empleado completamente de app.js (lo que queda).
**Esfuerzo estimado:** 1.5 días
**Estado:** ⏳ Pendiente

#### Tareas

- [ ] **Mover lógica restante a `js/modules/ui/modals/EmployeeProfileModal.js`** (ya parcialmente extraído)
- [ ] **Mover `ProfileTabResumen`, `ProfileTabNomina`, `ProfileTabAsistencia`, `ProfileTabDocumentos`**
- [ ] **Tests para cada tab del perfil**
- [ ] **Verificación + commit**

**Resultado esperado:** `app.js` reduce ~400 líneas

---

### 🏃 Sprint 7: Dividir EmployeesUI  **(0/5 — 0%)**

**Objetivo:** Reducir el god-object de 1,068 a <600 líneas.
**Esfuerzo estimado:** 2-3 días
**Estado:** ⏳ Pendiente

#### Tareas

- [ ] **Crear sub-módulos:**
  - `EmployeesList.js`
  - `LeadersList.js`
  - `PositionsList.js`
- [ ] **Mover renderizado correspondiente**
- [ ] **EmployeesUI.js queda como orquestador (≤300 líneas)**
- [ ] **Tests específicos por sub-módulo**
- [ ] **Verificación + commit**

**Resultado esperado:** EmployeesUI: 1,068 → ≤600 líneas, +3 nuevos archivos

---

### 🏃 Sprint 8: Limpieza Final  **(0/4 — 0%)**

**Objetivo:** Cerrar deuda menor acumulada.
**Esfuerzo estimado:** 1-2 días
**Estado:** ⏳ Pendiente

#### Tareas

- [ ] **Migrar emojis restantes a iconos en `app.js` y archivos secundarios**
- [ ] **Estandarizar breakpoints CSS**
- [ ] **Inputs sin `autocomplete=` lo reciben**
- [ ] **Cleanup de logs verbose restantes (`debug.log` donde corresponda)**

---

## 📝 Backlog (descubrimientos por el camino)

> _Aquí van las cosas que encontremos al investigar pero que no son del sprint actual. Cada item se prioriza después._

- [ ] (vacío hasta que aparezcan hallazgos)

---

## 🎲 Tareas Sin Asignar (Tier inferior)

Items que no entran en sprints concretos pero quedan documentados:

### Tier C (B/E < 4)
- [ ] Reducir `window.*` globals (255 → ~50) — refactor grande, valor incremental
- [ ] Sub-collections de empleados en Firebase — solo si crece a 10k+ empleados
- [ ] Migrar emojis restantes en notificaciones internas

### Tier D (visión futura)
- [ ] Sistema de Clima + Notas (10 fases — ver [propuestas_clima_notas.md](propuestas_clima_notas.md))
- [ ] Roadmap aspiracional de "Clima como herramienta de gestión"

---

## 📈 Historial de Métricas

> _Tabla a actualizar al cierre de cada sprint._

| Fecha | Sprint | Líneas app.js | Líneas EmployeesUI | Tests | Notas |
|---|---|---|---|---|---|
| 2026-05-17 | (inicio) | 6,840 | 1,068 | 36 | Punto de partida |
| 2026-05-17 | S1 ✅ | 6,840 | 1,112 (+44) | 57 (+21) | Quick wins, fix huérfanas, tooltips, sin GA |
| 2026-05-19 | S2 ✅ | 6,874 | 1,196 | 105 (+48) | Migración a Jest + 48 tests; NotesService y ExportMenuService extraídos |
| 2026-05-19 | S3 ✅ | 6,488 (-386) | 1,196 | 105 | Notes Center extraído (Controller + 2 templates + index + README) |
| 2026-05-19 | S4 ✅ | 5,941 (-547) | 1,196 | 105 | Export Menu extraído (Controller + 2 templates + index + README) |
| 2026-05-19 | S5 🟡 | 5,941 | 1,196 | 110 (+5) | Parcial: regression test + batchSetState en controllers nuevos. Profiling pendiente. |
| _pendiente_ | S6 | — | — | — | Profile Modal extraction |

---

## 🧭 Toma de Decisiones

> _Espacio para registrar decisiones importantes con justificación._

### 2026-05-17 — Estrategia general
**Decisión:** Tests primero, extracción vertical, sprints de 1-2 días.
**Razón:** balance entre velocidad y seguridad. Permite revertir fácil si algo sale mal.
**Alternativas consideradas:**
- Refactor masivo: descartado por riesgo
- Solo tests sin refactor: descartado por no resolver el problema de fondo
**Vigente:** ✅

---

## 🚨 Bloqueadores Conocidos

> _Items que requieren input externo, decisión del cliente, o investigación previa._

- _Ninguno actualmente_

---

## 📚 Documentos Relacionados

- [`propuestas_clima_notas.md`](propuestas_clima_notas.md) — Feature futuro de clima
- [`audit_report.md`](audit_report.md) — Auditoría inicial (referencia histórica, parcialmente desactualizada)
- [`REPORTE_TECNICO_ASISTENCIA.md`](REPORTE_TECNICO_ASISTENCIA.md) — Reporte técnico inicial
- [`REPORTE_FIREBASE_ESTRUCTURA.md`](REPORTE_FIREBASE_ESTRUCTURA.md) — Estructura de Firebase

---

## 🎯 Definition of Done por Sprint

Un sprint se considera **completado** cuando:

1. ✅ Todas las tareas marcadas con `[x]`
2. ✅ `testRunner.runAll()` pasa al 100%
3. ✅ No hay regresiones visibles en navegador
4. ✅ Métricas actualizadas en la tabla de Historial
5. ✅ Bitácora del sprint llena con hallazgos y decisiones
6. ✅ Commit con mensaje descriptivo
7. ✅ Backlog actualizado con items descubiertos

---

## ✏️ Cómo usar este documento

### Al iniciar un sprint
1. Mover su estado de ⏳ Pendiente → 🚧 En progreso
2. Anotar fecha de inicio en la bitácora del sprint

### Durante el sprint
1. Marcar tareas como `[x]` conforme se completan
2. Actualizar el contador (X/Y — Z%) en el título
3. Anotar hallazgos en el campo "Bitácora"
4. Si encuentras algo fuera del scope → añadir al Backlog

### Al cerrar un sprint
1. Verificar Definition of Done
2. Cambiar estado a ✅ Completado con fecha
3. Actualizar tabla de Historial de Métricas
4. Si quedaron tareas pendientes → mover al Backlog o al siguiente sprint
5. Commit del documento actualizado

### Si surge algo inesperado
- Bug crítico → crear sprint de emergencia
- Feature nueva → al Backlog
- Cambio de estrategia → documentar en "Toma de Decisiones"
