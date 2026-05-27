/**
 * 🧪 ConflictPlannerTests (Tarea #19 — clasificación opción B)
 *
 * Función pura buildConflictPlan(conflicts) que clasifica cada grupo de
 * duplicados en "auto-merge" o "needs-manual" según el grado de
 * similitud de los nombres:
 *
 *   - Nombres IDÉNTICOS (case+accent+orden) → auto-merge.
 *   - Cualquier diferencia (mayúsculas, acentos, orden, distintas
 *     personas) → needs-manual.
 *
 * Y elige el master "propuesto" para los auto-merge basándose en
 * (en este orden):
 *   1. attendanceCount mayor.
 *   2. updatedAt mayor.
 *   3. completeness mayor.
 *
 * No ejecuta nada. Solo describe el plan para que el modal lo muestre.
 */

import { buildConflictPlan, namesAreIdentical } from '../modules/services/ConflictPlanner.js';

testRunner.addSuite("ConflictPlanner — namesAreIdentical (Tarea #19)", {

    "mismo string exactamente → true"() {
        testRunner.assertEquals(namesAreIdentical('Ana', 'Ana'), true);
        testRunner.assertEquals(namesAreIdentical('Hector excavadora', 'Hector excavadora'), true);
    },

    "diferencia de mayúsculas → false"() {
        testRunner.assertEquals(namesAreIdentical('Ana', 'ana'), false);
        testRunner.assertEquals(namesAreIdentical('Hector EXCAVADORA', 'Hector excavadora'), false);
    },

    "diferencia de acento → false"() {
        testRunner.assertEquals(namesAreIdentical('Hector excavadora', 'Héctor excavadora'), false);
        testRunner.assertEquals(namesAreIdentical('Jesus', 'Jesús'), false);
    },

    "diferencia de orden de palabras → false"() {
        testRunner.assertEquals(namesAreIdentical('Yves Oxenat', 'Oxenat Yves'), false);
    },

    "diferencia de espacios → false (literal)"() {
        testRunner.assertEquals(namesAreIdentical('Ana  Pérez', 'Ana Pérez'), false);
    },

    "nombres completamente distintos → false"() {
        testRunner.assertEquals(namesAreIdentical('Ana', 'Bob'), false);
    },

    "null/undefined → false (defensivo)"() {
        testRunner.assertEquals(namesAreIdentical(null, 'Ana'), false);
        testRunner.assertEquals(namesAreIdentical('Ana', undefined), false);
        testRunner.assertEquals(namesAreIdentical(null, null), false);
    }

});

testRunner.addSuite("ConflictPlanner — buildConflictPlan: clasificación (Tarea #19)", {

    "grupo con todos los nombres idénticos → action='auto-merge'"() {
        const conflicts = [{
            number: '001',
            members: [
                { id: 'a', name: 'Ana', attendanceCount: 10, updatedAt: 100, completeness: 80 },
                { id: 'b', name: 'Ana', attendanceCount: 5,  updatedAt: 50,  completeness: 60 }
            ]
        }];
        const plan = buildConflictPlan(conflicts);
        testRunner.assertEquals(plan.length, 1);
        testRunner.assertEquals(plan[0].action, 'auto-merge');
    },

    "grupo con nombres que difieren en mayúsculas → action='needs-manual'"() {
        const conflicts = [{
            number: '001',
            members: [
                { id: 'a', name: 'Hector', attendanceCount: 1, updatedAt: 1, completeness: 1 },
                { id: 'b', name: 'HECTOR', attendanceCount: 1, updatedAt: 1, completeness: 1 }
            ]
        }];
        const plan = buildConflictPlan(conflicts);
        testRunner.assertEquals(plan[0].action, 'needs-manual',
            'Mayúsculas distintas exigen revisión manual (opción B)');
    },

    "grupo con nombres que difieren en acentos → action='needs-manual'"() {
        const conflicts = [{
            number: '001',
            members: [
                { id: 'a', name: 'Hector excavadora', attendanceCount: 1, updatedAt: 1, completeness: 1 },
                { id: 'b', name: 'Héctor excavadora', attendanceCount: 1, updatedAt: 1, completeness: 1 }
            ]
        }];
        const plan = buildConflictPlan(conflicts);
        testRunner.assertEquals(plan[0].action, 'needs-manual',
            'Tildes diferentes → manual (puede ser typo, puede ser dos personas)');
    },

    "grupo con orden de palabras invertido → action='needs-manual'"() {
        const conflicts = [{
            number: '001',
            members: [
                { id: 'a', name: 'Yves Oxenat', attendanceCount: 1, updatedAt: 1, completeness: 1 },
                { id: 'b', name: 'Oxenat Yves', attendanceCount: 1, updatedAt: 1, completeness: 1 }
            ]
        }];
        const plan = buildConflictPlan(conflicts);
        testRunner.assertEquals(plan[0].action, 'needs-manual');
    },

    "grupo de 3 miembros con uno distinto → action='needs-manual'"() {
        const conflicts = [{
            number: '001',
            members: [
                { id: 'a', name: 'Ana', attendanceCount: 1, updatedAt: 1, completeness: 1 },
                { id: 'b', name: 'Ana', attendanceCount: 1, updatedAt: 1, completeness: 1 },
                { id: 'c', name: 'ana', attendanceCount: 1, updatedAt: 1, completeness: 1 }
            ]
        }];
        const plan = buildConflictPlan(conflicts);
        testRunner.assertEquals(plan[0].action, 'needs-manual',
            'Si CUALQUIER miembro difiere, todo el grupo va a manual');
    }

});

testRunner.addSuite("ConflictPlanner — buildConflictPlan: selección de master (Tarea #19)", {

    "master propuesto = mayor attendanceCount"() {
        const conflicts = [{
            number: '001',
            members: [
                { id: 'a', name: 'Ana', attendanceCount: 5,  updatedAt: 100, completeness: 80 },
                { id: 'b', name: 'Ana', attendanceCount: 30, updatedAt: 50,  completeness: 60 }
            ]
        }];
        const plan = buildConflictPlan(conflicts);
        testRunner.assertEquals(plan[0].proposedMasterId, 'b',
            'El de más asistencia gana');
    },

    "empate en attendanceCount → desempata por updatedAt mayor"() {
        const conflicts = [{
            number: '001',
            members: [
                { id: 'a', name: 'Ana', attendanceCount: 10, updatedAt: 100, completeness: 50 },
                { id: 'b', name: 'Ana', attendanceCount: 10, updatedAt: 500, completeness: 50 }
            ]
        }];
        const plan = buildConflictPlan(conflicts);
        testRunner.assertEquals(plan[0].proposedMasterId, 'b',
            'updatedAt mayor desempata');
    },

    "empate en attendance Y updatedAt → desempata por completeness"() {
        const conflicts = [{
            number: '001',
            members: [
                { id: 'a', name: 'Ana', attendanceCount: 10, updatedAt: 100, completeness: 40 },
                { id: 'b', name: 'Ana', attendanceCount: 10, updatedAt: 100, completeness: 90 }
            ]
        }];
        const plan = buildConflictPlan(conflicts);
        testRunner.assertEquals(plan[0].proposedMasterId, 'b');
    },

    "losers = todos los miembros excepto el master propuesto"() {
        const conflicts = [{
            number: '001',
            members: [
                { id: 'a', name: 'Ana', attendanceCount: 5  },
                { id: 'b', name: 'Ana', attendanceCount: 30 },
                { id: 'c', name: 'Ana', attendanceCount: 10 }
            ]
        }];
        const plan = buildConflictPlan(conflicts);
        testRunner.assertEquals(plan[0].proposedMasterId, 'b');
        const loserIds = plan[0].loserIds.sort();
        testRunner.assertEquals(loserIds.join(','), 'a,c');
    }

});

testRunner.addSuite("ConflictPlanner — buildConflictPlan: detalles para el preview (Tarea #19)", {

    "incluye totalLoansAfterMerge: suma de loans de todos los miembros"() {
        const conflicts = [{
            number: '001',
            members: [
                { id: 'a', name: 'Ana', loans: [{id:'L1'}, {id:'L2'}], attendanceCount: 5 },
                { id: 'b', name: 'Ana', loans: [{id:'L3'}],            attendanceCount: 30 }
            ]
        }];
        const plan = buildConflictPlan(conflicts);
        testRunner.assertEquals(plan[0].totalLoansAfterMerge, 3,
            'Tras fusión deben quedar 3 préstamos');
    },

    "incluye flag hasCloudLosers cuando algún loser tiene _source=cloud/both"() {
        const conflicts = [{
            number: '001',
            members: [
                { id: 'a', name: 'Ana', _source: 'local',  attendanceCount: 30 },
                { id: 'b', name: 'Ana', _source: 'cloud',  attendanceCount: 5  }
            ]
        }];
        const plan = buildConflictPlan(conflicts);
        testRunner.assertEquals(plan[0].hasCloudLosers, true,
            'Si el loser tiene _source cloud, el merge debe borrar doc remoto');
    },

    "hasCloudLosers=false si todos los losers son local-only"() {
        const conflicts = [{
            number: '001',
            members: [
                { id: 'a', name: 'Ana', _source: 'local', attendanceCount: 30 },
                { id: 'b', name: 'Ana', _source: 'local', attendanceCount: 5  }
            ]
        }];
        const plan = buildConflictPlan(conflicts);
        testRunner.assertEquals(plan[0].hasCloudLosers, false);
    }

});

testRunner.addSuite("ConflictPlanner — entradas inválidas (Tarea #19)", {

    "lista vacía → plan vacío"() {
        testRunner.assertEquals(buildConflictPlan([]).length, 0);
    },

    "null/undefined → plan vacío sin reventar"() {
        testRunner.assertEquals(buildConflictPlan(null).length, 0);
        testRunner.assertEquals(buildConflictPlan(undefined).length, 0);
    },

    "grupo con un solo miembro se ignora (no es duplicado)"() {
        const conflicts = [{ number: '001', members: [{ id: 'a', name: 'Solo' }] }];
        testRunner.assertEquals(buildConflictPlan(conflicts).length, 0);
    }

});

console.log('🧪 ConflictPlanner tests cargados.');
