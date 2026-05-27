/**
 * 🧪 IncomingChangeDetectorTests (Tarea #26)
 *
 * Detecta cambios entrantes desde Firebase y los clasifica por
 * severidad. Permite que el callback de subscribeToChanges decida si
 * aplicar silenciosamente o pedir confirmación al usuario.
 *
 * API:
 *   detectIncomingChanges(localState, remoteData) → Change[]
 *
 *   Change = {
 *     kind: 'deletion' | 'addition' | 'scalar-divergence' |
 *           'array-drop' | 'schema-mismatch',
 *     severity: 'trivial' | 'significant',
 *     entityType: 'employee' | 'position' | 'leader' | 'settings',
 *     entityId: string | null,
 *     description: string,
 *     before?: any,
 *     after?: any
 *   }
 *
 * Reglas de severidad:
 *   - DELETIONS de empleados/posiciones/líderes → significant (siempre).
 *   - DROP de array (loans, attendance) en mismo empleado → significant.
 *   - DIVERGENCE de campo escalar crítico (number, name, salary,
 *     customSalary) en mismo id → significant.
 *   - ADDITION de nuevos empleados/posiciones → trivial.
 *   - schemaVersion mismatch → significant.
 *
 * Pure function — no IO, no estado global.
 */

import { detectIncomingChanges, hasSignificantChanges } from '../modules/services/IncomingChangeDetector.js';

function emp(id, fields = {}) {
    return { id, number: id, name: id, loans: [], ...fields };
}

testRunner.addSuite("IncomingChangeDetector — sin cambios", {

    "estados idénticos → []"() {
        const a = { employees: [emp('e1')], positions: [], leaders: [], settings: {} };
        const b = { employees: [emp('e1')], positions: [], leaders: [], settings: {} };
        const changes = detectIncomingChanges(a, b);
        testRunner.assertEquals(changes.length, 0);
    },

    "inputs null/undefined → []"() {
        let threw = false;
        let changes;
        try {
            changes = detectIncomingChanges(null, null);
            detectIncomingChanges(undefined, { employees: [] });
            detectIncomingChanges({ employees: [] }, undefined);
        } catch (e) { threw = true; }
        testRunner.assertEquals(threw, false, 'No debe lanzar');
        testRunner.assertEquals(changes.length, 0);
    }

});

testRunner.addSuite("IncomingChangeDetector — deletions (significant)", {

    "empleado existe en local pero no en remoto → deletion significant"() {
        const local  = { employees: [emp('e1'), emp('e2')] };
        const remote = { employees: [emp('e1')] };
        const changes = detectIncomingChanges(local, remote);
        testRunner.assertEquals(changes.length, 1);
        testRunner.assertEquals(changes[0].kind, 'deletion');
        testRunner.assertEquals(changes[0].entityType, 'employee');
        testRunner.assertEquals(changes[0].entityId, 'e2');
        testRunner.assertEquals(changes[0].severity, 'significant');
    },

    "posición eliminada → significant"() {
        const local  = { positions: [{ id: 'p1', name: 'Caja' }] };
        const remote = { positions: [] };
        const changes = detectIncomingChanges(local, remote);
        testRunner.assertEquals(changes.length, 1);
        testRunner.assertEquals(changes[0].entityType, 'position');
        testRunner.assertEquals(changes[0].severity, 'significant');
    },

    "líder eliminado → significant"() {
        const local  = { leaders: [{ id: 'l1', name: 'X' }] };
        const remote = { leaders: [] };
        const changes = detectIncomingChanges(local, remote);
        testRunner.assertEquals(changes.length, 1);
        testRunner.assertEquals(changes[0].entityType, 'leader');
    }

});

testRunner.addSuite("IncomingChangeDetector — additions (trivial)", {

    "empleado nuevo en remoto → addition trivial"() {
        const local  = { employees: [emp('e1')] };
        const remote = { employees: [emp('e1'), emp('e2')] };
        const changes = detectIncomingChanges(local, remote);
        const additions = changes.filter(c => c.kind === 'addition');
        testRunner.assert(additions.length >= 1, 'Debe haber al menos 1 addition');
        testRunner.assertEquals(additions[0].severity, 'trivial');
    },

    "posiciones nuevas → trivial"() {
        const local  = { positions: [] };
        const remote = { positions: [{ id: 'p1', name: 'Nueva' }] };
        const changes = detectIncomingChanges(local, remote);
        testRunner.assertEquals(changes.length, 1);
        testRunner.assertEquals(changes[0].kind, 'addition');
        testRunner.assertEquals(changes[0].severity, 'trivial');
    }

});

testRunner.addSuite("IncomingChangeDetector — scalar divergence (significant)", {

    "mismo empleado, salary distinto → significant"() {
        const local  = { employees: [emp('e1', { salary: 100 })] };
        const remote = { employees: [emp('e1', { salary: 500 })] };
        const changes = detectIncomingChanges(local, remote);
        const divergence = changes.find(c => c.kind === 'scalar-divergence');
        testRunner.assert(!!divergence, 'Debe detectar divergencia en salary');
        testRunner.assertEquals(divergence.severity, 'significant');
        testRunner.assertEquals(divergence.entityId, 'e1');
    },

    "mismo empleado, name distinto → significant"() {
        const local  = { employees: [emp('e1', { name: 'Ana' })] };
        const remote = { employees: [emp('e1', { name: 'Ana María' })] };
        const changes = detectIncomingChanges(local, remote);
        const divergence = changes.find(c => c.kind === 'scalar-divergence');
        testRunner.assert(!!divergence);
        testRunner.assertEquals(divergence.severity, 'significant');
    },

    "mismo empleado, number distinto → significant"() {
        const local  = { employees: [{ id: 'e1', number: '001', name: 'A' }] };
        const remote = { employees: [{ id: 'e1', number: '999', name: 'A' }] };
        const changes = detectIncomingChanges(local, remote);
        const divergence = changes.find(c => c.kind === 'scalar-divergence');
        testRunner.assert(!!divergence);
        testRunner.assertEquals(divergence.severity, 'significant');
    },

    "cambio de campo NO crítico (email/phone) → trivial o ignorado"() {
        // Por contrato: campos no críticos no levantan severity.
        const local  = { employees: [emp('e1', { email: 'a@x.com' })] };
        const remote = { employees: [emp('e1', { email: 'b@x.com' })] };
        const changes = detectIncomingChanges(local, remote);
        const significant = changes.filter(c => c.severity === 'significant');
        testRunner.assertEquals(significant.length, 0,
            'Cambio en email no debe marcarse significant');
    }

});

testRunner.addSuite("IncomingChangeDetector — array drops (significant)", {

    "empleado pierde préstamos en remoto → significant"() {
        const local  = { employees: [emp('e1', { loans: [{id:'L1'}, {id:'L2'}, {id:'L3'}] })] };
        const remote = { employees: [emp('e1', { loans: [{id:'L1'}] })] };
        const changes = detectIncomingChanges(local, remote);
        const drop = changes.find(c => c.kind === 'array-drop');
        testRunner.assert(!!drop, 'Debe detectar pérdida de préstamos');
        testRunner.assertEquals(drop.severity, 'significant');
        testRunner.assertEquals(drop.entityId, 'e1');
    },

    "préstamos crecen → no significa drop"() {
        const local  = { employees: [emp('e1', { loans: [{id:'L1'}] })] };
        const remote = { employees: [emp('e1', { loans: [{id:'L1'}, {id:'L2'}] })] };
        const changes = detectIncomingChanges(local, remote);
        const drop = changes.find(c => c.kind === 'array-drop');
        testRunner.assertEquals(drop, undefined,
            'Si crecen, no es drop');
    }

});

testRunner.addSuite("IncomingChangeDetector — schemaVersion mismatch", {

    "local schemaVersion 2, remoto 1 → significant"() {
        const local  = { settings: { schemaVersion: 2 }, employees: [] };
        const remote = { schemaVersion: 1, employees: [] };
        const changes = detectIncomingChanges(local, remote);
        const mismatch = changes.find(c => c.kind === 'schema-mismatch');
        testRunner.assert(!!mismatch);
        testRunner.assertEquals(mismatch.severity, 'significant');
    },

    "schemaVersion subiendo → trivial (es el caso normal de migración)"() {
        const local  = { settings: { schemaVersion: 1 }, employees: [] };
        const remote = { schemaVersion: 2, employees: [] };
        const changes = detectIncomingChanges(local, remote);
        const mismatch = changes.find(c => c.kind === 'schema-mismatch');
        // Subir es esperable (migración), no debería ser 'significant'.
        if (mismatch) {
            testRunner.assertEquals(mismatch.severity, 'trivial',
                'Subir schemaVersion es esperable, no warning');
        }
    }

});

testRunner.addSuite("IncomingChangeDetector — hasSignificantChanges helper", {

    "false si todos son trivial"() {
        const local  = { employees: [emp('e1')] };
        const remote = { employees: [emp('e1'), emp('e2')] };
        testRunner.assertEquals(hasSignificantChanges(local, remote), false);
    },

    "true si al menos uno es significant"() {
        const local  = { employees: [emp('e1'), emp('e2')] };
        const remote = { employees: [emp('e1')] }; // borra e2
        testRunner.assertEquals(hasSignificantChanges(local, remote), true);
    }

});

console.log('🧪 IncomingChangeDetector tests cargados.');
