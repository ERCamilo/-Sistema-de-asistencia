/**
 * 🧪 NotesCenterTests — Fase 1 (U2c): un tombstone no debe mostrar su nota vieja.
 *
 * NotesCenter() es un renderer puro sobre `state` (sin dependencias de DOM más
 * allá de leer el estado global), así que es testeable conductualmente igual
 * que el resto de la suite.
 */

import { state, stateManager } from '../modules/core/AppState.js';
import { NotesCenter } from '../modules/features/notes/NotesCenter.js';

function setup() {
    const raw = stateManager.getState();
    raw.employees = [
        { id: 'emp1', name: 'Ada Lovelace', number: '1' },
        { id: 'emp2', name: 'Grace Hopper', number: '2' }
    ];
    raw.attendance = {};
    state.showNotesCenter = true;
    state.notesCenterEmployeeId = null;
}

testRunner.addSuite("NotesCenter — tombstones no muestran su nota vieja (Fase 1 U2c)", {

    "un empleado con solo notas tombstoneadas NO aparece en la lista"() {
        setup();
        state.attendance = {
            'emp1-2026-05-19': { employeeId: 'emp1', date: '2026-05-19', notes: 'nota borrada', deletedAt: 12345 }
        };

        const html = NotesCenter();

        testRunner.assert(!html.includes('Ada Lovelace'), "el empleado con solo nota tombstoneada no debe listarse");
        testRunner.assert(html.includes('Aún no hay notas guardadas'), "debe mostrar el estado vacío");
    },

    "un empleado con nota viva SÍ aparece, aunque otro registro del mismo empleado esté tombstoneado"() {
        setup();
        state.attendance = {
            'emp1-2026-05-10': { employeeId: 'emp1', date: '2026-05-10', notes: 'nota viva' },
            'emp1-2026-05-19': { employeeId: 'emp1', date: '2026-05-19', notes: 'nota borrada', deletedAt: 12345 }
        };

        const html = NotesCenter();

        testRunner.assert(html.includes('Ada Lovelace'), "el empleado con al menos una nota viva debe listarse");
        testRunner.assert(html.includes('nota viva'), "la vista previa debe mostrar la nota viva");
        testRunner.assert(!html.includes('nota borrada'), "la nota tombstoneada no debe aparecer en la vista previa");
    },

    "en la vista de timeline de un empleado, la nota tombstoneada no aparece"() {
        setup();
        state.attendance = {
            'emp1-2026-05-10': { employeeId: 'emp1', date: '2026-05-10', notes: 'nota viva' },
            'emp1-2026-05-19': { employeeId: 'emp1', date: '2026-05-19', notes: 'nota borrada', deletedAt: 12345 }
        };
        state.notesCenterEmployeeId = 'emp1';

        const html = NotesCenter();

        testRunner.assert(html.includes('nota viva'), "la nota viva debe aparecer en el timeline");
        testRunner.assert(!html.includes('nota borrada'), "la nota tombstoneada no debe aparecer en el timeline");
    }
});

console.log('🧪 NotesCenter tests cargados.');
