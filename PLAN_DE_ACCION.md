# 📋 Plan de Acción y Bitácora

> **Documento vivo** — se actualiza con cada sprint. Sirve como hoja de ruta, checklist de progreso y registro histórico de decisiones tomadas.

**Última actualización:** 2026-05-17 (Sprint 1 completado)
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
| Líneas en `app.js` | 6,840 | **6,840** | < 3,000 |
| Líneas en `EmployeesUI.js` | 1,068 | **1,112** ⚠️ +44 | < 600 |
| Líneas en `AttendanceUI.js` | 871 | **871** | < 600 |
| Tests pasando | 36 | **57** ✅ +21 | 100+ |
| Cobertura estimada | ~20% | **~28%** | > 60% |
| Onclicks inline | 0 ✅ | **0** | 0 ✅ |

> ⚠️ EmployeesUI subió 44 líneas: +44 por `cleanupPositionReferences`. Se compensará en Sprint 7 (extracción).

### Progreso global

```
Sprints completados:  1 / 8 ███░░░░░░░░░░░░░░░░  12%
Tests escritos:      57 /100 ███████████░░░░░░░░  57%
Líneas reducidas:     0 /3000 ░░░░░░░░░░░░░░░░░░   0%
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

### 🏃 Sprint 2: Tests del Sistema Actual  **(0/5 — 0%)**

**Objetivo:** Red de seguridad antes de empezar a mover código.
**Esfuerzo estimado:** 1-2 días
**Estado:** ⏳ Pendiente
**Prerequisito:** Sprint 1 completado

#### Tareas

- [ ] **Tests para `PersistenceService`**
  - `saveApplicationData()` guarda correctamente
  - `loadApplicationData()` carga desde IndexedDB
  - Fallback a localStorage funciona
  - Sanitización detecta huérfanas
  - **Tests esperados:** 6-8

- [ ] **Tests para flujo de attendance toggle**
  - Click en checkbox sin asistencia → crea asistencia
  - Click en checkbox CON asistencia → abre context menu
  - Toggle de horas en multi-posición
  - UndoManager funciona después de eliminar
  - **Tests esperados:** 5-7

- [ ] **Tests para `FormComponent`**
  - Validación inline aparece al blur
  - Doble submit bloqueado
  - onSubmit recibe los datos correctos
  - Cancelar restaura estado original
  - **Tests esperados:** 4-6

- [ ] **Tests para Notes Center (apertura, lista, edición)**
  - Open/close del modal
  - Selección de empleado
  - Crear, editar, eliminar nota
  - **Tests esperados:** 5-7

- [ ] **Tests para Export Menu (preparación)**
  - Open/close del menú
  - Botones de share funcionan
  - **Tests esperados:** 3-4

**Total tests esperados:** ~23-32 nuevos

#### Bitácora

```
(vacío hasta empezar)
```

---

### 🏃 Sprint 3: Extracción de Notes Center  **(0/5 — 0%)**

**Objetivo:** Definir el patrón de extracción que repetiremos. Notes es ideal por ser una feature aislada.
**Esfuerzo estimado:** 1-2 días
**Estado:** ⏳ Pendiente
**Prerequisito:** Tests de Notes Center del Sprint 2

#### Tareas

- [ ] **Crear estructura `js/modules/features/notes/`**
  - `NotesService.js` (lógica de negocio)
  - `NotesCenter.js` (modal principal)
  - `NoteEditorModal.js` (edición individual)
  - `index.js` (export público)

- [ ] **Migrar código desde app.js**
  - Funciones: `openNotesCenter`, `closeNotesCenter`, `selectNotesEmployee`, `openNoteEditor`, `openNewNote`, `saveNoteModal`, `deleteNoteModal`, `closeNoteModal`
  - Templates: `NotesCenterModal()`, `NoteModal()`
  - Estado relacionado a notas

- [ ] **Reconectar con event delegation**
  - Mantener `data-app-fn` o crear `data-notes-action` local
  - Verificar que los botones siguen funcionando

- [ ] **Documentar el patrón**
  - `js/modules/features/notes/README.md` con:
    - Estructura interna
    - Cómo se conecta con el resto
    - Cómo añadir nuevas features siguiendo este patrón

- [ ] **Verificación**
  - Tests del Sprint 2 siguen pasando ✓
  - Tests específicos del módulo siguen pasando ✓
  - Líneas en app.js: medir reducción
  - Commit con mensaje claro

**Resultado esperado:** `app.js` reduce ~250 líneas

#### Bitácora

```
(vacío hasta empezar)
```

---

### 🏃 Sprint 4: Extracción de Export Menu  **(0/4 — 0%)**

**Objetivo:** Aplicar el patrón del Sprint 3 a otra feature aislada.
**Esfuerzo estimado:** 1-2 días
**Estado:** ⏳ Pendiente

#### Tareas

- [ ] **Crear `js/modules/features/export/`**
- [ ] **Migrar ExportMenu, ImportFullModal, lógica de compartir**
- [ ] **Tests específicos del módulo**
- [ ] **Verificación + commit**

**Resultado esperado:** `app.js` reduce ~350 líneas

#### Bitácora

```
(vacío hasta empezar)
```

---

### 🏃 Sprint 5: Performance del Render Inicial  **(0/5 — 0%)**

**Objetivo:** Reducir el render inicial de 180-258ms a <100ms.
**Esfuerzo estimado:** 1 día
**Estado:** ⏳ Pendiente

#### Tareas

- [ ] **Profiling con DevTools Performance tab**
  - Identificar el componente que más bloquea
  - Documentar el "antes" como baseline

- [ ] **Aplicar `batchSetState` donde hay `state.X = Y; render()` consecutivos**
  - Buscar todos los patrones
  - Aplicar el batch
  - Test que verifique 1 render para múltiples mutaciones

- [ ] **Lazy load de componentes pesados (Analytics, Payroll)**
  - Solo cargar cuando el usuario va a esa pestaña
  - Test que verifique que la primera pantalla no carga estos módulos

- [ ] **Optimización dirigida del cuello identificado**

- [ ] **Verificación: test de performance regression**
  - Medir tiempo de render inicial
  - Test que falle si vuelve a degradarse

**Resultado esperado:** primer render < 100ms

#### Bitácora

```
(vacío hasta empezar)
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
| _pendiente_ | S2 | — | — | — | — |
| ... | ... | ... | ... | ... | ... |

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
