/**
 * 🛡️ NotesCoherenceTests — Fase 4 Paso 3 (primer sitio: notas).
 *
 * NotesController ahora mantiene la coherencia del índice EXPLÍCITAMENTE tras
 * upsert/clear (sin depender del trap del proxy). El test clave corre saveNoteModal
 * DENTRO de batchSetState (modo silencioso, el proxy NO reconstruye nada): si el
 * índice queda coherente igual, es porque la coherencia explícita funcionó.
 *
 * (Las notas escriben registros present:false → no afectan stats; el riesgo
 * financiero es nulo, por eso es el primer sitio del Paso 3.)
 */

import { state, stateManager } from '../modules/core/AppState.js';
import { saveNoteModal, openNoteEditor } from '../modules/features/notes/NotesController.js';

function setup() {
    const raw = stateManager.getState();
    raw.attendance = {};
    raw.attendanceByDate = {};
    raw.statsCache.mtd = {};
    raw.employees = [{ id: 'emp1', name: 'A', positions: ['p1'], hireDate: '2020-01-01' }];
    raw.settings.regularHoursPerDay = 8;
    raw.settings.holidays = [];
    raw.noteModalEmployeeId = 'emp1';
    raw.noteModalText = 'una nota';
    raw.noteModalDate = '2026-06-15';
}

testRunner.addSuite("Notas — Coherencia del índice (Fase 4 Paso 3)", {

    "saveNoteModal guarda la nota y deja el índice del día coherente"() {
        setup();
        saveNoteModal();
        const raw = stateManager.getState();
        const rec = raw.attendance['emp1-2026-06-15'];
        testRunner.assert(rec && rec.notes === 'una nota', "la nota debe quedar en el registro");
        testRunner.assertEquals((raw.attendanceByDate['2026-06-15'] || []).length, 1, "el índice del día debe contener el registro");
    },

    "saveNoteModal en batchSetState (proxy silencioso) deja el índice coherente vía coherencia explícita"() {
        setup();
        stateManager.batchSetState(() => { saveNoteModal(); });
        const raw = stateManager.getState();
        const rec = raw.attendance['emp1-2026-06-15'];
        testRunner.assert(rec && rec.notes === 'una nota', "la nota debe guardarse aún en modo silencioso");
        testRunner.assertEquals(
            (raw.attendanceByDate['2026-06-15'] || []).length, 1,
            "el índice debe quedar coherente SIN el proxy (solo la coherencia explícita pudo construirlo)"
        );
    }
});

testRunner.addSuite("openNoteEditor — guard de tombstone (Fase 1 U2c)", {

    "no abre el editor si el registro de ese día es un tombstone (aunque conserve .notes vieja)"() {
        const raw = stateManager.getState();
        raw.attendance = {
            'emp1-2026-06-15': { employeeId: 'emp1', date: '2026-06-15', present: false, deletedAt: 12345, notes: 'nota vieja borrada' }
        };
        state.showNoteModal = false;
        state.noteModalText = '';

        openNoteEditor('emp1', '2026-06-15');

        testRunner.assertEquals(state.showNoteModal, false, "un tombstone no debe abrir el editor de nota");
        testRunner.assertEquals(state.noteModalText, '', "el texto del modal no debe poblarse desde un tombstone");
    },

    "abre el editor normalmente si el registro está vivo y tiene nota"() {
        const raw = stateManager.getState();
        raw.attendance = {
            'emp1-2026-06-15': { employeeId: 'emp1', date: '2026-06-15', present: true, notes: 'nota viva' }
        };
        state.showNoteModal = false;
        state.noteModalText = '';

        openNoteEditor('emp1', '2026-06-15');

        testRunner.assertEquals(state.showNoteModal, true, "un registro vivo con nota debe abrir el editor");
        testRunner.assertEquals(state.noteModalText, 'nota viva', "el texto del modal debe poblarse desde la nota viva");
    }
});

console.log('🛡️ NotesCoherence tests cargados.');
