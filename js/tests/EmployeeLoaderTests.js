/**
 * 🧪 EmployeeLoaderTests (Fase 4.1 paso 4a)
 *
 * Helper que combina migración + carga de empleados en un solo flujo
 * testeable, con sus dependencias inyectadas. Será llamado desde el
 * callback de subscribeToChanges en app.js.
 *
 * Contrato:
 *   - Si needsMigration: corre migrate() → loadEmployees() de la nueva fuente.
 *   - Si ya migrado: skip migrate, loadEmployees() devuelve los actuales.
 *   - Si migrate() falla: NO romper la carga; loguear y devolver empleados
 *     del payload legacy como fallback (mejor cargar algo que romper la app).
 *   - Si loadEmployees() falla: idem fallback al legacy.
 *   - Retorna { migrated, count, employees }.
 */

import { loadAndMigrateEmployees } from '../modules/services/EmployeeLoader.js';

function makeDeps(overrides = {}) {
    return {
        migrate: jest.fn().mockResolvedValue({ migrated: false }),
        loadEmployees: jest.fn().mockResolvedValue([]),
        ...overrides
    };
}

testRunner.addSuite("EmployeeLoader — loadAndMigrateEmployees (Fase 4.1)", {

    async "happy path: ya migrado, carga desde la nueva fuente"() {
        const remote = { schemaVersion: 2, employees: [] };
        const newEmps = [{ id: 'e1', name: 'Ana' }, { id: 'e2', name: 'Bob' }];
        const deps = makeDeps({
            migrate: jest.fn().mockResolvedValue({ migrated: false }),
            loadEmployees: jest.fn().mockResolvedValue(newEmps)
        });
        const result = await loadAndMigrateEmployees({ remoteData: remote, ...deps });
        testRunner.assertEquals(result.migrated, false);
        testRunner.assertEquals(result.employees.length, 2);
        testRunner.assertEquals(deps.loadEmployees.mock.calls.length, 1);
    },

    async "happy path: cuenta no migrada, ejecuta migrate y luego carga"() {
        const legacy = [{ id: 'e1', name: 'Ana' }];
        const migrated = [{ id: 'e1', name: 'Ana' }, { id: 'e2', name: 'Bob' }];
        const remote = { employees: legacy };
        const deps = makeDeps({
            migrate: jest.fn().mockResolvedValue({ migrated: true, count: 1 }),
            loadEmployees: jest.fn().mockResolvedValue(migrated)
        });
        const result = await loadAndMigrateEmployees({ remoteData: remote, ...deps });
        testRunner.assertEquals(result.migrated, true);
        testRunner.assertEquals(result.count, 1);
        testRunner.assertEquals(result.employees.length, 2);
        // Orden: migrate primero, luego load
        const migrateOrder = deps.migrate.mock.invocationCallOrder[0];
        const loadOrder = deps.loadEmployees.mock.invocationCallOrder[0];
        testRunner.assert(migrateOrder < loadOrder,
            "migrate debe ejecutarse antes que loadEmployees");
    },

    async "después de migrar, loadEmployees recibe un remoteData con schemaVersion>=2"() {
        const remote = { employees: [{ id: 'e1' }] };
        const captured = [];
        const deps = makeDeps({
            migrate: jest.fn().mockResolvedValue({ migrated: true, count: 1 }),
            loadEmployees: jest.fn().mockImplementation(async (arg) => {
                captured.push(arg);
                return [];
            })
        });
        await loadAndMigrateEmployees({ remoteData: remote, ...deps });
        testRunner.assert(captured[0].schemaVersion >= 2,
            "loadEmployees debe recibir un payload con schemaVersion ya marcado");
    },

    async "si migrate falla, devuelve empleados del legacy (fallback seguro)"() {
        const legacy = [{ id: 'e1', name: 'Ana' }, { id: 'e2', name: 'Bob' }];
        const remote = { employees: legacy };
        const deps = makeDeps({
            migrate: jest.fn().mockRejectedValue(new Error('migrate-fail')),
            loadEmployees: jest.fn().mockResolvedValue([])
        });
        const result = await loadAndMigrateEmployees({ remoteData: remote, ...deps });
        testRunner.assertEquals(result.migrated, false);
        testRunner.assertEquals(result.employees.length, 2,
            "Si la migración explota, debemos devolver los empleados legacy para no romper la UI");
        testRunner.assert(!!result.error,
            "El resultado debe incluir el error para que el caller pueda reportar/loguear");
    },

    async "si loadEmployees falla, fallback al legacy del remoteData"() {
        const legacy = [{ id: 'e1' }, { id: 'e2' }];
        const remote = { schemaVersion: 2, employees: legacy };
        const deps = makeDeps({
            migrate: jest.fn().mockResolvedValue({ migrated: false }),
            loadEmployees: jest.fn().mockRejectedValue(new Error('load-fail'))
        });
        const result = await loadAndMigrateEmployees({ remoteData: remote, ...deps });
        testRunner.assertEquals(result.employees.length, 2,
            "Si loadEmployees falla, fallback a los del payload legacy");
    },

    async "remoteData null → result.employees = []"() {
        const deps = makeDeps();
        const result = await loadAndMigrateEmployees({ remoteData: null, ...deps });
        testRunner.assertEquals(result.migrated, false);
        testRunner.assertEquals(result.employees.length, 0);
    },

    async "modo demo se propaga a migrate"() {
        const deps = makeDeps({
            migrate: jest.fn().mockResolvedValue({ migrated: false })
        });
        await loadAndMigrateEmployees({
            remoteData: { employees: [{ id: 'e1' }] },
            isDemo: true,
            ...deps
        });
        // Firma esperada: migrate(remoteData, opts). isDemo va en opts (2do arg).
        const [, opts] = deps.migrate.mock.calls[0];
        testRunner.assert(
            opts && opts.isDemo === true,
            "migrate debe recibir { isDemo: true } como segundo argumento"
        );
    },

    // ── Schema v3: carga granular de cargos y líderes ──────────────────

    async "v3: carga posiciones y líderes desde la fuente granular inyectada"() {
        const remote = { schemaVersion: 3, employees: [], positions: [], leaders: [] };
        const positions = [{ id: 'p1', name: 'Albañil' }, { id: 'p2', name: 'Ayudante' }];
        const leaders = [{ id: 'l1', name: 'Capataz' }];
        const deps = makeDeps({
            loadPositions: jest.fn().mockResolvedValue(positions),
            loadLeaders: jest.fn().mockResolvedValue(leaders)
        });
        const result = await loadAndMigrateEmployees({ remoteData: remote, ...deps });
        testRunner.assertEquals(result.positions.length, 2,
            "Debe cargar cargos desde el loader granular, no del parent doc");
        testRunner.assertEquals(result.leaders.length, 1,
            "Debe cargar líderes desde el loader granular, no del parent doc");
        testRunner.assertEquals(deps.loadPositions.mock.calls.length, 1);
        testRunner.assertEquals(deps.loadLeaders.mock.calls.length, 1);
    },

    async "v3: tras migrar, loadPositions/loadLeaders reciben schemaVersion>=3"() {
        const remote = { employees: [{ id: 'e1' }], positions: [{ id: 'p1' }], leaders: [] };
        const capPos = [];
        const capLead = [];
        const deps = makeDeps({
            migrate: jest.fn().mockResolvedValue({ migrated: true, count: 1 }),
            loadPositions: jest.fn().mockImplementation(async (arg) => { capPos.push(arg); return []; }),
            loadLeaders: jest.fn().mockImplementation(async (arg) => { capLead.push(arg); return []; })
        });
        await loadAndMigrateEmployees({ remoteData: remote, ...deps });
        testRunner.assert(capPos[0].schemaVersion >= 3,
            "Tras migrar, loadPositions debe ver schemaVersion>=3 para usar la subcolección");
        testRunner.assert(capLead[0].schemaVersion >= 3,
            "Tras migrar, loadLeaders debe ver schemaVersion>=3 para usar la subcolección");
    },

    async "v3: si loadPositions falla, fallback a remoteData.positions"() {
        const legacyPos = [{ id: 'p1' }, { id: 'p2' }];
        const remote = { schemaVersion: 3, employees: [], positions: legacyPos, leaders: [] };
        const deps = makeDeps({
            loadPositions: jest.fn().mockRejectedValue(new Error('pos-fail')),
            loadLeaders: jest.fn().mockResolvedValue([])
        });
        const result = await loadAndMigrateEmployees({ remoteData: remote, ...deps });
        testRunner.assertEquals(result.positions.length, 2,
            "Si loadPositions explota, devolver los cargos legacy para no romper la UI");
        testRunner.assert(!!result.error, "Debe capturar el error de carga de cargos");
    },

    async "sin loaders de cargos/líderes, usa los arreglos legacy del remoteData"() {
        const remote = {
            schemaVersion: 2,
            employees: [],
            positions: [{ id: 'p1' }],
            leaders: [{ id: 'l1' }, { id: 'l2' }]
        };
        const deps = makeDeps(); // sin loadPositions/loadLeaders
        const result = await loadAndMigrateEmployees({ remoteData: remote, ...deps });
        testRunner.assertEquals(result.positions.length, 1,
            "Sin loader granular, los cargos vienen del arreglo legacy del parent");
        testRunner.assertEquals(result.leaders.length, 2,
            "Sin loader granular, los líderes vienen del arreglo legacy del parent");
    }

});

console.log('🧪 EmployeeLoader tests cargados.');
