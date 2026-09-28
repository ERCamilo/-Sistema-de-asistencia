/**
 * M3 en la interfaz de Caja Chica (PettyCashUI real, IndexedDB simulado):
 *  - si el movimiento se borra mientras su comprobante se sube, no se
 *    resucita el movimiento y se encola el borrado lógico de lo recién subido
 *    con la versión que devolvió el servidor;
 *  - borrar un movimiento encola el borrado remoto ANTES de borrar el local.
 */
import { indexedDBService } from '../modules/services/IndexedDBService.js';
import { auth } from '../modules/data/firebase.js';
import { state } from '../modules/core/AppState.js';
import { Modal } from '../modules/components/Modal.js';
import { uploadPendingReceipts, registerPettyCashGlobals } from '../modules/features/pettycash/PettyCashUI.js';

const UID = 'firebase-uid-ui';

function movement(id) {
    return { id, projectId: 'p1', periodId: 'per1', recordNumber: 1, type: 'gasto', amount: 500,
        date: '2026-09-20', paidTo: 'Proveedor', receiptStatus: 'local', updatedAt: 1 };
}

function resetPettyCash(movements) {
    state.pettyCash = {
        projects: [{ id: 'p1', name: 'Obra' }],
        periods: [{ id: 'per1', projectId: 'p1', label: 'Sept', status: 'abierta', openingDate: '2026-09-01' }],
        movements,
        selectedProjectId: 'p1', selectedPeriodId: 'per1',
        receiptQueueHiddenIds: [], form: null, periodForm: null, editMov: null
    };
}

const mirrorWrites = () => indexedDBService.update.mock.calls
    .filter(([store, value]) => store === 'pettyCashMirrorOutbox' && value?.kind === 'receipt-delete')
    .map(([, value]) => value);

describe('M3: borrado de comprobantes desde la interfaz', () => {
    let previousFetch;

    beforeEach(() => {
        previousFetch = global.fetch;
        auth.currentUser = { uid: UID, getIdToken: async () => 'token' };
        indexedDBService.update.mockClear();
        indexedDBService.deleteReceipt.mockClear();
        indexedDBService.get.mockResolvedValue(null);
        indexedDBService.getAll.mockResolvedValue([]);
        indexedDBService.updateReceiptJob = jest.fn().mockResolvedValue({});
        indexedDBService.listReceiptJobs = jest.fn().mockResolvedValue([]);
        indexedDBService.finalizeReceiptBackup = jest.fn().mockResolvedValue({});
    });

    afterEach(() => {
        global.fetch = previousFetch;
        delete auth.currentUser;
        state.pettyCash = null;
        jest.restoreAllMocks();
    });

    test('movimiento borrado durante la subida: no se resucita y se pide borrar esa versión', async () => {
        resetPettyCash([movement('mov-ui-1')]);
        indexedDBService.listReceiptJobs.mockResolvedValue([{
            txId: 'mov-ui-1', originalBlob: new Blob([new Uint8Array([0xff, 0xd8, 0xff, 1, 2])], { type: 'image/jpeg' }),
            originalSize: 5, userConfirmedAt: 111, queueStatus: 'confirmed', uploadStatus: 'deferred'
        }]);
        indexedDBService.finalizeReceiptBackup.mockResolvedValue(null);   // el registro local ya no existe
        const bodies = [];
        global.fetch = jest.fn(async (_url, init) => {
            const body = JSON.parse(init.body);
            bodies.push(body);
            if (body.action === 'upload') {
                // El usuario borra el movimiento mientras la subida está en vuelo.
                state.pettyCash.movements = [];
                return { ok: true, status: 200, json: async () => ({ ok: true, path: 'b/uid/mov-ui-1/v111-5', receipt: { uploaded_at: '2026-09-28T10:00:00.000Z' } }) };
            }
            if (body.action === 'lookup') {
                return { ok: true, status: 200, json: async () => ({ ok: true, signedUrl: 'signed://x', receipt: { transaction_id: 'mov-ui-1', uploaded_at: '2026-09-28T10:00:00.000Z' } }) };
            }
            return { ok: true, status: 200, json: async () => ({ ok: true, deleted: true }) };
        });

        await uploadPendingReceipts();

        expect(bodies[0]).toMatchObject({ action: 'upload', txId: 'mov-ui-1', uploadToken: 'v111-5' });
        const resurrected = indexedDBService.update.mock.calls
            .filter(([store, value]) => store === 'pettyCashMovements' && value?.id === 'mov-ui-1');
        expect(resurrected).toEqual([]);
        expect(state.pettyCash.movements).toEqual([]);
        expect(mirrorWrites()).toEqual([expect.objectContaining({
            id: 'receipt-delete:mov-ui-1', txId: 'mov-ui-1', ifUploadedAt: '2026-09-28T10:00:00.000Z', ownerUid: UID
        })]);
        expect(indexedDBService.finalizeReceiptBackup).toHaveBeenCalledWith('mov-ui-1', expect.objectContaining({
            remoteVersion: '2026-09-28T10:00:00.000Z', remoteUploadToken: 'v111-5'
        }));
    });

    test('borrar un movimiento encola el borrado remoto antes de borrar el comprobante local', async () => {
        resetPettyCash([movement('mov-ui-2')]);
        registerPettyCashGlobals();
        jest.spyOn(Modal, 'confirm').mockResolvedValue(true);
        indexedDBService.getReceipt.mockResolvedValue({
            txId: 'mov-ui-2', uploadStatus: 'uploaded', remoteVersion: '2026-09-28T11:00:00.000Z'
        });
        global.fetch = jest.fn(async () => ({ ok: true, status: 200, json: async () => ({ ok: true }) }));
        const order = [];
        indexedDBService.update.mockImplementation(async (store, value) => {
            if (value?.kind === 'receipt-delete') order.push('enqueue');
            return 1;
        });
        indexedDBService.deleteReceipt.mockImplementation(async () => { order.push('delete-local'); return true; });

        await window.pcDeleteMovement('mov-ui-2');

        expect(order.slice(0, 2)).toEqual(['enqueue', 'delete-local']);
        expect(mirrorWrites()[0]).toMatchObject({ txId: 'mov-ui-2', ifUploadedAt: '2026-09-28T11:00:00.000Z' });
        expect(state.pettyCash.movements).toEqual([]);
    });
});
