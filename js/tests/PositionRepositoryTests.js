/**
 * 🧪 PositionRepositoryTests (Schema v3)
 *
 * Capa de acceso a users/{uid}/positions/{id} en Firestore.
 */

import { auth, setDoc, deleteDoc, getDocs, onSnapshot, doc, collection, getDoc } from '../modules/data/firebase.js';

// Bypass del mapper: importa el módulo real
const PositionRepoModule = jest.requireActual('../modules/services/PositionRepository.js');
const PositionRepository = PositionRepoModule.PositionRepository || PositionRepoModule.default;

function clearAllMocks() {
    setDoc.mockClear();
    deleteDoc.mockClear();
    getDocs.mockClear();
    onSnapshot.mockClear();
    doc.mockClear();
    collection.mockClear();
    getDoc.mockClear();
}

testRunner.addSuite("PositionRepository — loadAll (Schema v3)", {

    async "sin usuario autenticado retorna []"() {
        clearAllMocks();
        auth.currentUser = null;
        const result = await PositionRepository.loadAll();
        testRunner.assertEquals(Array.isArray(result), true);
        testRunner.assertEquals(result.length, 0);
        testRunner.assertEquals(getDocs.mock.calls.length, 0);
    },

    async "con usuario autenticado consulta la coleccion positions"() {
        clearAllMocks();
        auth.currentUser = { uid: 'test-uid-1' };
        getDocs.mockResolvedValueOnce({
            forEach: (fn) => {
                [
                    { data: () => ({ id: 'p1', name: 'Developer' }) },
                    { data: () => ({ id: 'p2', name: 'Designer' }) }
                ].forEach(fn);
            },
            docs: []
        });

        const result = await PositionRepository.loadAll();

        testRunner.assert(collection.mock.calls.length >= 1);
        const collectionArgs = collection.mock.calls.flat();
        testRunner.assert(collectionArgs.includes('positions'));
        testRunner.assertEquals(result.length, 2);
        auth.currentUser = null;
    }

});

testRunner.addSuite("PositionRepository — saveOne (Schema v3)", {

    async "saveOne sin usuario no escribe nada"() {
        clearAllMocks();
        auth.currentUser = null;
        await PositionRepository.saveOne({ id: 'p1', name: 'Developer' });
        testRunner.assertEquals(setDoc.mock.calls.length, 0);
    },

    async "saveOne con id valido invoca setDoc con merge: true"() {
        clearAllMocks();
        auth.currentUser = { uid: 'test-uid-2' };
        await PositionRepository.saveOne({ id: 'p1', name: 'Developer' });

        testRunner.assert(setDoc.mock.calls.length >= 1);
        const lastCall = setDoc.mock.calls[setDoc.mock.calls.length - 1];
        const options = lastCall[2];
        testRunner.assert(options && options.merge === true);
        auth.currentUser = null;
    },

    async "saveOne agrega updatedAt si falta"() {
        clearAllMocks();
        auth.currentUser = { uid: 'test-uid-3' };
        await PositionRepository.saveOne({ id: 'p1', name: 'Developer' });
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
            data: () => ({ id: 'p1', name: 'Developer Viejo', updatedAt: remoteTs })
        });

        await PositionRepository.saveOne(
            { id: 'p1', name: 'Developer Nuevo', updatedAt: Date.now() },
            { mergeRemote: true }
        );

        testRunner.assert(getDoc.mock.calls.length >= 1);
        const lastCall = setDoc.mock.calls[setDoc.mock.calls.length - 1];
        const written = lastCall[1];
        // Conserva el nombre nuevo pero actualiza al mayor updatedAt
        testRunner.assertEquals(written.updatedAt, remoteTs);
        auth.currentUser = null;
    }

});

testRunner.addSuite("PositionRepository — saveMany (Schema v3)", {

    async "saveMany escribe multiples cargos"() {
        clearAllMocks();
        auth.currentUser = { uid: 'test-uid-5' };
        const result = await PositionRepository.saveMany([
            { id: 'p1', name: 'Developer' },
            { id: 'p2', name: 'Designer' }
        ]);
        testRunner.assertEquals(setDoc.mock.calls.length, 2);
        testRunner.assertEquals(result.written, 2);
        auth.currentUser = null;
    }

});

testRunner.addSuite("PositionRepository — deleteOne (Schema v3)", {

    async "deleteOne borra el documento"() {
        clearAllMocks();
        auth.currentUser = { uid: 'test-uid-6' };
        await PositionRepository.deleteOne('p1');
        testRunner.assertEquals(deleteDoc.mock.calls.length, 1);
        auth.currentUser = null;
    }

});

console.log('🧪 PositionRepository tests cargados.');
