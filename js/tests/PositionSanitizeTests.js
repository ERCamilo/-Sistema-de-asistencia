/**
 * 🧪 PositionSanitizeTests (Schema v3 — IDs estables de puestos, Opción A)
 *
 * Nuevo contrato de sanitizePositions tras adoptar IDs inmutables:
 *   - Los puestos tienen un id ESTABLE (no derivado del nombre). Renombrar
 *     NO cambia el id (eso evitaba duplicados en la nube per-doc).
 *   - sanitizePositions ya NO convierte ids a slug. Solo:
 *       1. Deduplica puestos con el MISMO nombre (slug), conservando el id
 *          del primero (master) y migrando referencias de los duplicados.
 *       2. Asigna un id (UUID) a puestos que no tengan ninguno.
 *   - Si no hay duplicados ni ids faltantes → devuelve false (no-op),
 *     aunque el id no coincida con el slug del nombre.
 */

import { sanitizePositions } from '../modules/services/PersistenceService.js';

testRunner.addSuite("sanitizePositions — IDs estables (Opción A)", {

    "NO cambia el id de un puesto aunque no coincida con el slug del nombre"() {
        // Caso clave: un puesto renombrado conserva su id viejo ("aad") aunque
        // su nombre sea otro ("Ayudante"). sanitize NO debe re-sluggear.
        const state = {
            positions: [{ id: 'aad', name: 'Ayudante' }],
            employees: [],
            attendance: {}
        };
        const changed = sanitizePositions(state);
        testRunner.assertEquals(changed, false,
            'Sin duplicados ni ids faltantes, sanitize es no-op aunque id != slug');
        testRunner.assertEquals(state.positions.length, 1);
        testRunner.assertEquals(state.positions[0].id, 'aad',
            'El id estable NO debe cambiar a "ayudante"');
    },

    "deduplica puestos con el mismo nombre, conservando el id del master"() {
        const state = {
            positions: [
                { id: 'pos-uuid-1', name: 'Albañil' },
                { id: 'pos-uuid-2', name: 'Albañil' } // duplicado por nombre
            ],
            employees: [
                { id: 'e1', positions: ['pos-uuid-2'], positionSalaries: { 'pos-uuid-2': 50 } }
            ],
            attendance: {
                'e1-2026-05-01': { positionHours: [{ positionId: 'pos-uuid-2', hours: 8 }], selectedPosition: 'pos-uuid-2' }
            }
        };
        const changed = sanitizePositions(state);
        testRunner.assertEquals(changed, true, 'Debe reportar cambios al fusionar duplicados');
        testRunner.assertEquals(state.positions.length, 1, 'Queda solo el master');
        testRunner.assertEquals(state.positions[0].id, 'pos-uuid-1', 'El master conserva su id estable');

        // Referencias del duplicado migradas al id del master.
        testRunner.assertEquals(state.employees[0].positions[0], 'pos-uuid-1');
        testRunner.assertEquals(state.employees[0].positionSalaries['pos-uuid-1'], 50);
        const att = state.attendance['e1-2026-05-01'];
        testRunner.assertEquals(att.positionHours[0].positionId, 'pos-uuid-1');
        testRunner.assertEquals(att.selectedPosition, 'pos-uuid-1');
    },

    "asigna un id a un puesto que no tiene ninguno"() {
        const state = { positions: [{ name: 'Sin Id' }], employees: [], attendance: {} };
        const changed = sanitizePositions(state);
        testRunner.assertEquals(changed, true);
        testRunner.assert(!!state.positions[0].id, 'Debe asignar un id');
        testRunner.assert(state.positions[0].id.length > 0);
    },

    // 🐛 Judgment Day Fase 2A Ronda 3: sanitizePositions remapeaba
    // emp.positions/positionSalaries SIN estampar nada. Sin updatedAt el
    // EntityUploadTracker filtra al empleado y la corrección nunca sube; sin
    // positionsUpdatedAt la corrección pierde el LWW fino de puestos contra un
    // sello stale del otro dispositivo (misma disciplina de choke-point que
    // validateDataIntegrity ya aplica).
    "remapear los puestos de un empleado estampa updatedAt y positionsUpdatedAt (solo en los tocados)"() {
        const state = {
            positions: [
                { id: 'pos-uuid-1', name: 'Albañil' },
                { id: 'pos-uuid-2', name: 'Albañil' } // duplicado → se fusiona al master
            ],
            employees: [
                { id: 'e1', positions: ['pos-uuid-2'], positionSalaries: { 'pos-uuid-2': 50 }, updatedAt: 1000, positionsUpdatedAt: 1000 },
                { id: 'e2', positions: ['pos-uuid-1'], positionSalaries: {}, updatedAt: 1000, positionsUpdatedAt: 1000 }
            ],
            attendance: {}
        };
        const before = Date.now() - 1;
        sanitizePositions(state);
        const e1 = state.employees.find(e => e.id === 'e1');
        const e2 = state.employees.find(e => e.id === 'e2');
        testRunner.assert(e1.updatedAt > before,
            'e1 fue remapeado → debe estampar updatedAt (sin esto la corrección nunca sube)');
        testRunner.assert(e1.positionsUpdatedAt > before,
            'e1 → debe estampar positionsUpdatedAt (sin esto pierde el LWW de puestos)');
        testRunner.assertEquals(e2.updatedAt, 1000,
            'e2 no fue tocado → sin estampa (estampar de más re-sube a todos)');
        testRunner.assertEquals(e2.positionsUpdatedAt, 1000, 'e2 → positionsUpdatedAt intacto');
    },

    "puestos con nombres distintos NO se tocan (no-op)"() {
        const state = {
            positions: [
                { id: 'p1', name: 'Albañil' },
                { id: 'p2', name: 'Ayudante' }
            ],
            employees: [],
            attendance: {}
        };
        const changed = sanitizePositions(state);
        testRunner.assertEquals(changed, false);
        testRunner.assertEquals(state.positions.length, 2);
        testRunner.assertEquals(state.positions[0].id, 'p1');
        testRunner.assertEquals(state.positions[1].id, 'p2');
    }

});

console.log('🧪 PositionSanitize tests cargados.');
