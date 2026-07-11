/**
 * AppAttendanceCoherenceTests — Fase 4 Paso 3 (app.js, el god file).
 *
 * app.js NO es testeable conductualmente (es el entry point; importarlo corre
 * toda la inicialización + listeners DOM). Convención del repo para app.js:
 * TEST DE CONTRATO sobre el fuente (ver AppWiringMigrationTests / AttendanceSyncRing).
 * Verificamos que cada handler de asistencia mantenga la coherencia EXPLÍCITA
 * (invalidateEmployeeStats/invalidateAllStats + buildAttendanceIndex), incluida
 * la que va DENTRO de las closures de undo. El comportamiento de esos helpers ya
 * está cubierto por sus propios tests conductuales.
 *
 * Se crece por familia (un sub-commit = una familia de handlers).
 */

import fs from 'fs';
import path from 'path';

const SRC = fs.readFileSync(path.resolve(__dirname, '../app.js'), 'utf8');

// Extrae el cuerpo de un handler acotando entre dos anchors fijos del archivo.
function between(startAnchor, endAnchor) {
    const start = SRC.indexOf(startAnchor);
    if (start === -1) return '';
    const end = SRC.indexOf(endAnchor, start + startAnchor.length);
    return SRC.slice(start, end === -1 ? SRC.length : end);
}

function countOccurrences(haystack, needle) {
    if (!haystack) return 0;
    return haystack.split(needle).length - 1;
}

// Para sitios bulk: toma una ventana corta JUSTO después de la mutación y
// verifica el patrón total (invalidateAllStats + buildAttendanceIndex SIN argumento).
function sliceAfter(anchor, len) {
    const i = SRC.indexOf(anchor);
    if (i === -1) return '';
    return SRC.slice(i, i + len);
}
const TOTAL_REBUILD = /buildAttendanceIndex\(\s*\)/; // sin arg = rebuild total (NO el granular (dateKey))

testRunner.addSuite("app.js — Coherencia de asistencia (contrato, Fase 4 Paso 3)", {

    "importa los helpers de coherencia desde AppState"() {
        testRunner.assert(
            /import\s*\{[\s\S]*?\binvalidateEmployeeStats\b[\s\S]*?\}\s*from\s*['"]\.\/modules\/core\/AppState\.js['"]/.test(SRC),
            'app.js debe importar invalidateEmployeeStats de AppState'
        );
        testRunner.assert(
            /import\s*\{[\s\S]*?\bbuildAttendanceIndex\b[\s\S]*?\}\s*from\s*['"]\.\/modules\/core\/AppState\.js['"]/.test(SRC),
            'app.js debe importar buildAttendanceIndex de AppState'
        );
        testRunner.assert(
            /import\s*\{[\s\S]*?\binvalidateAllStats\b[\s\S]*?\}\s*from\s*['"]\.\/modules\/core\/AppState\.js['"]/.test(SRC),
            'app.js debe importar invalidateAllStats de AppState (para los sitios bulk)'
        );
    },

    // ─── FAMILIA 1: toggle de día (window.toggleAttendance) ───
    // Dos ramas (alta/baja) cubiertas por UNA llamada compartida + cada closure
    // de undo con su propia coherencia → 3 insertions de cada helper.
    "toggleAttendance mantiene coherencia en alta, baja y ambas closures de undo"() {
        const body = between('window.toggleAttendance = (empId, date', 'function updateCheckboxOnly');
        // Guard de boundary: si un anchor cambia y between() captura de más, el
        // conteo se inflaría y el test daría falso verde. Acotamos el tamaño.
        testRunner.assert(body.length > 0 && body.length < 6000, 'el cuerpo de toggleAttendance debe acotarse bien (boundary sano)');
        testRunner.assert(
            countOccurrences(body, 'invalidateEmployeeStats(empId)') >= 3,
            'toggleAttendance debe invalidar stats en alta/baja + las 2 closures de undo (>=3)'
        );
        testRunner.assert(
            countOccurrences(body, 'buildAttendanceIndex(getDateKey(date))') >= 3,
            'toggleAttendance debe reconstruir el índice del día en alta/baja + las 2 closures de undo (>=3)'
        );
    },

    // ─── FAMILIA 2: borrado directo (window.deleteCurrentAttendance) ───
    // Delete principal + closure de undo (restaurar) → 2 insertions de cada helper.
    // Usa un dateKey capturado (estable para la closure).
    "deleteCurrentAttendance mantiene coherencia en el delete y en la closure de undo"() {
        const body = between('window.deleteCurrentAttendance = function', 'window.removePositionHours');
        testRunner.assert(body.length > 0 && body.length < 4000, 'el cuerpo de deleteCurrentAttendance debe acotarse bien');
        testRunner.assert(
            countOccurrences(body, 'invalidateEmployeeStats(emp.id)') >= 2,
            'deleteCurrentAttendance debe invalidar stats en el delete + la closure de undo (>=2)'
        );
        testRunner.assert(
            countOccurrences(body, 'buildAttendanceIndex(dateKey)') >= 2,
            'deleteCurrentAttendance debe reconstruir el índice en el delete + la closure de undo (>=2)'
        );
    },

    // Render batching (Fase 4 Paso 5): el delete + la coherencia van en batchSetState y
    // se suelta el render() manual (el delete-trap ya agenda el repintado). En jsdom el
    // render-count no es medible (window.render es stub), por eso es contrato-de-fuente.
    "deleteCurrentAttendance batchea el delete y NO llama render() a mano (Paso 5)"() {
        const body = between('window.deleteCurrentAttendance = function', 'window.removePositionHours');
        testRunner.assert(
            body.includes('stateManager.batchSetState'),
            'el delete + la coherencia deben ir envueltos en stateManager.batchSetState'
        );
        testRunner.assert(
            countOccurrences(body, 'render()') === 0,
            'ya NO debe llamar render() a mano: el repintado lo agenda batchSetState al cerrar'
        );
    },

    // ─── FAMILIA 3: multi-posición ───
    // Solo el COMMIT (saveMultiPosition) y el DELETE (removePositionHours) tocan
    // hoursWorked/las claves. Las ops de edición (add/update/splice) cambian
    // positionHours pero NO hoursWorked → las stats mensuales (que suman hoursWorked)
    // no cambian → NO llevan coherencia (decisión por evidencia, no por el mapa).
    "saveMultiPosition mantiene coherencia en el commit y en la closure de undo"() {
        const body = between('window.saveMultiPosition = function', 'window.deleteCurrentAttendance');
        testRunner.assert(body.length > 0 && body.length < 5000, 'el cuerpo de saveMultiPosition debe acotarse bien');
        testRunner.assert(
            countOccurrences(body, 'invalidateEmployeeStats(emp.id)') >= 2,
            'saveMultiPosition debe invalidar stats en el commit + la closure de undo (>=2)'
        );
        testRunner.assert(
            countOccurrences(body, 'buildAttendanceIndex(dateKey)') >= 2,
            'saveMultiPosition debe reconstruir el índice en el commit + la closure de undo (>=2)'
        );
    },

    "removePositionHours mantiene coherencia solo en la rama de borrado del registro"() {
        const body = between('window.removePositionHours = async function', 'LOCALSTORAGE - PERSISTENCIA');
        testRunner.assert(body.length > 0 && body.length < 2500, 'el cuerpo de removePositionHours debe acotarse bien');
        testRunner.assert(
            countOccurrences(body, 'invalidateEmployeeStats(emp.id)') >= 1,
            'removePositionHours debe invalidar stats al borrar el registro completo'
        );
        testRunner.assert(
            countOccurrences(body, 'buildAttendanceIndex(dateKey)') >= 1,
            'removePositionHours debe reconstruir el índice al borrar el registro completo'
        );
    },

    "las ops de edición de posiciones NO llevan coherencia (no tocan hoursWorked)"() {
        const addBody = between('window.addPositionHours', 'window.updatePositionHours');
        const updBody = between('window.updatePositionHours', 'window.updateTotalsDisplay');
        testRunner.assert(addBody.length > 0 && updBody.length > 0, 'deben encontrarse addPositionHours y updatePositionHours');
        testRunner.assert(
            countOccurrences(addBody, 'invalidateEmployeeStats') === 0,
            'addPositionHours NO debe invalidar stats (cambia positionHours, no hoursWorked)'
        );
        testRunner.assert(
            countOccurrences(updBody, 'invalidateEmployeeStats') === 0,
            'updatePositionHours NO debe invalidar stats (edición in-place de positionHours)'
        );
    },

    // ─── FAMILIA 4: vista semanal (handleWeekCheck, removeAttendance) ───
    // Cada uno: mutación principal + closure de undo → 2 insertions de cada helper.
    // (dateStr ES el dateKey en esta vista.)
    "handleWeekCheck mantiene coherencia en el alta y en la closure de undo"() {
        const body = between('window.handleWeekCheck = ', 'window.handleWeekCheckClick');
        testRunner.assert(body.length > 0 && body.length < 6000, 'el cuerpo de handleWeekCheck debe acotarse bien');
        testRunner.assert(
            countOccurrences(body, 'invalidateEmployeeStats(empId)') >= 2,
            'handleWeekCheck debe invalidar stats en el alta + la closure de undo (>=2)'
        );
        testRunner.assert(
            countOccurrences(body, 'buildAttendanceIndex(dateStr)') >= 2,
            'handleWeekCheck debe reconstruir el índice en el alta + la closure de undo (>=2)'
        );
    },

    // Render batching (Fase 4 Paso 5): ambas ramas (menú UI y alta financiera) batchean
    // sus writes y sueltan el render() manual. Contrato-de-fuente (jsdom no mide render).
    "handleWeekCheck batchea ambas ramas y NO llama render() a mano (Paso 5)"() {
        const body = between('window.handleWeekCheck = ', 'window.handleWeekCheckClick');
        testRunner.assert(
            countOccurrences(body, 'stateManager.batchSetState') >= 2,
            'ambas ramas (UI y alta) deben envolver sus writes en stateManager.batchSetState'
        );
        testRunner.assert(
            countOccurrences(body, 'render()') === 0,
            'ya NO debe llamar render() a mano en ninguna rama: lo agenda batchSetState al cerrar'
        );
    },

    "removeAttendance mantiene coherencia en la baja in-place y en la closure de undo"() {
        const body = between('window.removeAttendance = ', 'window.toggleLegend');
        testRunner.assert(body.length > 0 && body.length < 2500, 'el cuerpo de removeAttendance debe acotarse bien');
        testRunner.assert(
            countOccurrences(body, 'invalidateEmployeeStats(empId)') >= 2,
            'removeAttendance debe invalidar stats en la baja + la closure de undo (>=2)'
        );
        testRunner.assert(
            countOccurrences(body, 'buildAttendanceIndex(dateStr)') >= 2,
            'removeAttendance debe reconstruir el índice en la baja + la closure de undo (>=2)'
        );
    },

    // Render batching (Fase 4 Paso 5): la baja in-place + coherencia + contextMenu van en
    // batchSetState y se suelta el render() manual. Contrato-de-fuente (jsdom no mide render).
    "removeAttendance batchea la baja y NO llama render() a mano (Paso 5)"() {
        const body = between('window.removeAttendance = ', 'window.toggleLegend');
        testRunner.assert(
            body.includes('stateManager.batchSetState'),
            'la baja + la coherencia deben ir envueltas en stateManager.batchSetState'
        );
        testRunner.assert(
            countOccurrences(body, 'render()') === 0,
            'ya NO debe llamar render() a mano: el repintado lo agenda batchSetState al cerrar'
        );
    },

    // Judgment Day Fase 1 R1: la baja de removeAttendance (vista semanal) es el
    // mismo intento de usuario que toggleAttendance (uncheck) y deleteCurrentAttendance
    // — ambos SÍ tombstonean (deletedAt). removeAttendance mutaba in-place sin marca:
    // las notas quedaban visibles (NotesCenter/detalle filtran por deletedAt, no por
    // .present) y el registro nunca entraba a la compactación de 60 días (U2d).
    "removeAttendance tombstonea el registro real (deletedAt), igual que toggleAttendance/deleteCurrentAttendance (Judgment Day Fase 1 R1)"() {
        const body = between('window.removeAttendance = ', 'window.toggleLegend');
        testRunner.assert(
            body.includes('tombstoneAttendanceWrite(state.attendance[key])'),
            'removeAttendance debe rutear la baja por tombstoneAttendanceWrite (deletedAt) — si no, las notas quedan visibles y nunca compacta a los 60 días'
        );
        testRunner.assert(
            !/att\.hoursWorked\s*=\s*0/.test(body),
            'ya NO debe mutar campos in-place a mano (present/hoursWorked/overtimeHours/positionHours/updatedAt) sin pasar por el choke point de tombstone'
        );
    },

    // ─── FAMILIA 5: detalle de horas y nota rápida ───
    "saveAttendanceDetailHours mantiene coherencia tras escribir hoursWorked"() {
        const body = between('window.saveAttendanceDetailHours = ', 'window.saveQuickNoteFromDetail');
        testRunner.assert(body.length > 0 && body.length < 3500, 'el cuerpo de saveAttendanceDetailHours debe acotarse bien');
        testRunner.assert(
            countOccurrences(body, 'invalidateEmployeeStats(emp.id)') >= 1,
            'saveAttendanceDetailHours debe invalidar stats (edita hoursWorked)'
        );
        testRunner.assert(
            countOccurrences(body, 'buildAttendanceIndex(dateKey)') >= 1,
            'saveAttendanceDetailHours debe reconstruir el índice del día'
        );
    },

    // Render batching (Fase 4 Paso 5): el write + la coherencia van en batchSetState y se
    // suelta el render() manual. Contrato-de-fuente (jsdom no mide render).
    "saveAttendanceDetailHours batchea el write y NO llama render() a mano (Paso 5)"() {
        const body = between('window.saveAttendanceDetailHours = ', 'window.saveQuickNoteFromDetail');
        testRunner.assert(
            body.includes('stateManager.batchSetState'),
            'el write + la coherencia deben ir envueltos en stateManager.batchSetState'
        );
        testRunner.assert(
            countOccurrences(body, 'render()') === 0,
            'ya NO debe llamar render() a mano: el repintado lo agenda batchSetState al cerrar'
        );
    },

    "saveQuickNoteFromDetail mantiene coherencia (el upsert puede crear un registro)"() {
        const body = between('window.saveQuickNoteFromDetail = ', 'Click delegation');
        testRunner.assert(body.length > 0 && body.length < 2500, 'el cuerpo de saveQuickNoteFromDetail debe acotarse bien');
        testRunner.assert(
            countOccurrences(body, 'invalidateEmployeeStats(empId)') >= 1,
            'saveQuickNoteFromDetail debe invalidar stats (patrón uniforme con NotesController)'
        );
        testRunner.assert(
            countOccurrences(body, 'buildAttendanceIndex(dateKey)') >= 1,
            'saveQuickNoteFromDetail debe reconstruir el índice (un upsert puede crear el registro)'
        );
    },

    // Render batching (Fase 4 Paso 5): el upsert/clear + coherencia van en batchSetState
    // y se suelta el render() manual. No-financiero pero igual gana 2→1 (tenía render() explícito).
    "saveQuickNoteFromDetail batchea el upsert y NO llama render() a mano (Paso 5)"() {
        const body = between('window.saveQuickNoteFromDetail = ', 'Click delegation');
        testRunner.assert(
            body.includes('stateManager.batchSetState'),
            'el upsert/clear + la coherencia deben ir envueltos en stateManager.batchSetState'
        );
        testRunner.assert(
            countOccurrences(body, 'render()') === 0,
            'ya NO debe llamar render() a mano: el repintado lo agenda batchSetState al cerrar'
        );
    },

    // ─── FAMILIA 6a: cargas bulk cloud/snapshot ───
    // Reemplazos de TODO el dataset → patrón TOTAL: invalidateAllStats() + buildAttendanceIndex()
    // SIN argumento, sincrónico justo tras la mutación (antes del render que lee derivados).
    "downloadFromCloud (sobrescritura) mantiene coherencia total tras reemplazar la asistencia"() {
        // Fase 0.5 (U4): la sobrescritura vive ahora en DataOps.replaceLocalWithCloud
        // (app.js sólo delega). El contrato de coherencia total es el mismo.
        const dataOpsSrc = fs.readFileSync(path.resolve(__dirname, '../modules/services/DataOps.js'), 'utf8');
        const i = dataOpsSrc.indexOf('state.attendance = attendance');
        testRunner.assert(i !== -1, 'debe existir la sobrescritura de asistencia en DataOps');
        const s = dataOpsSrc.slice(i, i + 600);
        testRunner.assert(s.includes('invalidateAllStats()'), 'debe limpiar todas las stats (bulk)');
        testRunner.assert(TOTAL_REBUILD.test(s), 'debe reconstruir el índice TOTAL (sin argumento)');
    },

    "snapshot onRestore mantiene coherencia total tras reemplazar la asistencia"() {
        // Incidente 2026-07-11: la asistencia restaurada ahora llega re-estampada
        // vía prepareRestoredState (la restauración debe GANAR el LWW).
        const s = sliceAfter('state.attendance = prepared.attendance', 700);
        testRunner.assert(s.length > 0, 'debe existir el reemplazo del snapshot');
        testRunner.assert(s.includes('invalidateAllStats()'), 'debe limpiar todas las stats (bulk)');
        testRunner.assert(TOTAL_REBUILD.test(s), 'debe reconstruir el índice TOTAL (sin argumento)');
    },

    "downloadFromCloud (merge) mantiene coherencia total tras fusionar la asistencia remota"() {
        // Fase 1 (U3): el spread ciego se ruteó por mergeAttendanceRecords (LWW puro).
        const s = sliceAfter('mergeAttendanceRecords(state.attendance, remoteAttendance)', 300);
        testRunner.assert(s.length > 0, 'debe existir el merge de remoteAttendance');
        testRunner.assert(s.includes('invalidateAllStats()'), 'debe limpiar todas las stats (bulk)');
        testRunner.assert(TOTAL_REBUILD.test(s), 'debe reconstruir el índice TOTAL (sin argumento)');
    },

    // ─── FAMILIA 6b: restore local (applyBackupData) ───
    // Una sola coherencia bulk tras sanitizePositions y antes de persistir; subsume
    // la invalidación de sanitize.
    "applyBackupData mantiene coherencia total tras el restore (post-sanitize, pre-persist)"() {
        const body = between('async function applyBackupData', 'window.importData');
        testRunner.assert(body.length > 0 && body.length < 3000, 'el cuerpo de applyBackupData debe acotarse bien');
        testRunner.assert(body.includes('invalidateAllStats()'), 'debe limpiar todas las stats (bulk)');
        testRunner.assert(TOTAL_REBUILD.test(body), 'debe reconstruir el índice TOTAL (sin argumento)');
        // Orden: coherencia DESPUÉS de sanitizePositions y ANTES de saveToIndexedDB.
        const sanitizeIdx = body.indexOf('sanitizePositions(state)');
        const coherenceIdx = body.search(/invalidateAllStats\(\)/);
        const persistIdx = body.indexOf('saveToIndexedDB');
        testRunner.assert(sanitizeIdx !== -1 && persistIdx !== -1, 'deben existir sanitizePositions y saveToIndexedDB');
        testRunner.assert(
            coherenceIdx > sanitizeIdx && coherenceIdx < persistIdx,
            'la coherencia debe ir tras sanitizePositions y antes de saveToIndexedDB'
        );
    },

    // ─── FAMILIA 6c: Firebase zonal ───
    // onInitialLoad = muchas fechas → TOTAL; onModified = una fecha (hot path) → GRANULAR.
    "Firebase onInitialLoad mantiene coherencia TOTAL tras la carga remota inicial"() {
        // Judgment Day Fase 1 R1: onInitialLoad pasó a `async (allAttendance) =>`
        // (validateDataIntegrity() ahora es async) — el anchor debe reflejar el
        // `async` para seguir acotando el mismo bloque.
        const body = between('onInitialLoad: async (allAttendance) =>', 'onModified:');
        // Cap 5800 (era 4900, antes 3900): R2 reubicó el reset de
        // _isApplyingRemoteData al final del callback y R3 sumó el re-armado
        // del watchdog antes del await (+comentarios explicativos). Medido:
        // 5530 — el cap deja ~5% de margen, consistente con el estilo de esta
        // familia de guards (crecer exige tocar este número a conciencia).
        // El contrato real (TOTAL + orden) lo cubren las aserciones de abajo.
        testRunner.assert(body.length > 0 && body.length < 5800, 'el cuerpo de onInitialLoad debe acotarse bien');
        testRunner.assert(body.includes('invalidateAllStats()'), 'debe limpiar todas las stats (bulk)');
        testRunner.assert(TOTAL_REBUILD.test(body), 'debe reconstruir el índice TOTAL (sin argumento)');
        // Orden: coherencia DESPUÉS de validateDataIntegrity (que muta in-place) y ANTES del render.
        const vdiIdx = body.indexOf('validateDataIntegrity()');
        const cohIdx = body.search(/invalidateAllStats\(\)/);
        const renderIdx = body.indexOf('render()');
        testRunner.assert(vdiIdx !== -1 && renderIdx !== -1, 'deben existir validateDataIntegrity y render');
        testRunner.assert(
            cohIdx > vdiIdx && cohIdx < renderIdx,
            'la coherencia total debe ir tras validateDataIntegrity y antes del render'
        );
    },

    // Judgment Day Fase 1 Ronda 2: validateDataIntegrity() es async y SUSPENDE
    // de verdad acá (await real, no cosmético) — bajar la señal "estoy aplicando
    // datos remotos" antes de esa suspensión dejaba una ventana real (sin
    // necesitar timing adversarial) donde otro código podía leer
    // _isApplyingRemoteData === false y confiar en datos ya fusionados pero con
    // stats/índice todavía desactualizados (invalidateAllStats/buildAttendanceIndex
    // corren recién después). El reset debe quedar DESPUÉS de buildAttendanceIndex().
    "Firebase onInitialLoad reubica el reset de _isApplyingRemoteData DESPUÉS del await validateDataIntegrity y de buildAttendanceIndex (Judgment Day Fase 1 R2)"() {
        const body = between('onInitialLoad: async (allAttendance) =>', 'onModified:');
        testRunner.assert(body.length > 0, 'debe existir el cuerpo de onInitialLoad');
        const resetIdx = body.indexOf('window._isApplyingRemoteData = false;');
        const awaitIdx = body.indexOf('await validateDataIntegrity()');
        const buildIdx = body.search(/buildAttendanceIndex\(\s*\)/);
        testRunner.assert(
            resetIdx !== -1 && awaitIdx !== -1 && buildIdx !== -1,
            'deben existir el reset del flag, el await de validateDataIntegrity y el rebuild total del índice'
        );
        testRunner.assert(
            resetIdx > awaitIdx,
            'el reset de _isApplyingRemoteData NO debe ocurrir antes del await validateDataIntegrity() — dejaría una ventana real donde el flag ya está en false pero state.attendanceByDate/stats siguen desactualizados'
        );
        testRunner.assert(
            resetIdx > buildIdx,
            'el reset de _isApplyingRemoteData debe ocurrir DESPUÉS de buildAttendanceIndex(), para que la señal "no confíes en mí todavía" cubra toda la ventana de suspensión'
        );
    },

    // Judgment Day Fase 1 Ronda 3 (Juez A, teórico endurecido): el watchdog de
    // _isApplyingRemoteData arranca su timer de 4s al INICIO del handler; el
    // trabajo síncrono previo (limpieza shortKey + merge LWW + loop del
    // BatchedSaver) ya consume parte de ese presupuesto. Si el await de
    // validateDataIntegrity (lectura de IndexedDB del outbox, U2d) tardara más
    // que el resto del presupuesto, el watchdog liberaría el flag a MITAD de la
    // sección crítica — reabriendo por otra vía la ventana que el fix R2 cerró.
    // Re-armar el watchdog justo antes del await le da a la sección awaiteada
    // su presupuesto completo de 4s.
    "Firebase onInitialLoad re-arma el watchdog ANTES del await de validateDataIntegrity (Judgment Day Fase 1 R3)"() {
        const body = between('onInitialLoad: async (allAttendance) =>', 'onModified:');
        testRunner.assert(body.length > 0, 'debe existir el cuerpo de onInitialLoad');
        const lastWatchdogIdx = body.lastIndexOf('armApplyingFlagWatchdog()');
        const addLoopIdx = body.indexOf('_attendanceBatchedSaver.add(');
        const awaitIdx = body.indexOf('await validateDataIntegrity()');
        testRunner.assert(
            lastWatchdogIdx !== -1 && addLoopIdx !== -1 && awaitIdx !== -1,
            'deben existir el watchdog, el loop del BatchedSaver y el await de validateDataIntegrity'
        );
        testRunner.assert(
            lastWatchdogIdx > addLoopIdx && lastWatchdogIdx < awaitIdx,
            'debe haber un re-armado del watchdog DESPUÉS del trabajo síncrono (loop del BatchedSaver) y ANTES del await — si no, el timer de 4s puede vencer a mitad de la suspensión y liberar el flag en plena sección crítica'
        );
    },

    "Firebase onModified mantiene coherencia GRANULAR (por empleado + bucket del día, sin total)"() {
        const body = between('onModified: (dateKey, records) =>', 'Iniciar primera suscripción');
        // Cap 3200 (era 3000): +1 línea defensiva armApplyingFlagWatchdog() (R3).
        // El contrato real (granular, sin total) lo cubren las aserciones de abajo.
        testRunner.assert(body.length > 0 && body.length < 3200, 'el cuerpo de onModified debe acotarse bien');
        testRunner.assert(body.includes('buildAttendanceIndex(dateKey)'), 'debe reconstruir GRANULAR el bucket del día');
        testRunner.assert(body.includes('invalidateEmployeeStats('), 'debe invalidar stats por empleado tocado');
        // Negativos: hot path → NUNCA bulk ni rebuild total.
        testRunner.assert(!body.includes('invalidateAllStats('), 'onModified NO debe usar invalidateAllStats (hot path)');
        testRunner.assert(!TOTAL_REBUILD.test(body), 'onModified NO debe usar buildAttendanceIndex() total (solo granular)');
        // Hyphen-safety: deriva por employeeId, no por split de la clave.
        testRunner.assert(body.includes('r.employeeId') || body.includes('record.employeeId'),
            'debe derivar el empleado por employeeId, no por split de la clave compuesta');
    },

    // ─── FAMILIA 6d: callers sueltos de sanitizePositions (init + mirror-sync) ───
    // Patrón: if (sanitizePositions(state)) { invalidateAllStats(); ... } — SIN buildAttendanceIndex
    // (remapeo in-place de positionId: afecta positionSalaries → stats, pero no claves/fechas).
    "los callers guardados de sanitizePositions invalidan stats (sin rebuild de índice)"() {
        const guarded = (SRC.match(/if \(sanitizePositions\(state\)\)/g) || []).length;
        testRunner.assertEquals(guarded, 2, 'deben existir los 2 callers guardados (init + mirror-sync)');
        const withInvalidate = (SRC.match(/if \(sanitizePositions\(state\)\) \{[\s\S]{0,300}?invalidateAllStats\(\)/g) || []).length;
        testRunner.assertEquals(withInvalidate, 2, 'ambos callers guardados deben invalidar todas las stats');
        const withRebuild = (SRC.match(/if \(sanitizePositions\(state\)\) \{[\s\S]{0,300}?buildAttendanceIndex\(/g) || []).length;
        testRunner.assertEquals(withRebuild, 0, 'NO debe haber buildAttendanceIndex en los sanitize callers (no cambian claves)');
    }
});

console.log('AppAttendanceCoherence tests cargados.');
