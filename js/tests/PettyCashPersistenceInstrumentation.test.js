import { auth, getDocs, setDoc, onSnapshot } from '../modules/data/firebase.js';
import indexedDBService from '../modules/services/IndexedDBService.js';
import { PettyCashRepository } from '../modules/services/PettyCashRepository.js';
import { PettyCashStore } from '../modules/features/pettycash/PettyCashStore.js';
import { PettyCashPersistenceMetrics } from '../modules/features/pettycash/PettyCashPersistenceMetrics.js';

describe('Caja Chica — instrumentación de persistencia', () => {
    let recordSpy;

    beforeEach(() => {
        recordSpy = jest.spyOn(PettyCashPersistenceMetrics, 'record').mockImplementation(() => {});
        auth.currentUser = { uid: 'metrics-user' };
        getDocs.mockReset();
        setDoc.mockReset().mockResolvedValue(undefined);
        onSnapshot.mockReset().mockReturnValue(() => {});
        indexedDBService.update.mockReset().mockResolvedValue(1);
        indexedDBService.getAll.mockReset().mockResolvedValue([]);
        indexedDBService.get.mockReset().mockResolvedValue(null);
        indexedDBService.delete.mockReset().mockResolvedValue(undefined);
        indexedDBService.acquireLease.mockReset().mockResolvedValue(true);
        indexedDBService.releaseLease.mockReset().mockResolvedValue(true);
    });

    afterEach(() => {
        auth.currentUser = null;
        recordSpy.mockRestore();
    });

    test('mide documentos leídos por una carga remota', async () => {
        getDocs.mockResolvedValueOnce({
            forEach: (callback) => [
                { data: () => ({ id: 'm1' }) },
                { data: () => ({ id: 'm2' }) }
            ].forEach(callback)
        });

        await PettyCashRepository.movements.loadAll();

        expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({
            operation: 'read',
            collection: 'movements',
            stage: 'cloud-success',
            count: 2
        }));
    });

    test('mide el guardado real enviado a Firestore y conserva su origen', async () => {
        await PettyCashRepository.movements.saveOne(
            { id: 'm1', amount: 20 },
            { source: 'receipt-confirm' }
        );

        expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({
            operation: 'save',
            collection: 'movements',
            stage: 'cloud-success',
            source: 'receipt-confirm'
        }));
    });

    test('mide guardado local y encolado sin guardar el payload en métricas', async () => {
        auth.currentUser = null;

        await PettyCashStore.save(
            'movements',
            { id: 'm-private', merchant: 'Private merchant', amount: 20 },
            { source: 'receipt-queue' }
        );

        expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({
            operation: 'save',
            collection: 'movements',
            stage: 'local-success',
            source: 'receipt-queue'
        }));
        expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({
            operation: 'queue',
            collection: 'outbox',
            stage: 'queue-success',
            source: 'receipt-queue'
        }));
        recordSpy.mock.calls.forEach(([event]) => {
            expect(event).not.toHaveProperty('id');
            expect(event).not.toHaveProperty('data');
            expect(event).not.toHaveProperty('amount');
        });
    });

    test('saveLocal conserva un borrador sin encolarlo para Firebase ni Supabase', async () => {
        auth.currentUser = null;

        await PettyCashStore.saveLocal(
            'movements',
            { id: 'draft-1', amount: 0, reviewPending: true },
            { source: 'receipt-ocr' }
        );

        expect(indexedDBService.update).toHaveBeenCalledWith(
            'pettyCashMovements',
            expect.objectContaining({ id: 'draft-1' })
        );
        expect(indexedDBService.update).not.toHaveBeenCalledWith(
            'pettyCashOutbox',
            expect.anything()
        );
        expect(indexedDBService.update).not.toHaveBeenCalledWith(
            'pettyCashMirrorOutbox',
            expect.anything()
        );
        expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({
            operation: 'save',
            collection: 'movements',
            stage: 'local-success',
            source: 'receipt-ocr'
        }));
    });

    test('mide cada snapshot recibido por el listener', () => {
        let snapshotCallback;
        onSnapshot.mockImplementation((_ref, callback) => {
            snapshotCallback = callback;
            return () => {};
        });
        PettyCashRepository.projects.subscribe(() => {});

        snapshotCallback({
            forEach: (callback) => [{ data: () => ({ id: 'p1' }) }].forEach(callback)
        });

        expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({
            operation: 'read',
            collection: 'projects',
            stage: 'snapshot',
            source: 'live-sync',
            count: 1
        }));
    });

    test('mide el espejo de Supabase con el mismo origen del guardado', async () => {
        const entry = {
            id: 'm-normalized',
            op: 'save',
            data: {
                id: 'm-normalized',
                projectId: 'project-1',
                periodId: 'period-1',
                recordNumber: 30,
                type: 'gasto',
                amount: 100,
                createdAt: 100,
                updatedAt: 200
            },
            ownerUid: 'metrics-user',
            source: 'identity-normalization',
            ts: 300,
            status: 'pending'
        };
        auth.currentUser = {
            uid: 'metrics-user',
            getIdToken: jest.fn().mockResolvedValue('firebase-token')
        };
        indexedDBService.getAll.mockResolvedValue([entry]);
        indexedDBService.get.mockResolvedValue(entry);
        const originalFetch = globalThis.fetch;
        globalThis.fetch = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ ok: true })
        });

        try {
            await PettyCashStore.flushMirror();

            expect(recordSpy).toHaveBeenCalledWith(expect.objectContaining({
                operation: 'mirror',
                collection: 'mirror',
                stage: 'cloud-success',
                source: 'identity-normalization'
            }));
            expect(indexedDBService.delete).toHaveBeenCalledWith(
                'pettyCashMirrorOutbox',
                entry.id
            );
        } finally {
            if (originalFetch) globalThis.fetch = originalFetch;
            else delete globalThis.fetch;
        }
    });
});
