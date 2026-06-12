/**
 * 🧪 AttendanceSyncRingTests — patrón "WhatsApp" para la asistencia
 *
 * Marcar asistencia es una acción EN RÁFAGA (20 empleados seguidos): el toast
 * por acción era la herramienta equivocada (ruido o, peor, feedback tardío).
 * Nuevo diseño:
 *   - El check responde al instante (local) y muestra un ANILLO girando
 *     mientras el cambio sube a la nube (clase .cloud-pending en el
 *     .check-container — updateCheckboxOnly no la pisa porque solo resetea
 *     .check-box).
 *   - Cuando el espejo confirma: anillos fuera + UN solo toast agregado
 *     "N asistencias guardadas en la nube".
 *   - Si la nube falla: anillos en ámbar (.cloud-failed) + toast amarillo.
 *
 * El tracker es una máquina pura (deps inyectadas). El cableado real:
 * toggleAttendance → markPending; el mirror de PersistenceService emite
 * 'sync:mirror-result' por eventBus; app.js conecta ambos.
 */

import fs from 'fs';
import path from 'path';
import { createAttendanceSyncTracker } from '../modules/services/AttendanceSyncTracker.js';

const read = (rel) => fs.readFileSync(path.resolve(__dirname, rel), 'utf8');
const APP_SRC = read('../app.js');
const PS_SRC = read('../modules/services/PersistenceService.js');
const CSS_SRC = read('../../css/styles.css');

function makeTracker() {
    const marks = [];   // {empId, state}
    const toasts = [];  // {level, message}
    const tracker = createAttendanceSyncTracker({
        applyMark: (empId, state) => marks.push({ empId, state }),
        notify: (level, message) => toasts.push({ level, message })
    });
    return { tracker, marks, toasts };
}

testRunner.addSuite("AttendanceSyncTracker — anillo por check + contador agregado", {

    "markPending aplica el estado 'pending' al check del empleado"() {
        const { tracker, marks } = makeTracker();
        tracker.markPending('emp-1');
        testRunner.assertEquals(marks.length, 1, 'una marca');
        testRunner.assertEquals(marks[0].empId, 'emp-1');
        testRunner.assertEquals(marks[0].state, 'pending', 'anillo girando');
        testRunner.assertEquals(tracker.pendingCount(), 1);
    },

    "markPending repetido del mismo empleado no duplica el conteo"() {
        const { tracker } = makeTracker();
        tracker.markPending('emp-1');
        tracker.markPending('emp-1'); // marcar/desmarcar rápido
        testRunner.assertEquals(tracker.pendingCount(), 1, 'dedupe por empleado');
    },

    "cloudConfirmed: cada check pasa a 'synced' y UN toast con el conteo"() {
        const { tracker, marks, toasts } = makeTracker();
        tracker.markPending('emp-1');
        tracker.markPending('emp-2');
        tracker.markPending('emp-3');
        tracker.cloudConfirmed();
        const synced = marks.filter(m => m.state === 'synced');
        testRunner.assertEquals(synced.length, 3, 'los 3 checks confirmados');
        testRunner.assertEquals(toasts.length, 1, 'UN solo toast para la ráfaga');
        testRunner.assertEquals(toasts[0].level, 'success', 'verde');
        testRunner.assert(/3 asistencias/.test(toasts[0].message), 'dice cuántas');
        testRunner.assert(/nube/i.test(toasts[0].message), 'menciona la nube');
        testRunner.assertEquals(tracker.pendingCount(), 0, 'pendientes limpiados');
    },

    "singular: '1 asistencia guardada' (no '1 asistencias')"() {
        const { tracker, toasts } = makeTracker();
        tracker.markPending('emp-1');
        tracker.cloudConfirmed();
        testRunner.assert(/1 asistencia guardada/.test(toasts[0].message),
            'gramática singular correcta');
    },

    "cloudFailed: checks en ámbar y toast amarillo con el conteo"() {
        const { tracker, marks, toasts } = makeTracker();
        tracker.markPending('emp-1');
        tracker.markPending('emp-2');
        tracker.cloudFailed();
        const failed = marks.filter(m => m.state === 'failed');
        testRunner.assertEquals(failed.length, 2, 'ambos checks en ámbar');
        testRunner.assertEquals(toasts[0].level, 'warning', 'amarillo');
        testRunner.assert(/2 asistencias/.test(toasts[0].message), 'conteo');
        testRunner.assert(/equipo/i.test(toasts[0].message), 'aclara que local sí está');
    },

    "confirm/fail sin pendientes → silencio total (syncs de fondo no spamean)"() {
        const { tracker, marks, toasts } = makeTracker();
        tracker.cloudConfirmed();
        tracker.cloudFailed();
        testRunner.assertEquals(marks.length, 0, 'sin marcas');
        testRunner.assertEquals(toasts.length, 0, 'sin toasts');
    },

    "reapplyPending re-aplica el anillo a TODOS los pendientes (sobrevive renders)"() {
        // Un render completo recrea las filas y borra las clases del DOM.
        // El tracker debe poder re-aplicarlas (app.js lo llama en render:complete);
        // sin esto el anillo amarillo desaparecía antes de poder verse.
        const { tracker, marks } = makeTracker();
        tracker.markPending('emp-1');
        tracker.markPending('emp-2');
        marks.length = 0; // simular que el render borró el DOM
        tracker.reapplyPending();
        const reapplied = marks.filter(m => m.state === 'pending').map(m => m.empId).sort();
        testRunner.assertEquals(JSON.stringify(reapplied), JSON.stringify(['emp-1', 'emp-2']),
            'ambos anillos re-aplicados');
        testRunner.assertEquals(tracker.pendingCount(), 2, 'los pendientes no cambian');
    },

    "reapplyPending sin pendientes → no toca el DOM"() {
        const { tracker, marks } = makeTracker();
        tracker.reapplyPending();
        testRunner.assertEquals(marks.length, 0, 'silencio');
    }

});

testRunner.addSuite("Anillo de sync — cableado real (fuente + CSS)", {

    "toggleAttendance usa el tracker (y ya no el toast announce)"() {
        testRunner.assert(/attendanceSyncTracker\.markPending\(empId\)/.test(APP_SRC),
            'toggleAttendance debe registrar el empleado en el tracker');
        testRunner.assert(!/_attendanceAnnounce/.test(APP_SRC),
            'el announce de asistencia (toast por marca) debe eliminarse');
    },

    "el mirror de PersistenceService emite sync:mirror-result (éxito y fallo)"() {
        const block = PS_SRC.match(/const runSync = \(\) => \{[\s\S]{0,900}?\};/);
        testRunner.assert(!!block, 'runSync debe existir');
        testRunner.assert(/sync:mirror-result/.test(block[0]),
            'el resultado del espejo debe emitirse por eventBus');
        testRunner.assert(/ok:\s*true/.test(block[0]) && /ok:\s*false/.test(block[0]),
            'debe emitir tanto éxito como fallo');
    },

    "app.js conecta el evento del espejo con el tracker"() {
        testRunner.assert(/sync:mirror-result/.test(APP_SRC),
            'app.js debe suscribirse al resultado del espejo');
        testRunner.assert(/cloudConfirmed\(\)/.test(APP_SRC) && /cloudFailed\(\)/.test(APP_SRC),
            'y despachar confirm/fail al tracker');
    },

    "app.js re-aplica los anillos tras cada render (no se pierden)"() {
        testRunner.assert(/reapplyPending\(\)/.test(APP_SRC),
            'render:complete debe re-aplicar las clases pendientes — un render completo las borraba');
    },

    "el CSS define el tubo amarillo circulando (pending) y el estado rojo (failed)"() {
        testRunner.assert(/\.check-container\.cloud-pending/.test(CSS_SRC),
            'clase del anillo en el contenedor (updateCheckboxOnly no la pisa)');
        // Efecto "líquido en el tubo": riel completo tenue + segmento brillante
        // que circula vía conic-gradient con ángulo animado (@property).
        testRunner.assert(/conic-gradient\(from var\(--cloud-angle\)/.test(CSS_SRC),
            'el segmento circulante usa conic-gradient con ángulo animado');
        testRunner.assert(/@property --cloud-angle/.test(CSS_SRC),
            '@property registra el ángulo para poder animarlo');
        testRunner.assert(/cloud-ring-spin/.test(CSS_SRC), 'keyframes del flujo');
        testRunner.assert(/\.check-container\.cloud-failed/.test(CSS_SRC), 'estado de fallo');
    }

});
