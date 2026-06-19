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
import { saveNoteModal } from '../modules/features/notes/NotesController.js';

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

console.log('🛡️ NotesCoherence tests cargados.');
