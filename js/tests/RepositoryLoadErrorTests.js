/**
 * 🧪 RepositoryLoadErrorTests (Auditoría 2026-06-09, hallazgo M1)
 *
 * loadAll() de los repositorios per-doc se tragaba las excepciones y devolvía
 * [] — indistinguible de "colección vacía". En el camino de live-sync
 * (applyRemoteData → loadAndMigrateEmployees), un fallo de lectura transitorio
 * (offline, permisos, cuota) hacía que `loaderResult.employees || state.employees`
 * resolviera a `[] || state.employees` === `[]` (porque [] es truthy) →
 * **state.employees quedaba vacío durante la sesión** y un guardado en esa
 * ventana subía intención de "0 empleados".
 *
 * Fix: loadAll() devuelve `null` SÓLO ante un fallo real de lectura (el catch);
 * sigue devolviendo [] cuando no hay sesión o la colección está realmente
 * vacía. Como null es falsy, `loaderResult.employees || state.employees`
 * ahora conserva el estado. EmployeeLoader propaga ese null (no lo coacciona a
 * []) y marca result.error para que el caller pueda reportar.
 */

import { auth, getDocs } from '../modules/data/firebase.js';

const EmployeeRepository = jest.requireActual('../modules/services/EmployeeRepository.js').EmployeeRepository;
const PositionRepository = jest.requireActual('../modules/services/PositionRepository.js').PositionRepository;
const LeaderRepository = jest.requireActual('../modules/services/LeaderRepository.js').LeaderRepository;
const { loadAndMigrateEmployees } = jest.requireActual('../modules/services/EmployeeLoader.js');

testRunner.addSuite("Repositorios — null ante fallo de lectura, no [] (M1)", {

    async "EmployeeRepository.loadAll devuelve null si getDocs lanza"() {
        getDocs.mockClear();
        auth.currentUser = { uid: 'm1-uid' };
        getDocs.mockRejectedValueOnce(new Error('network down'));
        const result = await EmployeeRepository.loadAll();
        testRunner.assertEquals(result, null,
            'un fallo de lectura debe devolver null (distinguible de [] vacío)');
        auth.currentUser = null;
    },

    async "EmployeeRepository.loadAll sigue devolviendo [] sin sesión"() {
        getDocs.mockClear();
        auth.currentUser = null;
        const result = await EmployeeRepository.loadAll();
        testRunner.assert(Array.isArray(result) && result.length === 0,
            'sin sesión NO es un error: debe devolver [] (no null)');
    },

    async "EmployeeRepository.loadAll sigue devolviendo [] ante colección vacía"() {
        getDocs.mockClear();
        auth.currentUser = { uid: 'm1-uid' };
        getDocs.mockResolvedValueOnce({ forEach: () => {}, docs: [] });
        const result = await EmployeeRepository.loadAll();
        testRunner.assert(Array.isArray(result) && result.length === 0,
            'colección vacía es [] (no null) — eso NO es un fallo');
        auth.currentUser = null;
    },

    async "PositionRepository.loadAll devuelve null ante fallo de lectura"() {
        getDocs.mockClear();
        auth.currentUser = { uid: 'm1-uid' };
        getDocs.mockRejectedValueOnce(new Error('boom'));
        const result = await PositionRepository.loadAll();
        testRunner.assertEquals(result, null, 'PositionRepository debe señalar el fallo con null');
        auth.currentUser = null;
    },

    async "LeaderRepository.loadAll devuelve null ante fallo de lectura"() {
        getDocs.mockClear();
        auth.currentUser = { uid: 'm1-uid' };
        getDocs.mockRejectedValueOnce(new Error('boom'));
        const result = await LeaderRepository.loadAll();
        testRunner.assertEquals(result, null, 'LeaderRepository debe señalar el fallo con null');
        auth.currentUser = null;
    }

});

testRunner.addSuite("EmployeeLoader — preserva estado ante null (M1)", {

    async "si loadEmployees devuelve null, result.employees es null (no se blanquea)"() {
        const result = await loadAndMigrateEmployees({
            remoteData: { schemaVersion: 3, employees: [] },
            migrate: async () => ({ migrated: false }),
            loadEmployees: async () => null,          // fallo de lectura señalado por el repo
            loadPositions: async () => [{ id: 'p1' }],
            loadLeaders: async () => [{ id: 'l1' }]
        });
        testRunner.assertEquals(result.employees, null,
            'null debe propagarse para que `result.employees || state.employees` conserve el estado');
        testRunner.assert(!!result.error,
            'un fallo de lectura debe quedar registrado en result.error');
    },

    async "si loadEmployees devuelve un arreglo, se usa normalmente"() {
        const result = await loadAndMigrateEmployees({
            remoteData: { schemaVersion: 3, employees: [] },
            migrate: async () => ({ migrated: false }),
            loadEmployees: async () => [{ id: 'e1' }, { id: 'e2' }],
            loadPositions: async () => [],
            loadLeaders: async () => []
        });
        testRunner.assert(Array.isArray(result.employees) && result.employees.length === 2,
            'un arreglo válido debe pasar tal cual');
    },

    async "el `|| state` del caller conserva el estado cuando employees es null"() {
        // Reproduce la línea de app.js: dedup(loaderResult.employees || state.employees)
        const stateEmployees = [{ id: 'keep-me' }];
        const result = await loadAndMigrateEmployees({
            remoteData: { schemaVersion: 3, employees: [] },
            migrate: async () => ({ migrated: false }),
            loadEmployees: async () => null
        });
        const effective = result.employees || stateEmployees;
        testRunner.assertEquals(effective.length, 1, 'debe conservar el empleado local');
        testRunner.assertEquals(effective[0].id, 'keep-me', 'no debe blanquear el estado');
    }

});
