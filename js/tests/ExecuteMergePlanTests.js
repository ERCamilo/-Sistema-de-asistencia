/**
 * 🧪 ExecuteMergePlanTests (Tarea #19 — ejecutor del plan)
 *
 * executeMergePlan(plan): aplica los items con action='auto-merge'
 *   - fusiona los losers en el master (en state.employees local)
 *   - encola en _pendingCloudDeletes los ids de losers que tenían
 *     _source 'cloud' o 'both'
 *   - los items 'needs-manual' se DEJAN intactos para que la UI los
 *     resuelva uno a uno
 *   - los miembros cloud-only se asimilan al state local (se agregan
 *     antes de fusionar) usando EmployeeMerge para preservar préstamos
 *
 * No guarda. El caller decide cuándo llamar a saveApplicationData.
 */

import { state } from '../modules/core/AppState.js';
import {
    executeMergePlan
} from '../modules/services/ConflictPlanner.js';
import {
    getPendingCloudDeletes,
    clearPendingCloudDeletes
} from '../modules/services/PersistenceService.js';

function resetState() {
    state.employees = [];
    state.attendance = {};
    clearPendingCloudDeletes();
}

testRunner.addSuite("ConflictPlanner.executeMergePlan (Tarea #19)", {

    "plan vacío → no ejecuta nada, devuelve counts en 0"() {
        resetState();
        const result = executeMergePlan([]);
        testRunner.assertEquals(result.merged, 0);
        testRunner.assertEquals(result.skippedManual, 0);
    },

    "auto-merge: fusiona losers locales en el master"() {
        resetState();
        const master = { id: 'eMaster', name: 'Ana', number: '001', loans: [{id:'L1'}] };
        const loser  = { id: 'eLoser',  name: 'Ana', number: '001', loans: [{id:'L2'}] };
        state.employees = [master, loser];

        const plan = [{
            number: '001',
            action: 'auto-merge',
            members: [master, loser],
            proposedMasterId: 'eMaster',
            loserIds: ['eLoser'],
            totalLoansAfterMerge: 2,
            hasCloudLosers: false
        }];

        const result = executeMergePlan(plan);
        testRunner.assertEquals(result.merged, 1, 'Debe contar 1 merge ejecutado');
        testRunner.assertEquals(state.employees.length, 1, 'El loser se removió de state');
        testRunner.assertEquals(state.employees[0].id, 'eMaster');
    },

    "needs-manual: NO fusiona, los cuenta como pendientes"() {
        resetState();
        state.employees = [
            { id: 'a', name: 'Ana',  number: '001' },
            { id: 'b', name: 'ANA',  number: '001' }
        ];

        const plan = [{
            number: '001',
            action: 'needs-manual',
            members: state.employees,
            proposedMasterId: 'a',
            loserIds: ['b'],
            totalLoansAfterMerge: 0,
            hasCloudLosers: false
        }];

        const result = executeMergePlan(plan);
        testRunner.assertEquals(result.merged, 0, 'No fusionó');
        testRunner.assertEquals(result.skippedManual, 1, 'Cuenta como pendiente manual');
        testRunner.assertEquals(state.employees.length, 2, 'state intacto');
    },

    "loser con _source='cloud': se encola en _pendingCloudDeletes"() {
        resetState();
        const master = { id: 'eM', name: 'Ana', number: '001', _source: 'local', loans: [] };
        const loserCloud = { id: 'eCloud', name: 'Ana', number: '001', _source: 'cloud', loans: [] };
        state.employees = [master]; // El cloud loser NO está en state

        const plan = [{
            number: '001',
            action: 'auto-merge',
            members: [master, loserCloud],
            proposedMasterId: 'eM',
            loserIds: ['eCloud'],
            totalLoansAfterMerge: 0,
            hasCloudLosers: true
        }];

        executeMergePlan(plan);
        const pending = getPendingCloudDeletes();
        testRunner.assert(pending.includes('eCloud'),
            'El loser cloud-only debe quedar en la cola de borrado remoto');
    },

    "loser con _source='both': también se encola para borrado remoto"() {
        resetState();
        const master = { id: 'eM', name: 'Bob', number: '002', _source: 'local' };
        const loserBoth = { id: 'eBoth', name: 'Bob', number: '002', _source: 'both', loans: [] };
        state.employees = [master, loserBoth];

        const plan = [{
            number: '002',
            action: 'auto-merge',
            members: [master, loserBoth],
            proposedMasterId: 'eM',
            loserIds: ['eBoth'],
            totalLoansAfterMerge: 0,
            hasCloudLosers: true
        }];

        executeMergePlan(plan);
        testRunner.assert(getPendingCloudDeletes().includes('eBoth'));
    },

    "loser con _source='local': NO encola borrado remoto"() {
        resetState();
        state.employees = [
            { id: 'eM', name: 'Carlos', number: '003', _source: 'local' },
            { id: 'eL', name: 'Carlos', number: '003', _source: 'local' }
        ];

        const plan = [{
            number: '003',
            action: 'auto-merge',
            members: state.employees,
            proposedMasterId: 'eM',
            loserIds: ['eL'],
            totalLoansAfterMerge: 0,
            hasCloudLosers: false
        }];

        executeMergePlan(plan);
        testRunner.assertEquals(getPendingCloudDeletes().length, 0,
            'Loser local-only no necesita borrado remoto');
    },

    "miembro cloud-only se asimila al state antes de fusionar (préstamos preservados)"() {
        resetState();
        const masterLocal = {
            id: 'eM', name: 'Saint', number: '010', _source: 'local',
            loans: [{ id: 'L_local', principal: 100 }]
        };
        const loserCloud = {
            id: 'eC', name: 'Saint', number: '010', _source: 'cloud',
            loans: [{ id: 'L_cloud', principal: 200 }]
        };
        state.employees = [masterLocal];

        const plan = [{
            number: '010',
            action: 'auto-merge',
            members: [masterLocal, loserCloud],
            proposedMasterId: 'eM',
            loserIds: ['eC'],
            totalLoansAfterMerge: 2,
            hasCloudLosers: true
        }];

        executeMergePlan(plan);
        const master = state.employees.find(e => e.id === 'eM');
        const loanIds = (master.loans || []).map(l => l.id).sort();
        testRunner.assertEquals(loanIds.join(','), 'L_cloud,L_local',
            'Los préstamos de AMBOS miembros (local + cloud) deben quedar en el master');
    },

    "mezcla auto-merge + needs-manual en el mismo plan"() {
        resetState();
        state.employees = [
            { id: 'a1', name: 'Ana', number: '001', _source: 'local' },
            { id: 'a2', name: 'Ana', number: '001', _source: 'local' },
            { id: 'b1', name: 'Bob', number: '002', _source: 'local' },
            { id: 'b2', name: 'BOB', number: '002', _source: 'local' }
        ];

        const plan = [
            {
                number: '001', action: 'auto-merge',
                members: [state.employees[0], state.employees[1]],
                proposedMasterId: 'a1', loserIds: ['a2'],
                totalLoansAfterMerge: 0, hasCloudLosers: false
            },
            {
                number: '002', action: 'needs-manual',
                members: [state.employees[2], state.employees[3]],
                proposedMasterId: 'b1', loserIds: ['b2'],
                totalLoansAfterMerge: 0, hasCloudLosers: false
            }
        ];

        const result = executeMergePlan(plan);
        testRunner.assertEquals(result.merged, 1);
        testRunner.assertEquals(result.skippedManual, 1);
        // Tras ejecutar: a1+a2 fusionados → quedan 3 (a1, b1, b2)
        testRunner.assertEquals(state.employees.length, 3);
    }

});

console.log('🧪 ExecuteMergePlan tests cargados.');
