/**
 * 🧪 SchemaMigrationTests (Fase 4.1 — lógica pura)
 *
 * Verifica el helper que decide si una cuenta necesita migrar al modelo
 * "un doc por empleado" y prepara las escrituras correspondientes.
 *
 * Reglas:
 *   - needsMigration: schemaVersion ausente o <2 Y employees[] no vacío → true.
 *   - needsMigration: schemaVersion >= 2 → false (ya migrada).
 *   - needsMigration: employees[] vacío y schemaVersion ausente → false (cuenta nueva).
 *   - needsMigration: parentDoc null/undefined → false.
 *   - needsMigration: modo demo (opts.isDemo === true) → false (no migramos demo).
 *
 *   - prepareEmployeeMigrationWrites: devuelve N entries con { id, payload }.
 *   - Cada payload incluye id, name, loans, positions, advances, updatedAt.
 *   - Empleados sin id se omiten (defensa contra datos corruptos).
 *   - Empleados duplicados por id: se queda el más reciente por updatedAt.
 *   - Es idempotente: correr dos veces sobre los mismos datos retorna lo mismo.
 *
 *   - SCHEMA_VERSION_FIELD constante exportada y vale 'schemaVersion'.
 *   - TARGET_SCHEMA_VERSION exportada y es un número >= 2.
 */

import {
    needsMigration,
    prepareEmployeeMigrationWrites,
    SCHEMA_VERSION_FIELD,
    TARGET_SCHEMA_VERSION
} from '../modules/services/SchemaMigration.js';

testRunner.addSuite("SchemaMigration — needsMigration (Fase 4.1)", {

    "schemaVersion ausente + employees[] no vacío → true"() {
        const doc = { employees: [{ id: 'e1', name: 'Ana' }] };
        testRunner.assertEquals(needsMigration(doc), true);
    },

    "schemaVersion 0 + employees[] no vacío → true"() {
        const doc = { schemaVersion: 0, employees: [{ id: 'e1' }] };
        testRunner.assertEquals(needsMigration(doc), true);
    },

    "schemaVersion 1 + employees[] no vacío → true"() {
        const doc = { schemaVersion: 1, employees: [{ id: 'e1' }] };
        testRunner.assertEquals(needsMigration(doc), true);
    },

    "schemaVersion 2 → false (ya migrada)"() {
        const doc = { schemaVersion: 2, employees: [{ id: 'e1' }] };
        testRunner.assertEquals(needsMigration(doc), false);
    },

    "schemaVersion 3 (futura) → false"() {
        const doc = { schemaVersion: 3, employees: [{ id: 'e1' }] };
        testRunner.assertEquals(needsMigration(doc), false);
    },

    "employees[] vacío y sin schemaVersion → false (cuenta nueva)"() {
        const doc = { employees: [] };
        testRunner.assertEquals(needsMigration(doc), false,
            "Cuenta vacía no necesita migración (no hay nada que mover)");
    },

    "employees undefined → false"() {
        testRunner.assertEquals(needsMigration({}), false);
    },

    "parentDoc null → false"() {
        testRunner.assertEquals(needsMigration(null), false);
    },

    "parentDoc undefined → false"() {
        testRunner.assertEquals(needsMigration(undefined), false);
    },

    "modo demo (isDemo: true) → false aunque haya datos sin migrar"() {
        const doc = { employees: [{ id: 'e1' }] };
        testRunner.assertEquals(needsMigration(doc, { isDemo: true }), false,
            "No migramos en modo demo");
    },

    "SCHEMA_VERSION_FIELD es 'schemaVersion'"() {
        testRunner.assertEquals(SCHEMA_VERSION_FIELD, 'schemaVersion');
    },

    "TARGET_SCHEMA_VERSION es número >= 2"() {
        testRunner.assert(typeof TARGET_SCHEMA_VERSION === 'number',
            "Debe ser número");
        testRunner.assert(TARGET_SCHEMA_VERSION >= 2,
            "Debe ser >= 2");
    }

});

testRunner.addSuite("SchemaMigration — prepareEmployeeMigrationWrites (Fase 4.1)", {

    "lista vacía → no writes"() {
        const writes = prepareEmployeeMigrationWrites([]);
        testRunner.assertEquals(writes.length, 0);
    },

    "null/undefined → no writes (no rompe)"() {
        testRunner.assertEquals(prepareEmployeeMigrationWrites(null).length, 0);
        testRunner.assertEquals(prepareEmployeeMigrationWrites(undefined).length, 0);
    },

    "N empleados válidos → N writes"() {
        const emps = [
            { id: 'e1', name: 'Ana' },
            { id: 'e2', name: 'Bob' },
            { id: 'e3', name: 'Carlos' }
        ];
        const writes = prepareEmployeeMigrationWrites(emps);
        testRunner.assertEquals(writes.length, 3);
    },

    "cada write tiene la forma { id, payload }"() {
        const writes = prepareEmployeeMigrationWrites([{ id: 'e1', name: 'Ana' }]);
        const w = writes[0];
        testRunner.assertEquals(w.id, 'e1');
        testRunner.assert(typeof w.payload === 'object' && w.payload !== null,
            "payload debe ser objeto");
        testRunner.assertEquals(w.payload.name, 'Ana');
    },

    "payload preserva loans, positions, advances y demás campos del empleado"() {
        const emp = {
            id: 'e1',
            name: 'Ana',
            number: '001',
            active: true,
            positions: ['p1', 'p2'],
            positionSalaries: { p1: 100 },
            loans: [{ id: 'L1', amount: 5000 }],
            advances: [{ id: 'A1', amount: 200 }],
            bonuses: [],
            deductions: [],
            statusHistory: [{ active: true }]
        };
        const writes = prepareEmployeeMigrationWrites([emp]);
        const p = writes[0].payload;
        testRunner.assertEquals(p.loans.length, 1, "Debe preservar loans");
        testRunner.assertEquals(p.loans[0].id, 'L1');
        testRunner.assertEquals(p.positions.length, 2, "Debe preservar positions");
        testRunner.assertEquals(p.advances[0].amount, 200, "Debe preservar advances");
        testRunner.assertEquals(p.positionSalaries.p1, 100, "Debe preservar positionSalaries");
    },

    "empleado sin id se omite (defensa contra datos corruptos)"() {
        const emps = [
            { id: 'e1', name: 'Ana' },
            { name: 'Sin ID' },           // <-- inválido
            { id: '', name: 'ID vacío' }, // <-- inválido
            { id: 'e3', name: 'Carlos' }
        ];
        const writes = prepareEmployeeMigrationWrites(emps);
        testRunner.assertEquals(writes.length, 2, "Solo los empleados con id válido");
        testRunner.assertEquals(writes[0].id, 'e1');
        testRunner.assertEquals(writes[1].id, 'e3');
    },

    "duplicados por id: gana el más reciente por updatedAt"() {
        const emps = [
            { id: 'e1', name: 'Ana (vieja)', updatedAt: 100 },
            { id: 'e1', name: 'Ana (nueva)', updatedAt: 200 },
            { id: 'e1', name: 'Ana (media)', updatedAt: 150 }
        ];
        const writes = prepareEmployeeMigrationWrites(emps);
        testRunner.assertEquals(writes.length, 1, "Un solo write para id duplicado");
        testRunner.assertEquals(writes[0].payload.name, 'Ana (nueva)',
            "Debe ganar el de updatedAt mayor");
    },

    "duplicados sin updatedAt: gana el último encontrado"() {
        const emps = [
            { id: 'e1', name: 'Primera' },
            { id: 'e1', name: 'Segunda' }
        ];
        const writes = prepareEmployeeMigrationWrites(emps);
        testRunner.assertEquals(writes.length, 1);
        // Sin updatedAt comparable, asumimos last-wins (simple, predecible).
        testRunner.assertEquals(writes[0].payload.name, 'Segunda');
    },

    "idempotente: dos corridas sobre los mismos datos producen lo mismo"() {
        const emps = [
            { id: 'e1', name: 'Ana', updatedAt: 100 },
            { id: 'e2', name: 'Bob', updatedAt: 200 }
        ];
        const w1 = prepareEmployeeMigrationWrites(emps);
        const w2 = prepareEmployeeMigrationWrites(emps);
        testRunner.assertEquals(w1.length, w2.length);
        testRunner.assertEquals(JSON.stringify(w1), JSON.stringify(w2),
            "Resultado idéntico en corridas repetidas (idempotencia)");
    },

    "payload garantiza updatedAt para mergeing futuro"() {
        // Empleado sin updatedAt → el helper debe agregarlo (Date.now()).
        const writes = prepareEmployeeMigrationWrites([{ id: 'e1', name: 'Ana' }]);
        testRunner.assert(typeof writes[0].payload.updatedAt === 'number',
            "payload.updatedAt debe existir como número (clave para Fase 2.2)");
    }

});

console.log('🧪 SchemaMigration tests cargados.');
