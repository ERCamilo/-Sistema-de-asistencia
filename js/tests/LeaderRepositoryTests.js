/**
 * 🧪 LeaderRepositoryTests (Schema v3)
 *
 * Capa de acceso a users/{uid}/leaders/{id} en Firestore.
 */

import { auth, setDoc, deleteDoc, getDocs, onSnapshot, doc, collection, getDoc } from '../modules/data/firebase.js';

// Bypass del mapper: importa el módulo real
const LeaderRepoModule = jest.requireActual('../modules/services/LeaderRepository.js');
const LeaderRepository = LeaderRepoModule.LeaderRepository || LeaderRepoModule.default;

function clearAllMocks() {
    setDoc.mockClear();
    deleteDoc.mockClear();
    getDocs.mockClear();
    onSnapshot.mockClear();
    doc.mockClear();
    collection.mockClear();
    getDoc.mockClear();
}

testRunner.addSuite("LeaderRepository — loadAll (Schema v3)", {

    async "sin usuario autenticado retorna []"() {
        clearAllMocks();
        auth.currentUser = null;
        const result = await LeaderRepository.loadAll();
        testRunner.assertEquals(Array.isArray(result), true);
        testRunner.assertEquals(result.length, 0);
        testRunner.assertEquals(getDocs.mock.calls.length, 0);
    },

    async "con usuario autenticado consulta la coleccion leaders"() {
        clearAllMocks();
        auth.currentUser = { uid: 'test-uid-1' };
        getDocs.mockResolvedValueOnce({
            forEach: (fn) => {
                [
                    { data: () => ({ id: 'l1', name: 'Leader A', number: 1 }) },
                    { data: () => ({ id: 'l2', name: 'Leader B', number: 2 }) }
                ].forEach(fn);
            },
            docs: []
        });

        const result = await LeaderRepository.loadAll();

        testRunner.assert(collection.mock.calls.length >= 1);
        const collectionArgs = collection.mock.calls.flat();
        testRunner.assert(collectionArgs.includes('leaders'));
        testRunner.assertEquals(result.length, 2);
        auth.currentUser = null;
    }

});

testRunner.addSuite("LeaderRepository — saveOne (Schema v3)", {

    async "saveOne sin usuario no escribe nada"() {
        clearAllMocks();
        auth.currentUser = null;
        await LeaderRepository.saveOne({ id: 'l1', name: 'Leader A', number: 1 });
        testRunner.assertEquals(setDoc.mock.calls.length, 0);
    },

    async "saveOne con id valido invoca setDoc con merge: true"() {
        clearAllMocks();
        auth.currentUser = { uid: 'test-uid-2' };
        await LeaderRepository.saveOne({ id: 'l1', name: 'Leader A', number: 1 });

        testRunner.assert(setDoc.mock.calls.length >= 1);
        const lastCall = setDoc.mock.calls[setDoc.mock.calls.length - 1];
        const options = lastCall[2];
        testRunner.assert(options && options.merge === true);
        auth.currentUser = null;
    },

    async "saveOne agrega updatedAt si falta"() {
        clearAllMocks();
        auth.currentUser = { uid: 'test-uid-3' };
        await LeaderRepository.saveOne({ id: 'l1', name: 'Leader A', number: 1 });
        const lastCall = setDoc.mock.calls[setDoc.mock.calls.length - 1];
        const payload = lastCall[1];
        testRunner.assert(typeof payload.updatedAt === 'number');
        auth.currentUser = null;
    },

    async "saveOne con mergeRemote=true combina segun LWW"() {
        clearAllMocks();
        auth.currentUser = { uid: 'test-uid-4' };

        // Simular doc remoto con updatedAt mayor
        const remoteTs = Date.now() + 1000;
        getDoc.mockResolvedValueOnce({
            exists: () => true,
            data: () => ({ id: 'l1', name: 'Leader Viejo', number: 1, updatedAt: remoteTs })
        });

        await LeaderRepository.saveOne(
            { id: 'l1', name: 'Leader Nuevo', number: 1, updatedAt: Date.now() },
            { mergeRemote: true }
        );

        testRunner.assert(getDoc.mock.calls.length >= 1);
        const lastCall = setDoc.mock.calls[setDoc.mock.calls.length - 1];
        const written = lastCall[1];
        testRunner.assertEquals(written.updatedAt, remoteTs);
        auth.currentUser = null;
    }

});

testRunner.addSuite("LeaderRepository — saveMany (Schema v3)", {

    async "saveMany escribe multiples lideres"() {
        clearAllMocks();
        auth.currentUser = { uid: 'test-uid-5' };
        const result = await LeaderRepository.saveMany([
            { id: 'l1', name: 'Leader A', number: 1 },
            { id: 'l2', name: 'Leader B', number: 2 }
        ]);
        testRunner.assertEquals(setDoc.mock.calls.length, 2);
        testRunner.assertEquals(result.written, 2);
        auth.currentUser = null;
    }

});

testRunner.addSuite("LeaderRepository — deleteOne (Schema v3)", {

    async "deleteOne borra el documento"() {
        clearAllMocks();
        auth.currentUser = { uid: 'test-uid-6' };
        await LeaderRepository.deleteOne('l1');
        testRunner.assertEquals(deleteDoc.mock.calls.length, 1);
        auth.currentUser = null;
    }

});

console.log('🧪 LeaderRepository tests cargados.');
