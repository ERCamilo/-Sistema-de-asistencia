import {
    PettyCashPersistenceMetrics,
    createPettyCashPersistenceMetrics
} from '../modules/features/pettycash/PettyCashPersistenceMetrics.js';

function createMemoryStorage() {
    const values = new Map();
    return {
        getItem: jest.fn((key) => values.get(key) ?? null),
        setItem: jest.fn((key, value) => values.set(key, String(value))),
        removeItem: jest.fn((key) => values.delete(key))
    };
}

describe('PettyCashPersistenceMetrics', () => {
    test('agrega métricas sin almacenar ids ni datos de la factura', () => {
        const storage = createMemoryStorage();
        const metrics = createPettyCashPersistenceMetrics({
            storage,
            now: () => new Date('2026-07-30T12:00:00.000Z').getTime()
        });

        metrics.record({
            operation: 'save',
            collection: 'movements',
            stage: 'cloud-success',
            source: 'receipt-confirm',
            count: 2,
            durationMs: 45,
            id: 'receipt-secret',
            data: { merchant: 'Private merchant' }
        });

        const snapshot = metrics.snapshot();
        const serialized = JSON.stringify(snapshot);
        expect(snapshot.totals.operations).toBe(2);
        expect(snapshot.totals.durationMs).toBe(45);
        expect(serialized).not.toContain('receipt-secret');
        expect(serialized).not.toContain('Private merchant');
        expect(serialized).toContain('save|movements|cloud-success|receipt-confirm|ok');
    });

    test('retiene como máximo siete días', () => {
        const storage = createMemoryStorage();
        let current = new Date('2026-07-20T12:00:00.000Z').getTime();
        const metrics = createPettyCashPersistenceMetrics({
            storage,
            now: () => current
        });

        metrics.record({ operation: 'read', collection: 'projects', stage: 'cloud-success' });
        current = new Date('2026-07-30T12:00:00.000Z').getTime();
        metrics.record({ operation: 'read', collection: 'periods', stage: 'cloud-success' });

        const snapshot = metrics.snapshot();
        expect(Object.keys(snapshot.days)).toEqual(['2026-07-30']);
        expect(snapshot.totals.operations).toBe(1);
    });

    test('normaliza dimensiones desconocidas para impedir cardinalidad sin límite', () => {
        const storage = createMemoryStorage();
        const metrics = createPettyCashPersistenceMetrics({ storage, now: () => Date.now() });

        metrics.record({
            operation: 'custom-secret-operation',
            collection: 'user-provided-collection',
            stage: 'arbitrary-stage',
            source: 'merchant-name',
            status: 'strange-status'
        });

        const keys = Object.keys(metrics.snapshot().days).flatMap(
            (day) => Object.keys(metrics.snapshot().days[day].counters)
        );
        expect(keys).toEqual(['other|other|other|other|other']);
    });

    test('reset elimina el diagnóstico persistido', () => {
        const storage = createMemoryStorage();
        const metrics = createPettyCashPersistenceMetrics({ storage, now: () => Date.now() });
        metrics.record({ operation: 'save', collection: 'movements', stage: 'local-success' });

        metrics.reset();

        expect(metrics.snapshot().totals.operations).toBe(0);
        expect(storage.removeItem).toHaveBeenCalled();
    });

    test('el singleton mantiene una API de diagnóstico estable', () => {
        expect(typeof PettyCashPersistenceMetrics.record).toBe('function');
        expect(typeof PettyCashPersistenceMetrics.snapshot).toBe('function');
        expect(typeof PettyCashPersistenceMetrics.exportJson).toBe('function');
        expect(typeof PettyCashPersistenceMetrics.reset).toBe('function');
    });
});
