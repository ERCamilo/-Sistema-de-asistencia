/**
 * Subida agrupada: fechas de asistencia consecutivas del outbox viajan en una
 * sola transacción, respetando su lugar en la cola; si el lote falla, cada
 * fecha se reintenta sola para que el error quede en la fecha que falla.
 */
import { MainSyncStore, MAX_DAILY_BATCH } from '../modules/services/MainSyncStore.js';
import indexedDBService from '../modules/services/IndexedDBService.js'; // → mock global

const daily = (key, dateKey, extra = {}) => ({
    key, kind: 'daily', dateKey, records: { [`e1_${dateKey}`]: { employeeId: 'e1', date: dateKey } },
    scope: null, status: 'pending', ts: 1000 + key, ...extra
});

function setup(entries) {
    indexedDBService.getAll.mockReset().mockResolvedValue(entries);
    indexedDBService.update.mockReset().mockResolvedValue(1);
    indexedDBService.delete.mockReset().mockResolvedValue(undefined);
}

function makeGuards(overrides = {}) {
    const calls = [];
    const guards = {
        hasSession: () => true,
        isApplyingRemote: () => false,
        isPaused: () => false,
        cloudWatermark: () => 0,
        saveMirror: jest.fn(async () => { calls.push('mirror'); }),
        saveDaily: jest.fn(async (dateKey) => { calls.push(`daily:${dateKey}`); }),
        saveDailyBatch: jest.fn(async (items) => { calls.push(`batch:${items.map(i => i.dateKey).join(',')}`); }),
        saveEntities: jest.fn(async () => { calls.push('entities'); }),
        saveSettings: jest.fn(async () => {}),
        deleteEntity: jest.fn(async () => {}),
        onCloudResult: jest.fn(),
        ...overrides
    };
    return { guards, calls };
}

const deletedKeys = () => indexedDBService.delete.mock.calls
    .filter(c => c[0] === 'mainSyncOutbox').map(c => c[1]);

describe('MainSyncStore — subida agrupada de asistencia', () => {
    test('varias fechas consecutivas suben en una sola llamada y salen de la cola', async () => {
        setup([daily(1, '2026-09-01'), daily(2, '2026-09-02'), daily(3, '2026-09-03')]);
        const { guards, calls } = makeGuards();
        await MainSyncStore.flush(guards);
        expect(calls).toEqual(['batch:2026-09-01,2026-09-02,2026-09-03']);
        expect(guards.saveDaily).not.toHaveBeenCalled();
        expect(deletedKeys()).toEqual([1, 2, 3]);
        expect(guards.onCloudResult).toHaveBeenCalledTimes(3);
        expect(guards.onCloudResult.mock.calls.every(c => c[0] === true)).toBe(true);
    });

    test('respeta el orden de la cola: entidades antes de la asistencia que va detrás', async () => {
        setup([daily(1, '2026-09-01'), daily(2, '2026-09-02'),
            { key: 3, kind: 'entities', employees: [], positions: [], leaders: [], status: 'pending' },
            daily(4, '2026-09-03'), daily(5, '2026-09-04')]);
        const { guards, calls } = makeGuards();
        await MainSyncStore.flush(guards);
        expect(calls).toEqual(['batch:2026-09-01,2026-09-02', 'entities', 'batch:2026-09-03,2026-09-04']);
    });

    test('si las entidades fallan, la asistencia que va detrás no sube', async () => {
        setup([{ key: 1, kind: 'entities', employees: [], positions: [], leaders: [], status: 'pending' },
            daily(2, '2026-09-01'), daily(3, '2026-09-02')]);
        const { guards } = makeGuards({ saveEntities: jest.fn().mockRejectedValue(Object.assign(new Error('offline'), { code: 'unavailable' })) });
        await MainSyncStore.flush(guards);
        expect(guards.saveDailyBatch).not.toHaveBeenCalled();
        expect(deletedKeys()).toEqual([]);
    });

    test('una fecha sola usa el camino normal', async () => {
        setup([daily(1, '2026-09-01')]);
        const { guards, calls } = makeGuards();
        await MainSyncStore.flush(guards);
        expect(calls).toEqual(['daily:2026-09-01']);
    });

    test('la misma fecha repetida (p. ej. parche de reparación) corta el lote', async () => {
        setup([daily(1, '2026-09-01'), daily(2, '2026-09-02'),
            daily(3, '2026-09-02', { source: 'ownership-repair' }), daily(4, '2026-09-03')]);
        const { guards, calls } = makeGuards();
        await MainSyncStore.flush(guards);
        expect(calls).toEqual(['batch:2026-09-01,2026-09-02', 'batch:2026-09-02,2026-09-03']);
    });

    test('si el lote falla, reintenta fecha por fecha y marca solo la que falla', async () => {
        setup([daily(1, '2026-09-01'), daily(2, '2026-09-02'), daily(3, '2026-09-03')]);
        const bad = Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
        const { guards, calls } = makeGuards({
            saveDailyBatch: jest.fn().mockRejectedValue(new Error('batch failed')),
            saveDaily: jest.fn(async (dateKey) => {
                calls.push(`daily:${dateKey}`);
                if (dateKey === '2026-09-02') throw bad;
            })
        });
        await MainSyncStore.flush(guards);
        expect(calls).toEqual(['daily:2026-09-01', 'daily:2026-09-02', 'daily:2026-09-03']);
        expect(deletedKeys()).toEqual([1, 3]);
        const failed = indexedDBService.update.mock.calls.filter(c => c[0] === 'mainSyncOutbox').map(c => c[1]);
        expect(failed).toHaveLength(1);
        expect(failed[0].dateKey).toBe('2026-09-02');
        expect(failed[0].status).toBe('dead');
    });

    test(`parte los lotes en grupos de ${MAX_DAILY_BATCH} fechas`, async () => {
        const entries = Array.from({ length: MAX_DAILY_BATCH + 5 }, (_, i) =>
            daily(i + 1, `2026-08-${String(i + 1).padStart(2, '0')}`));
        setup(entries);
        const { guards } = makeGuards();
        await MainSyncStore.flush(guards);
        expect(guards.saveDailyBatch.mock.calls.map(c => c[0].length)).toEqual([MAX_DAILY_BATCH, 5]);
        expect(deletedKeys()).toHaveLength(MAX_DAILY_BATCH + 5);
    });

    test('sin guard de lote conserva el comportamiento de una fecha a la vez', async () => {
        setup([daily(1, '2026-09-01'), daily(2, '2026-09-02')]);
        const { guards, calls } = makeGuards({ saveDailyBatch: undefined });
        await MainSyncStore.flush(guards);
        expect(calls).toEqual(['daily:2026-09-01', 'daily:2026-09-02']);
    });
});
