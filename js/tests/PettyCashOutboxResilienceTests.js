/**
 * 🧪 PettyCashOutboxResilienceTests (Auditoría 2026-06-09, hallazgo M2)
 *
 * El outbox de caja chica cortaba el drenado en la PRIMERA entrada que
 * fallara (correcto para errores transitorios de red), pero sin contador
 * de intentos: una entrada "envenenada" (rechazada por reglas, doc >1MB,
 * id corrupto) bloqueaba la cola COMPLETA para siempre, en silencio.
 *
 * Fix:
 *   - Cada fallo incrementa entry.attempts y guarda entry.lastError.
 *   - Tras MAX_FLUSH_ATTEMPTS la entrada pasa a status 'dead' y el drenado
 *     CONTINÚA con la siguiente (ya no bloquea).
 *   - Fallos transitorios (attempts < máximo) siguen cortando el ciclo
 *     para no martillar la red.
 *   - deadCount()/requeueDeadEntries() para diagnóstico y recuperación.
 *   - El outbox se drena al volver la conexión (evento 'online').
 *
 * Behavioral: PettyCashStore es real; indexedDBService y firebase-data son
 * los mocks globales de Jest (configurables por test).
 */

import fs from 'fs';
import path from 'path';
import { PettyCashStore, MAX_FLUSH_ATTEMPTS } from '../modules/features/pettycash/PettyCashStore.js';
import indexedDBService from '../modules/services/IndexedDBService.js'; // → mock global
import { auth, setDoc, deleteDoc } from '../modules/data/firebase.js';  // → mock global

const STORE_SRC = fs.readFileSync(
    path.resolve(__dirname, '../modules/features/pettycash/PettyCashStore.js'), 'utf8'
);

function entry(key, overrides = {}) {
    return {
        key, op: 'save', col: 'movements', id: `m${key}`,
        data: { id: `m${key}`, amount: 10 }, ts: 1000 + key, status: 'pending',
        ...overrides
    };
}

function resetMocks() {
    auth.currentUser = { uid: 'test-uid' };
    indexedDBService.getAll.mockReset().mockResolvedValue([]);
    indexedDBService.update.mockReset().mockResolvedValue(1);
    indexedDBService.delete.mockReset().mockResolvedValue(undefined);
    setDoc.mockReset().mockResolvedValue(undefined);
    deleteDoc.mockReset().mockResolvedValue(undefined);
}

testRunner.addSuite("PettyCashStore — outbox con manejo de entradas envenenadas (M2)", {

    async "flush exitoso drena la entrada y la borra del outbox"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([entry(1)]);
        await PettyCashStore.flush();
        testRunner.assert(setDoc.mock.calls.length >= 1, 'debe escribir a Firestore');
        testRunner.assert(
            indexedDBService.delete.mock.calls.some(c => c[0] === 'pettyCashOutbox' && c[1] === 1),
            'la entrada drenada debe borrarse del outbox'
        );
    },

    async "un fallo transitorio incrementa attempts y guarda lastError"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([entry(1)]);
        setDoc.mockRejectedValue(new Error('network glitch'));
        await PettyCashStore.flush();
        const updates = indexedDBService.update.mock.calls.filter(c => c[0] === 'pettyCashOutbox');
        testRunner.assert(updates.length === 1, 'debe re-guardar la entrada fallida');
        const saved = updates[0][1];
        testRunner.assertEquals(saved.attempts, 1, 'attempts debe incrementarse');
        testRunner.assert(String(saved.lastError).includes('network glitch'), 'lastError debe registrarse');
        testRunner.assertEquals(saved.status, 'pending', 'sigue pending (reintentable)');
    },

    async "fallo transitorio corta el ciclo (no martilla las entradas siguientes)"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([entry(1), entry(2)]);
        setDoc.mockRejectedValue(new Error('offline'));
        await PettyCashStore.flush();
        testRunner.assertEquals(setDoc.mock.calls.length, 1,
            'solo la primera entrada debe intentarse en este ciclo');
    },

    async "tras MAX_FLUSH_ATTEMPTS la entrada pasa a dead y la cola CONTINÚA"() {
        resetMocks();
        const poisoned = entry(1, { attempts: MAX_FLUSH_ATTEMPTS - 1 });
        const healthy = entry(2);
        indexedDBService.getAll.mockResolvedValue([poisoned, healthy]);
        // La 1ª escritura (envenenada) falla; la 2ª (sana) funciona.
        setDoc.mockRejectedValueOnce(new Error('permission-denied'))
              .mockResolvedValue(undefined);
        await PettyCashStore.flush();

        const updates = indexedDBService.update.mock.calls.filter(c => c[0] === 'pettyCashOutbox');
        const deadUpdate = updates.find(c => c[1] && c[1].key === 1);
        testRunner.assert(!!deadUpdate, 'la entrada envenenada debe re-guardarse');
        testRunner.assertEquals(deadUpdate[1].status, 'dead',
            `tras ${MAX_FLUSH_ATTEMPTS} intentos debe marcarse dead`);
        testRunner.assert(
            indexedDBService.delete.mock.calls.some(c => c[1] === 2),
            'la entrada sana DEBE drenarse aunque la anterior esté envenenada — antes quedaba bloqueada para siempre'
        );
    },

    async "las entradas dead no se reintentan en flushes posteriores"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([entry(1, { status: 'dead', attempts: 9 })]);
        await PettyCashStore.flush();
        testRunner.assertEquals(setDoc.mock.calls.length, 0, 'dead no debe tocar Firestore');
    },

    async "deadCount cuenta solo las entradas dead"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([
            entry(1, { status: 'dead' }), entry(2), entry(3, { status: 'dead' })
        ]);
        const n = await PettyCashStore.deadCount();
        testRunner.assertEquals(n, 2);
    },

    async "requeueDeadEntries revive las dead (attempts en cero, status pending)"() {
        resetMocks();
        indexedDBService.getAll.mockResolvedValue([entry(1, { status: 'dead', attempts: 7, lastError: 'x' })]);
        const n = await PettyCashStore.requeueDeadEntries();
        testRunner.assertEquals(n, 1, 'debe reportar cuántas revivió');
        const updates = indexedDBService.update.mock.calls.filter(c => c[0] === 'pettyCashOutbox');
        testRunner.assert(updates.length === 1, 'debe re-guardar la entrada');
        testRunner.assertEquals(updates[0][1].status, 'pending');
        testRunner.assertEquals(updates[0][1].attempts, 0);
    }

});

testRunner.addSuite("PettyCashStore — drenado al volver la conexión (contrato)", {

    "el módulo escucha el evento 'online' y dispara flush"() {
        testRunner.assert(
            /addEventListener\(\s*['"]online['"]/.test(STORE_SRC),
            "PettyCashStore debe escuchar 'online' — el docstring prometía drenar al volver la conexión pero nadie lo cableaba"
        );
    }

});
