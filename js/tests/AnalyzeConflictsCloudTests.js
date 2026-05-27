/**
 * 🧪 AnalyzeConflictsCloudTests (Tarea #17)
 *
 * Extensión cloud-aware de analyzeConflicts. Acepta opts.cloudEmployees
 * (lista de docs leída de users/{uid}/employees/) y los une con el state
 * local antes de detectar duplicados por número de ficha. Cada miembro
 * lleva _source: 'local' | 'cloud' | 'both'.
 *
 * Compatibilidad: sin opts (o con cloudEmployees ausente/vacío), el
 * comportamiento debe ser idéntico al original.
 */

import { state } from '../modules/core/AppState.js';
import { analyzeConflicts } from '../modules/services/PersistenceService.js';

function reset() {
    state.employees = [];
    state.attendance = {};
}

testRunner.addSuite("analyzeConflicts — backward compat (Tarea #17)", {

    "sin opts → comportamiento original (solo lee state.employees)"() {
        reset();
        state.employees = [
            { id: 'e1', name: 'Ana', number: '001' },
            { id: 'e2', name: 'Ana 2', number: '001' }, // dup por número
            { id: 'e3', name: 'Bob', number: '002' }    // único
        ];
        const conflicts = analyzeConflicts();
        testRunner.assertEquals(conflicts.length, 1, 'Un solo grupo en conflicto');
        testRunner.assertEquals(conflicts[0].number, '001');
        testRunner.assertEquals(conflicts[0].members.length, 2);
    },

    "sin opts y state vacío → []"() {
        reset();
        const conflicts = analyzeConflicts();
        testRunner.assertEquals(conflicts.length, 0);
    },

    "con cloudEmployees vacío → igual que sin opts"() {
        reset();
        state.employees = [
            { id: 'e1', name: 'Ana', number: '001' },
            { id: 'e2', name: 'Ana 2', number: '001' }
        ];
        const conflicts = analyzeConflicts({ cloudEmployees: [] });
        testRunner.assertEquals(conflicts.length, 1);
        testRunner.assertEquals(conflicts[0].members.length, 2);
    }

});

testRunner.addSuite("analyzeConflicts — cloud-aware (Tarea #17)", {

    "cloud-only conflicts se detectan aunque no estén en state local"() {
        reset();
        // Local tiene 1 empleado de número 001
        state.employees = [
            { id: 'eLocal1', name: 'Ana local', number: '001', updatedAt: 100 }
        ];
        // Cloud tiene OTRO empleado con el mismo número
        const cloudEmployees = [
            { id: 'eCloud1', name: 'Ana cloud', number: '001', updatedAt: 200 }
        ];
        const conflicts = analyzeConflicts({ cloudEmployees });
        testRunner.assertEquals(conflicts.length, 1, 'Debe detectar el conflicto cross-source');
        testRunner.assertEquals(conflicts[0].members.length, 2);
        const sources = conflicts[0].members.map(m => m._source).sort();
        testRunner.assertEquals(sources.join(','), 'cloud,local',
            'Los miembros deben llevar _source correcto');
    },

    "doc en ambos lados con mismo id → _source='both', no duplica el grupo"() {
        reset();
        const same = { id: 'eSame', name: 'Mismo', number: '003', updatedAt: 100 };
        state.employees = [same];
        const cloudEmployees = [{ ...same, updatedAt: 200 }];
        const conflicts = analyzeConflicts({ cloudEmployees });
        // Solo 1 empleado real → NO hay conflicto
        testRunner.assertEquals(conflicts.length, 0,
            'Un empleado con el mismo id en ambos lados no es conflicto');
    },

    "todos los miembros llevan _source ('local'|'cloud'|'both')"() {
        reset();
        state.employees = [
            { id: 'eL', name: 'L', number: '010', updatedAt: 100 },
            { id: 'eShared', name: 'Compartido', number: '010', updatedAt: 50 }
        ];
        const cloudEmployees = [
            { id: 'eShared', name: 'Compartido', number: '010', updatedAt: 60 }, // mismo id
            { id: 'eC', name: 'C', number: '010', updatedAt: 80 }                // solo cloud
        ];
        const conflicts = analyzeConflicts({ cloudEmployees });
        testRunner.assertEquals(conflicts.length, 1);
        testRunner.assertEquals(conflicts[0].members.length, 3);
        const sources = conflicts[0].members.map(m => m._source).sort();
        testRunner.assertEquals(sources.join(','), 'both,cloud,local');
    },

    "id duplicado entre local y cloud: gana el de updatedAt mayor"() {
        reset();
        state.employees = [
            { id: 'eX', name: 'Vieja', number: '020', updatedAt: 100 },
            { id: 'eY', name: 'Otra',  number: '020', updatedAt: 100 }
        ];
        const cloudEmployees = [
            { id: 'eX', name: 'Nueva (cloud)', number: '020', updatedAt: 500 }
        ];
        const conflicts = analyzeConflicts({ cloudEmployees });
        const eX = conflicts[0].members.find(m => m.id === 'eX');
        testRunner.assertEquals(eX.name, 'Nueva (cloud)',
            'Cuando id colisiona, gana mayor updatedAt');
        testRunner.assertEquals(eX._source, 'both', 'Y se marca como both');
    },

    "cloud-only employees sin duplicados no producen conflictos espurios"() {
        reset();
        state.employees = [{ id: 'eL', name: 'Local', number: '030' }];
        const cloudEmployees = [{ id: 'eC', name: 'Cloud', number: '040' }];
        const conflicts = analyzeConflicts({ cloudEmployees });
        testRunner.assertEquals(conflicts.length, 0,
            'Si nadie comparte número, no hay conflicto');
    },

    "ignora cloud employees sin id o sin número"() {
        reset();
        state.employees = [{ id: 'eL', name: 'Local', number: '050' }];
        const cloudEmployees = [
            { name: 'Sin id', number: '050' },
            { id: 'eOk', name: 'Sin numero' },
            { id: 'eOk2', name: 'Conflicto real', number: '050' }
        ];
        const conflicts = analyzeConflicts({ cloudEmployees });
        testRunner.assertEquals(conflicts.length, 1);
        testRunner.assertEquals(conflicts[0].members.length, 2);
    }

});

console.log('🧪 analyzeConflicts cloud tests cargados.');
