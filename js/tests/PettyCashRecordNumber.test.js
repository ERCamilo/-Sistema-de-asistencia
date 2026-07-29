import {
    allocatePettyCashRecordNumber,
    formatPettyCashRecordNumber,
    movementCreatedAt,
    normalizePettyCashRecordNumbers
} from '../modules/features/pettycash/PettyCashRecordNumber.js';

describe('PettyCashRecordNumber', () => {
    test('numera el historial por proyecto en orden de creación', () => {
        const projects = [{ id: 'p1' }];
        const movements = [
            { id: 'mov-3f-zzz', projectId: 'p1' },
            { id: 'mov-1z-aaa', projectId: 'p1' },
            { id: 'mov-2a-bbb', projectId: 'p1' }
        ];

        normalizePettyCashRecordNumbers(projects, movements);

        expect(movements.map((movement) => movement.recordNumber)).toEqual([3, 1, 2]);
        expect(projects[0].lastMovementRecordNumber).toBe(3);
    });

    test('conserva números únicos y repara colisiones de forma determinista', () => {
        const projects = [{ id: 'p1', lastMovementRecordNumber: 8 }];
        const older = { id: 'mov-a-a', projectId: 'p1', recordNumber: 4, createdAt: 100 };
        const newer = { id: 'mov-b-b', projectId: 'p1', recordNumber: 4, createdAt: 200 };
        const existing = { id: 'mov-c-c', projectId: 'p1', recordNumber: 8, createdAt: 300 };

        normalizePettyCashRecordNumbers(projects, [newer, existing, older]);

        expect(older.recordNumber).toBe(4);
        expect(newer.recordNumber).toBe(9);
        expect(existing.recordNumber).toBe(8);
        expect(projects[0].lastMovementRecordNumber).toBe(9);
    });

    test('el contador evita reutilizar un número eliminado', () => {
        const project = { id: 'p1', lastMovementRecordNumber: 14 };
        const next = allocatePettyCashRecordNumber(project, [
            { projectId: 'p1', recordNumber: 12 }
        ], 500);

        expect(next).toBe(15);
        expect(project.lastMovementRecordNumber).toBe(15);
    });

    test('cada proyecto mantiene su propia secuencia', () => {
        const projects = [{ id: 'p1' }, { id: 'p2' }];
        const movements = [
            { id: 'mov-1-a', projectId: 'p1' },
            { id: 'mov-2-b', projectId: 'p2' },
            { id: 'mov-3-c', projectId: 'p1' }
        ];

        normalizePettyCashRecordNumbers(projects, movements);

        expect(movements.map((movement) => movement.recordNumber)).toEqual([1, 1, 2]);
    });

    test('deriva la fecha del id legado y formatea la referencia', () => {
        expect(movementCreatedAt({ id: 'mov-lz-a' })).toBe(Number.parseInt('lz', 36));
        expect(formatPettyCashRecordNumber(14)).toBe('#014');
        expect(formatPettyCashRecordNumber(null)).toBe('#—');
    });
});
