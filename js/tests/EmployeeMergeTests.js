/**
 * 🧪 EmployeeMergeTests (Fase 2.2)
 *
 * Función pura que fusiona dos versiones del MISMO empleado
 * (servidor + local) sin perder datos cuando ambos lados editaron
 * cosas distintas mientras estaban offline.
 *
 * Reglas:
 *   - Campos escalares (name, phone, ...): gana el de mayor updatedAt.
 *     Si empate o ambos sin timestamp, gana local (caller suele ser el
 *     que está guardando).
 *   - Arreglos de "log" (loans, advances, bonuses, deductions): UNIÓN
 *     por id. Si el mismo id aparece en ambos, gana el de mayor
 *     updatedAt (o local en empate). Items con id solo en un lado se
 *     preservan tal cual.
 *   - Anidados: dentro de un préstamo, payments[] e installments[]
 *     también se unen por id (un pago no se pierde porque otro
 *     dispositivo no lo había visto).
 *   - statusHistory: unión por timestamp (sirve de id).
 *   - El resultado conserva el mayor de los updatedAt de nivel raíz.
 */

import { mergeEmployees } from '../modules/services/EmployeeMerge.js';

function loan(id, updatedAt, payments = []) {
    return { id, updatedAt, payments, installments: [], status: 'active' };
}

testRunner.addSuite("EmployeeMerge — escalares + nulls (Fase 2.2)", {

    "server null → devuelve local sin cambios"() {
        const local = { id: 'e1', name: 'Ana', updatedAt: 100 };
        const result = mergeEmployees(null, local);
        testRunner.assertEquals(result.name, 'Ana');
        testRunner.assertEquals(result.updatedAt, 100);
    },

    "local null → devuelve server"() {
        const server = { id: 'e1', name: 'Ana (server)', updatedAt: 200 };
        const result = mergeEmployees(server, null);
        testRunner.assertEquals(result.name, 'Ana (server)');
    },

    "ambos null → devuelve {}"() {
        const result = mergeEmployees(null, null);
        testRunner.assert(result && typeof result === 'object');
    },

    "server con updatedAt MAYOR → escalares del server ganan"() {
        const server = { id: 'e1', name: 'Ana cambiada', phone: '111', updatedAt: 300 };
        const local  = { id: 'e1', name: 'Ana original', phone: '222', updatedAt: 100 };
        const result = mergeEmployees(server, local);
        testRunner.assertEquals(result.name, 'Ana cambiada');
        testRunner.assertEquals(result.phone, '111');
    },

    "local con updatedAt MAYOR → escalares del local ganan"() {
        const server = { id: 'e1', name: 'vieja', updatedAt: 100 };
        const local  = { id: 'e1', name: 'nueva', updatedAt: 300 };
        const result = mergeEmployees(server, local);
        testRunner.assertEquals(result.name, 'nueva');
    },

    "empate de updatedAt → gana local"() {
        const server = { id: 'e1', name: 'server', updatedAt: 100 };
        const local  = { id: 'e1', name: 'local',  updatedAt: 100 };
        const result = mergeEmployees(server, local);
        testRunner.assertEquals(result.name, 'local',
            "En empate gana local (más conservador para el usuario que guarda)");
    },

    "resultado lleva el mayor updatedAt entre ambos"() {
        const server = { id: 'e1', name: 'x', updatedAt: 100 };
        const local  = { id: 'e1', name: 'y', updatedAt: 300 };
        testRunner.assertEquals(mergeEmployees(server, local).updatedAt, 300);
        testRunner.assertEquals(mergeEmployees(local, server).updatedAt, 300,
            "El mayor updatedAt se conserva sin importar el orden");
    }

});

testRunner.addSuite("EmployeeMerge — loans (Fase 2.2)", {

    "préstamos distintos en cada lado → unión por id"() {
        const server = { id: 'e1', loans: [loan('L1', 100)], updatedAt: 100 };
        const local  = { id: 'e1', loans: [loan('L2', 200)], updatedAt: 200 };
        const result = mergeEmployees(server, local);
        testRunner.assertEquals(result.loans.length, 2);
        testRunner.assert(result.loans.find(l => l.id === 'L1'), "Debe preservar L1");
        testRunner.assert(result.loans.find(l => l.id === 'L2'), "Debe preservar L2");
    },

    "mismo loan id en ambos → gana el de mayor updatedAt"() {
        const server = { id: 'e1', loans: [{ id: 'L1', amount: 5000, updatedAt: 300 }], updatedAt: 300 };
        const local  = { id: 'e1', loans: [{ id: 'L1', amount: 4000, updatedAt: 100 }], updatedAt: 100 };
        const result = mergeEmployees(server, local);
        testRunner.assertEquals(result.loans[0].amount, 5000,
            "El loan con mayor updatedAt gana");
    },

    "mismo loan, sin updatedAt en ninguno → gana local"() {
        const server = { id: 'e1', loans: [{ id: 'L1', amount: 5000 }] };
        const local  = { id: 'e1', loans: [{ id: 'L1', amount: 4000 }] };
        const result = mergeEmployees(server, local);
        testRunner.assertEquals(result.loans[0].amount, 4000);
    },

    "loan sin id se preserva con id sintético (fix: ya no se descarta)"() {
        // Bug histórico: items sin id se DESCARTABAN silenciosamente en cada
        // merge, perdiendo datos en la nube. Ahora les asignamos un id y los
        // conservamos (es mejor un duplicado eventual que pérdida garantizada).
        const server = { id: 'e1', loans: [{ amount: 5000 }] };
        const local  = { id: 'e1', loans: [loan('L1', 200)] };
        const result = mergeEmployees(server, local);
        testRunner.assertEquals(result.loans.length, 2,
            "Ambos loans deben preservarse, no descartarse");
        const ids = result.loans.map(l => l.id).filter(Boolean);
        testRunner.assertEquals(ids.length, 2,
            "Todos los loans deben tener id (el sin-id recibe uno sintético)");
        testRunner.assert(ids.includes('L1'), "L1 debe estar presente");
    },

    "loans sin id en ambos lados: todos se preservan con ids sintéticos"() {
        // Caso pesado del bug: advances/loans viejos sin ids → unionById
        // los descartaba todos. Ahora se preservan.
        const server = { id: 'e1', advances: [{ amount: 100 }, { amount: 200 }] };
        const local  = { id: 'e1', advances: [{ amount: 300 }] };
        const result = mergeEmployees(server, local);
        testRunner.assertEquals(result.advances.length, 3,
            "Los 3 advances sin id deben preservarse");
        const allHaveIds = result.advances.every(a => typeof a.id === 'string' && a.id.length > 0);
        testRunner.assert(allHaveIds,
            "Todos los advances deben terminar con id (backfill)");
    },

    "loan id falsy ('', null, undefined) → recibe id sintético"() {
        const server = { id: 'e1', loans: [{ id: '', amount: 100 }, { id: null, amount: 200 }] };
        const local  = { id: 'e1', loans: [{ id: undefined, amount: 300 }] };
        const result = mergeEmployees(server, local);
        testRunner.assertEquals(result.loans.length, 3);
        result.loans.forEach(l => {
            testRunner.assert(typeof l.id === 'string' && l.id.length > 0,
                "id debe ser un string no vacío");
        });
    },

    "payments anidados sin id también se preservan"() {
        // Bug en cascada: si los payments perdían id, también desaparecían.
        const server = {
            id: 'e1',
            loans: [{ id: 'L1', updatedAt: 200, payments: [{ amount: 100 }] }],
            updatedAt: 200
        };
        const local = {
            id: 'e1',
            loans: [{ id: 'L1', updatedAt: 100, payments: [{ amount: 200 }] }],
            updatedAt: 100
        };
        const result = mergeEmployees(server, local);
        testRunner.assertEquals(result.loans[0].payments.length, 2,
            "Ambos payments sin id deben preservarse");
    },

    "loans vacío en un lado → preserva todo el otro"() {
        const server = { id: 'e1', loans: [], updatedAt: 100 };
        const local  = { id: 'e1', loans: [loan('L1', 200), loan('L2', 250)], updatedAt: 250 };
        const result = mergeEmployees(server, local);
        testRunner.assertEquals(result.loans.length, 2);
    },

    "payments anidados se unen por id"() {
        // Server: L1 con payment P1
        // Local:  L1 con payment P2
        // Resultado: L1 con [P1, P2]
        const server = {
            id: 'e1',
            loans: [{ id: 'L1', amount: 5000, updatedAt: 200, payments: [{ id: 'P1', amount: 1000 }] }],
            updatedAt: 200
        };
        const local = {
            id: 'e1',
            loans: [{ id: 'L1', amount: 5000, updatedAt: 100, payments: [{ id: 'P2', amount: 1500 }] }],
            updatedAt: 100
        };
        const result = mergeEmployees(server, local);
        testRunner.assertEquals(result.loans.length, 1);
        testRunner.assertEquals(result.loans[0].payments.length, 2,
            "Los payments de ambos lados deben preservarse");
        const ids = result.loans[0].payments.map(p => p.id).sort();
        testRunner.assertEquals(ids.join(','), 'P1,P2');
    },

    "installments anidados también se unen por id"() {
        const server = {
            id: 'e1',
            loans: [{
                id: 'L1', updatedAt: 100,
                installments: [{ id: 'I1', seq: 1 }, { id: 'I2', seq: 2 }],
                payments: []
            }]
        };
        const local = {
            id: 'e1',
            loans: [{
                id: 'L1', updatedAt: 100,
                installments: [{ id: 'I3', seq: 3 }],
                payments: []
            }]
        };
        const result = mergeEmployees(server, local);
        testRunner.assertEquals(result.loans[0].installments.length, 3);
    }

});

testRunner.addSuite("EmployeeMerge — advances/bonuses/deductions/statusHistory (Fase 2.2)", {

    "advances se unen por id"() {
        const server = { id: 'e1', advances: [{ id: 'A1', amount: 100 }, { id: 'A2', amount: 200 }] };
        const local  = { id: 'e1', advances: [{ id: 'A2', amount: 250 }, { id: 'A3', amount: 300 }] };
        const result = mergeEmployees(server, local);
        const ids = result.advances.map(a => a.id).sort();
        testRunner.assertEquals(ids.join(','), 'A1,A2,A3');
    },

    "bonuses se unen por id"() {
        const server = { id: 'e1', bonuses: [{ id: 'B1' }] };
        const local  = { id: 'e1', bonuses: [{ id: 'B2' }] };
        const result = mergeEmployees(server, local);
        testRunner.assertEquals(result.bonuses.length, 2);
    },

    "deductions se unen por id"() {
        const server = { id: 'e1', deductions: [{ id: 'D1' }] };
        const local  = { id: 'e1', deductions: [{ id: 'D2' }] };
        const result = mergeEmployees(server, local);
        testRunner.assertEquals(result.deductions.length, 2);
    },

    "statusHistory se une por timestamp (sirve de id)"() {
        const server = {
            id: 'e1',
            statusHistory: [{ timestamp: 100, active: true }, { timestamp: 200, active: false }]
        };
        const local = {
            id: 'e1',
            statusHistory: [{ timestamp: 200, active: false }, { timestamp: 300, active: true }]
        };
        const result = mergeEmployees(server, local);
        testRunner.assertEquals(result.statusHistory.length, 3,
            "Debe haber 3 entradas únicas (100, 200, 300)");
    }

});

testRunner.addSuite("EmployeeMerge — positions y positionSalaries (Fase 2.2)", {

    "positions es lista de strings → unión (no perder asignaciones)"() {
        const server = { id: 'e1', positions: ['p1', 'p2'] };
        const local  = { id: 'e1', positions: ['p2', 'p3'] };
        const result = mergeEmployees(server, local);
        const sorted = result.positions.sort();
        testRunner.assertEquals(sorted.join(','), 'p1,p2,p3',
            "Las posiciones asignadas se preservan de ambos lados");
    },

    "positionSalaries (mapa por posición) → se unen, gana mayor updatedAt"() {
        const server = {
            id: 'e1',
            positionSalaries: { p1: 100, p2: 200 },
            updatedAt: 100
        };
        const local = {
            id: 'e1',
            positionSalaries: { p2: 250, p3: 300 },
            updatedAt: 300
        };
        const result = mergeEmployees(server, local);
        testRunner.assertEquals(result.positionSalaries.p1, 100, "p1 viene de server");
        testRunner.assertEquals(result.positionSalaries.p3, 300, "p3 viene de local");
        // p2 colisiona — gana el lado con mayor updatedAt (local en este caso)
        testRunner.assertEquals(result.positionSalaries.p2, 250);
    }

});

console.log('🧪 EmployeeMerge tests cargados.');
