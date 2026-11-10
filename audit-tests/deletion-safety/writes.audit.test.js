import { auth, deleteDoc, setDoc, getDoc, runTransaction, onSnapshot } from '../../js/modules/data/firebase.js';
import { EmployeeRepository } from '../../js/modules/services/EmployeeRepository.js';
import { PositionRepository } from '../../js/modules/services/PositionRepository.js';
import { LeaderRepository } from '../../js/modules/services/LeaderRepository.js';
import { PettyCashRepository } from '../../js/modules/services/PettyCashRepository.js';

beforeEach(() => {
    auth.currentUser = { uid: 'fictional-audit-user' };
    deleteDoc.mockClear();setDoc.mockClear();onSnapshot.mockClear();getDoc.mockReset().mockResolvedValue({ exists: () => false });
});
afterEach(() => { auth.currentUser = null; });

test.each([
    ['personal', EmployeeRepository], ['puestos', PositionRepository],
    ['líderes', LeaderRepository], ['caja chica', PettyCashRepository.movements]
])('[BORRADO-IO] %s conserva un registro de eliminación, en lugar de retirar el documento físico', async (_name, repository) => {
    await repository.deleteOne('fictional-record');
    expect(deleteDoc).not.toHaveBeenCalled();
    expect(setDoc.mock.calls.some(call => Number.isFinite(call[1]?.deletedAt))).toBe(true);
});

test('[BORRADO-IO] la ruta soft-delete de personal conserva una marca durable y rechaza una edición posterior', async () => {
    const writes = [];
    runTransaction.mockImplementation(async (_db, operation) => operation({
        get: async () => ({ exists: () => true, data: () => ({ updatedAt: 100 }) }),
        set: (_ref, record, options) => writes.push({ record, options })
    }));
    await EmployeeRepository.tombstoneOne('fictional-record', 200);
    expect(writes).toEqual([{ record: expect.objectContaining({ deletedAt: 200, updatedAt: 200 }), options: { merge: true } }]);
    writes.length = 0;
    await expect(EmployeeRepository.tombstoneOne('fictional-record', 50)).rejects.toThrow();
    expect(writes).toEqual([]);
});

test.each([['puestos', PositionRepository], ['líderes', LeaderRepository]])(
    '[RECUPERACIÓN] volver a subir %s antiguos no sobreescribe datos remotos más nuevos', async (_name, repository) => {
        getDoc.mockResolvedValue({ exists: () => true, data: () => ({ id: 'item', name: 'Valor nuevo', updatedAt: 300 }) });
        try {
            await repository.saveOne({ id: 'item', name: 'Valor antiguo', updatedAt: 100 }, { mergeRemote: true });
        } catch (error) {
            expect(['failed-precondition', 'conflict', 'STALE_WRITE']).toContain(error.code);
            expect(setDoc).not.toHaveBeenCalled();
            return;
        }
        const last = setDoc.mock.calls.at(-1)?.[1];
        // A safe implementation may skip/reject a stale write or preserve the server value.
        if (last) expect(last.name).toBe('Valor nuevo');
    }
);

test.each([['personal', EmployeeRepository], ['puestos', PositionRepository], ['líderes', LeaderRepository]])(
    '[FIRESTORE] %s solicita eventos de metadata para observar la confirmación del servidor', (_name, repository) => {
        const stop = repository.subscribe(() => {});
        const registered = onSnapshot.mock.calls.at(-1) || [];
        stop?.();
        expect(registered.some(argument => argument?.includeMetadataChanges === true)).toBe(true);
    }
);

test('[FIRESTORE] caja chica conserva la procedencia de caché para decidir si una descarga está confirmada', () => {
    const listener = jest.fn();const stop = PettyCashRepository.movements.subscribe(listener);
    const callback = onSnapshot.mock.calls.at(-1)?.slice(1).find(argument => typeof argument === 'function');
    expect(typeof callback).toBe('function');
    callback({ metadata: { fromCache: true, hasPendingWrites: false }, forEach: visit => visit({ data: () => ({ id: 'm' }) }) });
    stop?.();
    expect(listener.mock.calls.at(-1)?.[1]?.authoritative).toBe(false);
});
