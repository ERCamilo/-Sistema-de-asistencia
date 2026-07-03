/**
 * 🧪 LegacyMergeEmployeesTests
 *
 * The legacy `mergeEmployees` (PersistenceService.js) is what runs when
 * the wizard absorbs a duplicate that exists in state.employees (the
 * common case for migrated accounts). Historically it only merged
 * attendance, advances, bonuses, deductions — silently dropping the
 * duplicate's loans, positions, and positionSalaries.
 *
 * User's worked example to validate end-to-end:
 *   master    → 5 attendance, 0 loans, positions [a,b]
 *   duplicate → 0 attendance, 3 loans, positions [a,c]
 *   result    → 5 attendance, 3 loans, positions [a,b,c]
 */

import { state } from '../modules/core/AppState.js';
import { mergeEmployees } from '../modules/services/PersistenceService.js';

function resetState(employees, attendance = {}) {
    state.employees.splice(0, state.employees.length, ...employees);
    if (state.attendance) {
        Object.keys(state.attendance).forEach(k => delete state.attendance[k]);
        Object.entries(attendance).forEach(([k, v]) => { state.attendance[k] = v; });
    }
}

testRunner.addSuite("Legacy mergeEmployees — préstamos, posiciones y positionSalaries", {

    "préstamos del duplicate se preservan en el master"() {
        // Bug histórico: loans se descartaban silenciosamente.
        resetState([
            { id: 'A', name: 'Erlin', loans: [] },
            { id: 'B', name: 'Erlin', loans: [
                { id: 'L1', principal: 1000 },
                { id: 'L2', principal: 2000 },
                { id: 'L3', principal: 3000 }
            ]}
        ]);
        const ok = mergeEmployees('A', 'B');
        testRunner.assertEquals(ok, true);
        const master = state.employees.find(e => e.id === 'A');
        testRunner.assertEquals(master.loans.length, 3,
            'Los 3 préstamos del duplicate deben quedar en el master');
        const ids = master.loans.map(l => l.id).sort();
        testRunner.assertEquals(ids.join(','), 'L1,L2,L3');
    },

    "préstamos con mismo id en master y duplicate: gana el de mayor updatedAt"() {
        resetState([
            { id: 'A', loans: [{ id: 'L1', principal: 1000, updatedAt: 100 }] },
            { id: 'B', loans: [{ id: 'L1', principal: 2000, updatedAt: 200 }] }
        ]);
        mergeEmployees('A', 'B');
        const master = state.employees.find(e => e.id === 'A');
        testRunner.assertEquals(master.loans.length, 1);
        testRunner.assertEquals(master.loans[0].principal, 2000,
            'El loan con updatedAt mayor debe ganar');
    },

    "préstamos sin id reciben uno sintético y se preservan"() {
        // Defensa adicional sobre lo que ya hace unionById durante save.
        resetState([
            { id: 'A', loans: [{ principal: 100 }] },
            { id: 'B', loans: [{ principal: 200 }, { principal: 300 }] }
        ]);
        mergeEmployees('A', 'B');
        const master = state.employees.find(e => e.id === 'A');
        testRunner.assertEquals(master.loans.length, 3,
            'Los 3 loans sin id deben preservarse');
        const allHaveIds = master.loans.every(l => typeof l.id === 'string' && l.id.length > 0);
        testRunner.assert(allHaveIds,
            'Todos los loans terminan con id (backfill)');
    },

    "positions: unión deduplicada"() {
        // User's example: [a,b] + [a,c] = [a,b,c]
        resetState([
            { id: 'A', positions: ['a', 'b'] },
            { id: 'B', positions: ['a', 'c'] }
        ]);
        mergeEmployees('A', 'B');
        const master = state.employees.find(e => e.id === 'A');
        testRunner.assertEquals(master.positions.length, 3);
        const sorted = [...master.positions].sort().join(',');
        testRunner.assertEquals(sorted, 'a,b,c');
    },

    "positionSalaries: unión por positionId, master gana en colisión"() {
        // Master es local "ganador" (el usuario lo eligió explícitamente);
        // sus valores prevalecen en empate, los del duplicate solo entran
        // si no existen.
        resetState([
            { id: 'A', positionSalaries: { pos1: 100, pos2: 200 } },
            { id: 'B', positionSalaries: { pos2: 999, pos3: 300 } }
        ]);
        mergeEmployees('A', 'B');
        const master = state.employees.find(e => e.id === 'A');
        testRunner.assertEquals(master.positionSalaries.pos1, 100);
        testRunner.assertEquals(master.positionSalaries.pos2, 200,
            'En empate, gana el del master');
        testRunner.assertEquals(master.positionSalaries.pos3, 300);
    },

    "advances/bonuses/deductions: ahora dedup por id (antes concatenaba ciegamente)"() {
        // Antes la concatenación creaba duplicados si el mismo advance
        // estaba en ambos lados (caso real cuando se importaba mal).
        resetState([
            { id: 'A', advances: [{ id: 'ADV-1', amount: 100 }] },
            { id: 'B', advances: [{ id: 'ADV-1', amount: 100 }, { id: 'ADV-2', amount: 200 }] }
        ]);
        mergeEmployees('A', 'B');
        const master = state.employees.find(e => e.id === 'A');
        testRunner.assertEquals(master.advances.length, 2,
            'ADV-1 no debe duplicarse, ADV-2 debe entrar');
    },

    "escenario completo del usuario: 5 asistencias + 0 préstamos + [a,b] absorbe 0 + 3 + [a,c]"() {
        const attendance = {
            'A-2026-05-01': { employeeId: 'A', present: true },
            'A-2026-05-02': { employeeId: 'A', present: true },
            'A-2026-05-03': { employeeId: 'A', present: true },
            'A-2026-05-04': { employeeId: 'A', present: true },
            'A-2026-05-05': { employeeId: 'A', present: true }
        };
        resetState([
            { id: 'A', loans: [], positions: ['a', 'b'] },
            { id: 'B', loans: [
                { id: 'L1', principal: 1000 },
                { id: 'L2', principal: 2000 },
                { id: 'L3', principal: 3000 }
            ], positions: ['a', 'c'] }
        ], attendance);

        mergeEmployees('A', 'B');
        const master = state.employees.find(e => e.id === 'A');

        const attendanceCount = Object.keys(state.attendance)
            .filter(k => k.startsWith('A-')).length;
        testRunner.assertEquals(attendanceCount, 5, '5 asistencias');
        testRunner.assertEquals(master.loans.length, 3, '3 préstamos');
        testRunner.assertEquals(master.positions.length, 3, '3 posiciones');
        const posSorted = [...master.positions].sort().join(',');
        testRunner.assertEquals(posSorted, 'a,b,c', 'posiciones [a,b,c]');
    },

    "actualiza updatedAt del master al fusionar"() {
        resetState([
            { id: 'A', updatedAt: 100, loans: [] },
            { id: 'B', updatedAt: 50, loans: [{ id: 'L1' }] }
        ]);
        mergeEmployees('A', 'B');
        const master = state.employees.find(e => e.id === 'A');
        testRunner.assert(master.updatedAt > 100,
            'master.updatedAt debe avanzar para que cloud reciba el cambio');
    },

    "asistencia del duplicate: la clave vieja se tombstonea, no se borra (Fase 1, U2b)"() {
        // setDoc({merge:true}) nunca borra claves de un mapa — un `delete` local
        // no se propaga a la nube y el registro resucita al hacer eco. El remap
        // de asistencia debe dejar la clave vieja como tombstone viajando como dato.
        const attendance = {
            'B-2026-06-01': { employeeId: 'B', date: '2026-06-01', present: true, hoursWorked: 8 }
        };
        resetState([
            { id: 'A', loans: [] },
            { id: 'B', loans: [] }
        ], attendance);

        mergeEmployees('A', 'B');

        const oldRecord = state.attendance['B-2026-06-01'];
        testRunner.assert(!!oldRecord, 'la clave vieja B-2026-06-01 NO debe borrarse — debe seguir existiendo como tombstone');
        testRunner.assert(oldRecord.deletedAt !== null && oldRecord.deletedAt !== undefined,
            'la clave vieja debe quedar tombstoneada (deletedAt seteado)');
        testRunner.assertEquals(oldRecord.present, false, 'el tombstone marca present=false');

        const movedRecord = state.attendance['A-2026-06-01'];
        testRunner.assert(!!movedRecord, 'el registro debe existir bajo la clave nueva A-2026-06-01');
        testRunner.assertEquals(movedRecord.present, true, 'el registro movido conserva sus datos (present=true)');
        testRunner.assert(movedRecord.deletedAt === null || movedRecord.deletedAt === undefined,
            'el registro movido NO debe quedar con un deletedAt residual del tombstone');
    }

});

console.log('🧪 Legacy mergeEmployees tests cargados.');
