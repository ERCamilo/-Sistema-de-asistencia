/**
 * 🧪 EmployeeRepositoryTests (Fase 4.1 paso 2)
 *
 * Capa de acceso a users/{uid}/employees/{id} en Firestore. Esta es la
 * pieza que reemplaza el arreglo gigante por escrituras granulares.
 *
 * Verifica:
 *   - loadAll() lee de la colección 'employees' del usuario actual.
 *   - loadAll() retorna [] si no hay usuario autenticado.
 *   - saveOne(emp) escribe al path correcto con { merge: true }.
 *   - saveOne(emp) sin id es rechazado (no escribe nada).
 *   - saveOne actualiza updatedAt si no viene en el payload.
 *   - saveMany(N) ejecuta N writes (uno por empleado).
 *   - deleteOne(id) llama al delete correcto.
 *   - subscribe(cb) devuelve función para cancelar.
 *   - subscribe(cb) sin usuario retorna noop sin reventar.
 *
 * Como FirebaseService está mockeado por moduleNameMapper, este test
 * usa los mocks de firebase-data.js (setDoc, deleteDoc, onSnapshot...)
 * directamente y verifica que el repo los invoque con los argumentos
 * correctos.
 */

import { auth, setDoc, deleteDoc, getDocs, onSnapshot, doc, collection } from '../modules/data/firebase.js';

// Bypass del mapper: importa el módulo real
const EmployeeRepoModule = jest.requireActual('../modules/services/EmployeeRepository.js');
const EmployeeRepository = EmployeeRepoModule.EmployeeRepository || EmployeeRepoModule.default;

function clearAllMocks() {
    setDoc.mockClear();
    deleteDoc.mockClear();
    getDocs.mockClear();
    onSnapshot.mockClear();
    doc.mockClear();
    collection.mockClear();
}

testRunner.addSuite("EmployeeRepository — loadAll (Fase 4.1)", {

    async "sin usuario autenticado retorna []"() {
        clearAllMocks();
        auth.currentUser = null;
        const result = await EmployeeRepository.loadAll();
        testRunner.assertEquals(Array.isArray(result), true);
        testRunner.assertEquals(result.length, 0);
        testRunner.assertEquals(getDocs.mock.calls.length, 0,
            "No debe llamar a Firestore sin auth");
    },

    async "con usuario autenticado consulta la colección 'employees'"() {
        clearAllMocks();
        auth.currentUser = { uid: 'test-uid-1' };
        getDocs.mockResolvedValueOnce({
            forEach: (fn) => {
                [
                    { data: () => ({ id: 'e1', name: 'Ana' }) },
                    { data: () => ({ id: 'e2', name: 'Bob' }) }
                ].forEach(fn);
            },
            docs: []
        });

        const result = await EmployeeRepository.loadAll();

        testRunner.assert(collection.mock.calls.length >= 1,
            "Debe usar collection() de Firestore");
        // Verificar que algún collection() apunta a 'employees'
        const collectionArgs = collection.mock.calls.flat();
        testRunner.assert(
            collectionArgs.includes('employees'),
            "Debe consultar la colección 'employees'"
        );
        testRunner.assertEquals(result.length, 2);
        auth.currentUser = null;
    },

    async "tolera respuesta vacía"() {
        clearAllMocks();
        auth.currentUser = { uid: 'test-uid-2' };
        getDocs.mockResolvedValueOnce({ forEach: () => {}, docs: [] });

        const result = await EmployeeRepository.loadAll();
        testRunner.assertEquals(result.length, 0);
        auth.currentUser = null;
    }

});

testRunner.addSuite("EmployeeRepository — saveOne (Fase 4.1)", {

    async "saveOne sin usuario no escribe nada"() {
        clearAllMocks();
        auth.currentUser = null;
        await EmployeeRepository.saveOne({ id: 'e1', name: 'Ana' });
        testRunner.assertEquals(setDoc.mock.calls.length, 0);
    },

    async "saveOne con id válido invoca setDoc con { merge: true }"() {
        clearAllMocks();
        auth.currentUser = { uid: 'test-uid-3' };

        await EmployeeRepository.saveOne({ id: 'e1', name: 'Ana' });

        testRunner.assert(setDoc.mock.calls.length >= 1, "setDoc debe llamarse");
        const lastCall = setDoc.mock.calls[setDoc.mock.calls.length - 1];
        const options = lastCall[2];
        testRunner.assert(options && options.merge === true,
            "Debe usar { merge: true } para no borrar campos del lado del servidor");
        auth.currentUser = null;
    },

    async "saveOne sin id no escribe (defensa contra datos corruptos)"() {
        clearAllMocks();
        auth.currentUser = { uid: 'test-uid-4' };
        await EmployeeRepository.saveOne({ name: 'Sin ID' });
        testRunner.assertEquals(setDoc.mock.calls.length, 0,
            "No debe escribir empleado sin id");
        auth.currentUser = null;
    },

    async "saveOne con id vacío no escribe"() {
        clearAllMocks();
        auth.currentUser = { uid: 'test-uid-5' };
        await EmployeeRepository.saveOne({ id: '', name: 'ID vacío' });
        testRunner.assertEquals(setDoc.mock.calls.length, 0);
        auth.currentUser = null;
    },

    async "saveOne agrega updatedAt si falta"() {
        clearAllMocks();
        auth.currentUser = { uid: 'test-uid-6' };
        await EmployeeRepository.saveOne({ id: 'e1', name: 'Ana' });
        const lastCall = setDoc.mock.calls[setDoc.mock.calls.length - 1];
        const payload = lastCall[1];
        testRunner.assert(typeof payload.updatedAt === 'number',
            "El payload escrito debe incluir updatedAt numérico");
        auth.currentUser = null;
    },

    async "saveOne respeta updatedAt explícito del payload"() {
        clearAllMocks();
        auth.currentUser = { uid: 'test-uid-7' };
        const ts = 1234567890;
        await EmployeeRepository.saveOne({ id: 'e1', name: 'Ana', updatedAt: ts });
        const lastCall = setDoc.mock.calls[setDoc.mock.calls.length - 1];
        testRunner.assertEquals(lastCall[1].updatedAt, ts,
            "Debe respetar updatedAt cuando viene en el input");
        auth.currentUser = null;
    }

});

testRunner.addSuite("EmployeeRepository — saveMany (Fase 4.1)", {

    async "saveMany ejecuta un write por empleado"() {
        clearAllMocks();
        auth.currentUser = { uid: 'test-uid-8' };
        const emps = [
            { id: 'e1', name: 'Ana' },
            { id: 'e2', name: 'Bob' },
            { id: 'e3', name: 'Carlos' }
        ];
        const result = await EmployeeRepository.saveMany(emps);
        testRunner.assertEquals(setDoc.mock.calls.length, 3, "Debe haber 3 writes");
        testRunner.assertEquals(result.written, 3);
        auth.currentUser = null;
    },

    async "saveMany salta empleados sin id"() {
        clearAllMocks();
        auth.currentUser = { uid: 'test-uid-9' };
        const emps = [
            { id: 'e1', name: 'Ana' },
            { name: 'Sin ID' },
            { id: 'e2', name: 'Bob' }
        ];
        const result = await EmployeeRepository.saveMany(emps);
        testRunner.assertEquals(setDoc.mock.calls.length, 2);
        testRunner.assertEquals(result.written, 2);
        auth.currentUser = null;
    },

    async "saveMany sin usuario no escribe nada"() {
        clearAllMocks();
        auth.currentUser = null;
        const result = await EmployeeRepository.saveMany([{ id: 'e1', name: 'Ana' }]);
        testRunner.assertEquals(setDoc.mock.calls.length, 0);
        testRunner.assertEquals(result.written, 0);
    },

    async "saveMany con lista vacía retorna written: 0 sin errores"() {
        clearAllMocks();
        auth.currentUser = { uid: 'test-uid-10' };
        const result = await EmployeeRepository.saveMany([]);
        testRunner.assertEquals(result.written, 0);
        testRunner.assertEquals(setDoc.mock.calls.length, 0);
        auth.currentUser = null;
    }

});

testRunner.addSuite("EmployeeRepository — deleteOne (Fase 4.1)", {

    async "deleteOne invoca deleteDoc"() {
        clearAllMocks();
        auth.currentUser = { uid: 'test-uid-11' };
        await EmployeeRepository.deleteOne('e1');
        testRunner.assertEquals(deleteDoc.mock.calls.length, 1);
        auth.currentUser = null;
    },

    async "deleteOne sin id no borra nada"() {
        clearAllMocks();
        auth.currentUser = { uid: 'test-uid-12' };
        await EmployeeRepository.deleteOne('');
        testRunner.assertEquals(deleteDoc.mock.calls.length, 0);
        auth.currentUser = null;
    },

    async "deleteOne sin usuario no borra nada"() {
        clearAllMocks();
        auth.currentUser = null;
        await EmployeeRepository.deleteOne('e1');
        testRunner.assertEquals(deleteDoc.mock.calls.length, 0);
    }

});

testRunner.addSuite("EmployeeRepository — subscribe (Fase 4.1)", {

    "subscribe sin usuario retorna función noop sin reventar"() {
        clearAllMocks();
        auth.currentUser = null;
        const unsub = EmployeeRepository.subscribe(() => {});
        testRunner.assertEquals(typeof unsub, 'function',
            "Debe devolver una función aún sin auth");
        unsub(); // no debe lanzar
    },

    "subscribe con usuario invoca onSnapshot"() {
        clearAllMocks();
        auth.currentUser = { uid: 'test-uid-13' };
        const unsub = EmployeeRepository.subscribe(() => {});
        testRunner.assertEquals(onSnapshot.mock.calls.length, 1);
        testRunner.assertEquals(typeof unsub, 'function');
        auth.currentUser = null;
    }

});

// Importamos getDoc para verificar el read-merge-write en Fase 2.2
import { getDoc } from '../modules/data/firebase.js';

testRunner.addSuite("EmployeeRepository — saveOne con merge por ID (Fase 2.2)", {

    async "saveOne con opts.mergeRemote=true hace getDoc antes de setDoc"() {
        clearAllMocks();
        getDoc.mockClear();
        auth.currentUser = { uid: 'test-uid-merge-1' };

        // Simular doc remoto existente con un préstamo viejo.
        getDoc.mockResolvedValueOnce({
            exists: () => true,
            data: () => ({ id: 'e1', name: 'Ana', loans: [{ id: 'L_old', amount: 1000 }] })
        });

        await EmployeeRepository.saveOne(
            { id: 'e1', name: 'Ana', loans: [{ id: 'L_new', amount: 5000 }] },
            { mergeRemote: true }
        );

        testRunner.assert(getDoc.mock.calls.length >= 1,
            "Con mergeRemote:true debe leer primero del servidor");
        testRunner.assert(setDoc.mock.calls.length >= 1,
            "Y después escribir");

        // El payload escrito debe contener AMBOS préstamos (unión por id).
        const written = setDoc.mock.calls[setDoc.mock.calls.length - 1][1];
        testRunner.assert(Array.isArray(written.loans),
            "El payload escrito debe tener un arreglo loans");
        const ids = written.loans.map(l => l.id).sort();
        testRunner.assertEquals(ids.join(','), 'L_new,L_old',
            "Ambos préstamos deben preservarse tras el merge");

        auth.currentUser = null;
    },

    async "saveOne sin mergeRemote NO llama a getDoc (fast path)"() {
        clearAllMocks();
        getDoc.mockClear();
        auth.currentUser = { uid: 'test-uid-merge-2' };

        await EmployeeRepository.saveOne({ id: 'e1', name: 'Ana' });

        testRunner.assertEquals(getDoc.mock.calls.length, 0,
            "Sin mergeRemote, debe ser una sola escritura sin lectura previa");
        auth.currentUser = null;
    },

    async "saveOne con mergeRemote=true pero doc remoto no existe → escribe como nuevo"() {
        clearAllMocks();
        getDoc.mockClear();
        auth.currentUser = { uid: 'test-uid-merge-3' };

        getDoc.mockResolvedValueOnce({ exists: () => false, data: () => null });

        await EmployeeRepository.saveOne(
            { id: 'e1', name: 'Ana' },
            { mergeRemote: true }
        );

        testRunner.assert(setDoc.mock.calls.length >= 1,
            "Debe escribir aunque el doc remoto no exista");
        const written = setDoc.mock.calls[setDoc.mock.calls.length - 1][1];
        testRunner.assertEquals(written.name, 'Ana',
            "Sin doc remoto, el payload local va tal cual");
        auth.currentUser = null;
    },

    async "saveOne con mergeRemote y getDoc falla → fallback al write directo"() {
        clearAllMocks();
        getDoc.mockClear();
        auth.currentUser = { uid: 'test-uid-merge-4' };

        getDoc.mockRejectedValueOnce(new Error('network'));

        await EmployeeRepository.saveOne(
            { id: 'e1', name: 'Ana' },
            { mergeRemote: true }
        );

        testRunner.assert(setDoc.mock.calls.length >= 1,
            "Si el read falla, igual debe escribir (no perder el save del usuario)");
        auth.currentUser = null;
    }

});

console.log('🧪 EmployeeRepository tests cargados.');
