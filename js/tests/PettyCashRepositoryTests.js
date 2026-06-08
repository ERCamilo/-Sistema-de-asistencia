/**
 * 🧪 PettyCashRepositoryTests (Caja chica — Fase 1, Paso 2)
 *
 * Capa de acceso per-doc para el modelo de 3 niveles:
 *   users/{uid}/projects/{projectId}
 *   users/{uid}/cashPeriods/{periodId}
 *   users/{uid}/pettyCash/{txId}
 *
 * Mismo patrón que EmployeeRepository: API pura de IO contra Firestore,
 * verificada con los mocks de firebase-data.js (setDoc, deleteDoc, ...).
 *
 * PettyCashRepository expone 3 sub-repos: .projects, .periods, .movements.
 * Cada uno: loadAll, saveOne, saveMany, deleteOne, subscribe.
 */

import { auth, setDoc, deleteDoc, getDocs, onSnapshot, doc, collection } from '../modules/data/firebase.js';

const Mod = jest.requireActual('../modules/services/PettyCashRepository.js');
const PettyCashRepository = Mod.PettyCashRepository || Mod.default;

function clearAllMocks() {
    setDoc.mockClear();
    deleteDoc.mockClear();
    getDocs.mockClear();
    onSnapshot.mockClear();
    doc.mockClear();
    collection.mockClear();
}

testRunner.addSuite("PettyCashRepository — ruteo de colecciones", {

    "expone sub-repos projects / periods / movements"() {
        testRunner.assert(PettyCashRepository.projects && typeof PettyCashRepository.projects.loadAll === 'function', 'projects');
        testRunner.assert(PettyCashRepository.periods && typeof PettyCashRepository.periods.loadAll === 'function', 'periods');
        testRunner.assert(PettyCashRepository.movements && typeof PettyCashRepository.movements.loadAll === 'function', 'movements');
    },

    async "projects apunta a la colección 'projects'"() {
        clearAllMocks();
        auth.currentUser = { uid: 'u1' };
        getDocs.mockResolvedValueOnce({ forEach: () => {}, docs: [] });
        await PettyCashRepository.projects.loadAll();
        testRunner.assert(collection.mock.calls.flat().includes('projects'), "debe consultar 'projects'");
        auth.currentUser = null;
    },

    async "periods apunta a la colección 'cashPeriods'"() {
        clearAllMocks();
        auth.currentUser = { uid: 'u1' };
        getDocs.mockResolvedValueOnce({ forEach: () => {}, docs: [] });
        await PettyCashRepository.periods.loadAll();
        testRunner.assert(collection.mock.calls.flat().includes('cashPeriods'), "debe consultar 'cashPeriods'");
        auth.currentUser = null;
    },

    async "movements apunta a la colección 'pettyCash'"() {
        clearAllMocks();
        auth.currentUser = { uid: 'u1' };
        getDocs.mockResolvedValueOnce({ forEach: () => {}, docs: [] });
        await PettyCashRepository.movements.loadAll();
        testRunner.assert(collection.mock.calls.flat().includes('pettyCash'), "debe consultar 'pettyCash'");
        auth.currentUser = null;
    }

});

testRunner.addSuite("PettyCashRepository — loadAll", {

    async "sin usuario retorna []"() {
        clearAllMocks();
        auth.currentUser = null;
        const r = await PettyCashRepository.movements.loadAll();
        testRunner.assertEquals(Array.isArray(r), true);
        testRunner.assertEquals(r.length, 0);
        testRunner.assertEquals(getDocs.mock.calls.length, 0, "no debe llamar a Firestore sin auth");
    },

    async "con usuario retorna los docs"() {
        clearAllMocks();
        auth.currentUser = { uid: 'u2' };
        getDocs.mockResolvedValueOnce({
            forEach: (fn) => [
                { data: () => ({ id: 'm1', type: 'gasto', amount: 100 }) },
                { data: () => ({ id: 'm2', type: 'reposicion', amount: 500 }) }
            ].forEach(fn),
            docs: []
        });
        const r = await PettyCashRepository.movements.loadAll();
        testRunner.assertEquals(r.length, 2);
        testRunner.assertEquals(r[0].id, 'm1');
        auth.currentUser = null;
    },

    async "tolera colección vacía"() {
        clearAllMocks();
        auth.currentUser = { uid: 'u3' };
        getDocs.mockResolvedValueOnce({ forEach: () => {}, docs: [] });
        const r = await PettyCashRepository.movements.loadAll();
        testRunner.assertEquals(r.length, 0);
        auth.currentUser = null;
    }

});

testRunner.addSuite("PettyCashRepository — saveOne", {

    async "sin usuario no escribe"() {
        clearAllMocks();
        auth.currentUser = null;
        await PettyCashRepository.movements.saveOne({ id: 'm1', amount: 100 });
        testRunner.assertEquals(setDoc.mock.calls.length, 0);
    },

    async "con id válido escribe con { merge: true }"() {
        clearAllMocks();
        auth.currentUser = { uid: 'u4' };
        await PettyCashRepository.movements.saveOne({ id: 'm1', amount: 100 });
        testRunner.assert(setDoc.mock.calls.length >= 1, 'setDoc debe llamarse');
        const opts = setDoc.mock.calls[setDoc.mock.calls.length - 1][2];
        testRunner.assert(opts && opts.merge === true, 'debe usar { merge: true }');
        auth.currentUser = null;
    },

    async "sin id no escribe"() {
        clearAllMocks();
        auth.currentUser = { uid: 'u5' };
        await PettyCashRepository.movements.saveOne({ amount: 100 });
        testRunner.assertEquals(setDoc.mock.calls.length, 0);
        auth.currentUser = null;
    },

    async "agrega updatedAt si falta"() {
        clearAllMocks();
        auth.currentUser = { uid: 'u6' };
        await PettyCashRepository.movements.saveOne({ id: 'm1', amount: 100 });
        const payload = setDoc.mock.calls[setDoc.mock.calls.length - 1][1];
        testRunner.assert(typeof payload.updatedAt === 'number', 'updatedAt numérico');
        auth.currentUser = null;
    },

    async "respeta updatedAt explícito"() {
        clearAllMocks();
        auth.currentUser = { uid: 'u7' };
        await PettyCashRepository.movements.saveOne({ id: 'm1', amount: 100, updatedAt: 999 });
        const payload = setDoc.mock.calls[setDoc.mock.calls.length - 1][1];
        testRunner.assertEquals(payload.updatedAt, 999);
        auth.currentUser = null;
    },

    async "projects.saveOne también escribe (mismo contrato)"() {
        clearAllMocks();
        auth.currentUser = { uid: 'u8' };
        await PettyCashRepository.projects.saveOne({ id: 'p1', name: 'Torre A' });
        testRunner.assert(setDoc.mock.calls.length >= 1);
        auth.currentUser = null;
    }

});

testRunner.addSuite("PettyCashRepository — saveMany", {

    async "un write por item"() {
        clearAllMocks();
        auth.currentUser = { uid: 'u9' };
        const r = await PettyCashRepository.movements.saveMany([
            { id: 'm1', amount: 1 }, { id: 'm2', amount: 2 }, { id: 'm3', amount: 3 }
        ]);
        testRunner.assertEquals(setDoc.mock.calls.length, 3);
        testRunner.assertEquals(r.written, 3);
        auth.currentUser = null;
    },

    async "salta items sin id"() {
        clearAllMocks();
        auth.currentUser = { uid: 'u10' };
        const r = await PettyCashRepository.movements.saveMany([
            { id: 'm1', amount: 1 }, { amount: 2 }, { id: 'm3', amount: 3 }
        ]);
        testRunner.assertEquals(setDoc.mock.calls.length, 2);
        testRunner.assertEquals(r.written, 2);
        auth.currentUser = null;
    },

    async "sin usuario no escribe"() {
        clearAllMocks();
        auth.currentUser = null;
        const r = await PettyCashRepository.movements.saveMany([{ id: 'm1', amount: 1 }]);
        testRunner.assertEquals(setDoc.mock.calls.length, 0);
        testRunner.assertEquals(r.written, 0);
    },

    async "lista vacía → written 0"() {
        clearAllMocks();
        auth.currentUser = { uid: 'u11' };
        const r = await PettyCashRepository.movements.saveMany([]);
        testRunner.assertEquals(r.written, 0);
        testRunner.assertEquals(setDoc.mock.calls.length, 0);
        auth.currentUser = null;
    }

});

testRunner.addSuite("PettyCashRepository — deleteOne", {

    async "borra con id"() {
        clearAllMocks();
        auth.currentUser = { uid: 'u12' };
        await PettyCashRepository.movements.deleteOne('m1');
        testRunner.assertEquals(deleteDoc.mock.calls.length, 1);
        auth.currentUser = null;
    },

    async "sin id no borra"() {
        clearAllMocks();
        auth.currentUser = { uid: 'u13' };
        await PettyCashRepository.movements.deleteOne('');
        testRunner.assertEquals(deleteDoc.mock.calls.length, 0);
        auth.currentUser = null;
    },

    async "sin usuario no borra"() {
        clearAllMocks();
        auth.currentUser = null;
        await PettyCashRepository.movements.deleteOne('m1');
        testRunner.assertEquals(deleteDoc.mock.calls.length, 0);
    }

});

testRunner.addSuite("PettyCashRepository — subscribe", {

    "sin usuario retorna noop"() {
        clearAllMocks();
        auth.currentUser = null;
        const unsub = PettyCashRepository.movements.subscribe(() => {});
        testRunner.assertEquals(typeof unsub, 'function');
        unsub();
    },

    "con usuario invoca onSnapshot"() {
        clearAllMocks();
        auth.currentUser = { uid: 'u14' };
        const unsub = PettyCashRepository.movements.subscribe(() => {});
        testRunner.assertEquals(onSnapshot.mock.calls.length, 1);
        testRunner.assertEquals(typeof unsub, 'function');
        auth.currentUser = null;
    }

});

console.log('🧪 PettyCashRepository tests cargados.');
